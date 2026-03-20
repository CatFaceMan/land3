import pLimit from "p-limit";
import { getAdapter } from "../../adapters/registry.js";
import { isRateLimitedSite } from "../../domain/sites.js";
import type { CrawlRunSummary, ParsedNoticeRecord, ParsedResultRecord } from "../../domain/types.js";
import { BrowserKernel } from "../../kernel/browser-kernel.js";
import { CheckpointStore } from "./checkpoint-store.js";
import { CrawlLogger } from "./logger.js";
import { RetryPolicy } from "./retry-policy.js";
import { TaskExecutor } from "./task-executor.js";
import { TaskScheduler } from "./task-scheduler.js";
import type { CrawlContext, ItemTask } from "./types.js";

export interface CrawlOrchestratorOutput {
  summary: CrawlRunSummary;
  notices: ParsedNoticeRecord[];
  results: ParsedResultRecord[];
}

function resolveProxy(context: CrawlContext) {
  const runtime = context.config.sites[context.siteCode];
  if (runtime.proxyProfile) {
    return context.config.proxies[runtime.proxyProfile] ?? null;
  }
  return context.config.proxies.global ?? null;
}

export class CrawlOrchestrator {
  public constructor(private readonly logger = new CrawlLogger()) {}

  public async run(context: CrawlContext): Promise<CrawlOrchestratorOutput> {
    const adapter = getAdapter(context.siteCode);
    const kernel = new BrowserKernel(context.config, context.siteCode, resolveProxy(context));
    const checkpointStore = new CheckpointStore(context.repository);
    const scheduler = new TaskScheduler(adapter, checkpointStore);
    const retryPolicy = new RetryPolicy(context.config.browser.retry.detailRetries + 1);
    const executor = new TaskExecutor(adapter, kernel, retryPolicy);
    const siteRuntime = context.config.sites[context.siteCode];
    const rateLimited = isRateLimitedSite(context.siteCode);
    const configuredDetailConcurrency = Math.max(1, siteRuntime.detailConcurrency ?? 5);
    const configuredExtraDelayMs = Math.max(0, siteRuntime.extraDelayMs ?? 0);
    const detailConcurrency = rateLimited ? 1 : configuredDetailConcurrency;
    const extraDelayMs = rateLimited ? Math.max(2_500, configuredExtraDelayMs) : configuredExtraDelayMs;

    const notices: ParsedNoticeRecord[] = [];
    const results: ParsedResultRecord[] = [];
    const summary: CrawlRunSummary = {
      siteCode: context.siteCode,
      bizType: context.bizType,
      noticesSaved: 0,
      resultsSaved: 0,
      failures: 0,
      pagesVisited: 0
    };

    let processedTasks = 0;
    let succeededTasks = 0;
    let failedTasks = 0;
    let retriedTasks = 0;
    let taskDurationSum = 0;
    const fromDate = context.from ? new Date(context.from) : undefined;
    let stopByFromDate = false;

    try {
      let listPage = await kernel.getPage();
      const startWatermark = await scheduler.bootstrap(context);
      const startPage = Math.max(1, startWatermark + 1);
      await adapter.gotoPage(listPage, context.bizType, startPage);

      for (let pageNo = startPage; ; pageNo += 1) {
        summary.pagesVisited = Math.max(summary.pagesVisited, pageNo);
        this.logger.info({ event: "page_start", runId: context.runId, site: context.siteCode, biz: context.bizType, page: pageNo });

        const tasks = await scheduler.listPageTasks(context, listPage, pageNo);
        if (tasks.length === 0) {
          this.logger.info({ event: "page_empty", runId: context.runId, site: context.siteCode, biz: context.bizType, page: pageNo });
          break;
        }

        const directTasks = tasks.filter((task) => Boolean(task.listItem.url));
        const interactiveTasks = tasks.filter((task) => !task.listItem.url);
        const limit = pLimit(detailConcurrency);
        const directSettled = await Promise.allSettled(
          directTasks.map((task) =>
            limit(async () => {
              if (extraDelayMs > 0) {
                await kernel.sleep(extraDelayMs);
              }
              this.logger.info({
                event: "task_start",
                runId: context.runId,
                site: context.siteCode,
                biz: context.bizType,
                page: task.pageNo,
                item: task.itemIndex,
                stage: "detail",
                attempt: task.attempt + 1
              });
              await context.repository.updateTaskStatus(
                task.siteCode,
                task.bizType,
                task.pageNo,
                task.itemIndex,
                "running",
                task.attempt + 1,
                null
              );
              const output = await executor.execute(context, task, listPage, fromDate);
              return { task, output };
            })
          )
        );
        for (let index = 0; index < directSettled.length; index += 1) {
          const settled = directSettled[index];
          const fallbackTask = directTasks[index];
          const output =
            settled.status === "fulfilled"
              ? settled.value.output
              : await this.buildRejectedTaskOutput(context, fallbackTask, settled.reason, listPage);
          const handledTask = settled.status === "fulfilled" ? settled.value.task : fallbackTask;
          listPage = output.listPage;
          const shouldStop = await this.handleTaskOutput(context, handledTask, output, summary, notices, results);
          processedTasks += 1;
          taskDurationSum += output.result.durationMs;
          if (output.result.task.attempt > 1) {
            retriedTasks += output.result.task.attempt - 1;
            this.logger.info({
              event: "task_retry",
              runId: context.runId,
              site: context.siteCode,
              biz: context.bizType,
              page: handledTask.pageNo,
              item: handledTask.itemIndex,
              stage: "detail",
              attempt: output.result.task.attempt
            });
          }
          if (output.result.status === "succeeded") {
            succeededTasks += 1;
            if (output.result.task.attempt > 1) {
              this.logger.info({
                event: "task_recovered",
                runId: context.runId,
                site: context.siteCode,
                biz: context.bizType,
                page: handledTask.pageNo,
                item: handledTask.itemIndex,
                stage: "detail",
                attempt: output.result.task.attempt
              });
            }
          } else {
            failedTasks += 1;
            if (this.isTimeoutError(output.result.lastError)) {
              this.logger.error({
                event: "task_timeout",
                runId: context.runId,
                site: context.siteCode,
                biz: context.bizType,
                page: handledTask.pageNo,
                item: handledTask.itemIndex,
                stage: "detail",
                attempt: output.result.task.attempt,
                errorType: output.result.lastError ?? "timeout"
              });
            }
          }
          if (shouldStop) {
            stopByFromDate = true;
          }
        }

        for (const task of interactiveTasks) {
          if (extraDelayMs > 0) {
            await kernel.sleep(extraDelayMs);
          }
          this.logger.info({
            event: "task_start",
            runId: context.runId,
            site: context.siteCode,
            biz: context.bizType,
            page: task.pageNo,
            item: task.itemIndex,
            stage: "detail",
            attempt: task.attempt + 1
          });
          await context.repository.updateTaskStatus(
            task.siteCode,
            task.bizType,
            task.pageNo,
            task.itemIndex,
            "running",
            task.attempt + 1,
            null
          );
          const output = await executor.execute(context, task, listPage, fromDate);
          listPage = output.listPage;
          const shouldStop = await this.handleTaskOutput(context, output.result.task, output, summary, notices, results);
          processedTasks += 1;
          taskDurationSum += output.result.durationMs;
          if (output.result.task.attempt > 1) {
            retriedTasks += output.result.task.attempt - 1;
            this.logger.info({
              event: "task_retry",
              runId: context.runId,
              site: context.siteCode,
              biz: context.bizType,
              page: task.pageNo,
              item: task.itemIndex,
              stage: "detail",
              attempt: output.result.task.attempt
            });
          }
          if (output.result.status === "succeeded") {
            succeededTasks += 1;
            if (output.result.task.attempt > 1) {
              this.logger.info({
                event: "task_recovered",
                runId: context.runId,
                site: context.siteCode,
                biz: context.bizType,
                page: task.pageNo,
                item: task.itemIndex,
                stage: "detail",
                attempt: output.result.task.attempt
              });
            }
          } else {
            failedTasks += 1;
            if (this.isTimeoutError(output.result.lastError)) {
              this.logger.error({
                event: "task_timeout",
                runId: context.runId,
                site: context.siteCode,
                biz: context.bizType,
                page: task.pageNo,
                item: task.itemIndex,
                stage: "detail",
                attempt: output.result.task.attempt,
                errorType: output.result.lastError ?? "timeout"
              });
            }
          }
          if (shouldStop) {
            stopByFromDate = true;
          }
        }

        await scheduler.completePage(context, pageNo);
        if (context.maxItems && (summary.noticesSaved + summary.resultsSaved) >= context.maxItems) {
          break;
        }
        if (stopByFromDate) {
          break;
        }
        const moved = await adapter.nextPage(listPage, context.bizType, pageNo);
        if (!moved) {
          break;
        }
        if (extraDelayMs > 0) {
          await kernel.sleep(extraDelayMs);
        }
        await kernel.sleep(context.config.browser.throttle.afterPageTurnMs);
      }
      summary.metrics = {
        processedTasks,
        succeededTasks,
        failedTasks,
        retriedTasks,
        averageTaskDurationMs: processedTasks > 0 ? Number((taskDurationSum / processedTasks).toFixed(2)) : 0,
        pageSuccessRate: summary.pagesVisited > 0 ? Number(((summary.pagesVisited - Number(summary.failures > 0)) / summary.pagesVisited).toFixed(4)) : 1,
        taskFailureRate: processedTasks > 0 ? Number((failedTasks / processedTasks).toFixed(4)) : 0,
        siteHealthScore: processedTasks > 0 ? Number((Math.max(0, 1 - failedTasks / processedTasks) * 100).toFixed(2)) : 100
      };

      await context.repository.clearTaskState(context.siteCode, context.bizType);
      return { summary, notices, results };
    } finally {
      await kernel.close();
    }
  }

