import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ListItemSummary, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";
import { normalizeHeader, findHeaderIndex } from "../utils/table-parser.js";

const SELECTORS: SiteSelectors = {
  listReady: ["ul.ewb-right-item", ".ewb-right-item", "body"],
  listItem: "ul.ewb-right-item > li.ewb-right-list",
  titleLink: "a.l",
  nextPage: [".ewb-page li.wb-page-next a[href]", ".ewb-page a[href*='/2.html']"],
  currentPage: "#index",
  detailReady: [".ewb-article", ".article", "body"],
  detailTitle: ["h1", ".ewb-article-title", "title"],
  content: [".ewb-article", ".article", "body"],
  attachment: "a[href]"
};

const config: GenericSiteConfig = {
  siteCode: "hefei",
  cityName: "合肥",
  notice: {
    entryUrl: "https://ggzy.hefei.gov.cn/jyxx/002004/002004001/moreinfo_jyxxgg2.html",
    navigationStrategy: "return",
    selectors: SELECTORS
  },
  result: {
    entryUrl: "https://ggzy.hefei.gov.cn/jyxx/002004/002004003/moreinfo_jyxxgs2.html",
    navigationStrategy: "return",
    selectors: SELECTORS
  }
};

function extractDistrictToken(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  const region = firstNonEmpty(
    text.match(/(.+?区)/)?.[1],
    text.match(/(.+?县)/)?.[1],
    text.match(/(.+?市)/)?.[1]
  );
  return region ? cleanText(region) : null;
}

function resolveDistrict(rawDistrict: string | null | undefined, parcelNo: string | null | undefined): string | null {
  return firstNonEmpty(
    extractDistrictToken(rawDistrict),
    extractDistrictToken(parcelNo)
  );
}


function parseRows(rawRows: string[][]): { headers: string[]; rows: string[][] } {
  const rows = rawRows
    .map((row) => row.map((cell) => cleanText(cell)))
    .filter((row) => row.some((cell) => cell.length > 0));
  const headerIndex = rows.findIndex((row) => row.some((cell) => normalizeHeader(cell).includes("地块编号")));
  if (headerIndex < 0) {
    return { headers: [], rows: [] };
  }
  const headers = rows[headerIndex];
  const parcelIdx = findHeaderIndex(headers, ["地块编号"]);
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => {
      if (parcelIdx >= 0 && row[parcelIdx]) {
        const p = normalizeHeader(row[parcelIdx]);
        if (p.includes("地块编号")) return false; // Skip repeated headers
        return /号/.test(p) || /[A-Z]{1,4}\d/.test(p);
      }
      return row.some((cell) => /号/.test(cell) || /[A-Z]{1,4}\d/.test(cell));
    });
  return { headers, rows: dataRows };
}

