import type { Pool } from "mysql2/promise";
import type {
  ManualReviewRecord,
  MergedLandRecord,
  ParsedNoticeRecord,
  ParsedResultRecord,
  SiteCode
} from "../domain/types.js";
import type { DbRow } from "./connection.js";

export class LandRepository {
  public constructor(private readonly pool: Pool) {}

  public async upsertNoticeBatch(records: ParsedNoticeRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await this.insertInBatches(records, 300, async (batch) => {
      const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = batch.flatMap((record) => [
        record.siteCode,
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
          site_code, source_url, source_title, city, district, notice_title, notice_no_raw, notice_no_norm,
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
      const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
      const values = batch.flatMap((record) => [
        record.siteCode,
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
          site_code, source_url, source_title, city, district, result_title, notice_no_raw, notice_no_norm,
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
      sourceKey: row.parcel_no ? String(row.parcel_no) : String(row.source_url),
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
      sourceKey: row.parcel_no ? String(row.parcel_no) : String(row.source_url),
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

  private async insertInBatches<T>(records: T[], chunkSize: number, fn: (batch: T[]) => Promise<void>): Promise<void> {
    for (let offset = 0; offset < records.length; offset += chunkSize) {
      const batch = records.slice(offset, offset + chunkSize);
      await fn(batch);
    }
  }
}
