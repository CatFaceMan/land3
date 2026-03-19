import { chromium } from "playwright";
import { getSiteProbeUrl } from "../adapters/registry.js";
import { assertSiteEnabled, validateConfig } from "../config.js";
import type { AppConfig, SiteCode } from "../domain/types.js";
import { createPool } from "../db/connection.js";

export async function runDoctor(
  config: AppConfig,
  options?: { siteCode?: SiteCode; skipDb?: boolean }
): Promise<Record<string, unknown>> {
  const diagnostics: Record<string, unknown> = {
    configWarnings: validateConfig(config)
  };
  if (!options?.skipDb) {
    const pool = createPool(config);
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      diagnostics.database = "ok";
    } finally {
      await pool.end();
    }
  } else {
    diagnostics.database = "skipped";
  }

  const browser = await chromium.launch({ headless: true });
  try {
    diagnostics.playwright = "ok";
    if (options?.siteCode) {
      assertSiteEnabled(config, options.siteCode);
      const page = await browser.newPage();
      const probeUrl = getSiteProbeUrl(options.siteCode);
      const response = await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      diagnostics.site = { siteCode: options.siteCode, probeUrl, status: response?.status() ?? null, finalUrl: page.url() };
      await page.close();
    }
  } finally {
    await browser.close();
  }

  return diagnostics;
}
