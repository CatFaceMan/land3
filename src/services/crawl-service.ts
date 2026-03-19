import type { AppConfig, BizType, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
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
    if (params.bizType === "notice") {
      params.onNotices?.(output.notices);
    } else {
      params.onResults?.(output.results);
    }
    await params.repository.finishCrawlRun(runId, "success", output.summary);
    return output;
  } catch (error) {
    await params.repository.finishCrawlRun(
      runId,
      "failed",
      {
        siteCode: params.siteCode,
        bizType: params.bizType,
        noticesSaved: 0,
        resultsSaved: 0,
        failures: 1,
        pagesVisited: 0
      },
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
