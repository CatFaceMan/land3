import type { SiteCode } from "../domain/types.js";
import { LandRepository } from "../db/repository.js";

interface SiteRuntimeSnapshot {
  siteCode: SiteCode;
  pageNo: number;
  succeeded: number;
  pending: number;
  running: number;
  retryable: number;
  retried: number;
  failureRate: number;
}

type SiteStatus = "running" | "paused" | "circuit-break" | "idle";

function pad(input: string | number, width: number): string {
  return String(input).padEnd(width, " ");
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatEta(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "--";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${rest}s`;
}

async function buildSiteSnapshots(
  repository: LandRepository,
  siteCodes?: SiteCode[]
): Promise<Map<SiteCode, SiteRuntimeSnapshot>> {
  const taskRows = await repository.listTaskProgress(siteCodes);
  const map = new Map<SiteCode, SiteRuntimeSnapshot>();
  for (const row of taskRows) {
    const current = map.get(row.siteCode) ?? {
      siteCode: row.siteCode,
      pageNo: 0,
      succeeded: 0,
      pending: 0,
      running: 0,
      retryable: 0,
      retried: 0,
      failureRate: 0
    };
    current.pageNo = Math.max(current.pageNo, row.pageNo);
    current.succeeded += row.succeeded;
    current.pending += row.pending;
    current.running += row.running;
    current.retryable += row.retryable;
    current.retried += row.retried;
    map.set(row.siteCode, current);
  }
  for (const item of map.values()) {
    const done = item.succeeded + item.retryable;
    item.failureRate = done > 0 ? item.retryable / done : 0;
  }
  return map;
}

export async function renderLiveMonitor(params: {
  repository: LandRepository;
  siteCodes?: SiteCode[];
  intervalMs?: number;
  runId?: number;
  stopWhenNoRunning?: boolean;
  statusProvider?: (siteCode: SiteCode) => SiteStatus;
}): Promise<void> {
  const intervalMs = params.intervalMs ?? 5000;
  const previous = new Map<SiteCode, { ts: number; succeeded: number; pending: number; running: number; retryable: number }>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    const runningRuns = await params.repository.listRunningRuns();
    const runningSiteSet = new Set<SiteCode>(runningRuns.map((item) => item.siteCode));
    const siteSnapshots = await buildSiteSnapshots(params.repository, params.siteCodes);
    const sites = Array.from(siteSnapshots.values()).sort((a, b) => a.siteCode.localeCompare(b.siteCode));

    if (params.stopWhenNoRunning && runningRuns.length === 0 && sites.length === 0) {
      process.stdout.write("No running crawl tasks.\n");
      return;
    }

    let totalSucceeded = 0;
    let totalRetryable = 0;
    let totalActive = 0;
    let activeSites = 0;
    let circuitBreakSites = 0;

    const lines: string[] = [];
    lines.push(`[monitor] ${new Date(now).toISOString()} interval=${Math.round(intervalMs / 1000)}s${params.runId ? ` runId=${params.runId}` : ""}`);
    lines.push(
      `${pad("site", 12)}${pad("page", 8)}${pad("ok", 10)}${pad("failed", 10)}${pad("retried", 10)}${pad("failure%", 10)}${pad("eta", 10)}status`
    );

    for (const site of sites) {
      const active = site.pending + site.running + site.retryable;
      totalSucceeded += site.succeeded;
      totalRetryable += site.retryable;
      totalActive += active;

      const status = params.statusProvider
        ? params.statusProvider(site.siteCode)
        : (runningSiteSet.has(site.siteCode) ? "running" : "idle");
      if (status === "running") {
        activeSites += 1;
      }
      if (status === "circuit-break") {
        circuitBreakSites += 1;
      }

      const prev = previous.get(site.siteCode);
      let eta: number | null = null;
      if (prev) {
        const dt = Math.max(1, (now - prev.ts) / 1000);
        const progress = Math.max(0, site.succeeded - prev.succeeded);
        if (progress > 0 && active > 0) {
          const rate = progress / dt;
          eta = active / rate;
        }
      }
      previous.set(site.siteCode, {
        ts: now,
        succeeded: site.succeeded,
        pending: site.pending,
        running: site.running,
        retryable: site.retryable
      });

      lines.push(
        `${pad(site.siteCode, 12)}${pad(site.pageNo, 8)}${pad(site.succeeded, 10)}${pad(site.retryable, 10)}${pad(site.retried, 10)}${pad(formatPct(site.failureRate), 10)}${pad(formatEta(eta), 10)}${status}`
      );
    }

    const completionRate = totalSucceeded + totalActive > 0 ? totalSucceeded / (totalSucceeded + totalActive) : 0;
    const globalFailureRate = totalSucceeded + totalRetryable > 0 ? totalRetryable / (totalSucceeded + totalRetryable) : 0;
    lines.push("");
    lines.push(
      `[overview] completion=${formatPct(completionRate)} failure=${formatPct(globalFailureRate)} activeSites=${activeSites} circuitBreakSites=${circuitBreakSites}`
    );

    process.stdout.write("\x1Bc");
    process.stdout.write(`${lines.join("\n")}\n`);

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

