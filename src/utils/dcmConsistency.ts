import {
  DcmClassification,
  DcmPublication,
  DcmStateRecord,
  DCM_CLASSIFICATIONS,
  DCM_COLORS,
  NIGERIA_37_JURISDICTIONS,
  NigeriaJurisdiction
} from '../types/dcm';
import { getPublishedDcmSorted } from './dcmComparison';
import {
  diffClassificationsAgainstSource,
  formatDailyDateLabel,
  formatWatCutoff,
  isDailyPublication
} from './dcmDaily';

export type DcmShortCode = 'G' | 'A' | 'O' | 'R' | 'X' | 'U';

export interface DcmPaletteEntry {
  code: DcmShortCode;
  name: string;
  hex: string;
  stroke: string;
  text: string;
  isUnavailable?: boolean;
}

/**
 * Single canonical AEO DCM palette shared across map paths, legend, state cards,
 * state search results, and historical trend grids. Preserves existing DCM colours.
 */
export const DCM_CANONICAL_CODES: Exclude<DcmShortCode, 'U'>[] = ['G', 'A', 'O', 'R', 'X'];

export const DCM_CLASSIFICATION_TO_CODE: Record<DcmClassification, Exclude<DcmShortCode, 'U'>> = {
  'Open': 'G',
  'Emerging concern': 'A',
  'Constrained': 'O',
  'Severely constrained': 'R',
  'Insufficient evidence': 'X'
};

export const DCM_CANONICAL_PALETTE: Record<DcmShortCode, DcmPaletteEntry> = {
  G: {
    code: 'G',
    name: 'Open',
    hex: DCM_COLORS['Open'].fill,
    stroke: DCM_COLORS['Open'].border,
    text: DCM_COLORS['Open'].text
  },
  A: {
    code: 'A',
    name: 'Emerging concern',
    hex: DCM_COLORS['Emerging concern'].fill,
    stroke: DCM_COLORS['Emerging concern'].border,
    text: DCM_COLORS['Emerging concern'].text
  },
  O: {
    code: 'O',
    name: 'Constrained',
    hex: DCM_COLORS['Constrained'].fill,
    stroke: DCM_COLORS['Constrained'].border,
    text: DCM_COLORS['Constrained'].text
  },
  R: {
    code: 'R',
    name: 'Severely constrained',
    hex: DCM_COLORS['Severely constrained'].fill,
    stroke: DCM_COLORS['Severely constrained'].border,
    text: DCM_COLORS['Severely constrained'].text
  },
  X: {
    code: 'X',
    name: 'Insufficient evidence',
    hex: DCM_COLORS['Insufficient evidence'].fill,
    stroke: DCM_COLORS['Insufficient evidence'].border,
    text: DCM_COLORS['Insufficient evidence'].text
  },
  U: {
    code: 'U',
    name: 'Data unavailable',
    hex: '#e2e8f0',
    stroke: '#94a3b8',
    text: '#475569',
    isUnavailable: true
  }
};

export const DCM_DIRECTION_LABELS: Record<string, string> = {
  'newly-classified': 'Newly classified',
  'deteriorating': 'Deteriorating',
  'insufficient-basis': 'Insufficient basis',
  'improving': 'Improving',
  'stable': 'Stable',
  'unchanged': 'Unchanged'
};

export interface CanonicalJurisdictionMeta extends NigeriaJurisdiction {
  /** Label matching DCM_GEO.states[].name (uses 'FCT' for code 'FC') */
  mapName: string;
}

const JURISDICTION_BY_CODE = new Map<string, CanonicalJurisdictionMeta>();
const JURISDICTION_BY_LOOKUP = new Map<string, CanonicalJurisdictionMeta>();

for (const j of NIGERIA_37_JURISDICTIONS) {
  const mapName = j.code === 'FC' ? 'FCT' : j.name;
  const meta: CanonicalJurisdictionMeta = { ...j, mapName };
  JURISDICTION_BY_CODE.set(j.code.toUpperCase(), meta);
  JURISDICTION_BY_LOOKUP.set(j.code.toLowerCase(), meta);
  JURISDICTION_BY_LOOKUP.set(j.name.toLowerCase(), meta);
  JURISDICTION_BY_LOOKUP.set(mapName.toLowerCase(), meta);
  if (j.code === 'FC') {
    JURISDICTION_BY_LOOKUP.set('federal capital territory', meta);
    JURISDICTION_BY_LOOKUP.set('fct abuja', meta);
    JURISDICTION_BY_LOOKUP.set('abuja', meta);
  }
}

