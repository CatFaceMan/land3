
import type { Page } from "playwright";
import type { BizType, ListItemSummary, ParseDetailContext, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";
import { normalizeDate } from "../utils/date.js";
import { normalizeNoticeNo } from "../utils/notice-no-normalizer.js";
import { parseAreaToHectare, parseChineseNumber } from "../utils/number.js";
import { buildStableSourceKey } from "../utils/source-key.js";
import { cleanStatus, cleanText } from "../utils/text.js";
import { extractDocument } from "./base-html-adapter.js";
import { waitForAny } from "../utils/browser-utils.js";
import type { SiteAdapter, SiteSelectors } from "./site-adapter.js";

const NOTICE_URL = "http://www.landjs.com/affiche/indexNew/5";
const RESULT_URL = "http://www.landjs.com/tAfficheParcel/bargainParcelNew";
const JIANGSU_WAIT_TIMEOUT_MS = 60_000;
const JIANGSU_FETCH_TIMEOUT_MS = 20_000;

const SELECTORS: SiteSelectors = {
  listReady: [".main-middle", ".list", "body"],
  listItem: ".main-middle li, .list li, table tbody tr",
  titleLink: "a",
  nextPage: [".next", ".page-next"],
  detailReady: [".main-middle", "table", "body"],
  detailTitle: ["h1", ".detail-title", "title"],
  content: [".main-middle", ".detail", "body"],
  attachment: "a[href]"
};

type JiangsuFields = {
  noticeNo: string | null;
  district: string | null;
  landUsage: string | null;
  area: string | null;
  startPrice: string | null;
  noticeDate: string | null;
  tradeDate: string | null;
  parcelNo: string | null;
  dealPrice: string | null;
  winner: string | null;
  status: string | null;
};

type JiangsuNoticeListItem = {
  gyggGuid: string;
  afficheType: number | string | null;
  afficheName?: string | null;
  afficheNo?: string | null;
  afficheDate?: number | string | null;
};

type JiangsuResultListItem = {
  cjgsGuid: string;
  dkBh?: string | null;
  afficheNo?: string | null;
  bargainDate?: number | string | null;
};

type JiangsuListResponse = {
  totalPages: number;
  currentPage: number;
  list?: JiangsuNoticeListItem[];
  bargainParcelList?: JiangsuResultListItem[];
};

type CachedListPage = {
  pageNo: number;
  items: ListItemSummary[];
  totalPages: number;
};

type JiangsuAttachment = {
  fjMc?: string | null;
  fjFilename?: string | null;
  fjLj?: string | null;
};

type JiangsuParcel = {
  xzqDm?: string | null;
  afficheNo?: string | null;
  parcelNo?: string | null;
  dkBh?: string | null;
  afficheDate?: number | string | null;
  startPrice?: number | string | null;
  remiseArea?: number | string | null;
  landUse?: string | null;
  tdYt?: string | null;
  bidEndtime?: string | null;
  landPosition?: string | null;
};

type JiangsuBargainParcel = {
  afficheNo?: string | null;
  parcelNo?: string | null;
  dkBh?: string | null;
  bargainDate?: number | string | null;
  alienee?: string | null;
  price?: number | string | null;
  status?: number | string | null;
  jyzt?: string | null;
  tdYt?: string | null;
  landUse?: string | null;
  xzqDm?: string | null;
};

type JiangsuAffiche = {
  afficheNo?: string | null;
  afficheName?: string | null;
  afficheDate?: number | string | null;
  xzqDm?: string | null;
  oldGyggGuid?: string | null;
  remiseBulletin?: string | null;
  afficheType?: number | string | null;
};

type JiangsuParcelInfoResponse = {
  affiche?: JiangsuAffiche | null;
  tAfficheParcel?: JiangsuParcel | null;
  tBargainParcel?: JiangsuBargainParcel | null;
  sellNotice?: JiangsuAttachment[] | null;
  sellFile?: JiangsuAttachment[] | null;
  scenePic?: JiangsuAttachment[] | null;
  otherAttach?: JiangsuAttachment[] | null;
  guihuaFile?: JiangsuAttachment[] | null;
  touziFile?: JiangsuAttachment[] | null;
};

type JiangsuAfficheDetailResponse = {
  affiche?: JiangsuAffiche | null;
  parcelList?: Array<JiangsuParcel & { ggdkGuid?: string | null }> | null;
};

type JiangsuRegionInfo = {
  city: string;
  district: string | null;
};

type JiangsuNoticeOverrides = {
  noticeNoRaw?: string | null;
  noticeTitle?: string | null;
  noticeDate?: string | null;
  tradeDate?: string | null;
  city?: string;
  district?: string | null;
};

const JIANGSU_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const JIANGSU_REGION_ALIASES: Record<string, string> = {
  金坛市: "金坛区"
};

export function normalizeJiangsuEpochDate(value: number | string | null | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return JIANGSU_DATE_FORMATTER.format(new Date(value));
  }
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const millis = trimmed.length === 10 ? numeric * 1000 : numeric;
        return JIANGSU_DATE_FORMATTER.format(new Date(millis));
      }
    }
    return normalizeDate(trimmed);
  }
  return null;
}

