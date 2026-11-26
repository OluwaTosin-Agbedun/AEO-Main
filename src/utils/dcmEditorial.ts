import {
  DcmClassification,
  DcmEditorialExportType,
  DcmEditorialHandoverRecord,
  DcmEditorialHandoverStatus,
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPublication
} from '../types/dcm';
import {
  resolveJurisdictionMeta,
  resolvePublicDcmPublications,
  resolvePublicationMetadata
} from './dcmConsistency';
import { getDcmChronoTimestamp } from './dcmComparison';
import {
  formatTimestampInWat,
  isDailyPublication
} from './dcmDaily';
import {
  ResolvedDevelopmentDisplayItem,
  ResolvedEvidenceDisplayItem,
  ResolvedIncidentDisplayItem,
  StateAssessmentPanelData,
  resolveStateAssessmentPanelData
} from './dcmEvidence';
import {
  DailyUpdateBannerData,
  resolveDailyUpdateBanner
} from './dcmMobile';
import {
  EDITORIAL_CORRECTION_NOTICE_LABEL,
  PublicationCorrectionChain,
  buildAbsoluteDcmPermalink,
  buildDcmPermalinkUrl,
  getPublicationIsoDate,
  resolvePublicationCorrectionChain
} from './dcmArchive';

export const NOT_SUPPLIED_LABEL = 'Not supplied in the approved record';

export const EDITORIAL_HANDOVER_GOVERNANCE_NOTICE =
  'Editorial handover record — relies on existing Research approval reference; does not constitute new Research approval.';

export const DEFAULT_DCM_CANONICAL_ORIGIN = 'https://aeo.athenacentre.org';

export const DAILY_ARCHIVE_INITIAL_WINDOW = 60;

export interface RequiredCompositeIndexSpec {
  collectionGroup: string;
  fields: { fieldPath: string; order: 'ASCENDING' | 'DESCENDING' }[];
  purpose: string;
}

/**
 * Authoritative list of Firestore composite indexes required in Staging and Production
 * so bounded chronological queries always return the newest published records first.
 * Mirrors /firestore.indexes.json (kept local and NOT auto-deployed).
 */
export const REQUIRED_STAGE_6_COMPOSITE_INDEXES: RequiredCompositeIndexSpec[] = [
  {
    collectionGroup: 'dcm_daily_publications',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'assessmentDate', order: 'DESCENDING' }
    ],
    purpose: 'Public bounded daily archive listener (latest 60 published daily editions in chronological descending order) and cursor pagination'
  },
  {
    collectionGroup: 'dcm_daily_publications',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'year', order: 'ASCENDING' },
      { fieldPath: 'month', order: 'ASCENDING' },
      { fieldPath: 'assessmentDate', order: 'DESCENDING' }
    ],
    purpose: 'Date-scoped on-demand month archive loader (loadDcmArchiveMonth) ordered newest-first'
  },
  {
    collectionGroup: 'dcm_evidence',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'sourcePublicationDate', order: 'DESCENDING' }
    ],
    purpose: 'Public bounded evidence listener ordered newest source publication date first'
  },
  {
    collectionGroup: 'dcm_evidence',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'stateCode', order: 'ASCENDING' },
      { fieldPath: 'sourcePublicationDate', order: 'DESCENDING' }
    ],
    purpose: 'State-scoped on-demand public evidence loader (loadDcmStateEvidence)'
  },
  {
    collectionGroup: 'dcm_incidents',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'firstReportedDate', order: 'DESCENDING' }
    ],
    purpose: 'Public bounded incident history listener ordered newest first-reported date first'
  },
  {
    collectionGroup: 'dcm_incidents',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'stateCode', order: 'ASCENDING' },
      { fieldPath: 'firstReportedDate', order: 'DESCENDING' }
    ],
    purpose: 'State-scoped on-demand public incident loader (loadDcmStateEvidence)'
  },
  {
    collectionGroup: 'dcm_incident_developments',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'developmentDate', order: 'DESCENDING' }
    ],
    purpose: 'Public bounded incident developments listener ordered newest development date first'
  },
  {
    collectionGroup: 'dcm_incident_developments',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'visibility', order: 'ASCENDING' },
      { fieldPath: 'stateCode', order: 'ASCENDING' },
      { fieldPath: 'developmentDate', order: 'DESCENDING' }
    ],
    purpose: 'State-scoped on-demand public incident developments loader (loadDcmStateEvidence)'
  },
  {
    collectionGroup: 'dcm_editorial_handovers',
    fields: [
      { fieldPath: 'publicationId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    purpose: 'Admin-only editorial handover log filtered by publicationId ordered newest-first'
  }
];

/**
 * Pure chronological window selector mirroring Firestore's hardened public query:
 *   where('status', '==', 'published'), orderBy('assessmentDate', 'desc'), limit(pageSize)
 * Guarantees that even when >60 daily publications exist in the archive,
 * the newest published editions are ALWAYS selected first (never truncated by ascending document ID).
 */
export function selectLatestDailyWindow(
  allDailyPublications: DcmPublication[],
  options?: {
    pageSize?: number;
    beforeAssessmentDate?: string;
    excludeIds?: Set<string>;
  }
): {
  items: DcmPublication[];
  hasMore: boolean;
  nextCursorDate: string | null;
  totalPublishedDailyCount: number;
} {
  const pageSize = Math.max(1, options?.pageSize ?? DAILY_ARCHIVE_INITIAL_WINDOW);
  const beforeDate = (options?.beforeAssessmentDate || '').trim();
  const excludeIds = options?.excludeIds || new Set<string>();

  const publishedDaily = (allDailyPublications || [])
    .filter((pub) => Boolean(pub && pub.id && pub.status === 'published' && isDailyPublication(pub)))
    .sort((a, b) => {
      const dateA = a.assessmentDate || getPublicationIsoDate(a);
      const dateB = b.assessmentDate || getPublicationIsoDate(b);
      const dateCmp = dateB.localeCompare(dateA);
      if (dateCmp !== 0) return dateCmp;
      const revCmp = (b.revisionNumber || 1) - (a.revisionNumber || 1);
      if (revCmp !== 0) return revCmp;
      return getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a);
    });

  const filtered = publishedDaily.filter((pub) => {
    if (excludeIds.has(pub.id)) return false;
    if (!beforeDate) return true;
    const pubDate = pub.assessmentDate || getPublicationIsoDate(pub);
    return pubDate <= beforeDate;
  });

  const items = filtered.slice(0, pageSize);
  const hasMore = filtered.length > pageSize;
  const lastItem = items[items.length - 1];
  const nextCursorDate = hasMore && lastItem ? (lastItem.assessmentDate || getPublicationIsoDate(lastItem)) : null;

  return {
    items,
    hasMore,
    nextCursorDate,
    totalPublishedDailyCount: publishedDaily.length
  };
}

/**
 * Stage 7: Deterministic document-cursor pagination mirroring Firestore's:
 *   where('status', '==', 'published'), orderBy('assessmentDate', 'desc'), startAfter(lastDocSnap), limit(pageSize)
 * Guarantees stable pagination over >120 daily publications even when multiple same-date revisions
 * (e.g. dcm-daily-2026-11-19 and dcm-daily-2026-11-19-r2) straddle a page boundary — zero skipped or duplicated docs.
 */
