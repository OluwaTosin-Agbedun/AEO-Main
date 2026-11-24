import { DcmPublication, DcmComparisonResult, DcmStateChange, NIGERIA_37_JURISDICTIONS } from '../types/dcm';

/**
 * Extracts a numeric chronological timestamp for a DCM publication.
 * Daily publications use their WAT evidence cut-off ISO timestamp (or assessmentDate)
 * so daily updates and legacy period editions sort accurately on a single timeline.
 */
export function getDcmChronoTimestamp(
  pub: Pick<
    DcmPublication,
    'publicationFormat' | 'evidenceCutoffDateTimeWat' | 'assessmentDate' | 'periodEnd' | 'periodStart' | 'year' | 'month' | 'periodIndex'
  >
): number {
  if (pub.publicationFormat === 'daily') {
    if (pub.evidenceCutoffDateTimeWat) {
      const cutoffTs = new Date(pub.evidenceCutoffDateTimeWat).getTime();
      if (!Number.isNaN(cutoffTs)) return cutoffTs;
    }
    if (pub.assessmentDate) {
      const assessTs = new Date(`${pub.assessmentDate}T23:59:59+01:00`).getTime();
      if (!Number.isNaN(assessTs)) return assessTs;
    }
  }

  const endTs = pub.periodEnd ? new Date(pub.periodEnd).getTime() : NaN;
  if (!Number.isNaN(endTs)) return endTs;

  const startTs = pub.periodStart ? new Date(pub.periodStart).getTime() : NaN;
  if (!Number.isNaN(startTs)) return startTs;

  const year = Number(pub.year) || 0;
  const month = (Number(pub.month) || 1) - 1;
  const day = Number(pub.periodIndex) === 1 ? 15 : 28;
  return new Date(year, month, day).getTime();
}

/**
 * Sorts DCM publications chronologically ascending by reporting period end / daily cut-off timestamp,
 * with deterministic tiebreakers on periodIndex, isLatest, and updatedAt.
 */
export function sortDcmChronologically(publications: DcmPublication[]): DcmPublication[] {
  return [...publications].sort((a, b) => {
    const timeDiff = getDcmChronoTimestamp(a) - getDcmChronoTimestamp(b);
    if (timeDiff !== 0) return timeDiff;

    const yearDiff = (Number(a.year) || 0) - (Number(b.year) || 0);
    if (yearDiff !== 0) return yearDiff;

    const monthDiff = (Number(a.month) || 0) - (Number(b.month) || 0);
    if (monthDiff !== 0) return monthDiff;

    const periodDiff = (Number(a.periodIndex) || 0) - (Number(b.periodIndex) || 0);
    if (periodDiff !== 0) return periodDiff;

    const revDiff = (Number(a.revisionNumber) || 1) - (Number(b.revisionNumber) || 1);
    if (revDiff !== 0) return revDiff;

    const pubTsA = a.publishedAt ? new Date(a.publishedAt).getTime() || 0 : 0;
    const pubTsB = b.publishedAt ? new Date(b.publishedAt).getTime() || 0 : 0;
    if (pubTsA !== pubTsB) return pubTsA - pubTsB;

    const latestDiff = Number(Boolean(a.isLatest)) - Number(Boolean(b.isLatest));
    if (latestDiff !== 0) return latestDiff;

    return (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0);
  });
}

/**
 * Filters to strictly released public DCM publications and sorts chronologically ascending.
 * - Daily publications: STRICTLY requires status === 'published' (drafts and approved-but-unpublished remain private).
 * - Legacy reporting-period publications: requires status === 'published' (or legacy status-less historical records).
 *   Draft, approved-but-unpublished, scheduled, and archived records are NEVER exposed publicly, even if isLatest is set.
 */
