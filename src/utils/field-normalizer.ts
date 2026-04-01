import { parseChineseNumber } from "./number.js";
import { cleanText, firstNonEmpty } from "./text.js";

function toHalfWidth(input: string): string {
  return input.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

function normalizeBrackets(value: string): string {
  return value
    .replace(/[〔【\[]/g, "(")
    .replace(/[〕】\]]/g, ")")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

export function normalizeNoticeNoCore(raw: string | null | undefined): string | null {
  const text = normalizeBrackets(toHalfWidth(cleanText(raw)));
  if (!text) {
    return null;
  }
  const withoutPrefixes = text
    .replace(/^(?:【[^】]+】\s*)+/, "")
    .replace(/^(?:\[[^\]]+\]\s*)+/, "")
    .replace(/^(?:\([^)]+\)\s*)+/, "")
    .replace(/^(?:公告期|公告名称|公告标题|标题)[:：]?\s*/, "")
    .replace(/^(?:国有建设用地使用权)?(?:挂牌|拍卖)?出让公告[:：]?\s*/, "");
  const strictPatterns = [
    /([^\s,，。；;:：]{1,40}?土出告字\(\d{4}\)(?:[A-Za-z]*\d+|\d+)(?:-\d+)?号)/i,
    /([^\s,，。；;:：]{1,40}?规划资源告\(\d{4}\)(?:[A-Za-z]*\d+|\d+)(?:-\d+)?号)/i,
    /([^\s,，。；;:：]{1,40}?告(?:字)?\(\d{4}\)(?:[A-Za-z]*\d+|\d+)(?:-\d+)?号)/i
  ];
  for (const pattern of strictPatterns) {
    const matched = cleanText(withoutPrefixes.match(pattern)?.[1]);
    if (matched) {
      return matched;
    }
  }
  const fallback = cleanText(withoutPrefixes.match(/([^\s,，。；;:：]{3,40}?号)/)?.[1]);
  return fallback || null;
}

const DISTRICT_PATTERN = /([\u4e00-\u9fa5]{2,20}?(?:新区|开发区|自治县|县|区|市))/g;

export function normalizeDistrict(raw: string | null | undefined): string | null {
  const text = cleanText(raw)
    .replace(/^(?:位于|坐落于|地块位于|宗地位于)/, "")
    .replace(/^[^:：]{0,12}[:：]/, "");
  if (!text) {
    return null;
  }
  const tokens = Array.from(text.matchAll(DISTRICT_PATTERN))
    .map((item) => cleanText(item[1]))
    .filter((item) => item.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  const uniq = Array.from(new Set(tokens));
  const nonCity = uniq.find((item) => /(新区|开发区|区|县)$/.test(item));
  return firstNonEmpty(nonCity, uniq[0]);
}

export function normalizeLandUsage(raw: string | null | undefined): string | null {
  const text = cleanText(raw);
  if (!text) {
    return null;
  }
  const trimmed = text
    .replace(/^[^:：]{0,12}[:：]/, "")
    .replace(/\d{1,3}\s*年/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/(?:其中|备注|说明|注：).*/g, "")
    .replace(/\s+/g, "");
  if (!trimmed) {
    return null;
  }
  if (/(普通商品住房|商品住房|居住|住宅)/.test(trimmed)) {
    return "住宅用地";
  }
  if (/工业/.test(trimmed)) {
    return "工业用地";
  }
  const direct = cleanText(trimmed.match(/([\u4e00-\u9fa5、\/]{2,40}?用地)/)?.[1]);
  return direct || cleanText(trimmed) || null;
}

export function normalizeParcelNo(raw: string | null | undefined): string | null {
  const text = cleanText(raw);
  if (!text) {
    return null;
  }
  return toHalfWidth(text)
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/【/g, "[")
    .replace(/】/g, "]")
    .replace(/〔/g, "[")
    .replace(/〕/g, "]")
    .replace(/\s+/g, "")
    .replace(/\s*\[\s*/g, "[")
    .replace(/\s*\]\s*/g, "]")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")");
}

export function parseTotalStartPriceWan(
  raw: string | null | undefined,
  options: { areaHa?: number | null; areaMu?: number | null; areaSqm?: number | null; buildAreaSqm?: number | null }
): number | null {
  const text = cleanText(raw);
  if (!text) {
    return null;
  }
  if (/万元(?!\/亩)/.test(text) || (/元/.test(text) && !/\/亩|\/平方米|\/建筑平方米/.test(text))) {
    return parseChineseNumber(text);
  }
  const unit = Number(text.match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(unit) || unit <= 0) {
    return null;
  }
  if (/万元\/亩/.test(text)) {
    const areaMu = options.areaMu ?? (options.areaHa && options.areaHa > 0 ? options.areaHa * 15 : null);
    return areaMu && areaMu > 0 ? Number((unit * areaMu).toFixed(4)) : null;
  }
  if (/元\/亩/.test(text)) {
    const areaMu = options.areaMu ?? (options.areaHa && options.areaHa > 0 ? options.areaHa * 15 : null);
    return areaMu && areaMu > 0 ? Number(((unit * areaMu) / 10000).toFixed(4)) : null;
  }
  if (/元\/平方米|元\/建筑平方米|楼面地价/.test(text)) {
    const areaSqm = options.buildAreaSqm ?? options.areaSqm ?? (options.areaHa && options.areaHa > 0 ? options.areaHa * 10000 : null);
    return areaSqm && areaSqm > 0 ? Number(((unit * areaSqm) / 10000).toFixed(4)) : null;
  }
  return null;
}