export function paginateDailyArchiveCursor(
  allDailyPublications: DcmPublication[],
  options?: {
    pageSize?: number;
    afterPublicationId?: string | null;
  }
): {
  items: DcmPublication[];
  hasMore: boolean;
  lastPublicationId: string | null;
  totalPublishedDailyCount: number;
} {
  const pageSize = Math.max(1, options?.pageSize ?? DAILY_ARCHIVE_INITIAL_WINDOW);
  const afterId = (options?.afterPublicationId || '').trim();

  // Mirror Firestore's deterministic ordering: assessmentDate DESC, tie-broken by document ID DESC
  const ordered = (allDailyPublications || [])
    .filter((pub) => Boolean(pub && pub.id && pub.status === 'published' && isDailyPublication(pub)))
    .sort((a, b) => {
      const dateA = a.assessmentDate || getPublicationIsoDate(a);
      const dateB = b.assessmentDate || getPublicationIsoDate(b);
      const dateCmp = dateB.localeCompare(dateA);
      if (dateCmp !== 0) return dateCmp;
      return b.id.localeCompare(a.id);
    });

  let startIndex = 0;
  if (afterId) {
    const cursorIdx = ordered.findIndex((p) => p.id === afterId);
    startIndex = cursorIdx >= 0 ? cursorIdx + 1 : ordered.length;
  }

  const items = ordered.slice(startIndex, startIndex + pageSize);
  const hasMore = startIndex + items.length < ordered.length;
  const lastPublicationId = items.length > 0 ? items[items.length - 1].id : null;

  return {
    items,
    hasMore,
    lastPublicationId,
    totalPublishedDailyCount: ordered.length
  };
}

export interface EditorialSourceReferenceItem {
  sourceName: string;
  publicationDateIso: string;
  publicationDateDisplay: string;
  url: string | null;
  documentReference: string | null;
  evidenceId?: string;
  evidenceTitle?: string;
}

export interface EditorialDisputedClaimItem {
  evidenceId: string;
  title: string;
  note: string;
  sourceName: string;
  sourceDateDisplay: string;
}

export interface EditorialInstitutionalResponseItem {
  evidenceId: string;
  evidenceTitle: string;
  respondentName: string;
  requested: boolean;
  requestedDateDisplay: string;
  received: boolean;
  responseDateDisplay: string;
  publicSummary: string;
}

export interface EditorialCorrectionMetadata {
  isCorrectedVersion: boolean;
  hasSubsequentCorrection: boolean;
  revisionNumber: number;
  supersedesPublicationId: string | null;
  latestCorrectionId: string | null;
  latestCorrectionDateLabel: string | null;
  latestCorrectionPermalink: string | null;
  originalEditionId: string | null;
  originalEditionPermalink: string | null;
  revisionNote: string;
  editorialClarityNote: string;
}

export interface CanonicalEditorialSource {
  publicationId: string;
  publicationTitle: string;
  publicationFormat: 'daily' | 'legacy-period';
  isDaily: boolean;
  isQuietDay: boolean;
  assessmentDateIso: string;
  periodLabel: string;
  publicationDateLabel: string;
  evidenceCutoffWatLabel: string;
  methodologyVersion: string;
  sourceApprovalReference: string;
  sourceApprovedByName: string | null;
  sourcePublishedAt: string | null;

  stateCode: string;
  stateName: string;
  zone: string;

  currentClassification: DcmClassification | 'Data unavailable';
  currentClassificationCode: string;
  currentClassificationColourName: string;
  currentClassificationHex: string;
  isClassificationUnavailable: boolean;

  previousClassification: DcmClassification | 'Data unavailable' | null;
  previousPeriodLabel: string | null;
  classificationChanged: boolean;
  classificationMovementSummary: string;

  /** Strictly from Research-approved state record; null when absent */
  approvedKeyFinding: string | null;
  approvedEvidenceSummary: string | null;
  approvedChangeOrRetentionReason: string | null;
  /** Strictly from optional Research-supplied state field; NEVER fabricated */
  practicalCompetitivenessEffect: string | null;
  /** Strictly from Research-approved publication summary; empty array when absent */
  publicationSummaryParagraphs: string[];

  /** Optional selected approved incident (only from public published incidents for this state & edition) */
  selectedIncident: ResolvedIncidentDisplayItem | null;
  allStateIncidents: ResolvedIncidentDisplayItem[];

  /** Strictly approved public supporting evidence for this exact edition snapshot */
  supportingEvidence: ResolvedEvidenceDisplayItem[];
  /** Strictly approved disputed claim items */
  disputedClaims: EditorialDisputedClaimItem[];
  /** Strictly approved institutional response details */
  rightOfResponseStatusLabel: string;
  hasInstitutionalResponseData: boolean;
  institutionalResponses: EditorialInstitutionalResponseItem[];
  /** Strictly approved developments marked as remedy / follow-up by Research */
  remedyOrSubsequentDevelopments: (ResolvedDevelopmentDisplayItem & { incidentTitle: string })[];
  /** Consolidated, deduplicated dated source references */
  sourceReferences: EditorialSourceReferenceItem[];

  /** Exact permanent URLs anchored to state + date + publicationId */
  permanentStateRelativeUrl: string;
  permanentStateAbsoluteUrl: string;
  permanentEditionAbsoluteUrl: string;

  /** Website daily summary parity data from Stage 4 resolver */
  dailyBanner: DailyUpdateBannerData;
  /** Correction & revision lineage from Stage 5 resolver */
  correction: EditorialCorrectionMetadata;
  /** Underlying Stage 3 panel data (for parity checks) */
  panelData: StateAssessmentPanelData;
}

export type CanonicalEditorialSourceResult =
  | { ok: true; source: CanonicalEditorialSource }
  | { ok: false; error: string };

/**
 * Resolves a single canonical, strictly read-only editorial source directly from
 * a published, Research-approved DCM publication and its associated public evidence/incidents.
 *
 * Guarantees identical publicationId, assessment date, classification, rationale,
 * evidence records, institutional responses, and correction lineage across:
 *   - Website ("What changed today?" / "Latest published update")
 *   - Newsletter ("Democratic Competitiveness Watch")
 *   - ClearPath ("On the Map")
 */
