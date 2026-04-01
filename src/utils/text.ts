export function cleanText(value: string | null | undefined): string {
  return value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

export function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = cleanText(value);
    if (text) {
      return text;
    }
  }
  return null;
}

export function cleanStatus(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  return text.replace(/\([^)]*\)/g, "").replace(/（[^）]*）/g, "").trim();
}

export function normalizeTradeStatus(value: string | null | undefined): "待交易" | "已成交" | "终止" | "中止" | "流拍" | null {
  const text = cleanStatus(value);
  if (!text) {
    return null;
  }
  if (/待交易|公告期|挂牌期|竞价期|交易中|未交易/.test(text)) {
    return "待交易";
  }
  if (/已成交|成交/.test(text)) {
    return "已成交";
  }
  if (/终止/.test(text)) {
    return "终止";
  }
  if (/中止/.test(text)) {
    return "中止";
  }
  if (/流拍|未成交/.test(text)) {
    return "流拍";
  }
  return null;
}
