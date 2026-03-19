import type { ManualReviewRecord, MergedLandRecord, ParsedNoticeRecord, ParsedResultRecord, SiteCode } from "../domain/types.js";

export interface MergeOutput {
  records: MergedLandRecord[];
  reviewPool: ManualReviewRecord[];
}

function resolveAnnouncementNo(item: {
  normalizedAnnouncementNo?: string | null;
  noticeNoNorm: string | null;
  noticeNoRaw: string | null;
}): string | null {
  return item.noticeNoRaw ?? item.noticeNoNorm ?? item.normalizedAnnouncementNo ?? null;
}

function resolveParcelName(item: { parcelNo: string | null }): string | null {
  return item.parcelNo;
}

function normalizeParcelNameForMatch(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/[〔【\[]/g, "(")
    .replace(/[〕】\]]/g, ")")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[—–－﹣]/g, "-")
    .toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function mergeNoticeAndResults(siteCode: SiteCode, notices: ParsedNoticeRecord[], results: ParsedResultRecord[]): MergeOutput {
  const records: MergedLandRecord[] = [];
  const reviewPool: ManualReviewRecord[] = [];
  const noticesByParcelName = new Map<string, ParsedNoticeRecord[]>();
  const resultsByParcelName = new Map<string, ParsedResultRecord[]>();
  const resultsWithoutParcel: ParsedResultRecord[] = [];
  const matchedNoticeKeys = new Set<string>();
  const reviewedResultKeys = new Set<string>();
  const reviewedNoticeKeys = new Set<string>();

  for (const notice of notices) {
    const parcelKey = normalizeParcelNameForMatch(resolveParcelName(notice));
    if (!parcelKey) {
      continue;
    }
    const bucket = noticesByParcelName.get(parcelKey) ?? [];
    bucket.push(notice);
    noticesByParcelName.set(parcelKey, bucket);
  }

  for (const result of results) {
    const parcelKey = normalizeParcelNameForMatch(resolveParcelName(result));
    if (!parcelKey) {
      resultsWithoutParcel.push(result);
      continue;
    }
    const bucket = resultsByParcelName.get(parcelKey) ?? [];
    bucket.push(result);
    resultsByParcelName.set(parcelKey, bucket);
  }

  const allParcelKeys = new Set<string>([...noticesByParcelName.keys(), ...resultsByParcelName.keys()]);
  for (const parcelKey of allParcelKeys) {
    const noticeGroup = noticesByParcelName.get(parcelKey) ?? [];
    const resultGroup = resultsByParcelName.get(parcelKey) ?? [];

    if (noticeGroup.length > 1 || resultGroup.length > 1) {
      for (const notice of noticeGroup) {
        reviewPool.push({
          siteCode,
          city: notice.city,
          district: notice.district,
          announcementNo: resolveAnnouncementNo(notice),
          parcelName: resolveParcelName(notice),
          noticeDate: notice.noticeDate,
          tradeDate: notice.tradeDate,
          reasonCode: "ambiguous_match",
          noticeSourceUrl: notice.sourceUrl,
          resultSourceUrl: null
        });
        reviewedNoticeKeys.add(notice.sourceKey);
      }
      for (const result of resultGroup) {
        reviewPool.push({
          siteCode,
          city: result.city,
          district: result.district,
          announcementNo: resolveAnnouncementNo(result),
          parcelName: resolveParcelName(result),
          noticeDate: null,
          tradeDate: result.dealDate,
          reasonCode: "ambiguous_match",
          noticeSourceUrl: null,
          resultSourceUrl: result.sourceUrl
        });
        reviewedResultKeys.add(result.sourceKey);
      }
      continue;
    }

    const notice = noticeGroup[0];
    const result = resultGroup[0];

    // 成交后以结果为准：有结果就写已成交记录；无结果则后续按公告写待交易记录。
    if (result) {
      const announcementNo = resolveAnnouncementNo(result) ?? (notice ? resolveAnnouncementNo(notice) : null);
      const parcelName = resolveParcelName(result) ?? (notice ? resolveParcelName(notice) : null);

      if (!announcementNo) {
        reviewPool.push({
          siteCode,
          city: result.city,
          district: result.district ?? notice?.district ?? null,
          announcementNo: null,
          parcelName,
          noticeDate: notice?.noticeDate ?? null,
          tradeDate: result.dealDate ?? notice?.tradeDate ?? null,
          reasonCode: "missing_announcement_no",
          noticeSourceUrl: notice?.sourceUrl ?? null,
          resultSourceUrl: result.sourceUrl
        });
        reviewedResultKeys.add(result.sourceKey);
        if (notice) {
          reviewedNoticeKeys.add(notice.sourceKey);
        }
        continue;
      }

      if (!parcelName) {
        reviewPool.push({
          siteCode,
          city: result.city,
          district: result.district ?? notice?.district ?? null,
          announcementNo,
          parcelName: null,
          noticeDate: notice?.noticeDate ?? null,
          tradeDate: result.dealDate ?? notice?.tradeDate ?? null,
          reasonCode: "missing_parcel_name",
          noticeSourceUrl: notice?.sourceUrl ?? null,
          resultSourceUrl: result.sourceUrl
        });
        reviewedResultKeys.add(result.sourceKey);
        if (notice) {
          reviewedNoticeKeys.add(notice.sourceKey);
        }
        continue;
      }

      records.push({
        siteCode,
        city: result.city || notice?.city || "",
        district: result.district ?? notice?.district ?? null,
        announcementNo,
        tradeDate: result.dealDate ?? notice?.tradeDate ?? null,
        parcelName,
        landUsage: notice?.landUsage ?? null,
        areaHa: notice?.areaHa ?? null,
        startPriceWan: notice?.startPriceWan ?? null,
        dealPriceWan: result.dealPriceWan,
        noticeDate: notice?.noticeDate ?? null,
        tradeStatus: result.status ?? "已成交",
        winner: result.winner,
        noticeSourceUrl: notice?.sourceUrl ?? null,
        resultSourceUrl: result.sourceUrl
      });

      reviewedResultKeys.add(result.sourceKey);
      if (notice) {
        matchedNoticeKeys.add(notice.sourceKey);
      }
    }
  }

  for (const notice of notices) {
    if (matchedNoticeKeys.has(notice.sourceKey) || reviewedNoticeKeys.has(notice.sourceKey)) {
      continue;
    }
    const announcementNo = resolveAnnouncementNo(notice);
    const parcelName = resolveParcelName(notice);
    if (!announcementNo) {
      reviewPool.push({
        siteCode,
        city: notice.city,
        district: notice.district,
        announcementNo: null,
        parcelName,
        noticeDate: notice.noticeDate,
        tradeDate: notice.tradeDate,
        reasonCode: "missing_announcement_no",
        noticeSourceUrl: notice.sourceUrl,
        resultSourceUrl: null
      });
      continue;
    }
    if (!parcelName) {
      reviewPool.push({
        siteCode,
        city: notice.city,
        district: notice.district,
        announcementNo,
        parcelName: null,
        noticeDate: notice.noticeDate,
        tradeDate: notice.tradeDate,
        reasonCode: "missing_parcel_name",
        noticeSourceUrl: notice.sourceUrl,
        resultSourceUrl: null
      });
      continue;
    }
    records.push({
      siteCode,
      city: notice.city,
      district: notice.district,
      announcementNo,
      tradeDate: notice.tradeDate,
      parcelName,
      landUsage: notice.landUsage,
      areaHa: notice.areaHa,
      startPriceWan: notice.startPriceWan,
      dealPriceWan: null,
      noticeDate: notice.noticeDate,
      tradeStatus: "待交易",
      winner: null,
      noticeSourceUrl: notice.sourceUrl,
      resultSourceUrl: null
    });
  }

  for (const result of resultsWithoutParcel) {
    if (reviewedResultKeys.has(result.sourceKey)) {
      continue;
    }
    reviewPool.push({
      siteCode,
      city: result.city,
      district: result.district,
      announcementNo: resolveAnnouncementNo(result),
      parcelName: null,
      noticeDate: null,
      tradeDate: result.dealDate,
      reasonCode: "missing_parcel_name",
      noticeSourceUrl: null,
      resultSourceUrl: result.sourceUrl
    });
    reviewedResultKeys.add(result.sourceKey);
  }

  for (const result of results) {
    if (reviewedResultKeys.has(result.sourceKey)) {
      continue;
    }
    reviewPool.push({
      siteCode,
      city: result.city,
      district: result.district,
      announcementNo: resolveAnnouncementNo(result),
      parcelName: resolveParcelName(result),
      noticeDate: null,
      tradeDate: result.dealDate,
      reasonCode: "orphan_result",
      noticeSourceUrl: null,
      resultSourceUrl: result.sourceUrl
    });
  }

  return { records, reviewPool };
}