export function buildCanonicalEditorialSource(params: {
  selectedPublication: DcmPublication | null | undefined;
  allPublications: DcmPublication[];
  stateIdentifier: string;
  evidenceRecords: DcmEvidenceRecord[];
  incidentRecords: DcmIncidentRecord[];
  developmentRecords: DcmIncidentDevelopment[];
  selectedIncidentId?: string | null;
  origin?: string;
  now?: Date;
}): CanonicalEditorialSourceResult {
  const {
    selectedPublication,
    allPublications,
    stateIdentifier,
    evidenceRecords,
    incidentRecords,
    developmentRecords,
    selectedIncidentId,
    origin = DEFAULT_DCM_CANONICAL_ORIGIN,
    now = new Date()
  } = params;

  if (!selectedPublication || !selectedPublication.id) {
    return {
      ok: false,
      error: 'Select a published DCM edition before generating editorial extracts.'
    };
  }

  if (selectedPublication.status !== 'published') {
    return {
      ok: false,
      error: `Edition "${selectedPublication.id}" has status "${selectedPublication.status}". Only published, Research-approved DCM editions may be exported for editorial handover.`
    };
  }

  const jurisdiction = resolveJurisdictionMeta(stateIdentifier);
  if (!jurisdiction) {
    return {
      ok: false,
      error: `Invalid state identifier "${stateIdentifier}". Select one of Nigeria's 36 states or the FCT.`
    };
  }

  // Strictly published canonical corpus (drafts/scheduled/unapproved excluded automatically)
  const publicSortedAsc = resolvePublicDcmPublications([
    ...allPublications,
    selectedPublication
  ]);
  const selectedIndex = publicSortedAsc.findIndex((p) => p.id === selectedPublication.id);
  const canonicalSelectedPub = selectedIndex >= 0 ? publicSortedAsc[selectedIndex] : selectedPublication;
  const previousPub = selectedIndex > 0 ? publicSortedAsc[selectedIndex - 1] : null;
  const latestPub = publicSortedAsc.length > 0 ? publicSortedAsc[publicSortedAsc.length - 1] : canonicalSelectedPub;

  const meta = resolvePublicationMetadata(canonicalSelectedPub);
  const assessmentDateIso = getPublicationIsoDate(canonicalSelectedPub);

  const panelData = resolveStateAssessmentPanelData({
    selectedPub: canonicalSelectedPub,
    previousPub,
    allPublishedSortedAsc: publicSortedAsc,
    stateKey: jurisdiction.code,
    evidenceRecords,
    incidentRecords,
    developmentRecords
  });

  if (!panelData) {
    return {
      ok: false,
      error: `Unable to resolve approved state record for ${jurisdiction.name} in edition ${canonicalSelectedPub.id}.`
    };
  }

  const dailyBanner = resolveDailyUpdateBanner(canonicalSelectedPub, latestPub, now);
  const correctionChain: PublicationCorrectionChain = resolvePublicationCorrectionChain(
    publicSortedAsc,
    canonicalSelectedPub
  );

  // Raw state record strictly for reading optional Research-supplied fields (never modifying)
  const rawStateRecord =
    canonicalSelectedPub.classifications?.[jurisdiction.code] ||
    Object.values(canonicalSelectedPub.classifications || {}).find(
      (r) => r.stateCode?.toUpperCase() === jurisdiction.code
    );

  const practicalCompetitivenessEffect =
    (rawStateRecord?.practicalCompetitivenessEffect || '').trim() || null;

  const selectedIncident = selectedIncidentId
    ? panelData.incidents.find((inc) => inc.id === selectedIncidentId) || null
    : null;

  // Scope supporting evidence to the selected incident if one was explicitly chosen,
  // while still falling back to all edition-scoped public evidence for the state when none selected.
  const scopedEvidence = selectedIncident
    ? panelData.supportingEvidence.filter(
        (ev) =>
          !ev.incidentId ||
          ev.incidentId === selectedIncident.id ||
          ev.incidentId === selectedIncident.supersedesIncidentId ||
          ev.incidentId.replace(/-r\d+$/, '') === selectedIncident.id.replace(/-r\d+$/, '')
      )
    : panelData.supportingEvidence;

  // Collect disputed claims strictly from explicitly flagged approved public evidence
  const disputedClaims: EditorialDisputedClaimItem[] = scopedEvidence
    .filter((ev) => ev.isDisputed)
    .map((ev) => ({
      evidenceId: ev.id,
      title: ev.title,
      note: ev.disputedClaimNote || ev.publicDescription,
      sourceName: ev.sourceName,
      sourceDateDisplay: ev.sourceDateDisplay || ev.sourcePublicationDate
    }));

  // Collect verified remedies / subsequent developments marked explicitly by Research
  const candidateIncidents = selectedIncident ? [selectedIncident] : panelData.incidents;
  const remedyOrSubsequentDevelopments: (ResolvedDevelopmentDisplayItem & { incidentTitle: string })[] = [];
  for (const inc of candidateIncidents) {
    for (const dev of inc.developments) {
      if (dev.isRemedyOrFollowUp) {
        remedyOrSubsequentDevelopments.push({
          ...dev,
          incidentTitle: inc.title
        });
      }
    }
  }

  // Deduplicated dated source references from approved public evidence & incident developments
  const sourceRefMap = new Map<string, EditorialSourceReferenceItem>();
  for (const ev of scopedEvidence) {
    const key = `${ev.sourceName.toLowerCase()}|${ev.sourcePublicationDate}|${ev.safeSourceUrl || ev.documentReference || ''}`;
    if (!sourceRefMap.has(key)) {
      sourceRefMap.set(key, {
        sourceName: ev.sourceName,
        publicationDateIso: ev.sourcePublicationDate,
        publicationDateDisplay: ev.sourceDateDisplay || ev.sourcePublicationDate,
        url: ev.safeSourceUrl,
        documentReference: ev.documentReference || null,
        evidenceId: ev.id,
        evidenceTitle: ev.title
      });
    }
  }
  for (const inc of candidateIncidents) {
    for (const dev of inc.developments) {
      for (const ref of dev.sourceReferences) {
        const key = `${ref.sourceName.toLowerCase()}|${ref.publicationDate}|${ref.safeUrl || ref.documentReference || ''}`;
        if (!sourceRefMap.has(key)) {
          sourceRefMap.set(key, {
            sourceName: ref.sourceName,
            publicationDateIso: ref.publicationDate,
            publicationDateDisplay: ref.dateDisplay || ref.publicationDate,
            url: ref.safeUrl,
            documentReference: ref.documentReference || null,
            evidenceTitle: dev.title
          });
        }
      }
    }
  }
  const sourceReferences = Array.from(sourceRefMap.values()).sort((a, b) =>
    (b.publicationDateIso || '').localeCompare(a.publicationDateIso || '')
  );

  // Determine exact movement summary without editorialising
  let classificationMovementSummary: string;
  if (canonicalSelectedPub.isQuietDay) {
    classificationMovementSummary =
      'Unchanged (Quiet-day update — prior approved classification carried forward without change)';
  } else if (!panelData.previousView) {
    classificationMovementSummary = 'First published classification in the available published series';
  } else if (panelData.classificationChangedFromPrevious) {
    classificationMovementSummary = `Changed from ${panelData.previousView.classification} to ${panelData.currentView.classification}`;
  } else {
    classificationMovementSummary = `Unchanged (remained ${panelData.currentView.classification})`;
  }

  const permanentStateRelativeUrl = buildDcmPermalinkUrl({
    stateName: jurisdiction.name,
    publication: canonicalSelectedPub
  });
  const permanentStateAbsoluteUrl = buildAbsoluteDcmPermalink({
    stateName: jurisdiction.name,
    publication: canonicalSelectedPub,
    origin
  });
  const permanentEditionAbsoluteUrl = buildAbsoluteDcmPermalink({
    publication: canonicalSelectedPub,
    origin
  });

  const latestCorrectionPermalink = correctionChain.latestCorrection
    ? buildAbsoluteDcmPermalink({
        stateName: jurisdiction.name,
        publication: correctionChain.latestCorrection,
        origin
      })
    : null;

  const originalEditionPermalink = correctionChain.originalEdition
    ? buildAbsoluteDcmPermalink({
        stateName: jurisdiction.name,
        publication: correctionChain.originalEdition,
        origin
      })
    : null;

  const sourceApprovalReference =
    (canonicalSelectedPub.approvalRecord?.approvalReference || '').trim() ||
    'Legacy published edition (pre-Stage 1 approval reference)';

  const institutionalResponses: EditorialInstitutionalResponseItem[] =
    panelData.institutionalResponse.responses.filter((r) =>
      !selectedIncident || scopedEvidence.some((ev) => ev.id === r.evidenceId)
    );

  const colourNameByCode: Record<string, string> = {
    G: 'Green',
    A: 'Amber',
    O: 'Orange',
    R: 'Red',
    X: 'Grey',
    U: 'Unavailable'
  };
  const currentColourName = colourNameByCode[panelData.currentView.code] || 'Grey';

  return {
    ok: true,
    source: {
      publicationId: canonicalSelectedPub.id,
      publicationTitle: canonicalSelectedPub.title,
      publicationFormat: meta.isDaily ? 'daily' : 'legacy-period',
      isDaily: meta.isDaily,
      isQuietDay: Boolean(canonicalSelectedPub.isQuietDay),
      assessmentDateIso,
      periodLabel: meta.periodLabel,
      publicationDateLabel: meta.publicationDateLabel,
      evidenceCutoffWatLabel: meta.evidenceCutoffLabel,
      methodologyVersion: meta.methodologyVersion,
      sourceApprovalReference,
      sourceApprovedByName: canonicalSelectedPub.approvalRecord?.approvedByName?.trim() || null,
      sourcePublishedAt: canonicalSelectedPub.publishedAt || null,

      stateCode: jurisdiction.code,
      stateName: jurisdiction.name,
      zone: jurisdiction.zone,

      currentClassification: panelData.currentView.classification,
      currentClassificationCode: panelData.currentView.code,
      currentClassificationColourName: currentColourName,
      currentClassificationHex: panelData.currentView.hex,
      isClassificationUnavailable: panelData.currentView.isClassificationUnavailable,

      previousClassification: panelData.previousView?.classification || null,
      previousPeriodLabel: panelData.previousPeriodLabel,
      classificationChanged: panelData.classificationChangedFromPrevious,
      classificationMovementSummary,

      approvedKeyFinding: panelData.currentView.hasApprovedFinding ? panelData.currentView.keyFinding : null,
      approvedEvidenceSummary: panelData.currentView.evidenceSummary || null,
      approvedChangeOrRetentionReason: panelData.hasApprovedChangeOrRetentionReason
        ? panelData.approvedChangeOrRetentionReason
        : null,
      practicalCompetitivenessEffect,
      publicationSummaryParagraphs: meta.summaryParagraphs,

      selectedIncident,
      allStateIncidents: panelData.incidents,

      supportingEvidence: scopedEvidence,
      disputedClaims,
      rightOfResponseStatusLabel: panelData.institutionalResponse.rightOfResponseStatusLabel,
      hasInstitutionalResponseData:
        institutionalResponses.length > 0 || panelData.institutionalResponse.hasAnyResponseData,
      institutionalResponses,
      remedyOrSubsequentDevelopments,
      sourceReferences,

      permanentStateRelativeUrl,
      permanentStateAbsoluteUrl,
      permanentEditionAbsoluteUrl,

      dailyBanner,
      correction: {
        isCorrectedVersion: correctionChain.isCorrectedVersion,
        hasSubsequentCorrection: correctionChain.hasSubsequentCorrection,
        revisionNumber: correctionChain.revisionNumber,
        supersedesPublicationId: canonicalSelectedPub.supersedesPublicationId || null,
        latestCorrectionId: correctionChain.latestCorrection?.id || null,
        latestCorrectionDateLabel: correctionChain.correctionDateLabel,
        latestCorrectionPermalink,
        originalEditionId: correctionChain.originalEdition?.id || null,
        originalEditionPermalink,
        revisionNote: correctionChain.revisionNote,
        editorialClarityNote: EDITORIAL_CORRECTION_NOTICE_LABEL
      },
      panelData
    }
  };
}

