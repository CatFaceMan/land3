import { getRegisteredSiteCodes } from "../adapters/registry.js";
import { LandRepository } from "../db/repository.js";
import type { AppConfig } from "../domain/types.js";
import { runRefresh } from "./refresh-service.js";

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export async function runCollectAll(params: {
  config: AppConfig;
  repository: LandRepository;
  from?: string;
  to?: string;
  maxItems?: number;
}): Promise<{
  from: string;
  to: string;
  sites: Array<Awaited<ReturnType<typeof runRefresh>>>;
}> {
  const now = new Date();
  const from = params.from ?? toIsoDate(addDays(now, -30));
  const to = params.to ?? toIsoDate(now);
  const siteCodes = getRegisteredSiteCodes().filter((siteCode) => params.config.sites[siteCode]?.enabled);
  if (siteCodes.length === 0) {
    throw new Error("No enabled sites found in config. Please set at least one SITE_*_ENABLED=true.");
  }

  const sites: Array<Awaited<ReturnType<typeof runRefresh>>> = [];
  for (const siteCode of siteCodes) {
    const output = await runRefresh({
      config: params.config,
      repository: params.repository,
      siteCode,
      from,
      to,
      maxItems: params.maxItems
    });
    sites.push(output);
  }

  return {
    from,
    to,
    sites
  };
}
