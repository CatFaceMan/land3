
import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ListItemSummary, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
import { cleanStatus, cleanText, firstNonEmpty } from "../utils/text.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";

const SELECTORS: SiteSelectors = {
  listReady: ["section .source-info-item > a:visible", ".source-info-item > a:visible", "a.expand-card-wrapper.d-block:visible"],
  listItem: "section .source-info-item > a:visible, .source-info-item > a:visible, a.expand-card-wrapper.d-block:visible",
  nextPage: [".ant-pagination-next", ".btn-next"],
  currentPage: ".ant-pagination-item-active",
  detailReady: ["body"],
  detailTitle: ["h1", ".article-title", "title"],
  content: ["body"],
  attachment: "a[href]"
};

function createZhejiangConfig(siteCode: SiteCode, cityName: string): GenericSiteConfig {
  return {
    siteCode,
    cityName,
    notice: {
      entryUrl: "https://www.zjzrzyjy.com/landView/land-bidding",
      navigationStrategy: "return",
      selectors: SELECTORS
    },
    result: {
      entryUrl: "https://www.zjzrzyjy.com/landView/land-bidding",
      navigationStrategy: "return",
      selectors: SELECTORS,
      prepareList: async (page: Page) => {
        await page.locator("span.filter-select-option").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
        const option = page.locator("span.filter-select-option").filter({ hasText: "结果公示" }).first();
        if ((await option.count()) > 0) {
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const firstText = cleanText(
              await page
                .locator("section .source-info-item > a:visible, .source-info-item > a:visible, a.expand-card-wrapper.d-block:visible")
                .first()
                .textContent()
                .catch(() => null)
            );
            if (firstText && !firstText.startsWith("公告期")) {
              return;
            }
            await option.click().catch(() => undefined);
            await page.waitForTimeout(1_500);
          }
        }
      }
    }
  };
}

function matchValue(text: string, label: string, terminators: string[]): string | null {
  const index = text.indexOf(label);
  if (index < 0) {
    return null;
  }
  const start = index + label.length;
  let end = text.length;
  for (const token of terminators) {
    const tokenIndex = text.indexOf(token, start);
    if (tokenIndex >= 0 && tokenIndex < end) {
      end = tokenIndex;
    }
  }
  return cleanText(text.slice(start, end));
}

function parseStartPriceWan(text: string, areaHa: number | null): number | null {
  const raw = firstNonEmpty(
    matchValue(text, "竞地价起始价：", ["竞地价增价幅度：", "温馨提示", "交易信息"]),
    matchValue(text, "起始价：", ["保证金", "距挂牌开始时间", "距保证金交纳截止时间"])
  );
  if (!raw) {
    return null;
  }
  if (/元\/平方米|元\/建筑平方米/.test(raw) && areaHa && areaHa > 0) {
    const unitPrice = Number(raw.match(/\d+(?:\.\d+)?/)?.[0] ?? "");
    return Number.isFinite(unitPrice) && unitPrice > 0 ? Number((unitPrice * areaHa).toFixed(2)) : null;
  }
  return parseChineseNumber(raw);
}

function parsePriceWan(raw: string | null | undefined, areaHa: number | null): number | null {
  if (!raw) {
    return null;
  }
  if (/元\/平方米|元\/建筑平方米/.test(raw) && areaHa && areaHa > 0) {
    const unitPrice = Number(raw.match(/\d+(?:\.\d+)?/)?.[0] ?? "");
    return Number.isFinite(unitPrice) && unitPrice > 0 ? Number((unitPrice * areaHa).toFixed(2)) : null;
  }
  if (/元\/平方米|元\/建筑平方米/.test(raw)) {
    return null;
  }
  return parseChineseNumber(raw);
}

type ZhejiangResourceDetailResponse = {
  data?: {
    subRegion?: string | null;
    administrativeRegioncode?: string | null;
  } | null;
};

export function extractZhejiangNoticeNo(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  return text.match(/[^\s，。；;]*?(?:告字|告)[\[({〔【]?\d{4}[\])}〕】]?(?:[A-Za-z]+\d+|\d+)(?:-\d+)?号?/i)?.[0] ?? null;
}

function extractResourceId(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).searchParams.get("resourceId");
  } catch {
    return null;
  }
}