export function resolveJurisdictionMeta(stateKey: string): CanonicalJurisdictionMeta | null {
  if (!stateKey) return null;
  const trimmed = stateKey.trim();
  return (
    JURISDICTION_BY_CODE.get(trimmed.toUpperCase()) ||
    JURISDICTION_BY_LOOKUP.get(trimmed.toLowerCase()) ||
    null
  );
}

export function isValidDcmClassification(value: unknown): value is DcmClassification {
  return typeof value === 'string' && DCM_CLASSIFICATIONS.includes(value as DcmClassification);
}

/**
 * Single canonical public publication list resolver.
 * Strictly returns ONLY released (published) editions sorted chronologically ascending.
 * Falls back to published initial baseline records only when CMS provides zero published records.
 */
export function resolvePublicDcmPublications(
  cmsPublications: DcmPublication[] | null | undefined,
  fallbackPublications: DcmPublication[] = []
): DcmPublication[] {
  const cmsPublished = getPublishedDcmSorted(cmsPublications || []);
  if (cmsPublished.length > 0) {
    return cmsPublished;
  }
  return getPublishedDcmSorted(fallbackPublications);
}

export interface SelectedPublicationResolution {
  activePublication: DcmPublication | null;
  previousPublication: DcmPublication | null;
  latestPublication: DcmPublication | null;
  activeIndex: number;
  isLatest: boolean;
}

/**
 * Resolves the single canonical selected publication from the published timeline.
 * Guarantees that:
 *  - Default view (or homepage forceLatest mode) displays the latest released publication.
 *  - A manually selected historical publication ID NEVER silently switches to the latest date.
 */
export function resolveSelectedPublication(
  publishedSortedAsc: DcmPublication[],
  selectedPubId: string | null | undefined,
  forceLatest = false
): SelectedPublicationResolution {
  if (!publishedSortedAsc || publishedSortedAsc.length === 0) {
    return {
      activePublication: null,
      previousPublication: null,
      latestPublication: null,
      activeIndex: -1,
      isLatest: false
    };
  }

  const latestIndex = publishedSortedAsc.length - 1;
  const latestPublication = publishedSortedAsc[latestIndex];

  let activeIndex = latestIndex;
  if (!forceLatest && selectedPubId) {
    const matchedIdx = publishedSortedAsc.findIndex((p) => p.id === selectedPubId);
    if (matchedIdx >= 0) {
      activeIndex = matchedIdx;
    }
  }

  return {
    activePublication: publishedSortedAsc[activeIndex],
    previousPublication: activeIndex > 0 ? publishedSortedAsc[activeIndex - 1] : null,
    latestPublication,
    activeIndex,
    isLatest: activeIndex === latestIndex
  };
}

export interface CanonicalPublicationMeta {
  id: string;
  title: string;
  isDaily: boolean;
  isQuietDay: boolean;
  year: number;
  month: number; // 1-12
  periodIndex: number;
  periodLabel: string;
  publicationDateLabel: string;
  evidenceCutoffLabel: string;
  methodologyVersion: string;
  revisionNote: string;
  publishedAt?: string;
  supersedesPublicationId?: string;
  revisionNumber?: number;
  summaryParagraphs: string[];
}

