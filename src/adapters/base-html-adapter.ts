import { load, type CheerioAPI } from "cheerio";
import type { Page } from "playwright";
import type {
  BizType,
  DetailDocument,
  ListItemSummary,
  ParseDetailContext,
  ParsedNoticeRecord,
  ParsedResultRecord
} from "../domain/types.js";
import { waitForAny } from "../utils/browser-utils.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { cleanStatus, cleanText, firstNonEmpty } from "../utils/text.js";
import type { DetailFieldMap, GenericSiteConfig, SiteAdapter, SiteSelectors } from "./site-adapter.js";

const DEFAULT_WAIT_TIMEOUT_MS = 60_000;

const DEFAULT_FIELDS: DetailFieldMap = {
  noticeNo: ["公告号", "地块公告号", "编号", "公告编号", "出让公告号"],
  district: ["区县", "行政区", "所属区县"],
  landUsage: ["土地用途", "规划用途", "用地性质"],
  area: ["面积", "出让面积", "土地面积"],
  startPrice: ["起始价", "起拍价", "挂牌起始价"],
  noticeDate: ["公告时间", "公告日期", "发布时间"],
  tradeDate: ["交易日期", "成交时间", "成交日期"],
  parcelNo: ["宗地编号", "地块编号", "宗地号"],
  dealPrice: ["成交价", "成交金额", "总成交价"],
  winner: ["竞得人", "竞得单位", "受让人"],
  status: ["交易状态", "成交结果", "状态"]
};


export function readField(fields: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    for (const [key, value] of Object.entries(fields)) {
      if (key.includes(name)) {
        return value;
      }
    }
  }
  return null;
}

