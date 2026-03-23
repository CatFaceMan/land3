
import { load, type CheerioAPI } from "cheerio";
import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument } from "./base-html-adapter.js";
import type { GenericSiteConfig, SiteSelectors } from "./site-adapter.js";
import type { ListItemSummary, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
import { cleanStatus, cleanText, firstNonEmpty } from "../utils/text.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { findHeaderIndex } from "../utils/table-parser.js";

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
const DISTRICT_TOKEN_PATTERN = /([\u4e00-\u9fa5]{2,12}(?:自治县|新区|开发区|市|区|县))/g;

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

function getChallengeWaitMs(siteCode: SiteCode): number {
  const raw = process.env[`SITE_${siteCode.toUpperCase()}_CHALLENGE_WAIT_MS`]?.trim();
  if (!raw) {
    return 0;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getChallengeBreakerThreshold(siteCode: SiteCode): number {
  const raw = process.env[`SITE_${siteCode.toUpperCase()}_CHALLENGE_BREAKER_THRESHOLD`]?.trim();
  if (!raw) {
    return 2;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function getChallengeBreakerCooldownMs(siteCode: SiteCode): number {
  const raw = process.env[`SITE_${siteCode.toUpperCase()}_CHALLENGE_BREAKER_COOLDOWN_MS`]?.trim();
  if (!raw) {
    return 60 * 60 * 1000;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60 * 60 * 1000;
}

function isAntiBotChallenge(title: string, text: string, html: string): boolean {
  const joined = `${title}\n${text}\n${html}`.toLowerCase();
  const markers = [
    "滑动验证",
    "访问验证",
    "请按住滑块",
    "请进行验证",
    "请完成验证",
    "traceid",
    "captcha",
    "verify"
  ];
  if (markers.some((marker) => joined.includes(marker))) {
    return true;
  }
  // In some locked environments the challenge page can degrade to an empty shell.
  return !cleanText(title) && !cleanText(text);
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

function isZhejiangDetailPageLoaded(text: string): boolean {
  const normalized = cleanText(text);
  if (!normalized) {
    return false;
  }
  const detailMarkers = [
    "地块编号（宗地编码）",
    "公告信息",
    "土地信息",
    "竞买保证金",
    "挂牌截止时间",
    "出让公告"
  ];
  return detailMarkers.some((marker) => normalized.includes(marker));
}

type ZhejiangResourceDetailResponse = {
  data?: {
    subRegion?: string | null;
    administrativeRegioncode?: string | null;
  } | null;
};

type ZhejiangHtmlTable = {
  headers: string[];
  rows: string[][];
};

export type ZhejiangNoticeFieldOverrides = {
  parcelNo: string | null;
  district: string | null;
  landUsage: string | null;
  areaHa: number | null;
  startPriceWan: number | null;
  tradeDate: string | null;
  noticeNoRaw: string | null;
};

export function extractZhejiangNoticeNo(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  const pattern = /(?=([^\s，。；;]{0,20}(?:告字|告)[\[({〔【（]?\d{4}[\])}〕】）]?(?:[A-Za-z]+\d+|\d+)(?:-\d+)?号?))/gi;
  const candidates = Array.from(text.matchAll(pattern))
    .map((item) => cleanText(item[1]))
    .filter((item) => item.length > 0);
  if (candidates.length === 0) {
    return null;
  }
  const pool = candidates.filter((item) => item.length <= 40);
  const source = pool.length > 0 ? pool : candidates;
  const score = (item: string): number => {
    let value = 0;
    if (/^[\u4e00-\u9fa5]{0,12}(?:告字|告)[\[({〔【（]?\d{4}/i.test(item)) {
      value += 4;
    }
    if (/^告字/.test(item)) {
      value -= 2;
    }
    if (/^[杭宁温台绍金湖嘉衢丽舟]/.test(item)) {
      value += 3;
    }
    if (/规划资源告/i.test(item)) {
      value += 2;
    }
    if (/挂牌出让/.test(item)) {
      value -= 5;
    }
    if (item.length <= 20) {
      value += 1;
    }
    return value;
  };
  source.sort((a, b) => score(b) - score(a) || a.length - b.length);
  return source[0] ?? null;
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
  const normalizeMultiline = (raw: string | null | undefined): string => {
    if (!raw) {
      return "";
    }
    return raw
      .replace(/\r/g, "\n")
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter((line) => line.length > 0)
      .join("\n");
  };

  const tab = page.locator(".ant-tabs-tab, [role='tab']").filter({ hasText: "公告信息" }).first();
  if ((await tab.count().catch(() => 0)) > 0) {
    await tab.click().catch(() => undefined);
    await page.waitForTimeout(200);
  }

  const activePaneText = normalizeMultiline(
    await page.locator(".ant-tabs-tabpane-active").first().textContent().catch(() => null)
  );
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
  return normalizeMultiline(text);
}

export function extractZhejiangDistrict(text: string, summary: string | null | undefined): string | null {
  const summaryText = cleanText(summary);
  const summaryDistrictMatches = Array.from(summaryText.matchAll(DISTRICT_TOKEN_PATTERN))
    .map((item) => cleanText(item[1]))
    .filter((item) => item.length > 0);
  const summaryDistrict = summaryDistrictMatches.length > 0 ? summaryDistrictMatches[summaryDistrictMatches.length - 1] : null;
  return firstNonEmpty(
    text.match(/地块所在区域：\s*([^\s]+?)\s*(?:出让面积：|土地主用途：|土地用途明细：)/)?.[1],
    text.match(/所属行政区：\s*([^\s]+?)\s*地块所在区域：/)?.[1],
    summaryDistrict
  );
}

function extractZhejiangDistrictFromTitle(title: string | null | undefined): string | null {
  const text = cleanText(title);
  if (!text) {
    return null;
  }
  return firstNonEmpty(
    text.match(/([^\s，。；:：]+区)/)?.[1],
    text.match(/([^\s，。；:：]+县)/)?.[1]
  );
}

export function extractHangzhouDistrictFromAnnouncementTitle(title: string | null | undefined): string | null {
  const text = cleanText(title);
  if (!text) {
    return null;
  }
  const beforeNotice = cleanText(text.split("出让公告")[0] ?? "");
  if (!beforeNotice) {
    return null;
  }
  const collect = (pattern: RegExp): string | null => {
    const matches = Array.from(beforeNotice.matchAll(pattern))
      .map((item) => cleanText(item[1]))
      .filter((item) => item.length > 0);
    return matches.length > 0 ? matches[matches.length - 1] : null;
  };
  return firstNonEmpty(
    collect(/([\u4e00-\u9fa5]{2,12}(?:自治县|新区|开发区))/g),
    collect(/([\u4e00-\u9fa5]{2,12}(?:市|区|县))/g)
  );
}

export function extractHangzhouDistrictFromAnnouncementText(text: string | null | undefined): string | null {
  const normalized = cleanText(text);
  if (!normalized) {
    return null;
  }
  return firstNonEmpty(
    normalized.match(/([\u4e00-\u9fa5]{2,12}(?:自治县|新区|开发区))(?:国有建设用地使用权)?挂牌出让公告/)?.[1],
    normalized.match(/([\u4e00-\u9fa5]{2,12}(?:市|区|县))(?:国有建设用地使用权)?挂牌出让公告/)?.[1]
  );
}

export function extractHangzhouParcelNoFromAnnouncementSubTitle(subTitle: string | null | undefined): string | null {
  const text = cleanText(subTitle);
  if (!text) {
    return null;
  }
  if (text.length <= 40) {
    return text;
  }
  return extractZhejiangNoticeNo(text) ?? text;
}

function extractLandUsageKeyword(rawUsage: string | null | undefined): string | null {
  const text = cleanText(rawUsage);
  if (!text) {
    return null;
  }
  const direct = text.match(/([^\s（）()]{2})用地/)?.[1];
  if (direct) {
    return direct;
  }
  return firstNonEmpty(
    text.includes("工业") ? "工业" : null,
    text.includes("住宅") ? "住宅" : null,
    text.includes("商服") ? "商服" : null,
    text.includes("仓储") ? "仓储" : null,
    text.includes("物流") ? "物流" : null,
    text.includes("商务") ? "商务" : null,
    text.includes("商业") ? "商业" : null,
    text.includes("金融") ? "金融" : null,
    text.includes("其他") ? "其他" : null
  );
}

function extractAnnouncementHeaderLines(announcementText: string): { titleLine: string | null; subTitleLine: string | null } {
  const lines = announcementText
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter((line) => line.length > 0);
  const titleLine = lines.find((line) => /(?:出让公告|公告)$/.test(line)) ?? null;
  const subTitleLine = firstNonEmpty(
    ...lines
      .filter((line) => /告[【\[(（]?\d{4}[】\])）]?/.test(line))
      .map((line) => extractZhejiangNoticeNo(line))
  );
  return { titleLine, subTitleLine };
}

function normalizeDistrictValue(value: string | null | undefined): string | null {
  const cleanDistrictToken = (token: string): string | null => {
    let candidate = cleanText(token)
      .replace(/^位于/, "")
      .replace(/^位于杭州市/, "")
      .replace(/^位于宁波市/, "");
    candidate = candidate.replace(/^[年月日时分秒号字第]+/, "");
    if (candidate.includes("用地")) {
      candidate = cleanText(candidate.split("用地").pop() ?? candidate);
    }
    if (candidate.includes("市") && /区$/.test(candidate)) {
      candidate = candidate.slice(candidate.lastIndexOf("市") + 1);
    }
    return candidate || null;
  };
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  if (text === "所属行政区" || text === "地块所在区域") {
    return null;
  }
  if (/^公告期/.test(text)) {
    const trimmed = text.replace(/^公告期/, "");
    const matches = Array.from(trimmed.matchAll(DISTRICT_TOKEN_PATTERN))
      .map((item) => cleanText(item[1]))
      .filter((item) => item.length > 0);
    return matches.length > 0 ? cleanDistrictToken(matches[matches.length - 1]) : null;
  }
  const generalMatches = Array.from(text.matchAll(DISTRICT_TOKEN_PATTERN))
    .map((item) => cleanText(item[1]))
    .filter((item) => item.length > 0);
  if (generalMatches.length > 0) {
    return cleanDistrictToken(generalMatches[generalMatches.length - 1]);
  }
  return text;
}

function normalizeNoticeNoForDb(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  const noticeNo = extractZhejiangNoticeNo(text) ?? text;
  const compact = cleanText(noticeNo);
  return compact.length > 255 ? compact.slice(0, 255) : compact;
}

function normalizeNoticeNoBySite(siteCode: SiteCode, noticeNoRaw: string | null): string | null {
  if (!noticeNoRaw) {
    return null;
  }
  if (siteCode === "hangzhou" && /^规划资源告/.test(noticeNoRaw)) {
    return `杭${noticeNoRaw}`;
  }
  if (siteCode === "ningbo" && /^规划资源告/.test(noticeNoRaw)) {
    return `甬${noticeNoRaw}`;
  }
  return noticeNoRaw;
}

function normalizeZhejiangLabel(value: string | null | undefined): string {
  return cleanText(value)
    .replace(/[:：\s]/g, "")
    .replace(/[（）()\[\]【】〔〕]/g, "");
}

function normalizeZhejiangParcelNo(value: string | null | undefined): string {
  return (normalizeNoticeNo(value) ?? "").replace(/\s+/g, "").toUpperCase();
}

function firstFiniteNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readZhejiangDescriptionField(fields: Record<string, string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeZhejiangLabel(candidate);
    for (const [key, value] of Object.entries(fields)) {
      if (key === normalizedCandidate || key.includes(normalizedCandidate) || normalizedCandidate.includes(key)) {
        return value;
      }
    }
  }
  return null;
}

function extractZhejiangDescriptionFields($: CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};
  $(".descriptions-item").each((_, item) => {
    const title = normalizeZhejiangLabel($(item).find(".descriptions-title").first().text());
    const content = cleanText($(item).find(".descriptions-content").first().text());
    if (title && content && !fields[title]) {
      fields[title] = content;
    }
  });
  return fields;
}

function expandZhejiangHtmlTable($: CheerioAPI, table: any): string[][] {
  const rows: string[][] = [];
  const pending: Array<{ text: string; remaining: number } | undefined> = [];

  $(table)
    .find("tr")
    .each((_, tr) => {
      const row: string[] = [];
      let columnIndex = 0;

      const fillPendingColumns = () => {
        while (pending[columnIndex]) {
          const span = pending[columnIndex];
          if (!span) {
            break;
          }
          row[columnIndex] = span.text;
          span.remaining -= 1;
          if (span.remaining <= 0) {
            pending[columnIndex] = undefined;
          }
          columnIndex += 1;
        }
      };

      $(tr)
        .children("th,td")
        .each((__, cell) => {
          fillPendingColumns();

          const text = cleanText($(cell).text());
          const rowspanRaw = Number.parseInt($(cell).attr("rowspan") ?? "1", 10);
          const colspanRaw = Number.parseInt($(cell).attr("colspan") ?? "1", 10);
          const rowspan = Number.isFinite(rowspanRaw) && rowspanRaw > 0 ? rowspanRaw : 1;
          const colspan = Number.isFinite(colspanRaw) && colspanRaw > 0 ? colspanRaw : 1;

          for (let offset = 0; offset < colspan; offset += 1) {
            row[columnIndex + offset] = text;
            if (rowspan > 1) {
              pending[columnIndex + offset] = { text, remaining: rowspan - 1 };
            }
          }
          columnIndex += colspan;
        });

      fillPendingColumns();
      if (row.some((cell) => cleanText(cell).length > 0)) {
        rows.push(row.map((cell) => cleanText(cell)));
      }
    });

  return rows;
}

function extractZhejiangTables(rawHtml: string): ZhejiangHtmlTable[] {
  const $ = load(rawHtml);
  const tables: ZhejiangHtmlTable[] = [];

  $("table").each((_, table) => {
    const rows = expandZhejiangHtmlTable($, table);
    if (rows.length >= 2) {
      tables.push({
        headers: rows[0] ?? [],
        rows: rows.slice(1)
      });
    }
  });

  return tables;
}

function matchZhejiangTable(table: ZhejiangHtmlTable, markers: string[]): boolean {
  return markers.every((marker) => findHeaderIndex(table.headers, [marker]) >= 0);
}

function getZhejiangTableCell(table: ZhejiangHtmlTable | null, row: string[] | null, candidates: string[]): string | null {
  if (!table || !row) {
    return null;
  }
  const index = findHeaderIndex(table.headers, candidates);
  if (index < 0) {
    return null;
  }
  return cleanText(row[index]);
}

function findZhejiangTableRowByParcel(table: ZhejiangHtmlTable | null, parcelNo: string | null | undefined): string[] | null {
  if (!table || !parcelNo) {
    return null;
  }
  const parcelIndex = findHeaderIndex(table.headers, ["地块编号"]);
  if (parcelIndex < 0) {
    return null;
  }
  const targetKey = normalizeZhejiangParcelNo(parcelNo);
  if (!targetKey) {
    return null;
  }
  return table.rows.find((row) => normalizeZhejiangParcelNo(row[parcelIndex]) === targetKey) ?? null;
}

function extractDistrictFromLocation(location: string | null | undefined): string | null {
  const text = cleanText(location);
  if (!text) {
    return null;
  }
  return firstNonEmpty(
    text.match(/^([^（(，,\s]+区)/)?.[1],
    text.match(/^([^（(，,\s]+县)/)?.[1],
    text.match(/^([^（(，,\s]+市)/)?.[1]
  );
}

function extractZhejiangAttachmentFileNames($: CheerioAPI): string[] {
  const names = $(".file-name span")
    .map((_, element) => cleanText($(element).text()))
    .get()
    .filter((name) => name.length > 0);
  return Array.from(new Set(names));
}

export function extractZhejiangNoticeFieldOverrides(args: {
  rawHtml: string;
  pageText?: string | null;
  announcementText?: string | null;
  summary?: string | null;
  parcelNoOverride?: string | null;
}): ZhejiangNoticeFieldOverrides {
  const $ = load(args.rawHtml);
  const descriptionFields = extractZhejiangDescriptionFields($);
  const tables = extractZhejiangTables(args.rawHtml);
  const pageText = cleanText(args.pageText ?? $("body").text());
  const announcementText = cleanText(args.announcementText ?? pageText);
  const summary = cleanText(args.summary);
  const attachmentFileNames = extractZhejiangAttachmentFileNames($);

  const detailParcelNo = firstNonEmpty(
    readZhejiangDescriptionField(descriptionFields, ["地块编号宗地编码", "地块编号"]),
    pageText.match(/地块编号（宗地编码）：\s*([^地]+?)\s*地块名称：/)?.[1],
    summary.match(/#([^#|]+?)(?:保证金到账截止时间|起始价|挂牌时间|拍卖时间|拍卖开始|$)/)?.[1]
  );
  const targetParcelNo = firstNonEmpty(args.parcelNoOverride, detailParcelNo);
  const canUseDetailFallback =
    !args.parcelNoOverride ||
    (normalizeZhejiangParcelNo(args.parcelNoOverride) !== "" &&
      normalizeZhejiangParcelNo(args.parcelNoOverride) === normalizeZhejiangParcelNo(detailParcelNo));

  const overviewTable =
    tables.find((table) => matchZhejiangTable(table, ["地块编号", "地块坐落", "出让土地面积", "用途", "出让起价"])) ?? null;
  const scheduleTable =
    tables.find((table) => matchZhejiangTable(table, ["地块编号", "开始报价时间", "截止报价时间"])) ?? null;
  const overviewRow = findZhejiangTableRowByParcel(overviewTable, targetParcelNo);
  const scheduleRow = findZhejiangTableRowByParcel(scheduleTable, targetParcelNo);
  const overviewAreaText = getZhejiangTableCell(overviewTable, overviewRow, ["出让土地面积"]);

  const detailAreaText = canUseDetailFallback ? readZhejiangDescriptionField(descriptionFields, ["出让面积"]) : null;
  const bestAreaHa = firstFiniteNumber(
    overviewAreaText ? parseAreaToHectare(`${overviewAreaText}平方米`) : null,
    parseAreaToHectare(detailAreaText),
    parseAreaToHectare(summary.match(/出让面积([0-9.]+平方米\[[0-9.]+亩\])/)?.[1] ?? null)
  );

  const landUsage = firstNonEmpty(
    getZhejiangTableCell(overviewTable, overviewRow, ["用途"]),
    canUseDetailFallback ? readZhejiangDescriptionField(descriptionFields, ["土地主用途"]) : null,
    summary.match(/((?:住宅|工业|商服|商业|商务金融|物流仓储)[^|]*?用地)/)?.[1]
  );

  const startPriceWan = firstFiniteNumber(
    parsePriceWan(getZhejiangTableCell(overviewTable, overviewRow, ["出让起价"]), bestAreaHa),
    parsePriceWan(canUseDetailFallback ? readZhejiangDescriptionField(descriptionFields, ["竞地价起始价", "起始价"]) : null, bestAreaHa),
    parseChineseNumber(summary.match(/起始价([0-9.]+万元)/)?.[1])
  );

  return {
    parcelNo: targetParcelNo,
    district: firstNonEmpty(
      canUseDetailFallback ? readZhejiangDescriptionField(descriptionFields, ["所属行政区"]) : null,
      extractDistrictFromLocation(getZhejiangTableCell(overviewTable, overviewRow, ["地块坐落"])),
      extractZhejiangDistrict(pageText, summary),
      extractZhejiangDistrictFromTitle(announcementText)
    ),
    landUsage: landUsage ?? null,
    areaHa: bestAreaHa,
    startPriceWan,
    tradeDate: normalizeDate(
      firstNonEmpty(
        getZhejiangTableCell(scheduleTable, scheduleRow, ["截止报价时间"]),
        canUseDetailFallback ? readZhejiangDescriptionField(descriptionFields, ["挂牌截止时间"]) : null
      )
    ),
    noticeNoRaw: firstNonEmpty(
      extractZhejiangNoticeNo(announcementText),
      extractZhejiangNoticeNo(attachmentFileNames.join(" ")),
      extractZhejiangNoticeNo(pageText),
      cleanText(targetParcelNo) || null
    )
  };
}

class ZhejiangSiteAdapter extends ConfiguredHtmlSiteAdapter {
  private currentItems: ListItemSummary[] = [];
  private lastPageNo = 1;
  private static readonly challengeState = new Map<SiteCode, { failures: number; openUntil: number }>();

  public constructor(siteCode: SiteCode, cityName: string, private readonly filterKeyword: string) {
    super(createZhejiangConfig(siteCode, cityName));
  }

  private async applyCityFilter(page: Page): Promise<void> {
    const cityLabel = this.filterKeyword.includes("宁波") ? "宁波市" : "杭州市";
    const cityOption = page
      .locator("span.filter-select-option, .filter-select-option, .ant-tag, .filter-item, span, button, a")
      .filter({ hasText: cityLabel })
      .first();
    if ((await cityOption.count().catch(() => 0)) > 0) {
      await cityOption.click().catch(() => undefined);
      await page.waitForTimeout(1500);
    }
  }

  private async applyBizFilter(page: Page, bizType: "notice" | "result"): Promise<void> {
    const optionLabels = bizType === "notice" ? ["不限"] : ["结果公示", "交易结束"];
    for (const targetLabel of optionLabels) {
      const option = page
        .locator("span.filter-select-option, .filter-select-option, .ant-tag, .filter-item, span, button, a")
        .filter({ hasText: targetLabel })
        .first();
      if ((await option.count().catch(() => 0)) > 0) {
        await option.click().catch(() => undefined);
        await page.waitForTimeout(1200);
        return;
      }
    }
  }

  public override async openEntry(page: Page, bizType: "notice" | "result"): Promise<void> {
    await super.openEntry(page, bizType);
    await this.applyCityFilter(page);
    await this.applyBizFilter(page, bizType);
  }

  public override async waitForListReady(page: Page, bizType: "notice" | "result"): Promise<void> {
    const breakerThreshold = getChallengeBreakerThreshold(this.siteCode);
    const breakerCooldownMs = getChallengeBreakerCooldownMs(this.siteCode);
    const state = ZhejiangSiteAdapter.challengeState.get(this.siteCode) ?? { failures: 0, openUntil: 0 };
    if (state.openUntil > Date.now()) {
      const remainMs = state.openUntil - Date.now();
      throw new Error(`zhejiang circuit breaker open for ${this.siteCode}: remainMs=${remainMs}`);
    }

    const challengeWaitMs = getChallengeWaitMs(this.siteCode);
    const startedAt = Date.now();
    while (true) {
      try {
        await super.waitForListReady(page, bizType);
        ZhejiangSiteAdapter.challengeState.set(this.siteCode, { failures: 0, openUntil: 0 });
        return;
      } catch (error) {
        const title = cleanText(await page.title().catch(() => null));
        const text = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
        const html = cleanText(await page.content().catch(() => ""));
        const challengeDetected = isAntiBotChallenge(title, text, html);
        if (!challengeDetected) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `zhejiang list page not ready; title=${title || "N/A"}; url=${page.url()}; text=${text.slice(0, 200)}; cause=${message}`
          );
        }

        const current = ZhejiangSiteAdapter.challengeState.get(this.siteCode) ?? { failures: 0, openUntil: 0 };
        const nextFailures = current.failures + 1;
        if (nextFailures >= breakerThreshold) {
          const openUntil = Date.now() + breakerCooldownMs;
          ZhejiangSiteAdapter.challengeState.set(this.siteCode, { failures: nextFailures, openUntil });
          throw new Error(`zhejiang anti-bot challenge breaker opened for ${this.siteCode}; cooldownMs=${breakerCooldownMs}`);
        }
        ZhejiangSiteAdapter.challengeState.set(this.siteCode, { failures: nextFailures, openUntil: 0 });

        if (challengeWaitMs <= 0 || Date.now() - startedAt >= challengeWaitMs) {
          throw new Error(`zhejiang anti-bot challenge detected: ${title || "滑动验证页面"}`);
        }
        await page.waitForTimeout(2_000);
      }
    }
  }

  public override async listItems(page: Page, bizType: "notice" | "result", pageNo: number): Promise<ListItemSummary[]> {
    const _ = bizType;
    void _;
    this.lastPageNo = pageNo;
    const nodes = page.locator(SELECTORS.listItem);
    let count = await nodes.count();
    for (let attempt = 0; count === 0 && attempt < 4; attempt += 1) {
      await page.waitForTimeout(1200);
      count = await nodes.count();
    }
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
    void item;
    return false;
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

    let document = await extractDocument(page, SELECTORS);
    let liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
    let liveHtml = await page.content().catch(() => document.rawHtml);
    let attachments = await page.locator("a[href]").evaluateAll((nodes) =>
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentText = liveText || cleanText(document.contentText);
      if (isZhejiangDetailPageLoaded(currentText)) {
        break;
      }
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(1200);
      document = await extractDocument(page, SELECTORS);
      liveText = cleanText(await page.evaluate(() => window.document.body?.innerText || "").catch(() => ""));
      liveHtml = await page.content().catch(() => document.rawHtml);
      attachments = await page.locator("a[href]").evaluateAll((nodes) =>
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
    }
    const text = liveText || cleanText(document.contentText);
    if (!isZhejiangDetailPageLoaded(text)) {
      throw new Error(`zhejiang detail page not fully loaded: url=${sourceUrl}`);
    }
    const announcementText = await extractZhejiangAnnouncementText(page);
    const headerLines = extractAnnouncementHeaderLines(announcementText);
    const summary = cleanText(context.listItem.title);
    const rightText = cleanText(await page.locator(".info-right").first().textContent().catch(() => null));
    const infoItems = await page.locator(".info-item").evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
    ).catch(() => [] as string[]);
    const progressItems = await page.locator(".progressBar-item-content").evaluateAll((nodes) =>
      nodes.map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
    ).catch(() => [] as string[]);
    const html$ = load(liveHtml);
    const descriptionFields = extractZhejiangDescriptionFields(html$);
    const hangzhouStrictDistrict = normalizeDistrictValue(descriptionFields["所属行政区"] ?? null);
    const hangzhouStrictPlotNo = cleanText(descriptionFields["地块编号宗地编码"] ?? "");
    const hangzhouStrictNoticeNo = extractZhejiangNoticeNo(announcementText);
    if (this.siteCode === "hangzhou" && bizType === "notice") {
      if (!hangzhouStrictDistrict || !hangzhouStrictPlotNo || !hangzhouStrictNoticeNo) {
        throw new Error(
          `hangzhou strict field missing: district=${hangzhouStrictDistrict ?? "null"}, ` +
          `plotNo=${hangzhouStrictPlotNo || "null"}, noticeNo=${hangzhouStrictNoticeNo ?? "null"}, url=${sourceUrl}`
        );
      }
    }
    const noticeOverrides: ZhejiangNoticeFieldOverrides =
      bizType === "notice"
        ? extractZhejiangNoticeFieldOverrides({
            rawHtml: liveHtml,
            pageText: text,
            announcementText,
            summary
          })
        : {
            parcelNo: null,
            district: null,
            landUsage: null,
            areaHa: null,
            startPriceWan: null,
            tradeDate: null,
            noticeNoRaw: null
          };
    const parcelNoRaw = firstNonEmpty(
      this.siteCode === "hangzhou" && bizType === "notice" ? hangzhouStrictPlotNo : null,
      noticeOverrides.parcelNo,
      text.match(/地块编号（宗地编码）：\s*([^地]+?)\s*地块名称：/)?.[1],
      summary.match(/#([^#|]+?)(?:保证金到账截止时间|起始价|挂牌时间|拍卖时间|拍卖开始|$)/)?.[1]
    );
    const parcelNo = parcelNoRaw;
    const district = firstNonEmpty(
      this.siteCode === "hangzhou" && bizType === "notice" ? hangzhouStrictDistrict : null,
      normalizeDistrictValue(noticeOverrides.district),
      normalizeDistrictValue(extractZhejiangDistrictFromTitle(headerLines.titleLine)),
      normalizeDistrictValue(extractZhejiangDistrict(text, summary))
    );
    const areaHa = parseAreaToHectare(matchValue(text, "出让面积：", ["土地主用途：", "土地用途明细："]));
    const landUsageRaw = firstNonEmpty(
      text.match(/土地主用途：\s*([^土]+?)\s*土地用途明细：/)?.[1],
      summary.match(/(住宅用地|商服用地|商务金融用地|商业服务业设施用地|一类工业用地（其他工业用地）|二类工业用地（其他工业用地）|二类工业用地|一类物流仓储用地（通用仓储类）|一类物流仓储用地|商务金融用地|工业用地)/)?.[1]
    );
    const landUsage = firstNonEmpty(noticeOverrides.landUsage, landUsageRaw);
    const noticeArea = noticeOverrides.areaHa ?? areaHa ?? parseAreaToHectare(summary.match(/出让面积([0-9.]+平方米\[[0-9.]+亩\])/)?.[1] ?? null);
    const noticeDate = normalizeDate(firstNonEmpty(
      infoItems.find((item) => item.includes("发布时间："))?.split("发布时间：")[1],
      text.match(/发布时间：\s*([0-9-]+)/)?.[1],
      progressItems.find((item) => item.startsWith("公告发布"))?.replace("公告发布", "")
    ));
    const tradeDate = normalizeDate(firstNonEmpty(
      noticeOverrides.tradeDate,
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
    const noticeNoRawRaw = normalizeNoticeNoBySite(this.siteCode, normalizeNoticeNoForDb(firstNonEmpty(
      this.siteCode === "hangzhou" && bizType === "notice" ? hangzhouStrictNoticeNo : null,
      headerLines.subTitleLine,
      noticeOverrides.noticeNoRaw,
      extractZhejiangNoticeNo(announcementText),
      extractZhejiangNoticeNo(text),
      cleanText(parcelNo) || null
    )));
    const noticeNoRaw = noticeNoRawRaw;
    const noticeNoNorm = normalizeNoticeNo(noticeNoRaw);
    const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : null;
    const sourceKey = buildStableSourceKey(this.siteCode, bizType, [noticeNoNorm, parcelNo, sourceUrl]);
    const startPriceWan = firstNonEmpty(
      String(noticeOverrides.startPriceWan ?? ""),
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
          noticeTitle: headerLines.subTitleLine || parcelNo || context.listItem.title,
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