function parseFirstNumber(raw: string | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const value = Number(raw.match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(value) ? value : null;
}

class HefeiSiteAdapter extends ConfiguredHtmlSiteAdapter {
  public constructor() {
    super(config);
  }

  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    const selectors = this.config[bizType].selectors;
    this.listPage = page;
    const item = page.locator(selectors.listItem).nth(itemIndex);
    const clickTarget = selectors.titleLink ? item.locator(selectors.titleLink).first() : item;
    
    // 合肥市页面不会弹出新窗口，直接点击并等待页面加载，避免默认的 2.5 秒新窗口等待超时
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      clickTarget.click()
    ]);
    
    return page;
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const document = await extractDocument(page, SELECTORS);
    const liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
    const text = liveText || document.contentText;
    const title = cleanText(await page.locator("h1, .ewb-article-title").first().textContent().catch(() => null)) || document.title || context.listItem.title;
    const sourceUrl = page.url();
    const noticeNoRaw = firstNonEmpty(
      title.match(/[^\s（）()]{0,12}自然资规公告[[（\[]\d{4}[)）\]]\d+号/)?.[0],
      text.match(/[^\s（）()]{0,12}自然资规公告[[（\[]\d{4}[)）\]]\d+号/)?.[0],
      title.match(/\d{4}年第?\d+号公告/)?.[0]
    );
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const noticeDate = normalizeDate(firstNonEmpty(
      text.match(/发布时间[:：]\s*([0-9\-\/年.\s月日]+)/)?.[1]
    ));
    const rawRows = await page.locator("table tr").evaluateAll((nodes) =>
      nodes.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
    );
    const { headers, rows } = parseRows(rawRows);

    const parcelIdx = findHeaderIndex(headers, ["地块编号"]);
    const districtIdx = findHeaderIndex(headers, ["土地座落", "宗地座落"]);
    const usageIdx = findHeaderIndex(headers, ["规划用途"]);
    const areaIdx = findHeaderIndex(headers, ["面积(亩)", "土地面积(亩)"]);
    const startPriceIdx = findHeaderIndex(headers, ["起始价(万元/亩)", "起叫价(万元/亩)", "参考地价(万元/亩)"]);
    const startTotalIdx = findHeaderIndex(headers, ["参考总价(万元)"]);
    const dealTotalIdx = findHeaderIndex(headers, ["成交总价(万元)", "成交价(万元)"]);
    const winnerIdx = findHeaderIndex(headers, ["受让人"]);
    const dealDateIdx = findHeaderIndex(headers, ["成交时间"]);

    if (bizType === "notice") {
      const tradeDate = normalizeDate(firstNonEmpty(
        text.match(/拍卖起始时间为\s*([0-9年月日时分:\s]+)/)?.[1],
        text.match(/挂牌截止时间是\s*([0-9年月日时分:\s]+)/)?.[1],
        text.match(/挂牌日期为[^，。；;]*至\s*([0-9年月日时分:\s]+)/)?.[1]
      ));
      const records: ParsedNoticeRecord[] = rows.map((row) => {
        const parcelNo = parcelIdx >= 0 ? row[parcelIdx] ?? null : null;
        const areaMu = areaIdx >= 0 ? parseFirstNumber(row[areaIdx]) ?? Number.NaN : Number.NaN;
        const unitPriceWanPerMu = startPriceIdx >= 0 ? parseFirstNumber(row[startPriceIdx]) ?? Number.NaN : Number.NaN;
        const startPriceWan = Number.isFinite(unitPriceWanPerMu) && Number.isFinite(areaMu) ? Number((unitPriceWanPerMu * areaMu).toFixed(4)) : parseChineseNumber(startTotalIdx >= 0 ? row[startTotalIdx] : null);
        const districtRaw = districtIdx >= 0 ? row[districtIdx] ?? null : null;
        return {
          siteCode: this.siteCode,
          sourceKey: buildStableSourceKey(this.siteCode, "notice", [
            noticeNoNorm,
            parcelNo,
            row.join("|"),
            title,
            sourceUrl
          ]),
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: resolveDistrict(districtRaw, parcelNo),
          noticeTitle: title,
          noticeNoRaw: noticeNoRaw ?? parcelNo,
          noticeNoNorm,
          landUsage: usageIdx >= 0 ? row[usageIdx] ?? null : null,
          areaHa: Number.isFinite(areaMu) ? parseAreaToHectare(`${areaMu}亩`) : null,
          startPriceWan,
          noticeDate,
          tradeDate,
          parcelNo,
          contentText: text,
          rawHtml: document.rawHtml,
          attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
          crawlTime: new Date()
        };
      });
      return records;
    }

    const records: ParsedResultRecord[] = rows.map((row) => {
      const parcelNo = parcelIdx >= 0 ? row[parcelIdx] ?? null : null;
      const districtRaw = districtIdx >= 0 ? row[districtIdx] ?? null : null;
      const dealDate = normalizeDate(firstNonEmpty(
        dealDateIdx >= 0 ? row[dealDateIdx] : null,
        title.match(/\((\d{4}\.\d{1,2}\.\d{1,2})\)/)?.[1],
        text.match(/发布时间[:：]\s*([0-9\-\/年.\s月日]+)/)?.[1]
      ));
      const dealPriceWan = parseChineseNumber(firstNonEmpty(
        dealTotalIdx >= 0 ? row[dealTotalIdx] : null,
        startTotalIdx >= 0 ? row[startTotalIdx] : null
      ));
      const winner = winnerIdx >= 0 ? row[winnerIdx] ?? null : null;
      return {
        siteCode: this.siteCode,
        sourceKey: buildStableSourceKey(this.siteCode, "result", [
          noticeNoNorm,
          parcelNo,
          row.join("|"),
          title,
          sourceUrl
        ]),
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: resolveDistrict(districtRaw, parcelNo),
        resultTitle: title,
        noticeNoRaw: noticeNoRaw ?? parcelNo,
        noticeNoNorm,
        dealPriceWan,
        winner,
        status: dealPriceWan !== null ? "已成交" : null,
        dealDate,
        parcelNo,
        contentText: text,
        rawHtml: document.rawHtml,
        attachmentsJson: document.attachments.length > 0 ? JSON.stringify(document.attachments) : null,
        crawlTime: new Date()
      };
    }).filter((record) => record.dealPriceWan !== null || !!record.winner);

    return records;
  }
}

export const hefeiAdapter = new HefeiSiteAdapter();
