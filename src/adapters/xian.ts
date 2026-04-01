import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";
import { normalizeHeader } from "../utils/table-parser.js";

const SELECTORS: SiteSelectors = {
  listReady: ["#info-list .ewb-list-node", ".ewb-right #info-list > li.ewb-list-node"],
  listItem: ".ewb-right #info-list > li.ewb-list-node",
  titleLink: "a.ewb-list-name",
  nextPage: [".ewb-page a:text-is('下一页')", ".ewb-page .m-pagination-page li:last-child a"],
  currentPage: ".ewb-page li.active a",
  detailReady: [".article-title", ".epoint-article-content", "body"],
  detailTitle: [".article-title", "title"],
  content: [".epoint-article-content", "body"],
  attachment: "a[href]"
};

const config: GenericSiteConfig = {
  siteCode: "xian",
  cityName: "西安",
  notice: {
    entryUrl: "https://sxggzyjy.xa.gov.cn/jydt/001001/001001002/001001002001/subPage.html",
    navigationStrategy: "return",
    selectors: SELECTORS
  },
  result: {
    entryUrl: "https://sxggzyjy.xa.gov.cn/jydt/001001/001001002/001001002002/subPage.html",
    navigationStrategy: "return",
    selectors: SELECTORS
  }
};


function isValidIsoDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((item) => Number(item));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function safeNormalizeDate(value: string | null | undefined): string | null {
  const normalized = normalizeDate(value);
  return isValidIsoDate(normalized) ? normalized : null;
}

export function stripXianSourcePrefix(value: string | null | undefined): string {
  return cleanText(value).replace(/^(?:【[^】]+】\s*)+/, "");
}

export function extractXianNoticeNo(title: string | null | undefined, text: string | null | undefined): string | null {
  const cleanTitle = stripXianSourcePrefix(title);
  const cleanBody = stripXianSourcePrefix(text);
  return firstNonEmpty(
    cleanBody.match(/[^\s，。；;]*土出告字〔\d{4}〕\d+号(?:-\d+)?/)?.[0],
    cleanTitle.match(/[^\s，。；;]*土出告字〔\d{4}〕\d+号(?:-\d+)?/)?.[0],
    cleanTitle.match(/[^\s，。；;]*土出告字\[\d{4}\]\d+号(?:-\d+)?/)?.[0],
    cleanBody.match(/[^\s，。；;]*土出告字\[\d{4}\]\d+号(?:-\d+)?/)?.[0]
  );
}

export function normalizeXianParcelNo(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  return text.replace(/\s+/g, "").replace(/\s*\[\s*/g, "[").replace(/\s*\]\s*/g, "]");
}

function parseRows(rawRows: string[][], marker: string): { headers: string[]; rows: string[][] } {
  const rows = rawRows.map((row) => row.map((cell) => cleanText(cell))).filter((row) => row.some(Boolean));
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell).includes(normalizeHeader(marker))));
  if (headerIndex < 0) {
    return { headers: [], rows: [] };
  }
  const headers = [...rows[headerIndex], ...(rows[headerIndex + 1] ?? [])].filter(Boolean);
  const dataRows = rows.slice(headerIndex + 1).filter((row) => {
    const joined = row.join(" ");
    if (row.length < 3) return false;
    if (/地块编号|宗地编号|规划用途|竞得人|成交价|序号/.test(joined)) return false;
    // Filter out rows that are just split headers like "绿地率", "建筑系数"
    if (/^(建筑高度|建筑密度|容积率|绿地率|配套设施|建筑系数)$/.test(row[0] || "") || /^(建筑高度|建筑密度|容积率|绿地率|配套设施|建筑系数)$/.test(row[1] || "")) return false;
    return true;
  });
  return { headers, rows: dataRows };
}

