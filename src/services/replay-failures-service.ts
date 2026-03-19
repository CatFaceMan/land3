import { getAdapter } from "../adapters/registry.js";
import { LandRepository } from "../db/repository.js";
import type { AppConfig, BizType, CrawlTaskState, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
import { BrowserKernel } from "../kernel/browser-kernel.js";
import { mergeNoticeAndResults } from "./merge-service.js";

function resolveProxy(config: AppConfig, siteCode: SiteCode) {
  const runtime = config.sites[siteCode];
  if (runtime.proxyProfile) {
    return config.proxies[runtime.proxyProfile] ?? null;
  }
  return config.proxies.global ?? null;
}

export async function runReplayFailures(params: {
  config: AppConfig;
  repository: LandRepository;
  siteCode: SiteCode;
  bizType: BizType;
  since: string;
  limit?: number;
}): Promise<{
  siteCode: SiteCode;
  bizType: BizType;
  since: string;
  scannedFailures: number;
  replayed: number;
  saved: number;
  failed: number;
}> {
  const failures = await params.repository.listRecentFailures({
    siteCode: params.siteCode,
    bizType: params.bizType,
    since: params.since,
    limit: params.limit ?? 500
  });
  const unique = new Map<string, (typeof failures)[number]>();
  for (const item of failures.reverse()) {
    const key = item.currentUrl ?? `${item.pageNo}:${item.itemIndex}:${item.id}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }
  const tasks = Array.from(unique.values());
  const adapter = getAdapter(params.siteCode);
  const kernel = new BrowserKernel(params.config, params.siteCode, resolveProxy(params.config, params.siteCode));
  let replayed = 0;
  let saved = 0;
  let failed = 0;
  const notices: ParsedNoticeRecord[] = [];
  const results: ParsedResultRecord[] = [];

  try {
    for (const item of tasks) {
      if (!item.currentUrl) {
        failed += 1;
        continue;
      }
      replayed += 1;
      const page = await kernel.newPage();
      try {
        await page.goto(item.currentUrl, { waitUntil: "domcontentloaded", timeout: Math.max(10_000, params.config.browser.timeoutMs * 2) });
        const taskState: CrawlTaskState = {
          siteCode: params.siteCode,
          bizType: params.bizType,
          pageNo: item.pageNo,
          itemIndex: item.itemIndex,
          stage: "detail",
          retryCount: 0,
          l1Index: null,
          l2Index: null
        };
        const parsed = await adapter.parseDetail(page, params.bizType, {
          listItem: {
            title: item.itemTitle ?? `replay-${item.pageNo}-${item.itemIndex}`,
            url: item.currentUrl,
            pageNo: item.pageNo,
            itemIndex: item.itemIndex
          },
          task: taskState
        });
        if (params.bizType === "notice") {
          const typed = parsed as ParsedNoticeRecord[];
          notices.push(...typed);
          saved += typed.length;
        } else {
          const typed = parsed as ParsedResultRecord[];
          results.push(...typed);
          saved += typed.length;
        }
      } catch (error) {
        failed += 1;
        await params.repository.saveFailure({
          siteCode: params.siteCode,
          bizType: params.bizType,
          pageNo: item.pageNo,
          itemIndex: item.itemIndex,
          stage: "detail",
          currentUrl: item.currentUrl,
          itemTitle: item.itemTitle,
          screenshotPath: null,
          htmlPath: null,
          errorMessage: error instanceof Error ? error.message : String(error),
          l1Index: null,
          l2Index: null
        });
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    if (notices.length > 0) {
      await params.repository.upsertNoticeBatch(notices);
    }
    if (results.length > 0) {
      await params.repository.upsertResultBatch(results);
    }

    const noticeRecords = await params.repository.listNoticeRaw(params.siteCode);
    const resultRecords = await params.repository.listResultRaw(params.siteCode);
    const merged = mergeNoticeAndResults(params.siteCode, noticeRecords, resultRecords);
    await params.repository.upsertMergedBatch(params.siteCode, merged.records, merged.reviewPool);

    return {
      siteCode: params.siteCode,
      bizType: params.bizType,
      since: params.since,
      scannedFailures: failures.length,
      replayed,
      saved,
      failed
    };
  } finally {
    await kernel.close();
  }
}
