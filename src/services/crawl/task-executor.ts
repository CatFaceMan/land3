import type { Page } from "playwright";
import type { SiteAdapter } from "../../adapters/site-adapter.js";
import type { ParsedNoticeRecord, ParsedResultRecord } from "../../domain/types.js";
import type { BrowserKernel } from "../../kernel/browser-kernel.js";
import { normalizeDate } from "../../utils/date.js";
import type { RetryPolicy } from "./retry-policy.js";
import type { CrawlContext, ItemTask, TaskResult } from "./types.js";

function isBeforeFromDate(value: string | null | undefined, from: string | undefined): boolean {
  if (!from) {
    return false;
  }
  const normalizedValue = normalizeDate(value);
  const normalizedFrom = normalizeDate(from);
  return Boolean(normalizedValue && normalizedFrom && normalizedValue < normalizedFrom);
}

function shouldStopByFromDate(task: ItemTask, parsed: ParsedNoticeRecord[] | ParsedResultRecord[], from: string | undefined): boolean {
  if (!from) {
    return false;
  }
  if (task.bizType === "notice") {
    return (parsed as ParsedNoticeRecord[]).some((record) => isBeforeFromDate(record.noticeDate, from));
  }
  return (parsed as ParsedResultRecord[]).some((record) => isBeforeFromDate(record.dealDate, from));
}

export class TaskExecutor {
  public constructor(
    private readonly adapter: SiteAdapter,
    private readonly kernel: BrowserKernel,
    private readonly retryPolicy: RetryPolicy
  ) {}

  public async execute(
    context: CrawlContext,
    task: ItemTask,
    listPage: Page,
    from: string | undefined
  ): Promise<{ result: TaskResult; notices: ParsedNoticeRecord[]; results: ParsedResultRecord[]; listPage: Page }> {
    const startedAt = Date.now();
    let workingPage = listPage;
    let notices: ParsedNoticeRecord[] = [];
    let results: ParsedResultRecord[] = [];
    let lastError: Error | null = null;
    let attempt = task.attempt;
    const taskTimeoutMs = Math.max(1_000, context.config.browser.timeoutMs * 3);
    const gotoTimeoutMs = Math.max(10_000, context.config.browser.timeoutMs * 2);

    while (this.retryPolicy.canRetry(attempt)) {
      try {
        attempt += 1;
        await this.withTaskTimeout(
          async () => {
            if (task.listItem.url) {
              const detailPage = await this.kernel.newPage();
              try {
                await detailPage.goto(task.listItem.url, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
                const parsed = await this.adapter.parseDetail(detailPage, task.bizType, {
                  listItem: task.listItem,
                  task: {
                    siteCode: task.siteCode,
                    bizType: task.bizType,
                    pageNo: task.pageNo,
                    itemIndex: task.itemIndex,
                    stage: "detail",
                    retryCount: attempt - 1,
                    l1Index: null,
                    l2Index: null
                  }
                });
                if (task.bizType === "notice") {
                  notices = parsed as ParsedNoticeRecord[];
                } else {
                  results = parsed as ParsedResultRecord[];
                }
              } finally {
                await detailPage.close().catch(() => undefined);
              }
            } else {
              await this.kernel.sleep(context.config.browser.throttle.beforeDetailClickMs);
              workingPage = await this.adapter.openDetail(workingPage, task.bizType, task.itemIndex);
              const parsed = await this.adapter.parseDetail(workingPage, task.bizType, {
                listItem: task.listItem,
                task: {
                  siteCode: task.siteCode,
                  bizType: task.bizType,
                  pageNo: task.pageNo,
                  itemIndex: task.itemIndex,
                  stage: "detail",
                  retryCount: attempt - 1,
                  l1Index: null,
                  l2Index: null
                }
              });
              if (task.bizType === "notice") {
                notices = parsed as ParsedNoticeRecord[];
              } else {
                results = parsed as ParsedResultRecord[];
              }
              workingPage = await this.adapter.returnToList(workingPage, task.bizType);
            }
          },
          taskTimeoutMs,
          task
        );
        const parsed = task.bizType === "notice" ? notices : results;
        return {
          result: {
            task: { ...task, attempt },
            status: "succeeded",
            durationMs: Date.now() - startedAt,
            lastError: null,
            stopByFromDate: shouldStopByFromDate(task, parsed, from)
          },
          notices,
          results,
          listPage: workingPage
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.retryPolicy.canRetry(attempt)) {
          break;
        }
      }
    }

    const message = lastError?.message ?? "Unknown error";
    void context;
    return {
      result: {
        task: { ...task, attempt },
        status: "failed",
        durationMs: Date.now() - startedAt,
        lastError: message,
        stopByFromDate: false
      },
      notices: [],
      results: [],
      listPage: await this.kernel.recoverAfterFailure()
    };
  }

  private async withTaskTimeout(run: () => Promise<void>, timeoutMs: number, task: ItemTask): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                `task timeout stage=detail url=${task.listItem.url ?? "interactive"} selector=item[${task.itemIndex}] timeoutMs=${timeoutMs}`
              )
            );
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
