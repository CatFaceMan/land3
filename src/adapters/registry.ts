import { beijingAdapter } from "./beijing.js";
import { chengduAdapter } from "./chengdu.js";
import { guangzhouAdapter } from "./guangzhou.js";
import { hefeiAdapter } from "./hefei.js";
import { changzhouAdapter, suzhouAdapter, wuxiAdapter } from "./jiangsu.js";
import { wuhanAdapter } from "./wuhan.js";
import { xianAdapter } from "./xian.js";
import { hangzhouAdapter, ningboAdapter } from "./zhejiang.js";
import type { SiteAdapter } from "./site-adapter.js";
import { SITE_CODES, type SiteCode } from "../domain/sites.js";

const adapterBySite: Record<SiteCode, SiteAdapter> = {
  beijing: beijingAdapter,
  suzhou: suzhouAdapter,
  wuxi: wuxiAdapter,
  changzhou: changzhouAdapter,
  hangzhou: hangzhouAdapter,
  ningbo: ningboAdapter,
  guangzhou: guangzhouAdapter,
  hefei: hefeiAdapter,
  chengdu: chengduAdapter,
  xian: xianAdapter,
  wuhan: wuhanAdapter
};

const adapters: SiteAdapter[] = SITE_CODES.map((siteCode) => adapterBySite[siteCode]);

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
