import { DcmPublication } from '../types/dcm';
import {
  resolveJurisdictionMeta,
  resolvePublicDcmPublications,
  resolvePublicationMetadata
} from './dcmConsistency';
import {
  formatDailyDateLabel,
  isDailyPublication,
  parseIsoDate
} from './dcmDaily';
import { getDcmChronoTimestamp } from './dcmComparison';
import { sanitizeExternalUrl } from './dcmEvidence';

export const DCM_CANONICAL_PATH = '/democratic-competitiveness-map';

export const DCM_URL_PARAM_STATE = 'state';
export const DCM_URL_PARAM_DATE = 'date';
export const DCM_URL_PARAM_PUBLICATION = 'publication';

export const EDITORIAL_CORRECTION_NOTICE_LABEL =
  'Editorial correction notice — not a change in political conditions.';

const SAFE_PUBLICATION_ID_REGEX = /^[A-Za-z0-9._-]{2,120}$/;

export interface ParsedDcmUrlParams {
  rawState: string | null;
  canonicalStateName: string | null;
  stateCode: string | null;
  isStateInvalid: boolean;
  rawDate: string | null;
  validDateIso: string | null;
  isDateInvalid: boolean;
  rawPublicationId: string | null;
  validPublicationId: string | null;
  isPublicationIdInvalid: boolean;
  hasAnyDcmParam: boolean;
}

export interface DcmPermalinkResolution {
  /** Resolved published edition, or fallback latest edition when no valid specific match exists */
  activePublication: DcmPublication | null;
  /** Index inside the canonical ascending published list */
  activeIndex: number;
  /** Resolved canonical jurisdiction name (e.g. "Benue", "FCT"), or null */
  selectedStateName: string | null;
  /** True when the URL explicitly pinned a historical edition (never auto-reset to latest) */
  isPermalinkLocked: boolean;
  /** True when the URL requested a publication ID not yet in the currently loaded window (triggers on-demand fetch) */
  requiresOnDemandFetchId: string | null;
  /** User-facing transparent notice if a requested publication ID, date, or state was invalid or unavailable */
  notice: string | null;
  /** Distinguishes exact resolution from unavailable/invalid reference notices */
  noticeTone: 'none' | 'warning' | 'info';
  /** Parsed raw parameters for diagnostics/UI */
  parsed: ParsedDcmUrlParams;
}

export interface PublicationCorrectionChain {
  /** True when activePub supersedes an earlier published edition (e.g. -r2) */
  isCorrectedVersion: boolean;
  /** True when at least one published later correction supersedes activePub */
  hasSubsequentCorrection: boolean;
  /** Root original published edition in this revision lineage (null if unavailable) */
  originalEdition: DcmPublication | null;
  /** Immediate predecessor superseded by activePub, if any */
  previousRevision: DcmPublication | null;
  /** All published subsequent revisions superseding activePub (ordered oldest -> newest) */
  subsequentCorrections: DcmPublication[];
  /** Newest published correction in this lineage, if activePub has been superseded */
  latestCorrection: DcmPublication | null;
  /** Human-readable date of the latest subsequent correction (or activePub if it is a correction) */
  correctionDateLabel: string | null;
  /** Research-supplied revision note, if present */
  revisionNote: string;
  /** Revision number (1 for original, 2+ for corrections) */
  revisionNumber: number;
  /** Explicit governance notice separating editorial corrections from political movement */
  editorialClarityNote: string;
}

export interface DcmArchiveEntry {
  id: string;
  title: string;
  publicationFormat: 'daily' | 'legacy-period';
  isDaily: boolean;
  year: number;
  month: number;
  dateIso: string;
  periodLabel: string;
  publicationDateLabel: string;
  evidenceCutoffLabel: string;
  summaryPreview: string;
  hasApprovedSummary: boolean;
  isQuietDay: boolean;
  revisionNumber: number;
  isCorrectedVersion: boolean;
  hasSubsequentCorrection: boolean;
  supersedesPublicationId?: string;
  permalink: string;
  completeRecordUrl: string | null;
}

