export type DcmClassification = 
  | 'Open'
  | 'Emerging concern'
  | 'Constrained'
  | 'Severely constrained'
  | 'Insufficient evidence';

export type RightOfResponseStatus =
  | 'Not required'
  | 'Pending'
  | 'Requested'
  | 'Response received'
  | 'Response incorporated'
  | 'No response received';

export type DcmPublicationFormat = 'legacy-period' | 'daily';

export type DcmPublicationStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'archived';

export type DcmConfidence = 'High' | 'Medium' | 'Low';
export type DcmDirection = 'newly-classified' | 'deteriorating' | 'improving' | 'stable' | 'unchanged' | 'insufficient-basis';

export const DCM_CONFIDENCE_LEVELS: DcmConfidence[] = ['High', 'Medium', 'Low'];
export const DCM_DIRECTIONS: { value: DcmDirection; label: string }[] = [
  { value: 'newly-classified', label: 'Newly classified' },
  { value: 'deteriorating', label: 'Deteriorating' },
  { value: 'insufficient-basis', label: 'Insufficient basis' },
  { value: 'improving', label: 'Improving' },
  { value: 'stable', label: 'Stable' },
  { value: 'unchanged', label: 'Unchanged' }
];

export interface DcmApprovalRecord {
  approved: boolean;
  /** Optional Research approval reference (e.g. memo/sign-off reference such as AEO-RES-2026-11-19). */
  approvalReference?: string;
  /** Optional Research approver name (administrative record only). */
  approvedByName?: string;
  /** ISO 8601 timestamp when Research approval was granted. */
  approvedAt: string;
  /** Authenticated CMS administrator UID who recorded this approval in the CMS. */
  recordedByUid: string;
  /** Authenticated CMS administrator email who recorded this approval in the CMS. */
  recordedByEmail?: string;
  /** ISO 8601 timestamp when the administrator recorded this approval in the CMS. */
  recordedAt: string;
  /** Stage 1 compatibility alias (matches recordedByUid). */
  approvedByUid?: string;
  /** Stage 1 compatibility alias (matches recordedByEmail). */
  approvedByEmail?: string;
  /** Explicit provenance marker clarifying that approval was recorded by an authenticated admin with a documented reference. */
  verificationMode?: 'admin-recorded-reference';
}

export interface DcmStateRecord {
  stateCode: string;
  stateName: string;
  classification: DcmClassification;
  direction?: DcmDirection | string;
  confidence?: DcmConfidence | string;
  keyFinding?: string;
  classificationRationale?: string;
  evidenceSummary?: string;
  rightOfResponseStatus?: RightOfResponseStatus;
  supportingSource?: string;
  internalNotes?: string;
  /** Explicitly indicates this state's classification is carried forward from a prior approved assessment */
  carriedForward?: boolean;
  /** Publication ID from which this state classification was carried forward */
  carriedForwardFromPublicationId?: string;
  /** Date (YYYY-MM-DD) of the last substantive state review, where supplied by Research */
  lastSubstantiveReviewDate?: string;
  /** Research-supplied practical effect on political competitiveness (optional; never fabricated if absent) */
  practicalCompetitivenessEffect?: string;
}