export function resolvePublicationMetadata(pub: DcmPublication): CanonicalPublicationMeta {
  const daily = isDailyPublication(pub);
  const watCutoff =
    daily && pub.assessmentDate && pub.evidenceCutoffTimeWat
      ? formatWatCutoff(pub.assessmentDate, pub.evidenceCutoffTimeWat)
      : null;

  const dailyDateLabel = daily && pub.assessmentDate ? formatDailyDateLabel(pub.assessmentDate) : '';
  const periodLabel = (pub.reportingPeriodLabel || dailyDateLabel || pub.title || '').trim();
  const publicationDateLabel = (pub.publicationDate || dailyDateLabel || periodLabel).trim();
  const evidenceCutoffLabel = watCutoff?.valid
    ? watCutoff.displayLabel
    : (pub.evidenceCutoffDate || '').trim() || 'Not recorded';

  const rawSummary = (pub.summary || pub.changesSummary || '').trim();
  const summaryParagraphs = rawSummary
    ? rawSummary
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  return {
    id: pub.id,
    title: (pub.title || 'Democratic Competitiveness Map').trim(),
    isDaily: daily,
    isQuietDay: Boolean(pub.isQuietDay),
    year: Number(pub.year) || 2026,
    month: Number(pub.month) >= 1 && Number(pub.month) <= 12 ? Number(pub.month) : 1,
    periodIndex: Number(pub.periodIndex) === 1 ? 1 : 2,
    periodLabel,
    publicationDateLabel,
    evidenceCutoffLabel,
    methodologyVersion: (pub.methodologyVersion || 'Version 1.1').trim(),
    revisionNote: (pub.revisionNote || '').trim(),
    publishedAt: pub.publishedAt,
    supersedesPublicationId: pub.supersedesPublicationId,
    revisionNumber: pub.revisionNumber,
    summaryParagraphs
  };
}

export interface CanonicalStateView {
  stateCode: string;
  stateName: string;
  mapName: string;
  zone: string;
  code: DcmShortCode;
  classification: DcmClassification | 'Data unavailable';
  hex: string;
  stroke: string;
  textColor: string;
  isClassificationUnavailable: boolean;
  hasApprovedDirection: boolean;
  rawDirection: string;
  directionLabel: string;
  hasApprovedConfidence: boolean;
  confidenceLabel: string;
  hasApprovedFinding: boolean;
  keyFinding: string;
  classificationRationale: string;
  evidenceSummary: string;
  rightOfResponseLabel: string;
  carriedForward: boolean;
  carriedForwardFromPublicationId?: string;
  lastSubstantiveReviewDate: string;
}

export const TRANSPARENT_MISSING_CLASSIFICATION_NOTE =
  'Approved classification and public evidence are unavailable for this jurisdiction in this publication.';
export const TRANSPARENT_MISSING_EVIDENCE_NOTE =
  'No public evidence summary is recorded for this jurisdiction in this publication.';
export const TRANSPARENT_CARRIED_FORWARD_NO_NOTE =
  'No new public evidence recorded; previously approved classification carried forward.';

function findStateRecord(pub: DcmPublication, meta: CanonicalJurisdictionMeta): DcmStateRecord | null {
  if (!pub.classifications) return null;
  if (pub.classifications[meta.code]) return pub.classifications[meta.code];
  if (pub.classifications[meta.name]) return pub.classifications[meta.name];
  if (pub.classifications[meta.mapName]) return pub.classifications[meta.mapName];
  return null;
}

/**
 * Resolves a single jurisdiction's canonical display state from a publication.
 * Strictly enforces:
 *  - Missing classification -> explicit transparent 'Data unavailable' state (never coerced to 'Insufficient evidence').
 *  - Never fabricates direction ('improving', 'deteriorating', 'stable', 'newly-classified') from colour differences.
 *  - Never fabricates confidence from colour codes.
 *  - Never substitutes generic classification descriptions or hardcoded state text for missing public findings.
 */
