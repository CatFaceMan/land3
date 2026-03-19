import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { LandRepository } from "../db/repository.js";
import type { SiteCode } from "../domain/types.js";
import { writeExportWorkbook } from "../excel/exporter.js";
import { toDateOrNull } from "../utils/date.js";

function normalizeCityDisplay(value: string): string {
  const cityMap: Record<string, string> = {
    北京: "北京市",
    广州: "广州市",
    合肥: "合肥市",
    成都: "成都市",
    西安: "西安市",
    武汉: "武汉市"
  };
  return cityMap[value] ?? value;
}

export async function runExport(repository: LandRepository, siteCode: SiteCode, outputPath: string): Promise<{ outputPath: string; rowCount: number }> {
  const records = await repository.listMergedRecordsForExport(siteCode);
  const reviewRows = await repository.listManualReview(siteCode);
  const rows = records.map((record, index) => {
    const premiumAmountWan =
      record.dealPriceWan !== null && record.startPriceWan !== null
        ? Number((record.dealPriceWan - record.startPriceWan).toFixed(2))
        : null;
    const premiumRate =
      premiumAmountWan !== null && record.startPriceWan && record.startPriceWan > 0
        ? Number((premiumAmountWan / record.startPriceWan).toFixed(6))
        : null;

    return {
      序号: index + 1,
      所属市: normalizeCityDisplay(record.city),
      "所属区（县）": record.district ?? "",
      出让公告: record.announcementNo,
      交易日期: toDateOrNull(record.tradeDate),
      地块公告号: record.parcelName,
      用地性质: record.landUsage ?? "",
      "面积（公顷）": record.areaHa,
      "起始价（万元）": record.startPriceWan,
      "成交价（万元）": record.dealPriceWan,
      "溢价金额（万元）": premiumAmountWan,
      溢价率: premiumRate,
      公告时间: toDateOrNull(record.noticeDate),
      交易状态: record.tradeStatus,
      竞得单位: record.winner
    };
  });
  const resolved = resolve(outputPath);
  await mkdir(dirname(resolved), { recursive: true });
  await writeExportWorkbook(rows, resolved, reviewRows);
  return { outputPath: resolved, rowCount: rows.length };
}