// ============================================================================
// HTML & TEXT FORMATTING HELPERS
// ============================================================================

export function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSourceReferenceText(ref: EditorialSourceReferenceItem): string {
  const parts = [`${ref.sourceName} (${ref.publicationDateDisplay || ref.publicationDateIso})`];
  if (ref.documentReference) parts.push(`Ref: ${ref.documentReference}`);
  if (ref.url) parts.push(ref.url);
  return parts.join(' — ');
}

function formatInstitutionalResponseText(source: CanonicalEditorialSource): string {
  if (!source.hasInstitutionalResponseData) {
    return NOT_SUPPLIED_LABEL;
  }
  const lines: string[] = [];
  if (
    source.rightOfResponseStatusLabel &&
    source.rightOfResponseStatusLabel !== 'Not specified' &&
    source.rightOfResponseStatusLabel !== 'Not recorded'
  ) {
    lines.push(`Right of response status: ${source.rightOfResponseStatusLabel}`);
  }
  for (const resp of source.institutionalResponses) {
    const reqPart = resp.requested
      ? `Requested${resp.requestedDateDisplay ? ` (${resp.requestedDateDisplay})` : ''}`
      : 'Not requested';
    const recPart = resp.received
      ? `Response received${resp.responseDateDisplay ? ` (${resp.responseDateDisplay})` : ''}`
      : 'No response recorded';
    const respondent = resp.respondentName ? `${resp.respondentName}: ` : '';
    const summaryPart = resp.publicSummary ? ` — ${resp.publicSummary}` : '';
    lines.push(`${respondent}${reqPart}; ${recPart}${summaryPart}`);
  }
  return lines.length > 0 ? lines.join('\n') : NOT_SUPPLIED_LABEL;
}

function formatCorrectionNoticeLines(correction: EditorialCorrectionMetadata): string[] {
  const lines: string[] = [];
  if (correction.isCorrectedVersion) {
    lines.push(
      `Correction revision (Revision ${correction.revisionNumber}): ${correction.editorialClarityNote}`
    );
    if (correction.supersedesPublicationId) {
      lines.push(`Supersedes published edition: ${correction.supersedesPublicationId}`);
    }
    if (correction.originalEditionPermalink) {
      lines.push(`Original published record: ${correction.originalEditionPermalink}`);
    }
    if (correction.revisionNote) {
      lines.push(`Research revision note: ${correction.revisionNote}`);
    }
  }
  if (correction.hasSubsequentCorrection && correction.latestCorrectionId) {
    lines.push(
      `Superseded notice: This historical edition was later superseded by corrected edition ${correction.latestCorrectionId}${
        correction.latestCorrectionDateLabel ? ` (${correction.latestCorrectionDateLabel})` : ''
      }. ${correction.editorialClarityNote}`
    );
    if (correction.latestCorrectionPermalink) {
      lines.push(`Latest corrected record: ${correction.latestCorrectionPermalink}`);
    }
  }
  return lines;
}

// ============================================================================
// 1. WEBSITE DAILY SUMMARY EXTRACT ("What changed today?" parity)
// ============================================================================

export interface WebsiteDailySummaryExtract {
  exportType: 'website-summary';
  templateName: string;
  structured: {
    heading: string;
    publicationId: string;
    assessmentDateIso: string;
    publicationDateLabel: string;
    evidenceCutoffWatLabel: string;
    isDaily: boolean;
    isQuietDay: boolean;
    sourceApprovalReference: string;
    summaryParagraphs: string[];
    hasApprovedSummary: boolean;
    selectedState: {
      stateCode: string;
      stateName: string;
      classification: DcmClassification | 'Data unavailable';
      classificationCode: string;
      colourName: string;
      hex: string;
      previousClassification: DcmClassification | 'Data unavailable' | null;
      classificationChanged: boolean;
      approvedRationale: string;
    };
    permanentEditionUrl: string;
    permanentStateUrl: string;
    correctionNotice: string[];
  };
  plainText: string;
  html: string;
  jsonString: string;
}

