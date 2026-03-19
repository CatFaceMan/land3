import type { Page } from "playwright";
import type {
  BizType,
  DetailDocument,
  ListItemSummary,
  NavigationStrategy,
  ParseDetailContext,
  ParsedNoticeRecord,
  ParsedResultRecord,
  SiteCode
} from "../domain/types.js";

export interface SiteAdapter {
  readonly siteCode: SiteCode;
  readonly cityName: string;
  getNavigationStrategy(bizType: BizType): NavigationStrategy;
  getEntryUrl(bizType: BizType): string;
  openEntry(page: Page, bizType: BizType): Promise<void>;
  waitForListReady(page: Page, bizType: BizType): Promise<void>;
  listItems(page: Page, bizType: BizType, pageNo: number): Promise<ListItemSummary[]>;
  openDetail(page: Page, bizType: BizType, itemIndex: number): Promise<Page>;
  parseDetail(page: Page, bizType: BizType, context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]>;
  returnToList(page: Page, bizType: BizType): Promise<Page>;
  gotoPage(page: Page, bizType: BizType, targetPageNo: number): Promise<void>;
  nextPage(page: Page, bizType: BizType, currentPageNo: number): Promise<boolean>;
}

export interface SiteSelectors {
  listReady: string[];
  listItem: string;
  titleLink?: string;
  nextPage: string[];
  detailRoot?: string;
  detailReady: string[];
  detailTitle: string[];
  content: string[];
  attachment: string;
  currentPage?: string;
}

export interface BizConfig {
  entryUrl: string;
  navigationStrategy: NavigationStrategy;
  selectors: SiteSelectors;
  prepareList?(page: Page): Promise<void>;
}

export interface DetailFieldMap {
  noticeNo: string[];
  district: string[];
  landUsage: string[];
  area: string[];
  startPrice: string[];
  noticeDate: string[];
  tradeDate: string[];
  parcelNo: string[];
  dealPrice: string[];
  winner: string[];
  status: string[];
}

export interface GenericSiteConfig {
  siteCode: SiteCode;
  cityName: string;
  notice: BizConfig;
  result: BizConfig;
  fieldMap?: Partial<DetailFieldMap>;
}

export interface ExtractedDetailRecord {
  document: DetailDocument;
  sourceUrl: string;
}
