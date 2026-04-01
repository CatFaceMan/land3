import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";
import { findHeaderIndex } from "../utils/table-parser.js";

const SELECTORS: SiteSelectors = {
  listReady: [".el-table__body tbody tr .title", ".el-table__body tbody tr"],
  listItem: ".list a, .el-table__body tbody tr",
  titleLink: "td:nth-child(2) .title",
  nextPage: [".next", ".btn-next"],
  detailReady: [".detail .title", ".detail-content", "body"],
  detailTitle: [".detail .title", "title"],
  content: [".detail-content", ".detail", "body"],
  attachment: "a[href]"
};

const config: GenericSiteConfig = {
  siteCode: "wuhan",
  cityName: "武汉",
  notice: {
    entryUrl: "https://www.whtdsc.com/transaction/letNotice",
    navigationStrategy: "reopen",
    selectors: SELECTORS
  },
  result: {
    entryUrl: "https://www.whtdsc.com/transaction/transactionInformation",
    navigationStrategy: "reopen",
    selectors: SELECTORS
  }
};


function parseRows(rawRows: string[][]): { headers: string[]; rows: string[][] } {
  const normalized = rawRows
    .map((row) => row.map((cell) => cleanText(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
  const headerIndex = normalized.findIndex((row) => row.some((cell) => cell.includes("地块编号")));
  if (headerIndex < 0) {
    return { headers: [], rows: [] };
  }
  const headers = normalized[headerIndex];
  const rows = normalized
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.length > 0))
    .filter((row) => row.some((cell) => /号/.test(cell) || /[A-Za-z]\(/.test(cell)));
  return { headers, rows };
}

export function extractWuhanNoticeNo(detailTitle: string | null | undefined, text: string | null | undefined): string | null {
  const title = cleanText(detailTitle);
  const body = cleanText(text);
  return firstNonEmpty(
    title.match(/[^\s，。；;]*告字[（(]?\d{4}年?[）)]?\d+号?/)?.[0],
    body.match(/[^\s，。；;]*告字[（(]?\d{4}年?[）)]?\d+号?/)?.[0],
    title.match(/\d{4}年第?\d+号公告/)?.[0],
    body.match(/\d{4}年第?\d+号公告/)?.[0]
  );
}

export function extractWuhanDistrict(raw: string | null | undefined): string | null {
  const value = cleanText(raw);
  if (!value) {
    return null;
  }
  return firstNonEmpty(
    value.match(/([^，,\s]+?(?:区|县))/)?.[1],
    null
  );
}

class WuhanSiteAdapter extends ConfiguredHtmlSiteAdapter {
  public constructor() {
    super(config);
  }

  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    const detailPage = await super.openDetail(page, bizType, itemIndex);
    await detailPage.waitForLoadState("networkidle").catch(() => undefined);
    await Promise.any([
      detailPage.locator(".detail .title").first().waitFor({ state: "visible", timeout: 15_000 }),
      detailPage.locator(".detail-content").first().waitFor({ state: "visible", timeout: 15_000 }),
      detailPage.locator("table tr").first().waitFor({ state: "visible", timeout: 15_000 })
    ]).catch(() => undefined);
    await detailPage.waitForTimeout(800);
    return detailPage;
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const document = await extractDocument(page, SELECTORS);
    const liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
    const text = liveText || document.contentText;
    const rawRows = await page.locator("table tr").evaluateAll((nodes) =>
      nodes.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()))
    );
    const { headers, rows } = parseRows(rawRows);
    const sourceUrl = page.url();
    const detailTitle = cleanText(await page.locator(".detail .title").first().textContent().catch(() => null)) || document.title || context.listItem.title;
    const infoText = cleanText(await page.locator(".detail .info").first().textContent().catch(() => null));
    const noticeDate = normalizeDate(firstNonEmpty(
      infoText.match(/发布时间[:：]\s*([0-9年月日\-.\/\s:]+)/)?.[1],
      text.match(/发布时间[:：]\s*([0-9年月日\-.\/\s:]+)/)?.[1]
    ));
    const noticeNoRaw = extractWuhanNoticeNo(detailTitle, text);
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const attachmentsJson = document.attachments.length > 0 ? JSON.stringify(document.attachments) : null;

    const parcelIdx = findHeaderIndex(headers, ["地块编号"]);
    const districtIdx = findHeaderIndex(headers, ["土地位置"]);
    const usageIdx = findHeaderIndex(headers, ["土地用途", "用地性质"]);
    const areaIdx = findHeaderIndex(headers, ["土地面积"]);
    const startIdx = findHeaderIndex(headers, ["起始价"]);
    const winnerIdx = findHeaderIndex(headers, ["竞得人", "竞得单位", "土地使用权竞得人"]);
    const dealIdx = findHeaderIndex(headers, ["成交价"]);
    const dealDateIdx = findHeaderIndex(headers, ["成交时间"]);

    if (bizType === "notice") {
      const tradeDate = normalizeDate(firstNonEmpty(
        text.match(/网上拍卖时间为\s*([0-9年月日时分秒\-.:\s]+)/)?.[1],
        text.match(/网上挂牌时间为\s*([0-9年月日时分秒\-.:\s]+)/)?.[1],
        text.match(/揭牌时间为\s*([0-9年月日时分秒\-.:\s]+)/)?.[1],
        text.match(/挂牌截止时间[:：]\s*([0-9年月日时分秒\-.:\s]+)/)?.[1]
      ));
      const records: ParsedNoticeRecord[] = rows.map((row, rowIndex) => {
        const parcelNo = parcelIdx >= 0 ? row[parcelIdx] ?? null : null;
        const districtRaw = districtIdx >= 0 ? row[districtIdx] ?? null : null;
        const areaRaw = areaIdx >= 0 ? row[areaIdx] ?? null : null;
        const areaHa = areaRaw ? parseAreaToHectare(`${areaRaw}平方米`) : null;
        const startPriceByColumn = parseChineseNumber(startIdx >= 0 ? row[startIdx] : null);
        const listingModeIndex = row.findIndex((cell) => cell.includes("挂牌") || cell.includes("拍卖"));
        const startPriceByFallback =
          listingModeIndex >= 0
            ? parseChineseNumber(
                row
                  .slice(listingModeIndex + 1)
                  .filter((cell) => /^-?\d+(?:\.\d+)?$/.test(cell))[1] ?? null
              )
            : null;
        const district = extractWuhanDistrict(districtRaw);
        return {
          siteCode: this.siteCode,
          sourceKey: buildStableSourceKey(this.siteCode, "notice", [
            noticeNoNorm,
            parcelNo,
            row.join("|"),
            detailTitle,
            sourceUrl
          ]),
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: district ?? null,
          noticeTitle: detailTitle,
          noticeNoRaw,
          noticeNoNorm,
          landUsage: usageIdx >= 0 ? row[usageIdx] ?? null : null,
          areaHa,
          startPriceWan: startPriceByColumn ?? startPriceByFallback,
          noticeDate,
          tradeDate,
          parcelNo,
          contentText: text,
          rawHtml: document.rawHtml,
          attachmentsJson,
          crawlTime: new Date()
        };
      });
      return records.length > 0
        ? records
        : [
            {
              siteCode: this.siteCode,
              sourceKey: buildStableSourceKey(this.siteCode, "notice", [noticeNoNorm, detailTitle, sourceUrl]),
              sourceUrl,
              sourceTitle: context.listItem.title,
              city: this.cityName,
              district: null,
              noticeTitle: detailTitle,
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
              attachmentsJson,
              crawlTime: new Date()
            }
          ];
    }

    const records: ParsedResultRecord[] = rows.map((row, rowIndex) => {
      const parcelNo = parcelIdx >= 0 ? row[parcelIdx] ?? null : null;
      const districtRaw = districtIdx >= 0 ? row[districtIdx] ?? null : null;
      const district = extractWuhanDistrict(districtRaw);
      const dealPriceWan = parseChineseNumber(dealIdx >= 0 ? row[dealIdx] : null);
      return {
        siteCode: this.siteCode,
        sourceKey: buildStableSourceKey(this.siteCode, "result", [
          noticeNoNorm,
          parcelNo,
          row.join("|"),
          detailTitle,
          sourceUrl
        ]),
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: district ?? null,
        resultTitle: detailTitle,
        noticeNoRaw,
        noticeNoNorm,
        dealPriceWan,
        winner: winnerIdx >= 0 ? row[winnerIdx] ?? null : null,
        status: dealPriceWan !== null ? "已成交" : null,
        dealDate: normalizeDate(dealDateIdx >= 0 ? row[dealDateIdx] : null),
        parcelNo,
        contentText: text,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      };
    });

    return records.length > 0
      ? records
      : [
          {
            siteCode: this.siteCode,
            sourceKey: buildStableSourceKey(this.siteCode, "result", [noticeNoNorm, detailTitle, sourceUrl]),
            sourceUrl,
            sourceTitle: context.listItem.title,
            city: this.cityName,
            district: null,
            resultTitle: detailTitle,
            noticeNoRaw,
            noticeNoNorm,
            dealPriceWan: null,
            winner: null,
            status: null,
            dealDate: null,
            parcelNo: null,
            contentText: text,
            rawHtml: document.rawHtml,
            attachmentsJson,
            crawlTime: new Date()
          }
        ];
  }
}

export const wuhanAdapter = new WuhanSiteAdapter();
