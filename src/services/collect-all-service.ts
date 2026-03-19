import { getRegisteredSiteCodes } from "../adapters/registry.js";
import { LandRepository } from "../db/repository.js";
import type { AppConfig, BizType, SiteCode } from "../domain/types.js";
import { mergeNoticeAndResults } from "./merge-service.js";
import { runCrawl, type CrawlOutput } from "./crawl-service.js";
import { runFailureDiagnosis } from "./diagnostics-service.js";
import { renderLiveMonitor } from "./monitor-service.js";

type SiteRunStatus = "running" | "paused" | "circuit-break" | "idle";

interface SiteRunState {
  status: SiteRunStatus;
  consecutiveBizFailures: number;
  mode: "concurrent" | "serial";
}

function toIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function getProcessedFromSummaries(summaries: Awaited<ReturnType<LandRepository["listRunSummariesBySite"]>>): {
  processed: number;
  failed: number;
} {
  let processed = 0;
  let failed = 0;
  for (const item of summaries) {
    const metrics = item.metrics;
    if (!metrics) {
      continue;
    }
    processed += metrics.processedTasks;
    failed += metrics.failedTasks;
  }
  return { processed, failed };
}

async function runOneBiz(params: {
  config: AppConfig;
  repository: LandRepository;
  siteCode: SiteCode;
  bizType: BizType;
  from: string;
  to: string;
  maxItems?: number;
}): Promise<CrawlOutput> {
  return runCrawl({
    config: params.config,
    repository: params.repository,
    siteCode: params.siteCode,
    bizType: params.bizType,
    from: params.from,
    to: params.to,
    maxItems: params.maxItems
  });
}

async function runSiteAndMerge(params: {
  config: AppConfig;
  repository: LandRepository;
  siteCode: SiteCode;
  from: string;
  to: string;
  concurrentBiz: boolean;
  maxItems?: number;
}): Promise<{
  siteCode: SiteCode;
  mode: "concurrent" | "serial";
  noticeSaved: number;
  resultSaved: number;
  failureTasks: number;
  pagesVisited: number;
  records: number;
  reviewRows: number;
}> {
  let noticeOutput: CrawlOutput | null = null;
  let resultOutput: CrawlOutput | null = null;
  if (params.concurrentBiz) {
    const [noticeResult, resultResult] = await Promise.allSettled([
      runOneBiz({
        config: params.config,
        repository: params.repository,
        siteCode: params.siteCode,
        bizType: "notice",
        from: params.from,
        to: params.to,
        maxItems: params.maxItems
      }),
      runOneBiz({
        config: params.config,
        repository: params.repository,
        siteCode: params.siteCode,
        bizType: "result",
        from: params.from,
        to: params.to,
        maxItems: params.maxItems
      })
    ]);
    if (noticeResult.status === "fulfilled") {
      noticeOutput = noticeResult.value;
    } else {
      noticeOutput = await runOneBiz({
        config: params.config,
        repository: params.repository,
        siteCode: params.siteCode,
        bizType: "notice",
        from: params.from,
        to: params.to,
        maxItems: params.maxItems
      });
    }
    if (resultResult.status === "fulfilled") {
      resultOutput = resultResult.value;
    } else {
      resultOutput = await runOneBiz({
        config: params.config,
        repository: params.repository,
        siteCode: params.siteCode,
        bizType: "result",
        from: params.from,
        to: params.to,
        maxItems: params.maxItems
      });
    }
  } else {
    noticeOutput = await runOneBiz({
      config: params.config,
      repository: params.repository,
      siteCode: params.siteCode,
      bizType: "notice",
      from: params.from,
      to: params.to,
      maxItems: params.maxItems
    });
    resultOutput = await runOneBiz({
      config: params.config,
      repository: params.repository,
      siteCode: params.siteCode,
      bizType: "result",
      from: params.from,
      to: params.to,
      maxItems: params.maxItems
    });
  }

  const noticeRecords = await params.repository.listNoticeRaw(params.siteCode);
  const resultRecords = await params.repository.listResultRaw(params.siteCode);
  const merged = mergeNoticeAndResults(params.siteCode, noticeRecords, resultRecords);
  await params.repository.upsertMergedBatch(params.siteCode, merged.records, merged.reviewPool);

  return {
    siteCode: params.siteCode,
    mode: params.concurrentBiz ? "concurrent" : "serial",
    noticeSaved: noticeOutput.summary.noticesSaved,
    resultSaved: resultOutput.summary.resultsSaved,
    failureTasks: noticeOutput.summary.failures + resultOutput.summary.failures,
    pagesVisited: noticeOutput.summary.pagesVisited + resultOutput.summary.pagesVisited,
    records: merged.records.length,
    reviewRows: merged.reviewPool.length
  };
}

function toDirectConfig(config: AppConfig, siteCode: SiteCode): AppConfig {
  const nextSites: AppConfig["sites"] = { ...config.sites };
  nextSites[siteCode] = {
    ...nextSites[siteCode],
    proxyProfile: undefined
  };
  return {
    ...config,
    sites: nextSites
  };
}

