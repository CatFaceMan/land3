const WAN_MULTIPLIERS: Array<[RegExp, number]> = [
  [/亿元?/, 10000],
  [/万元?/, 1],
  [/元/, 0.0001]
];

export function parseChineseNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const raw = value.replace(/[,，\s]/g, "");
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const base = Number(match[0]);
  if (!Number.isFinite(base)) {
    return null;
  }
  for (const [pattern, multiplier] of WAN_MULTIPLIERS) {
    if (pattern.test(raw)) {
      return Number((base * multiplier).toFixed(4));
    }
  }
  return base;
}

export function parseAreaToHectare(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number((value / 10000).toFixed(4));
  }
  const raw = value.replace(/[,，\s]/g, "");
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const base = Number(match[0]);
  if (!Number.isFinite(base)) {
    return null;
  }
  if (/公顷|ha/i.test(raw)) {
    return Number(base.toFixed(4));
  }
  if (/平方米|㎡|m2|m²/i.test(raw)) {
    return Number((base / 10000).toFixed(4));
  }
  if (/亩/.test(raw)) {
    return Number((base / 15).toFixed(4));
  }
  return Number(base.toFixed(4));
}
