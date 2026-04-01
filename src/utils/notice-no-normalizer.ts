import { normalizeNoticeNoCore } from "./field-normalizer.js";

function toHalfWidth(input: string): string {
  return input.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

export function normalizeNoticeNo(raw: string | null | undefined): string | null {
  const core = normalizeNoticeNoCore(raw);
  if (!core) {
    return null;
  }
  const normalized = toHalfWidth(core)
    .replace(/\s+/g, "")
    .replace(/[〔【\[]/g, "(")
    .replace(/[〕】\]]/g, ")")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[—–－﹣]/g, "-")
    .trim();
  return normalized || null;
}
