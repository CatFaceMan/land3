import { ConfiguredHtmlSiteAdapter } from "./base-html-adapter.js";
import { beijingAdapter } from "./beijing.js";
import { chengduAdapter } from "./chengdu.js";
import { guangzhouAdapter } from "./guangzhou.js";
import { hefeiAdapter } from "./hefei.js";
import { changzhouAdapter, suzhouAdapter, wuxiAdapter } from "./jiangsu.js";
import { wuhanAdapter } from "./wuhan.js";
import { xianAdapter } from "./xian.js";
import { hangzhouAdapter, ningboAdapter } from "./zhejiang.js";
import type { GenericSiteConfig, SiteAdapter } from "./site-adapter.js";

function createAdapter(config: GenericSiteConfig): SiteAdapter {
  return new ConfiguredHtmlSiteAdapter(config);
}

const adapters: SiteAdapter[] = [
  beijingAdapter,
  suzhouAdapter,
  wuxiAdapter,
  changzhouAdapter,
  hangzhouAdapter,
  ningboAdapter,
  guangzhouAdapter,
  hefeiAdapter,
  chengduAdapter,
  xianAdapter,
  wuhanAdapter
];

export function getRegisteredAdapters(): SiteAdapter[] {
  return adapters;
}

export function getAdapter(siteCode: SiteAdapter["siteCode"]): SiteAdapter {
  const adapter = adapters.find((item) => item.siteCode === siteCode);
  if (!adapter) {
    throw new Error(`Unknown site code: ${siteCode}`);
  }
  return adapter;
}

export function getRegisteredSiteCodes(): Array<SiteAdapter["siteCode"]> {
  return adapters.map((adapter) => adapter.siteCode);
}

export function getSiteProbeUrl(siteCode: SiteAdapter["siteCode"]): string {
  return getAdapter(siteCode).getEntryUrl("notice");
}
