import type { Pool, RowDataPacket } from "mysql2/promise";

export async function ensureSchema(pool: Pool): Promise<void> {
  await createBusinessTables(pool);
  await dropUnusedCrawlTables(pool);
}

async function createBusinessTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS land_notice_raw (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
      site_code VARCHAR(32) NOT NULL COMMENT '站点编码',
      source_url TEXT NOT NULL COMMENT '来源URL',
      source_title TEXT NULL COMMENT '来源标题',
      city VARCHAR(64) NOT NULL COMMENT '城市',
      district VARCHAR(128) NULL COMMENT '区县',
      notice_title TEXT NULL COMMENT '公告标题',
      notice_no_raw VARCHAR(255) NULL COMMENT '公告号原文',
      notice_no_norm VARCHAR(255) NULL COMMENT '公告号规范化',
      normalized_announcement_no VARCHAR(255) NULL COMMENT '归一化公告号',
      land_usage VARCHAR(255) NULL COMMENT '用地性质',
      area_ha DECIMAL(18,4) NULL COMMENT '面积(公顷)',
      start_price_wan DECIMAL(18,2) NULL COMMENT '起始价(万元)',
      notice_date DATE NULL COMMENT '公告日期',
      trade_date DATE NULL COMMENT '交易日期',
      parcel_no VARCHAR(255) NULL COMMENT '地块编号',
      parcel_code VARCHAR(255) NULL COMMENT '地块编码',
      content_text LONGTEXT NULL COMMENT '正文文本',
      raw_html LONGTEXT NULL COMMENT '原始HTML',
      attachments_json JSON NULL COMMENT '附件JSON',
      crawl_time DATETIME NOT NULL COMMENT '抓取时间',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_notice_parcel_no (parcel_no),
      KEY idx_notice_trade_date (site_code, trade_date),
      KEY idx_notice_no (site_code, notice_no_norm)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='公告原始明细';
  `);
  await migrateLandNoticeRawToParcelNoKey(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS land_result_raw (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
      site_code VARCHAR(32) NOT NULL COMMENT '站点编码',
      source_url TEXT NOT NULL COMMENT '来源URL',
      source_title TEXT NULL COMMENT '来源标题',
      city VARCHAR(64) NOT NULL COMMENT '城市',
      district VARCHAR(128) NULL COMMENT '区县',
      result_title TEXT NULL COMMENT '结果标题',
      notice_no_raw VARCHAR(255) NULL COMMENT '公告号原文',
      notice_no_norm VARCHAR(255) NULL COMMENT '公告号规范化',
      normalized_announcement_no VARCHAR(255) NULL COMMENT '归一化公告号',
      deal_price_wan DECIMAL(18,2) NULL COMMENT '成交价(万元)',
      winner VARCHAR(255) NULL COMMENT '竞得人',
      status VARCHAR(64) NULL COMMENT '状态',
      deal_date DATE NULL COMMENT '成交日期',
      parcel_no VARCHAR(255) NULL COMMENT '地块编号',
      parcel_code VARCHAR(255) NULL COMMENT '地块编码',
      content_text LONGTEXT NULL COMMENT '正文文本',
      raw_html LONGTEXT NULL COMMENT '原始HTML',
      attachments_json JSON NULL COMMENT '附件JSON',
      crawl_time DATETIME NOT NULL COMMENT '抓取时间',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_result_parcel_no (parcel_no),
      KEY idx_result_trade_date (site_code, deal_date),
      KEY idx_result_status (site_code, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='结果原始明细';
  `);

  await migrateLandResultRawToParcelNoKey(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS land_record (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
      site_code VARCHAR(32) NOT NULL COMMENT '站点编码',
      city VARCHAR(64) NOT NULL COMMENT '城市',
      district VARCHAR(128) NULL COMMENT '区县',
      announcement_no VARCHAR(255) NOT NULL COMMENT '出让公告',
      trade_date DATE NULL COMMENT '交易日期',
      parcel_name VARCHAR(500) NOT NULL COMMENT '地块公告号',
      land_usage VARCHAR(255) NULL COMMENT '用地性质',
      area_ha DECIMAL(18,4) NULL COMMENT '面积(公顷)',
      start_price_wan DECIMAL(18,2) NULL COMMENT '起始价(万元)',
      deal_price_wan DECIMAL(18,2) NULL COMMENT '成交价(万元)',
      notice_date DATE NULL COMMENT '公告时间',
      trade_status VARCHAR(64) NOT NULL COMMENT '交易状态',
      winner VARCHAR(255) NULL COMMENT '竞得单位',
      notice_source_url TEXT NULL COMMENT '公告来源链接',
      result_source_url TEXT NULL COMMENT '结果来源链接',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_record_business (site_code, announcement_no, parcel_name(400)),
      KEY idx_record_trade_date (site_code, trade_date),
      KEY idx_record_status (site_code, trade_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='土地业务主表';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_review_pool (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
      site_code VARCHAR(32) NOT NULL COMMENT '站点编码',
      city VARCHAR(64) NOT NULL COMMENT '城市',
      district VARCHAR(128) NULL COMMENT '区县',
      announcement_no VARCHAR(255) NULL COMMENT '出让公告',
      parcel_name VARCHAR(500) NULL COMMENT '地块公告号',
      notice_date DATE NULL COMMENT '公告时间',
      trade_date DATE NULL COMMENT '交易日期',
      reason_code VARCHAR(32) NOT NULL COMMENT '异常原因代码',
      notice_source_url TEXT NULL COMMENT '公告来源链接',
      result_source_url TEXT NULL COMMENT '结果来源链接',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      KEY idx_review_reason (site_code, reason_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='异常复核池';
  `);
}

async function dropUnusedCrawlTables(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS crawl_task_state`);
  await pool.query(`DROP TABLE IF EXISTS crawl_watermark`);
  await pool.query(`DROP TABLE IF EXISTS crawl_failures`);
  await pool.query(`DROP TABLE IF EXISTS crawl_runs`);
}

async function migrateLandResultRawToParcelNoKey(pool: Pool): Promise<void> {
  interface CountRow extends RowDataPacket {
    cnt: number;
  }

  const [columnRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'land_result_raw'
       AND column_name = 'source_key'`
  );
  const hasSourceKeyColumn = Number(columnRows[0]?.cnt ?? 0) > 0;

  const [legacyIndexRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'land_result_raw'
       AND index_name = 'uk_result_source'`
  );
  const hasLegacyIndex = Number(legacyIndexRows[0]?.cnt ?? 0) > 0;

  if (hasLegacyIndex) {
    await pool.query(`ALTER TABLE land_result_raw DROP INDEX uk_result_source`);
  }
  if (hasSourceKeyColumn) {
    await pool.query(`ALTER TABLE land_result_raw DROP COLUMN source_key`);
  }

  const [parcelIndexRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'land_result_raw'
       AND index_name = 'uk_result_parcel_no'`
  );
  const hasParcelUniqueIndex = Number(parcelIndexRows[0]?.cnt ?? 0) > 0;
  if (!hasParcelUniqueIndex) {
    await pool.query(`ALTER TABLE land_result_raw ADD UNIQUE KEY uk_result_parcel_no (parcel_no)`);
  }
}

async function migrateLandNoticeRawToParcelNoKey(pool: Pool): Promise<void> {
  interface CountRow extends RowDataPacket {
    cnt: number;
  }

  const [columnRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'land_notice_raw'
       AND column_name = 'source_key'`
  );
  const hasSourceKeyColumn = Number(columnRows[0]?.cnt ?? 0) > 0;

  const [legacyIndexRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'land_notice_raw'
       AND index_name = 'uk_notice_source'`
  );
  const hasLegacyIndex = Number(legacyIndexRows[0]?.cnt ?? 0) > 0;

  if (hasLegacyIndex) {
    await pool.query(`ALTER TABLE land_notice_raw DROP INDEX uk_notice_source`);
  }
  if (hasSourceKeyColumn) {
    await pool.query(`ALTER TABLE land_notice_raw DROP COLUMN source_key`);
  }

  const [parcelIndexRows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'land_notice_raw'
       AND index_name = 'uk_notice_parcel_no'`
  );
  const hasParcelUniqueIndex = Number(parcelIndexRows[0]?.cnt ?? 0) > 0;
  if (!hasParcelUniqueIndex) {
    await pool.query(`ALTER TABLE land_notice_raw ADD UNIQUE KEY uk_notice_parcel_no (parcel_no)`);
  }
}