export interface DcmPublication {
  id: string; // e.g., 'dcm-2026-10-15' (legacy) or 'dcm-daily-2026-11-19' (daily)
  publicationFormat?: DcmPublicationFormat; // defaults to 'legacy-period' when omitted
  title: string;
  year: number;
  month: number; // 1-12
  periodIndex: number; // 1 (1st-15th) or 2 (16th-end) for legacy; day-of-month (1-31) or 1/2 for daily
  periodStart: string;
  periodEnd: string;
  reportingPeriodLabel: string; // e.g. "1st – 15th October 2026" or "19 November 2026"
  publicationDate: string; // e.g. "16 October 2026" or "19 November 2026"
  evidenceCutoffDate: string; // e.g. "15 October 2026" or "19 November 2026, 17:00 WAT (UTC+01:00)"
  /** Daily publication fields (optional on legacy publications) */
  assessmentDate?: string; // ISO YYYY-MM-DD
  evidenceCutoffTimeWat?: string; // 24-hour HH:mm in WAT (UTC+01:00)
  evidenceCutoffDateTimeWat?: string; // ISO 8601 with +01:00 offset, e.g. "2026-11-19T17:00:00+01:00"
  publishedAt?: string; // Actual publication ISO timestamp stamped upon release
  isQuietDay?: boolean; // True when daily update retains all prior classifications without change
  carriedForwardAllStates?: boolean; // True when all 37 state classifications are carried forward
  carriedForwardFromPublicationId?: string; // Source publication ID for carried-forward states
  supersedesPublicationId?: string; // Preserved prior published edition ID when a subsequent corrected version is issued
  revisionNumber?: number; // Revision sequence counter (1 = initial release, 2+ = subsequent corrected edition)
  approvalRecord?: DcmApprovalRecord; // Documented Research approval required before publishing
  methodologyVersion: string; // e.g. "Version 1.1"
  revisionNote?: string;
  status: DcmPublicationStatus;
  isLatest: boolean;
  isBaseline?: boolean;
  summary: string;
  changesSummary?: string;
  supportingDocumentUrl?: string;
  classifications: Record<string, DcmStateRecord>; // exactly 37 entries keyed by state code
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  updatedByUid?: string;
}

export interface DcmStateChange {
  stateCode: string;
  stateName: string;
  previousClassification: DcmClassification;
  newClassification: DcmClassification;
  rationale?: string;
  rightOfResponseStatus?: RightOfResponseStatus;
  changeType: 'changed' | 'first-classification' | 'returned-to-insufficient';
}

export interface DcmComparisonResult {
  hasPrevious: boolean;
  previousPublication?: DcmPublication;
  changedStates: DcmStateChange[];
  totalChanged: number;
  isBaseline: boolean;
  methodologyChanged: boolean;
}

// ============================================================================
// STAGE 3: PUBLIC EVIDENCE, INSTITUTIONAL RESPONSES & INCIDENT HISTORY TYPES
// ============================================================================

export type DcmEvidenceVisibility = 'public' | 'private';

export type DcmRecordPublishStatus = 'draft' | 'approved' | 'published';

/**
 * Evidence verification statuses supplied exclusively by Research.
 * The system never independently verifies evidence.
 * Records marked 'Unverified Lead (Private)' are structurally blocked from public publication.
 */
export type DcmEvidenceVerificationStatus =
  | 'Verified by Research'
  | 'Corroborated (Multiple Sources)'
  | 'Official Document / Public Record'
  | 'Disputed — Under Research Review'
  | 'Unverified Lead (Private)';

export const DCM_EVIDENCE_VERIFICATION_STATUSES: DcmEvidenceVerificationStatus[] = [
  'Verified by Research',
  'Corroborated (Multiple Sources)',
  'Official Document / Public Record',
  'Disputed — Under Research Review',
  'Unverified Lead (Private)'
];

export interface DcmSourceReference {
  sourceName: string;
  publicationDate: string; // YYYY-MM-DD
  url?: string; // Validated http(s):// URL only
  documentReference?: string; // Approved document reference / archive ID
}

export interface DcmInstitutionalResponse {
  requested: boolean;
  requestedDate?: string; // YYYY-MM-DD
  received: boolean;
  responseDate?: string; // YYYY-MM-DD
  respondentName?: string;
  publicSummary?: string; // Research-approved public response summary
  status?: RightOfResponseStatus;
}

/**
 * Structured evidence record stored in scalable Firestore collection `/dcm_evidence/{evidenceId}`.
 * Confidential notes, unverified leads, and private contacts are NEVER stored on this document;
 * they live in the separate admin-only `/dcm_private_notes/{noteId}` collection.
 */
