/**
 * AEO DCM Corrections — Stage 3: Public Evidence and Incident History
 * Comprehensive 12-Test Automated Verification Suite
 *
 * Uses purely synthetic in-memory fixtures. NEVER writes to live Production Firestore.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPrivateNoteRecord,
  DcmPublication
} from '../src/types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../src/data/dcmInitialData';
import {
  buildCanonicalPublicationView,
  DCM_CANONICAL_PALETTE,
  resolvePublicDcmPublications,
  resolveSelectedPublication
} from '../src/utils/dcmConsistency';
import { createDailyDraft } from '../src/utils/dcmDaily';
import {
  createDevelopmentCorrectionDraft,
  createEvidenceCorrectionDraft,
  createIncidentCorrectionDraft,
  isPubliclyDisplayableDevelopment,
  isPubliclyDisplayableEvidence,
  isPubliclyDisplayableIncident,
  resolveStateAssessmentPanelData,
  sanitizeExternalUrl,
  validateEvidenceRecord,
  validateIncidentDevelopment,
  validateIncidentRecord,
  validatePrivateNoteRecord
} from '../src/utils/dcmEvidence';
import {
  evaluateFirestoreRequest,
  parseFirestoreRules
} from './firestoreRulesEvaluator';

const ADMIN_UID = 'stage3-test-admin-uid';
const OTHER_UID = 'stage3-other-user-uid';
const SUSPENDED_UID = 'stage3-suspended-admin-uid';

function makeApproval(ref: string, uid = ADMIN_UID) {
  return {
    approved: true,
    approvalReference: ref,
    approvedByName: 'AEO Research Desk',
    approvedAt: '2026-11-19T12:00:00.000Z',
    recordedByUid: uid,
    recordedByEmail: 'admin@athenacentre.org',
    recordedAt: '2026-11-19T12:05:00.000Z',
    approvedByUid: uid,
    approvedByEmail: 'admin@athenacentre.org',
    verificationMode: 'admin-recorded-reference' as const
  };
}

function buildSyntheticPublications(): DcmPublication[] {
  const baseline = INITIAL_DCM_PUBLICATIONS[0];
  const oct15 = INITIAL_DCM_PUBLICATIONS[1];
  const dailyNov19: DcmPublication = {
    ...createDailyDraft({
      assessmentDate: '2026-11-19',
      cutoffTimeWat: '17:00',
      sourcePub: oct15,
      existingIds: [baseline.id, oct15.id],
      isQuietDay: false,
      createdByUid: ADMIN_UID
    }),
    status: 'published',
    isLatest: true,
    publishedAt: '2026-11-19T16:15:00.000Z',
    summary: 'Synthetic Stage 3 daily test publication for local verification.',
    approvalRecord: makeApproval('AEO-RES-2026-11-19-PUB')
  };
  return [baseline, oct15, dailyNov19];
}

function makeTestEvidence(overrides: Partial<DcmEvidenceRecord> = {}): DcmEvidenceRecord {
  return {
    id: 'ev-la-2026-11-19-01',
    stateCode: 'LA',
    stateName: 'Lagos',
    incidentId: 'inc-la-2026-11-19-01',
    linkedPublicationIds: ['dcm-daily-2026-11-19'],
    title: 'Synthetic test evidence — venue access correspondence',
    publicDescription: 'Synthetic Research-approved summary of venue access correspondence reviewed prior to cut-off.',
    sourceName: 'Synthetic Public Registry',
    sourcePublicationDate: '2026-11-18',
    sourceUrl: 'https://example.org/synthetic-source/2026-11-18',
    documentReference: 'AEO-SYN-DOC-001',
    verificationStatus: 'Verified by Research',
    isDisputed: false,
    visibility: 'public',
    status: 'published',
    approvalRecord: makeApproval('AEO-RES-2026-11-19-EV01'),
    revisionNumber: 1,
    publishedAt: '2026-11-19T16:10:00.000Z',
    createdAt: 1795000000000,
    updatedAt: 1795000000000,
    createdByUid: ADMIN_UID,
    updatedByUid: ADMIN_UID,
    ...overrides
  };
}

function makeTestIncident(overrides: Partial<DcmIncidentRecord> = {}): DcmIncidentRecord {
  return {
    id: 'inc-la-2026-11-19-01',
    stateCode: 'LA',
    stateName: 'Lagos',
    title: 'Synthetic public venue access timeline',
    summary: 'Synthetic multi-day venue access incident used to verify chronological developments under one Incident ID.',
    researchStatusLabel: 'Monitored by Research — developments logged',
    firstReportedDate: '2026-11-16',
    linkedPublicationIds: ['dcm-daily-2026-11-19'],
    visibility: 'public',
    status: 'published',
    approvalRecord: makeApproval('AEO-RES-2026-11-19-INC01'),
    revisionNumber: 1,
    publishedAt: '2026-11-19T16:10:00.000Z',
    createdAt: 1795000000000,
    updatedAt: 1795000000000,
    createdByUid: ADMIN_UID,
    updatedByUid: ADMIN_UID,
    ...overrides
  };
}

function makeTestDevelopment(overrides: Partial<DcmIncidentDevelopment> = {}): DcmIncidentDevelopment {
  return {
    id: 'dev-inc-la-2026-11-19-01-01',
    incidentId: 'inc-la-2026-11-19-01',
    stateCode: 'LA',
    developmentDate: '2026-11-16',
    title: 'Monday: Venue access denied',
    approvedDescription: 'Synthetic Monday entry: venue management declined use of public civic hall.',
    researchStatusLabel: 'Initial report logged by Research',
    isRemedyOrFollowUp: false,
    sourceReferences: [
      {
        sourceName: 'Synthetic Daily Bulletin',
        publicationDate: '2026-11-16',
        url: 'https://example.org/synthetic-mon',
        documentReference: 'SYN-MON-01'
      }
    ],
    linkedPublicationIds: ['dcm-daily-2026-11-19'],
    visibility: 'public',
    status: 'published',
    approvalRecord: makeApproval('AEO-RES-2026-11-19-DEV01'),
    revisionNumber: 1,
    publishedAt: '2026-11-19T16:10:00.000Z',
    createdAt: 1795000001000,
    updatedAt: 1795000001000,
    createdByUid: ADMIN_UID,
    updatedByUid: ADMIN_UID,
    ...overrides
  };
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}`);
      console.error(`         ${err?.message || err}`);
    }
  }

  console.log('\n=== AEO DCM STAGE 3: PUBLIC EVIDENCE & INCIDENT HISTORY VERIFICATION ===\n');

  const pubs = buildSyntheticPublications();
  const [baselinePub, oct15Pub, dailyNov19Pub] = pubs;

  // -------------------------------------------------------------------------
  // TEST 1: Selecting a state displays its approved public evidence (Sections A–E)
  // -------------------------------------------------------------------------
  await test('Test 1: Selecting a state displays approved public evidence across Sections A–E', () => {
    const ev1 = makeTestEvidence({
      isDisputed: true,
      disputedClaimNote: 'Municipal authority disputes timeline of booking request.'
    });
    const inc1 = makeTestIncident();
    const dev1 = makeTestDevelopment();

    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Lagos',
      evidenceRecords: [ev1],
      incidentRecords: [inc1],
      developmentRecords: [dev1]
    });

    assert.equal(panel.stateCode, 'LA');
    assert.equal(panel.stateName, 'Lagos');
    assert.equal(panel.currentView.classification, dailyNov19Pub.classifications.LA.classification);
    assert.equal(panel.previousView?.classification, oct15Pub.classifications.LA.classification);
    assert.equal(panel.supportingEvidence.length, 1);
    assert.equal(panel.supportingEvidence[0].id, ev1.id);
    assert.equal(panel.supportingEvidence[0].verificationStatus, 'Verified by Research');
    assert.equal(panel.supportingEvidence[0].isDisputed, true);
    assert.match(panel.supportingEvidence[0].disputedClaimNote, /disputes timeline/i);
    assert.equal(panel.incidents.length, 1);
    assert.equal(panel.historicalEditions.length, 3);
  });

  // -------------------------------------------------------------------------
  // TEST 2: Dated source links open correct URL; unsafe URLs strictly blocked
  // -------------------------------------------------------------------------
  await test('Test 2: Dated source URLs validated; javascript:, data:, file: and malformed URLs blocked', () => {
    const validHttps = sanitizeExternalUrl('https://example.org/report?id=42');
    assert.equal(validHttps.valid, true);
    assert.equal(validHttps.sanitizedUrl, 'https://example.org/report?id=42');

    const validHttp = sanitizeExternalUrl('http://archive.example.ng/doc.pdf');
    assert.equal(validHttp.valid, true);

    const blockedUrls = [
      'javascript:alert(1)',
      'JAVASCRIPT:void(0)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'not-a-valid-url',
      'https://localhost/internal'
    ];
    for (const bad of blockedUrls) {
      const res = sanitizeExternalUrl(bad);
      assert.equal(res.valid, false, `Expected unsafe URL to be blocked: ${bad}`);
      assert.equal(res.sanitizedUrl, null);
    }

    // Validator also blocks unsafe URL on evidence records
    const badEv = makeTestEvidence({
      status: 'draft',
      sourceUrl: 'javascript:alert(document.cookie)'
    });
    const evValidation = validateEvidenceRecord(badEv, {
      isAuthorizedAdmin: true,
      actorUid: ADMIN_UID
    });
    assert.equal(evValidation.valid, false);
    assert.ok(evValidation.errors.some((e) => /unsafe url protocol/i.test(e)));
  });

  // -------------------------------------------------------------------------
  // TEST 3: Multiple chronological developments stay grouped under ONE Incident ID
  // -------------------------------------------------------------------------
  await test('Test 3: Monday/Tuesday/Wednesday developments stay grouped under one Incident ID with verbatim Research statuses', () => {
    const inc = makeTestIncident({
      id: 'inc-la-venue-01',
      researchStatusLabel: 'Ongoing Research review'
    });
    const devWed = makeTestDevelopment({
      id: 'dev-wed',
      incidentId: 'inc-la-venue-01',
      developmentDate: '2026-11-18',
      title: 'Wednesday: Rally held',
      approvedDescription: 'Synthetic Wednesday entry: campaign rally took place at the civic hall.',
      researchStatusLabel: 'Observed — Research review pending',
      isRemedyOrFollowUp: true
    });
    const devMon = makeTestDevelopment({
      id: 'dev-mon',
      incidentId: 'inc-la-venue-01',
      developmentDate: '2026-11-16',
      title: 'Monday: Venue access denied',
      researchStatusLabel: 'Reported restriction'
    });
    const devTue = makeTestDevelopment({
      id: 'dev-tue',
      incidentId: 'inc-la-venue-01',
      developmentDate: '2026-11-17',
      title: 'Tuesday: Approval restored',
      approvedDescription: 'Synthetic Tuesday entry: venue authority reinstated hall booking.',
      researchStatusLabel: 'Remedy communicated by authority',
      isRemedyOrFollowUp: true
    });

    // Pass developments deliberately out of order to verify chronological sorting
    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'LA',
      evidenceRecords: [],
      incidentRecords: [inc],
      developmentRecords: [devWed, devMon, devTue]
    });

    assert.equal(panel.incidents.length, 1);
    assert.equal(panel.incidents[0].id, 'inc-la-venue-01');
    assert.equal(panel.incidents[0].researchStatusLabel, 'Ongoing Research review');
    assert.equal(panel.incidents[0].developments.length, 3);
    assert.deepEqual(
      panel.incidents[0].developments.map((d) => d.title),
      ['Monday: Venue access denied', 'Tuesday: Approval restored', 'Wednesday: Rally held']
    );
    // Verbatim Research status preserved (never overwritten to "Resolved" or "Verified")
    assert.equal(panel.incidents[0].developments[2].researchStatusLabel, 'Observed — Research review pending');
    assert.equal(panel.incidents[0].developments[1].isRemedyOrFollowUp, true);
  });

  // -------------------------------------------------------------------------
  // TEST 4: Adding/publishing an incident development does NOT auto-change map classification/colour
  // -------------------------------------------------------------------------
  await test('Test 4: Adding/publishing an incident or remedy development NEVER automatically changes state map colour', () => {
    const beforeView = buildCanonicalPublicationView(dailyNov19Pub);
    const beforeLagosCode = beforeView.statesByCode.LA.code;
    const beforeLagosHex = beforeView.statesByCode.LA.hex;
    const beforeLagosClass = beforeView.statesByCode.LA.classification;

    const inc = makeTestIncident();
    const remedyDev = makeTestDevelopment({
      id: 'dev-remedy',
      developmentDate: '2026-11-18',
      title: 'Wednesday: Rally held after venue access restored',
      isRemedyOrFollowUp: true
    });

    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Lagos',
      evidenceRecords: [],
      incidentRecords: [inc],
      developmentRecords: [remedyDev]
    });

    const afterView = buildCanonicalPublicationView(dailyNov19Pub);
    assert.equal(panel.currentView.code, beforeLagosCode);
    assert.equal(panel.currentView.hex, beforeLagosHex);
    assert.equal(panel.currentView.classification, beforeLagosClass);
    assert.equal(afterView.statesByCode.LA.hex, beforeLagosHex);
    assert.equal(afterView.statesByCode.LA.classification, beforeLagosClass);
  });

  // -------------------------------------------------------------------------
  // TEST 5: Approved institutional responses display accurately
  // -------------------------------------------------------------------------
  await test('Test 5: Approved institutional responses (requested, received, dates, respondent, summary) display accurately', () => {
    const evWithResp = makeTestEvidence({
      institutionalResponse: {
        requested: true,
        requestedDate: '2026-11-16',
        received: true,
        responseDate: '2026-11-18',
        respondentName: 'Synthetic Municipal Venue Authority',
        publicSummary: 'Authority confirmed the initial booking conflict was administrative and issued revised access.'
      }
    });

    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Lagos',
      evidenceRecords: [evWithResp],
      incidentRecords: [],
      developmentRecords: []
    });

    assert.equal(panel.institutionalResponse.hasAnyResponseData, true);
    assert.equal(panel.institutionalResponse.requested, true);
    assert.equal(panel.institutionalResponse.requestedDateDisplay, '16 Nov 2026');
    assert.equal(panel.institutionalResponse.received, true);
    assert.equal(panel.institutionalResponse.responseDateDisplay, '18 Nov 2026');
    assert.equal(panel.institutionalResponse.responses.length, 1);
    assert.equal(panel.institutionalResponse.responses[0].respondentName, 'Synthetic Municipal Venue Authority');
    assert.match(panel.institutionalResponse.responses[0].publicSummary, /revised access/i);
  });

  // -------------------------------------------------------------------------
  // TEST 6: Unverified leads, private evidence, drafts, approved-unpublished, confidential notes NEVER appear publicly
  // -------------------------------------------------------------------------
  await test('Test 6: Unverified leads, private items, drafts, approved-unpublished records, and confidential notes NEVER appear publicly', () => {
    const draftPublicEv = makeTestEvidence({ id: 'ev-draft', status: 'draft', visibility: 'public' });
    const approvedPublicEv = makeTestEvidence({ id: 'ev-approved', status: 'approved', visibility: 'public' });
    const publishedPrivateEv = makeTestEvidence({ id: 'ev-private', status: 'published', visibility: 'private' });
    const unverifiedLeadEv = makeTestEvidence({
      id: 'ev-unverified',
      verificationStatus: 'Unverified Lead (Private)',
      status: 'published',
      visibility: 'public'
    });
    const missingApprovalRefEv = makeTestEvidence({
      id: 'ev-no-ref',
      approvalRecord: undefined
    });

    assert.equal(isPubliclyDisplayableEvidence(draftPublicEv), false);
    assert.equal(isPubliclyDisplayableEvidence(approvedPublicEv), false);
    assert.equal(isPubliclyDisplayableEvidence(publishedPrivateEv), false);
    assert.equal(isPubliclyDisplayableEvidence(unverifiedLeadEv), false);
    assert.equal(isPubliclyDisplayableEvidence(missingApprovalRefEv), false);

    // Validator explicitly rejects marking an unverified lead as public or published
    const unverifiedValidation = validateEvidenceRecord(unverifiedLeadEv, {
      isAuthorizedAdmin: true,
      actorUid: ADMIN_UID
    });
    assert.equal(unverifiedValidation.valid, false);
    assert.ok(unverifiedValidation.errors.some((e) => /unverified leads cannot be marked public/i.test(e)));

    const privateIncident = makeTestIncident({ id: 'inc-private', visibility: 'private' });
    const draftIncident = makeTestIncident({ id: 'inc-draft', status: 'draft' });
    const draftDev = makeTestDevelopment({ id: 'dev-draft', status: 'draft' });

    assert.equal(isPubliclyDisplayableIncident(privateIncident), false);
    assert.equal(isPubliclyDisplayableIncident(draftIncident), false);
    assert.equal(isPubliclyDisplayableDevelopment(draftDev), false);

    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Lagos',
      evidenceRecords: [draftPublicEv, approvedPublicEv, publishedPrivateEv, unverifiedLeadEv, missingApprovalRefEv],
      incidentRecords: [privateIncident, draftIncident],
      developmentRecords: [draftDev]
    });

    assert.equal(panel.supportingEvidence.length, 0);
    assert.equal(panel.incidents.length, 0);

    // Private notes validator blocks non-admins
    const privateNote: DcmPrivateNoteRecord = {
      id: 'pnote-ev-01',
      targetType: 'evidence',
      targetId: 'ev-la-2026-11-19-01',
      stateCode: 'LA',
      confidentialNotes: 'Confidential observer follow-up',
      confidentialContacts: 'Observer #12 — protected phone',
      unverifiedLeads: 'Unverified rumour awaiting confirmation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdByUid: ADMIN_UID,
      updatedByUid: ADMIN_UID
    };
    assert.equal(
      validatePrivateNoteRecord(privateNote, { isAuthorizedAdmin: false, actorUid: OTHER_UID }).valid,
      false
    );
    assert.equal(
      validatePrivateNoteRecord(privateNote, { isAuthorizedAdmin: true, actorUid: ADMIN_UID }).valid,
      true
    );
  });

  // -------------------------------------------------------------------------
  // TEST 7: Missing evidence produces explicit transparent state (no invented data)
  // -------------------------------------------------------------------------
  await test('Test 7: Missing evidence displays transparent empty state with zero invented/generic evidence', () => {
    const panel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Jigawa',
      evidenceRecords: [],
      incidentRecords: [],
      developmentRecords: []
    });

    assert.equal(panel.stateCode, 'JI');
    assert.equal(panel.supportingEvidence.length, 0);
    assert.equal(panel.incidents.length, 0);
    assert.equal(panel.institutionalResponse.responses.length, 0);
    // No invented finding text
    assert.ok(
      panel.currentView.hasApprovedFinding ||
        /no specific|no approved|carried forward/i.test(panel.currentView.keyFinding)
    );
  });

  // -------------------------------------------------------------------------
  // TEST 8: Historical assessments retain their original published evidence
  // -------------------------------------------------------------------------
  await test('Test 8: Historical assessments retain original published evidence even after newer editions & revisions are published', () => {
    const octEvidence = makeTestEvidence({
      id: 'ev-ed-2026-10-15-01',
      stateCode: 'ED',
      stateName: 'Edo',
      linkedPublicationIds: [oct15Pub.id],
      title: 'Original October 15 Edo Evidence',
      sourcePublicationDate: '2026-10-12'
    });

    const novRevision = makeTestEvidence({
      id: 'ev-ed-2026-10-15-01-r2',
      stateCode: 'ED',
      stateName: 'Edo',
      linkedPublicationIds: [dailyNov19Pub.id],
      supersedesEvidenceId: 'ev-ed-2026-10-15-01',
      revisionNumber: 2,
      title: 'Revised November 19 Edo Evidence (Rev 2)',
      sourcePublicationDate: '2026-11-18'
    });

    const octPanel = resolveStateAssessmentPanelData({
      selectedPub: oct15Pub,
      previousPub: baselinePub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Edo',
      evidenceRecords: [octEvidence, novRevision],
      incidentRecords: [],
      developmentRecords: []
    });

    const novPanel = resolveStateAssessmentPanelData({
      selectedPub: dailyNov19Pub,
      previousPub: oct15Pub,
      allPublishedSortedAsc: pubs,
      stateKey: 'Edo',
      evidenceRecords: [octEvidence, novRevision],
      incidentRecords: [],
      developmentRecords: []
    });

    // Historical Oct 15 edition retains original Oct 15 evidence
    assert.equal(octPanel.supportingEvidence.length, 1);
    assert.equal(octPanel.supportingEvidence[0].id, 'ev-ed-2026-10-15-01');
    assert.equal(octPanel.supportingEvidence[0].title, 'Original October 15 Edo Evidence');

    // Newer Nov 19 edition displays Rev 2
    assert.equal(novPanel.supportingEvidence.length, 1);
    assert.equal(novPanel.supportingEvidence[0].id, 'ev-ed-2026-10-15-01-r2');
    assert.equal(novPanel.supportingEvidence[0].revisionNumber, 2);

    // Historical editions list on Nov 19 accurately preserves counts per edition
    const histOct = novPanel.historicalEditions.find((h) => h.publicationId === oct15Pub.id);
    assert.equal(histOct?.publishedEvidenceCount, 1);
    assert.deepEqual(histOct?.evidenceTitles, ['Original October 15 Edo Evidence']);
  });

  // -------------------------------------------------------------------------
  // TEST 9: Published records immutable; versioned corrections (-r2) preserve originals
  // -------------------------------------------------------------------------
  await test('Test 9: Published evidence/incidents/developments cannot be overwritten; versioned corrections (-r2) preserve originals', () => {
    const pubEv = makeTestEvidence();
    const pubInc = makeTestIncident();
    const pubDev = makeTestDevelopment();

    // Direct overwrite of published records blocked
    const evOverwrite = validateEvidenceRecord(pubEv, {
      isAuthorizedAdmin: true,
      actorUid: ADMIN_UID,
      existingDoc: { id: pubEv.id, status: 'published' }
    });
    assert.equal(evOverwrite.valid, false);
    assert.ok(evOverwrite.errors.some((e) => /immutable/i.test(e)));

    const incOverwrite = validateIncidentRecord(pubInc, {
      isAuthorizedAdmin: true,
      actorUid: ADMIN_UID,
      existingDoc: { id: pubInc.id, status: 'published' }
    });
    assert.equal(incOverwrite.valid, false);
    assert.ok(incOverwrite.errors.some((e) => /immutable/i.test(e)));

    const devOverwrite = validateIncidentDevelopment(pubDev, {
      isAuthorizedAdmin: true,
      actorUid: ADMIN_UID,
      existingDoc: { id: pubDev.id, status: 'published' }
    });
    assert.equal(devOverwrite.valid, false);
    assert.ok(devOverwrite.errors.some((e) => /immutable/i.test(e)));

    // Versioned correction drafts create -r2 IDs pointing to original IDs
    const evR2 = createEvidenceCorrectionDraft(pubEv, [pubEv.id], ADMIN_UID);
    assert.equal(evR2.id, `${pubEv.id}-r2`);
    assert.equal(evR2.supersedesEvidenceId, pubEv.id);
    assert.equal(evR2.status, 'draft');
    assert.equal(evR2.revisionNumber, 2);

    const incR2 = createIncidentCorrectionDraft(pubInc, [pubInc.id], ADMIN_UID);
    assert.equal(incR2.id, `${pubInc.id}-r2`);
    assert.equal(incR2.supersedesIncidentId, pubInc.id);
    assert.equal(incR2.status, 'draft');

    const devR2 = createDevelopmentCorrectionDraft(pubDev, [pubDev.id], ADMIN_UID);
    assert.equal(devR2.id, `${pubDev.id}-r2`);
    assert.equal(devR2.supersedesDevelopmentId, pubDev.id);
    assert.equal(devR2.status, 'draft');
  });

  // -------------------------------------------------------------------------
  // TEST 10: Existing map colours, state search, publication selection & MS Graph DCM Brief endpoint unaffected
  // -------------------------------------------------------------------------
  await test('Test 10: Existing DCM palette, publication selection, and Microsoft Graph DCM Brief server endpoints remain unaffected', async () => {
    // Verify canonical 5-colour palette unchanged
    assert.equal(DCM_CANONICAL_PALETTE.G.hex, '#3e9a62');
    assert.equal(DCM_CANONICAL_PALETTE.A.hex, '#f6cd5c');
    assert.equal(DCM_CANONICAL_PALETTE.O.hex, '#e5822a');
    assert.equal(DCM_CANONICAL_PALETTE.R.hex, '#8f1d17');
    assert.equal(DCM_CANONICAL_PALETTE.X.hex, '#c9cdd2');

    // Verify publication selection stays stable
    const publicList = resolvePublicDcmPublications(pubs, INITIAL_DCM_PUBLICATIONS);
    const manualOct = resolveSelectedPublication(publicList, oct15Pub.id, false);
    assert.equal(manualOct.activePublication?.id, oct15Pub.id);

    // Verify local server health & DCM Brief Request endpoint remain operational (no live email sent)
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert.equal(healthRes.status, 200);
    const healthJson: any = await healthRes.json();
    assert.equal(healthJson.status, 'ok');

    // Validation check on /api/dcm-brief-request with intentionally empty payload -> HTTP 400 or 429 (rate limit)
    const briefRes = await fetch('http://localhost:3000/api/dcm-brief-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.ok(
      briefRes.status === 400 || briefRes.status === 429,
      `Expected HTTP 400/429 from /api/dcm-brief-request validation, got ${briefRes.status}`
    );
  });

  // -------------------------------------------------------------------------
  // TEST 11: Stage 3 component exports & schema blueprint integrity check
  // -------------------------------------------------------------------------
  await test('Test 11: Firebase blueprint defines all 4 Stage 3 collections cleanly', () => {
    const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
    const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf-8'));

    assert.ok(blueprint.entities.dcmEvidence, 'Missing dcmEvidence entity in firebase-blueprint.json');
    assert.ok(blueprint.entities.dcmIncident, 'Missing dcmIncident entity in firebase-blueprint.json');
    assert.ok(blueprint.entities.dcmIncidentDevelopment, 'Missing dcmIncidentDevelopment entity in firebase-blueprint.json');
    assert.ok(blueprint.entities.dcmPrivateNote, 'Missing dcmPrivateNote entity in firebase-blueprint.json');

    assert.ok(blueprint.firestore['/dcm_evidence/{evidenceId}']);
    assert.ok(blueprint.firestore['/dcm_incidents/{incidentId}']);
    assert.ok(blueprint.firestore['/dcm_incident_developments/{developmentId}']);
    assert.ok(blueprint.firestore['/dcm_private_notes/{noteId}']);
  });

  // -------------------------------------------------------------------------
  // TEST 12: Genuine Firestore Rules Evaluation against actual `/firestore.rules`
  // -------------------------------------------------------------------------
  await test('Test 12: Actual /firestore.rules enforces privacy, URL safety, approval gates, and immutability on all 4 Stage 3 collections', () => {
    const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    const ruleset = parseFirestoreRules(rulesSource);

    const store = new Map<string, Record<string, any>>();
    // Seed admin roles in in-memory store matching firestore.rules /cms_admins/{uid}
    store.set(`cms_admins/${ADMIN_UID}`, { role: 'Admin', status: 'Active' });
    store.set(`cms_admins/${SUSPENDED_UID}`, { role: 'Admin', status: 'Suspended' });

    const publicPublishedEv = makeTestEvidence({ id: 'ev-pub-01' });
    const privatePublishedEv = makeTestEvidence({ id: 'ev-priv-01', visibility: 'private' });
    const draftEv = makeTestEvidence({ id: 'ev-draft-01', status: 'draft', approvalRecord: undefined, publishedAt: undefined });
    const publicPublishedInc = makeTestIncident({ id: 'inc-pub-01' });
    const privateInc = makeTestIncident({ id: 'inc-priv-01', visibility: 'private' });
    const publicPublishedDev = makeTestDevelopment({ id: 'dev-pub-01' });
    const draftDev = makeTestDevelopment({ id: 'dev-draft-01', status: 'draft', approvalRecord: undefined, publishedAt: undefined });
    const privateNote: DcmPrivateNoteRecord = {
      id: 'pnote-01',
      targetType: 'evidence',
      targetId: 'ev-pub-01',
      stateCode: 'LA',
      confidentialNotes: 'Internal Research note',
      createdAt: 1795000000000,
      updatedAt: 1795000000000,
      createdByUid: ADMIN_UID,
      updatedByUid: ADMIN_UID
    };

    store.set(`dcm_evidence/${publicPublishedEv.id}`, publicPublishedEv);
    store.set(`dcm_evidence/${privatePublishedEv.id}`, privatePublishedEv);
    store.set(`dcm_evidence/${draftEv.id}`, draftEv);
    store.set(`dcm_incidents/${publicPublishedInc.id}`, publicPublishedInc);
    store.set(`dcm_incidents/${privateInc.id}`, privateInc);
    store.set(`dcm_incident_developments/${publicPublishedDev.id}`, publicPublishedDev);
    store.set(`dcm_incident_developments/${draftDev.id}`, draftDev);
    store.set(`dcm_private_notes/${privateNote.id}`, privateNote);

    const adminAuth = { uid: ADMIN_UID, token: { email: 'admin@athenacentre.org' } };
    const nonAdminAuth = { uid: OTHER_UID, token: { email: 'visitor@example.com' } };
    const suspendedAuth = { uid: SUSPENDED_UID, token: { email: 'suspended@athenacentre.org' } };

    let rulesAssertions = 0;
    const expectRule = (desc: string, expected: boolean, req: Parameters<typeof evaluateFirestoreRequest>[2]) => {
      const res = evaluateFirestoreRequest(ruleset, store, req);
      assert.equal(res.allowed, expected, `Rule mismatch [${desc}]: expected ${expected}, got ${res.allowed}. Errors: ${res.errors.join('; ')}`);
      rulesAssertions++;
    };

    // --- Public read/list privacy isolation ---
    expectRule('Public can GET published+public evidence', true, {
      operation: 'get', path: `dcm_evidence/${publicPublishedEv.id}`, auth: null
    });
    expectRule('Public DENIED GET on private evidence', false, {
      operation: 'get', path: `dcm_evidence/${privatePublishedEv.id}`, auth: null
    });
    expectRule('Public DENIED GET on draft evidence', false, {
      operation: 'get', path: `dcm_evidence/${draftEv.id}`, auth: null
    });
    expectRule('Public can GET published+public incident', true, {
      operation: 'get', path: `dcm_incidents/${publicPublishedInc.id}`, auth: null
    });
    expectRule('Public DENIED GET on private incident', false, {
      operation: 'get', path: `dcm_incidents/${privateInc.id}`, auth: null
    });
    expectRule('Public can GET published+public development', true, {
      operation: 'get', path: `dcm_incident_developments/${publicPublishedDev.id}`, auth: null
    });
    expectRule('Public DENIED GET on draft development', false, {
      operation: 'get', path: `dcm_incident_developments/${draftDev.id}`, auth: null
    });
    expectRule('Public DENIED GET on /dcm_private_notes', false, {
      operation: 'get', path: `dcm_private_notes/${privateNote.id}`, auth: null
    });
    expectRule('Signed-in non-admin DENIED GET on /dcm_private_notes', false, {
      operation: 'get', path: `dcm_private_notes/${privateNote.id}`, auth: nonAdminAuth
    });
    expectRule('Suspended admin DENIED GET on /dcm_private_notes', false, {
      operation: 'get', path: `dcm_private_notes/${privateNote.id}`, auth: suspendedAuth
    });
    expectRule('Authorised admin ALLOWED GET on /dcm_private_notes', true, {
      operation: 'get', path: `dcm_private_notes/${privateNote.id}`, auth: adminAuth
    });

    // --- Unauthorised write denials ---
    expectRule('Non-admin DENIED CREATE evidence', false, {
      operation: 'create', path: 'dcm_evidence/ev-new-01', auth: nonAdminAuth, incomingData: draftEv
    });
    expectRule('Suspended admin DENIED CREATE incident', false, {
      operation: 'create', path: 'dcm_incidents/inc-new-01', auth: suspendedAuth, incomingData: publicPublishedInc
    });

    // --- Publishing safeguards (URL, Unverified Lead, Approval Reference, Spoofed Recorder UID) ---
    expectRule('Admin DENIED CREATE evidence with javascript: URL', false, {
      operation: 'create',
      path: 'dcm_evidence/ev-bad-url',
      auth: adminAuth,
      incomingData: { ...draftEv, id: 'ev-bad-url', sourceUrl: 'javascript:alert(1)' }
    });
    expectRule('Admin DENIED CREATE Unverified Lead marked public', false, {
      operation: 'create',
      path: 'dcm_evidence/ev-unver-pub',
      auth: adminAuth,
      incomingData: {
        ...publicPublishedEv,
        id: 'ev-unver-pub',
        verificationStatus: 'Unverified Lead (Private)',
        visibility: 'public',
        status: 'published'
      }
    });
    expectRule('Admin DENIED PUBLISH evidence without approvalReference', false, {
      operation: 'create',
      path: 'dcm_evidence/ev-no-ref',
      auth: adminAuth,
      incomingData: {
        ...publicPublishedEv,
        id: 'ev-no-ref',
        approvalRecord: { ...makeApproval('AEO-REF'), approvalReference: '' }
      }
    });
    expectRule('Admin DENIED PUBLISH evidence with spoofed recordedByUid', false, {
      operation: 'create',
      path: 'dcm_evidence/ev-spoof-uid',
      auth: adminAuth,
      incomingData: {
        ...publicPublishedEv,
        id: 'ev-spoof-uid',
        approvalRecord: makeApproval('AEO-REF-001', OTHER_UID)
      }
    });

    // --- Immutability of published records + versioned correction allowed ---
    expectRule('Admin DENIED UPDATE published evidence', false, {
      operation: 'update',
      path: `dcm_evidence/${publicPublishedEv.id}`,
      auth: adminAuth,
      incomingData: { ...publicPublishedEv, title: 'Mutated title' }
    });
    expectRule('Admin DENIED DELETE published evidence', false, {
      operation: 'delete',
      path: `dcm_evidence/${publicPublishedEv.id}`,
      auth: adminAuth
    });
    expectRule('Admin DENIED UPDATE published incident', false, {
      operation: 'update',
      path: `dcm_incidents/${publicPublishedInc.id}`,
      auth: adminAuth,
      incomingData: { ...publicPublishedInc, title: 'Mutated incident' }
    });
    expectRule('Admin DENIED DELETE published incident', false, {
      operation: 'delete',
      path: `dcm_incidents/${publicPublishedInc.id}`,
      auth: adminAuth
    });
    expectRule('Admin DENIED UPDATE published development', false, {
      operation: 'update',
      path: `dcm_incident_developments/${publicPublishedDev.id}`,
      auth: adminAuth,
      incomingData: { ...publicPublishedDev, title: 'Mutated dev' }
    });
    expectRule('Admin DENIED DELETE published development', false, {
      operation: 'delete',
      path: `dcm_incident_developments/${publicPublishedDev.id}`,
      auth: adminAuth
    });

    // --- Valid admin creates & updates (drafts, versioned -r2 corrections, private notes) ---
    expectRule('Admin ALLOWED CREATE valid versioned -r2 evidence correction', true, {
      operation: 'create',
      path: 'dcm_evidence/ev-pub-01-r2',
      auth: adminAuth,
      incomingData: {
        ...publicPublishedEv,
        id: 'ev-pub-01-r2',
        supersedesEvidenceId: 'ev-pub-01',
        revisionNumber: 2
      }
    });
    expectRule('Admin ALLOWED UPDATE unpublished draft evidence', true, {
      operation: 'update',
      path: `dcm_evidence/${draftEv.id}`,
      auth: adminAuth,
      incomingData: { ...draftEv, title: 'Updated draft evidence title' }
    });
    expectRule('Admin ALLOWED DELETE unpublished draft evidence', true, {
      operation: 'delete',
      path: `dcm_evidence/${draftEv.id}`,
      auth: adminAuth
    });
    expectRule('Admin ALLOWED CREATE valid private note', true, {
      operation: 'create',
      path: 'dcm_private_notes/pnote-new',
      auth: adminAuth,
      incomingData: { ...privateNote, id: 'pnote-new' }
    });
    expectRule('Admin DENIED CREATE private note with mismatched createdByUid', false, {
      operation: 'create',
      path: 'dcm_private_notes/pnote-spoof',
      auth: adminAuth,
      incomingData: { ...privateNote, id: 'pnote-spoof', createdByUid: OTHER_UID }
    });

    console.log(`         (${rulesAssertions} direct /firestore.rules assertions verified across all 4 Stage 3 collections)`);
  });

  console.log(`\nStage 3 Summary: ${passed} passed, ${failed} failed (Total: ${passed + failed})\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
