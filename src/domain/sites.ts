export const SITE_CODES = [
  "beijing",
  "suzhou",
  "wuxi",
  "changzhou",
  "hangzhou",
  "ningbo",
  "guangzhou",
  "hefei",
  "chengdu",
  "xian",
  "wuhan"
] as const;

export type SiteCode = (typeof SITE_CODES)[number];

export const RATE_LIMITED_SITE_CODES = ["suzhou", "wuxi", "changzhou", "hangzhou", "ningbo"] as const satisfies readonly SiteCode[];

const RATE_LIMITED_SITE_SET = new Set<SiteCode>(RATE_LIMITED_SITE_CODES);

export function isRateLimitedSite(siteCode: SiteCode): boolean {
  return RATE_LIMITED_SITE_SET.has(siteCode);
}