export interface DcmEvidenceRecord {
  id: string; // e.g. "ev-kd-2026-11-19-01" or versioned "ev-kd-2026-11-19-01-r2"
  stateCode: string; // Canonical 2-letter code in NIGERIA_37_JURISDICTIONS
  stateName: string;
  incidentId?: string; // Associated incident ID, where applicable
  linkedPublicationIds: string[]; // Published DCM edition IDs this evidence supports
  title: string;
  publicDescription: string; // Approved public summary/description
  sourceName: string;
  sourcePublicationDate: string; // YYYY-MM-DD
  sourceUrl?: string; // Validated external URL (https:// or http://)
  documentReference?: string; // Approved document reference
  verificationStatus: DcmEvidenceVerificationStatus; // Supplied by Research
  isDisputed: boolean;
  disputedClaimNote?: string; // Clearly identifies disputed claims where applicable
  institutionalResponse?: DcmInstitutionalResponse;
  visibility: DcmEvidenceVisibility;
  status: DcmRecordPublishStatus;
  approvalRecord?: DcmApprovalRecord; // Mandatory documented Research approval reference + admin recorder identity
  supersedesEvidenceId?: string; // Preserved original published evidence ID when issuing a correction
  revisionNumber?: number; // 1 = initial release, 2+ = versioned correction
  publishedAt?: string; // ISO 8601 publication timestamp
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  updatedByUid?: string;
}

/**
 * Parent incident record stored in scalable Firestore collection `/dcm_incidents/{incidentId}`.
 * Allows multiple chronological developments to be grouped under one Incident ID.
 * Updating an incident record NEVER automatically alters a state's DCM map classification or colour.
 */
export interface DcmIncidentRecord {
  id: string; // e.g. "inc-la-2026-11-19-01" or "inc-la-2026-11-19-01-r2"
  stateCode: string;
  stateName: string;
  title: string;
  summary: string; // Research-approved public overview of the incident
  /** Status label provided verbatim by Research (never auto-classified as verified or resolved). */
  researchStatusLabel: string;
  firstReportedDate: string; // YYYY-MM-DD
  linkedPublicationIds: string[];
  visibility: DcmEvidenceVisibility;
  status: DcmRecordPublishStatus;
  approvalRecord?: DcmApprovalRecord;
  supersedesIncidentId?: string;
  revisionNumber?: number;
  publishedAt?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  updatedByUid?: string;
}

/**
 * Individual dated development belonging to a single parent Incident ID,
 * stored in scalable Firestore collection `/dcm_incident_developments/{developmentId}`.
 */
export interface DcmIncidentDevelopment {
  id: string; // e.g. "dev-inc-la-2026-11-19-01-01"
  incidentId: string; // Parent DcmIncidentRecord.id
  stateCode: string;
  developmentDate: string; // YYYY-MM-DD
  title: string; // e.g. "Venue access denied", "Approval restored", "Rally held"
  approvedDescription: string;
  /** Status provided verbatim by Research (never independently verified or marked resolved). */
  researchStatusLabel: string;
  /** Marked explicitly by Research when recording a remedy or subsequent corrective development. */
  isRemedyOrFollowUp?: boolean;
  sourceReferences: DcmSourceReference[];
  linkedEvidenceIds?: string[];
  linkedPublicationIds?: string[];
  visibility: DcmEvidenceVisibility;
  status: DcmRecordPublishStatus;
  approvalRecord?: DcmApprovalRecord;
  supersedesDevelopmentId?: string;
  revisionNumber?: number;
  publishedAt?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid?: string;
  updatedByUid?: string;
}

/**
 * Confidential internal notes, unverified leads, and private contacts.
 * Stored in a physically separate admin-only Firestore collection `/dcm_private_notes/{noteId}`
 * so direct public database queries against evidence or incident collections can never expose them.
 */
