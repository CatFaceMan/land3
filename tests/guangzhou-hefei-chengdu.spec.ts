import { describe, expect, it } from "vitest";
import {
  extractGuangzhouDistrictFromStructured,
  extractGuangzhouParcelNoFromStructured
} from "../src/adapters/guangzhou.js";
import { resolveChengduResultNoticeNo } from "../src/adapters/chengdu.js";
import { extractHefeiNoticeNo, extractHefeiParcelNoFromText, resolveHefeiNoticeNoRaw } from "../src/adapters/hefei.js";
import { mergeNoticeAndResults } from "../src/services/merge-service.js";
import type { ParsedNoticeRecord, ParsedResultRecord } from "../src/domain/types.js";

describe("Guangzhou structured field extraction", () => {
  it("uses structured parcelNo and district fields without falling back to location sentence", () => {
    const kvMap = {
      地块编号: "ZSCFX-E8-3",
      用地位置: "黄埔区中新广州知识城科知大道以北、信息一路以西",
      所属区县: "黄埔区"
    };
    expect(extractGuangzhouParcelNoFromStructured(kvMap)).toBe("ZSCFX-E8-3");
    expect(extractGuangzhouDistrictFromStructured(kvMap)).toBe("黄埔区");
  });
});

describe("Chengdu result noticeNo guard", () => {
  it("never derives noticeNo from date-range title or parcelNo", () => {
    expect(resolveChengduResultNoticeNo("2026年01月15日到2026年01月29日国有建设用地使用权出让结果公告", "QBJG2025-24号")).toBeNull();
  });

  it("routes to missing_announcement_no when result has parcelNo but no noticeNo", () => {
    const result: ParsedResultRecord = {
      siteCode: "chengdu",
      sourceUrl: "https://example.com/chengdu/result",
      sourceTitle: "列表标题",
      city: "成都",
      district: "高新区",
      resultTitle: "2026年01月15日到2026年01月29日国有建设用地使用权出让结果公告",
      noticeNoRaw: null,
      noticeNoNorm: null,
      dealPriceWan: 1000,
      winner: "测试公司",
      status: "已成交",
      dealDate: "2026-01-29",
      parcelNo: "QBJG2025-24号",
      contentText: "",
      rawHtml: "",
      attachmentsJson: null,
      crawlTime: new Date(),
      sourceKey: "chengdu-result-1"
    };

    const merged = mergeNoticeAndResults("chengdu", [], [result]);
    expect(merged.records).toHaveLength(0);
    expect(merged.reviewPool).toHaveLength(1);
    expect(merged.reviewPool[0]?.reasonCode).toBe("missing_announcement_no");
    expect(merged.reviewPool[0]?.announcementNo).toBeNull();
    expect(merged.reviewPool[0]?.parcelName).toBe("QBJG2025-24号");
  });
});

describe("Hefei noticeNo separation", () => {
  it("does not fall back to parcelNo when noticeNo is absent", () => {
    expect(resolveHefeiNoticeNoRaw(null, "TC2-2-1号")).toBeNull();
    expect(resolveHefeiNoticeNoRaw(null, "KT1-4-2号")).toBeNull();
  });

  it("normalizes source-prefixed noticeNo to formal body", () => {
    expect(resolveHefeiNoticeNoRaw("【合肥】合自然资规公告[2026]12号", null)).toBe("合自然资规公告(2026)12号");
  });

  it("extracts noticeNo from source title when detail fields are weak", () => {
    expect(extractHefeiNoticeNo(null, "交易结果公示", "合自然资规公告[2026]12号地块成交公示")).toBe("合自然资规公告(2026)12号");
  });

  it("extracts parcelNo from title as fallback", () => {
    expect(extractHefeiParcelNoFromText("关于TC2-2-1号地块成交结果公示")).toBe("TC2-2-1号");
  });

  it("routes notice records without formal noticeNo to missing_announcement_no", () => {
    const notice: ParsedNoticeRecord = {
      siteCode: "hefei",
      sourceUrl: "https://example.com/hefei/notice",
      sourceTitle: "列表标题",
      city: "合肥",
      district: "高新区",
      noticeTitle: "合肥市国有建设用地使用权出让公告",
      noticeNoRaw: null,
      noticeNoNorm: null,
      landUsage: "居住用地",
      areaHa: 1.2,
      startPriceWan: 5000,
      noticeDate: "2026-01-01",
      tradeDate: "2026-01-10",
      parcelNo: "TC2-2-1号",
      contentText: "",
      rawHtml: "",
      attachmentsJson: null,
      crawlTime: new Date(),
      sourceKey: "hefei-notice-1"
    };

    const merged = mergeNoticeAndResults("hefei", [notice], []);
    expect(merged.records).toHaveLength(0);
    expect(merged.reviewPool).toHaveLength(1);
    expect(merged.reviewPool[0]?.reasonCode).toBe("missing_announcement_no");
    expect(merged.reviewPool[0]?.announcementNo).toBeNull();
    expect(merged.reviewPool[0]?.parcelName).toBe("TC2-2-1号");
  });
});