  private async handleTaskOutput(
    context: CrawlContext,
    task: ItemTask,
    output: Awaited<ReturnType<TaskExecutor["execute"]>>,
    summary: CrawlRunSummary,
    notices: ParsedNoticeRecord[],
    results: ParsedResultRecord[]
  ): Promise<boolean> {
    await context.repository.updateTaskStatus(
      task.siteCode,
      task.bizType,
      task.pageNo,
      task.itemIndex,
      output.result.status === "failed" ? "retryable" : output.result.status,
      task.attempt,
      output.result.lastError
    );

    if (output.result.status === "succeeded") {
      if (context.bizType === "notice") {
        await context.repository.upsertNoticeBatch(output.notices);
        summary.noticesSaved += output.notices.length;
        notices.push(...output.notices);
      } else {
        await context.repository.upsertResultBatch(output.results);
        summary.resultsSaved += output.results.length;
        results.push(...output.results);
      }
      this.logger.info({
        event: "task_done",
        runId: context.runId,
        site: context.siteCode,
        biz: context.bizType,
        page: task.pageNo,
        item: task.itemIndex,
        stage: "detail",
        attempt: task.attempt,
        durationMs: output.result.durationMs,
        result: "succeeded"
      });
      return output.result.stopByFromDate;
    }

    summary.failures += 1;
    this.logger.error({
      event: "task_done",
      runId: context.runId,
      site: context.siteCode,
      biz: context.bizType,
      page: task.pageNo,
      item: task.itemIndex,
      stage: "detail",
      attempt: task.attempt,
      durationMs: output.result.durationMs,
      result: "failed",
      errorType: output.result.lastError ?? "error"
    });
    return false;
  }

  private isTimeoutError(message: string | null): boolean {
    const normalized = (message ?? "").toLowerCase();
    return normalized.includes("timeout");
  }

  private async buildRejectedTaskOutput(
    context: CrawlContext,
    task: ItemTask,
    reason: unknown,
    listPage: Awaited<ReturnType<BrowserKernel["getPage"]>>
  ): Promise<Awaited<ReturnType<TaskExecutor["execute"]>>> {
    const message = reason instanceof Error ? reason.message : String(reason);
    await context.repository.saveFailure({
      siteCode: context.siteCode,
      bizType: context.bizType,
      pageNo: task.pageNo,
      itemIndex: task.itemIndex,
      stage: "detail",
      itemTitle: task.listItem.title,
      errorMessage: message,
      currentUrl: task.listItem.url ?? listPage.url(),
      screenshotPath: null,
      htmlPath: null,
      l1Index: null,
      l2Index: null
    });
    return {
      result: {
        task: { ...task, attempt: task.attempt + 1 },
        status: "failed",
        durationMs: 0,
        lastError: message,
        stopByFromDate: false
      },
      notices: [],
      results: [],
      listPage
    };
  }
}
