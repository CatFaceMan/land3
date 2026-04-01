import { describe, expect, it } from "vitest";
import { extractWuhanDistrict, extractWuhanNoticeNo, extractWuhanParcelNoFromText } from "../src/adapters/wuhan.js";
import { extractZhejiangNoticeNo } from "../src/adapters/zhejiang.js";
import { extractXianNoticeNo, normalizeXianParcelNo } from "../src/adapters/xian.js";
import { mergeNoticeAndResults } from "../src/services/merge-service.js";
import type { ParsedNoticeRecord, ParsedResultRecord } from "../src/domain/types.js";

describe("Wuhan notice/district extraction", () => {
  it("prefers formal notice number over title-style fallback number", () => {
    const title = "武汉市国有建设用地使用权挂牌出让公告 武告字（2026年）1号 2026年第1号公告";
    expect(extractWuhanNoticeNo(title, title)).toBe("武告字（2026年）1号");
  });

  it("keeps district at county level", () => {
    expect(extractWuhanDistrict("黄陂区盘龙城经济开发区")).toBe("黄陂区");
  });

  it("extracts noticeNo from source-prefixed title and parcelNo fallback from title", () => {
    expect(extractWuhanNoticeNo("【武汉】武告字（2026年）1号", "正文")).toBe("武告字（2026年）1号");
    expect(extractWuhanParcelNoFromText("武汉市关于P(2026)012号地块交易结果公告")).toBe("P(2026)012号");
  });
});

describe("Ningbo notice number extraction in zhejiang adapter", () => {
  it("keeps full notice prefixes and does not downgrade to generic '告...号'", () => {
    expect(extractZhejiangNoticeNo("甬土告〔2026〕1号")).toBe("甬土告〔2026〕1号");
    expect(extractZhejiangNoticeNo("甬土资告〔2026〕2号")).toBe("甬土资告〔2026〕2号");
    expect(extractZhejiangNoticeNo("甬自然资规出告〔2026〕3号")).toBe("甬自然资规出告〔2026〕3号");
    expect(extractZhejiangNoticeNo("甬自然资规告字〔2026〕5号")).toBe("甬自然资规告字〔2026〕5号");
    expect(extractZhejiangNoticeNo("象自然资规工出告字〔2026〕4号")).toBe("象自然资规工出告字〔2026〕4号");
  });
});

describe("Xian notice/parcel normalization", () => {
  it("strips source prefix and keeps formal notice number body", () => {
    const raw = "【西咸新区·西咸新区（本级）】西咸土出告字〔2025〕38号";
    expect(extractXianNoticeNo(raw, raw)).toBe("西咸土出告字〔2025〕38号");
  });

  it("normalizes parcelNo whitespace for stable matching", () => {
    expect(normalizeXianParcelNo("FD2-9-29 [XXFD-SQ04-49-A]")).toBe("FD2-9-29[XXFD-SQ04-49-A]");
    expect(normalizeXianParcelNo("FD2-9-29[XXFD-SQ04-49-A]")).toBe("FD2-9-29[XXFD-SQ04-49-A]");
  });

  it("merges notice/result with bracket-space difference in parcelNo", () => {
    const notice: ParsedNoticeRecord = {
      siteCode: "xian",
      sourceUrl: "https://example.com/xian/notice",
      sourceTitle: "notice",
      city: "西安",
      district: "西咸新区",
      noticeTitle: "title",
      noticeNoRaw: "西咸土出告字〔2025〕38号",
      noticeNoNorm: "西咸土出告字(2025)38号",
      landUsage: "工业用地",
      areaHa: 1.2,
      startPriceWan: 1200,
      noticeDate: "2025-10-01",
      tradeDate: "2025-10-20",
      parcelNo: normalizeXianParcelNo("FD2-9-29 [XXFD-SQ04-49-A]"),
      contentText: "",
      rawHtml: "",
      attachmentsJson: null,
      crawlTime: new Date(),
      sourceKey: "xian-notice-1"
    };
    const result: ParsedResultRecord = {
      siteCode: "xian",
      sourceUrl: "https://example.com/xian/result",
      sourceTitle: "result",
      city: "西安",
      district: "西咸新区",
      resultTitle: "title",
      noticeNoRaw: "西咸土出告字〔2025〕38号",
      noticeNoNorm: "西咸土出告字(2025)38号",
      dealPriceWan: 1500,
      winner: "测试企业",
      status: "已成交",
      dealDate: "2025-10-20",
      parcelNo: normalizeXianParcelNo("FD2-9-29[XXFD-SQ04-49-A]"),
      contentText: "",
      rawHtml: "",
      attachmentsJson: null,
      crawlTime: new Date(),
      sourceKey: "xian-result-1"
    };

    const merged = mergeNoticeAndResults("xian", [notice], [result]);
    expect(merged.records).toHaveLength(1);
    expect(merged.reviewPool).toHaveLength(0);
    expect(merged.records[0]?.parcelName).toBe("FD2-9-29[XXFD-SQ04-49-A]");
  });

  it("does not backfill announcement_no from parcelNo when noticeNo is missing", () => {
    const notice: ParsedNoticeRecord = {
      siteCode: "xian",
      sourceUrl: "https://example.com/xian/notice-missing-no",
      sourceTitle: "notice",
      city: "西安",
      district: "西咸新区",
      noticeTitle: "title",
      noticeNoRaw: null,
      noticeNoNorm: null,
      landUsage: "工业用地",
      areaHa: 1.2,
      startPriceWan: 1200,
      noticeDate: "2025-10-01",
      tradeDate: "2025-10-20",
      parcelNo: normalizeXianParcelNo("FD2-9-29 [XXFD-SQ04-49-A]"),
      contentText: "",
      rawHtml: "",
      attachmentsJson: null,
      crawlTime: new Date(),
      sourceKey: "xian-notice-2"
    };
    const merged = mergeNoticeAndResults("xian", [notice], []);
    expect(merged.records).toHaveLength(0);
    expect(merged.reviewPool).toHaveLength(1);
    expect(merged.reviewPool[0]?.reasonCode).toBe("missing_announcement_no");
    expect(merged.reviewPool[0]?.announcementNo).toBeNull();
    expect(merged.reviewPool[0]?.parcelName).toBe("FD2-9-29[XXFD-SQ04-49-A]");
  });
});