class XianSiteAdapter extends ConfiguredHtmlSiteAdapter {
  public constructor() {
    super(config);
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const document = await extractDocument(page, SELECTORS);
    const text = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => "")) || document.contentText;
    const title = cleanText(await page.locator(".article-title").first().textContent().catch(() => null)) || context.listItem.title;
    const sourceUrl = page.url();
    const noticeNoRaw = extractXianNoticeNo(title, text);
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const rawRows = await page.locator("table tr").evaluateAll((nodes) =>
      nodes.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
    );

    if (bizType === "notice") {
      const noticeDate = safeNormalizeDate(firstNonEmpty(
        text.match(/信息时间[:：]\s*([0-9\-\/年.\s月日]+)/)?.[1]
      ));
      const tradeDate = safeNormalizeDate(firstNonEmpty(
        text.match(/挂牌期限为.*?至(\d{4}年\d{1,2}月\d{1,2}日\d{0,2}时?\d{0,2}分?)/)?.[1],
        text.match(/报价截至时间为(\d{4}年\d{1,2}月\d{1,2}日\d{0,2}时?\d{0,2}分?)/)?.[1]
      ));
      const { rows } = parseRows(rawRows, "地块编号");
      if (rows.length === 0) {
        return [
          {
            siteCode: this.siteCode,
            sourceKey: buildStableSourceKey(this.siteCode, "notice", [noticeNoNorm, title, sourceUrl]),
            sourceUrl,
            sourceTitle: context.listItem.title,
            city: this.cityName,
            district: null,
            noticeTitle: title,
            noticeNoRaw,
            noticeNoNorm,
            landUsage: null,
            areaHa: null,
            startPriceWan: null,
            noticeDate,
            tradeDate,
            parcelNo: null,
            contentText: text,
            rawHtml: document.rawHtml,
            attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
            crawlTime: new Date()
          }
        ];
      }
      return rows.map((row, rowIndex) => {
        const parcelNo = normalizeXianParcelNo(row[1] ?? null);
        return ({
        siteCode: this.siteCode,
        sourceKey: buildStableSourceKey(this.siteCode, "notice", [noticeNoNorm, parcelNo, row.join("|"), title, sourceUrl]),
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: row[2]?.split("、")[0] ?? null,
        noticeTitle: title,
        noticeNoRaw,
        noticeNoNorm,
        landUsage: row[3] ?? null,
        areaHa: parseAreaToHectare(row[4] ? `${row[4]}平方米` : null),
        startPriceWan: parseChineseNumber(row[10] ?? row[8] ?? null),
        noticeDate,
        tradeDate,
        parcelNo,
        contentText: text,
        rawHtml: document.rawHtml,
        attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
        crawlTime: new Date()
      });
    });
    }

    const resultTitle = cleanText(await page.locator(".article-title").first().textContent().catch(() => null)) || title;
    const dealDate = safeNormalizeDate(firstNonEmpty(
      text.match(/信息时间[:：]\s*([0-9\-\/年.\s月日]+)/)?.[1]
    ));
    const { rows } = parseRows(rawRows, "宗地编号");
    if (rows.length === 0) {
      return [
        {
          siteCode: this.siteCode,
          sourceKey: buildStableSourceKey(this.siteCode, "result", [noticeNoNorm, resultTitle, sourceUrl]),
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: null,
          resultTitle,
          noticeNoRaw,
          noticeNoNorm,
          dealPriceWan: null,
          winner: null,
          status: null,
          dealDate,
          parcelNo: null,
          contentText: text,
          rawHtml: document.rawHtml,
          attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
          crawlTime: new Date()
        }
      ];
    }
    return rows.map((row, rowIndex) => {
      const parcelNo = normalizeXianParcelNo(row[1] ?? null);
      return ({
      siteCode: this.siteCode,
      sourceKey: buildStableSourceKey(this.siteCode, "result", [noticeNoNorm, parcelNo, row.join("|"), resultTitle, sourceUrl]),
      sourceUrl,
      sourceTitle: context.listItem.title,
      city: this.cityName,
      district: null,
      resultTitle,
      noticeNoRaw,
      noticeNoNorm,
      dealPriceWan: parseChineseNumber(row[3] ?? null),
      winner: row[2] ?? null,
      status: row[2] ? "已成交" : null,
      dealDate,
      parcelNo,
      contentText: text,
      rawHtml: document.rawHtml,
      attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
      crawlTime: new Date()
    });
  });
  }
}

export const xianAdapter = new XianSiteAdapter();