export function resolveCanonicalStateView(
  pub: DcmPublication,
  stateKey: string
): CanonicalStateView {
  const meta = resolveJurisdictionMeta(stateKey) || {
    code: stateKey.toUpperCase().slice(0, 2),
    name: stateKey,
    mapName: stateKey,
    zone: 'Unknown'
  };

  const rec = findStateRecord(pub, meta);
  const hasValidClass = Boolean(rec && isValidDcmClassification(rec.classification));

  if (!rec || !hasValidClass) {
    const palette = DCM_CANONICAL_PALETTE.U;
    return {
      stateCode: meta.code,
      stateName: meta.name,
      mapName: meta.mapName,
      zone: meta.zone,
      code: 'U',
      classification: 'Data unavailable',
      hex: palette.hex,
      stroke: palette.stroke,
      textColor: palette.text,
      isClassificationUnavailable: true,
      hasApprovedDirection: false,
      rawDirection: '',
      directionLabel: 'Not recorded',
      hasApprovedConfidence: false,
      confidenceLabel: 'Not recorded',
      hasApprovedFinding: false,
      keyFinding: TRANSPARENT_MISSING_CLASSIFICATION_NOTE,
      classificationRationale: '',
      evidenceSummary: '',
      rightOfResponseLabel: 'Not recorded',
      carriedForward: false,
      lastSubstantiveReviewDate: ''
    };
  }

  const cls = rec.classification;
  const code = DCM_CLASSIFICATION_TO_CODE[cls];
  const palette = DCM_CANONICAL_PALETTE[code];
  const carriedForward = Boolean(rec.carriedForward);

  const rawDir = (rec.direction || '').trim();
  const hasApprovedDirection = rawDir.length > 0;
  const directionLabel = hasApprovedDirection
    ? (DCM_DIRECTION_LABELS[rawDir.toLowerCase()] || rawDir)
    : (carriedForward ? 'Carried forward (unchanged)' : 'Not specified');

  const rawConf = (rec.confidence || '').trim();
  const hasApprovedConfidence = rawConf.length > 0;
  const confidenceLabel = hasApprovedConfidence ? rawConf : 'Not specified';

  const rawFinding = (rec.keyFinding || '').trim();
  const rawRationale = (rec.classificationRationale || '').trim();
  const rawEvidence = (rec.evidenceSummary || '').trim();
  const approvedFindingText = rawFinding || rawRationale || rawEvidence;
  const hasApprovedFinding = approvedFindingText.length > 0;

  const keyFinding = hasApprovedFinding
    ? approvedFindingText
    : (carriedForward ? TRANSPARENT_CARRIED_FORWARD_NO_NOTE : TRANSPARENT_MISSING_EVIDENCE_NOTE);

  const rightOfResponseLabel = (rec.rightOfResponseStatus || '').trim() || 'Not specified';

  return {
    stateCode: meta.code,
    stateName: meta.name,
    mapName: meta.mapName,
    zone: meta.zone,
    code,
    classification: cls,
    hex: palette.hex,
    stroke: palette.stroke,
    textColor: palette.text,
    isClassificationUnavailable: false,
    hasApprovedDirection,
    rawDirection: rawDir,
    directionLabel,
    hasApprovedConfidence,
    confidenceLabel,
    hasApprovedFinding,
    keyFinding,
    classificationRationale: rawRationale,
    evidenceSummary: rawEvidence,
    rightOfResponseLabel,
    carriedForward,
    carriedForwardFromPublicationId: rec.carriedForwardFromPublicationId,
    lastSubstantiveReviewDate: (rec.lastSubstantiveReviewDate || '').trim()
  };
}

export interface CanonicalPublicationView {
  publication: DcmPublication;
  meta: CanonicalPublicationMeta;
  statesByCode: Record<string, CanonicalStateView>;
  statesByMapName: Record<string, CanonicalStateView>;
  stateList: CanonicalStateView[];
  counts: Record<DcmClassification, number>;
  unavailableCount: number;
  totalClassified: number;
}

/**
 * Projects a single canonical publication into unified structures for map, state cards,
 * state search results, legend counts, and metadata headers.
 */
export function buildCanonicalPublicationView(pub: DcmPublication): CanonicalPublicationView {
  const meta = resolvePublicationMetadata(pub);
  const statesByCode: Record<string, CanonicalStateView> = {};
  const statesByMapName: Record<string, CanonicalStateView> = {};
  const stateList: CanonicalStateView[] = [];
  const counts: Record<DcmClassification, number> = {
    'Open': 0,
    'Emerging concern': 0,
    'Constrained': 0,
    'Severely constrained': 0,
    'Insufficient evidence': 0
  };
  let unavailableCount = 0;

  for (const j of NIGERIA_37_JURISDICTIONS) {
    const view = resolveCanonicalStateView(pub, j.code);
    statesByCode[view.stateCode] = view;
    statesByMapName[view.mapName] = view;
    stateList.push(view);

    if (view.isClassificationUnavailable) {
      unavailableCount += 1;
    } else {
      counts[view.classification as DcmClassification] += 1;
    }
  }

  return {
    publication: pub,
    meta,
    statesByCode,
    statesByMapName,
    stateList,
    counts,
    unavailableCount,
    totalClassified: 37 - unavailableCount
  };
}

