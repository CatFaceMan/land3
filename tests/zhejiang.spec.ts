import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractHangzhouDistrictFromAnnouncementTitle,
  extractHangzhouDistrictFromAnnouncementText,
  extractHangzhouParcelNoFromAnnouncementSubTitle,
  extractZhejiangNoticeFieldOverrides,
  extractZhejiangNoticeNo,
  resolveHangzhouResultNoticeNoWithRetry
} from "../src/adapters/zhejiang.js";

const fixturePath = resolve(process.cwd(), "tests/fixtures/zhejiang-hangzhou-notice.html");
const fixtureHtml = readFileSync(fixturePath, "utf8");

describe("extractZhejiangNoticeFieldOverrides", () => {
  it("extracts the current Hangzhou parcel fields from the detail page", () => {
    expect(extractZhejiangNoticeFieldOverrides({ rawHtml: fixtureHtml })).toEqual({
      parcelNo: "杭政储出[2026]13号",
      district: "临平区",
      noticeNoRaw: "杭规划资源告[2026]R004号",
      tradeDate: "2026-04-10",
      landUsage: "住宅（设配套公建）用地",
      areaHa: 2.7211,
      startPriceWan: 42858
    });
  });

  it("matches another parcel row from the same announcement tables by parcel number", () => {
    expect(
      extractZhejiangNoticeFieldOverrides({
        rawHtml: fixtureHtml,
        parcelNoOverride: "杭政储出[2026]12号"
      })
    ).toEqual({
      parcelNo: "杭政储出[2026]12号",
      district: "西湖区",
      noticeNoRaw: "杭规划资源告[2026]R004号",
      tradeDate: "2026-04-10",
      landUsage: "住宅（设配套公建）用地",
      areaHa: 2.2891,
      startPriceWan: 60332
    });
  });

  it("extracts a compact notice number from long announcement lines", () => {
    const longLine =
      "杭州市国有建设用地使用权挂牌出让公告杭规划资源告[2026]R004号根据国家有关法律法规规定现将有关事项公告如下本行后续继续拼接很多文字用于模拟无换行的长段落";
    const value = extractZhejiangNoticeNo(longLine);
    expect(value).toBe("杭规划资源告[2026]R004号");
  });
});

describe("Hangzhou announcement line extraction", () => {
  it("extracts district from the title line before '出让公告'", () => {
    expect(extractHangzhouDistrictFromAnnouncementTitle("建德市国有建设用地使用权挂牌出让公告")).toBe("建德市");
    expect(extractHangzhouDistrictFromAnnouncementTitle("杭州市国有建设用地使用权挂牌出让公告")).toBe("杭州市");
  });

  it("extracts district from announcement text even when title/subtitle are merged", () => {
    const mergedLine = "公告期 建德市国有建设用地使用权挂牌出让公告 建告字〔2026〕7号 根据国家有关法律法规规定";
    expect(extractHangzhouDistrictFromAnnouncementText(mergedLine)).toBe("建德市");
  });

  it("extracts parcel_no from the line right below the announcement title", () => {
    expect(extractHangzhouParcelNoFromAnnouncementSubTitle("建告字〔2026〕7号")).toBe("建告字〔2026〕7号");
    expect(extractHangzhouParcelNoFromAnnouncementSubTitle("杭规划资源告[2026]R004号")).toBe("杭规划资源告[2026]R004号");
  });
});

describe("Hangzhou result noticeNo fallback guard", () => {
  it("retries extraction for empty/degraded noticeNo and keeps formal announcement number", () => {
    expect(
      resolveHangzhouResultNoticeNoWithRetry(
        null,
        "杭州市国有建设用地使用权挂牌出让公告 杭规划资源告[2026]R004号",
        ["附件A.pdf"],
        ""
      )
    ).toBe("杭规划资源告[2026]R004号");

    expect(
      resolveHangzhouResultNoticeNoWithRetry(
        "R004号",
        "",
        ["杭规划资源告[2026]R004号.pdf"],
        ""
      )
    ).toBe("杭规划资源告[2026]R004号");
  });

  it("returns null when no formal announcement number can be recovered", () => {
    expect(resolveHangzhouResultNoticeNoWithRetry("杭政储出[2026]12号", "", [], "地块编号：杭政储出[2026]12号")).toBeNull();
  });
});
