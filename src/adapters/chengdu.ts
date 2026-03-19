import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ListItemSummary, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";
import { clickFirstVisible } from "../utils/browser-utils.js";
import { normalizeHeader, findHeaderIndex } from "../utils/table-parser.js";

const SELECTORS: SiteSelectors = {
  listReady: [".right-list", ".list-content .list-row", "body"],
  listItem: ".list-content .list-row",
  titleLink: ".list-item-title",
  nextPage: [".layui-laypage-next", ".pagination-box a[title='下一页']"],
  detailReady: [".detail-title", ".content-box", "body"],
  detailTitle: [".detail-title", "title"],
  content: [".content-box", "body"],
  attachment: "a[href]"
};


const config: GenericSiteConfig = {
  siteCode: "chengdu",
  cityName: "成都",
  notice: {
    entryUrl: "https://www.cdggzy.com/sitenew/notice/LandTrade/List.aspx",
    navigationStrategy: "return",
    selectors: SELECTORS
  },
  result: {
    entryUrl: "https://www.cdggzy.com/sitenew/notice/LandTrade/List.aspx",
    navigationStrategy: "return",
    selectors: SELECTORS,
    prepareList: async (page: Page) => {
      await clickFirstVisible(page, [".options-type .options-item[data-val='2']", "text=结果公告"]);
      await page.waitForTimeout(1200);
    }
  }
};


function parseRows(rawRows: string[][], marker: string): { headers: string[]; rows: string[][] } {
  const rows = rawRows.map((row) => row.map((cell) => cleanText(cell))).filter((row) => row.some(Boolean));
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell).includes(normalizeHeader(marker))));
  if (headerIndex < 0) {
    return { headers: [], rows: [] };
  }
  const headers = [...rows[headerIndex], ...(rows[headerIndex + 1] ?? [])].filter(Boolean);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => {
    const joined = row.join(" ");
    // Filter out rows that are just headers, completely empty, or have too few columns.
    // Also explicitly filter out rows that only contain words like "建筑高度", "建筑密度" which indicates split sub-rows.
    if (row.length < 3) return false;
    if (/宗地编号|土地位置|规划用途|出让面积|起始价|竞得人|成交价|公告编号/.test(joined)) return false;
    if (/^(建筑高度|建筑密度|容积率|绿地率|配套设施)$/.test(row[0] || "") || /^(建筑高度|建筑密度|容积率|绿地率|配套设施)$/.test(row[1] || "")) return false;
    
    // Valid rows usually have a parcel number in the second or third column, which shouldn't be "建筑高度" etc.
    return true;
  });
  return { headers, rows: dataRows };
}