export function generateWebsiteDailySummaryExtract(
  source: CanonicalEditorialSource
): WebsiteDailySummaryExtract {
  const correctionLines = formatCorrectionNoticeLines(source.correction);
  const summaryText =
    source.publicationSummaryParagraphs.length > 0
      ? source.publicationSummaryParagraphs.join('\n\n')
      : NOT_SUPPLIED_LABEL;

  const structured: WebsiteDailySummaryExtract['structured'] = {
    heading: source.dailyBanner.heading,
    publicationId: source.publicationId,
    assessmentDateIso: source.assessmentDateIso,
    publicationDateLabel: source.publicationDateLabel,
    evidenceCutoffWatLabel: source.evidenceCutoffWatLabel,
    isDaily: source.isDaily,
    isQuietDay: source.isQuietDay,
    sourceApprovalReference: source.sourceApprovalReference,
    summaryParagraphs: source.publicationSummaryParagraphs,
    hasApprovedSummary: source.publicationSummaryParagraphs.length > 0,
    selectedState: {
      stateCode: source.stateCode,
      stateName: source.stateName,
      classification: source.currentClassification,
      classificationCode: source.currentClassificationCode,
      colourName: source.currentClassificationColourName,
      hex: source.currentClassificationHex,
      previousClassification: source.previousClassification,
      classificationChanged: source.classificationChanged,
      approvedRationale: source.approvedChangeOrRetentionReason || NOT_SUPPLIED_LABEL
    },
    permanentEditionUrl: source.permanentEditionAbsoluteUrl,
    permanentStateUrl: source.permanentStateAbsoluteUrl,
    correctionNotice: correctionLines
  };

  const plainLines: string[] = [
    `AEO DEMOCRATIC COMPETITIVENESS MAP — WEBSITE DAILY SUMMARY`,
    `Section Heading: ${structured.heading}`,
    `Publication ID: ${source.publicationId}`,
    `Assessment Date: ${source.periodLabel} (${source.assessmentDateIso})`,
    `Research Approval Reference: ${source.sourceApprovalReference}`,
    ...(source.isQuietDay ? ['Edition Type: Quiet-day update (all prior approved classifications retained without change)'] : []),
    '',
    'Approved Publication Summary:',
    summaryText,
    '',
    `Selected State Snapshot: ${source.stateName} (${source.stateCode})`,
    `Approved Classification: ${source.currentClassification} (${source.currentClassificationColourName} / ${source.currentClassificationCode})`,
    `Previous Classification: ${source.previousClassification || NOT_SUPPLIED_LABEL}`,
    `Classification Status: ${source.classificationMovementSummary}`,
    `Approved Rationale: ${structured.selectedState.approvedRationale}`,
    '',
    `Permanent State Record URL: ${source.permanentStateAbsoluteUrl}`,
    `Permanent Edition URL: ${source.permanentEditionAbsoluteUrl}`
  ];

  if (correctionLines.length > 0) {
    plainLines.push('', 'Correction Notice:', ...correctionLines);
  }

  const html = [
    `<article data-aeo-export="website-summary" data-publication-id="${escapeHtml(source.publicationId)}" data-state-code="${escapeHtml(source.stateCode)}">`,
    `  <h2>${escapeHtml(structured.heading)}</h2>`,
    `  <p><strong>Assessment Date:</strong> ${escapeHtml(source.periodLabel)} (${escapeHtml(source.assessmentDateIso)})<br />`,
    `  <strong>Publication ID:</strong> <code>${escapeHtml(source.publicationId)}</code> · <strong>Research Approval Ref:</strong> <code>${escapeHtml(source.sourceApprovalReference)}</code></p>`,
    ...(source.publicationSummaryParagraphs.length > 0
      ? source.publicationSummaryParagraphs.map((p) => `  <p>${escapeHtml(p)}</p>`)
      : [`  <p>${escapeHtml(NOT_SUPPLIED_LABEL)}</p>`]),
    `  <h3>Selected State: ${escapeHtml(source.stateName)} (${escapeHtml(source.stateCode)})</h3>`,
    `  <ul>`,
    `    <li><strong>Approved Classification:</strong> ${escapeHtml(source.currentClassification)} (${escapeHtml(source.currentClassificationColourName)}, ${escapeHtml(source.currentClassificationCode)})</li>`,
    `    <li><strong>Previous Classification:</strong> ${escapeHtml(source.previousClassification || NOT_SUPPLIED_LABEL)}</li>`,
    `    <li><strong>Movement Status:</strong> ${escapeHtml(source.classificationMovementSummary)}</li>`,
    `    <li><strong>Approved Rationale:</strong> ${escapeHtml(structured.selectedState.approvedRationale)}</li>`,
    `  </ul>`,
    ...(correctionLines.length > 0
      ? [
          `  <aside data-correction-notice="true">`,
          ...correctionLines.map((l) => `    <p>${escapeHtml(l)}</p>`),
          `  </aside>`
        ]
      : []),
    `  <p><strong>Permanent State Assessment URL:</strong> <a href="${escapeHtml(source.permanentStateAbsoluteUrl)}">${escapeHtml(source.permanentStateAbsoluteUrl)}</a></p>`,
    `</article>`
  ].join('\n');

  return {
    exportType: 'website-summary',
    templateName: 'Website Daily Summary',
    structured,
    plainText: plainLines.join('\n'),
    html,
    jsonString: JSON.stringify(structured, null, 2)
  };
}

// ============================================================================
// 2. NEWSLETTER OUTPUT — "Democratic Competitiveness Watch"
// ============================================================================

export interface NewsletterDcwExtract {
  exportType: 'newsletter-dcw';
  templateName: 'Democratic Competitiveness Watch';
  structured: {
    template: 'Democratic Competitiveness Watch';
    publicationId: string;
    publicationDate: string;
    assessmentDateIso: string;
    watEvidenceCutoff: string;
    selectedState: string;
    selectedStateCode: string;
    selectedIncidentId: string | null;
    currentClassification: DcmClassification | 'Data unavailable';
    currentClassificationCode: string;
    currentClassificationColour: string;
    currentClassificationHex: string;
    previousClassification: string;
    previousPeriodLabel: string | null;
    classificationChangeStatus: string;
    classificationChanged: boolean;
    isQuietDay: boolean;
    approvedDevelopmentSummary: string;
    practicalEffectOnPoliticalCompetitiveness: string;
    approvedRationale: string;
    permanentStateAssessmentUrl: string;
    datedSourceReferences: EditorialSourceReferenceItem[];
    sourceApprovalReference: string;
    correctionNotice: string[];
  };
  plainText: string;
  html: string;
  jsonString: string;
}

function resolveApprovedDevelopmentSummary(source: CanonicalEditorialSource): string {
  if (source.selectedIncident) {
    const devHighlights = source.selectedIncident.developments.map(
      (d) => `[${d.developmentDateDisplay || d.developmentDate}] ${d.title}: ${d.approvedDescription}`
    );
    return [source.selectedIncident.summary, ...devHighlights].filter(Boolean).join('\n');
  }
  if (source.approvedKeyFinding) {
    return source.approvedKeyFinding;
  }
  if (source.approvedEvidenceSummary) {
    return source.approvedEvidenceSummary;
  }
  if (source.isQuietDay && source.publicationSummaryParagraphs.length > 0) {
    return source.publicationSummaryParagraphs.join('\n\n');
  }
  return NOT_SUPPLIED_LABEL;
}

