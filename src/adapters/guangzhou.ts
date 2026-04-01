import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";
import { clickFirstVisible } from "../utils/browser-utils.js";

const NOTICE_SELECTORS: SiteSelectors = {
  listReady: ["#pane-notice .el-table__body tbody tr", "#pane-notice"],
  listItem: "#pane-notice .el-table__body tbody tr",
  titleLink: "td:nth-child(3) a",
  nextPage: ["#pane-notice .btn-next", "#pane-notice .el-pagination button.btn-next"],
  detailReady: [".contentBody", ".tableContent", "body"],
  detailTitle: [".header-info .title", "title"],
  content: [".contentBody", "body"],
  attachment: "a[href]"
};

const RESULT_SELECTORS: SiteSelectors = {
  listReady: ["#pane-resultPublicityNotice .el-table__body tbody tr", "#pane-resultPublicityNotice"],
  listItem: "#pane-resultPublicityNotice .el-table__body tbody tr",
  titleLink: "td:nth-child(3) a",
  nextPage: ["#pane-resultPublicityNotice .btn-next", "#pane-resultPublicityNotice .el-pagination button.btn-next"],
  detailReady: [".article-content", "table", "body"],
  detailTitle: [".article-title", "h1", "title"],
  content: [".article-content", "body"],
  attachment: "a[href]"
};


const config: GenericSiteConfig = {
  siteCode: "guangzhou",
  cityName: "广州",
  notice: {
    entryUrl: "https://prt.gzggzy.cn/ggzy/tkmh/#/transaction-data-all",
    navigationStrategy: "reopen",
    selectors: NOTICE_SELECTORS,
    prepareList: async (page: Page) => {
      await clickFirstVisible(page, ["#tab-notice", "[data-name='tab-notice']", "text=公告"]);
      await page.waitForTimeout(1_500);
    }
  },
  result: {
    entryUrl: "https://prt.gzggzy.cn/ggzy/tkmh/#/transaction-data-all",
    navigationStrategy: "reopen",
    selectors: RESULT_SELECTORS,
    prepareList: async (page: Page) => {
      await clickFirstVisible(page, ["#tab-resultPublicityNotice", "[data-name='tab-resultPublicityNotice']", "text=结果"]);
      await page.waitForTimeout(1_500);
    }
  }
};

function parseKeyValueRows(rows: string[][]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.length >= 2) {
      map[cleanText(row[0])] = cleanText(row[1]);
    }
  }
  return map;
}

function extractDistrictToken(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  const token = normalized.match(/([\u4e00-\u9fa5]{2,20}(?:区|县))/)?.[1] ?? null;
  if (!token) {
    return null;
  }
  return token.startsWith("市") ? token.slice(1) : token;
}

