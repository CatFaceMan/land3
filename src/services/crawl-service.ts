import type { AppConfig, BizType, CrawlRunSummary, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
import { LandRepository } from "../db/repository.js";
import { CrawlOrchestrator } from "./crawl/crawl-orchestrator.js";

export interface CrawlOutput {
  summary: {
    siteCode: SiteCode;
    bizType: BizType;
    noticesSaved: number;
    resultsSaved: number;
    failures: number;
    pagesVisited: number;
    metrics?: {
      processedTasks: number;
      succeededTasks: number;
      failedTasks: number;
      retriedTasks: number;
      averageTaskDurationMs: number;
      pageSuccessRate: number;
      taskFailureRate: number;
      siteHealthScore: number;
    };
  };
  notices: ParsedNoticeRecord[];
  results: ParsedResultRecord[];
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return value;
}

function assertQuality(summary: CrawlRunSummary): void {
  const maxFailures = Math.max(0, readEnvNumber("CRAWL_MAX_FAILURES", 0));
  const maxFailureRate = Math.max(0, readEnvNumber("CRAWL_MAX_FAILURE_RATE", 0.02));
  const processedTasks = summary.metrics?.processedTasks ?? summary.noticesSaved + summary.resultsSaved + summary.failures;
  const failureRate = processedTasks > 0 ? summary.failures / processedTasks : (summary.failures > 0 ? 1 : 0);
  if (summary.failures <= maxFailures || failureRate <= maxFailureRate) {
    return;
  }
  throw new Error(
    `Quality gate failed for ${summary.siteCode}/${summary.bizType}: failures=${summary.failures}, processed=${processedTasks}, failureRate=${failureRate.toFixed(4)}, maxFailures=${maxFailures}, maxFailureRate=${maxFailureRate}`
  );
}

export async function runCrawl(params: {
  config: AppConfig;
  repository: LandRepository;
  siteCode: SiteCode;
  bizType: BizType;
  from?: string;
  to?: string;
  resume?: boolean;
  maxItems?: number;
  onNotices?: (records: ParsedNoticeRecord[]) => void;
  onResults?: (records: ParsedResultRecord[]) => void;
}): Promise<CrawlOutput> {
  const runId = await params.repository.createCrawlRun({
    siteCode: params.siteCode,
    bizType: params.bizType,
    from: params.from,
    to: params.to
  });
  const orchestrator = new CrawlOrchestrator();
  let latestSummary: CrawlRunSummary | null = null;

  try {
    const output = await orchestrator.run({
      config: params.config,
      repository: params.repository,
      runId,
      siteCode: params.siteCode,
      bizType: params.bizType,
      from: params.from,
      to: params.to,
      maxItems: params.maxItems
    });
    latestSummary = output.summary;
    assertQuality(output.summary);
    if (params.bizType === "notice") {
      params.onNotices?.(output.notices);
    } else {
      params.onResults?.(output.results);
    }
    await params.repository.finishCrawlRun(runId, "success", output.summary);
    return output;
  } catch (error) {
    const fallbackSummary: CrawlRunSummary =
      latestSummary ?? {
        siteCode: params.siteCode,
        bizType: params.bizType,
        noticesSaved: 0,
        resultsSaved: 0,
        failures: 1,
        pagesVisited: 0
      };
    await params.repository.finishCrawlRun(
      runId,
      "failed",
      fallbackSummary,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
