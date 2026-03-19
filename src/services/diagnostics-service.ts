import type { BizType, SiteCode } from "../domain/types.js";
import { LandRepository } from "../db/repository.js";

type FailureReason = "selector_changed" | "date_parse" | "missing_fields" | "anti_crawl" | "network_or_timeout" | "other";

function classifyFailure(message: string): FailureReason {
  const text = message.toLowerCase();
  if (text.includes("selector") || text.includes("locator") || text.includes("element") || text.includes("not found")) {
    return "selector_changed";
  }
  if (text.includes("date") || text.includes("invalid time") || text.includes("invalid date")) {
    return "date_parse";
  }
  if (text.includes("captcha") || text.includes("forbidden") || text.includes("429") || text.includes("blocked")) {
    return "anti_crawl";
  }
  if (text.includes("timeout") || text.includes("net::") || text.includes("econn") || text.includes("navigation")) {
    return "network_or_timeout";
  }
  if (text.includes("undefined") || text.includes("null") || text.includes("cannot read")) {
    return "missing_fields";
  }
  return "other";
}

export async function runFailureDiagnosis(
  repository: LandRepository,
  params: {
    siteCode?: SiteCode;
    bizType?: BizType;
    since?: string;
    topN?: number;
  } = {}
): Promise<{
  generatedAt: string;
  since: string | null;
  sites: Array<{
    siteCode: SiteCode;
    totalFailures: number;
    topFailureReasons: Array<{ reason: FailureReason; count: number }>;
    topManualReviewReasons: Array<{ reasonCode: string; count: number }>;
  }>;
}> {
  const failures = await repository.listRecentFailures({
    siteCode: params.siteCode,
    bizType: params.bizType,
    since: params.since,
    limit: 5000
  });
  const reviewStats = await repository.listManualReviewReasonStats(params.siteCode);
  const topN = params.topN ?? 5;

  const siteMap = new Map<SiteCode, { reasons: Map<FailureReason, number>; total: number }>();
  for (const item of failures) {
    const bucket = siteMap.get(item.siteCode) ?? { reasons: new Map<FailureReason, number>(), total: 0 };
    const reason = classifyFailure(item.errorMessage);
    bucket.total += 1;
    bucket.reasons.set(reason, (bucket.reasons.get(reason) ?? 0) + 1);
    siteMap.set(item.siteCode, bucket);
  }

  const reviewMap = new Map<SiteCode, Array<{ reasonCode: string; count: number }>>();
  for (const item of reviewStats) {
    const list = reviewMap.get(item.siteCode) ?? [];
    list.push({ reasonCode: item.reasonCode, count: item.count });
    reviewMap.set(item.siteCode, list);
  }

  const sites = Array.from(siteMap.entries())
    .map(([siteCode, value]) => ({
      siteCode,
      totalFailures: value.total,
      topFailureReasons: Array.from(value.reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN),
      topManualReviewReasons: (reviewMap.get(siteCode) ?? []).sort((a, b) => b.count - a.count).slice(0, topN)
    }))
    .sort((a, b) => b.totalFailures - a.totalFailures);

  return {
    generatedAt: new Date().toISOString(),
    since: params.since ?? null,
    sites
  };
}

