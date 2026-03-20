import type { BizType, CrawlTaskStatus, SiteCode } from "../../domain/types.js";
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
