# land3

`land3` 是基于 `land2` 裁剪出的土地数据采集 MVP，仅保留 11 个城市的采集与合并入库能力。

支持站点：
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

## 环境准备

1. 安装依赖
```bash
npm install
```

2. 配置环境变量
```bash
copy .env.example .env
```

3. 确保 MySQL 可用，并填写 `DATABASE_URL`

## 命令

抓取并合并单站点数据：
```bash
npm run refresh -- --site beijing
```

抓取并合并全部 11 个城市：
```bash
npm run collect-all
```

可选参数：
- `--from YYYY-MM-DD`
- `--to YYYY-MM-DD`
- `--max-items N`
- `--headless true|false`

江苏/浙江限频保护：
- 站点：`suzhou`、`wuxi`、`changzhou`、`hangzhou`、`ningbo`
- 默认强限频：详情并发 `1`，额外延迟 `>=2500ms`
- 即使环境变量误配更高并发，运行时也会被硬性钳制，避免触发站点访问频率限制

质量门禁（默认开启）：
- `CRAWL_MAX_FAILURES`：允许失败任务数，默认 `0`
- `CRAWL_MAX_FAILURE_RATE`：允许失败率，默认 `0.02`

当失败数和失败率同时超过阈值时，本次站点抓取会判定为失败（`crawl_runs.status=failed`）。

## 输出

- MySQL 原始表：`land_notice_raw`、`land_result_raw`
- MySQL 业务表：`land_record`、`manual_review_pool`
