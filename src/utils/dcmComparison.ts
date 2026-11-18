import { DcmPublication, DcmComparisonResult, DcmStateChange, NIGERIA_37_JURISDICTIONS } from '../types/dcm';

/**
 * Extracts a numeric chronological timestamp for a DCM publication
 */
export function getDcmChronoTimestamp(pub: Pick<DcmPublication, 'periodEnd' | 'periodStart' | 'year' | 'month' | 'periodIndex'>): number {
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
 * Sorts DCM publications chronologically ascending by reporting period end date,
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

    const latestDiff = Number(Boolean(a.isLatest)) - Number(Boolean(b.isLatest));
    if (latestDiff !== 0) return latestDiff;

    return (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0);
  });
}

/**
 * Filters to active public DCM publications (published, legacy status-less, or explicitly marked isLatest and not archived)
 * and sorts chronologically ascending.
 */
export function getPublishedDcmSorted(publications: DcmPublication[]): DcmPublication[] {
  if (!Array.isArray(publications)) return [];
  const active = publications.filter(
    (p) => p && p.status !== 'archived' && (p.status === 'published' || !p.status || Boolean(p.isLatest))
  );
  return sortDcmChronologically(active);
}

/**
 * Returns the newest active DCM publication (chronologically latest period).
 */
export function getLatestDcmPublication(publications: DcmPublication[]): DcmPublication | null {
  const sorted = getPublishedDcmSorted(publications);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/**
 * Automatically compares a DCM publication against its immediately preceding published counterpart
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
        rationale: currRecord.classificationRationale || '',
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