function parsePriceByMu(raw: string | null, areaMuRaw: string | null): number | null {
  if (!raw || !areaMuRaw) {
    return null;
  }
  if (/元\/平方米|楼面地价/.test(raw)) {
    return null;
  }
  const price = Number(raw.match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  const areaMatches = areaMuRaw.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const areaMu = Number(areaMatches.length > 1 ? areaMatches[areaMatches.length - 1] : areaMatches[0] ?? "");
  if (!Number.isFinite(price) || !Number.isFinite(areaMu)) {
    return null;
  }
  const total = /万元\/亩/.test(raw) ? price * areaMu : /元\/亩/.test(raw) ? (price * areaMu) / 10000 : price * areaMu;
  return Number(total.toFixed(4));
}

function parseChengduAreaHa(raw: string | null): number | null {
  if (!raw) {
    return null;
  }
  const areaMatches = raw.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (raw.includes("亩") && areaMatches.length > 0) {
    return parseAreaToHectare(`${areaMatches[areaMatches.length - 1]}亩`);
  }
  if (raw.includes("平方米") && areaMatches.length > 0) {
    return parseAreaToHectare(`${areaMatches[0]}平方米`);
  }
  return parseAreaToHectare(raw);
}

function parseChengduStartPriceWan(raw: string | null, areaRaw: string | null): number | null {
  if (!raw) {
    return null;
  }
  if (/楼面地价|元\/平方米/.test(raw)) {
    return null;
  }
  if (/亩/.test(raw)) {
    return parsePriceByMu(raw, areaRaw);
  }
  return parseChineseNumber(raw);
}

function normalizeNoticeRow(row: string[], previousTradeDate: string | null): { row: string[]; tradeDateText: string | null } {
  if (row.length >= 14) {
    return { row, tradeDateText: row[7] ?? null };
  }
  if (row.length === 13 && previousTradeDate) {
    const normalized = [...row.slice(0, 7), previousTradeDate, ...row.slice(7)];
    return { row: normalized, tradeDateText: previousTradeDate };
  }
  return { row, tradeDateText: row[7] ?? previousTradeDate ?? null };
}

function parseMetaPubDate(rawHtml: string): string | null {
  return normalizeDate(rawHtml.match(/<meta[^>]+name=["']PubDate["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null);
}

class ChengduSiteAdapter extends ConfiguredHtmlSiteAdapter {
  private currentItems: ListItemSummary[] = [];

  public constructor() {
    super(config);
  }

  public override async listItems(page: Page, bizType: "notice" | "result", pageNo: number): Promise<ListItemSummary[]> {
    const nodes = page.locator(SELECTORS.listItem);
    const count = await nodes.count();
    const items: ListItemSummary[] = [];
    for (let index = 0; index < count; index += 1) {
      const node = nodes.nth(index);
      const titleNode = node.locator(".list-item-title").first();
      const title = cleanText(await titleNode.textContent()) || cleanText(await node.textContent()) || `item-${index + 1}`;
      const href = await titleNode.getAttribute("href");
      const onclick = await titleNode.getAttribute("onclick");
      const url = href
        ? new URL(href, page.url()).toString()
        : onclick?.match(/window\.open\('([^']+)'\)/)?.[1]
          ? new URL(onclick.match(/window\.open\('([^']+)'\)/)![1], page.url()).toString()
          : null;
      const isNotice = /公告/.test(title) && !/结果|一览表/.test(title);
      const isResult = /结果|一览表/.test(title);
      if ((bizType === "notice" && isNotice) || (bizType === "result" && isResult)) {
        items.push({ title, url, pageNo, itemIndex: index });
      }
    }
    this.currentItems = items;
    return items;
  }

  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    const cached = this.currentItems[itemIndex];
    if (cached?.url) {
      const url = new URL(cached.url, page.url()).toString();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(800);
      return page;
    }
    return super.openDetail(page, bizType, itemIndex);
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const document = await extractDocument(page, SELECTORS);
    const text = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => "")) || document.contentText;
    const sourceUrl = page.url();
    const title = cleanText(await page.locator(".detail-title").first().textContent().catch(() => null)) || context.listItem.title;
    const noticeDate = normalizeDate(firstNonEmpty(
      text.match(/日期[:：]\s*([0-9\-\/年.\s月日]+)/)?.[1]
    ));
    const metaPubDate = parseMetaPubDate(document.rawHtml);
    const attachmentsJson = document.attachments.length > 0 ? JSON.stringify(document.attachments) : null;
    const rawRows = await page.locator("table tr").evaluateAll((nodes) =>
      nodes.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
    );

    if (bizType === "notice") {
      const noticeNoRaw = firstNonEmpty(
        title.match(/成公资土(?:拍|挂)告\(\d{4}\)\d+号/)?.[0],
        text.match(/成公资土(?:拍|挂)告\(\d{4}\)\d+号/)?.[0]
      );
      const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
      const { rows } = parseRows(rawRows, "宗地编号");
      let previousTradeDate: string | null = null;
      return rows.map((rawRow, rowIndex) => {
        const { row, tradeDateText } = normalizeNoticeRow(rawRow, previousTradeDate);
        previousTradeDate = tradeDateText;
        const parcelNo = row[1] ?? null;
        const areaRaw = row[3] ?? null;
        const usageRaw = row[4] ?? null;
        const startPriceRaw = row[5] ?? null;
        const tradeDateRaw = row[7] ?? null;
        return {
          siteCode: this.siteCode,
          sourceKey: `${context.task.pageNo}:${context.task.itemIndex}:${rowIndex}:${noticeNoNorm ?? parcelNo ?? sourceUrl}`,
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: row[2]?.split("，")[0] ?? null,
          noticeTitle: title,
          noticeNoRaw: noticeNoRaw ?? parcelNo,
          noticeNoNorm,
          landUsage: usageRaw,
          areaHa: parseChengduAreaHa(areaRaw),
          startPriceWan: parseChengduStartPriceWan(startPriceRaw, areaRaw),
          noticeDate,
          tradeDate: normalizeDate(tradeDateRaw),
          parcelNo,
          contentText: text,
          rawHtml: document.rawHtml,
          attachmentsJson,
          crawlTime: new Date()
        };
      });
    }

    const noticeNoRaw = firstNonEmpty(
      title.match(/\(\d{4}年\d{2}月\d{2}日到\d{4}年\d{2}月\d{2}日\)/)?.[0],
      title.match(/挂牌会结果一览表\([^)]+\)/)?.[0]
    );
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const { rows } = parseRows(rawRows, "宗地编号");
    return rows.map((row, rowIndex) => {
      const parcelNo = row[1] ?? null;
      const areaRaw = row[3] ?? null;
      const dealPriceRaw = row[5] ?? null;
      const winner = row[6] ?? null;
      return {
        siteCode: this.siteCode,
        sourceKey: `${context.task.pageNo}:${context.task.itemIndex}:${rowIndex}:${noticeNoNorm ?? parcelNo ?? sourceUrl}`,
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: row[2]?.split("，")[0] ?? null,
        resultTitle: title,
        noticeNoRaw: noticeNoRaw ?? parcelNo,
        noticeNoNorm,
        dealPriceWan: /平方米/.test(dealPriceRaw ?? "") ? null : parsePriceByMu(dealPriceRaw, areaRaw) ?? parseChineseNumber(dealPriceRaw),
        winner,
        status: winner ? "已成交" : null,
        dealDate: metaPubDate,
        parcelNo,
        contentText: text,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      };
    });
  }
}

export const chengduAdapter = new ChengduSiteAdapter();
