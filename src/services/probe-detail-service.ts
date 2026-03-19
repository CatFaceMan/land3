import { chromium } from "playwright";
import { getAdapter } from "../adapters/registry.js";
import type { BizType, SiteCode } from "../domain/types.js";

export async function runProbeDetail(params: {
  siteCode: SiteCode;
  bizType: BizType;
  pageNo: number;
  itemIndex: number;
  headless: boolean;
}): Promise<Record<string, unknown>> {
  const adapter = getAdapter(params.siteCode);
  const browser = await chromium.launch({ headless: params.headless });
  try {
    const page = await browser.newPage();
    await adapter.gotoPage(page, params.bizType, params.pageNo);
    const items = await adapter.listItems(page, params.bizType, params.pageNo);
    if (params.itemIndex < 0 || params.itemIndex >= items.length) {
      throw new Error(`Item index ${params.itemIndex} out of range; itemCount=${items.length}`);
    }
    const activePage = await adapter.openDetail(page, params.bizType, params.itemIndex);
    const parsed = await adapter.parseDetail(activePage, params.bizType, {
      listItem: items[params.itemIndex],
      task: {
        siteCode: params.siteCode,
        bizType: params.bizType,
        pageNo: params.pageNo,
        itemIndex: params.itemIndex,
        stage: "detail",
        retryCount: 0,
        l1Index: null,
        l2Index: null
      }
    });
    return {
      siteCode: params.siteCode,
      bizType: params.bizType,
      pageNo: params.pageNo,
      itemIndex: params.itemIndex,
      itemTitle: items[params.itemIndex]?.title,
      finalUrl: activePage.url(),
      parsedCount: parsed.length,
      firstRecord: parsed[0] ?? null
    };
  } finally {
    await browser.close();
  }
}
