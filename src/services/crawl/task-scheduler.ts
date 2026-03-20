import type { SiteAdapter } from "../../adapters/site-adapter.js";
import type { Page } from "playwright";
import type { CrawlContext, ItemTask } from "./types.js";

export class TaskScheduler {
  public constructor(private readonly adapter: SiteAdapter) {}

  public async bootstrap(context: CrawlContext): Promise<number> {
    void context;
    return 0;
  }

  public async listPageTasks(context: CrawlContext, page: Page, pageNo: number): Promise<ItemTask[]> {
    const items = await this.adapter.listItems(page, context.bizType, pageNo);
    if (items.length === 0) {
      return [];
    }
    return items.map((item, index) => ({
      siteCode: context.siteCode,
      bizType: context.bizType,
      pageNo,
      itemIndex: index,
      status: "pending",
      attempt: 0,
      listItem: item
    }));
  }

  public async completePage(context: CrawlContext, pageNo: number): Promise<void> {
    void context;
    void pageNo;
  }
}
