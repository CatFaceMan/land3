export type SiteCode =
  | "beijing"
  | "suzhou"
  | "wuxi"
  | "changzhou"
  | "hangzhou"
  | "ningbo"
  | "guangzhou"
  | "hefei"
  | "chengdu"
  | "xian"
  | "wuhan";

export type BizType = "notice" | "result";
export type NavigationStrategy = "return" | "reopen";
export type TaskStage = "list" | "detail" | "l1_detail" | "l2_detail";
export type CrawlTaskStatus = "pending" | "running" | "succeeded" | "failed" | "retryable";

export interface ProxyProfile {
  enabled: boolean;
  server?: string;
  username?: string;
  password?: string;
  fallbackToDirect: boolean;
}

export interface BrowserRuntimeConfig {
  headless: boolean;
  timeoutMs: number;
  userAgent?: string;
  throttle: {
    afterListOpenMs: number;
    beforeDetailClickMs: number;
    afterListReturnMs: number;
    afterPageTurnMs: number;
  };
  retry: {
    detailRetries: number;
    contextResetThreshold: number;
  };
}

export interface SiteRuntimeConfig {
  enabled: boolean;
  proxyProfile?: string;
  detailConcurrency?: number;
  extraDelayMs?: number;
}

export interface AppConfig {
  databaseUrl: string;
  browser: BrowserRuntimeConfig;
  proxies: Record<string, ProxyProfile>;
  sites: Record<SiteCode, SiteRuntimeConfig>;
  artifactRoot: string;
}

export interface CrawlTaskState {
  siteCode: SiteCode;
  bizType: BizType;
  pageNo: number;
  itemIndex: number;
  stage: TaskStage;
  retryCount: number;
  l1Index?: number | null;
  l2Index?: number | null;
}

export interface CheckpointRecord extends CrawlTaskState {
  lastErrorType?: string | null;
  updatedAt: Date;
}

export interface FailureRecord {
  siteCode: SiteCode;
  bizType: BizType;
  pageNo: number;
  itemIndex: number;
  stage: TaskStage;
  currentUrl: string | null;
  itemTitle: string | null;
  screenshotPath: string | null;
  htmlPath: string | null;
  errorMessage: string;
  l1Index?: number | null;
  l2Index?: number | null;
}

export interface ArtifactPaths {
  screenshotPath: string | null;
  htmlPath: string | null;
}

export interface AttachmentLink {
  text: string;
  url: string;
}

export interface ParsedTable {
  rows: Array<Record<string, string>>;
}

export interface DetailDocument {
  title: string;
  leadDateText: string | null;
  contentText: string;
  rawHtml: string;
  tables: ParsedTable[];
  attachments: AttachmentLink[];
}

export interface ListItemSummary {
  title: string;
  url?: string | null;
  publishedAt?: string | null;
  pageNo: number;
  itemIndex: number;
}

export interface ParsedNoticeRecord {
  siteCode: SiteCode;
  sourceUrl: string;
  sourceTitle: string;
  city: string;
  district: string | null;
  noticeTitle: string;
  noticeNoRaw: string | null;
  noticeNoNorm: string | null;
  normalizedAnnouncementNo?: string | null;
  landUsage: string | null;
  areaHa: number | null;
  startPriceWan: number | null;
  noticeDate: string | null;
  tradeDate: string | null;
  parcelNo: string | null;
  parcelCode?: string | null;
  contentText: string;
  rawHtml: string;
  attachmentsJson: string | null;
  crawlTime: Date;
  sourceKey: string;
}

export interface ParsedResultRecord {
  siteCode: SiteCode;
  sourceUrl: string;
  sourceTitle: string;
  city: string;
  district: string | null;
  resultTitle: string;
  noticeNoRaw: string | null;
  noticeNoNorm: string | null;
  normalizedAnnouncementNo?: string | null;
  dealPriceWan: number | null;
  winner: string | null;
  status: string | null;
  dealDate: string | null;
  parcelNo: string | null;
  parcelCode?: string | null;
  contentText: string;
  rawHtml: string;
  attachmentsJson: string | null;
  crawlTime: Date;
  sourceKey: string;
}

export interface MergedLandRecord {
  id?: number;
  siteCode: SiteCode;
  city: string;
  district: string | null;
  announcementNo: string;
  tradeDate: string | null;
  parcelName: string;
  landUsage: string | null;
  areaHa: number | null;
  startPriceWan: number | null;
  dealPriceWan: number | null;
  noticeDate: string | null;
  tradeStatus: string;
  winner: string | null;
  noticeSourceUrl: string | null;
  resultSourceUrl: string | null;
}

export interface ManualReviewRecord {
  id?: number;
  siteCode: SiteCode;
  city: string;
  district: string | null;
  announcementNo: string | null;
  parcelName: string | null;
  noticeDate: string | null;
  tradeDate: string | null;
  reasonCode: string;
  noticeSourceUrl: string | null;
  resultSourceUrl: string | null;
}

export interface ExportLandRow {
  序号: number;
  所属市: string;
  "所属区（县）": string;
  出让公告: string;
  交易日期: Date | null;
  地块公告号: string;
  用地性质: string;
  "面积（公顷）": number | null;
  "起始价（万元）": number | null;
  "成交价（万元）": number | null;
  "溢价金额（万元）": number | null;
  溢价率: number | null;
  公告时间: Date | null;
  交易状态: string;
  竞得单位: string | null;
}

export interface CrawlRunSummary {
  siteCode: SiteCode;
  bizType: BizType;
  noticesSaved: number;
  resultsSaved: number;
  failures: number;
  pagesVisited: number;
  metrics?: CrawlMetrics;
}

export interface ParseDetailContext {
  listItem: ListItemSummary;
  task: CrawlTaskState;
}

export interface CrawlMetrics {
  processedTasks: number;
  succeededTasks: number;
  failedTasks: number;
  retriedTasks: number;
  averageTaskDurationMs: number;
  pageSuccessRate: number;
  taskFailureRate: number;
  siteHealthScore: number;
}

export interface CrawlTaskRecord {
  siteCode: SiteCode;
  bizType: BizType;
  pageNo: number;
  itemIndex: number;
  status: CrawlTaskStatus;
  attempt: number;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  lastError: string | null;
  updatedAt: Date;
}
