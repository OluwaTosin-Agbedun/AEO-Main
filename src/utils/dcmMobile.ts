import { DcmPublication } from '../types/dcm';
import {
  DCM_CANONICAL_PALETTE,
  resolvePublicationMetadata
} from './dcmConsistency';
import { isDailyPublication } from './dcmDaily';
import { sanitizeExternalUrl } from './dcmEvidence';

export const MAP_SELECTION_INSTRUCTION =
  'Select a state to see its classification and the evidence behind it.';

export const INSUFFICIENT_EVIDENCE_DISCLAIMER =
  'Insufficient evidence does not mean conditions are open.';

export const TRANSPARENT_MISSING_SUMMARY_MESSAGE =
  'No Research-approved update summary is currently published for this edition.';

export interface DailyUpdateBannerData {
  /** Accurate, non-misleading heading: "What changed today?" ONLY when activePub is today's published daily edition */
  heading: string;
  /** Whether activePub corresponds to today's WAT date as a published daily update */
  isTodayDailyEdition: boolean;
  /** Whether activePub is the latest published edition available */
  isLatestEdition: boolean;
  /** Human-readable assessment or reporting period label */
  dateLabel: string;
  /** Evidence cut-off label (includes WAT time when supplied) */
  evidenceCutoffLabel: string;
  /** Whether this edition is a daily update vs legacy reporting period */
  isDaily: boolean;
  /** Whether this edition is a quiet-day update (Research-supplied flag only) */
  isQuietDay: boolean;
  /** Strictly Research-approved summary paragraphs (never fabricated) */
  summaryParagraphs: string[];
  /** True when at least one approved summary paragraph exists */
  hasApprovedSummary: boolean;
  /** Transparent fallback notice when no approved summary is present */
  unavailableMessage: string;
  /** Validated external URL to the complete published record, when supplied */
  completeRecordUrl: string | null;
}

export interface UnifiedPublicationOption {
  id: string;
  label: string;
  isDaily: boolean;
  isLatest: boolean;
  evidenceCutoffLabel: string;
}

export interface DcmLegendDefinitionItem {
  code: 'G' | 'A' | 'O' | 'R' | 'X';
  colourName: string;
  classification: string;
  hex: string;
  definition: string;
}

/**
 * Canonical five DCM classifications preserving exact palette hex values and AEO definitions.
 * Contains no scores, rankings, or additional substantive classifications.
 */
export const DCM_LEGEND_DEFINITIONS: DcmLegendDefinitionItem[] = [
  {
    code: 'G',
    colourName: 'Green',
    classification: 'Open',
    hex: DCM_CANONICAL_PALETTE.G.hex,
    definition:
      'Affirmative and sufficiently broad evidence indicates broadly equal practical political access during the reporting period, with political actors able to organise, communicate, mobilise and campaign without verified material or discriminatory restrictions. No verified pattern of material restriction remains at the cut-off date. Absence of adverse reporting or insufficient evidence is not, by itself, grounds for a Green classification.'
  },
  {
    code: 'A',
    colourName: 'Amber',
    classification: 'Emerging concern',
    hex: DCM_CANONICAL_PALETTE.A.hex,
    definition:
      'A material incident or early evidence of unequal treatment requires monitoring, but the evidence does not yet establish a sustained or substantial restrictive pattern.'
  },
  {
    code: 'O',
    colourName: 'Orange',
    classification: 'Constrained',
    hex: DCM_CANONICAL_PALETTE.O.hex,
    definition:
      'Multiple verified incidents, an identifiable pattern, or an exceptionally serious and well-documented action materially restricts political competition.'
  },
  {
    code: 'R',
    colourName: 'Red',
    classification: 'Severely constrained',
    hex: DCM_CANONICAL_PALETTE.R.hex,
    definition:
      'Serious, sustained or systemic restrictions substantially impair political competition, taking into account their severity, reach, institutional authority and consequences.'
  },
  {
    code: 'X',
    colourName: 'Grey',
    classification: 'Insufficient evidence',
    hex: DCM_CANONICAL_PALETTE.X.hex,
    definition:
      'Available evidence is inadequate to make a responsible classification. Importantly, insufficient evidence does not mean that political competition is open.'
  }
];

