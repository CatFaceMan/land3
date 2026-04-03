import { resolve } from "node:path";
import type { AppConfig, ProxyProfile, SiteCode } from "./domain/types.js";
import { RATE_LIMITED_SITE_CODES, SITE_CODES } from "./domain/sites.js";

export const SUPPORTED_SITE_CODES: SiteCode[] = [...SITE_CODES];

const RATE_LIMITED_SITES = new Set<SiteCode>(RATE_LIMITED_SITE_CODES);

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric env ${name}: ${raw}`);
  }
  return value;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === "1" || raw === "true" || raw === "yes";
}

function readProxyProfile(name: string): ProxyProfile {
  return {
    enabled: readBoolean(`${name}_ENABLED`, false),
    server: process.env[`${name}_SERVER`]?.trim(),
    username: process.env[`${name}_USERNAME`]?.trim(),
    password: process.env[`${name}_PASSWORD`]?.trim(),
    fallbackToDirect: readBoolean(`${name}_FALLBACK_TO_DIRECT`, true)
  };
}

export function loadConfig(options?: { allowMissingDatabaseUrl?: boolean }): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl && !options?.allowMissingDatabaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }

  return {
    databaseUrl: databaseUrl ?? "mysql://placeholder:placeholder@127.0.0.1:3306/placeholder",
    browser: {
      headless: readBoolean("BROWSER_HEADLESS", true),
      timeoutMs: readNumber("BROWSER_TIMEOUT_MS", 30000),
      userAgent: process.env.BROWSER_USER_AGENT?.trim(),
      cdpEndpoint: process.env.BROWSER_CDP_ENDPOINT?.trim() || undefined,
      throttle: {
        afterListOpenMs: readNumber("THROTTLE_AFTER_LIST_OPEN_MS", 300),
        beforeDetailClickMs: readNumber("THROTTLE_BEFORE_DETAIL_CLICK_MS", 200),
        afterListReturnMs: readNumber("THROTTLE_AFTER_LIST_RETURN_MS", 300),
        afterPageTurnMs: readNumber("THROTTLE_AFTER_PAGE_TURN_MS", 500)
      },
      retry: {
        detailRetries: readNumber("DETAIL_RETRIES", 2),
        contextResetThreshold: readNumber("CONTEXT_RESET_THRESHOLD", 3)
      }
    },
    proxies: {
      global: readProxyProfile("PROXY_GLOBAL")
    },
    sites: Object.fromEntries(
      SUPPORTED_SITE_CODES.map((siteCode) => {
        const prefix = `SITE_${siteCode.toUpperCase()}`;
        const proxyProfile = process.env[`${prefix}_PROXY_PROFILE`]?.trim();
        const defaultDetailConcurrency = RATE_LIMITED_SITES.has(siteCode) ? 1 : 5;
        const defaultExtraDelayMs = RATE_LIMITED_SITES.has(siteCode) ? 2500 : 0;
        return [
          siteCode,
          {
            enabled: readBoolean(`${prefix}_ENABLED`, true),
            proxyProfile: proxyProfile && proxyProfile.length > 0 ? proxyProfile : undefined,
            detailConcurrency: readNumber(`${prefix}_DETAIL_CONCURRENCY`, defaultDetailConcurrency),
            extraDelayMs: readNumber(`${prefix}_EXTRA_DELAY_MS`, defaultExtraDelayMs),
            delayJitterMs: readNumber(`${prefix}_DELAY_JITTER_MS`, 0),
            blockCooldownMs: readNumber(`${prefix}_BLOCK_COOLDOWN_MS`, 0),
            maxConsecutiveMissingDatePages: readNumber(`${prefix}_MAX_MISSING_DATE_PAGES`, 8),
            storageStatePath: process.env[`${prefix}_STORAGE_STATE_PATH`]?.trim() || undefined,
            challengeWaitMs: readNumber(`${prefix}_CHALLENGE_WAIT_MS`, 0)
          }
        ];
      })
    ) as AppConfig["sites"],
    artifactRoot: resolve(process.env.ARTIFACT_ROOT?.trim() || "output/artifacts")
  };
}

export function validateConfig(config: AppConfig): string[] {
  const warnings: string[] = [];
  const enabledSites = Object.entries(config.sites).filter(([, runtime]) => runtime.enabled).length;
  if (enabledSites === 0) {
    warnings.push("No sites are enabled (SITE_*_ENABLED=false for all sites).");
  }

  for (const [siteCode, runtime] of Object.entries(config.sites)) {
    if (!runtime.proxyProfile) {
      continue;
    }
    if (!config.proxies[runtime.proxyProfile]) {
      warnings.push(`Site ${siteCode} references unknown proxy profile: ${runtime.proxyProfile}`);
    }
  }
  return warnings;
}

export function assertSiteEnabled(config: AppConfig, siteCode: SiteCode): void {
  if (!config.sites[siteCode]?.enabled) {
    throw new Error(`Site ${siteCode} is disabled. Set SITE_${siteCode.toUpperCase()}_ENABLED=true to run.`);
  }
}
