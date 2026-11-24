import {
  DcmApprovalRecord,
  DcmEvidenceRecord,
  DcmEvidenceVerificationStatus,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmInstitutionalResponse,
  DcmPrivateNoteRecord,
  DcmPublication,
  DcmSourceReference,
  DCM_EVIDENCE_VERIFICATION_STATUSES,
  NIGERIA_37_JURISDICTIONS
} from '../types/dcm';
import {
  CanonicalStateView,
  resolveJurisdictionMeta,
  resolvePublicationMetadata,
  resolveCanonicalStateView
} from './dcmConsistency';
import { getDcmChronoTimestamp } from './dcmComparison';
import { parseIsoDate, validateApprovalRecord } from './dcmDaily';

const DOC_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;
const CANONICAL_STATE_CODES = new Set(NIGERIA_37_JURISDICTIONS.map((j) => j.code));

export interface Stage3ValidationOptions {
  isAuthorizedAdmin: boolean;
  actorUid?: string;
  existingDoc?: { id: string; status: string } | null;
}

export interface Stage3ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Strictly validates and normalizes external source URLs.
 * Only `https://` and `http://` URLs with a valid hostname are accepted.
 * Blocks `javascript:`, `data:`, `vbscript:`, `file:`, and malformed links.
 */
export function sanitizeExternalUrl(rawUrl: string | undefined | null): {
  valid: boolean;
  sanitizedUrl: string | null;
  error?: string;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return { valid: true, sanitizedUrl: null };
  }
  if (trimmed.length > 2048) {
    return { valid: false, sanitizedUrl: null, error: 'Source URL exceeds maximum length (2048 characters).' };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        sanitizedUrl: null,
        error: `Unsafe URL protocol "${parsed.protocol}". Only https:// and http:// source URLs are permitted.`
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return {
        valid: false,
        sanitizedUrl: null,
        error: 'Source URL must include a valid public domain name.'
      };
    }
    return { valid: true, sanitizedUrl: parsed.toString() };
  } catch {
    return {
      valid: false,
      sanitizedUrl: null,
      error: 'Source URL is not a valid web address (must start with https:// or http://).'
    };
  }
}

export function formatIsoDateShort(isoDate: string | undefined): string {
  if (!isoDate) return '';
  const parsed = parseIsoDate(isoDate);
  if (!parsed) return isoDate;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return `${parsed.day} ${months[parsed.month - 1]} ${parsed.year}`;
}

export function buildVersionedRecordId(baseId: string, existingIds: string[] = []): string {
  const cleanRoot = baseId.replace(/-r\d+$/, '');
  const idSet = new Set(existingIds);
  if (!idSet.has(baseId)) return baseId;
  let rev = 2;
  while (idSet.has(`${cleanRoot}-r${rev}`)) {
    rev++;
  }
  return `${cleanRoot}-r${rev}`;
}

function getNextRevisionNumber(currentRevision: number | undefined, newId: string): number {
  const match = /-r(\d+)$/.exec(newId);
  if (match) return Math.max(2, Number(match[1]));
  return (currentRevision || 1) + 1;
}

// ============================================================================
// PRIVACY & PUBLIC DISPLAY GATES
// ============================================================================

function hasValidPublicApproval(approval: DcmApprovalRecord | undefined): boolean {
  if (!approval || approval.approved !== true) return false;
  const ref = (approval.approvalReference || '').trim();
  const approver = (approval.approvedByName || '').trim();
  const recorder = (approval.recordedByUid || approval.approvedByUid || '').trim();
  return ref.length >= 3 && approver.length >= 2 && recorder.length > 0;
}

/**
 * Returns true ONLY when an evidence record is explicitly approved, published, marked public,
 * and NOT an unverified private lead.
 */
export function isPubliclyDisplayableEvidence(ev: DcmEvidenceRecord | null | undefined): boolean {
  if (!ev) return false;
  if (ev.status !== 'published') return false;
  if (ev.visibility !== 'public') return false;
  if (ev.verificationStatus === 'Unverified Lead (Private)') return false;
  if (!hasValidPublicApproval(ev.approvalRecord)) return false;
  return true;
}

export function isPubliclyDisplayableIncident(inc: DcmIncidentRecord | null | undefined): boolean {
  if (!inc) return false;
  if (inc.status !== 'published') return false;
  if (inc.visibility !== 'public') return false;
  if (!hasValidPublicApproval(inc.approvalRecord)) return false;
  return true;
}

