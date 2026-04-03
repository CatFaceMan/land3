# land3

`land3` 是一个土地公告/成交结果采集与合并入库工具，当前支持 11 个城市站点。

## 支持站点

- `beijing`
- `suzhou`
- `wuxi`
- `changzhou`
- `hangzhou`
- `ningbo`
- `guangzhou`
- `hefei`
- `chengdu`
- `xian`
- `wuhan`

## 运行要求

- Node.js 18+
- MySQL 8+
- 可访问目标站点的网络环境

## 快速开始

1. 安装依赖

```bash
npm install
```

2. 在项目根目录创建 `.env`（仓库当前没有 `.env.example`）

最小必填：

```env
DATABASE_URL=mysql://user:password@127.0.0.1:3306/land3?charset=utf8mb4
```

常用可选项：

```env
# 浏览器
BROWSER_HEADLESS=true
BROWSER_TIMEOUT_MS=30000

# 质量门禁
CRAWL_MAX_FAILURES=0
CRAWL_MAX_FAILURE_RATE=0.02
```

3. 运行抓取

```bash
# 单站点：抓取公告+结果，并合并入 land_record/manual_review_pool
npm run refresh -- --site beijing

# 全站点：默认抓取最近半年（180 天）
npm run collect-all
```

## 命令说明

### `refresh`

```bash
npm run refresh -- --site <siteCode> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max-items N] [--headless true|false]
```

参数：

- `--site` 必填，站点编码
- `--from` 可选，起始日期
- `--to` 可选，结束日期
- `--max-items` 可选，单业务类型最大处理条数
- `--headless` 可选，覆盖 `.env` 的浏览器无头设置

### `collect-all`

```bash
npm run collect-all [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max-items N] [--headless true|false]
```

未传 `--from/--to` 时，默认区间为“当前日期往前 180 天（近半年）”到“当前日期”。

## 限频与并发

以下站点启用强限频保护：`suzhou`、`wuxi`、`changzhou`、`hangzhou`、`ningbo`。

- 默认详情并发：`1`
- 默认额外延迟：`2500ms`
- 即使配置更高并发，运行时也会被硬性钳制为上述安全值

可按站点配置：

- `SITE_<SITE>_ENABLED`
- `SITE_<SITE>_DETAIL_CONCURRENCY`
- `SITE_<SITE>_EXTRA_DELAY_MS`
- `SITE_<SITE>_MAX_MISSING_DATE_PAGES`（默认 `8`，连续多少页采集不到时间字段后自动停止，防止无限翻页）
- `SITE_<SITE>_PROXY_PROFILE`

示例：`SITE_BEIJING_ENABLED=true`

## 质量门禁

抓取完成后会做质量校验：

- `CRAWL_MAX_FAILURES` 默认 `0`
- `CRAWL_MAX_FAILURE_RATE` 默认 `0.02`

当失败数和失败率同时超过阈值时，系统会输出质量告警并继续执行，不会中止整批抓取。

## 数据库表

程序启动时会自动执行 `ensureSchema`，确保/迁移以下业务表：

- `land_notice_raw`
- `land_result_raw`
- `land_record`
- `manual_review_pool`

当前关键约束：

- `land_notice_raw`：`parcel_no` 唯一（`uk_notice_parcel_no`）
- `land_result_raw`：`parcel_no` 唯一（`uk_result_parcel_no`）
- 两张 raw 表均已移除 `source_key`

兼容迁移行为：

- 若历史库中仍有 `source_key` 或旧索引（`uk_notice_source`/`uk_result_source`），启动时会自动清理并切换到 `parcel_no` 唯一键
- 启动时会自动删除已废弃表：`crawl_runs`、`crawl_failures`、`crawl_watermark`、`crawl_task_state`

## 构建与检查

```bash
npm run build
npm run typecheck
npm test
```

说明：当前仓库可能没有测试文件，`npm test` 可能会提示 `No test files found`。
