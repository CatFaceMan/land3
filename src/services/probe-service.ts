import { chromium } from "playwright";
import { getAdapter, getSiteProbeUrl } from "../adapters/registry.js";
import { assertSiteEnabled } from "../config.js";
import type { AppConfig, BizType, SiteCode } from "../domain/types.js";

export async function runProbe(params: {
  config: AppConfig;
  siteCode: SiteCode;
  bizType: BizType;
  headless: boolean;
}): Promise<Record<string, unknown>> {
  assertSiteEnabled(params.config, params.siteCode);
  const adapter = getAdapter(params.siteCode);
  const browser = await chromium.launch({ headless: params.headless });
  try {
    const page = await browser.newPage();
    await adapter.openEntry(page, params.bizType);
    const items = await adapter.listItems(page, params.bizType, 1);
    return {
      siteCode: params.siteCode,
      bizType: params.bizType,
      probeUrl: getSiteProbeUrl(params.siteCode),
      url: page.url(),
      itemCount: items.length,
      firstItems: items.slice(0, 5).map((item) => item.title)
    };
  } finally {
    await browser.close();
  }
}