export function normalizeJiangsuDistrictName(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  return JIANGSU_REGION_ALIASES[normalized] ?? normalized;
}

export function resolveJiangsuLandUsage(
  landUse: string | null | undefined,
  tdYt: string | null | undefined,
  regionCode?: string | null | undefined
): string | null {
  const normalizedLandUse = cleanText(landUse);
  const normalizedTdYt = cleanText(tdYt);
  if (!normalizedLandUse) {
    return normalizedTdYt;
  }
  if (!normalizedTdYt) {
    return normalizedLandUse;
  }
  const normalizedRegionCode = cleanText(regionCode);
  if (normalizedRegionCode?.startsWith("3205") && ["商业", "商住", "其它"].includes(normalizedLandUse)) {
    return normalizedTdYt;
  }
  return normalizedLandUse;
}

export function resolveJiangsuWinner(value: string | null | undefined): string | null {
  const normalized = cleanText(value);
  if (!normalized) {
    return null;
  }
  const companies = normalized
    .split(/[，,]/)
    .map((item) => cleanText(item))
    .filter((item): item is string => Boolean(item));
  if (companies.length <= 1) {
    return normalized;
  }
  return companies.find((item) => item.includes("商业管理")) ?? companies[0];
}

function pickField(fields: Record<string, string>, keys: string[]): string | null {
  for (const name of keys) {
    for (const [field, value] of Object.entries(fields)) {
      if (field.includes(name)) {
        return value;
      }
    }
  }
  return null;
}

function extractFieldMap(rows: Array<Record<string, string>>): JiangsuFields {
  const fields = Object.assign({}, ...rows);
  return {
    noticeNo: pickField(fields, ["公告编号"]),
    district: pickField(fields, ["所属行政区", "行政区"]),
    landUsage: pickField(fields, ["规划用途"]),
    area: pickField(fields, ["出让面积（㎡）", "出让面积"]),
    startPrice: pickField(fields, ["起始价（万元）", "起始价"]),
    noticeDate: pickField(fields, ["公告时间", "公告日期", "发布时间"]),
    tradeDate: pickField(fields, ["挂牌截止时间"]),
    parcelNo: pickField(fields, ["地块编号"]),
    dealPrice: pickField(fields, ["竞得价（万元）", "成交价格（万元）", "成交价（万元）"]),
    winner: pickField(fields, ["竞得单位"]),
    status: pickField(fields, ["交易状态", "成交结果", "状态"])
  };
}

export class JiangsuBaseAdapter implements SiteAdapter {
  private listPage: Page | null = null;
  private readonly cache = new Map<string, CachedListPage>();
  private readonly activePageNo = new Map<BizType, number>();

  constructor(
    public readonly siteCode: SiteCode,
    public readonly cityName: string,
    private readonly xzqDm: string
  ) {}

  public getNavigationStrategy(): "return" {
    return "return";
  }

  public getEntryUrl(bizType: BizType): string {
    return bizType === "notice" ? NOTICE_URL : RESULT_URL;
  }