/**
 * Returns the current calendar date in West Africa Time (WAT, UTC+01:00) as YYYY-MM-DD.
 */
export function getTodayWatIsoDate(now: Date = new Date()): string {
  const watMs = now.getTime() + 60 * 60 * 1000;
  const watDate = new Date(watMs);
  const y = watDate.getUTCFullYear();
  const m = String(watDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(watDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolves the concise "What changed today?" / "Latest published update" section immediately below the map.
 * - Uses "What changed today?" ONLY when activePub is a published daily update dated today (WAT).
 * - Uses "Latest published update" when viewing the newest published edition from an earlier date or legacy period.
 * - Uses an accurately dated heading ("Published update — <period>") when viewing an older historical edition.
 * - Never fabricates incidents, movements, or no-change statements when no approved summary exists.
 */
export function resolveDailyUpdateBanner(
  activePub: DcmPublication | null | undefined,
  latestPub: DcmPublication | null | undefined,
  now: Date = new Date()
): DailyUpdateBannerData {
  if (!activePub || activePub.status !== 'published') {
    return {
      heading: 'Latest published update',
      isTodayDailyEdition: false,
      isLatestEdition: false,
      dateLabel: 'No published edition selected',
      evidenceCutoffLabel: 'Not recorded',
      isDaily: false,
      isQuietDay: false,
      summaryParagraphs: [],
      hasApprovedSummary: false,
      unavailableMessage: TRANSPARENT_MISSING_SUMMARY_MESSAGE,
      completeRecordUrl: null
    };
  }

  const meta = resolvePublicationMetadata(activePub);
  const daily = isDailyPublication(activePub);
  const todayWat = getTodayWatIsoDate(now);
  const isTodayDailyEdition = Boolean(daily && activePub.assessmentDate === todayWat);
  const isLatestEdition = Boolean(latestPub && latestPub.id === activePub.id);

  let heading: string;
  if (isTodayDailyEdition) {
    heading = 'What changed today?';
  } else if (isLatestEdition) {
    heading = 'Latest published update';
  } else {
    heading = `Published update — ${meta.periodLabel}`;
  }

  const urlCheck = sanitizeExternalUrl(activePub.supportingDocumentUrl);
  const completeRecordUrl = urlCheck.valid ? urlCheck.sanitizedUrl : null;

  return {
    heading,
    isTodayDailyEdition,
    isLatestEdition,
    dateLabel: meta.periodLabel,
    evidenceCutoffLabel: meta.evidenceCutoffLabel,
    isDaily: daily,
    isQuietDay: Boolean(activePub.isQuietDay),
    summaryParagraphs: meta.summaryParagraphs,
    hasApprovedSummary: meta.summaryParagraphs.length > 0,
    unavailableMessage: TRANSPARENT_MISSING_SUMMARY_MESSAGE,
    completeRecordUrl
  };
}

/**
 * Builds clean, complete, non-clipped full-width publication selector options for mobile.
 * Ordered newest-first so the latest published edition is immediately reachable, while
 * preserving stable publication IDs for both daily updates and legacy reporting periods.
 */
export function buildUnifiedPublicationOptions(
  publishedSortedAsc: DcmPublication[]
): UnifiedPublicationOption[] {
  if (!Array.isArray(publishedSortedAsc) || publishedSortedAsc.length === 0) return [];
  const latestId = publishedSortedAsc[publishedSortedAsc.length - 1]?.id;

  return [...publishedSortedAsc]
    .reverse()
    .map((pub) => {
      const meta = resolvePublicationMetadata(pub);
      const daily = isDailyPublication(pub);
      const label = daily ? `${meta.periodLabel} (Daily)` : meta.periodLabel;
      return {
        id: pub.id,
        label,
        isDaily: daily,
        isLatest: pub.id === latestId,
        evidenceCutoffLabel: meta.evidenceCutoffLabel
      };
    });
}