export function generateNewsletterDcwExtract(
  source: CanonicalEditorialSource
): NewsletterDcwExtract {
  const correctionLines = formatCorrectionNoticeLines(source.correction);
  const approvedDevelopmentSummary = resolveApprovedDevelopmentSummary(source);
  const practicalEffect = source.practicalCompetitivenessEffect || NOT_SUPPLIED_LABEL;
  const approvedRationale = source.approvedChangeOrRetentionReason || NOT_SUPPLIED_LABEL;
  const previousClassification = source.previousClassification || NOT_SUPPLIED_LABEL;

  const structured: NewsletterDcwExtract['structured'] = {
    template: 'Democratic Competitiveness Watch',
    publicationId: source.publicationId,
    publicationDate: source.publicationDateLabel,
    assessmentDateIso: source.assessmentDateIso,
    watEvidenceCutoff: source.evidenceCutoffWatLabel,
    selectedState: source.stateName,
    selectedStateCode: source.stateCode,
    selectedIncidentId: source.selectedIncident?.id || null,
    currentClassification: source.currentClassification,
    currentClassificationCode: source.currentClassificationCode,
    currentClassificationColour: source.currentClassificationColourName,
    currentClassificationHex: source.currentClassificationHex,
    previousClassification,
    previousPeriodLabel: source.previousPeriodLabel,
    classificationChangeStatus: source.classificationMovementSummary,
    classificationChanged: source.classificationChanged,
    isQuietDay: source.isQuietDay,
    approvedDevelopmentSummary,
    practicalEffectOnPoliticalCompetitiveness: practicalEffect,
    approvedRationale,
    permanentStateAssessmentUrl: source.permanentStateAbsoluteUrl,
    datedSourceReferences: source.sourceReferences,
    sourceApprovalReference: source.sourceApprovalReference,
    correctionNotice: correctionLines
  };

  const sourcesBlock =
    source.sourceReferences.length > 0
      ? source.sourceReferences.map((ref, idx) => `${idx + 1}. ${formatSourceReferenceText(ref)}`).join('\n')
      : NOT_SUPPLIED_LABEL;

  const plainLines: string[] = [
    'DEMOCRATIC COMPETITIVENESS WATCH',
    'Athena Election Observatory — Research-Approved DCM Newsletter Extract',
    '----------------------------------------------------------------------',
    `Publication Date: ${source.publicationDateLabel} (${source.assessmentDateIso})`,
    `Publication ID: ${source.publicationId}`,
    `Research Approval Reference: ${source.sourceApprovalReference}`,
    ...(source.selectedIncident ? [`Selected Incident ID: ${source.selectedIncident.id} — ${source.selectedIncident.title}`] : []),
    '',
    `Selected State: ${source.stateName} (${source.stateCode})`,
    `Current Classification: ${source.currentClassification} (${source.currentClassificationColourName} · Code ${source.currentClassificationCode} · ${source.currentClassificationHex})`,
    `Previous Classification: ${previousClassification}${source.previousPeriodLabel ? ` (${source.previousPeriodLabel})` : ''}`,
    `Classification Change Status: ${source.classificationMovementSummary}`,
    '',
    'Approved Development Summary:',
    approvedDevelopmentSummary,
    '',
    'Practical Effect on Political Competitiveness:',
    practicalEffect,
    '',
    'Approved Classification Rationale:',
    approvedRationale,
    '',
    'Dated Source References:',
    sourcesBlock,
    '',
    `Permanent State Assessment URL: ${source.permanentStateAbsoluteUrl}`
  ];

  if (correctionLines.length > 0) {
    plainLines.push('', 'Correction & Revision Notice:', ...correctionLines);
  }

  const htmlSources =
    source.sourceReferences.length > 0
      ? [
          '  <ul>',
          ...source.sourceReferences.map((ref) => {
            const label = `${ref.sourceName} (${ref.publicationDateDisplay || ref.publicationDateIso})`;
            const docPart = ref.documentReference ? ` — Ref: ${escapeHtml(ref.documentReference)}` : '';
            const linkPart = ref.url
              ? ` — <a href="${escapeHtml(ref.url)}" rel="noopener noreferrer">${escapeHtml(ref.url)}</a>`
              : '';
            return `    <li>${escapeHtml(label)}${docPart}${linkPart}</li>`;
          }),
          '  </ul>'
        ].join('\n')
      : `  <p>${escapeHtml(NOT_SUPPLIED_LABEL)}</p>`;

  const html = [
    `<section data-aeo-export="newsletter-dcw" data-publication-id="${escapeHtml(source.publicationId)}" data-state-code="${escapeHtml(source.stateCode)}">`,
    `  <h2>Democratic Competitiveness Watch — ${escapeHtml(source.stateName)}</h2>`,
    `  <p><strong>Publication Date:</strong> ${escapeHtml(source.publicationDateLabel)} (${escapeHtml(source.assessmentDateIso)})<br />`,
    `  <strong>Source Record:</strong> <code>${escapeHtml(source.publicationId)}</code> · <strong>Research Approval Ref:</strong> <code>${escapeHtml(source.sourceApprovalReference)}</code></p>`,
    `  <table>`,
    `    <tbody>`,
    `      <tr><th align="left">Selected State</th><td>${escapeHtml(source.stateName)} (${escapeHtml(source.stateCode)})</td></tr>`,
    `      <tr><th align="left">Current Classification</th><td>${escapeHtml(source.currentClassification)} (${escapeHtml(source.currentClassificationColourName)}, ${escapeHtml(source.currentClassificationCode)})</td></tr>`,
    `      <tr><th align="left">Previous Classification</th><td>${escapeHtml(previousClassification)}${source.previousPeriodLabel ? ` (${escapeHtml(source.previousPeriodLabel)})` : ''}</td></tr>`,
    `      <tr><th align="left">Change Status</th><td>${escapeHtml(source.classificationMovementSummary)}</td></tr>`,
    `    </tbody>`,
    `  </table>`,
    `  <h3>Approved Development Summary</h3>`,
    `  <p>${escapeHtml(approvedDevelopmentSummary).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Practical Effect on Political Competitiveness</h3>`,
    `  <p>${escapeHtml(practicalEffect).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Approved Classification Rationale</h3>`,
    `  <p>${escapeHtml(approvedRationale).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Dated Source References</h3>`,
    htmlSources,
    ...(correctionLines.length > 0
      ? [
          `  <aside data-correction-notice="true">`,
          `    <h3>Correction &amp; Revision Notice</h3>`,
          ...correctionLines.map((l) => `    <p>${escapeHtml(l)}</p>`),
          `  </aside>`
        ]
      : []),
    `  <p><strong>Permanent State Assessment URL:</strong> <a href="${escapeHtml(source.permanentStateAbsoluteUrl)}">${escapeHtml(source.permanentStateAbsoluteUrl)}</a></p>`,
    `</section>`
  ].join('\n');

  return {
    exportType: 'newsletter-dcw',
    templateName: 'Democratic Competitiveness Watch',
    structured,
    plainText: plainLines.join('\n'),
    html,
    jsonString: JSON.stringify(structured, null, 2)
  };
}

// ============================================================================
// 3. CLEARPATH OUTPUT — "On the Map"
// ============================================================================

export interface ClearPathOnTheMapExtract {
  exportType: 'clearpath-on-the-map';
  templateName: 'On the Map';
  structured: {
    template: 'On the Map';
    programme: 'ClearPath Electoral Matters';
    publicationId: string;
    assessmentDateIso: string;
    publicationDate: string;
    watEvidenceCutoff: string;
    sourceApprovalReference: string;
    selectedState: string;
    selectedStateCode: string;
    selectedIncidentId: string | null;
    whatHappened: string;
    whatAeoVerified: string;
    approvedClassification: {
      label: DcmClassification | 'Data unavailable';
      code: string;
      colourName: string;
      hex: string;
      previousClassification: string;
      movementStatus: string;
    };
    whyClassificationChangedOrStayedTheSame: string;
    disputedClaims: string;
    institutionalResponse: string;
    verifiedRemedyOrSubsequentDevelopment: string;
    sourceReferences: EditorialSourceReferenceItem[];
    permanentStateAssessmentUrl: string;
    correctionNotice: string[];
  };
  plainText: string;
  html: string;
  jsonString: string;
}

