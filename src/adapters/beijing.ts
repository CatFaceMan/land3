import type { Page } from "playwright";
import { ConfiguredHtmlSiteAdapter, extractDocument, readField } from "./base-html-adapter.js";
import type { GenericSiteConfig } from "./site-adapter.js";
import type { DetailDocument, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanText, firstNonEmpty } from "../utils/text.js";

const config: GenericSiteConfig = {
  siteCode: "beijing",
  cityName: "北京",
  notice: {
    entryUrl: "https://yewu.ghzrzyw.beijing.gov.cn/gwxxfb/tdsc/tdzpgxm.html",
    navigationStrategy: "return",
    selectors: {
      listReady: [".layui-table-main", ".layui-table-body"],
      listItem: ".layui-table-main tbody tr",
      titleLink: "a",
      nextPage: [".layui-laypage-next"],
      detailRoot: "#detailDiv",
      detailReady: ["#detailDiv .tdscptit", "#detailDiv table"],
      detailTitle: ["#detailDiv .tdscptit", ".tdscptit", "h1"],
      content: ["#detailDiv", ".layui-bothpad"],
      attachment: "#detailDiv a[href]"
    }
  },
  result: {
    entryUrl: "https://yewu.ghzrzyw.beijing.gov.cn/gwxxfb/tdsc/tdcjylb.html",
    navigationStrategy: "return",
    selectors: {
      listReady: [".layui-table-main", ".layui-table-body"],
      listItem: ".layui-table-main tbody tr",
      titleLink: "a",
      nextPage: [".layui-laypage-next"],
      detailRoot: "#detailDiv",
      detailReady: ["#detailDiv .tdscptit", "#detailDiv table"],
      detailTitle: ["#detailDiv .tdscptit", ".tdscptit", "h1"],
      content: ["#detailDiv", ".layui-bothpad"],
      attachment: "#detailDiv a[href]"
    }
  }
};

function mergeTableRows(document: DetailDocument): Record<string, string> {
  const rows: Record<string, string> = {};
  for (const table of document.tables) {
    for (const row of table.rows) {
      Object.assign(rows, row);
    }
  }
  return rows;
}


const BEIJING_DISTRICT_CODE_MAP: Record<string, string> = {
  开: "北京经济技术开发区",
  通: "通州区",
  昌: "昌平区",
  兴: "大兴区",
  顺: "顺义区",
  海: "海淀区",
  丰: "丰台区",
  石: "石景山区",
  西: "西城区",
  房: "房山区",
  密: "密云区",
  延: "延庆区",
  平: "平谷区",
  门: "门头沟区",
  朝: "朝阳区",
  怀: "怀柔区"
};

export function extractBeijingParcelNo(title: string | null | undefined): string | null {
  const normalized = cleanText(title);
  const marker = "地块";
  const end = normalized.lastIndexOf(marker);
  return end >= 0 ? normalized.slice(0, end + marker.length) : null;
}

function normalizeBeijingDistrictText(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("北京市")) {
    return normalized.slice(3);
  }
  return normalized;
}

export function extractBeijingLocation(title: string | null | undefined, noticeNo: string | null | undefined): string | null {
  const normalizedTitle = cleanText(title);
  const normalizedNoticeNo = normalizeNoticeNo(noticeNo);
  if (normalizedNoticeNo?.startsWith("京开国土挂")) {
    return BEIJING_DISTRICT_CODE_MAP["开"];
  }
  const code = normalizedNoticeNo?.match(/\(([^()]+)\)/)?.[1];
  if (code && BEIJING_DISTRICT_CODE_MAP[code]) {
    return BEIJING_DISTRICT_CODE_MAP[code];
  }
  if (normalizedTitle.includes("北京经济技术开发区")) {
    return "北京经济技术开发区";
  }
  const explicitDistrict = normalizedTitle.match(/北京市([^市，。；\s()（）]+(?:区|县))/)?.[1];
  return normalizeBeijingDistrictText(explicitDistrict ?? null);
}

function parseBeijingAreaHa(value: string | null): number | null {
  const area = parseAreaToHectare(value);
  return area === null ? null : Number(area.toFixed(2));
}