export function isPubliclyDisplayableDevelopment(dev: DcmIncidentDevelopment | null | undefined): boolean {
  if (!dev) return false;
  if (dev.status !== 'published') return false;
  if (dev.visibility !== 'public') return false;
  if (!hasValidPublicApproval(dev.approvalRecord)) return false;
  return true;
}

// ============================================================================
// VERSIONED CORRECTION DRAFT FACTORIES (PRESERVE PUBLISHED ORIGINALS)
// ============================================================================

export function createEvidenceCorrectionDraft(
  publishedEvidence: DcmEvidenceRecord,
  existingIds: string[],
  actorUid?: string
): DcmEvidenceRecord {
  const now = Date.now();
  const nextId = buildVersionedRecordId(publishedEvidence.id, existingIds);
  return {
    ...publishedEvidence,
    id: nextId,
    status: 'draft',
    supersedesEvidenceId: publishedEvidence.id,
    revisionNumber: getNextRevisionNumber(publishedEvidence.revisionNumber, nextId),
    approvalRecord: undefined,
    publishedAt: undefined,
    createdAt: now,
    updatedAt: now,
    createdByUid: actorUid || publishedEvidence.createdByUid,
    updatedByUid: actorUid || publishedEvidence.updatedByUid
  };
}

export function createIncidentCorrectionDraft(
  publishedIncident: DcmIncidentRecord,
  existingIds: string[],
  actorUid?: string
): DcmIncidentRecord {
  const now = Date.now();
  const nextId = buildVersionedRecordId(publishedIncident.id, existingIds);
  return {
    ...publishedIncident,
    id: nextId,
    status: 'draft',
    supersedesIncidentId: publishedIncident.id,
    revisionNumber: getNextRevisionNumber(publishedIncident.revisionNumber, nextId),
    approvalRecord: undefined,
    publishedAt: undefined,
    createdAt: now,
    updatedAt: now,
    createdByUid: actorUid || publishedIncident.createdByUid,
    updatedByUid: actorUid || publishedIncident.updatedByUid
  };
}

export function createDevelopmentCorrectionDraft(
  publishedDev: DcmIncidentDevelopment,
  existingIds: string[],
  actorUid?: string
): DcmIncidentDevelopment {
  const now = Date.now();
  const nextId = buildVersionedRecordId(publishedDev.id, existingIds);
  return {
    ...publishedDev,
    id: nextId,
    status: 'draft',
    supersedesDevelopmentId: publishedDev.id,
    revisionNumber: getNextRevisionNumber(publishedDev.revisionNumber, nextId),
    approvalRecord: undefined,
    publishedAt: undefined,
    createdAt: now,
    updatedAt: now,
    createdByUid: actorUid || publishedDev.createdByUid,
    updatedByUid: actorUid || publishedDev.updatedByUid
  };
}

// ============================================================================
// STRICT VALIDATORS (CMS ADMIN + PUBLISHING SAFEGUARDS)
// ============================================================================

