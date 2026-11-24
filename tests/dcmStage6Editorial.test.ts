/**
 * AEO DCM Corrections — Stage 6 Verification Test Suite
 * Editorial Content Export, Handover Governance & Hardened Chronological Archive Queries
 *
 * Uses strictly synthetic in-memory fixtures (never writes to Production Firestore).
 * Run with: npx tsx tests/dcmStage6Editorial.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  DcmClassification,
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPublication,
  NIGERIA_37_JURISDICTIONS
} from '../src/types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../src/data/dcmInitialData';
import {
  DCM_CANONICAL_PALETTE,
  buildCanonicalPublicationView,
  resolvePublicDcmPublications
} from '../src/utils/dcmConsistency';
import {
  EDITORIAL_CORRECTION_NOTICE_LABEL,
  resolveDcmPermalink
} from '../src/utils/dcmArchive';
import {
  EDITORIAL_HANDOVER_GOVERNANCE_NOTICE,
  NOT_SUPPLIED_LABEL,
  REQUIRED_STAGE_6_COMPOSITE_INDEXES,
  buildCanonicalEditorialSource,
  buildEditorialHandoverRecord,
  generateClearPathOnTheMapExtract,
  generateNewsletterDcwExtract,
  generateWebsiteDailySummaryExtract,
  selectLatestDailyWindow,
  validateEditorialHandoverRecord
} from '../src/utils/dcmEditorial';
import { DcmEditorialPublishingView } from '../src/components/DcmEditorialPublishingManager';

// ============================================================================
// SYNTHETIC FIXTURE BUILDERS (STRICTLY IN-MEMORY)
// ============================================================================

function make37Classifications(
  overrides: Record<
    string,
    {
      classification: DcmClassification;
      keyFinding?: string;
      classificationRationale?: string;
      evidenceSummary?: string;
      rightOfResponseStatus?: any;
      practicalCompetitivenessEffect?: string;
      carriedForward?: boolean;
    }
  > = {}
) {
  const map: DcmPublication['classifications'] = {};
  for (const j of NIGERIA_37_JURISDICTIONS) {
    const ov = overrides[j.code];
    map[j.code] = {
      stateCode: j.code,
      stateName: j.name,
      classification: ov?.classification || 'Insufficient evidence',
      keyFinding: ov?.keyFinding || '',
      classificationRationale: ov?.classificationRationale || '',
      evidenceSummary: ov?.evidenceSummary || '',
      rightOfResponseStatus: ov?.rightOfResponseStatus || 'Not required',
      ...(ov?.practicalCompetitivenessEffect
        ? { practicalCompetitivenessEffect: ov.practicalCompetitivenessEffect }
        : {}),
      carriedForward: ov?.carriedForward ?? false
    };
  }
  return map;
}

function makeDailyPub(params: {
  id: string;
  dateIso: string;
  status?: DcmPublication['status'];
  isQuietDay?: boolean;
  summary?: string;
  approvalRef?: string;
  revisionNumber?: number;
  supersedesPublicationId?: string;
  revisionNote?: string;
  overrides?: Parameters<typeof make37Classifications>[0];
}): DcmPublication {
  const [y, m, d] = params.dateIso.split('-').map(Number);
  const nowMs = Date.parse(`${params.dateIso}T17:00:00+01:00`);
  return {
    id: params.id,
    publicationFormat: 'daily',
    title: `Democratic Competitiveness Map — Daily Update (${params.dateIso})`,
    year: y,
    month: m,
    periodIndex: d,
    periodStart: params.dateIso,
    periodEnd: params.dateIso,
    reportingPeriodLabel: `${d} Nov ${y}`,
    publicationDate: `${d} Nov ${y}`,
    evidenceCutoffDate: `${d} Nov ${y}, 17:00 WAT (UTC+01:00)`,
    assessmentDate: params.dateIso,
    evidenceCutoffTimeWat: '17:00',
    evidenceCutoffDateTimeWat: `${params.dateIso}T17:00:00+01:00`,
    publishedAt: params.status === 'published' ? `${params.dateIso}T17:15:00+01:00` : undefined,
    isQuietDay: Boolean(params.isQuietDay),
    carriedForwardAllStates: Boolean(params.isQuietDay),
    supersedesPublicationId: params.supersedesPublicationId,
    revisionNumber: params.revisionNumber || 1,
    revisionNote: params.revisionNote,
    approvalRecord:
      params.status === 'draft'
        ? undefined
        : {
            approved: true,
            approvalReference: params.approvalRef || `SYNTH-RES-${params.dateIso}`,
            approvedByName: 'Synthetic Research Lead',
            approvedAt: `${params.dateIso}T16:45:00+01:00`,
            recordedByUid: 'admin-synth-01',
            recordedByEmail: 'editorial-synth@example.org',
            recordedAt: `${params.dateIso}T16:50:00+01:00`,
            verificationMode: 'admin-recorded-reference'
          },
    methodologyVersion: 'Version 1.1',
    status: params.status || 'published',
    isLatest: false,
    summary:
      params.summary ??
      `Synthetic Research-approved daily summary for ${params.dateIso}.`,
    classifications: make37Classifications(params.overrides),
    createdAt: nowMs,
    updatedAt: nowMs,
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  };
}

// Synthetic multi-day series
const pubNov18 = makeDailyPub({
  id: 'dcm-daily-2026-11-18',
  dateIso: '2026-11-18',
  status: 'published',
  approvalRef: 'SYNTH-RES-2026-11-18',
  summary: 'Synthetic baseline daily update for 18 November 2026.',
  overrides: {
    BE: {
      classification: 'Emerging concern',
      keyFinding: 'Synthetic baseline monitoring entry for Benue.',
      classificationRationale: 'Prior day synthetic classification.'
    },
    LA: {
      classification: 'Emerging concern',
      keyFinding: 'Synthetic baseline monitoring entry for Lagos.',
      classificationRationale: 'Prior day synthetic classification.'
    }
  }
});

const pubNov19R1 = makeDailyPub({
  id: 'dcm-daily-2026-11-19',
  dateIso: '2026-11-19',
  status: 'published',
  approvalRef: 'SYNTH-RES-2026-11-19-R1',
  summary:
    'Synthetic daily update for 19 November 2026: Benue moved from Emerging concern to Constrained following synthetic verified municipal venue access restrictions; Lagos remained Emerging concern with no optional competitiveness note supplied.',
  overrides: {
    BE: {
      classification: 'Constrained',
      keyFinding:
        'Synthetic verified municipal directive restricted two scheduled opposition town halls in Makurdi without published objective criteria.',
      classificationRationale:
        'Verified restriction affecting scheduled campaign gatherings moved Benue from Emerging concern to Constrained pending documented administrative remedy.',
      evidenceSummary: 'Two dated synthetic official notices and one synthetic municipal press response.',
      rightOfResponseStatus: 'Response received',
      practicalCompetitivenessEffect:
        'Opposition candidates experienced delayed access to public town-hall venues compared with ruling-party fixtures during the assessment window.'
    },
    LA: {
      classification: 'Emerging concern',
      keyFinding: 'Synthetic routine monitoring recorded no classification change in Lagos.',
      classificationRationale: 'No new qualifying restriction met threshold to alter Emerging concern.',
      rightOfResponseStatus: 'Not required'
      // Deliberately omits practicalCompetitivenessEffect to test NOT_SUPPLIED_LABEL
    }
  }
});

const pubNov19R2 = makeDailyPub({
  id: 'dcm-daily-2026-11-19-r2',
  dateIso: '2026-11-19',
  status: 'published',
  approvalRef: 'SYNTH-RES-2026-11-19-R2',
  revisionNumber: 2,
  supersedesPublicationId: 'dcm-daily-2026-11-19',
  revisionNote: 'Corrected synthetic source publication date typo from 17 Nov to 18 Nov.',
  summary:
    'Synthetic corrected daily update (Rev 2) for 19 November 2026: editorial date citation corrected without altering classifications.',
  overrides: {
    BE: {
      classification: 'Constrained',
      keyFinding:
        'Synthetic verified municipal directive restricted two scheduled opposition town halls in Makurdi without published objective criteria (citation date corrected in Rev 2).',
      classificationRationale:
        'Verified restriction affecting scheduled campaign gatherings moved Benue from Emerging concern to Constrained pending documented administrative remedy.',
      rightOfResponseStatus: 'Response received',
      practicalCompetitivenessEffect:
        'Opposition candidates experienced delayed access to public town-hall venues compared with ruling-party fixtures during the assessment window.'
    },
    LA: {
      classification: 'Emerging concern',
      keyFinding: 'Synthetic routine monitoring recorded no classification change in Lagos.',
      classificationRationale: 'No new qualifying restriction met threshold to alter Emerging concern.',
      rightOfResponseStatus: 'Not required'
    }
  }
});

const pubNov20Quiet = makeDailyPub({
  id: 'dcm-daily-2026-11-20',
  dateIso: '2026-11-20',
  status: 'published',
  isQuietDay: true,
  approvalRef: 'SYNTH-RES-2026-11-20-QUIET',
  summary:
    'Quiet-day update for 20 November 2026: no new qualifying developments required classification changes; all 37 jurisdictions carried forward unchanged.',
  overrides: {
    BE: {
      classification: 'Constrained',
      carriedForward: true,
      classificationRationale: ''
    },
    LA: {
      classification: 'Emerging concern',
      carriedForward: true,
      classificationRationale: ''
    }
  }
});

const pubNov21Draft = makeDailyPub({
  id: 'dcm-daily-2026-11-21-draft',
  dateIso: '2026-11-21',
  status: 'draft',
  summary: 'CONFIDENTIAL DRAFT SUMMARY — MUST NEVER APPEAR IN EXPORTS',
  overrides: {
    BE: {
      classification: 'Severely constrained',
      keyFinding: 'UNPUBLISHED DRAFT FINDING — MUST NEVER LEAK'
    }
  }
});

const pubNov22ApprovedNotPublished = makeDailyPub({
  id: 'dcm-daily-2026-11-22-approved',
  dateIso: '2026-11-22',
  status: 'approved',
  approvalRef: 'SYNTH-RES-2026-11-22-UNPUB',
  summary: 'APPROVED BUT NOT PUBLISHED — MUST BE EXCLUDED'
});

// Synthetic Evidence, Incidents & Developments (mix of public published + private/draft/unverified leads)
const syntheticEvidence: DcmEvidenceRecord[] = [
  {
    id: 'ev-synth-be-01',
    stateCode: 'BE',
    stateName: 'Benue',
    incidentId: 'inc-synth-be-01',
    title: 'Synthetic Municipal Venue Restriction Circular (Makurdi)',
    publicDescription:
      'Synthetic public circular dated 18 November 2026 suspended bookings for two public halls scheduled for opposition meetings.',
    sourceName: 'Synthetic Benue Civic Monitor',
    sourcePublicationDate: '2026-11-18',
    sourceUrl: 'https://example.org/synthetic/benue-circular-2026-11-18',
    documentReference: 'SYNTH-DOC-BE-118',
    verificationStatus: 'Verified by Research',
    isDisputed: true,
    disputedClaimNote:
      'Event organisers stated notice was served 6 hours before the event; municipal office stated notice was posted 48 hours earlier.',
    institutionalResponse: {
      respondentName: 'Synthetic Makurdi Municipal Facility Board',
      requested: true,
      requestedDate: '2026-11-18',
      received: true,
      responseDate: '2026-11-19',
      publicSummary:
        'Board stated suspension resulted from routine electrical maintenance and committed to re-issuing dates within 72 hours.'
    },
    linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
    visibility: 'public',
    status: 'published',
    approvalRecord: pubNov19R1.approvalRecord,
    publishedAt: '2026-11-19T17:15:00+01:00',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  },
  {
    id: 'ev-synth-be-private-leak-test',
    stateCode: 'BE',
    stateName: 'Benue',
    incidentId: 'inc-synth-be-01',
    title: 'PRIVATE CONFIDENTIAL LEAD — DO NOT EXPORT',
    publicDescription: 'Unverified informant rumour containing private phone number 0800-SECRET.',
    sourceName: 'Confidential Informant',
    sourcePublicationDate: '2026-11-19',
    verificationStatus: 'Unverified Lead (Private)',
    isDisputed: false,
    linkedPublicationIds: ['dcm-daily-2026-11-19'],
    visibility: 'private',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  },
  {
    id: 'ev-synth-be-xss',
    stateCode: 'BE',
    stateName: 'Benue',
    incidentId: 'inc-synth-be-01',
    title: 'Synthetic Secondary Press Confirmation <script>alert(1)</script>',
    publicDescription:
      'Independent synthetic local radio confirmed postponement of both Makurdi sessions on 19 November 2026.',
    sourceName: 'Synthetic North-Central Radio',
    sourcePublicationDate: '2026-11-19',
    sourceUrl: 'https://example.org/synthetic/radio-confirm',
    verificationStatus: 'Corroborated (Multiple Sources)',
    isDisputed: false,
    linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
    visibility: 'public',
    status: 'published',
    approvalRecord: pubNov19R1.approvalRecord,
    publishedAt: '2026-11-19T17:15:00+01:00',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  }
];

const syntheticIncidents: DcmIncidentRecord[] = [
  {
    id: 'inc-synth-be-01',
    stateCode: 'BE',
    stateName: 'Benue',
    title: 'Synthetic Makurdi Town-Hall Venue Access Restriction',
    summary:
      'Synthetic incident tracking municipal suspension of two opposition town halls in Makurdi and subsequent administrative scheduling response.',
    researchStatusLabel: 'Under Monitoring (Synthetic)',
    firstReportedDate: '2026-11-18',
    linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
    visibility: 'public',
    status: 'published',
    approvalRecord: pubNov19R1.approvalRecord,
    publishedAt: '2026-11-19T17:15:00+01:00',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  },
  {
    id: 'inc-synth-be-private',
    stateCode: 'BE',
    stateName: 'Benue',
    title: 'PRIVATE UNPUBLISHED INCIDENT — MUST NOT APPEAR',
    summary: 'Internal research investigation not approved for publication.',
    researchStatusLabel: 'Internal Draft',
    firstReportedDate: '2026-11-19',
    linkedPublicationIds: ['dcm-daily-2026-11-19'],
    visibility: 'private',
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  }
];

const syntheticDevelopments: DcmIncidentDevelopment[] = [
  {
    id: 'dev-synth-be-01-01',
    incidentId: 'inc-synth-be-01',
    stateCode: 'BE',
    developmentDate: '2026-11-18',
    title: 'Venue access circular issued',
    approvedDescription: 'Synthetic circular suspended scheduled public hall bookings for 19 November.',
    researchStatusLabel: 'Verified',
    isRemedyOrFollowUp: false,
    sourceReferences: [
      {
        sourceName: 'Synthetic Benue Civic Monitor',
        publicationDate: '2026-11-18',
        url: 'https://example.org/synthetic/benue-circular-2026-11-18',
        documentReference: 'SYNTH-DOC-BE-118'
      }
    ],
    linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
    visibility: 'public',
    status: 'published',
    approvalRecord: pubNov19R1.approvalRecord,
    publishedAt: '2026-11-19T17:15:00+01:00',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  },
  {
    id: 'dev-synth-be-01-02',
    incidentId: 'inc-synth-be-01',
    stateCode: 'BE',
    developmentDate: '2026-11-19',
    title: 'Alternative municipal venue dates offered',
    approvedDescription:
      'Synthetic facility board issued written letter offering rescheduled hall access for 23 November 2026.',
    researchStatusLabel: 'Documented Follow-up',
    isRemedyOrFollowUp: true,
    sourceReferences: [
      {
        sourceName: 'Synthetic Makurdi Facility Press Bulletin',
        publicationDate: '2026-11-19',
        documentReference: 'SYNTH-MMFB-2026-44'
      }
    ],
    linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
    visibility: 'public',
    status: 'published',
    approvalRecord: pubNov19R1.approvalRecord,
    publishedAt: '2026-11-19T17:15:00+01:00',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdByUid: 'admin-synth-01',
    updatedByUid: 'admin-synth-01'
  }
];

const allSyntheticPubs = [
  pubNov18,
  pubNov19R1,
  pubNov19R2,
  pubNov20Quiet,
  pubNov21Draft,
  pubNov22ApprovedNotPublished
];

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err?.message || err}`);
  }
}

async function main() {
  console.log('\n=== AEO DCM STAGE 6: EDITORIAL CONTENT EXPORT & HANDOVER VERIFICATION ===\n');

  let sampleNewsletterText = '';
  let sampleClearPathText = '';

  // --------------------------------------------------------------------------
  // TEST 1: Cross-channel canonical parity (Website, Newsletter, ClearPath)
  // --------------------------------------------------------------------------
  await runTest('1. Website, Newsletter (DCW) & ClearPath (On the Map) share exact canonical facts', () => {
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'Benue',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments,
      selectedIncidentId: 'inc-synth-be-01',
      origin: 'https://aeo.athenacentre.org'
    });
    assert.equal(res.ok, true, 'Canonical editorial source should resolve');
    if (!res.ok) return;

    const web = generateWebsiteDailySummaryExtract(res.source);
    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);

    sampleNewsletterText = dcw.plainText;
    sampleClearPathText = cp.plainText;

    // Exact cross-channel parity
    assert.equal(web.structured.publicationId, 'dcm-daily-2026-11-19');
    assert.equal(dcw.structured.publicationId, web.structured.publicationId);
    assert.equal(cp.structured.publicationId, web.structured.publicationId);

    assert.equal(web.structured.assessmentDateIso, '2026-11-19');
    assert.equal(dcw.structured.assessmentDateIso, '2026-11-19');
    assert.equal(cp.structured.assessmentDateIso, '2026-11-19');

    assert.equal(web.structured.selectedState.classification, 'Constrained');
    assert.equal(dcw.structured.currentClassification, 'Constrained');
    assert.equal(cp.structured.approvedClassification.label, 'Constrained');

    assert.equal(dcw.structured.previousClassification, 'Emerging concern');
    assert.equal(cp.structured.approvedClassification.previousClassification, 'Emerging concern');

    assert.equal(dcw.structured.approvedRationale, web.structured.selectedState.approvedRationale);
    assert.equal(cp.structured.whyClassificationChangedOrStayedTheSame, web.structured.selectedState.approvedRationale);

    assert.equal(dcw.structured.sourceApprovalReference, 'SYNTH-RES-2026-11-19-R1');
    assert.equal(cp.structured.sourceApprovalReference, 'SYNTH-RES-2026-11-19-R1');

    // Verify ClearPath sections populated from approved records
    assert.ok(cp.structured.whatAeoVerified.includes('Synthetic Municipal Venue Restriction Circular'));
    assert.ok(cp.structured.disputedClaims.includes('6 hours before the event'));
    assert.ok(cp.structured.institutionalResponse.includes('Synthetic Makurdi Municipal Facility Board'));
    assert.ok(cp.structured.verifiedRemedyOrSubsequentDevelopment.includes('Alternative municipal venue dates offered'));
    assert.ok(dcw.structured.practicalEffectOnPoliticalCompetitiveness.includes('delayed access to public town-hall venues'));
  });

  // --------------------------------------------------------------------------
  // TEST 2: Map colour, colour name & canonical code parity across all 37 states
  // --------------------------------------------------------------------------
  await runTest('2. Exported classifications, colours & codes match canonical DCM map palette for all 37 jurisdictions', () => {
    const mapView = buildCanonicalPublicationView(pubNov19R1);
    assert.equal(mapView.stateList.length, 37);

    for (const j of NIGERIA_37_JURISDICTIONS) {
      const res = buildCanonicalEditorialSource({
        selectedPublication: pubNov19R1,
        allPublications: allSyntheticPubs,
        stateIdentifier: j.code,
        evidenceRecords: syntheticEvidence,
        incidentRecords: syntheticIncidents,
        developmentRecords: syntheticDevelopments
      });
      assert.equal(res.ok, true, `Expected valid editorial source for ${j.name}`);
      if (!res.ok) continue;

      const mapState = mapView.statesByCode[j.code];
      assert.equal(res.source.currentClassification, mapState.classification);
      assert.equal(res.source.currentClassificationCode, mapState.code);
      assert.equal(res.source.currentClassificationHex, mapState.hex);
      assert.equal(res.source.currentClassificationHex, DCM_CANONICAL_PALETTE[mapState.code].hex);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 3: Permanent state link resolves to exact historical state + publication
  // --------------------------------------------------------------------------
  await runTest('3. Permanent state link in Newsletter & ClearPath resolves to exact state & historical edition', () => {
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments,
      origin: 'https://aeo.athenacentre.org'
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);

    assert.equal(
      dcw.structured.permanentStateAssessmentUrl,
      'https://aeo.athenacentre.org/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19'
    );
    assert.equal(cp.structured.permanentStateAssessmentUrl, dcw.structured.permanentStateAssessmentUrl);

    const parsedUrl = new URL(dcw.structured.permanentStateAssessmentUrl);
    const publicAsc = resolvePublicDcmPublications(allSyntheticPubs);
    const resolved = resolveDcmPermalink(publicAsc, parsedUrl.search);

    assert.equal(resolved.activePublication?.id, 'dcm-daily-2026-11-19', 'Must open exact R1 edition, not R2 or Nov 20 latest');
    assert.equal(resolved.selectedStateName, 'Benue');
    assert.equal(resolved.isPermalinkLocked, true);
    assert.equal(resolved.noticeTone, 'none');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Strict draft / unapproved / private data exclusion
  // --------------------------------------------------------------------------
  await runTest('4. Draft publications, approved-unpublished editions & private/unverified leads are strictly excluded', () => {
    const draftAttempt = buildCanonicalEditorialSource({
      selectedPublication: pubNov21Draft,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(draftAttempt.ok, false, 'Draft edition must be rejected');

    const approvedUnpubAttempt = buildCanonicalEditorialSource({
      selectedPublication: pubNov22ApprovedNotPublished,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(approvedUnpubAttempt.ok, false, 'Approved-but-unpublished edition must be rejected');

    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);
    const combinedOutput = [
      dcw.plainText,
      dcw.jsonString,
      dcw.html,
      cp.plainText,
      cp.jsonString,
      cp.html
    ].join('\n');

    assert.equal(combinedOutput.includes('PRIVATE CONFIDENTIAL LEAD'), false);
    assert.equal(combinedOutput.includes('0800-SECRET'), false);
    assert.equal(combinedOutput.includes('PRIVATE UNPUBLISHED INCIDENT'), false);
    assert.equal(combinedOutput.includes('CONFIDENTIAL DRAFT SUMMARY'), false);
    assert.equal(combinedOutput.includes('UNPUBLISHED DRAFT FINDING'), false);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Missing optional Research fields display exact non-fabricated notice
  // --------------------------------------------------------------------------
  await runTest('5. Missing optional Research fields render "Not supplied in the approved record" verbatim', () => {
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'LA',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);

    assert.equal(dcw.structured.practicalEffectOnPoliticalCompetitiveness, NOT_SUPPLIED_LABEL);
    assert.equal(cp.structured.whatAeoVerified, NOT_SUPPLIED_LABEL);
    assert.equal(cp.structured.disputedClaims, NOT_SUPPLIED_LABEL);
    assert.equal(cp.structured.verifiedRemedyOrSubsequentDevelopment, NOT_SUPPLIED_LABEL);
    assert.ok(dcw.plainText.includes(NOT_SUPPLIED_LABEL));
    assert.ok(cp.plainText.includes(NOT_SUPPLIED_LABEL));
  });

  // --------------------------------------------------------------------------
  // TEST 6: Correction revisions (r1 vs r2) & immutable handover preservation
  // --------------------------------------------------------------------------
  await runTest('6. Correction revisions (r1 vs r2) carry explicit correction notices & preserve historical handovers', () => {
    const resR1 = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    const resR2 = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R2,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(resR1.ok, true);
    assert.equal(resR2.ok, true);
    if (!resR1.ok || !resR2.ok) return;

    const dcwR1 = generateNewsletterDcwExtract(resR1.source);
    const dcwR2 = generateNewsletterDcwExtract(resR2.source);

    // R1 knows it was later superseded by R2, while keeping R1's exact permalink
    assert.equal(resR1.source.correction.hasSubsequentCorrection, true);
    assert.equal(resR1.source.correction.latestCorrectionId, 'dcm-daily-2026-11-19-r2');
    assert.ok(dcwR1.structured.permanentStateAssessmentUrl.endsWith('publication=dcm-daily-2026-11-19'));
    assert.ok(dcwR1.plainText.includes(EDITORIAL_CORRECTION_NOTICE_LABEL));

    // R2 knows it supersedes R1 and carries R2's exact permalink & revision note
    assert.equal(resR2.source.correction.isCorrectedVersion, true);
    assert.equal(resR2.source.correction.revisionNumber, 2);
    assert.equal(resR2.source.correction.supersedesPublicationId, 'dcm-daily-2026-11-19');
    assert.ok(dcwR2.structured.permanentStateAssessmentUrl.endsWith('publication=dcm-daily-2026-11-19-r2'));
    assert.ok(dcwR2.plainText.includes('Corrected synthetic source publication date typo'));

    // Recording a handover from R1 freezes R1's immutable snapshot
    const handoverR1 = buildEditorialHandoverRecord({
      source: resR1.source,
      exportType: 'newsletter-dcw',
      exportedText: dcwR1.plainText,
      approvedPlainText: dcwR1.plainText,
      structuredExtract: dcwR1.structured,
      preparedByUid: 'admin-synth-01',
      preparedByName: 'Synthetic Editor',
      handoverStatus: 'handed-over',
      recipientTeam: 'AEO Daily Newsletter Desk'
    });
    assert.equal(handoverR1.publicationId, 'dcm-daily-2026-11-19');
    assert.equal(handoverR1.sourceApprovalReference, 'SYNTH-RES-2026-11-19-R1');
    const snap = JSON.parse(handoverR1.snapshotPayload);
    assert.equal(snap.publicationId, 'dcm-daily-2026-11-19');
  });

  // --------------------------------------------------------------------------
  // TEST 7: Quiet-day exports remain accurate & non-fabricated
  // --------------------------------------------------------------------------
  await runTest('7. Quiet-day updates export cleanly with carry-forward status and no fabricated developments', () => {
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov20Quiet,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);

    assert.equal(dcw.structured.isQuietDay, true);
    assert.equal(dcw.structured.classificationChanged, false);
    assert.ok(dcw.structured.classificationChangeStatus.includes('Quiet-day update'));
    assert.ok(dcw.structured.approvedDevelopmentSummary.includes('all 37 jurisdictions carried forward unchanged'));
    assert.equal(dcw.structured.practicalEffectOnPoliticalCompetitiveness, NOT_SUPPLIED_LABEL);
    assert.ok(cp.structured.whyClassificationChangedOrStayedTheSame.includes('carried forward'));
  });

  // --------------------------------------------------------------------------
  // TEST 8: Historical newsletter links remain stable after newer editions arrive
  // --------------------------------------------------------------------------
  await runTest('8. Historical newsletter link remains stable after newer daily editions are published', () => {
    const newerDecPubs = ['2026-12-01', '2026-12-02', '2026-12-03'].map((d) =>
      makeDailyPub({
        id: `dcm-daily-${d}`,
        dateIso: d,
        status: 'published',
        overrides: {
          BE: { classification: 'Open', keyFinding: `Later December synthetic update (${d})` }
        }
      })
    );

    const expandedArchive = resolvePublicDcmPublications([...allSyntheticPubs, ...newerDecPubs]);
    assert.equal(expandedArchive[expandedArchive.length - 1].id, 'dcm-daily-2026-12-03');

    const historicalLink =
      '?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19';
    const resolved = resolveDcmPermalink(expandedArchive, historicalLink);

    assert.equal(resolved.activePublication?.id, 'dcm-daily-2026-11-19');
    assert.equal(resolved.activePublication?.classifications['BE'].classification, 'Constrained');
    assert.equal(resolved.selectedStateName, 'Benue');
    assert.equal(resolved.isPermalinkLocked, true);
  });

  // --------------------------------------------------------------------------
  // TEST 9: >60 archived daily records chronological ordering & Firestore query hardening
  // --------------------------------------------------------------------------
  await runTest('9. >60 archived daily records (95 days) return newest 60 first & Firestore queries enforce orderBy + index fallback', () => {
    // Generate 95 consecutive synthetic daily publications (2026-08-01 through 2026-11-03) + 5 drafts
    const startUtc = Date.UTC(2026, 7, 1); // 2026-08-01
    const ninetyFivePublished: DcmPublication[] = [];
    for (let i = 0; i < 95; i++) {
      const dt = new Date(startUtc + i * 24 * 60 * 60 * 1000);
      const iso = dt.toISOString().slice(0, 10);
      ninetyFivePublished.push(
        makeDailyPub({
          id: `dcm-daily-${iso}`,
          dateIso: iso,
          status: 'published'
        })
      );
    }
    const fiveDrafts = [1, 2, 3, 4, 5].map((n) =>
      makeDailyPub({
        id: `dcm-daily-2026-11-1${n}-draft`,
        dateIso: `2026-11-1${n}`,
        status: 'draft'
      })
    );

    // Deliberately pass in ascending document-ID order (worst case for unordered limit(60))
    const page1 = selectLatestDailyWindow([...ninetyFivePublished, ...fiveDrafts], { pageSize: 60 });
    assert.equal(page1.items.length, 60);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.totalPublishedDailyCount, 95);
    assert.equal(page1.items[0].assessmentDate, '2026-11-03', 'Newest daily edition MUST be first');
    assert.equal(page1.items[59].assessmentDate, '2026-09-05', '60th newest edition must end page 1');
    assert.equal(page1.items.every((p) => p.status === 'published'), true, 'Drafts never enter public window');

    // Paginate page 2 using cursor & excludeIds
    const page1Ids = new Set(page1.items.map((p) => p.id));
    const page2 = selectLatestDailyWindow([...ninetyFivePublished, ...fiveDrafts], {
      pageSize: 60,
      beforeAssessmentDate: page1.nextCursorDate || undefined,
      excludeIds: page1Ids
    });
    assert.equal(page2.items.length, 35, 'Remaining 35 older daily editions paginate cleanly');
    assert.equal(page2.hasMore, false);
    assert.equal(page2.items[0].assessmentDate, '2026-09-04');
    assert.equal(page2.items[34].assessmentDate, '2026-08-01');

    // Static verification of hardened Firestore queries in CMSContext.tsx & firestore.indexes.json
    const cmsSource = fs.readFileSync(path.resolve('src/context/CMSContext.tsx'), 'utf-8');
    assert.ok(
      cmsSource.includes("orderBy('assessmentDate', 'desc')"),
      'CMSContext public daily query must enforce orderBy(assessmentDate, desc)'
    );
    assert.ok(
      cmsSource.includes("err?.code === 'failed-precondition'"),
      'CMSContext must detect missing composite index (failed-precondition) gracefully'
    );
    assert.ok(
      cmsSource.includes('startAfter(cleanCursor)'),
      'CMSContext must support cursor pagination via loadOlderDailyPublications'
    );
    assert.ok(
      cmsSource.includes("orderBy(orderField, 'desc')"),
      'Public evidence/incident/development listeners must order chronologically descending'
    );

    const indexesJson = JSON.parse(fs.readFileSync(path.resolve('firestore.indexes.json'), 'utf-8'));
    assert.equal(indexesJson.indexes.length, REQUIRED_STAGE_6_COMPOSITE_INDEXES.length);
    const hasDailyIndex = indexesJson.indexes.some(
      (idx: any) =>
        idx.collectionGroup === 'dcm_daily_publications' &&
        idx.fields.length === 2 &&
        idx.fields[0].fieldPath === 'status' &&
        idx.fields[1].fieldPath === 'assessmentDate' &&
        idx.fields[1].order === 'DESCENDING'
    );
    assert.equal(hasDailyIndex, true, 'firestore.indexes.json must declare (status ASC, assessmentDate DESC)');
  });

  // --------------------------------------------------------------------------
  // TEST 10: SSR render of DcmEditorialPublishingView + XSS-safe HTML/JSON exports
  // --------------------------------------------------------------------------
  await runTest('10. DcmEditorialPublishingView renders cleanly, excludes drafts, enforces manual state selection & XSS-safe HTML', () => {
    // 10a: Initial state without manual state selected — never auto-selects a featured state
    const htmlNoState = renderToStaticMarkup(
      React.createElement(DcmEditorialPublishingView, {
        allPublications: allSyntheticPubs,
        evidenceRecords: syntheticEvidence,
        incidentRecords: syntheticIncidents,
        developmentRecords: syntheticDevelopments,
        handovers: [],
        onSaveHandover: async (r) => r,
        onUpdateHandoverStatus: async () => {
          throw new Error('noop');
        },
        currentUser: { uid: 'admin-synth-01', displayName: 'Synthetic Editor', email: 'editor@example.org' }
      })
    );
    assert.ok(htmlNoState.includes('DCM Editorial Publishing'));
    assert.ok(htmlNoState.includes('— Select a state manually —'));
    assert.ok(htmlNoState.includes('2 draft/unapproved excluded'));
    assert.equal(htmlNoState.includes('dcm-daily-2026-11-21-draft'), false, 'Draft pub ID must not appear in selector');
    assert.equal(htmlNoState.includes('dcm-daily-2026-11-22-approved'), false, 'Approved-unpublished ID must not appear');

    // 10b: Selected published edition + state renders all 3 template buttons, export buttons & touch targets
    const htmlWithState = renderToStaticMarkup(
      React.createElement(DcmEditorialPublishingView, {
        allPublications: allSyntheticPubs,
        evidenceRecords: syntheticEvidence,
        incidentRecords: syntheticIncidents,
        developmentRecords: syntheticDevelopments,
        handovers: [],
        onSaveHandover: async (r) => r,
        onUpdateHandoverStatus: async () => {
          throw new Error('noop');
        },
        currentUser: { uid: 'admin-synth-01', displayName: 'Synthetic Editor', email: 'editor@example.org' },
        initialPublicationId: 'dcm-daily-2026-11-19',
        initialStateCode: 'BE',
        initialExportType: 'clearpath-on-the-map'
      })
    );
    assert.ok(htmlWithState.includes('Democratic Competitiveness Watch'));
    assert.ok(htmlWithState.includes('ClearPath: On the Map'));
    assert.ok(htmlWithState.includes('Website Daily Summary'));
    assert.ok(htmlWithState.includes('Copy formatted text'));
    assert.ok(htmlWithState.includes('Copy permanent state link'));
    assert.ok(htmlWithState.includes('Export structured JSON'));
    assert.ok(htmlWithState.includes('Export clean HTML'));
    assert.ok(htmlWithState.includes('min-h-[44px]'));
    assert.ok(htmlWithState.includes('Handover ≠ New Research Approval'));

    // 10c: HTML export escapes <script> payload safely & JSON export is valid JSON
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const cp = generateClearPathOnTheMapExtract(res.source);
    assert.equal(cp.html.includes('<script>alert(1)</script>'), false, 'Raw script tag must be escaped in HTML export');
    assert.ok(cp.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Escaped script tag preserved as text');
    const parsedJson = JSON.parse(cp.jsonString);
    assert.equal(parsedJson.template, 'On the Map');
    assert.equal(parsedJson.publicationId, 'dcm-daily-2026-11-19');
  });

  // --------------------------------------------------------------------------
  // TEST 11: Editorial draft edit distinction & handover validation governance
  // --------------------------------------------------------------------------
  await runTest('11. Editorial draft edits are explicitly flagged & handover validation blocks non-admins / drafts / UID spoofing', () => {
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubNov19R1,
      allPublications: allSyntheticPubs,
      stateIdentifier: 'BE',
      evidenceRecords: syntheticEvidence,
      incidentRecords: syntheticIncidents,
      developmentRecords: syntheticDevelopments
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const dcw = generateNewsletterDcwExtract(res.source);

    const unmodified = buildEditorialHandoverRecord({
      source: res.source,
      exportType: 'newsletter-dcw',
      exportedText: dcw.plainText,
      approvedPlainText: dcw.plainText,
      structuredExtract: dcw.structured,
      preparedByUid: 'admin-synth-01',
      preparedByName: 'Synthetic Editor'
    });
    assert.equal(unmodified.hasEditorialDraftEdits, false);
    assert.equal(unmodified.governanceNotice, EDITORIAL_HANDOVER_GOVERNANCE_NOTICE);
    assert.ok(unmodified.exportedAtWatLabel.includes('WAT'));

    const edited = buildEditorialHandoverRecord({
      source: res.source,
      exportType: 'newsletter-dcw',
      exportedText: `${dcw.plainText}\n\n[Editorial Desk Note: Lead item for Tuesday newsletter]`,
      approvedPlainText: dcw.plainText,
      structuredExtract: dcw.structured,
      preparedByUid: 'admin-synth-01',
      preparedByName: 'Synthetic Editor'
    });
    assert.equal(edited.hasEditorialDraftEdits, true);

    assert.equal(
      validateEditorialHandoverRecord(edited, {
        isAuthorizedAdmin: true,
        actorUid: 'admin-synth-01',
        sourcePublicationStatus: 'published'
      }).valid,
      true
    );
    assert.equal(
      validateEditorialHandoverRecord(edited, {
        isAuthorizedAdmin: false,
        actorUid: 'public-user',
        sourcePublicationStatus: 'published'
      }).valid,
      false,
      'Non-admin must be denied'
    );
    assert.equal(
      validateEditorialHandoverRecord(edited, {
        isAuthorizedAdmin: true,
        actorUid: 'different-admin-uid',
        sourcePublicationStatus: 'published'
      }).valid,
      false,
      'Spoofed preparedByUid must be rejected'
    );
    assert.equal(
      validateEditorialHandoverRecord(edited, {
        isAuthorizedAdmin: true,
        actorUid: 'admin-synth-01',
        sourcePublicationStatus: 'draft'
      }).valid,
      false,
      'Handover referencing non-published source must be rejected'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 12: Direct firestore.rules & firebase-blueprint.json security checks
  // --------------------------------------------------------------------------
  await runTest('12. firestore.rules & firebase-blueprint.json enforce admin-only immutable handover audit rules', () => {
    const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
    const blueprint = JSON.parse(fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf-8'));

    assert.ok(rules.includes('function isValidDcmEditorialHandover(data)'));
    assert.ok(rules.includes('match /dcm_editorial_handovers/{handoverId}'));

    const matchStart = rules.indexOf('match /dcm_editorial_handovers/{handoverId}');
    const matchEnd = rules.indexOf('match /subscribers/{subscriberId}', matchStart);
    const matchBlock = rules.slice(matchStart, matchEnd);

    assert.ok(matchBlock.includes('allow get, list: if isAuthorizedAdmin();'), 'Public reads must be denied');
    assert.ok(matchBlock.includes('incoming().preparedByUid == request.auth.uid'), 'Create must pin preparedByUid');
    assert.ok(matchBlock.includes('incoming().snapshotPayload == existing().snapshotPayload'), 'Update must keep snapshot immutable');
    assert.ok(matchBlock.includes('incoming().sourceApprovalReference == existing().sourceApprovalReference'), 'Update must keep sourceApprovalReference immutable');
    assert.ok(matchBlock.includes('allow delete: if false;'), 'Delete must be denied to preserve audit trail');

    assert.ok(blueprint.entities.dcmEditorialHandover, 'Blueprint must define dcmEditorialHandover entity');
    assert.ok(
      blueprint.firestore['/dcm_editorial_handovers/{handoverId}'],
      'Blueprint must map /dcm_editorial_handovers/{handoverId}'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 13: Microsoft Graph DCM Brief continuity & approved initial data untouched
  // --------------------------------------------------------------------------
  await runTest('13. Microsoft Graph /api/dcm-brief-request continuity & approved initial DCM data unchanged', async () => {
    // Verify approved initial fallback data remains completely unmodified
    const octPub = INITIAL_DCM_PUBLICATIONS.find((p) => p.id === 'dcm-2026-10-15');
    const baselinePub = INITIAL_DCM_PUBLICATIONS.find((p) => p.id === 'dcm-2026-09-30');
    assert.ok(octPub, 'dcm-2026-10-15 must still exist');
    assert.equal(octPub?.status, 'published', 'October publication remains published');
    assert.equal(Object.keys(octPub?.classifications || {}).length, 37);
    assert.ok(baselinePub, 'dcm-2026-09-30 baseline must still exist');
    assert.equal(baselinePub?.status, 'published', 'Baseline publication remains published');
    assert.equal(Object.keys(baselinePub?.classifications || {}).length, 37);

    // Live local API check (non-sending validation request)
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert.equal(healthRes.status, 200, 'Dev server /api/health must return 200');

    const briefRes = await fetch('http://localhost:3000/api/dcm-brief-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.ok(
      briefRes.status === 400 || briefRes.status === 429,
      `/api/dcm-brief-request route must remain operational (expected HTTP 400 validation or 429 rate-limit, got ${briefRes.status})`
    );
    const briefJson = await briefRes.json();
    assert.equal(typeof briefJson.error, 'string', '/api/dcm-brief-request must return structured JSON error');
  });

  console.log(`\nStage 6 Summary: ${passed}/${passed + failed} passed, ${failed} failed.\n`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log('--- SYNTHETIC NEWSLETTER EXAMPLE (Democratic Competitiveness Watch) ---');
  console.log(sampleNewsletterText);
  console.log('\n--- SYNTHETIC CLEARPATH EXAMPLE (On the Map) ---');
  console.log(sampleClearPathText);
  console.log('-----------------------------------------------------------------------\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