export function generateClearPathOnTheMapExtract(
  source: CanonicalEditorialSource
): ClearPathOnTheMapExtract {
  const correctionLines = formatCorrectionNoticeLines(source.correction);

  const whatHappened = resolveApprovedDevelopmentSummary(source);

  const whatAeoVerified =
    source.supportingEvidence.length > 0
      ? source.supportingEvidence
          .map(
            (ev, idx) =>
              `${idx + 1}. [${ev.verificationStatus}] ${ev.title} (${ev.sourceName}, ${
                ev.sourceDateDisplay || ev.sourcePublicationDate
              }): ${ev.publicDescription}`
          )
          .join('\n')
      : NOT_SUPPLIED_LABEL;

  const whyClassificationChangedOrStayedTheSame =
    source.approvedChangeOrRetentionReason ||
    (source.isQuietDay
      ? `No new qualifying evidence required a classification change on ${source.periodLabel}; prior approved classification (${source.currentClassification}) carried forward.`
      : NOT_SUPPLIED_LABEL);

  const disputedClaims =
    source.disputedClaims.length > 0
      ? source.disputedClaims
          .map(
            (d, idx) =>
              `${idx + 1}. ${d.title} (${d.sourceName}, ${d.sourceDateDisplay}): ${d.note}`
          )
          .join('\n')
      : NOT_SUPPLIED_LABEL;

  const institutionalResponse = formatInstitutionalResponseText(source);

  const verifiedRemedyOrSubsequentDevelopment =
    source.remedyOrSubsequentDevelopments.length > 0
      ? source.remedyOrSubsequentDevelopments
          .map(
            (dev, idx) =>
              `${idx + 1}. [${dev.developmentDateDisplay || dev.developmentDate}] ${dev.title} (${
                dev.researchStatusLabel
              }): ${dev.approvedDescription}`
          )
          .join('\n')
      : NOT_SUPPLIED_LABEL;

  const previousClassification = source.previousClassification || NOT_SUPPLIED_LABEL;

  const structured: ClearPathOnTheMapExtract['structured'] = {
    template: 'On the Map',
    programme: 'ClearPath Electoral Matters',
    publicationId: source.publicationId,
    assessmentDateIso: source.assessmentDateIso,
    publicationDate: source.publicationDateLabel,
    watEvidenceCutoff: source.evidenceCutoffWatLabel,
    sourceApprovalReference: source.sourceApprovalReference,
    selectedState: source.stateName,
    selectedStateCode: source.stateCode,
    selectedIncidentId: source.selectedIncident?.id || null,
    whatHappened,
    whatAeoVerified,
    approvedClassification: {
      label: source.currentClassification,
      code: source.currentClassificationCode,
      colourName: source.currentClassificationColourName,
      hex: source.currentClassificationHex,
      previousClassification,
      movementStatus: source.classificationMovementSummary
    },
    whyClassificationChangedOrStayedTheSame,
    disputedClaims,
    institutionalResponse,
    verifiedRemedyOrSubsequentDevelopment,
    sourceReferences: source.sourceReferences,
    permanentStateAssessmentUrl: source.permanentStateAbsoluteUrl,
    correctionNotice: correctionLines
  };

  const sourcesBlock =
    source.sourceReferences.length > 0
      ? source.sourceReferences.map((ref, idx) => `${idx + 1}. ${formatSourceReferenceText(ref)}`).join('\n')
      : NOT_SUPPLIED_LABEL;

  const plainLines: string[] = [
    'CLEARPATH ELECTORAL MATTERS — ON THE MAP (EDITORIAL HANDOVER TEMPLATE)',
    'Structured factual handover from Research-approved AEO DCM record (not a broadcast script or political opinion)',
    '======================================================================',
    `Publication ID: ${source.publicationId}`,
    `Assessment Date: ${source.periodLabel} (${source.assessmentDateIso})`,
    `Research Approval Reference: ${source.sourceApprovalReference}`,
    ...(source.selectedIncident ? [`Selected Incident ID: ${source.selectedIncident.id} — ${source.selectedIncident.title}`] : []),
    '',
    `1. Selected state: ${source.stateName} (${source.stateCode})`,
    '',
    '2. What happened:',
    whatHappened,
    '',
    '3. What AEO verified:',
    whatAeoVerified,
    '',
    '4. Approved classification:',
    `${source.currentClassification} (${source.currentClassificationColourName} · Code ${source.currentClassificationCode} · ${source.currentClassificationHex})`,
    `Previous classification: ${previousClassification}${source.previousPeriodLabel ? ` (${source.previousPeriodLabel})` : ''}`,
    `Movement status: ${source.classificationMovementSummary}`,
    '',
    '5. Why the classification changed or stayed the same:',
    whyClassificationChangedOrStayedTheSame,
    '',
    '6. Disputed claims:',
    disputedClaims,
    '',
    '7. Institutional response:',
    institutionalResponse,
    '',
    '8. Verified remedy or subsequent development:',
    verifiedRemedyOrSubsequentDevelopment,
    '',
    '9. Source references:',
    sourcesBlock,
    '',
    '10. Permanent state assessment URL:',
    source.permanentStateAbsoluteUrl
  ];

  if (correctionLines.length > 0) {
    plainLines.push('', '11. Correction & revision notice:', ...correctionLines);
  }

  const htmlSources =
    source.sourceReferences.length > 0
      ? [
          '  <ul>',
          ...source.sourceReferences.map((ref) => {
            const label = `${ref.sourceName} (${ref.publicationDateDisplay || ref.publicationDateIso})`;
            const docPart = ref.documentReference ? ` — Ref: ${escapeHtml(ref.documentReference)}` : '';
            const linkPart = ref.url
              ? ` — <a href="${escapeHtml(ref.url)}" rel="noopener noreferrer">${escapeHtml(ref.url)}</a>`
              : '';
            return `    <li>${escapeHtml(label)}${docPart}${linkPart}</li>`;
          }),
          '  </ul>'
        ].join('\n')
      : `  <p>${escapeHtml(NOT_SUPPLIED_LABEL)}</p>`;

  const html = [
    `<section data-aeo-export="clearpath-on-the-map" data-publication-id="${escapeHtml(source.publicationId)}" data-state-code="${escapeHtml(source.stateCode)}">`,
    `  <h2>On the Map — ${escapeHtml(source.stateName)} (${escapeHtml(source.stateCode)})</h2>`,
    `  <p><strong>Programme:</strong> ClearPath Electoral Matters · <strong>Source Record:</strong> <code>${escapeHtml(source.publicationId)}</code><br />`,
    `  <strong>Assessment Date:</strong> ${escapeHtml(source.periodLabel)} (${escapeHtml(source.assessmentDateIso)})<br />`,
    `  <strong>Research Approval Reference:</strong> <code>${escapeHtml(source.sourceApprovalReference)}</code></p>`,
    `  <h3>Selected state</h3>`,
    `  <p>${escapeHtml(source.stateName)} (${escapeHtml(source.stateCode)}) — ${escapeHtml(source.zone)}</p>`,
    `  <h3>What happened</h3>`,
    `  <p>${escapeHtml(whatHappened).replace(/\n/g, '<br />')}</p>`,
    `  <h3>What AEO verified</h3>`,
    `  <p>${escapeHtml(whatAeoVerified).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Approved classification</h3>`,
    `  <p><strong>${escapeHtml(source.currentClassification)}</strong> (${escapeHtml(source.currentClassificationColourName)}, Code ${escapeHtml(source.currentClassificationCode)}, ${escapeHtml(source.currentClassificationHex)})<br />`,
    `  Previous classification: ${escapeHtml(previousClassification)} · ${escapeHtml(source.classificationMovementSummary)}</p>`,
    `  <h3>Why the classification changed or stayed the same</h3>`,
    `  <p>${escapeHtml(whyClassificationChangedOrStayedTheSame).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Disputed claims</h3>`,
    `  <p>${escapeHtml(disputedClaims).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Institutional response</h3>`,
    `  <p>${escapeHtml(institutionalResponse).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Verified remedy or subsequent development</h3>`,
    `  <p>${escapeHtml(verifiedRemedyOrSubsequentDevelopment).replace(/\n/g, '<br />')}</p>`,
    `  <h3>Source references</h3>`,
    htmlSources,
    `  <h3>Permanent state assessment URL</h3>`,
    `  <p><a href="${escapeHtml(source.permanentStateAbsoluteUrl)}">${escapeHtml(source.permanentStateAbsoluteUrl)}</a></p>`,
    ...(correctionLines.length > 0
      ? [
          `  <aside data-correction-notice="true">`,
          `    <h3>Correction &amp; revision notice</h3>`,
          ...correctionLines.map((l) => `    <p>${escapeHtml(l)}</p>`),
          `  </aside>`
        ]
      : []),
    `</section>`
  ].join('\n');

  return {
    exportType: 'clearpath-on-the-map',
    templateName: 'On the Map',
    structured,
    plainText: plainLines.join('\n'),
    html,
    jsonString: JSON.stringify(structured, null, 2)
  };
}

