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

## 输出

- MySQL 原始表：`land_notice_raw`、`land_result_raw`
- MySQL 业务表：`land_record`、`manual_review_pool`