function toAbsoluteUrl(href: string | null, baseUrl: string): string | null {
  if (!href) {
    return null;
  }
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("#")) {
    return null;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractTables($: CheerioAPI): Array<Record<string, string>> {
  const tables: Array<Record<string, string>> = [];
  $("table").each((_, table) => {
    const rows: Record<string, string> = {};
    $(table)
      .find("tr")
      .each((__, tr) => {
        const cells = $(tr)
          .find("th,td")
          .map((___, cell) => cleanText($(cell).text()))
          .get()
        if (cells.length >= 2) {
          for (let index = 0; index < cells.length - 1; index += 2) {
            rows[cells[index]] = cells[index + 1];
          }
        }
      });
    if (Object.keys(rows).length > 0) {
      tables.push(rows);
    }
  });
  return tables;
}

export async function extractDocument(page: Page, selectors: SiteSelectors): Promise<DetailDocument> {
  await waitForAny(page, selectors.detailReady, {
    timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
    stage: "detail_ready",
    url: page.url()
  });
  const rawHtml = selectors.detailRoot
    ? await page.locator(selectors.detailRoot).first().evaluate((element) => element.outerHTML)
    : await page.content();
  const $ = load(rawHtml);
  const title = firstNonEmpty(...selectors.detailTitle.map((selector) => cleanText($(selector).first().text()))) ?? cleanText($("title").text());
  const leadDateText = firstNonEmpty(cleanText($(".rtdata").first().text()), cleanText($("time").first().text()));
  const contentText =
    firstNonEmpty(...selectors.content.map((selector) => cleanText($(selector).first().text()))) ?? cleanText($("body").text());
  const attachments = $(selectors.attachment)
    .map((_, element) => ({
      text: cleanText($(element).text()),
      url: $(element).attr("href") ?? ""
    }))
    .get()
    .filter((item) => item.url);
  return {
    title: title ?? "",
    leadDateText,
    contentText,
    rawHtml,
    tables: extractTables($).map((rows) => ({ rows: [rows] })),
    attachments
  };
}

export class ConfiguredHtmlSiteAdapter implements SiteAdapter {
  protected listPage: Page | null = null;

  public constructor(protected readonly config: GenericSiteConfig) {}

  public get siteCode() {
    return this.config.siteCode;
  }

  public get cityName() {
    return this.config.cityName;
  }

  public getNavigationStrategy(bizType: BizType) {
    return this.getBizConfig(bizType).navigationStrategy;
  }

  public getEntryUrl(bizType: BizType): string {
    return this.getBizConfig(bizType).entryUrl;
  }

  public async openEntry(page: Page, bizType: BizType): Promise<void> {
    this.listPage = page;
    const biz = this.getBizConfig(bizType);
    await page.goto(biz.entryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (biz.prepareList) {
      await biz.prepareList(page);
    }
    await this.waitForListReady(page, bizType);
  }

  public async waitForListReady(page: Page, bizType: BizType): Promise<void> {
    await waitForAny(page, this.getBizConfig(bizType).selectors.listReady, {
      timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
      stage: "list_ready",
      url: page.url()
    });
  }

  public async listItems(page: Page, bizType: BizType, pageNo: number): Promise<ListItemSummary[]> {
    const selectors = this.getBizConfig(bizType).selectors;
    const nodes = page.locator(selectors.listItem);
    let count = await nodes.count();
    for (let attempt = 0; count === 0 && attempt < 3; attempt += 1) {
      await page.waitForTimeout(1_500);
      count = await nodes.count();
    }
    const items: ListItemSummary[] = [];
    for (let index = 0; index < count; index += 1) {
      const node = nodes.nth(index);
      const link = selectors.titleLink ? node.locator(selectors.titleLink).first() : null;
      const hasLink = link ? (await link.count()) > 0 : false;
      const title = hasLink ? cleanText(await link!.textContent()) || cleanText(await node.textContent()) : cleanText(await node.textContent());
      const rawUrl = hasLink ? await link!.getAttribute("href") : null;
      const url = toAbsoluteUrl(rawUrl, page.url());
      items.push({ title: title || `item-${index + 1}`, url, pageNo, itemIndex: index });
    }
    return items;
  }

  public async openDetail(page: Page, bizType: BizType, itemIndex: number): Promise<Page> {
    const selectors = this.getBizConfig(bizType).selectors;
    this.listPage = page;
    const item = page.locator(selectors.listItem).nth(itemIndex);
    const clickTarget = selectors.titleLink ? item.locator(selectors.titleLink).first() : item;
    const popupPromise = page.context().waitForEvent("page", { timeout: 2500 }).catch(() => null);
    await clickTarget.click();
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded");
      return popup;
    }
    await page.waitForLoadState("domcontentloaded");
    return page;
  }

  public async parseDetail(page: Page, bizType: BizType, context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const document = await extractDocument(page, this.getBizConfig(bizType).selectors);
    const fields = this.extractFields(document);
    const sourceUrl = page.url();
    const attachmentsJson = document.attachments.length > 0 ? JSON.stringify(document.attachments) : null;
    const sourceKey = `${context.task.pageNo}:${context.task.itemIndex}:${normalizeNoticeNo(fields.noticeNo) ?? sourceUrl}`;

    if (bizType === "notice") {
      return [
        {
          siteCode: this.siteCode,
          sourceKey,
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: fields.district,
          noticeTitle: document.title || context.listItem.title,
          noticeNoRaw: fields.noticeNo,
          noticeNoNorm: normalizeNoticeNo(fields.noticeNo),
          landUsage: fields.landUsage,
          areaHa: parseAreaToHectare(fields.area),
          startPriceWan: parseChineseNumber(fields.startPrice),
          noticeDate: normalizeDate(fields.noticeDate),
          tradeDate: normalizeDate(fields.tradeDate),
          parcelNo: fields.parcelNo,
          contentText: document.contentText,
          rawHtml: document.rawHtml,
          attachmentsJson,
          crawlTime: new Date()
        }
      ];
    }

    return [
      {
        siteCode: this.siteCode,
        sourceKey,
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: fields.district,
        resultTitle: document.title || context.listItem.title,
        noticeNoRaw: fields.noticeNo,
        noticeNoNorm: normalizeNoticeNo(fields.noticeNo),
        dealPriceWan: parseChineseNumber(fields.dealPrice),
        winner: fields.winner,
        status: fields.status,
        dealDate: normalizeDate(fields.tradeDate),
        parcelNo: fields.parcelNo,
        contentText: document.contentText,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      }
    ];
  }

  public async returnToList(page: Page, bizType: BizType): Promise<Page> {
    if (this.getNavigationStrategy(bizType) === "return") {
      if (this.listPage && page !== this.listPage) {
        await page.close().catch(() => undefined);
        await this.listPage.bringToFront().catch(() => undefined);
        await this.waitForListReady(this.listPage, bizType);
        return this.listPage;
      }
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
      await this.waitForListReady(page, bizType);
      return page;
    }
    return this.listPage ?? page;
  }

  public async gotoPage(page: Page, bizType: BizType, targetPageNo: number): Promise<void> {
    await this.openEntry(page, bizType);
    for (let currentPageNo = 1; currentPageNo < targetPageNo; currentPageNo += 1) {
      const moved = await this.nextPage(page, bizType, currentPageNo);
      if (!moved) {
        throw new Error(`Unable to reach page ${targetPageNo}`);
      }
    }
  }

  public async nextPage(page: Page, bizType: BizType, currentPageNo: number): Promise<boolean> {
    const selectors = this.getBizConfig(bizType).selectors;
    for (const selector of selectors.nextPage) {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) {
        continue;
      }
      const before = selectors.currentPage ? cleanText(await page.locator(selectors.currentPage).first().textContent()) : String(currentPageNo);
      await button.click();
      await this.waitForListReady(page, bizType);
      const after = selectors.currentPage ? cleanText(await page.locator(selectors.currentPage).first().textContent()) : "";
      return !selectors.currentPage || before !== after;
    }
    return false;
  }

  private getBizConfig(bizType: BizType) {
    return bizType === "notice" ? this.config.notice : this.config.result;
  }

  private extractFields(document: DetailDocument): Record<keyof DetailFieldMap, string | null> {
    const mergedRows: Record<string, string> = {};
    for (const table of document.tables) {
      for (const row of table.rows) {
        Object.assign(mergedRows, row);
      }
    }
    const fieldMap = { ...DEFAULT_FIELDS, ...(this.config.fieldMap ?? {}) };
    const text = document.contentText;
    return {
      noticeNo: readField(mergedRows, fieldMap.noticeNo) ?? text.match(/[^\s，。；;]*告字[([{〔【]?\d{4}[)\]〕】]?\d+号?/)?.[0] ?? null,
      district: readField(mergedRows, fieldMap.district),
      landUsage: readField(mergedRows, fieldMap.landUsage),
      area: readField(mergedRows, fieldMap.area),
      startPrice: readField(mergedRows, fieldMap.startPrice),
      noticeDate: readField(mergedRows, fieldMap.noticeDate) ?? document.leadDateText,
      tradeDate: readField(mergedRows, fieldMap.tradeDate),
      parcelNo: readField(mergedRows, fieldMap.parcelNo),
      dealPrice: readField(mergedRows, fieldMap.dealPrice),
      winner: readField(mergedRows, fieldMap.winner),
      status: cleanStatus(readField(mergedRows, fieldMap.status))
    };
  }
}