export async function runCollectAll(params: {
  config: AppConfig;
  repository: LandRepository;
  from?: string;
  to?: string;
  allSites?: boolean;
  monitor?: boolean;
  concurrentBiz?: boolean;
  failRateThreshold?: number;
  circuitBreakFailures?: number;
  circuitBreakCooldownMs?: number;
  maxItems?: number;
}): Promise<{
  from: string;
  to: string;
  failRateThreshold: number;
  circuitBreakFailures: number;
  circuitBreakCooldownMs: number;
  diagnosis: Awaited<ReturnType<typeof runFailureDiagnosis>>;
  sites: Array<{
    siteCode: SiteCode;
    mode: "concurrent" | "serial";
    noticeSaved: number;
    resultSaved: number;
    failureTasks: number;
    pagesVisited: number;
    records: number;
    reviewRows: number;
  }>;
}> {
  const now = new Date();
  const from = params.from ?? toIsoDate(addDays(now, -30));
  const to = params.to ?? toIsoDate(now);
  const failRateThreshold = params.failRateThreshold ?? 0.15;
  const circuitBreakFailures = params.circuitBreakFailures ?? 8;
  const circuitBreakCooldownMs = params.circuitBreakCooldownMs ?? 10 * 60 * 1000;
  const baseConcurrentBiz = params.concurrentBiz ?? true;
  const siteCodes = getRegisteredSiteCodes();
  const state = new Map<SiteCode, SiteRunState>(
    siteCodes.map((siteCode) => [siteCode, { status: "idle", consecutiveBizFailures: 0, mode: baseConcurrentBiz ? "concurrent" : "serial" }])
  );

  const diagnosis = await runFailureDiagnosis(params.repository, {
    since: from,
    topN: 5
  });

  const monitorPromise = params.monitor
    ? renderLiveMonitor({
        repository: params.repository,
        siteCodes,
        intervalMs: 5000,
        stopWhenNoRunning: true,
        statusProvider: (siteCode) => state.get(siteCode)?.status ?? "idle"
      })
    : null;

  const tasks = siteCodes.map(async (siteCode) => {
    const siteState = state.get(siteCode);
    if (!siteState) {
      throw new Error(`Missing state for site ${siteCode}`);
    }
    siteState.status = "running";

    const summaries = await params.repository.listRunSummariesBySite(siteCode, 50);
    const recent = getProcessedFromSummaries(summaries);
    const historicalFailRate = recent.processed > 0 ? recent.failed / recent.processed : 0;
    const concurrentBiz = baseConcurrentBiz && historicalFailRate <= failRateThreshold;
    siteState.mode = concurrentBiz ? "concurrent" : "serial";

    try {
      const output = await runSiteAndMerge({
        config: params.config,
        repository: params.repository,
        siteCode,
        from,
        to,
        concurrentBiz,
        maxItems: params.maxItems
      });
      siteState.status = "idle";
      siteState.consecutiveBizFailures = 0;
      return output;
    } catch (error) {
      const proxyProfileName = params.config.sites[siteCode].proxyProfile;
      const proxyProfile = proxyProfileName ? params.config.proxies[proxyProfileName] : null;
      if (proxyProfile?.enabled && proxyProfile.fallbackToDirect) {
        const fallbackOutput = await runSiteAndMerge({
          config: toDirectConfig(params.config, siteCode),
          repository: params.repository,
          siteCode,
          from,
          to,
          concurrentBiz: false,
          maxItems: params.maxItems
        });
        siteState.status = "idle";
        siteState.consecutiveBizFailures = 0;
        return fallbackOutput;
      } else {
        siteState.consecutiveBizFailures += 1;
        if (siteState.consecutiveBizFailures >= circuitBreakFailures) {
          siteState.status = "circuit-break";
          await new Promise((resolve) => setTimeout(resolve, circuitBreakCooldownMs));
          siteState.consecutiveBizFailures = 0;
        }
        siteState.status = "idle";
        throw error;
      }
    }
  });

  const settled = await Promise.allSettled(tasks);
  const sites = settled
    .map((item, index) => ({ item, siteCode: siteCodes[index] }))
    .filter((entry): entry is { item: PromiseFulfilledResult<Awaited<typeof tasks[number]>>; siteCode: SiteCode } => entry.item.status === "fulfilled")
    .map((entry) => entry.item.value);
  const failedSites = settled
    .map((item, index) => ({ item, siteCode: siteCodes[index] }))
    .filter((entry): entry is { item: PromiseRejectedResult; siteCode: SiteCode } => entry.item.status === "rejected");

  if (monitorPromise) {
    await monitorPromise;
  }

  if (failedSites.length > 0) {
    const errors = failedSites.map((entry) => `${entry.siteCode}: ${String(entry.item.reason)}`).join("; ");
    throw new Error(`collect-all has failed sites -> ${errors}`);
  }

  return {
    from,
    to,
    failRateThreshold,
    circuitBreakFailures,
    circuitBreakCooldownMs,
    diagnosis,
    sites
  };
}
