import { describe, expect, it } from "vitest";
import { isJiangsuRegionCodeAllowed } from "../src/adapters/jiangsu.js";

describe("Jiangsu site region guard", () => {
  it("accepts only site-owned xzqDm prefixes", () => {
    expect(isJiangsuRegionCodeAllowed("suzhou", "320500")).toBe(true);
    expect(isJiangsuRegionCodeAllowed("wuxi", "320200")).toBe(true);
    expect(isJiangsuRegionCodeAllowed("changzhou", "320400")).toBe(true);
  });

  it("rejects cross-site xzqDm prefixes", () => {
    expect(isJiangsuRegionCodeAllowed("suzhou", "320200")).toBe(false);
    expect(isJiangsuRegionCodeAllowed("wuxi", "320400")).toBe(false);
    expect(isJiangsuRegionCodeAllowed("changzhou", "320500")).toBe(false);
  });

  it("treats missing xzqDm as non-owned for guarded Jiangsu sites", () => {
    expect(isJiangsuRegionCodeAllowed("suzhou", null)).toBe(false);
    expect(isJiangsuRegionCodeAllowed("wuxi", "")).toBe(false);
    expect(isJiangsuRegionCodeAllowed("changzhou", undefined)).toBe(false);
  });

  it("represents notice/result skip condition through the same ownership guard", () => {
    const noticeOwned = isJiangsuRegionCodeAllowed("suzhou", "320583");
    const noticeForeign = isJiangsuRegionCodeAllowed("suzhou", "320213");
    const resultOwned = isJiangsuRegionCodeAllowed("wuxi", "320206");
    const resultForeign = isJiangsuRegionCodeAllowed("wuxi", "320481");
    expect(noticeOwned).toBe(true);
    expect(noticeForeign).toBe(false);
    expect(resultOwned).toBe(true);
    expect(resultForeign).toBe(false);
  });
});
