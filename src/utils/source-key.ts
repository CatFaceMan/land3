import { sha256 } from "./hash.js";
import { cleanText } from "./text.js";

function normalizePart(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }
  return text.replace(/\|/g, " ").toUpperCase();
}

export function buildStableSourceKey(
  siteCode: string,
  bizType: "notice" | "result",
  parts: Array<string | null | undefined>
): string {
  const normalizedParts = parts
    .map((part) => normalizePart(part))
    .filter((part): part is string => Boolean(part));
  const payload = [siteCode, bizType, ...normalizedParts].join("|");
  return sha256(payload);
}