export function getPublishedDcmSorted(publications: DcmPublication[]): DcmPublication[] {
  if (!Array.isArray(publications)) return [];
  const active = publications.filter((p) => {
    if (!p) return false;
    if (p.publicationFormat === 'daily') {
      return p.status === 'published';
    }
    return p.status === 'published' || !p.status;
  });
  return sortDcmChronologically(active);
}

/**
 * Returns the newest released public DCM publication (chronologically latest edition).
 */
export function getLatestDcmPublication(publications: DcmPublication[]): DcmPublication | null {
  const sorted = getPublishedDcmSorted(publications);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * Automatically compares a DCM publication against its immediately preceding published counterpart.
 * Reports only factual classification differences (never fabricates direction/improvement/deterioration).
 */
export function compareDcmPublications(
  currentPublication: DcmPublication,
  allPublications: DcmPublication[]
): DcmComparisonResult {
  // Compare against active public publications
  const sorted = getPublishedDcmSorted(allPublications);

  const currentIndex = sorted.findIndex(p => p.id === currentPublication.id);

  if (currentPublication.isBaseline || currentIndex <= 0) {
    // Baseline publication or not found
    return {
      hasPrevious: false,
      changedStates: [],
      totalChanged: 0,
      isBaseline: true,
      methodologyChanged: false
    };
  }

  const previousPublication = sorted[currentIndex - 1];
  const changedStates: DcmStateChange[] = [];

  for (const jurisdiction of NIGERIA_37_JURISDICTIONS) {
    const code = jurisdiction.code;
    const prevRecord = previousPublication.classifications[code];
    const currRecord = currentPublication.classifications[code];

    if (!prevRecord || !currRecord) continue;
    if (!prevRecord.classification || !currRecord.classification) continue;

    if (prevRecord.classification !== currRecord.classification) {
      let changeType: 'changed' | 'first-classification' | 'returned-to-insufficient' = 'changed';
      if (prevRecord.classification === 'Insufficient evidence') {
        changeType = 'first-classification';
      } else if (currRecord.classification === 'Insufficient evidence') {
        changeType = 'returned-to-insufficient';
      }

      changedStates.push({
        stateCode: code,
        stateName: jurisdiction.name,
        previousClassification: prevRecord.classification,
        newClassification: currRecord.classification,
        rationale: (currRecord.keyFinding || currRecord.classificationRationale || '').trim(),
        rightOfResponseStatus: currRecord.rightOfResponseStatus,
        changeType
      });
    }
  }

  return {
    hasPrevious: true,
    previousPublication,
    changedStates,
    totalChanged: changedStates.length,
    isBaseline: false,
    methodologyChanged: previousPublication.methodologyVersion !== currentPublication.methodologyVersion
  };
}

/**
 * Compiles historical classification timeline for a specific state across all published publications
 */
export function getStateHistoryAcrossPublications(
  stateCode: string,
  publications: DcmPublication[]
): Array<{
  publicationId: string;
  reportingPeriodLabel: string;
  year: number;
  month: number;
  periodIndex: number;
  periodEnd: string;
  classification: string;
  isBaseline?: boolean;
  hasExplicitClassification: boolean;
  rationale?: string;
  evidence?: string;
  response?: string;
  isCurrentActive: boolean;
}> {
  const published = getPublishedDcmSorted(publications);

  return published.map(pub => {
    const record = pub.classifications[stateCode];
    const hasExplicit = Boolean(record && record.classification);
    return {
      publicationId: pub.id,
      reportingPeriodLabel: pub.reportingPeriodLabel,
      year: pub.year,
      month: pub.month,
      periodIndex: pub.periodIndex,
      periodEnd: pub.periodEnd,
      isBaseline: pub.isBaseline,
      classification: hasExplicit ? (record!.classification) : 'Data unavailable',
      hasExplicitClassification: hasExplicit,
      rationale: record?.classificationRationale,
      evidence: record?.evidenceSummary,
      response: record?.rightOfResponseStatus,
      isCurrentActive: false
    };
  });
}
