# land3

`land3` 是基于 `land2` 裁剪出的土地数据采集 MVP，只保留单站点抓取、合并入库和 Excel 导出。

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

导出单站点 Excel：
```bash
npm run export -- --site beijing --out .\output\beijing.xlsx
```

一条命令执行抓取、合并、导出：
```bash
npm run run -- --site beijing --out .\output\beijing.xlsx
```

可选参数：
- `--from YYYY-MM-DD`
- `--to YYYY-MM-DD`
- `--max-items N`
- `--headless true|false`

## 输出

- MySQL 原始表：`land_notice_raw`、`land_result_raw`
- MySQL 业务表：`land_record`、`manual_review_pool`
- Excel sheet：`12个城市`
