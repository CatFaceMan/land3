import { describe, expect, it } from "vitest";
import type { DetailDocument } from "../src/domain/types.js";
import { extractBeijingDetailFields, extractBeijingLocation, extractBeijingParcelNo } from "../src/adapters/beijing.js";

describe("Beijing adapter helpers", () => {
  it("extracts key detail fields from structured document content", () => {
    const document: DetailDocument = {
      title: "北京市昌平区CP00-0001地块国有建设用地使用权挂牌出让公告",
      leadDateText: null,
      contentText: [
        "地块编号：CP00-0001",
        "挂牌竞价截止时间：2026年4月18日",
        "成交时间：2026年4月20日",
        "成交价格：12345万元",
        "竞得单位：北京测试置业有限公司"
      ].join(" "),
      rawHtml: "",
      tables: [
        {
          rows: [
            { 交易文件编号: "京土储挂（昌）[2026]001号" },
            { 宗地编号: "CP00-0001" },
            { 成交价格: "12345万元" },
            { 竞得单位: "北京测试置业有限公司" }
          ]
        }
      ],
      attachments: []
    };

    const fields = extractBeijingDetailFields(document);
    expect(fields.noticeNo).toBe("京土储挂（昌）[2026]001号");
    expect(fields.parcelNo).toBe("CP00-0001");
    expect(fields.dealPrice).toBe("12345万元");
    expect(fields.winner).toBe("北京测试置业有限公司");
  });

  it("maps district from notice number patterns", () => {
    expect(extractBeijingLocation("测试标题", "京土储挂（昌）[2026]001号")).toBe("昌平区");
    expect(extractBeijingLocation("测试标题", "京开国土挂(2026)1号")).toBe("北京经济技术开发区");
  });

  it("extracts parcel marker from title", () => {
    expect(extractBeijingParcelNo("北京市昌平区CP00-0001地块国有建设用地使用权挂牌出让公告")).toBe("北京市昌平区CP00-0001地块");
  });
});
