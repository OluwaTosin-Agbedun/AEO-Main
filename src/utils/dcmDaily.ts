import {
  DcmApprovalRecord,
  DcmClassification,
  DcmPublication,
  DcmStateRecord,
  DCM_CLASSIFICATIONS,
  MONTH_NAMES,
  NIGERIA_37_JURISDICTIONS
} from '../types/dcm';

export const WAT_OFFSET = '+01:00';
export const WAT_LABEL = 'WAT (UTC+01:00)';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DOC_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;

export interface ParsedIsoDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface WatCutoffResult {
  valid: boolean;
  isoWat: string;
  displayLabel: string;
  error?: string;
}

export interface DailyValidationOptions {
  isAuthorizedAdmin: boolean;
  /** Authenticated administrator UID executing the save/publish action. Used to bind approval recorder identity. */
  actorUid?: string;
  existingDoc?: DcmPublication | null;
  sourcePub?: DcmPublication | null;
}

export interface DailyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CarryForwardDiff {
  changedCodes: string[];
  carriedForwardCount: number;
  updatedCount: number;
  unapprovedSilentChanges: string[];
}

/**
 * Checks whether a DCM publication record uses the new daily publication format.
 */
export function isDailyPublication(pub: Partial<DcmPublication> | null | undefined): boolean {
  return Boolean(pub && pub.publicationFormat === 'daily');
}

/**
 * Strictly parses an ISO calendar date string (YYYY-MM-DD) and rejects impossible dates
 * such as 2026-02-30.
 */
export function parseIsoDate(dateStr: string | undefined | null): ParsedIsoDate | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!ISO_DATE_REGEX.test(trimmed)) return null;

  const [yStr, mStr, dStr] = trimmed.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * Formats an ISO YYYY-MM-DD date into human-readable editorial format, e.g. "19 November 2026".
 */
export function formatDailyDateLabel(assessmentDate: string): string {
  const parsed = parseIsoDate(assessmentDate);
  if (!parsed) return assessmentDate || '';
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

/**
 * Formats an ISO YYYY-MM-DD date into compact label, e.g. "19 Nov 2026".
 */
export function formatDailyShortLabel(assessmentDate: string): string {
  const parsed = parseIsoDate(assessmentDate);
  if (!parsed) return assessmentDate || '';
  return `${parsed.day} ${MONTH_NAMES[parsed.month - 1].slice(0, 3)} ${parsed.year}`;
}

/**
 * Validates and formats the daily evidence cut-off date and time in West Africa Time (WAT, UTC+01:00).
 * Example output:
 *   isoWat:       "2026-11-19T17:00:00+01:00"
 *   displayLabel: "19 November 2026, 17:00 WAT (UTC+01:00)"
 */
export function formatWatCutoff(assessmentDate: string, cutoffTimeWat: string): WatCutoffResult {
  const parsedDate = parseIsoDate(assessmentDate);
  if (!parsedDate) {
    return {
      valid: false,
      isoWat: '',
      displayLabel: '',
      error: 'A valid assessment date (YYYY-MM-DD) is required.'
    };
  }

  const cleanTime = (cutoffTimeWat || '').trim();
  if (!TIME_24H_REGEX.test(cleanTime)) {
    return {
      valid: false,
      isoWat: '',
      displayLabel: '',
      error: 'Daily evidence cut-off time must be a valid 24-hour time in HH:mm format (WAT, UTC+01:00).'
    };
  }

  const yyyy = String(parsedDate.year).padStart(4, '0');
  const mm = String(parsedDate.month).padStart(2, '0');
  const dd = String(parsedDate.day).padStart(2, '0');
  const isoWat = `${yyyy}-${mm}-${dd}T${cleanTime}:00${WAT_OFFSET}`;
  const displayLabel = `${formatDailyDateLabel(assessmentDate)}, ${cleanTime} ${WAT_LABEL}`;

  return {
    valid: true,
    isoWat,
    displayLabel
  };
}

/**
 * Formats an ISO timestamp (e.g. actual publication timestamp) into WAT (UTC+01:00) display string.
 */
export function formatTimestampInWat(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) return '';
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;

  // Convert UTC epoch to WAT (UTC+01:00) deterministically regardless of browser timezone
  const watMs = date.getTime() + 60 * 60 * 1000;
  const watDate = new Date(watMs);
  const day = watDate.getUTCDate();
  const monthName = MONTH_NAMES[watDate.getUTCMonth()];
  const year = watDate.getUTCFullYear();
  const hh = String(watDate.getUTCHours()).padStart(2, '0');
  const min = String(watDate.getUTCMinutes()).padStart(2, '0');
  return `${day} ${monthName} ${year}, ${hh}:${min} ${WAT_LABEL}`;
}