export type BiMonthlyReferenceStatus =
  | 'exact_published'
  | 'prior_published_reference'
  | 'none_available';

export interface BiMonthlyComparisonPoint {
  kind: 'mid-month' | 'month-end';
  targetDateIso: string;
  targetDateLabel: string;
  status: BiMonthlyReferenceStatus;
  /** Immutable published edition linked for this point (exact or prior published reference) */
  publication: DcmPublication | null;
  /** Permalink to the immutable snapshot, or null when none available */
  permalink: string | null;
  /** Clear, non-misleading explanation distinguishing exact date vs prior reference vs unavailable */
  statusLabel: string;
}

export interface DcmArchiveIndex {
  years: number[];
  monthsByYear: Record<number, number[]>;
  entries: DcmArchiveEntry[];
  totalPublishedCount: number;
}

export interface DateLookupResult {
  requestedDateIso: string;
  requestedDateLabel: string;
  status: 'exact_daily' | 'exact_legacy_period' | 'unavailable';
  matchedPublication: DcmPublication | null;
  matchedPermalink: string | null;
  /** Most recent earlier published edition, surfaced ONLY as a clearly labelled reference (never presented as that date's publication) */
  mostRecentEarlierPublication: DcmPublication | null;
  mostRecentEarlierLabel: string | null;
  message: string;
}

/**
 * Extracts a canonical ISO YYYY-MM-DD anchor date for any published DCM edition.
 * Prefers daily assessmentDate, then periodEnd, then periodStart.
 */
export function getPublicationIsoDate(pub: DcmPublication | null | undefined): string {
  if (!pub) return '';
  if (pub.assessmentDate && parseIsoDate(pub.assessmentDate)) {
    return pub.assessmentDate.trim();
  }
  if (pub.periodEnd && parseIsoDate(pub.periodEnd)) {
    return pub.periodEnd.trim();
  }
  if (pub.periodStart && parseIsoDate(pub.periodStart)) {
    return pub.periodStart.trim();
  }
  const month = String(Math.max(1, Math.min(12, pub.month || 1))).padStart(2, '0');
  const day = pub.periodIndex === 1 ? '15' : String(getDaysInMonth(pub.year || 2026, pub.month || 1)).padStart(2, '0');
  return `${pub.year || 2026}-${month}-${day}`;
}

export function getDaysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

/**
 * Parses and strictly validates DCM permalink query parameters from a URL search string.
 */
export function parseDcmUrlParams(search: string): ParsedDcmUrlParams {
  const params = new URLSearchParams(search || '');
  const rawState = params.get(DCM_URL_PARAM_STATE)?.trim() || null;
  const rawDate = params.get(DCM_URL_PARAM_DATE)?.trim() || null;
  const rawPublicationId = params.get(DCM_URL_PARAM_PUBLICATION)?.trim() || null;

  let canonicalStateName: string | null = null;
  let stateCode: string | null = null;
  let isStateInvalid = false;

  if (rawState) {
    const meta = resolveJurisdictionMeta(rawState);
    if (meta) {
      canonicalStateName = meta.name;
      stateCode = meta.code;
    } else {
      isStateInvalid = true;
    }
  }

  let validDateIso: string | null = null;
  let isDateInvalid = false;
  if (rawDate) {
    const parsedDate = parseIsoDate(rawDate);
    if (parsedDate) {
      validDateIso = rawDate;
    } else {
      isDateInvalid = true;
    }
  }

  let validPublicationId: string | null = null;
  let isPublicationIdInvalid = false;
  if (rawPublicationId) {
    if (SAFE_PUBLICATION_ID_REGEX.test(rawPublicationId)) {
      validPublicationId = rawPublicationId;
    } else {
      isPublicationIdInvalid = true;
    }
  }

  return {
    rawState,
    canonicalStateName,
    stateCode,
    isStateInvalid,
    rawDate,
    validDateIso,
    isDateInvalid,
    rawPublicationId,
    validPublicationId,
    isPublicationIdInvalid,
    hasAnyDcmParam: Boolean(rawState || rawDate || rawPublicationId)
  };
}

