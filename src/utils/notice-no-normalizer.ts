function toHalfWidth(input: string): string {
  return input.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
}

export function normalizeNoticeNo(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = toHalfWidth(raw)
    .replace(/\s+/g, "")
    .replace(/[〔【\[]/g, "(")
    .replace(/[〕】\]]/g, ")")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[—–－﹣]/g, "-")
    .trim();
  return normalized || null;
}
