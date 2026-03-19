import type { BizType, CrawlTaskRecord, SiteCode } from "../../domain/types.js";
import type { LandRepository } from "../../db/repository.js";

export class CheckpointStore {
  public constructor(private readonly repository: LandRepository) {}

  public async recoverRunningTasks(siteCode: SiteCode, bizType: BizType): Promise<void> {
    await this.repository.markRunningTasksAsRetryable(siteCode, bizType);
  }

  public async loadWatermark(siteCode: SiteCode, bizType: BizType): Promise<number> {
    return (await this.repository.loadWatermark(siteCode, bizType)) ?? 0;
  }

  public async saveWatermark(siteCode: SiteCode, bizType: BizType, pageNo: number): Promise<void> {
    await this.repository.saveWatermark(siteCode, bizType, pageNo);
  }

  public async saveTasks(tasks: Array<Omit<CrawlTaskRecord, "updatedAt">>): Promise<void> {
    await this.repository.upsertTaskStateBatch(tasks);
  }

  public async loadPending(siteCode: SiteCode, bizType: BizType, pageNo: number): Promise<CrawlTaskRecord[]> {
    return this.repository.loadPendingTasks(siteCode, bizType, pageNo);
  }
}