export interface ConsistencyAuditResult {
  consistent: boolean;
  publicationId: string;
  errors: string[];
  warnings: string[];
  stats: {
    totalJurisdictions: number;
    classifiedCount: number;
    unavailableCount: number;
    missingEvidenceCount: number;
    carriedForwardCount: number;
    changedFromSourceCount: number;
  };
}

/**
 * Runs deterministic technical consistency checks on a publication without modifying
 * any Research-approved classifications or findings.
 */
export function auditPublicationConsistency(
  pub: DcmPublication,
  sourcePub?: DcmPublication | null
): ConsistencyAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const view = buildCanonicalPublicationView(pub);
  const canonicalCodes = new Set(NIGERIA_37_JURISDICTIONS.map((j) => j.code));

  // 1. Verify all 37 jurisdictions map to valid controlled classifications
  const unavailableNames = view.stateList
    .filter((s) => s.isClassificationUnavailable)
    .map((s) => `${s.stateName} (${s.stateCode})`);
  if (unavailableNames.length > 0) {
    errors.push(
      `${unavailableNames.length} jurisdiction(s) missing a valid controlled classification: ${unavailableNames.slice(0, 5).join(', ')}${unavailableNames.length > 5 ? '...' : ''}.`
    );
  }

  // 2. Verify no stray/unknown jurisdiction codes
  const unknownCodes = Object.keys(pub.classifications || {}).filter((code) => !canonicalCodes.has(code));
  if (unknownCodes.length > 0) {
    errors.push(`Unrecognised jurisdiction code(s) found: ${unknownCodes.join(', ')}.`);
  }

  // 3. Verify 1:1 agreement across map colour, state card, search results, and legend palette
  for (const state of view.stateList) {
    const byCode = view.statesByCode[state.stateCode];
    const byMap = view.statesByMapName[state.mapName];
    const expectedPalette = DCM_CANONICAL_PALETTE[state.code];

    if (
      !byCode ||
      !byMap ||
      byCode.classification !== byMap.classification ||
      byCode.hex !== byMap.hex ||
      byCode.hex !== expectedPalette.hex ||
      byCode.classification !== expectedPalette.name
    ) {
      errors.push(
        `Component projection mismatch for ${state.stateName} (${state.stateCode}): map and state card representations diverge.`
      );
    }
  }

  // 4. Verify carry-forward and quiet-day consistency when source publication is provided
  let changedFromSourceCount = 0;
  if (sourcePub) {
    const diff = diffClassificationsAgainstSource(pub.classifications || {}, sourcePub);
    changedFromSourceCount = diff.changedCodes.length;

    if (diff.unapprovedSilentChanges.length > 0) {
      errors.push(
        `Carried-forward mismatch on state(s): ${diff.unapprovedSilentChanges.join(', ')} differ from source "${sourcePub.id}".`
      );
    }
    if (pub.isQuietDay && diff.changedCodes.length > 0) {
      errors.push(
        `Quiet-day publication "${pub.id}" contains classification changes in: ${diff.changedCodes.join(', ')}.`
      );
    }
  }

  // 5. Transparent warnings for missing public findings (never invented, never blocks historical records)
  const missingEvidenceStates = view.stateList.filter(
    (s) => !s.isClassificationUnavailable && !s.hasApprovedFinding
  );
  if (missingEvidenceStates.length > 0) {
    warnings.push(
      `${missingEvidenceStates.length} jurisdiction(s) have no explicit public evidence note; UI will display a transparent unavailable notice rather than generic text.`
    );
  }

  // 6. Daily WAT cut-off integrity
  if (isDailyPublication(pub)) {
    const wat = formatWatCutoff(pub.assessmentDate || '', pub.evidenceCutoffTimeWat || '');
    if (!wat.valid) {
      errors.push(wat.error || 'Daily publication has missing or invalid WAT evidence cut-off.');
    }
  }

  const carriedForwardCount = view.stateList.filter((s) => s.carriedForward).length;

  return {
    consistent: errors.length === 0,
    publicationId: pub.id,
    errors,
    warnings,
    stats: {
      totalJurisdictions: 37,
      classifiedCount: view.totalClassified,
      unavailableCount: view.unavailableCount,
      missingEvidenceCount: missingEvidenceStates.length,
      carriedForwardCount,
      changedFromSourceCount
    }
  };
}