  public async openEntry(page: Page, bizType: BizType): Promise<void> {
    this.listPage = page;
    await page.goto(this.getEntryUrl(bizType), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.waitForListReady(page, bizType);
  }

  public async waitForListReady(page: Page, _bizType: BizType): Promise<void> {
    await page.waitForLoadState("domcontentloaded");
    await waitForAny(page, ["body"], {
      timeoutMs: JIANGSU_WAIT_TIMEOUT_MS,
      stage: "list_ready",
      url: page.url()
    });
  }

  public async listItems(page: Page, bizType: BizType, pageNo: number): Promise<ListItemSummary[]> {
    const cached = await this.fetchListPage(page, bizType, pageNo);
    this.activePageNo.set(bizType, pageNo);
    return cached.items;
  }

  public async openDetail(page: Page, bizType: BizType, itemIndex: number): Promise<Page> {
    this.listPage = page;
    const pageNo = this.activePageNo.get(bizType) ?? 1;
    const cached = await this.fetchListPage(page, bizType, pageNo);
    const item = cached.items[itemIndex];
    if (!item?.url) {
      throw new Error(`Missing Jiangsu detail url for ${bizType} page=${pageNo} item=${itemIndex}`);
    }
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    return page;
  }

  public async parseDetail(page: Page, bizType: BizType, context: ParseDetailContext): Promise<ParsedNoticeRecord[] | ParsedResultRecord[]> {
    await waitForAny(page, SELECTORS.detailReady, {
      timeoutMs: JIANGSU_WAIT_TIMEOUT_MS,
      stage: "detail_ready",
      url: page.url()
    });
    const records: Array<ParsedNoticeRecord | ParsedResultRecord> = [];

    if (bizType === "result") {
      const parsed = await this.parseL2Detail(page, bizType, context, 0);
      records.push(parsed);
      return records as ParsedNoticeRecord[] | ParsedResultRecord[];
    }

    const afficheDetail = await this.fetchAfficheDetail(page);
    const currentAffiche = afficheDetail.affiche ?? {};
    let parcelList = afficheDetail.parcelList ?? [];
    const noticeOverridesByParcel = new Map<string, JiangsuNoticeOverrides>();

    if (parcelList.length === 0) {
      const oldGyggGuid = cleanText(currentAffiche.oldGyggGuid);
      if (oldGyggGuid) {
        const originalDetail = await this.fetchAfficheDetailById(page, oldGyggGuid);
        const originalAffiche = originalDetail.affiche ?? {};
        parcelList = originalDetail.parcelList ?? [];
        const noticeDate = this.normalizeEpochDate(currentAffiche.afficheDate);
        for (const parcel of parcelList) {
          const parcelNo = cleanText(parcel.dkBh) || cleanText(parcel.parcelNo);
          if (!parcelNo) {
            continue;
          }
          const region = await this.resolveRegionInfo(page, parcel.xzqDm);
          noticeOverridesByParcel.set(parcelNo, {
            noticeNoRaw: cleanText(originalAffiche.afficheNo) || cleanText(parcel.afficheNo) || null,
            noticeTitle: cleanText(originalAffiche.afficheName) || cleanText(currentAffiche.afficheName) || null,
            noticeDate,
            tradeDate: this.extractOverrideTradeDate(currentAffiche.remiseBulletin, parcelNo),
            city: region.city,
            district: region.district
          });
        }
      }
    }

    if (parcelList.length === 0) {
      throw new Error(`Jiangsu notice parcel list not found on ${page.url()}`);
    }

    for (let index = 0; index < parcelList.length; index += 1) {
      const guid = cleanText(parcelList[index].ggdkGuid);
      if (!guid) {
        continue;
      }
      const detailPage = await page.context().newPage();
      await detailPage.goto(`http://www.landjs.com/tAfficheParcel/detail/remise/${guid}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const parcelNo = cleanText(parcelList[index].dkBh) || cleanText(parcelList[index].parcelNo);
      records.push(await this.parseL2Detail(detailPage, bizType, context, index, parcelNo ? noticeOverridesByParcel.get(parcelNo) : undefined));
      await detailPage.close().catch(() => undefined);
      await page.bringToFront().catch(() => undefined);
    }

    return records as ParsedNoticeRecord[] | ParsedResultRecord[];
  }

  public async returnToList(page: Page, bizType: BizType): Promise<Page> {
    await this.openEntry(page, bizType);
    return page;
  }

  public async gotoPage(page: Page, bizType: BizType, targetPageNo: number): Promise<void> {
    await this.openEntry(page, bizType);
    await this.fetchListPage(page, bizType, targetPageNo);
    this.activePageNo.set(bizType, targetPageNo);
  }

  public async nextPage(page: Page, bizType: BizType, currentPageNo: number): Promise<boolean> {
    const cached = await this.fetchListPage(page, bizType, currentPageNo);
    if (currentPageNo >= cached.totalPages) {
      return false;
    }
    const nextPage = await this.fetchListPage(page, bizType, currentPageNo + 1);
    this.activePageNo.set(bizType, currentPageNo + 1);
    return nextPage.items.length > 0;
  }

  private async fetchListPage(page: Page, bizType: BizType, pageNo: number): Promise<CachedListPage> {
    const cacheKey = `${bizType}:${pageNo}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await page.evaluate(
      async ({ apiUrl, pageNo: targetPageNo, xzqDm, timeoutMs }) => {
        const runtime = globalThis as typeof globalThis & { getForm?: () => Record<string, unknown> };
        const payload = typeof runtime.getForm === "function"
          ? runtime.getForm()
          : {};
        payload.index = targetPageNo;
        if (xzqDm) {
          payload.xzqDm = xzqDm;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let request: Response;
        try {
          request = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "include",
            signal: controller.signal
          });
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (name === "AbortError") {
            throw new Error(`Jiangsu list request timeout after ${timeoutMs}ms url=${apiUrl}`);
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
        if (!request.ok) {
          throw new Error(`Jiangsu list request failed: ${request.status}`);
        }
        return (await request.json()) as JiangsuListResponse;
      },
      {
        apiUrl: bizType === "notice" ? "http://www.landjs.com/affiche/information" : "http://www.landjs.com/tAfficheParcel/searchBargainParcel",
        pageNo,
        xzqDm: this.xzqDm,
        timeoutMs: JIANGSU_FETCH_TIMEOUT_MS
      }
    );

    const items =
      bizType === "notice"
        ? (response.list ?? []).map((item, index) => {
            const title = cleanText([item.afficheName, item.afficheNo ? `(${item.afficheNo})` : null].filter(Boolean).join(" ")) || `item-${index + 1}`;
            return {
              title,
              url: `http://www.landjs.com/affiche/${item.gyggGuid}/${item.afficheType ?? ""}`,
              publishedAt: this.normalizeEpochDate(item.afficheDate),
              pageNo,
              itemIndex: index
            } satisfies ListItemSummary;
          })
        : (response.bargainParcelList ?? []).map((item, index) => {
            const title = cleanText([item.dkBh, item.afficheNo].filter(Boolean).join(" ")) || `item-${index + 1}`;
            return {
              title,
              url: `http://www.landjs.com/tAfficheParcel/detail/bargain/${item.cjgsGuid}`,
              publishedAt: this.normalizeEpochDate(item.bargainDate),
              pageNo,
              itemIndex: index
            } satisfies ListItemSummary;
          });

    const normalized: CachedListPage = {
      pageNo,
      items,
      totalPages: Number(response.totalPages) || pageNo
    };
    this.cache.set(cacheKey, normalized);
    return normalized;
  }

  private async fetchParcelInfo(page: Page, bizType: BizType): Promise<JiangsuParcelInfoResponse> {
    const idMatch = page.url().match(/\/detail\/(?:remise|bargain)\/([^/?#]+)/);
    const parcelId = idMatch?.[1];
    if (!parcelId) {
      throw new Error(`Unable to resolve Jiangsu parcelId from ${page.url()}`);
    }

    return await page.evaluate(
      async ({ parcelId, bizType, timeoutMs }) => {
        const body = new URLSearchParams({
          parcelId,
          type: bizType === "notice" ? "remise" : "bargain",
          landIds: ""
        }).toString();
        const url = "http://www.landjs.com/tAfficheParcel/searchParcelInfo";
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body,
            credentials: "include",
            signal: controller.signal
          });
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (name === "AbortError") {
            throw new Error(`Jiangsu parcel info request timeout after ${timeoutMs}ms url=${url}`);
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
        if (!response.ok) {
          throw new Error(`Jiangsu parcel info request failed: ${response.status}`);
        }
        return (await response.json()) as JiangsuParcelInfoResponse;
      },
      { parcelId, bizType, timeoutMs: JIANGSU_FETCH_TIMEOUT_MS }
    );
  }

  private async fetchAfficheDetailById(page: Page, gyggGuid: string): Promise<JiangsuAfficheDetailResponse> {
    return await page.evaluate(async ({ targetGyggGuid, timeoutMs }) => {
      const url = `http://www.landjs.com/affiche/parcels/${targetGyggGuid}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(url, {
          credentials: "include",
          signal: controller.signal
        });
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (name === "AbortError") {
          throw new Error(`Jiangsu affiche detail request timeout after ${timeoutMs}ms url=${url}`);
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw new Error(`Jiangsu affiche detail request failed: ${response.status}`);
      }
      return (await response.json()) as JiangsuAfficheDetailResponse;
    }, { targetGyggGuid: gyggGuid, timeoutMs: JIANGSU_FETCH_TIMEOUT_MS });
  }

  private async fetchAfficheDetail(page: Page): Promise<JiangsuAfficheDetailResponse> {
    const gyggGuid = page.url().match(/\/affiche\/([^/?#]+)/)?.[1];
    if (!gyggGuid) {
      throw new Error(`Unable to resolve Jiangsu affiche id from ${page.url()}`);
    }
    return await this.fetchAfficheDetailById(page, gyggGuid);
  }

  private buildAttachmentsJson(payload: JiangsuParcelInfoResponse, document: Awaited<ReturnType<typeof extractDocument>>): string | null {
    const payloadAttachments = [
      ...(payload.sellNotice ?? []),
      ...(payload.sellFile ?? []),
      ...(payload.scenePic ?? []),
      ...(payload.otherAttach ?? []),
      ...(payload.guihuaFile ?? []),
      ...(payload.touziFile ?? [])
    ]
      .map((item) => {
        const relative = cleanText(item.fjLj);
        if (!relative) {
          return null;
        }
        return {
          text: cleanText(item.fjMc) || cleanText(item.fjFilename) || "附件",
          url: relative.startsWith("http") ? relative : `http://www.landjs.com/${relative.replace(/^\/+/, "")}`
        };
      })
      .filter((item): item is { text: string; url: string } => Boolean(item?.url));

    const attachments = payloadAttachments.length > 0 ? payloadAttachments : document.attachments;
    return attachments.length > 0 ? JSON.stringify(attachments) : null;
  }

  private normalizeEpochDate(value: number | string | null | undefined): string | null {
    return normalizeJiangsuEpochDate(value);
  }

  private async resolveRegionInfo(page: Page, code: string | null | undefined): Promise<JiangsuRegionInfo> {
    const normalizedCode = cleanText(code);
    if (!normalizedCode) {
      return {
        city: this.cityName,
        district: null
      };
    }
    try {
      const region = await page.evaluate((regionCode) => {
        const runtime = globalThis as typeof globalThis & {
          Constant?: {
            getRegionDict?: (value: string) => string;
          };
        };
        if (typeof runtime.Constant?.getRegionDict !== "function") {
          return null;
        }
        const district = runtime.Constant.getRegionDict(regionCode);
        const cityCode = regionCode.length >= 4 ? regionCode.slice(0, 4) : regionCode;
        const city = runtime.Constant.getRegionDict(cityCode);
        return { city, district };
      }, normalizedCode);
      return {
        city: cleanText(region?.city) || this.cityName,
        district: normalizeJiangsuDistrictName(region?.district) || normalizedCode
      };
    } catch {
      return {
        city: this.cityName,
        district: normalizeJiangsuDistrictName(normalizedCode) || normalizedCode
      };
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private extractOverrideTradeDate(bulletin: string | null | undefined, parcelNo: string | null | undefined): string | null {
    const text = cleanText(bulletin);
    const normalizedParcelNo = cleanText(parcelNo);
    if (!text) {
      return null;
    }
    if (normalizedParcelNo) {
      const parcelScoped = text.match(
        new RegExp(`${this.escapeRegExp(normalizedParcelNo)}[\\s\\S]{0,80}?挂牌截止时间(?:调整)?(?:为|至)?\\s*([0-9]{4}年\\d{1,2}月\\d{1,2}日\\d{1,2}[:：]\\d{2})`)
      )?.[1];
      const parsed = normalizeDate(parcelScoped);
      if (parsed) {
        return parsed;
      }
    }
    return normalizeDate(text.match(/挂牌截止时间(?:调整)?(?:为|至)?\s*([0-9]{4}年\d{1,2}月\d{1,2}日\d{1,2}[:：]\d{2})/)?.[1] ?? null);
  }

  private resolveResultStatus(value: string | number | null | undefined): string | null {
    const normalized = cleanText(value === null || value === undefined ? null : String(value));
    if (!normalized) {
      return null;
    }
    return normalized === "41" || normalized === "1" ? "已成交" : cleanStatus(normalized);
  }

  private async parseL2Detail(
    page: Page,
    bizType: BizType,
    context: ParseDetailContext,
    subIndex: number,
    overrides?: JiangsuNoticeOverrides
  ): Promise<ParsedNoticeRecord | ParsedResultRecord> {
    const document = await extractDocument(page, SELECTORS);
    const payload = await this.fetchParcelInfo(page, bizType);
    const sourceUrl = page.url();
    const attachmentsJson = this.buildAttachmentsJson(payload, document);

    if (bizType === "notice") {
      const affiche = payload.affiche ?? {};
      const parcel = payload.tAfficheParcel ?? {};
      const noticeNoRaw = overrides?.noticeNoRaw ?? cleanText(parcel.afficheNo) ?? cleanText(affiche.afficheNo) ?? null;
      const parcelNo = cleanText(parcel.dkBh) || cleanText(parcel.parcelNo) || null;
      const landUsage = resolveJiangsuLandUsage(parcel.landUse, parcel.tdYt, cleanText(parcel.xzqDm) || cleanText(affiche.xzqDm));
      const region = await this.resolveRegionInfo(page, cleanText(parcel.xzqDm) || cleanText(affiche.xzqDm) || null);
      const sourceKey = buildStableSourceKey(this.siteCode, "notice", [
        normalizeNoticeNo(noticeNoRaw),
        parcelNo,
        String(subIndex),
        document.title,
        sourceUrl
      ]);

      return {
        siteCode: this.siteCode,
        sourceKey,
        sourceUrl,
        sourceTitle: `${context.listItem.title}-${subIndex + 1}`,
        noticeTitle: document.title || context.listItem.title,
        city: overrides?.city ?? region.city,
        district: overrides?.district ?? region.district,
        noticeNoRaw,
        noticeNoNorm: normalizeNoticeNo(noticeNoRaw),
        parcelNo,
        landUsage,
        areaHa: parseAreaToHectare(parcel.remiseArea),
        startPriceWan: parseChineseNumber(parcel.startPrice),
        dealPriceWan: null,
        winner: null,
        status: "待交易",
        noticeDate: overrides?.noticeDate ?? this.normalizeEpochDate(affiche.afficheDate),
        tradeDate: overrides?.tradeDate ?? this.normalizeEpochDate(parcel.bidEndtime),
        contentText: document.contentText,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      };
    } else {
      const bargain = payload.tBargainParcel ?? {};
      const affiche = payload.affiche ?? {};
      const noticeNoRaw = cleanText(bargain.afficheNo) || null;
      const parcelNo = cleanText(bargain.dkBh) || cleanText(bargain.parcelNo) || null;
      const landUsage = resolveJiangsuLandUsage(bargain.landUse, bargain.tdYt, cleanText(bargain.xzqDm));
      const region = await this.resolveRegionInfo(page, cleanText(bargain.xzqDm));
      const sourceKey = buildStableSourceKey(this.siteCode, "result", [
        normalizeNoticeNo(noticeNoRaw),
        parcelNo,
        String(subIndex),
        document.title,
        sourceUrl
      ]);

      return {
        siteCode: this.siteCode,
        sourceKey,
        sourceUrl,
        sourceTitle: `${context.listItem.title}-${subIndex + 1}`,
        resultTitle: document.title || context.listItem.title,
        city: region.city,
        district: region.district,
        noticeNoRaw,
        noticeNoNorm: normalizeNoticeNo(noticeNoRaw),
        parcelNo,
        landUsage,
        areaHa: null, // Results page often lacks area, or we can look it up in notice if merged
        startPriceWan: null,
        dealPriceWan: parseChineseNumber(bargain.price),
        winner: resolveJiangsuWinner(bargain.alienee),
        status: this.resolveResultStatus(bargain.status ?? bargain.jyzt),
        noticeDate: null,
        dealDate: this.normalizeEpochDate(bargain.bargainDate),
        tradeDate: null,
        contentText: document.contentText,
        rawHtml: document.rawHtml,
        attachmentsJson,
        crawlTime: new Date()
      };
    }
  }
}

export const suzhouAdapter = new JiangsuBaseAdapter("suzhou", "苏州", "3205");
export const wuxiAdapter = new JiangsuBaseAdapter("wuxi", "无锡", "3202");
export const changzhouAdapter = new JiangsuBaseAdapter("changzhou", "常州", "3204");
