import ExcelJS from "exceljs";
import type { ExportLandRow, ManualReviewRecord } from "../domain/types.js";

const HEADERS: Array<keyof ExportLandRow> = [
  "序号",
  "所属市",
  "所属区（县）",
  "出让公告",
  "交易日期",
  "地块公告号",
  "用地性质",
  "面积（公顷）",
  "起始价（万元）",
  "成交价（万元）",
  "溢价金额（万元）",
  "溢价率",
  "公告时间",
  "交易状态",
  "竞得单位"
];

const HEADER_LABELS = [
  "序号",
  "所属市",
  "所属区（县）",
  "出让公告",
  "交易日期",
  "地块公告号",
  "用地性质",
  "面积\n（公顷）",
  "起始价（万元）",
  "成交价（万元）",
  "溢价金额（万元）",
  "溢价率",
  "公告时间",
  "交易状态",
  "竞得单位"
];

const COLUMN_WIDTHS = [9, 9, 15.76, 30.71, 15.76, 83.58, 25.18, 15.63, 18.39, 11.5, 14.63, 11.26, 15.88, 9, 39.46];

function applyThinBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    left: { style: "thin" },
    right: { style: "thin" },
    top: { style: "thin" },
    bottom: { style: "thin" }
  };
}

export async function writeExportWorkbook(
  rows: ExportLandRow[],
  outputPath: string,
  reviewRows: ManualReviewRecord[] = []
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("12个城市");
  sheet.addRow(HEADER_LABELS);
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const worksheetRow = sheet.addRow(HEADERS.map((header) => row[header]));
    if (row["起始价（万元）"] !== null && row["成交价（万元）"] !== null && row["溢价金额（万元）"] !== null) {
      worksheetRow.getCell(12).value = { formula: `K${rowNumber}/I${rowNumber}` };
    }
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 37.5;
  for (let col = 1; col <= HEADERS.length; col += 1) {
    const cell = headerRow.getCell(col);
    cell.font = { name: "方正公文黑体", size: 14 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    applyThinBorder(cell);
  }

  for (let rowIndex = 2; rowIndex <= sheet.rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.height = 16.5;
    for (let col = 1; col <= HEADERS.length; col += 1) {
      const cell = row.getCell(col);
      const fontName = col === 4 || col >= 13 ? "宋体" : "微软雅黑";
      cell.font = { name: fontName, size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: [2, 3, 5, 6, 7, 8, 9, 10].includes(col) };
      applyThinBorder(cell);
    }
    row.getCell(5).numFmt = "mm-dd-yy";
    row.getCell(8).numFmt = "0.00_ ";
    row.getCell(9).numFmt = "0.00_ ";
    row.getCell(10).numFmt = "0.00_ ";
    row.getCell(11).numFmt = "0.00_ ";
    row.getCell(12).numFmt = "0.00%";
    row.getCell(13).numFmt = "mm-dd-yy";
  }

  if (reviewRows.length > 0) {
    const reviewSheet = workbook.addWorksheet("人工复核");
    const reviewHeaders = ["序号", "所属市", "所属区（县）", "出让公告", "地块公告号", "公告时间", "交易日期", "原因代码", "公告来源链接", "结果来源链接"];
    reviewSheet.addRow(reviewHeaders);
    for (const [index, row] of reviewRows.entries()) {
      reviewSheet.addRow([
        index + 1,
        row.city,
        row.district ?? "",
        row.announcementNo ?? "",
        row.parcelName ?? "",
        row.noticeDate ?? "",
        row.tradeDate ?? "",
        row.reasonCode,
        row.noticeSourceUrl ?? "",
        row.resultSourceUrl ?? ""
      ]);
    }
    reviewSheet.views = [{ state: "frozen", ySplit: 1 }];
    reviewSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: reviewHeaders.length } };
    for (let rowIndex = 1; rowIndex <= reviewSheet.rowCount; rowIndex += 1) {
      for (let col = 1; col <= reviewHeaders.length; col += 1) {
        const cell = reviewSheet.getRow(rowIndex).getCell(col);
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        applyThinBorder(cell);
      }
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}