/**
 * Builds a canonical, stable permalink URL for a published DCM edition (and optional state),
 * preserving all unrelated query parameters (e.g. UTM tags or routing parameters).
 *
 * Pattern:
 *   /democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19
 */
export function buildDcmPermalinkUrl(params: {
  publication: DcmPublication;
  stateName?: string | null;
  pathname?: string;
  existingSearch?: string;
}): string {
  const { publication, stateName, pathname = DCM_CANONICAL_PATH, existingSearch = '' } = params;
  const searchParams = new URLSearchParams(existingSearch);

  // Remove old DCM params before re-inserting in clean, deterministic order
  searchParams.delete(DCM_URL_PARAM_STATE);
  searchParams.delete(DCM_URL_PARAM_DATE);
  searchParams.delete(DCM_URL_PARAM_PUBLICATION);

  const ordered = new URLSearchParams();

  // Preserve unrelated query params first
  searchParams.forEach((value, key) => {
    ordered.append(key, value);
  });

  if (stateName) {
    const meta = resolveJurisdictionMeta(stateName);
    if (meta) {
      ordered.set(DCM_URL_PARAM_STATE, meta.name);
    }
  }

  const isoDate = getPublicationIsoDate(publication);
  if (isoDate) {
    ordered.set(DCM_URL_PARAM_DATE, isoDate);
  }
  ordered.set(DCM_URL_PARAM_PUBLICATION, publication.id);

  const qs = ordered.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function buildAbsoluteDcmPermalink(params: {
  publication: DcmPublication;
  stateName?: string | null;
  origin?: string;
  pathname?: string;
  existingSearch?: string;
}): string {
  const origin =
    params.origin ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  const relative = buildDcmPermalinkUrl(params);
  return origin ? `${origin}${relative}` : relative;
}

/**
 * Resolves a permalink query string strictly against published canonical publications.
 *
 * Resolution precedence:
 *  1. `publication` ID takes strict precedence to pinpoint exact immutable editions or revisions.
 *     Drafts and approved-but-unpublished records are never exposed.
 *  2. `date` (YYYY-MM-DD) resolves an exact published daily assessment or legacy period ending/starting on that date.
 *     If no approved publication exists for that date, displays an accurate unavailable notice without fabricating data.
 *  3. Default fallback (no publication/date params): latest published edition (unlocked).
 */
export function resolveDcmPermalink(
  rawPublications: DcmPublication[],
  search: string,
  options?: { allowOnDemandFetchForUnknownId?: boolean }
): DcmPermalinkResolution {
  const publishedAsc = resolvePublicDcmPublications(rawPublications);
  const parsed = parseDcmUrlParams(search);

  const latestIdx = publishedAsc.length - 1;
  const latestPub = latestIdx >= 0 ? publishedAsc[latestIdx] : null;

  const notices: string[] = [];
  let noticeTone: 'none' | 'warning' | 'info' = 'none';
  let activePublication: DcmPublication | null = latestPub;
  let activeIndex = latestIdx;
  let isPermalinkLocked = false;
  let requiresOnDemandFetchId: string | null = null;

  // 1. Validate & resolve publication ID (highest precedence)
  if (parsed.isPublicationIdInvalid) {
    notices.push(
      `The requested publication reference ("${parsed.rawPublicationId}") is not valid. Showing the latest published DCM edition.`
    );
    noticeTone = 'warning';
  } else if (parsed.validPublicationId) {
    const exactIdx = publishedAsc.findIndex((p) => p.id === parsed.validPublicationId);
    if (exactIdx !== -1) {
      activePublication = publishedAsc[exactIdx];
      activeIndex = exactIdx;
      isPermalinkLocked = true;
    } else if (options?.allowOnDemandFetchForUnknownId) {
      requiresOnDemandFetchId = parsed.validPublicationId;
      isPermalinkLocked = true;
    } else {
      notices.push(
        `The requested publication record ("${parsed.validPublicationId}") is unavailable or has not been published publicly. Showing the latest published DCM edition.`
      );
      noticeTone = 'warning';
    }
  } else if (parsed.isDateInvalid) {
    notices.push(
      `The requested assessment date ("${parsed.rawDate}") is not a valid calendar date. Showing the latest published DCM edition.`
    );
    noticeTone = 'warning';
  } else if (parsed.validDateIso) {
    // 2. Date-only permalink lookup (never relies on mutable isLatest flag)
    const lookup = lookupArchiveByDate(publishedAsc, parsed.validDateIso);
    if (lookup.matchedPublication) {
      const idx = publishedAsc.findIndex((p) => p.id === lookup.matchedPublication!.id);
      if (idx !== -1) {
        activePublication = publishedAsc[idx];
        activeIndex = idx;
        isPermalinkLocked = true;
      }
    } else {
      notices.push(lookup.message);
      noticeTone = 'info';
    }
  }

  // 3. Validate state parameter independently
  if (parsed.isStateInvalid) {
    notices.push(
      `The requested jurisdiction ("${parsed.rawState}") was not recognised among Nigeria's 36 states and the FCT.`
    );
    if (noticeTone === 'none') noticeTone = 'warning';
  }

  return {
    activePublication,
    activeIndex,
    selectedStateName: parsed.canonicalStateName,
    isPermalinkLocked,
    requiresOnDemandFetchId,
    notice: notices.length > 0 ? notices.join(' ') : null,
    noticeTone,
    parsed
  };
}

/**
 * Resolves the complete immutable correction lineage for any published DCM edition.
 * Enables transparent navigation between original published snapshots and subsequent revisions
 * without silently replacing the original or treating editorial corrections as political changes.
 */
export function resolvePublicationCorrectionChain(
  rawPublications: DcmPublication[],
  activePub: DcmPublication | null | undefined
): PublicationCorrectionChain {
  if (!activePub || activePub.status !== 'published') {
    return {
      isCorrectedVersion: false,
      hasSubsequentCorrection: false,
      originalEdition: null,
      previousRevision: null,
      subsequentCorrections: [],
      latestCorrection: null,
      correctionDateLabel: null,
      revisionNote: '',
      revisionNumber: 1,
      editorialClarityNote: EDITORIAL_CORRECTION_NOTICE_LABEL
    };
  }

  const publishedAsc = resolvePublicDcmPublications(rawPublications);
  const byId = new Map<string, DcmPublication>();
  for (const pub of publishedAsc) {
    byId.set(pub.id, pub);
  }

  // Walk backward to locate immediate predecessor and root original edition
  const visitedBack = new Set<string>([activePub.id]);
  const previousRevision = activePub.supersedesPublicationId
    ? byId.get(activePub.supersedesPublicationId) || null
    : null;

  let cursor: DcmPublication | null = previousRevision;
  let originalEdition: DcmPublication | null = previousRevision;
  while (cursor && cursor.supersedesPublicationId && !visitedBack.has(cursor.id)) {
    visitedBack.add(cursor.id);
    const parent = byId.get(cursor.supersedesPublicationId) || null;
    if (!parent) break;
    originalEdition = parent;
    cursor = parent;
  }

  // Walk forward (BFS) to find all published subsequent revisions superseding activePub
  const subsequentCorrections: DcmPublication[] = [];
  const frontier = new Set<string>([activePub.id]);
  const seenForward = new Set<string>([activePub.id]);
  let expanded = true;

  while (expanded) {
    expanded = false;
    for (const pub of publishedAsc) {
      if (
        !seenForward.has(pub.id) &&
        pub.supersedesPublicationId &&
        frontier.has(pub.supersedesPublicationId)
      ) {
        seenForward.add(pub.id);
        frontier.add(pub.id);
        subsequentCorrections.push(pub);
        expanded = true;
      }
    }
  }

  subsequentCorrections.sort((a, b) => {
    const revDiff = (a.revisionNumber || 1) - (b.revisionNumber || 1);
    if (revDiff !== 0) return revDiff;
    return getDcmChronoTimestamp(a) - getDcmChronoTimestamp(b);
  });

  const latestCorrection =
    subsequentCorrections.length > 0
      ? subsequentCorrections[subsequentCorrections.length - 1]
      : null;

  const isCorrectedVersion = Boolean(
    activePub.supersedesPublicationId || (activePub.revisionNumber && activePub.revisionNumber > 1)
  );
  const hasSubsequentCorrection = subsequentCorrections.length > 0;

  let correctionDateLabel: string | null = null;
  if (latestCorrection) {
    correctionDateLabel =
      latestCorrection.publishedAt
        ? formatIsoTimestampToDate(latestCorrection.publishedAt)
        : resolvePublicationMetadata(latestCorrection).periodLabel;
  } else if (isCorrectedVersion) {
    correctionDateLabel =
      activePub.publishedAt
        ? formatIsoTimestampToDate(activePub.publishedAt)
        : resolvePublicationMetadata(activePub).periodLabel;
  }

  return {
    isCorrectedVersion,
    hasSubsequentCorrection,
    originalEdition,
    previousRevision,
    subsequentCorrections,
    latestCorrection,
    correctionDateLabel,
    revisionNote: (activePub.revisionNote || '').trim(),
    revisionNumber: activePub.revisionNumber || (isCorrectedVersion ? 2 : 1),
    editorialClarityNote: EDITORIAL_CORRECTION_NOTICE_LABEL
  };
}

function formatIsoTimestampToDate(isoTs: string): string {
  const datePart = isoTs.slice(0, 10);
  if (parseIsoDate(datePart)) {
    return formatDailyDateLabel(datePart);
  }
  return isoTs;
}

/**
 * Looks up whether an approved published DCM edition exists for a specific calendar date (YYYY-MM-DD).
 * Never fabricates a record or implies a daily review occurred when no publication exists.
 */
export function lookupArchiveByDate(
  rawPublications: DcmPublication[],
  targetDateIso: string,
  stateName?: string | null
): DateLookupResult {
  const publishedAsc = resolvePublicDcmPublications(rawPublications);
  const formattedTarget = parseIsoDate(targetDateIso)
    ? formatDailyDateLabel(targetDateIso)
    : targetDateIso;

  if (!parseIsoDate(targetDateIso)) {
    return {
      requestedDateIso: targetDateIso,
      requestedDateLabel: targetDateIso,
      status: 'unavailable',
      matchedPublication: null,
      matchedPermalink: null,
      mostRecentEarlierPublication: null,
      mostRecentEarlierLabel: null,
      message: `The requested date ("${targetDateIso}") is not a valid calendar date.`
    };
  }

  // 1. Exact published daily editions for this assessmentDate (prefer newest published revision on that date if multiple)
  const exactDailyMatches = publishedAsc
    .filter((p) => isDailyPublication(p) && p.assessmentDate === targetDateIso)
    .sort((a, b) => (b.revisionNumber || 1) - (a.revisionNumber || 1));

  if (exactDailyMatches.length > 0) {
    const match = exactDailyMatches[0];
    return {
      requestedDateIso: targetDateIso,
      requestedDateLabel: formattedTarget,
      status: 'exact_daily',
      matchedPublication: match,
      matchedPermalink: buildDcmPermalinkUrl({ publication: match, stateName }),
      mostRecentEarlierPublication: null,
      mostRecentEarlierLabel: null,
      message: `Published daily DCM edition found for ${formattedTarget}.`
    };
  }

  // 2. Exact legacy twice-monthly period ending or starting on this calendar date
  const exactLegacyMatches = publishedAsc
    .filter(
      (p) =>
        !isDailyPublication(p) &&
        (p.periodEnd === targetDateIso || p.periodStart === targetDateIso)
    )
    .sort((a, b) => (b.revisionNumber || 1) - (a.revisionNumber || 1));

  if (exactLegacyMatches.length > 0) {
    const match = exactLegacyMatches[0];
    const meta = resolvePublicationMetadata(match);
    return {
      requestedDateIso: targetDateIso,
      requestedDateLabel: formattedTarget,
      status: 'exact_legacy_period',
      matchedPublication: match,
      matchedPermalink: buildDcmPermalinkUrl({ publication: match, stateName }),
      mostRecentEarlierPublication: null,
      mostRecentEarlierLabel: null,
      message: `Published reporting-period edition found (${meta.periodLabel}).`
    };
  }

  // 3. No approved publication exists for that date — find most recent earlier published edition purely as a separate reference
  const earlierCandidates = publishedAsc.filter((p) => {
    const pubIso = getPublicationIsoDate(p);
    return Boolean(pubIso && pubIso < targetDateIso);
  });
  const mostRecentEarlier =
    earlierCandidates.length > 0 ? earlierCandidates[earlierCandidates.length - 1] : null;
  const earlierLabel = mostRecentEarlier
    ? resolvePublicationMetadata(mostRecentEarlier).periodLabel
    : null;

  return {
    requestedDateIso: targetDateIso,
    requestedDateLabel: formattedTarget,
    status: 'unavailable',
    matchedPublication: null,
    matchedPermalink: null,
    mostRecentEarlierPublication: mostRecentEarlier,
    mostRecentEarlierLabel: earlierLabel,
    message: `No approved DCM publication exists for ${formattedTarget}. No daily review was published on that date.`
  };
}

/**
 * Resolves the two canonical twice-monthly comparison archive reference points (15th and month-end)
 * for any given year and month (1–12), clearly distinguishing exact immutable snapshots published on
 * that date from the most recent earlier published assessment.
 */
export function resolveBiMonthlyComparisonPoints(
  rawPublications: DcmPublication[],
  year: number,
  month1To12: number,
  stateName?: string | null
): BiMonthlyComparisonPoint[] {
  const publishedAsc = resolvePublicDcmPublications(rawPublications);
  const mm = String(month1To12).padStart(2, '0');
  const lastDay = String(getDaysInMonth(year, month1To12)).padStart(2, '0');

  const targets: Array<{ kind: 'mid-month' | 'month-end'; iso: string }> = [
    { kind: 'mid-month', iso: `${year}-${mm}-15` },
    { kind: 'month-end', iso: `${year}-${mm}-${lastDay}` }
  ];

  return targets.map(({ kind, iso }) => {
    const targetDateLabel = formatDailyDateLabel(iso);

    // 1. Check for exact published daily edition on that date OR legacy period ending on that date
    const exactDaily = publishedAsc
      .filter((p) => isDailyPublication(p) && p.assessmentDate === iso)
      .sort((a, b) => (b.revisionNumber || 1) - (a.revisionNumber || 1));

    const exactLegacy = publishedAsc
      .filter(
        (p) =>
          !isDailyPublication(p) &&
          (p.periodEnd === iso ||
            (p.year === year && p.month === month1To12 && p.periodIndex === (kind === 'mid-month' ? 1 : 2)))
      )
      .sort((a, b) => (b.revisionNumber || 1) - (a.revisionNumber || 1));

    const exactMatch = exactDaily[0] || exactLegacy[0] || null;
    if (exactMatch) {
      const meta = resolvePublicationMetadata(exactMatch);
      return {
        kind,
        targetDateIso: iso,
        targetDateLabel,
        status: 'exact_published',
        publication: exactMatch,
        permalink: buildDcmPermalinkUrl({ publication: exactMatch, stateName }),
        statusLabel: isDailyPublication(exactMatch)
          ? `Published snapshot for ${targetDateLabel}`
          : `Published reporting-period snapshot (${meta.periodLabel})`
      };
    }

    // 2. No edition published on the exact date — check most recent earlier published edition (strictly < target date)
    const earlier = publishedAsc.filter((p) => {
      const pubIso = getPublicationIsoDate(p);
      return Boolean(pubIso && pubIso < iso);
    });
    const priorPub = earlier.length > 0 ? earlier[earlier.length - 1] : null;

    if (priorPub) {
      const priorMeta = resolvePublicationMetadata(priorPub);
      return {
        kind,
        targetDateIso: iso,
        targetDateLabel,
        status: 'prior_published_reference',
        publication: priorPub,
        permalink: buildDcmPermalinkUrl({ publication: priorPub, stateName }),
        statusLabel: `No publication on ${targetDateLabel} — Most recent earlier published edition: ${priorMeta.periodLabel}`
      };
    }

    return {
      kind,
      targetDateIso: iso,
      targetDateLabel,
      status: 'none_available',
      publication: null,
      permalink: null,
      statusLabel: `No approved publication exists on or before ${targetDateLabel}.`
    };
  });
}

/**
 * Builds the filterable daily + legacy DCM publication archive index strictly from published records.
 */
export function buildDcmArchiveIndex(
  rawPublications: DcmPublication[],
  filter?: { year?: number | null; month?: number | null; stateName?: string | null }
): DcmArchiveIndex {
  const publishedAsc = resolvePublicDcmPublications(rawPublications);
  const yearsSet = new Set<number>();
  const monthsByYearMap: Record<number, Set<number>> = {};

  for (const pub of publishedAsc) {
    yearsSet.add(pub.year);
    if (!monthsByYearMap[pub.year]) monthsByYearMap[pub.year] = new Set<number>();
    monthsByYearMap[pub.year].add(pub.month);
  }

  const years = Array.from(yearsSet).sort((a, b) => b - a);
  const monthsByYear: Record<number, number[]> = {};
  for (const y of years) {
    monthsByYear[y] = Array.from(monthsByYearMap[y] || []).sort((a, b) => b - a);
  }

  const filteredDesc = [...publishedAsc]
    .reverse()
    .filter((pub) => {
      if (filter?.year && pub.year !== filter.year) return false;
      if (filter?.month && pub.month !== filter.month) return false;
      return true;
    });

  const entries: DcmArchiveEntry[] = filteredDesc.map((pub) => {
    const meta = resolvePublicationMetadata(pub);
    const chain = resolvePublicationCorrectionChain(publishedAsc, pub);
    const daily = isDailyPublication(pub);
    const urlCheck = sanitizeExternalUrl(pub.supportingDocumentUrl);

    return {
      id: pub.id,
      title: pub.title || meta.periodLabel,
      publicationFormat: daily ? 'daily' : 'legacy-period',
      isDaily: daily,
      year: pub.year,
      month: pub.month,
      dateIso: getPublicationIsoDate(pub),
      periodLabel: meta.periodLabel,
      publicationDateLabel: pub.publicationDate || meta.periodLabel,
      evidenceCutoffLabel: meta.evidenceCutoffLabel,
      summaryPreview: meta.summaryParagraphs[0] || '',
      hasApprovedSummary: meta.summaryParagraphs.length > 0,
      isQuietDay: Boolean(pub.isQuietDay),
      revisionNumber: chain.revisionNumber,
      isCorrectedVersion: chain.isCorrectedVersion,
      hasSubsequentCorrection: chain.hasSubsequentCorrection,
      supersedesPublicationId: pub.supersedesPublicationId,
      permalink: buildDcmPermalinkUrl({
        publication: pub,
        stateName: filter?.stateName
      }),
      completeRecordUrl: urlCheck.valid ? urlCheck.sanitizedUrl : null
    };
  });

  return {
    years,
    monthsByYear,
    entries,
    totalPublishedCount: publishedAsc.length
  };
}
