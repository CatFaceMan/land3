import type { BizType, CrawlTaskRecord, CrawlTaskStatus, SiteCode } from "../../domain/types.js";
import type { AppConfig, ListItemSummary } from "../../domain/types.js";
import type { LandRepository } from "../../db/repository.js";

export interface CrawlContext {
  config: AppConfig;
  repository: LandRepository;
  runId: number;
  siteCode: SiteCode;
  bizType: BizType;
  from?: string;
  to?: string;
  maxItems?: number;
}

export interface ItemTask {
  siteCode: SiteCode;
  bizType: BizType;
  pageNo: number;
  itemIndex: number;
  status: CrawlTaskStatus;
  attempt: number;
  listItem: ListItemSummary;
}

export interface TaskResult {
  task: ItemTask;
  status: Extract<CrawlTaskStatus, "succeeded" | "failed" | "retryable">;
  durationMs: number;
  lastError: string | null;
  stopByFromDate: boolean;
}

export function toTaskRecord(task: ItemTask, status?: CrawlTaskStatus, lastError?: string | null): Omit<CrawlTaskRecord, "updatedAt"> {
  return {
    siteCode: task.siteCode,
    bizType: task.bizType,
    pageNo: task.pageNo,
    itemIndex: task.itemIndex,
    status: status ?? task.status,
    attempt: task.attempt,
    title: task.listItem.title,
    url: task.listItem.url ?? null,
    publishedAt: task.listItem.publishedAt ?? null,
    lastError: lastError ?? null
  };
}
