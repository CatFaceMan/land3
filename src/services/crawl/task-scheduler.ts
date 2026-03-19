import type { SiteAdapter } from "../../adapters/site-adapter.js";
import type { CrawlTaskRecord } from "../../domain/types.js";
import type { Page } from "playwright";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { CrawlContext, ItemTask } from "./types.js";

export class TaskScheduler {
  public constructor(
    private readonly adapter: SiteAdapter,
    private readonly checkpointStore: CheckpointStore
  ) {}

  public async bootstrap(context: CrawlContext): Promise<number> {
    await this.checkpointStore.recoverRunningTasks(context.siteCode, context.bizType);
    return this.checkpointStore.loadWatermark(context.siteCode, context.bizType);
  }

  public async listPageTasks(context: CrawlContext, page: Page, pageNo: number): Promise<ItemTask[]> {
    const items = await this.adapter.listItems(page, context.bizType, pageNo);
    if (items.length === 0) {
      return [];
    }
    const records: Array<Omit<CrawlTaskRecord, "updatedAt">> = items.map((item, index) => ({
      siteCode: context.siteCode,
      bizType: context.bizType,
      pageNo,
      itemIndex: index,
      status: "pending",
      attempt: 0,
      title: item.title,
      url: item.url ?? null,
      publishedAt: item.publishedAt ?? null,
      lastError: null
    }));
    await this.checkpointStore.saveTasks(records);
    const pending = await this.checkpointStore.loadPending(context.siteCode, context.bizType, pageNo);
    return pending
      .map((record) => this.toItemTask(record, items[record.itemIndex]))
      .filter((task): task is ItemTask => Boolean(task));
  }

  public async completePage(context: CrawlContext, pageNo: number): Promise<void> {
    await this.checkpointStore.saveWatermark(context.siteCode, context.bizType, pageNo);
  }

  private toItemTask(record: CrawlTaskRecord, listItem: ItemTask["listItem"] | undefined): ItemTask | null {
    if (!listItem) {
      return null;
    }
    return {
      siteCode: record.siteCode,
      bizType: record.bizType,
      pageNo: record.pageNo,
      itemIndex: record.itemIndex,
      status: record.status,
      attempt: record.attempt,
      listItem
    };
  }
}