function pickStructuredField(kvMap: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanText(kvMap[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

export function extractGuangzhouParcelNoFromStructured(kvMap: Record<string, string>): string | null {
  return pickStructuredField(kvMap, ["地块编号", "宗地编号"]);
}

export function extractGuangzhouDistrictFromStructured(kvMap: Record<string, string>): string | null {
  return firstNonEmpty(
    extractDistrictToken(pickStructuredField(kvMap, ["区县", "行政区", "所属区县"])),
    extractDistrictToken(pickStructuredField(kvMap, ["用地位置", "地块位置", "宗地位置"]))
  );
}

function pickAreaFromKvMap(kvMap: Record<string, string>): string | null {
  const areaKeyPatterns = ["总用地面积", "宗地面积", "土地面积", "可建设用地面积"];
  for (const [key, value] of Object.entries(kvMap)) {
    if (!areaKeyPatterns.some((pattern) => key.includes(pattern))) {
      continue;
    }
    const matched = cleanText(value).match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
    if (matched) {
      return matched;
    }
  }
  return null;
}

function pickLargestArea(candidates: Array<string | null | undefined>): string | null {
  let best: { value: string; numeric: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const normalized = cleanText(candidate);
    const numericRaw = normalized.match(/([0-9]+(?:\.[0-9]+)?)/)?.[1];
    if (!numericRaw) {
      continue;
    }
    const numeric = Number(numericRaw);
    if (!Number.isFinite(numeric)) {
      continue;
    }
    if (!best || numeric > best.numeric) {
      best = { value: numericRaw, numeric };
    }
  }
  return best?.value ?? null;
}

class GuangzhouSiteAdapter extends ConfiguredHtmlSiteAdapter {
  public constructor() {
    super(config);
  }

  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    const detailPage = await super.openDetail(page, bizType, itemIndex);
    await detailPage.waitForLoadState("networkidle").catch(() => undefined);
    if (bizType === "notice") {
      await Promise.any([
        detailPage.locator(".contentBody").first().waitFor({ state: "visible", timeout: 15_000 }),
        detailPage.locator("text=交易公告").first().waitFor({ state: "visible", timeout: 15_000 }),
        detailPage.locator("text=起始价").first().waitFor({ state: "visible", timeout: 15_000 })
      ]).catch(() => undefined);
    } else {
      await Promise.any([
        detailPage.locator(".article-content").first().waitFor({ state: "visible", timeout: 15_000 }),
        detailPage.locator("text=成交价").first().waitFor({ state: "visible", timeout: 15_000 }),
        detailPage.locator("table tr").first().waitFor({ state: "visible", timeout: 15_000 })
      ]).catch(() => undefined);
    }
    await detailPage.waitForTimeout(800);
    return detailPage;
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const selectors = bizType === "notice" ? NOTICE_SELECTORS : RESULT_SELECTORS;
    const document = await extractDocument(page, selectors);
    const sourceUrl = page.url();
    const liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
    const text = liveText || document.contentText;
    const rows = await page.locator("table tr").evaluateAll((nodes) =>
      nodes.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim()))
    );
    const kvMap = parseKeyValueRows(rows);
    const attachmentsJson = document.attachments.length > 0 ? JSON.stringify(document.attachments) : null;

    const title = cleanText(await page.locator(".header-info .title, .article-title, h1").first().textContent().catch(() => null)) || context.listItem.title;
    const noticeNoRaw = firstNonEmpty(
      text.match(/(穗规划资源[^\s，。；;]*?(?:挂出|拍卖)?告字[〔(]\d{4}[)〕]\d+号)/)?.[1],
      text.match(/([^\s，。；;]*告字[〔(]\d{4}[)〕]\d+号)/)?.[1],
      title.match(/(穗规划资源[^\s，。；;]*?(?:挂出|拍卖)?告字[〔(]\d{4}[)〕]\d+号)/)?.[1]
    );
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const district = extractGuangzhouDistrictFromStructured(kvMap);

    if (bizType === "notice") {
      const parcelNo = extractGuangzhouParcelNoFromStructured(kvMap);
      const areaRaw = pickLargestArea([
        pickAreaFromKvMap(kvMap),
        text.match(/总用地面积[^\d]*([0-9]+(?:\.[0-9]+)?)/)?.[1],
        text.match(/出让宗地面积[^\d]*([0-9]+(?:\.[0-9]+)?)/)?.[1],
        text.match(/宗地面积[:：]?\s*([0-9.]+)平方米/)?.[1],
        text.match(/宗地面积(?:[（(][^)）]*[)）])?[:：]?\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
        text.match(/总用地面积(?:[（(][^)）]*[)）])?[:：]?\s*([0-9]+(?:\.[0-9]+)?)/)?.[1],
        text.match(/宗地面积[（(]平方米[）)]\s*([0-9.]+)/)?.[1],
        text.match(/土地面积[（(]平方米[）)]\s*([0-9.]+)/)?.[1],
        text.match(/([0-9]+(?:\.[0-9]+)?)，全部为可建设用地/)?.[1],
        text.match(/([0-9]+(?:\.[0-9]+)?)[（(]可建设用地面积[0-9.]+[）)]/)?.[1]
      ]);
      return [
        {
          siteCode: this.siteCode,
          sourceKey: buildStableSourceKey(this.siteCode, "notice", [noticeNoNorm, parcelNo, title, sourceUrl]),
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district: district ?? null,
          noticeTitle: title,
          noticeNoRaw: noticeNoRaw ?? parcelNo,
          noticeNoNorm,
          landUsage: firstNonEmpty(
            text.match(/土地用途[:：]\s*([^\s，。；]+)/)?.[1],
            kvMap["土地用途"]
          ),
          areaHa: areaRaw ? parseAreaToHectare(`${areaRaw}平方米`) : null,
          startPriceWan: parseChineseNumber(firstNonEmpty(
            text.match(/起始价[:：]\s*([0-9.]+(?:万元|元\/平方米|元\/建筑平方米)?)/)?.[1],
            text.match(/挂牌起始价(?:\(万元\))?[:：]?\s*([0-9.]+)/)?.[1]
          )),
          noticeDate: normalizeDate(firstNonEmpty(
            text.match(/发布时间[:：]\s*([0-9年\-\/\s:月日]{8,})/)?.[1],
            text.match(/公告时间[:：]\s*([0-9年\-\s月日]{8,})至/)?.[1],
            text.match(/(\d{4}年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)$/)?.[1]
          )),
          tradeDate: normalizeDate(firstNonEmpty(
            text.match(/限时竞价开始时间[:：]\s*([0-9-]+\s*[0-9:]{0,8})/)?.[1],
            text.match(/揭牌时间[:：]\s*([0-9-]+\s*[0-9:]{0,8})/)?.[1]
          )),
          parcelNo: parcelNo ?? null,
          contentText: text,
          rawHtml: document.rawHtml,
          attachmentsJson,
          crawlTime: new Date()
        }
      ];
    }

    const resultTitle = cleanText(await page.locator(".article-title, h1").first().textContent().catch(() => null)) || title;
    const parcelNo = extractGuangzhouParcelNoFromStructured(kvMap);
    const dealPriceWan = parseChineseNumber(firstNonEmpty(kvMap["成交价（万元）"], kvMap["成交价(万元）"], kvMap["成交价(万元)"]));
    return [
      {
        siteCode: this.siteCode,
        sourceKey: buildStableSourceKey(this.siteCode, "result", [noticeNoNorm, parcelNo, resultTitle, sourceUrl]),
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district: district ?? null,
        resultTitle,
        noticeNoRaw: noticeNoRaw ?? parcelNo,
        noticeNoNorm,
        dealPriceWan,
        winner: firstNonEmpty(kvMap["受让单位"], kvMap["竞得人"], kvMap["竞得单位"]),
        status: dealPriceWan !== null ? "已成交" : null,
        dealDate: normalizeDate(firstNonEmpty(
          text.match(/于\d{4}年\d{1,2}月\d{1,2}日(?:至\d{4}年\d{1,2}月\d{1,2}日)?网上挂牌/)?.[0]?.match(/至(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1],
          text.match(/发布时间[:：]\s*([0-9年\-\/\s:月日]{8,})/)?.[1]
        )),
        parcelNo: parcelNo ?? null,
        contentText: text,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      }
    ];
  }
}

export const guangzhouAdapter = new GuangzhouSiteAdapter();
