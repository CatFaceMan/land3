import type { Pool, ResultSetHeader } from "mysql2/promise";
import type {
  BizType,
  CrawlRunSummary,
  CrawlTaskRecord,
  CrawlTaskStatus,
  FailureRecord,
  ManualReviewRecord,
  MergedLandRecord,
  ParsedNoticeRecord,
  ParsedResultRecord,
  SiteCode
} from "../domain/types.js";
import type { DbRow } from "./connection.js";

export class LandRepository {
  public constructor(private readonly pool: Pool) {}

  public async createCrawlRun(input: { siteCode: SiteCode; bizType: BizType; from?: string; to?: string }): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO crawl_runs (site_code, biz_type, range_from, range_to, status) VALUES (?, ?, ?, ?, 'running')`,
      [input.siteCode, input.bizType, input.from ?? null, input.to ?? null]
    );
    return Number(result.insertId);
  }

  public async finishCrawlRun(runId: number, status: "success" | "failed", stats: CrawlRunSummary, error?: string): Promise<void> {
    await this.pool.execute(
      `UPDATE crawl_runs SET status = ?, stats_json = CAST(? AS JSON), error_message = ? WHERE id = ?`,
      [status, JSON.stringify(stats), error ?? null, runId]
    );
  }

  public async saveFailure(record: FailureRecord): Promise<void> {
    await this.pool.execute(
      `INSERT INTO crawl_failures (
        site_code, biz_type, page_no, item_index, stage, current_url, item_title, screenshot_path,
        html_path, error_message, l1_index, l2_index
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.siteCode,
        record.bizType,
        record.pageNo,
        record.itemIndex,
        record.stage,
        record.currentUrl,
        record.itemTitle,
        record.screenshotPath,
        record.htmlPath,
        record.errorMessage,
        record.l1Index ?? null,
        record.l2Index ?? null
      ]
    );
  }

  public async upsertNoticeBatch(records: ParsedNoticeRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.insertInBatches(records, 300, async (batch) => {
      const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = batch.flatMap((record) => [
        record.siteCode,
        record.sourceKey,
        record.sourceUrl,
        record.sourceTitle,
        record.city,
        record.district,
        record.noticeTitle,
        record.noticeNoRaw,
        record.noticeNoNorm,
        record.normalizedAnnouncementNo ?? null,
        record.landUsage,
        record.areaHa,
        record.startPriceWan,
        record.noticeDate,
        record.tradeDate,
        record.parcelNo,
        record.parcelCode ?? null,
        record.contentText,
        record.rawHtml,
        record.attachmentsJson,
        record.crawlTime,
        new Date()
      ]);
      await this.pool.execute(
        `INSERT INTO land_notice_raw (
          site_code, source_key, source_url, source_title, city, district, notice_title, notice_no_raw, notice_no_norm,
          normalized_announcement_no, land_usage, area_ha, start_price_wan, notice_date, trade_date, parcel_no, parcel_code,
          content_text, raw_html, attachments_json, crawl_time, updated_at
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          source_url=VALUES(source_url), source_title=VALUES(source_title), city=VALUES(city), district=VALUES(district),
          notice_title=VALUES(notice_title), notice_no_raw=VALUES(notice_no_raw), notice_no_norm=VALUES(notice_no_norm),
          normalized_announcement_no=VALUES(normalized_announcement_no), land_usage=VALUES(land_usage), area_ha=VALUES(area_ha),
          start_price_wan=VALUES(start_price_wan), notice_date=VALUES(notice_date), trade_date=VALUES(trade_date),
          parcel_no=VALUES(parcel_no), parcel_code=VALUES(parcel_code), content_text=VALUES(content_text),
          raw_html=VALUES(raw_html), attachments_json=VALUES(attachments_json), crawl_time=VALUES(crawl_time), updated_at=VALUES(updated_at)`,
        values
      );
    });
  }

  public async upsertResultBatch(records: ParsedResultRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.insertInBatches(records, 300, async (batch) => {
      const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = batch.flatMap((record) => [
        record.siteCode,
        record.sourceKey,
        record.sourceUrl,
        record.sourceTitle,
        record.city,
        record.district,
        record.resultTitle,
        record.noticeNoRaw,
        record.noticeNoNorm,
        record.normalizedAnnouncementNo ?? null,
        record.dealPriceWan,
        record.winner,
        record.status,
        record.dealDate,
        record.parcelNo,
        record.parcelCode ?? null,
        record.contentText,
        record.rawHtml,
        record.attachmentsJson,
        record.crawlTime,
        new Date()
      ]);
      await this.pool.execute(
        `INSERT INTO land_result_raw (
          site_code, source_key, source_url, source_title, city, district, result_title, notice_no_raw, notice_no_norm,
          normalized_announcement_no, deal_price_wan, winner, status, deal_date, parcel_no, parcel_code,
          content_text, raw_html, attachments_json, crawl_time, updated_at
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          source_url=VALUES(source_url), source_title=VALUES(source_title), city=VALUES(city), district=VALUES(district),
          result_title=VALUES(result_title), notice_no_raw=VALUES(notice_no_raw), notice_no_norm=VALUES(notice_no_norm),
          normalized_announcement_no=VALUES(normalized_announcement_no), deal_price_wan=VALUES(deal_price_wan),
          winner=VALUES(winner), status=VALUES(status), deal_date=VALUES(deal_date), parcel_no=VALUES(parcel_no),
          parcel_code=VALUES(parcel_code), content_text=VALUES(content_text), raw_html=VALUES(raw_html),
          attachments_json=VALUES(attachments_json), crawl_time=VALUES(crawl_time), updated_at=VALUES(updated_at)`,
        values
      );
    });
  }

  public async listNoticeRaw(siteCode: SiteCode): Promise<ParsedNoticeRecord[]> {
    const [rows] = await this.pool.query<DbRow[]>(`SELECT * FROM land_notice_raw WHERE site_code = ? ORDER BY id ASC`, [siteCode]);
    return rows.map((row) => ({
      siteCode,
      sourceKey: String(row.source_key),
      sourceUrl: String(row.source_url),
      sourceTitle: row.source_title ? String(row.source_title) : "",
      city: String(row.city),
      district: row.district ? String(row.district) : null,
      noticeTitle: row.notice_title ? String(row.notice_title) : "",
      noticeNoRaw: row.notice_no_raw ? String(row.notice_no_raw) : null,
      noticeNoNorm: row.notice_no_norm ? String(row.notice_no_norm) : null,
      normalizedAnnouncementNo: row.normalized_announcement_no ? String(row.normalized_announcement_no) : null,
      landUsage: row.land_usage ? String(row.land_usage) : null,
      areaHa: row.area_ha === null ? null : Number(row.area_ha),
      startPriceWan: row.start_price_wan === null ? null : Number(row.start_price_wan),
      noticeDate: row.notice_date ? String(row.notice_date) : null,
      tradeDate: row.trade_date ? String(row.trade_date) : null,
      parcelNo: row.parcel_no ? String(row.parcel_no) : null,
      parcelCode: row.parcel_code ? String(row.parcel_code) : null,
      contentText: row.content_text ? String(row.content_text) : "",
      rawHtml: row.raw_html ? String(row.raw_html) : "",
      attachmentsJson: row.attachments_json ? String(row.attachments_json) : null,
      crawlTime: new Date(String(row.crawl_time))
    }));
  }

  public async listResultRaw(siteCode: SiteCode): Promise<ParsedResultRecord[]> {
    const [rows] = await this.pool.query<DbRow[]>(`SELECT * FROM land_result_raw WHERE site_code = ? ORDER BY id ASC`, [siteCode]);
    return rows.map((row) => ({
      siteCode,
      sourceKey: String(row.source_key),
      sourceUrl: String(row.source_url),
      sourceTitle: row.source_title ? String(row.source_title) : "",
      city: String(row.city),
      district: row.district ? String(row.district) : null,
      resultTitle: row.result_title ? String(row.result_title) : "",
      noticeNoRaw: row.notice_no_raw ? String(row.notice_no_raw) : null,
      noticeNoNorm: row.notice_no_norm ? String(row.notice_no_norm) : null,
      normalizedAnnouncementNo: row.normalized_announcement_no ? String(row.normalized_announcement_no) : null,
      dealPriceWan: row.deal_price_wan === null ? null : Number(row.deal_price_wan),
      winner: row.winner ? String(row.winner) : null,
      status: row.status ? String(row.status) : null,
      dealDate: row.deal_date ? String(row.deal_date) : null,
      parcelNo: row.parcel_no ? String(row.parcel_no) : null,
      parcelCode: row.parcel_code ? String(row.parcel_code) : null,
      contentText: row.content_text ? String(row.content_text) : "",
      rawHtml: row.raw_html ? String(row.raw_html) : "",
      attachmentsJson: row.attachments_json ? String(row.attachments_json) : null,
      crawlTime: new Date(String(row.crawl_time))
    }));
  }

  public async upsertMergedBatch(siteCode: SiteCode, records: MergedLandRecord[], reviewRows: ManualReviewRecord[]): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`DELETE FROM land_record WHERE site_code = ?`, [siteCode]);
      await connection.execute(`DELETE FROM manual_review_pool WHERE site_code = ?`, [siteCode]);

      if (records.length > 0) {
        const chunkSize = 500;
        for (let offset = 0; offset < records.length; offset += chunkSize) {
          const chunk = records.slice(offset, offset + chunkSize);
          const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
          const values = chunk.flatMap((record) => [
            record.siteCode,
            record.city,
            record.district,
            record.announcementNo,
            record.tradeDate,
            record.parcelName,
            record.landUsage,
            record.areaHa,
            record.startPriceWan,
            record.dealPriceWan,
            record.noticeDate,
            record.tradeStatus,
            record.winner,
            record.noticeSourceUrl,
            record.resultSourceUrl
          ]);
          await connection.execute(
            `INSERT INTO land_record (
              site_code, city, district, announcement_no, trade_date, parcel_name,
              land_usage, area_ha, start_price_wan, deal_price_wan,
              notice_date, trade_status, winner, notice_source_url, result_source_url
            ) VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
              city=VALUES(city), district=VALUES(district), trade_date=VALUES(trade_date), land_usage=VALUES(land_usage),
              area_ha=VALUES(area_ha), start_price_wan=VALUES(start_price_wan), deal_price_wan=VALUES(deal_price_wan),
              notice_date=VALUES(notice_date), trade_status=VALUES(trade_status), winner=VALUES(winner),
              notice_source_url=VALUES(notice_source_url), result_source_url=VALUES(result_source_url)`,
            values
          );
        }
      }

      if (reviewRows.length > 0) {
        const placeholders = reviewRows.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
        const values = reviewRows.flatMap((row) => [
          row.siteCode,
          row.city,
          row.district,
          row.announcementNo,
          row.parcelName,
          row.noticeDate,
          row.tradeDate,
          row.reasonCode,
          row.noticeSourceUrl,
          row.resultSourceUrl
        ]);
        await connection.execute(
          `INSERT INTO manual_review_pool (
            site_code, city, district, announcement_no, parcel_name, notice_date, trade_date,
            reason_code, notice_source_url, result_source_url
          ) VALUES ${placeholders}`,
          values
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async saveWatermark(siteCode: SiteCode, bizType: BizType, pageNo: number): Promise<void> {
    await this.pool.execute(
      `INSERT INTO crawl_watermark (site_code, biz_type, page_no) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE page_no = VALUES(page_no), updated_at = CURRENT_TIMESTAMP`,
      [siteCode, bizType, pageNo]
    );
  }

  public async loadWatermark(siteCode: SiteCode, bizType: BizType): Promise<number | null> {
    const [rows] = await this.pool.query<DbRow[]>(
      `SELECT page_no FROM crawl_watermark WHERE site_code = ? AND biz_type = ?`,
      [siteCode, bizType]
    );
    if (!rows[0]) {
      return null;
    }
    return Number(rows[0].page_no);
  }

  public async upsertTaskStateBatch(tasks: Array<Omit<CrawlTaskRecord, "updatedAt">>): Promise<void> {
    if (tasks.length === 0) {
      return;
    }
    const placeholders = tasks.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
    const values = tasks.flatMap((task) => [
      task.siteCode,
      task.bizType,
      task.pageNo,
      task.itemIndex,
      task.status,
      task.attempt,
      task.title,
      task.url,
      task.publishedAt,
      task.lastError
    ]);

    await this.pool.execute(
      `INSERT INTO crawl_task_state (
        site_code, biz_type, page_no, item_index, status, attempt, item_title, item_url, published_at, last_error
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        status=IF(crawl_task_state.status='succeeded', crawl_task_state.status, VALUES(status)),
        attempt=GREATEST(crawl_task_state.attempt, VALUES(attempt)),
        item_title=VALUES(item_title),
        item_url=VALUES(item_url), published_at=VALUES(published_at), last_error=VALUES(last_error),
        updated_at=CURRENT_TIMESTAMP`,
      values
    );
  }

  public async updateTaskStatus(
    siteCode: SiteCode,
    bizType: BizType,
    pageNo: number,
    itemIndex: number,
    status: CrawlTaskStatus,
    attempt: number,
    lastError: string | null
  ): Promise<void> {
    await this.pool.execute(
      `UPDATE crawl_task_state
      SET status = ?, attempt = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE site_code = ? AND biz_type = ? AND page_no = ? AND item_index = ?`,
      [status, attempt, lastError, siteCode, bizType, pageNo, itemIndex]
    );
  }

  public async markRunningTasksAsRetryable(siteCode: SiteCode, bizType: BizType): Promise<void> {
    await this.pool.execute(
      `UPDATE crawl_task_state SET status = 'retryable', updated_at = CURRENT_TIMESTAMP
       WHERE site_code = ? AND biz_type = ? AND status = 'running'`,
      [siteCode, bizType]
    );
  }

  public async loadPendingTasks(siteCode: SiteCode, bizType: BizType, pageNo: number): Promise<CrawlTaskRecord[]> {
    const [rows] = await this.pool.query<DbRow[]>(
      `SELECT * FROM crawl_task_state
      WHERE site_code = ? AND biz_type = ? AND page_no = ? AND status IN ('pending','retryable','running')
      ORDER BY item_index ASC`,
      [siteCode, bizType, pageNo]
    );
    return rows.map((row) => ({
      siteCode,
      bizType,
      pageNo: Number(row.page_no),
      itemIndex: Number(row.item_index),
      status: String(row.status) as CrawlTaskStatus,
      attempt: Number(row.attempt),
      title: row.item_title ? String(row.item_title) : null,
      url: row.item_url ? String(row.item_url) : null,
      publishedAt: row.published_at ? String(row.published_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      updatedAt: new Date(String(row.updated_at))
    }));
  }

  public async clearTaskState(siteCode: SiteCode, bizType: BizType): Promise<void> {
    await this.pool.execute(`DELETE FROM crawl_task_state WHERE site_code = ? AND biz_type = ?`, [siteCode, bizType]);
    await this.pool.execute(`DELETE FROM crawl_watermark WHERE site_code = ? AND biz_type = ?`, [siteCode, bizType]);
  }

  private async insertInBatches<T>(records: T[], chunkSize: number, fn: (batch: T[]) => Promise<void>): Promise<void> {
    for (let offset = 0; offset < records.length; offset += chunkSize) {
      const batch = records.slice(offset, offset + chunkSize);
      await fn(batch);
    }
  }
}