/**
 * Generates a unique daily publication ID for a given assessment date.
 * Never reuses an ID already present in existingIds so published editions cannot be overwritten.
 */
export function buildDailyPublicationId(assessmentDate: string, existingIds: string[] = []): string {
  const parsed = parseIsoDate(assessmentDate);
  const datePart = parsed
    ? `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
    : new Date().toISOString().slice(0, 10);

  const baseId = `dcm-daily-${datePart}`;
  const idSet = new Set(existingIds);
  if (!idSet.has(baseId)) {
    return baseId;
  }

  let revision = 2;
  while (idSet.has(`${baseId}-r${revision}`)) {
    revision++;
  }
  return `${baseId}-r${revision}`;
}

/**
 * Creates a blank 37-jurisdiction map with all states set to Insufficient evidence.
 */
export function createBlank37Classifications(): Record<string, DcmStateRecord> {
  const result: Record<string, DcmStateRecord> = {};
  for (const j of NIGERIA_37_JURISDICTIONS) {
    result[j.code] = {
      stateCode: j.code,
      stateName: j.name,
      classification: 'Insufficient evidence',
      direction: 'insufficient-basis',
      confidence: 'Low',
      keyFinding: '',
      classificationRationale: '',
      evidenceSummary: '',
      rightOfResponseStatus: 'Not required',
      carriedForward: false
    };
  }
  return result;
}

/**
 * Carries forward all 37 previously approved state classifications from a prior publication
 * WITHOUT modifying any classification, description, confidence, or direction, and WITHOUT
 * labelling any carried-forward state as freshly reviewed.
 */
export function carryForwardClassifications(
  sourcePub: DcmPublication
): Record<string, DcmStateRecord> {
  const result: Record<string, DcmStateRecord> = {};

  for (const j of NIGERIA_37_JURISDICTIONS) {
    const prev = sourcePub.classifications?.[j.code];
    if (prev && DCM_CLASSIFICATIONS.includes(prev.classification)) {
      result[j.code] = {
        stateCode: j.code,
        stateName: j.name,
        classification: prev.classification,
        direction: prev.direction,
        confidence: prev.confidence,
        keyFinding: prev.keyFinding || '',
        classificationRationale: prev.classificationRationale || '',
        evidenceSummary: prev.evidenceSummary || '',
        rightOfResponseStatus: prev.rightOfResponseStatus || 'Not required',
        supportingSource: prev.supportingSource || '',
        internalNotes: prev.internalNotes || '',
        carriedForward: true,
        carriedForwardFromPublicationId: prev.carriedForwardFromPublicationId || sourcePub.id,
        // Preserve supplied substantive review date only; never fabricate one
        ...(prev.lastSubstantiveReviewDate ? { lastSubstantiveReviewDate: prev.lastSubstantiveReviewDate } : {})
      };
    } else {
      result[j.code] = {
        stateCode: j.code,
        stateName: j.name,
        classification: 'Insufficient evidence',
        direction: 'insufficient-basis',
        confidence: 'Low',
        keyFinding: '',
        classificationRationale: '',
        evidenceSummary: '',
        rightOfResponseStatus: 'Not required',
        carriedForward: true,
        carriedForwardFromPublicationId: sourcePub.id
      };
    }
  }

  return result;
}

/**
 * Creates a new Daily DCM Publication draft.
 * - Retains all previously approved 37-state classifications verbatim from sourcePub (a new day
 *   never automatically changes any state's classification).
 * - Leaves summary blank so the authorised administrator must enter the Research-approved summary
 *   or quiet-day statement (never auto-asserts that no incidents occurred).
 * - Sets status to 'draft' and does not pre-approve publication.
 */
export function createDailyDraft(params: {
  assessmentDate: string;
  cutoffTimeWat?: string;
  sourcePub?: DcmPublication | null;
  existingIds?: string[];
  isQuietDay?: boolean;
  createdByUid?: string;
  methodologyVersion?: string;
}): DcmPublication {
  const parsed = parseIsoDate(params.assessmentDate);
  const safeDate = parsed
    ? `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`
    : new Date().toISOString().slice(0, 10);
  const resolvedDate = parseIsoDate(safeDate)!;

  const cutoffTimeWat = params.cutoffTimeWat && TIME_24H_REGEX.test(params.cutoffTimeWat)
    ? params.cutoffTimeWat
    : '17:00';
  const watCutoff = formatWatCutoff(safeDate, cutoffTimeWat);

  const id = buildDailyPublicationId(safeDate, params.existingIds || []);
  const dateLabel = formatDailyDateLabel(safeDate);
  const now = Date.now();

  const classifications = params.sourcePub
    ? carryForwardClassifications(params.sourcePub)
    : createBlank37Classifications();

  const carriedForwardAllStates = Boolean(params.sourcePub);

  return {
    id,
    publicationFormat: 'daily',
    title: `Democratic Competitiveness Map — Daily Update: ${dateLabel}`,
    year: resolvedDate.year,
    month: resolvedDate.month,
    periodIndex: resolvedDate.day <= 15 ? 1 : 2,
    periodStart: safeDate,
    periodEnd: safeDate,
    reportingPeriodLabel: dateLabel,
    publicationDate: dateLabel,
    evidenceCutoffDate: watCutoff.displayLabel,
    assessmentDate: safeDate,
    evidenceCutoffTimeWat: cutoffTimeWat,
    evidenceCutoffDateTimeWat: watCutoff.isoWat,
    isQuietDay: Boolean(params.isQuietDay),
    carriedForwardAllStates,
    carriedForwardFromPublicationId: params.sourcePub?.id,
    methodologyVersion: params.methodologyVersion || params.sourcePub?.methodologyVersion || 'Version 1.1',
    revisionNote: '',
    status: 'draft',
    isLatest: false,
    // Intentionally empty: administrator must input the Research-approved daily summary or quiet-day statement.
    summary: '',
    changesSummary: '',
    supportingDocumentUrl: '',
    classifications,
    createdAt: now,
    updatedAt: now,
    createdByUid: params.createdByUid,
    updatedByUid: params.createdByUid
  };
}

/**
 * Compares a daily draft's 37 classifications against the source publication from which
 * classifications were carried forward.
 */
export function diffClassificationsAgainstSource(
  classifications: Record<string, DcmStateRecord>,
  sourcePub: DcmPublication | null | undefined
): CarryForwardDiff {
  const changedCodes: string[] = [];
  const unapprovedSilentChanges: string[] = [];
  let carriedForwardCount = 0;
  let updatedCount = 0;

  for (const j of NIGERIA_37_JURISDICTIONS) {
    const curr = classifications[j.code];
    const prev = sourcePub?.classifications?.[j.code];
    if (!curr) continue;

    if (curr.carriedForward) {
      carriedForwardCount++;
    } else {
      updatedCount++;
    }

    if (prev && curr.classification !== prev.classification) {
      changedCodes.push(j.code);
      if (curr.carriedForward) {
        unapprovedSilentChanges.push(j.code);
      }
    }
  }

  return {
    changedCodes,
    carriedForwardCount,
    updatedCount,
    unapprovedSilentChanges
  };
}

/**
 * Validates a daily DCM publication record prior to saving as Draft, Approved, or Published.
 * Enforces:
 *  - Authorised administrator permission
 *  - Protection of previously published editions from overwrite
 *  - Valid assessment date and WAT (UTC+01:00) cut-off timestamp
 *  - Complete 37-jurisdiction controlled classifications
 *  - Carry-forward integrity (no silent/unapproved changes)
 *  - Quiet-day integrity (no classification changes when marked quiet-day)
 *  - Recorded Research approval and non-empty approved summary before approval/release
 */
export function validateDailyPublication(
  pub: Partial<DcmPublication>,
  options: DailyValidationOptions
): DailyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Admin authorisation guard
  if (!options.isAuthorizedAdmin) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can create, edit, approve, or publish daily DCM records.');
  }

  // 2. Historical immutability guard
  if (options.existingDoc && options.existingDoc.status === 'published') {
    errors.push(
      `Historical protection: Published daily edition "${options.existingDoc.id}" is immutable and cannot be overwritten. Create a new daily edition instead.`
    );
  }

  // 3. Publication format & ID validation
  if (pub.publicationFormat !== 'daily') {
    errors.push('Publication format must be "daily" for daily DCM updates.');
  }
  if (!pub.id || !DOC_ID_REGEX.test(pub.id)) {
    errors.push('A valid unique publication ID (letters, numbers, hyphens, underscores) is required.');
  }
  if (!pub.title || !pub.title.trim()) {
    errors.push('Publication title is required.');
  }

  // 4. Assessment date and WAT cut-off validation
  const watCutoff = formatWatCutoff(pub.assessmentDate || '', pub.evidenceCutoffTimeWat || '');
  if (!watCutoff.valid) {
    errors.push(watCutoff.error || 'Valid assessment date and WAT cut-off time are required.');
  }

  // 5. Status validation
  const validStatuses = ['draft', 'approved', 'published'];
  if (!pub.status || !validStatuses.includes(pub.status)) {
    errors.push('Daily publication status must be Draft, Approved, or Published.');
  }

  // 6. All 37 jurisdictions validation (exact canonical set, no missing or unknown codes)
  const classifications = pub.classifications || {};
  const canonicalCodes = new Set(NIGERIA_37_JURISDICTIONS.map((j) => j.code));
  const missingOrInvalid: string[] = [];
  const invalidReviewDates: string[] = [];
  const unknownCodes = Object.keys(classifications).filter((code) => !canonicalCodes.has(code));

  for (const j of NIGERIA_37_JURISDICTIONS) {
    const rec = classifications[j.code];
    if (!rec || !rec.classification || !DCM_CLASSIFICATIONS.includes(rec.classification)) {
      missingOrInvalid.push(`${j.name} (${j.code})`);
    }
    if (rec?.lastSubstantiveReviewDate && !parseIsoDate(rec.lastSubstantiveReviewDate)) {
      invalidReviewDates.push(`${j.name} (${j.code})`);
    }
  }

  if (missingOrInvalid.length > 0) {
    errors.push(
      `All 37 jurisdictions must have a controlled classification. Missing/invalid: ${missingOrInvalid.slice(0, 5).join(', ')}${missingOrInvalid.length > 5 ? ` and ${missingOrInvalid.length - 5} more` : ''}.`
    );
  }

  if (unknownCodes.length > 0) {
    errors.push(
      `Unrecognised jurisdiction code(s) present: ${unknownCodes.slice(0, 5).join(', ')}. Only the 36 states and FCT are permitted.`
    );
  }

  if (invalidReviewDates.length > 0) {
    errors.push(
      `Invalid last substantive review date (expected YYYY-MM-DD) for: ${invalidReviewDates.slice(0, 5).join(', ')}.`
    );
  }

  // 7. Carry-forward & Quiet-day integrity checks
  if (options.sourcePub) {
    const diff = diffClassificationsAgainstSource(classifications, options.sourcePub);
    if (diff.unapprovedSilentChanges.length > 0) {
      errors.push(
        `Classification mismatch detected on state(s) still marked as carried forward (${diff.unapprovedSilentChanges.join(', ')}). Mark updated states explicitly with Research-approved data or restore carried-forward values.`
      );
    }

    if (pub.isQuietDay && diff.changedCodes.length > 0) {
      errors.push(
        `Quiet-day update cannot alter state classifications. Revert changes in: ${diff.changedCodes.join(', ')}, or uncheck Quiet-Day Update.`
      );
    }

    if (pub.carriedForwardAllStates && diff.changedCodes.length > 0) {
      errors.push(
        `Record is marked as carrying forward all 37 states, but ${diff.changedCodes.length} state classification(s) differ from the prior approved edition.`
      );
    }

    if (diff.changedCodes.length === 0 && !pub.isQuietDay) {
      warnings.push('No state classifications differ from the prior edition. Consider marking this record as a Quiet-Day Update if no classifications changed.');
    }
  }

  // 8. Research approval reference, administrator recorder identity, and approved summary gate
  if (pub.status === 'approved' || pub.status === 'published') {
    if (!pub.summary || pub.summary.trim().length < 10) {
      errors.push(
        pub.isQuietDay
          ? 'A Research-approved quiet-day statement (including the actual evidence cut-off time) is required before approval or publication.'
          : 'A Research-approved daily summary is required before approval or publication.'
      );
    }

    errors.push(...validateApprovalRecord(pub.approvalRecord, options.actorUid));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates the documented Research approval record and authenticated administrator recorder identity.
 * Explicitly ensures a manually typed approver name alone is NEVER sufficient:
 * a documented Research approval reference plus the recording administrator's UID and timestamp are mandatory.
 */
export function validateApprovalRecord(
  approval: Partial<DcmApprovalRecord> | undefined | null,
  actorUid?: string
): string[] {
  const errors: string[] = [];

  if (!approval || approval.approved !== true) {
    errors.push('Research approval must be explicitly recorded before this publication can be marked Approved or Published.');
    return errors;
  }

  const ref = (approval.approvalReference || '').trim();
  if (ref.length < 3 || ref.length > 128) {
    errors.push(
      'A documented Research approval reference (e.g. memo or sign-off ID, 3–128 characters) is required before publication. A manually typed approver name alone is not independent verification.'
    );
  }

  const approverName = (approval.approvedByName || '').trim();
  if (approverName.length < 2 || approverName.length > 128) {
    errors.push('Recorded Research approver name (2–128 characters) is required.');
  }

  if (!approval.approvedAt || Number.isNaN(new Date(approval.approvedAt).getTime())) {
    errors.push('A valid Research approval timestamp (ISO 8601) is required.');
  }

  const recorderUid = (approval.recordedByUid || approval.approvedByUid || '').trim();
  if (!recorderUid) {
    errors.push('Authenticated administrator identity (recordedByUid) must be stored when recording Research approval.');
  } else if (actorUid && recorderUid !== actorUid) {
    errors.push('Approval recorder identity does not match the signed-in administrator account.');
  }

  const recordedAt = approval.recordedAt || '';
  if (!recordedAt || Number.isNaN(new Date(recordedAt).getTime())) {
    errors.push('A valid administrator recording timestamp (recordedAt) is required.');
  }

  return errors;
}

/**
 * Validates a legacy reporting-period DCM publication prior to saving or publishing.
 * Enforces structural completeness, all 37 jurisdictions, immutability of published records,
 * and documented Research approval reference when releasing a legacy edition.
 */
export function validateLegacyPublication(
  pub: Partial<DcmPublication>,
  options: DailyValidationOptions
): DailyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!options.isAuthorizedAdmin) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can modify or publish DCM records.');
  }

  if (options.existingDoc && options.existingDoc.status === 'published') {
    errors.push(
      `Historical protection: Published edition "${options.existingDoc.id}" cannot be overwritten. Issue a corrected revision instead so the original version is preserved.`
    );
  }

  if (!pub.id || !DOC_ID_REGEX.test(pub.id)) {
    errors.push('A valid unique publication ID (letters, numbers, hyphens, underscores) is required.');
  }
  if (!pub.title || !pub.title.trim()) {
    errors.push('Publication title is required.');
  }
  if (!pub.reportingPeriodLabel || !pub.reportingPeriodLabel.trim()) {
    errors.push('Reporting period label is required.');
  }
  if (!pub.periodStart || !pub.periodEnd) {
    errors.push('Period start and end dates are required.');
  }

  const classifications = pub.classifications || {};
  const canonicalCodes = new Set(NIGERIA_37_JURISDICTIONS.map((j) => j.code));
  const missingOrInvalid: string[] = [];
  const unknownCodes = Object.keys(classifications).filter((code) => !canonicalCodes.has(code));

  for (const j of NIGERIA_37_JURISDICTIONS) {
    const rec = classifications[j.code];
    if (!rec || !rec.classification || !DCM_CLASSIFICATIONS.includes(rec.classification)) {
      missingOrInvalid.push(`${j.name} (${j.code})`);
    }
  }

  if (missingOrInvalid.length > 0) {
    errors.push(
      `All 37 jurisdictions must have a controlled classification. Missing/invalid: ${missingOrInvalid.slice(0, 5).join(', ')}${missingOrInvalid.length > 5 ? ` and ${missingOrInvalid.length - 5} more` : ''}.`
    );
  }

  if (unknownCodes.length > 0) {
    errors.push(`Unrecognised jurisdiction code(s) present: ${unknownCodes.slice(0, 5).join(', ')}.`);
  }

  if (pub.status === 'approved' || pub.status === 'published') {
    if (!pub.summary || pub.summary.trim().length < 10) {
      errors.push('A Research-approved executive summary is required before approving or publishing.');
    }
    errors.push(...validateApprovalRecord(pub.approvalRecord, options.actorUid));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Creates a new versioned draft for issuing a subsequent correction to an already-published edition.
 * Preserves the original published snapshot untouched by generating a unique revision ID (-r2, -r3, ...)
 * and recording `supersedesPublicationId`.
 */
export function createCorrectionDraft(
  publishedPub: DcmPublication,
  existingIds: string[],
  createdByUid?: string
): DcmPublication {
  const existingSet = new Set(existingIds);
  const baseId = publishedPub.id.replace(/-r\d+$/, '');
  let rev = Math.max(2, (publishedPub.revisionNumber || 1) + 1);
  let candidateId = `${baseId}-r${rev}`;
  while (existingSet.has(candidateId)) {
    rev += 1;
    candidateId = `${baseId}-r${rev}`;
  }

  const now = Date.now();
  const clonedClassifications: Record<string, DcmStateRecord> = {};
  for (const j of NIGERIA_37_JURISDICTIONS) {
    const src = publishedPub.classifications?.[j.code];
    if (src) {
      clonedClassifications[j.code] = { ...src };
    } else {
      clonedClassifications[j.code] = {
        stateCode: j.code,
        stateName: j.name,
        classification: 'Insufficient evidence'
      };
    }
  }

  return {
    ...publishedPub,
    id: candidateId,
    status: 'draft',
    isLatest: false,
    publishedAt: undefined,
    approvalRecord: undefined,
    supersedesPublicationId: publishedPub.id,
    revisionNumber: rev,
    revisionNote: publishedPub.revisionNote
      ? `${publishedPub.revisionNote} (Revision ${rev} superseding ${publishedPub.id})`
      : `Revision ${rev} superseding ${publishedPub.id}`,
    classifications: clonedClassifications,
    createdAt: now,
    updatedAt: now,
    createdByUid: createdByUid || publishedPub.createdByUid,
    updatedByUid: createdByUid
  };
}