export function isZhejiangTargetRegion(subRegion: string | null | undefined, administrativeRegion: string | null | undefined): boolean {
  const regionCode = cleanText(subRegion);
  if (regionCode.startsWith("3301") || regionCode.startsWith("3302")) {
    return true;
  }
  const regionText = cleanText(administrativeRegion);
  return regionText.includes("杭州") || regionText.includes("宁波");
}

export async function extractZhejiangAnnouncementText(page: Page): Promise<string> {
  const tab = page.locator(".ant-tabs-tab, [role='tab']").filter({ hasText: "公告信息" }).first();
  if ((await tab.count().catch(() => 0)) > 0) {
    await tab.click().catch(() => undefined);
    await page.waitForTimeout(200);
  }

  const activePaneText = cleanText(await page.locator(".ant-tabs-tabpane-active").first().textContent().catch(() => null));
  if (activePaneText) {
    return activePaneText;
  }

  const text = await page
    .evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(".ant-tabs-tabpane, [role='tabpanel']"));
      const target = nodes.find((node) => {
        const t = node.textContent || "";
        return /挂牌出让公告|公告信息/.test(t);
      });
      return target?.textContent || "";
    })
    .catch(() => "");
  return cleanText(text);
}

export function extractZhejiangDistrict(text: string, summary: string | null | undefined): string | null {
  return firstNonEmpty(
    text.match(/地块所在区域：\s*([^\s]+?)\s*(?:出让面积：|土地主用途：|土地用途明细：)/)?.[1],
    text.match(/所属行政区：\s*([^\s]+?)\s*地块所在区域：/)?.[1],
    cleanText(summary).split("|")[0].match(/([^\s|]+市)/)?.[1]
  );
}

class ZhejiangSiteAdapter extends ConfiguredHtmlSiteAdapter {
  private currentItems: ListItemSummary[] = [];
  private lastPageNo = 1;

  public constructor(siteCode: SiteCode, cityName: string, private readonly filterKeyword: string) {
    super(createZhejiangConfig(siteCode, cityName));
  }

  public override async listItems(page: Page, bizType: "notice" | "result", pageNo: number): Promise<ListItemSummary[]> {
    this.lastPageNo = pageNo;
    const nodes = page.locator(SELECTORS.listItem);
    const count = await nodes.count();
    const items: ListItemSummary[] = [];
    for (let index = 0; index < count; index += 1) {
      const node = nodes.nth(index);
      const title = cleanText(await node.textContent()) || `item-${index + 1}`;
      const href = await node.getAttribute("href");
      items.push({
        title,
        url: href ? new URL(href, page.url()).toString() : null,
        pageNo,
        itemIndex: index
      });
    }

    // Store ALL items so we can process them (skip or parse) later
    // This prevents the crawler from stopping if the first page has no matching items
    this.currentItems = items;
    return items;
  }

  private shouldSkip(item: ListItemSummary): boolean {
    const hasResourceId = Boolean(extractResourceId(item.url));
    const matchesCity = item.title.includes(this.filterKeyword);
    return !(hasResourceId && matchesCity);
  }

  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    this.listPage = page;
    const cachedItem = this.currentItems[itemIndex];
    if (this.shouldSkip(cachedItem)) {
      return page; // Skip navigation for non-matching items
    }