export function extractBeijingDetailFields(
  document: DetailDocument
): {
  noticeNo: string | null;
  parcelNo: string | null;
  area: string | null;
  landUsage: string | null;
  startPrice: string | null;
  noticeDate: string | null;
  tradeDate: string | null;
  dealDate: string | null;
  dealPrice: string | null;
  winner: string | null;
} {
  const fields = mergeTableRows(document);
  const text = cleanText(document.contentText);
  const pickByLabel = (labels: string[], terminators: string[]): string | null => {
    for (const label of labels) {
      const index = text.indexOf(label);
      if (index < 0) {
        continue;
      }
      const start = index + label.length;
      let end = text.length;
      for (const token of terminators) {
        const tokenIndex = text.indexOf(token, start);
        if (tokenIndex >= 0 && tokenIndex < end) {
          end = tokenIndex;
        }
      }
      const value = cleanText(text.slice(start, end));
      if (value) {
        return value;
      }
    }
    return null;
  };

  return {
    noticeNo: firstNonEmpty(
      readField(fields, ["交易文件编号"]),
      text.match(/[^\s，。；;]*挂[（(][^）)]+[）)]\[\d{4}\]\d+号/)?.[0]
    ),
    parcelNo: firstNonEmpty(
      readField(fields, ["宗地编号", "地块编号", "宗地号"]),
      pickByLabel(["地块编号：", "宗地编号：", "宗地号："], ["土地面积", "起始价", "挂牌", "成交", "竞得人"]),
      text.match(/[A-Za-z0-9\u4e00-\u9fa5-]+(?:、[A-Za-z0-9\u4e00-\u9fa5-]+)*地块/)?.[0]
    ),
    area: firstNonEmpty(readField(fields, ["土地总面积", "土地面积"]), text.match(/(?:土地总)?面积[：:\s]*([0-9.,]+\s*(?:平方米|公顷|亩))/)?.[1]),
    landUsage: readField(fields, ["用地性质"]),
    startPrice: firstNonEmpty(readField(fields, ["起始价"]), text.match(/起始价[：:\s]*([0-9.,]+\s*(?:万元|万|元))/)?.[1]),
    noticeDate: firstNonEmpty(
      document.leadDateText,
      text.match(/(?:发布时间|公告时间|公告日期)[：:\s]*([0-9]{4}[年/-][0-9]{1,2}[月/-][0-9]{1,2}日?)/)?.[1]
    ),
    tradeDate: firstNonEmpty(
      readField(fields, ["挂牌竞价截止时间"]),
      pickByLabel(["挂牌竞价截止时间：", "挂牌截止时间：", "挂牌截止时间"], ["成交时间", "竞得人", "竞得单位", "成交价格", "成交价"])
    ),
    dealDate: firstNonEmpty(
      readField(fields, ["成交时间", "成交日期"]),
      pickByLabel(["成交时间：", "成交日期："], ["竞得人", "竞得单位", "成交价格", "成交价"])
    ),
    dealPrice: firstNonEmpty(
      readField(fields, ["成交价格", "成交价"]),
      text.match(/成交(?:价格|价)[：:\s]*([0-9.,]+\s*(?:万元|万|元))/)?.[1]
    ),
    winner: firstNonEmpty(
      readField(fields, ["竞得人", "竞得单位", "受让人"]),
      pickByLabel(["竞得人：", "竞得单位：", "受让人："], ["成交价格", "成交价", "成交时间", "交易时间"])
    )
  };
}

class BeijingSiteAdapter extends ConfiguredHtmlSiteAdapter {
  public override async openDetail(page: Page, bizType: "notice" | "result", itemIndex: number): Promise<Page> {
    const selectors = bizType === "notice" ? config.notice.selectors : config.result.selectors;
    this.listPage = page;
    const item = page.locator(selectors.listItem).nth(itemIndex);
    const link = selectors.titleLink ? item.locator(selectors.titleLink).first() : item;
    const clickTarget = (await link.count().catch(() => 0)) > 0 ? link : item;
    const popupPromise = page.context().waitForEvent("page", { timeout: 2_500 }).catch(() => null);
    await clickTarget.click({ timeout: 10_000 });
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 60_000 });
      return popup;
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    return page;
  }

  public override async parseDetail(page: Page, bizType: "notice" | "result", context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    const selectors = bizType === "notice" ? config.notice.selectors : config.result.selectors;
    const document = await extractDocument(page, selectors);
    const fields = extractBeijingDetailFields(document);
    const sourceUrl = page.url();
    const attachmentsJson = document.attachments.length > 0 ? JSON.stringify(document.attachments) : null;
    const title = document.title || context.listItem.title;
    const parcelNo = firstNonEmpty(fields.parcelNo, extractBeijingParcelNo(title));
    const district = extractBeijingLocation(title, fields.noticeNo);
    const noticeNoNorm = normalizeNoticeNo(fields.noticeNo);
    const sourceKey = buildStableSourceKey(this.siteCode, bizType, [
      noticeNoNorm,
      parcelNo,
      fields.noticeDate,
      fields.tradeDate,
      title,
      sourceUrl
    ]);

    if (bizType === "notice") {
      return [
        {
          siteCode: this.siteCode,
          sourceKey,
          sourceUrl,
          sourceTitle: context.listItem.title,
          city: this.cityName,
          district,
          noticeTitle: title,
          noticeNoRaw: fields.noticeNo,
          noticeNoNorm,
          landUsage: fields.landUsage,
          areaHa: parseBeijingAreaHa(fields.area),
          startPriceWan: parseChineseNumber(fields.startPrice),
          noticeDate: normalizeDate(fields.noticeDate),
          tradeDate: normalizeDate(fields.tradeDate),
          parcelNo,
          contentText: document.contentText,
          rawHtml: document.rawHtml,
          attachmentsJson,
          crawlTime: new Date()
        }
      ];
    }

    const dealPriceWan = parseChineseNumber(fields.dealPrice);
    const winner = fields.winner;
    return [
      {
        siteCode: this.siteCode,
        sourceKey,
        sourceUrl,
        sourceTitle: context.listItem.title,
        city: this.cityName,
        district,
        resultTitle: title,
        noticeNoRaw: fields.noticeNo,
        noticeNoNorm,
        dealPriceWan,
        winner,
        status: dealPriceWan !== null || winner ? "成交" : null,
        dealDate: normalizeDate(fields.dealDate),
        parcelNo,
        contentText: document.contentText,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      }
    ];
  }

  public override async returnToList(page: Page, bizType: "notice" | "result"): Promise<Page> {
    const returnButton = page.locator("#detailDiv .layui-btn").first();
    if ((await returnButton.count()) > 0) {
      await returnButton.click().catch(() => undefined);
    } else {
      await page.evaluate(() => {
        const fn = (globalThis as { fanhui?: () => void }).fanhui;
        if (typeof fn === "function") {
          fn();
        }
      }).catch(() => undefined);
    }
    await this.waitForListReady(page, bizType);
    return page;
  }
}

export const beijingAdapter = new BeijingSiteAdapter(config);