export interface DcmPrivateNoteRecord {
  id: string;
  targetType: 'evidence' | 'incident' | 'development' | 'state-assessment';
  targetId: string;
  stateCode: string;
  confidentialNotes: string;
  confidentialContacts?: string;
  unverifiedLeads?: string;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  updatedByUid: string;
}

/**
 * Stage 6: Editorial Content Export & Handover types.
 * Strictly administrative tracking of extracts generated from immutable, Research-approved published DCM editions.
 * Never constitutes new Research approval or modifies underlying published DCM records.
 */
export type DcmEditorialExportType =
  | 'website-summary'
  | 'newsletter-dcw'
  | 'clearpath-on-the-map';

export type DcmEditorialHandoverStatus =
  | 'prepared'
  | 'handed-over'
  | 'published-externally'
  | 'archived';

export const DCM_EDITORIAL_HANDOVER_STATUSES: { value: DcmEditorialHandoverStatus; label: string }[] = [
  { value: 'prepared', label: 'Prepared' },
  { value: 'handed-over', label: 'Handed over' },
  { value: 'published-externally', label: 'Published externally' },
  { value: 'archived', label: 'Archived' }
];

export interface DcmEditorialHandoverRecord {
  id: string;
  /** Exact canonical published DCM publication ID (e.g. dcm-daily-2026-11-19 or dcm-daily-2026-11-19-r2) */
  publicationId: string;
  /** ISO YYYY-MM-DD anchor date of the source publication */
  publicationAssessmentDate: string;
  stateCode: string;
  stateName: string;
  /** Optional approved incident ID selected for this handover */
  incidentId?: string;
  exportType: DcmEditorialExportType;
  preparedByUid: string;
  preparedByName: string;
  preparedByEmail?: string;
  /** ISO 8601 UTC timestamp of export */
  exportedAtIso: string;
  /** Human-readable WAT (UTC+01:00) timestamp label */
  exportedAtWatLabel: string;
  handoverStatus: DcmEditorialHandoverStatus;
  /** Optional destination editorial team (e.g. "Daily Newsletter Desk", "ClearPath Electoral Matters") */
  recipientTeam?: string;
  /** Permanent date- and publication-specific URL to the underlying published state assessment */
  permanentRecordUrl: string;
  /** Copied verbatim from the underlying Research-approved publication (not a new approval) */
  sourceApprovalReference: string;
  /** Explicit governance notice separating administrative handover from Research approval */
  governanceNotice: string;
  /** True when editorial staff modified draft text relative to the pure Research-approved extract */
  hasEditorialDraftEdits: boolean;
  /** Immutable JSON snapshot preserving source facts & exported extract at handover time */
  snapshotPayload: string;
  createdAt: number;
  updatedAt: number;
  createdByUid: string;
  updatedByUid: string;
}

export interface NigeriaJurisdiction {
  code: string;
  name: string;
  zone: string;
}

export const DCM_CLASSIFICATIONS: DcmClassification[] = [
  'Open',
  'Emerging concern',
  'Constrained',
  'Severely constrained',
  'Insufficient evidence'
];

export const RIGHT_OF_RESPONSE_OPTIONS: RightOfResponseStatus[] = [
  'Not required',
  'Pending',
  'Requested',
  'Response received',
  'Response incorporated',
  'No response received'
];

