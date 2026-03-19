import { LandRepository } from "../db/repository.js";
import type { AppConfig, SiteCode } from "../domain/types.js";
import { runCrawl } from "./crawl-service.js";
import { mergeNoticeAndResults } from "./merge-service.js";

export async function runRefresh(params: {
  config: AppConfig;
  repository: LandRepository;
  siteCode: SiteCode;
  from?: string;
  to?: string;
  maxItems?: number;
}): Promise<{
  siteCode: SiteCode;
  noticeCrawl: { noticesSaved: number; failures: number; pagesVisited: number };
  resultCrawl: { resultsSaved: number; failures: number; pagesVisited: number };
  records: number;
  reviewRows: number;
}> {
  const noticeOutput = await runCrawl({
    config: params.config,
    repository: params.repository,
    siteCode: params.siteCode,
    bizType: "notice",
    from: params.from,
    to: params.to,
    resume: false,
    maxItems: params.maxItems
  });
  const resultOutput = await runCrawl({
    config: params.config,
    repository: params.repository,
    siteCode: params.siteCode,
    bizType: "result",
    from: params.from,
    to: params.to,
    resume: false,
    maxItems: params.maxItems
  });

  const noticeRecords = await params.repository.listNoticeRaw(params.siteCode);
  const resultRecords = await params.repository.listResultRaw(params.siteCode);
  const merged = mergeNoticeAndResults(params.siteCode, noticeRecords, resultRecords);
  await params.repository.upsertMergedBatch(params.siteCode, merged.records, merged.reviewPool);

  return {
    siteCode: params.siteCode,
    noticeCrawl: {
      noticesSaved: noticeOutput.summary.noticesSaved,
      failures: noticeOutput.summary.failures,
      pagesVisited: noticeOutput.summary.pagesVisited
    },
    resultCrawl: {
      resultsSaved: resultOutput.summary.resultsSaved,
      failures: resultOutput.summary.failures,
      pagesVisited: resultOutput.summary.pagesVisited
    },
    records: merged.records.length,
    reviewRows: merged.reviewPool.length
  };
}