// ============================================================================
// 4. EDITORIAL HANDOVER RECORD BUILDER & VALIDATION
// ============================================================================

export function buildEditorialHandoverId(
  exportType: DcmEditorialExportType,
  stateCode: string,
  assessmentDateIso: string,
  nowMs: number = Date.now()
): string {
  const shortType =
    exportType === 'newsletter-dcw'
      ? 'dcw'
      : exportType === 'clearpath-on-the-map'
      ? 'clearpath'
      : 'websum';
  const cleanDate = (assessmentDateIso || '2026-01-01').replace(/[^0-9-]/g, '').slice(0, 10);
  const cleanState = (stateCode || 'NG').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  const suffix = String(nowMs).slice(-6);
  return `ho-${shortType}-${cleanState}-${cleanDate}-${suffix}`;
}

export function buildEditorialHandoverRecord(params: {
  source: CanonicalEditorialSource;
  exportType: DcmEditorialExportType;
  exportedText: string;
  approvedPlainText: string;
  structuredExtract: unknown;
  preparedByUid: string;
  preparedByName: string;
  preparedByEmail?: string;
  handoverStatus?: DcmEditorialHandoverStatus;
  recipientTeam?: string;
  now?: Date;
}): DcmEditorialHandoverRecord {
  const {
    source,
    exportType,
    exportedText,
    approvedPlainText,
    structuredExtract,
    preparedByUid,
    preparedByName,
    preparedByEmail,
    handoverStatus = 'prepared',
    recipientTeam,
    now = new Date()
  } = params;

  const nowMs = now.getTime();
  const exportedAtIso = now.toISOString();
  const exportedAtWatLabel = formatTimestampInWat(exportedAtIso) || `${exportedAtIso} (WAT)`;
  const hasEditorialDraftEdits = exportedText.trim() !== approvedPlainText.trim();

  const snapshotObj = {
    capturedAtIso: exportedAtIso,
    capturedAtWatLabel: exportedAtWatLabel,
    exportType,
    publicationId: source.publicationId,
    assessmentDateIso: source.assessmentDateIso,
    stateCode: source.stateCode,
    stateName: source.stateName,
    incidentId: source.selectedIncident?.id || null,
    classification: source.currentClassification,
    classificationCode: source.currentClassificationCode,
    sourceApprovalReference: source.sourceApprovalReference,
    permanentRecordUrl: source.permanentStateAbsoluteUrl,
    hasEditorialDraftEdits,
    approvedExtractText: approvedPlainText,
    editorialHandoverText: exportedText,
    structuredExtract
  };

  let snapshotPayload = JSON.stringify(snapshotObj);
  if (snapshotPayload.length > 39500) {
    // Keep within Firestore rule maxLength (40000) without ever dropping canonical identifiers
    const compactSnapshot = {
      capturedAtIso: exportedAtIso,
      exportType,
      publicationId: source.publicationId,
      assessmentDateIso: source.assessmentDateIso,
      stateCode: source.stateCode,
      stateName: source.stateName,
      classification: source.currentClassification,
      sourceApprovalReference: source.sourceApprovalReference,
      permanentRecordUrl: source.permanentStateAbsoluteUrl,
      hasEditorialDraftEdits,
      editorialHandoverText: exportedText.slice(0, 32000)
    };
    snapshotPayload = JSON.stringify(compactSnapshot);
  }

  const record: DcmEditorialHandoverRecord = {
    id: buildEditorialHandoverId(exportType, source.stateCode, source.assessmentDateIso, nowMs),
    publicationId: source.publicationId,
    publicationAssessmentDate: source.assessmentDateIso,
    stateCode: source.stateCode,
    stateName: source.stateName,
    ...(source.selectedIncident?.id ? { incidentId: source.selectedIncident.id } : {}),
    exportType,
    preparedByUid: preparedByUid.trim(),
    preparedByName: preparedByName.trim(),
    ...(preparedByEmail?.trim() ? { preparedByEmail: preparedByEmail.trim() } : {}),
    exportedAtIso,
    exportedAtWatLabel,
    handoverStatus,
    ...(recipientTeam?.trim() ? { recipientTeam: recipientTeam.trim() } : {}),
    permanentRecordUrl: source.permanentStateAbsoluteUrl,
    sourceApprovalReference: source.sourceApprovalReference,
    governanceNotice: EDITORIAL_HANDOVER_GOVERNANCE_NOTICE,
    hasEditorialDraftEdits,
    snapshotPayload,
    createdAt: nowMs,
    updatedAt: nowMs,
    createdByUid: preparedByUid.trim(),
    updatedByUid: preparedByUid.trim()
  };

  return record;
}

export function validateEditorialHandoverRecord(
  record: DcmEditorialHandoverRecord,
  options: { isAuthorizedAdmin: boolean; actorUid?: string; sourcePublicationStatus?: string }
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!options.isAuthorizedAdmin || !options.actorUid) {
    errors.push('Only signed-in authorised AEO administrators may record editorial handovers.');
  }
  if (options.sourcePublicationStatus && options.sourcePublicationStatus !== 'published') {
    errors.push('Editorial handovers may only reference published, Research-approved DCM editions.');
  }
  if (!record.id || !/^[a-zA-Z0-9_-]{3,128}$/.test(record.id)) {
    errors.push('Invalid handover record ID format.');
  }
  if (!record.publicationId || record.publicationId.length < 3 || record.publicationId.length > 128) {
    errors.push('Publication ID is required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.publicationAssessmentDate || '')) {
    errors.push('Publication assessment date must use YYYY-MM-DD format.');
  }
  if (!record.stateCode || record.stateCode.length !== 2) {
    errors.push('Valid 2-letter canonical state code is required.');
  }
  if (!['website-summary', 'newsletter-dcw', 'clearpath-on-the-map'].includes(record.exportType)) {
    errors.push('Invalid editorial export type.');
  }
  if (!['prepared', 'handed-over', 'published-externally', 'archived'].includes(record.handoverStatus)) {
    errors.push('Invalid handover status.');
  }
  if (!record.preparedByName || record.preparedByName.trim().length < 2) {
    errors.push('Prepared-by staff name is required.');
  }
  if (options.actorUid && record.preparedByUid !== options.actorUid && record.createdByUid !== options.actorUid) {
    errors.push('Handover preparedByUid must match the authenticated administrator UID.');
  }
  if (!record.permanentRecordUrl || !record.permanentRecordUrl.includes('publication=')) {
    errors.push('Permanent state assessment URL including publication ID is required.');
  }
  if (!record.sourceApprovalReference || record.sourceApprovalReference.trim().length < 3) {
    errors.push('Source Research approval reference is required.');
  }
  if (!record.snapshotPayload || record.snapshotPayload.length > 40000) {
    errors.push('Immutable handover snapshot payload must be between 2 and 40,000 characters.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