export const DCM_COLORS: Record<DcmClassification, {
  name: string;
  fill: string;
  text: string;
  border: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}> = {
  'Open': {
    name: 'Green — Open',
    fill: '#3e9a62',
    text: '#14532d',
    border: '#2c7348',
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700 border-emerald-200',
    description: 'Evidence indicates broadly equal practical political access without verified material or discriminatory restrictions.'
  },
  'Emerging concern': {
    name: 'Amber — Emerging Concern',
    fill: '#f6cd5c',
    text: '#713f12',
    border: '#c9a12b',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-800 border-amber-200',
    description: 'Material concerns exist affecting political competition, but evidence does not yet establish a sustained restrictive pattern.'
  },
  'Constrained': {
    name: 'Orange — Constrained',
    fill: '#e5822a',
    text: '#7c2d12',
    border: '#b86217',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-800 border-orange-200',
    description: 'Verified incidents or patterns materially restricting political competition.'
  },
  'Severely constrained': {
    name: 'Red — Severely Constrained',
    fill: '#8f1d17',
    text: '#7f1d1d',
    border: '#63110d',
    badgeBg: 'bg-red-50',
    badgeText: 'text-red-800 border-red-200',
    description: 'Evidence establishes serious and sustained restrictions substantially undermining fair political competition.'
  },
  'Insufficient evidence': {
    name: 'Grey — Insufficient Evidence',
    fill: '#c9cdd2',
    text: '#334155',
    border: '#8a939c',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700 border-slate-300',
    description: 'Available verified evidence does not meet the threshold required to reach a responsible classification.'
  }
};

// All 36 Nigerian States + FCT in official alphabetical order
export const NIGERIA_37_JURISDICTIONS: NigeriaJurisdiction[] = [
  { code: 'AB', name: 'Abia', zone: 'South East' },
  { code: 'AD', name: 'Adamawa', zone: 'North East' },
  { code: 'AK', name: 'Akwa Ibom', zone: 'South South' },
  { code: 'AN', name: 'Anambra', zone: 'South East' },
  { code: 'BA', name: 'Bauchi', zone: 'North East' },
  { code: 'BY', name: 'Bayelsa', zone: 'South South' },
  { code: 'BE', name: 'Benue', zone: 'North Central' },
  { code: 'BO', name: 'Borno', zone: 'North East' },
  { code: 'CR', name: 'Cross River', zone: 'South South' },
  { code: 'DE', name: 'Delta', zone: 'South South' },
  { code: 'EB', name: 'Ebonyi', zone: 'South East' },
  { code: 'ED', name: 'Edo', zone: 'South South' },
  { code: 'EK', name: 'Ekiti', zone: 'South West' },
  { code: 'EN', name: 'Enugu', zone: 'South East' },
  { code: 'FC', name: 'FCT', zone: 'North Central' },
  { code: 'GO', name: 'Gombe', zone: 'North East' },
  { code: 'IM', name: 'Imo', zone: 'South East' },
  { code: 'JI', name: 'Jigawa', zone: 'North West' },
  { code: 'KD', name: 'Kaduna', zone: 'North West' },
  { code: 'KN', name: 'Kano', zone: 'North West' },
  { code: 'KT', name: 'Katsina', zone: 'North West' },
  { code: 'KE', name: 'Kebbi', zone: 'North West' },
  { code: 'KO', name: 'Kogi', zone: 'North Central' },
  { code: 'KW', name: 'Kwara', zone: 'North Central' },
  { code: 'LA', name: 'Lagos', zone: 'South West' },
  { code: 'NA', name: 'Nasarawa', zone: 'North Central' },
  { code: 'NI', name: 'Niger', zone: 'North Central' },
  { code: 'OG', name: 'Ogun', zone: 'South West' },
  { code: 'OD', name: 'Ondo', zone: 'South West' },
  { code: 'OS', name: 'Osun', zone: 'South West' },
  { code: 'OY', name: 'Oyo', zone: 'South West' },
  { code: 'PL', name: 'Plateau', zone: 'North Central' },
  { code: 'RI', name: 'Rivers', zone: 'South South' },
  { code: 'SO', name: 'Sokoto', zone: 'North West' },
  { code: 'TA', name: 'Taraba', zone: 'North East' },
  { code: 'YO', name: 'Yobe', zone: 'North East' },
  { code: 'ZA', name: 'Zamfara', zone: 'North West' }
];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