    const url = cachedItem?.url ?? null;
    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await Promise.any([
        page.locator(".info-right").first().waitFor({ state: "visible", timeout: 15_000 }),
        page.locator(".progressBar-item-content").first().waitFor({ state: "visible", timeout: 15_000 }),
        page.locator("text=地块编号（宗地编码）").first().waitFor({ state: "visible", timeout: 15_000 })
      ]).catch(() => undefined);
      await page.waitForTimeout(1_000);
      return page;
    }
    return super.openDetail(page, bizType, itemIndex);
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    if (this.shouldSkip(context.listItem)) {
      return []; // Skip parsing for non-matching items
    }

    const document = await extractDocument(page, SELECTORS);
    const liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
    const liveHtml = await page.content().catch(() => document.rawHtml);
    const attachments = await page.locator("a[href]").evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const element = node as HTMLAnchorElement;
          return {
            text: (element.textContent || "").replace(/\s+/g, " ").trim(),
            url: element.href || element.getAttribute("href") || ""
          };
        })
        .filter((item) => item.url)
    ).catch(() => document.attachments);
    const sourceUrl = page.url();
    const text = liveText || cleanText(document.contentText);
    const announcementText = await extractZhejiangAnnouncementText(page);
    const summary = cleanText(context.listItem.title);
    const rightText = cleanText(await page.locator(".info-right").first().textContent().catch(() => null));
    const infoItems = await page.locator(".info-item").evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
    ).catch(() => [] as string[]);
    const progressItems = await page.locator(".progressBar-item-content").evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
    ).catch(() => [] as string[]);
    const parcelNo = firstNonEmpty(
      text.match(/地块编号（宗地编码）：\s*([^地]+?)\s*地块名称：/)?.[1],
      summary.match(/#([^#|]+?)(?:保证金到账截止时间|起始价|挂牌时间|拍卖时间|拍卖开始|$)/)?.[1]
    );
    const district = extractZhejiangDistrict(text, summary);
    const areaHa = parseAreaToHectare(matchValue(text, "出让面积：", ["土地主用途：", "土地用途明细："]));
    const landUsage = firstNonEmpty(
      text.match(/土地主用途：\s*([^土]+?)\s*土地用途明细：/)?.[1],
      summary.match(/(住宅用地|商服用地|商务金融用地|商业服务业设施用地|一类工业用地（其他工业用地）|二类工业用地（其他工业用地）|二类工业用地|一类物流仓储用地（通用仓储类）|一类物流仓储用地|商务金融用地|工业用地)/)?.[1]
    );
    const noticeArea = areaHa ?? parseAreaToHectare(summary.match(/出让面积([0-9.]+平方米\[[0-9.]+亩\])/)?.[1] ?? null);
    const noticeDate = normalizeDate(firstNonEmpty(
      infoItems.find((item) => item.includes("发布时间："))?.split("发布时间：")[1],
      text.match(/发布时间：\s*([0-9-]+)/)?.[1],
      progressItems.find((item) => item.startsWith("公告发布"))?.replace("公告发布", "")
    ));
    const tradeDate = normalizeDate(firstNonEmpty(
      progressItems.find((item) => item.startsWith("挂牌截止"))?.replace("挂牌截止", ""),
      progressItems.find((item) => item.startsWith("拍卖开始"))?.replace("拍卖开始", ""),
      text.match(/挂牌截止时间：\s*([0-9年月日时分秒:\-\s]+)/)?.[1],
      text.match(/拍卖开始时间：\s*([0-9年月日时分秒:\-\s]+)/)?.[1],
      summary.match(/挂牌时间[0-9年月日时分秒:\-\s]+([0-9]{4}年[0-9]{2}月[0-9]{2}日 [0-9]{2}时[0-9]{2}分[0-9]{2}秒)/)?.[1],
      summary.match(/拍卖时间([0-9]{4}年[0-9]{2}月[0-9]{2}日 [0-9]{2}时[0-9]{2}分[0-9]{2}秒)/)?.[1]
    ));
    const topStatus = firstNonEmpty(
      rightText.match(/^(成交|终止|中止|流拍|补终止|结果公示)/)?.[1],
      text.match(/(?:现场照片\(1\)|现场照片)\s*([^\s]+)\s*[^资]/)?.[1],
      text.match(/(公告期|挂牌期|竞价期|交易结束|结果公示|终止|已成交)/)?.[1]
    );
    const noticeNoRaw = firstNonEmpty(
      extractZhejiangNoticeNo(announcementText),
      extractZhejiangNoticeNo(text),
      cleanText(parcelNo) || null
    );
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
    const sourceKey = buildStableSourceKey(this.siteCode, bizType, [noticeNoNorm, parcelNo, sourceUrl]);
    const startPriceWan = firstNonEmpty(
      String(parsePriceWan(matchValue(text, "竞地价起始价：", ["竞地价增价幅度：", "温馨提示", "交易信息"]), noticeArea) ?? ""),
      String(parsePriceWan(matchValue(text, "起始价：", ["保证金", "距挂牌开始时间", "距保证金交纳截止时间"]), noticeArea) ?? ""),
      String(parsePriceWan(rightText.match(/起始价\s*([0-9.]+(?:万元|元\/平方米|元\/建筑平方米))/)?.[1], noticeArea) ?? ""),
      String(parseChineseNumber(summary.match(/起始价([0-9.]+万元)/)?.[1]) ?? "")
    );

    if (bizType === "notice") {
      return [
        {
          siteCode: this.siteCode,
          sourceKey,
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: district ?? null,
          noticeTitle: parcelNo || context.listItem.title,
          noticeNoRaw,
          noticeNoNorm,
          landUsage: landUsage ?? null,
          areaHa: noticeArea,
          startPriceWan: startPriceWan ? Number(startPriceWan) : null,
          noticeDate,
          tradeDate,
          parcelNo: parcelNo ?? null,
          contentText: text,
          rawHtml: liveHtml,
          attachmentsJson,
          crawlTime: new Date()
        }
      ];
    }

    const winner = firstNonEmpty(
      rightText.match(/竞得单位：\s*(.+?)(?:\s*成交时间：|\s*我要收藏|\s*$)/)?.[1],
      matchValue(text, "竞得人：", ["成交价：", "成交时间：", "交易状态："]),
      matchValue(text, "竞得单位：", ["成交价：", "成交时间：", "交易状态："]),
      matchValue(text, "受让人：", ["成交价：", "成交时间：", "交易状态："])
    );
    const dealDate = normalizeDate(firstNonEmpty(
      rightText.match(/成交时间：\s*([0-9:\-\s]+)/)?.[1],
      matchValue(text, "成交时间：", ["竞得人：", "交易状态：", "暂无数据"]),
      matchValue(text, "成交日期：", ["竞得人：", "交易状态：", "暂无数据"])
    ));
    const statusRaw = firstNonEmpty(
      rightText.match(/^(成交|终止|中止|流拍|补终止)/)?.[1],
      matchValue(text, "交易状态：", ["竞得人：", "成交价：", "成交时间："]),
      summary.match(/^(补|终止|结果公示|已成交|成交|流拍)/)?.[1],
      text.includes("暂无数据") ? "暂无结果" : null,
      topStatus
    );
    const status = cleanStatus(statusRaw);
    const dealPriceRaw = firstNonEmpty(
      rightText.match(/成交价\s*([0-9.]+万元)/)?.[1],
      text.match(/成交价[:：]?\s*([0-9.]+万元)/)?.[1],
      summary.match(/成交价([0-9.]+万元)/)?.[1],
      rightText.match(/成交价\s*([0-9.]+(?:元\/平方米|元\/建筑平方米))/)?.[1],
      matchValue(text, "成交价：", ["竞得人：", "成交时间：", "交易状态："])
    );

    return [
      {
        siteCode: this.siteCode,
        sourceKey,
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: district ?? null,
        resultTitle: parcelNo || context.listItem.title,
        noticeNoRaw,
        noticeNoNorm,
        dealPriceWan: parsePriceWan(dealPriceRaw, noticeArea),
        winner: winner ?? null,
        status: status === "成交" ? "已成交" : status ?? null,
        dealDate,
        parcelNo: parcelNo ?? null,
        contentText: text,
        rawHtml: liveHtml,
        attachmentsJson,
        crawlTime: new Date()
      }
    ];
  }

  public override async returnToList(page: Page, bizType: "notice" | "result"): Promise<Page> {
    if (this.listPage && page !== this.listPage) {
      if (!page.isClosed()) {
        await page.close().catch(() => undefined);
      }
      return this.listPage;
    }

    if (page.url().includes("landView/land-bidding")) {
      try {
        await page.locator(SELECTORS.listItem).first().waitFor({ state: "visible", timeout: 3000 });
        return page;
      } catch {
        // Fall through
      }
    }

    const isList = await page.locator(SELECTORS.listItem).first().isVisible().catch(() => false);
    if (isList) {
      return page;
    }

    await page.goBack({ waitUntil: "domcontentloaded" });
    if (page.url().includes("landView/land-bidding")) {
      try {
        await page.locator(SELECTORS.listItem).first().waitFor({ state: "visible", timeout: 3000 });
        return page;
      } catch {
        // Fall through
      }
    }

    await this.openEntry(page, bizType);
    if (this.lastPageNo > 1) {
      await this.gotoPage(page, bizType, this.lastPageNo);
    }
    return page;
  }
}

export const zhejiangAdapter = new ZhejiangSiteAdapter("hangzhou", "杭州", "杭州");
export const hangzhouAdapter = new ZhejiangSiteAdapter("hangzhou", "杭州", "杭州");
export const ningboAdapter = new ZhejiangSiteAdapter("ningbo", "宁波", "宁波");