export function validateEvidenceRecord(
  record: Partial<DcmEvidenceRecord>,
  options: Stage3ValidationOptions
): Stage3ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!options.isAuthorizedAdmin) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can create, edit, or publish evidence records.');
  }

  if (options.existingDoc && options.existingDoc.status === 'published') {
    errors.push(
      `Historical protection: Published evidence record "${options.existingDoc.id}" is immutable and cannot be overwritten. Issue a versioned correction instead.`
    );
  }

  if (!record.id || !DOC_ID_REGEX.test(record.id)) {
    errors.push('A valid unique evidence ID (3–128 alphanumeric, hyphen, or underscore characters) is required.');
  }

  if (!record.stateCode || !CANONICAL_STATE_CODES.has(record.stateCode)) {
    errors.push('A valid Nigerian state or FCT jurisdiction code is required.');
  }

  if (!record.title || record.title.trim().length < 3 || record.title.trim().length > 240) {
    errors.push('Evidence title (3–240 characters) is required.');
  }

  if (!record.publicDescription || record.publicDescription.trim().length < 10 || record.publicDescription.trim().length > 5000) {
    errors.push('Approved public description (10–5000 characters) is required.');
  }

  if (!record.sourceName || record.sourceName.trim().length < 2 || record.sourceName.trim().length > 200) {
    errors.push('Source name (2–200 characters) is required.');
  }

  if (!record.sourcePublicationDate || !parseIsoDate(record.sourcePublicationDate)) {
    errors.push('A valid source publication date (YYYY-MM-DD) is required.');
  }

  const urlCheck = sanitizeExternalUrl(record.sourceUrl);
  if (!urlCheck.valid) {
    errors.push(urlCheck.error || 'Invalid source URL.');
  }

  const hasDocRef = Boolean((record.documentReference || '').trim());
  if (!urlCheck.sanitizedUrl && !hasDocRef) {
    errors.push('Either a valid external source URL (https://) or an approved document reference is required.');
  }

  if (
    !record.verificationStatus ||
    !DCM_EVIDENCE_VERIFICATION_STATUSES.includes(record.verificationStatus as DcmEvidenceVerificationStatus)
  ) {
    errors.push('A valid Research-supplied evidence verification status is required.');
  }

  if (record.visibility !== 'public' && record.visibility !== 'private') {
    errors.push('Visibility status must be explicitly set to "public" or "private".');
  }

  if (!record.status || !['draft', 'approved', 'published'].includes(record.status)) {
    errors.push('Publication status must be Draft, Approved, or Published.');
  }

  // Strictly block unverified leads from ever being marked public or published
  if (
    record.verificationStatus === 'Unverified Lead (Private)' &&
    (record.visibility === 'public' || record.status === 'published' || record.status === 'approved')
  ) {
    errors.push(
      'Privacy safeguard: Unverified leads cannot be marked Public, Approved, or Published. Keep unverified leads as Private Drafts or in Confidential Notes.'
    );
  }

  // Disputed claim transparency
  if (record.isDisputed && (!record.disputedClaimNote || record.disputedClaimNote.trim().length < 5)) {
    warnings.push('Evidence is flagged as disputed; consider adding a brief Research-approved disputed claim note.');
  }

  // Institutional response date validation if provided
  if (record.institutionalResponse) {
    const resp = record.institutionalResponse;
    if (resp.requestedDate && !parseIsoDate(resp.requestedDate)) {
      errors.push('Institutional response request date must be a valid YYYY-MM-DD date.');
    }
    if (resp.responseDate && !parseIsoDate(resp.responseDate)) {
      errors.push('Institutional response date must be a valid YYYY-MM-DD date.');
    }
    if (resp.received && (!resp.publicSummary || resp.publicSummary.trim().length < 5)) {
      warnings.push('Institutional response is marked received; include the approved public response summary where available.');
    }
  }

  // Mandatory Research approval reference + admin recorder identity before approval or publication
  if (record.status === 'approved' || record.status === 'published') {
    errors.push(...validateApprovalRecord(record.approvalRecord, options.actorUid));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function validateIncidentRecord(
  record: Partial<DcmIncidentRecord>,
  options: Stage3ValidationOptions
): Stage3ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!options.isAuthorizedAdmin) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can create, edit, or publish incident records.');
  }

  if (options.existingDoc && options.existingDoc.status === 'published') {
    errors.push(
      `Historical protection: Published incident record "${options.existingDoc.id}" is immutable and cannot be overwritten. Issue a versioned correction instead.`
    );
  }

  if (!record.id || !DOC_ID_REGEX.test(record.id)) {
    errors.push('A valid unique incident ID (3–128 alphanumeric, hyphen, or underscore characters) is required.');
  }

  if (!record.stateCode || !CANONICAL_STATE_CODES.has(record.stateCode)) {
    errors.push('A valid Nigerian state or FCT jurisdiction code is required.');
  }

  if (!record.title || record.title.trim().length < 3 || record.title.trim().length > 240) {
    errors.push('Incident title (3–240 characters) is required.');
  }

  if (!record.summary || record.summary.trim().length < 10 || record.summary.trim().length > 5000) {
    errors.push('Approved incident overview (10–5000 characters) is required.');
  }

  if (!record.researchStatusLabel || record.researchStatusLabel.trim().length < 2 || record.researchStatusLabel.trim().length > 120) {
    errors.push('Research-supplied incident status label (2–120 characters) is required.');
  }

  if (!record.firstReportedDate || !parseIsoDate(record.firstReportedDate)) {
    errors.push('A valid first reported date (YYYY-MM-DD) is required.');
  }

  if (record.visibility !== 'public' && record.visibility !== 'private') {
    errors.push('Visibility status must be explicitly set to "public" or "private".');
  }

  if (!record.status || !['draft', 'approved', 'published'].includes(record.status)) {
    errors.push('Publication status must be Draft, Approved, or Published.');
  }

  if (record.status === 'approved' || record.status === 'published') {
    errors.push(...validateApprovalRecord(record.approvalRecord, options.actorUid));
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateIncidentDevelopment(
  dev: Partial<DcmIncidentDevelopment>,
  options: Stage3ValidationOptions
): Stage3ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!options.isAuthorizedAdmin) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can manage incident developments.');
  }

  if (options.existingDoc && options.existingDoc.status === 'published') {
    errors.push(
      `Historical protection: Published incident development "${options.existingDoc.id}" is immutable and cannot be overwritten. Issue a versioned correction instead.`
    );
  }

  if (!dev.id || !DOC_ID_REGEX.test(dev.id)) {
    errors.push('A valid unique development ID (3–128 characters) is required.');
  }

  if (!dev.incidentId || !DOC_ID_REGEX.test(dev.incidentId)) {
    errors.push('A parent Incident ID is required to associate this development.');
  }

  if (!dev.stateCode || !CANONICAL_STATE_CODES.has(dev.stateCode)) {
    errors.push('A valid Nigerian state or FCT jurisdiction code is required.');
  }

  if (!dev.developmentDate || !parseIsoDate(dev.developmentDate)) {
    errors.push('A valid development date (YYYY-MM-DD) is required.');
  }

  if (!dev.title || dev.title.trim().length < 3 || dev.title.trim().length > 240) {
    errors.push('Development title (3–240 characters) is required.');
  }

  if (!dev.approvedDescription || dev.approvedDescription.trim().length < 10 || dev.approvedDescription.trim().length > 5000) {
    errors.push('Approved development description (10–5000 characters) is required.');
  }

  if (!dev.researchStatusLabel || dev.researchStatusLabel.trim().length < 2 || dev.researchStatusLabel.trim().length > 120) {
    errors.push('Research-supplied development status label is required.');
  }

  if (dev.visibility !== 'public' && dev.visibility !== 'private') {
    errors.push('Visibility status must be explicitly set to "public" or "private".');
  }

  if (!dev.status || !['draft', 'approved', 'published'].includes(dev.status)) {
    errors.push('Publication status must be Draft, Approved, or Published.');
  }

  const refs = Array.isArray(dev.sourceReferences) ? dev.sourceReferences : [];
  if (dev.status === 'published' && refs.length === 0) {
    errors.push('At least one dated source reference (URL or approved document reference) is required before publishing a development.');
  }

  refs.forEach((ref, idx) => {
    if (!ref.sourceName || !ref.sourceName.trim()) {
      errors.push(`Source reference #${idx + 1} is missing a source name.`);
    }
    if (!ref.publicationDate || !parseIsoDate(ref.publicationDate)) {
      errors.push(`Source reference #${idx + 1} requires a valid publication date (YYYY-MM-DD).`);
    }
    const check = sanitizeExternalUrl(ref.url);
    if (!check.valid) {
      errors.push(`Source reference #${idx + 1}: ${check.error}`);
    }
    if (!check.sanitizedUrl && !(ref.documentReference || '').trim()) {
      errors.push(`Source reference #${idx + 1} must provide either a valid https:// URL or a document reference.`);
    }
  });

  if (dev.status === 'approved' || dev.status === 'published') {
    errors.push(...validateApprovalRecord(dev.approvalRecord, options.actorUid));
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validatePrivateNoteRecord(
  note: Partial<DcmPrivateNoteRecord>,
  options: { isAuthorizedAdmin: boolean; actorUid?: string }
): Stage3ValidationResult {
  const errors: string[] = [];
  if (!options.isAuthorizedAdmin || !options.actorUid) {
    errors.push('Unauthorised action: Only an authorised AEO administrator can access or save confidential notes.');
  }
  if (!note.id || !DOC_ID_REGEX.test(note.id)) {
    errors.push('A valid private note ID is required.');
  }
  if (!note.targetId || !DOC_ID_REGEX.test(note.targetId)) {
    errors.push('A target record ID is required for the confidential note.');
  }
  if (!note.stateCode || !CANONICAL_STATE_CODES.has(note.stateCode)) {
    errors.push('A valid jurisdiction code is required.');
  }
  const hasContent = Boolean(
    (note.confidentialNotes || '').trim() ||
      (note.confidentialContacts || '').trim() ||
      (note.unverifiedLeads || '').trim()
  );
  if (!hasContent) {
    errors.push('Confidential note must contain at least one note, contact, or unverified lead entry.');
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}

// ============================================================================
// CANONICAL STATE ASSESSMENT PANEL RESOLVER (SECTIONS A, B, C, D, E)
// ============================================================================

export interface ResolvedEvidenceDisplayItem {
  id: string;
  stateCode: string;
  incidentId?: string;
  title: string;
  publicDescription: string;
  sourceName: string;
  sourcePublicationDate: string;
  sourceDateDisplay: string;
  safeSourceUrl: string | null;
  documentReference: string;
  verificationStatus: DcmEvidenceVerificationStatus;
  isDisputed: boolean;
  disputedClaimNote: string;
  institutionalResponse: DcmInstitutionalResponse | null;
  approvalReference: string;
  revisionNumber: number;
  supersedesEvidenceId?: string;
  publishedAt?: string;
}

export interface ResolvedDevelopmentDisplayItem {
  id: string;
  incidentId: string;
  developmentDate: string;
  developmentDateDisplay: string;
  title: string;
  approvedDescription: string;
  researchStatusLabel: string;
  isRemedyOrFollowUp: boolean;
  sourceReferences: Array<{
    sourceName: string;
    publicationDate: string;
    dateDisplay: string;
    safeUrl: string | null;
    documentReference: string;
  }>;
  approvalReference: string;
  revisionNumber: number;
  supersedesDevelopmentId?: string;
}

export interface ResolvedIncidentDisplayItem {
  id: string;
  stateCode: string;
  title: string;
  summary: string;
  researchStatusLabel: string;
  firstReportedDate: string;
  firstReportedDateDisplay: string;
  approvalReference: string;
  revisionNumber: number;
  supersedesIncidentId?: string;
  developments: ResolvedDevelopmentDisplayItem[];
}

export interface ResolvedInstitutionalResponseSummary {
  hasAnyResponseData: boolean;
  requested: boolean | null;
  requestedDateDisplay: string;
  received: boolean | null;
  responseDateDisplay: string;
  rightOfResponseStatusLabel: string;
  responses: Array<{
    evidenceId: string;
    evidenceTitle: string;
    respondentName: string;
    requested: boolean;
    requestedDateDisplay: string;
    received: boolean;
    responseDateDisplay: string;
    publicSummary: string;
  }>;
}

export interface HistoricalStateEditionEntry {
  publicationId: string;
  reportingPeriodLabel: string;
  evidenceCutoffLabel: string;
  isDaily: boolean;
  isSelected: boolean;
  classification: string;
  hex: string;
  hasApprovedFinding: boolean;
  keyFindingPreview: string;
  publishedEvidenceCount: number;
  evidenceTitles: string[];
}

export interface StateAssessmentPanelData {
  stateCode: string;
  stateName: string;
  mapName: string;
  zone: string;
  // A. Classification Overview
  currentView: CanonicalStateView;
  previousView: CanonicalStateView | null;
  previousPeriodLabel: string | null;
  classificationChangedFromPrevious: boolean;
  approvedChangeOrRetentionReason: string;
  hasApprovedChangeOrRetentionReason: boolean;
  // B. Supporting Evidence
  supportingEvidence: ResolvedEvidenceDisplayItem[];
  // C. Institutional Response
  institutionalResponse: ResolvedInstitutionalResponseSummary;
  // D. Incident History
  incidents: ResolvedIncidentDisplayItem[];
  // E. Historical Information
  historicalEditions: HistoricalStateEditionEntry[];
}

/**
 * Resolves the canonical active versions of published records for a given publication snapshot.
 * - Preserves historical fidelity: if a correction revision (`-r2`) was explicitly linked to a
 *   specific publication OR issued for that publication, it supersedes the prior version (`-r1`)
 *   for that publication while allowing older publications linked exclusively to `-r1` to keep `-r1`!
 */
function filterScopedActiveVersions<
  T extends {
    id: string;
    stateCode: string;
    linkedPublicationIds?: string[];
    publishedAt?: string;
    revisionNumber?: number;
  }
>(
  items: T[],
  stateCode: string,
  targetPub: DcmPublication,
  getSupersededId: (item: T) => string | undefined,
  getAnchorIsoDate: (item: T) => string | undefined
): T[] {
  const targetCutoffTs = getDcmChronoTimestamp(targetPub);

  // Step 1: Scope records belonging to this state and visible as of targetPub
  const scoped = items.filter((item) => {
    if (item.stateCode !== stateCode) return false;
    const links = Array.isArray(item.linkedPublicationIds) ? item.linkedPublicationIds.filter(Boolean) : [];
    if (links.length > 0) {
      return links.includes(targetPub.id);
    }
    // If not explicitly pinned to specific publication IDs, include if dated on or before targetPub's cut-off
    const anchor = getAnchorIsoDate(item);
    if (!anchor) return true;
    const anchorTs = new Date(`${anchor}T00:00:00+01:00`).getTime();
    if (Number.isNaN(anchorTs)) return true;
    return anchorTs <= targetCutoffTs;
  });

  // Step 2: Within this scoped snapshot, suppress any original ID superseded by another item IN THE SAME SNAPSHOT
  const supersededIdsInScope = new Set<string>();
  for (const item of scoped) {
    const sup = getSupersededId(item);
    if (sup) supersededIdsInScope.add(sup);
  }

  return scoped.filter((item) => !supersededIdsInScope.has(item.id));
}

function toSafeSourceRefDisplay(ref: DcmSourceReference) {
  const urlCheck = sanitizeExternalUrl(ref.url);
  return {
    sourceName: ref.sourceName.trim(),
    publicationDate: ref.publicationDate,
    dateDisplay: formatIsoDateShort(ref.publicationDate),
    safeUrl: urlCheck.valid ? urlCheck.sanitizedUrl : null,
    documentReference: (ref.documentReference || '').trim()
  };
}

/**
 * Resolves all five Stage 3 state assessment sections (A–E) from Stage 2's canonical selected publication
 * plus public approved evidence, incidents, and developments. Never invents data or alters classifications.
 */
export function resolveStateAssessmentPanelData(params: {
  selectedPub: DcmPublication;
  previousPub: DcmPublication | null;
  allPublishedSortedAsc: DcmPublication[];
  stateKey: string;
  evidenceRecords: DcmEvidenceRecord[];
  incidentRecords: DcmIncidentRecord[];
  developmentRecords: DcmIncidentDevelopment[];
}): StateAssessmentPanelData {
  const {
    selectedPub,
    previousPub,
    allPublishedSortedAsc,
    stateKey,
    evidenceRecords,
    incidentRecords,
    developmentRecords
  } = params;

  const meta = resolveJurisdictionMeta(stateKey);
  const currentView = resolveCanonicalStateView(selectedPub, stateKey);
  const previousView = previousPub ? resolveCanonicalStateView(previousPub, stateKey) : null;
  const previousPeriodLabel = previousPub ? resolvePublicationMetadata(previousPub).periodLabel : null;

  const stateCode = meta?.code || currentView.stateCode;

  const classificationChangedFromPrevious = Boolean(
    previousView &&
      !currentView.isClassificationUnavailable &&
      !previousView.isClassificationUnavailable &&
      currentView.classification !== previousView.classification
  );

  // Approved reason for changing or retaining classification (strictly from approved state record fields)
  const approvedReason = (
    currentView.classificationRationale ||
    (currentView.hasApprovedFinding ? currentView.keyFinding : '')
  ).trim();
  const hasApprovedChangeOrRetentionReason = approvedReason.length > 0;

  // B. Supporting Evidence (strictly approved public records only)
  const publicEvidenceOnly = (evidenceRecords || []).filter(isPubliclyDisplayableEvidence);
  const scopedEvidence = filterScopedActiveVersions(
    publicEvidenceOnly,
    stateCode,
    selectedPub,
    (ev) => ev.supersedesEvidenceId,
    (ev) => ev.sourcePublicationDate
  ).sort((a, b) => {
    // Newest source publication date first
    const dateCmp = (b.sourcePublicationDate || '').localeCompare(a.sourcePublicationDate || '');
    if (dateCmp !== 0) return dateCmp;
    return (b.revisionNumber || 1) - (a.revisionNumber || 1);
  });

  const supportingEvidence: ResolvedEvidenceDisplayItem[] = scopedEvidence.map((ev) => {
    const urlCheck = sanitizeExternalUrl(ev.sourceUrl);
    return {
      id: ev.id,
      stateCode: ev.stateCode,
      incidentId: ev.incidentId,
      title: ev.title.trim(),
      publicDescription: ev.publicDescription.trim(),
      sourceName: ev.sourceName.trim(),
      sourcePublicationDate: ev.sourcePublicationDate,
      sourceDateDisplay: formatIsoDateShort(ev.sourcePublicationDate),
      safeSourceUrl: urlCheck.valid ? urlCheck.sanitizedUrl : null,
      documentReference: (ev.documentReference || '').trim(),
      verificationStatus: ev.verificationStatus,
      isDisputed: Boolean(ev.isDisputed),
      disputedClaimNote: (ev.disputedClaimNote || '').trim(),
      institutionalResponse: ev.institutionalResponse || null,
      approvalReference: ev.approvalRecord?.approvalReference || '',
      revisionNumber: ev.revisionNumber || 1,
      supersedesEvidenceId: ev.supersedesEvidenceId,
      publishedAt: ev.publishedAt
    };
  });

  // C. Institutional Response (derived from scoped approved public evidence + state's rightOfResponseStatus)
  const structuredResponses = supportingEvidence
    .filter((ev) => ev.institutionalResponse && (ev.institutionalResponse.requested || ev.institutionalResponse.received || (ev.institutionalResponse.publicSummary || '').trim()))
    .map((ev) => {
      const resp = ev.institutionalResponse!;
      return {
        evidenceId: ev.id,
        evidenceTitle: ev.title,
        respondentName: (resp.respondentName || '').trim(),
        requested: Boolean(resp.requested),
        requestedDateDisplay: formatIsoDateShort(resp.requestedDate),
        received: Boolean(resp.received),
        responseDateDisplay: formatIsoDateShort(resp.responseDate),
        publicSummary: (resp.publicSummary || '').trim()
      };
    });

  const rorLabel = currentView.rightOfResponseLabel;
  const rorImpliesRequested =
    rorLabel === 'Requested' ||
    rorLabel === 'Pending' ||
    rorLabel === 'Response received' ||
    rorLabel === 'Response incorporated' ||
    rorLabel === 'No response received';
  const rorImpliesReceived =
    rorLabel === 'Response received' || rorLabel === 'Response incorporated';

  const anyRequested =
    structuredResponses.length > 0
      ? structuredResponses.some((r) => r.requested)
      : rorImpliesRequested
        ? true
        : rorLabel === 'Not required'
          ? false
          : null;

  const anyReceived =
    structuredResponses.length > 0
      ? structuredResponses.some((r) => r.received)
      : rorImpliesReceived
        ? true
        : rorLabel === 'No response received' || rorLabel === 'Requested' || rorLabel === 'Pending'
          ? false
          : null;

  const firstReqDate = structuredResponses.find((r) => r.requestedDateDisplay)?.requestedDateDisplay || '';
  const firstRespDate = structuredResponses.find((r) => r.responseDateDisplay)?.responseDateDisplay || '';

  const institutionalResponse: ResolvedInstitutionalResponseSummary = {
    hasAnyResponseData: structuredResponses.length > 0 || (rorLabel !== 'Not specified' && rorLabel !== 'Not recorded'),
    requested: anyRequested,
    requestedDateDisplay: firstReqDate,
    received: anyReceived,
    responseDateDisplay: firstRespDate,
    rightOfResponseStatusLabel: rorLabel,
    responses: structuredResponses
  };

  // D. Incident History (grouped by parent Incident ID, developments sorted chronologically ascending)
  const publicIncidentsOnly = (incidentRecords || []).filter(isPubliclyDisplayableIncident);
  const publicDevsOnly = (developmentRecords || []).filter(isPubliclyDisplayableDevelopment);

  const scopedIncidents = filterScopedActiveVersions(
    publicIncidentsOnly,
    stateCode,
    selectedPub,
    (inc) => inc.supersedesIncidentId,
    (inc) => inc.firstReportedDate
  ).sort((a, b) => (b.firstReportedDate || '').localeCompare(a.firstReportedDate || ''));

  // Build map from canonical incident root ID (supporting superseded parent links too) to developments
  const scopedDevs = filterScopedActiveVersions(
    publicDevsOnly,
    stateCode,
    selectedPub,
    (dev) => dev.supersedesDevelopmentId,
    (dev) => dev.developmentDate
  );

  const incidents: ResolvedIncidentDisplayItem[] = scopedIncidents.map((inc) => {
    const matchingIds = new Set<string>([inc.id]);
    if (inc.supersedesIncidentId) matchingIds.add(inc.supersedesIncidentId);
    // Also match root ID without -rN suffix if a development pointed to the original incident
    matchingIds.add(inc.id.replace(/-r\d+$/, ''));

    const devsForIncident = scopedDevs
      .filter((d) => matchingIds.has(d.incidentId) || matchingIds.has(d.incidentId.replace(/-r\d+$/, '')))
      .sort((a, b) => {
        const dCmp = (a.developmentDate || '').localeCompare(b.developmentDate || '');
        if (dCmp !== 0) return dCmp;
        return (a.createdAt || 0) - (b.createdAt || 0);
      })
      .map((d): ResolvedDevelopmentDisplayItem => ({
        id: d.id,
        incidentId: d.incidentId,
        developmentDate: d.developmentDate,
        developmentDateDisplay: formatIsoDateShort(d.developmentDate),
        title: d.title.trim(),
        approvedDescription: d.approvedDescription.trim(),
        researchStatusLabel: d.researchStatusLabel.trim(),
        isRemedyOrFollowUp: Boolean(d.isRemedyOrFollowUp),
        sourceReferences: (d.sourceReferences || []).map(toSafeSourceRefDisplay),
        approvalReference: d.approvalRecord?.approvalReference || '',
        revisionNumber: d.revisionNumber || 1,
        supersedesDevelopmentId: d.supersedesDevelopmentId
      }));

    return {
      id: inc.id,
      stateCode: inc.stateCode,
      title: inc.title.trim(),
      summary: inc.summary.trim(),
      researchStatusLabel: inc.researchStatusLabel.trim(),
      firstReportedDate: inc.firstReportedDate,
      firstReportedDateDisplay: formatIsoDateShort(inc.firstReportedDate),
      approvalReference: inc.approvalRecord?.approvalReference || '',
      revisionNumber: inc.revisionNumber || 1,
      supersedesIncidentId: inc.supersedesIncidentId,
      developments: devsForIncident
    };
  });

  // E. Historical Information (all published editions newest-first, preserving each edition's own original evidence)
  const historicalEditions: HistoricalStateEditionEntry[] = [...(allPublishedSortedAsc || [])]
    .reverse()
    .map((pub) => {
      const pMeta = resolvePublicationMetadata(pub);
      const pState = resolveCanonicalStateView(pub, stateCode);
      const pEvidence = filterScopedActiveVersions(
        publicEvidenceOnly,
        stateCode,
        pub,
        (ev) => ev.supersedesEvidenceId,
        (ev) => ev.sourcePublicationDate
      );
      return {
        publicationId: pub.id,
        reportingPeriodLabel: pMeta.periodLabel,
        evidenceCutoffLabel: pMeta.evidenceCutoffLabel,
        isDaily: pMeta.isDaily,
        isSelected: pub.id === selectedPub.id,
        classification: pState.classification,
        hex: pState.hex,
        hasApprovedFinding: pState.hasApprovedFinding,
        keyFindingPreview: pState.keyFinding,
        publishedEvidenceCount: pEvidence.length,
        evidenceTitles: pEvidence.map((e) => e.title)
      };
    });

  return {
    stateCode,
    stateName: meta?.name || currentView.stateName,
    mapName: meta?.mapName || currentView.mapName,
    zone: meta?.zone || currentView.zone,
    currentView,
    previousView,
    previousPeriodLabel,
    classificationChangedFromPrevious,
    approvedChangeOrRetentionReason: approvedReason,
    hasApprovedChangeOrRetentionReason,
    supportingEvidence,
    institutionalResponse,
    incidents,
    historicalEditions
  };
}
