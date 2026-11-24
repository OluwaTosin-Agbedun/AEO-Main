import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_DCM_PUBLICATIONS } from '../src/data/dcmInitialData';
import { NIGERIA_37_JURISDICTIONS, DcmPublication, DCM_COLORS } from '../src/types/dcm';
import {
  auditPublicationConsistency,
  buildCanonicalPublicationView,
  DCM_CANONICAL_PALETTE,
  DCM_CLASSIFICATION_TO_CODE,
  resolveCanonicalStateView,
  resolvePublicDcmPublications,
  resolveSelectedPublication,
  TRANSPARENT_MISSING_CLASSIFICATION_NOTE,
  TRANSPARENT_MISSING_EVIDENCE_NOTE
} from '../src/utils/dcmConsistency';
import {
  createCorrectionDraft,
  createDailyDraft,
  validateApprovalRecord,
  validateDailyPublication,
  validateLegacyPublication
} from '../src/utils/dcmDaily';
import {
  compareDcmPublications,
  getPublishedDcmSorted
} from '../src/utils/dcmComparison';
import { DCM_GEO } from '../src/data/dcmGeoData';
import { NIGERIA_ACCURATE_STATE_PATHS } from '../src/data/nigeriaSvgPaths';
import {
  evaluateFirestoreRequest,
  parseFirestoreRules
} from './firestoreRulesEvaluator';

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function runTest(id: string, name: string, fn: () => Promise<string> | string) {
  try {
    const details = await fn();
    results.push({ id, name, passed: true, details });
    console.log(`[PASS] ${id}: ${name} — ${details}`);
  } catch (err: any) {
    results.push({ id, name, passed: false, details: err?.message || String(err) });
    console.error(`[FAIL] ${id}: ${name} — ${err?.message || String(err)}`);
  }
}

const OWNER_UID = 's39PbuZxqdW1x63i0SsEVE7HqGQ2';
const ACTIVE_ADMIN_UID = 'active-aeo-admin-uid-001';
const SUSPENDED_ADMIN_UID = 'suspended-aeo-admin-uid-002';
const PUBLIC_SIGNED_IN_UID = 'ordinary-signed-in-user-003';

function makeValidDailyFirestoreDoc(
  pub: DcmPublication,
  overrides: Record<string, any> = {}
): Record<string, any> {
  const raw: Record<string, any> = { ...pub, ...overrides };
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean;
}

async function main() {
  const sortedInitial = resolvePublicDcmPublications(INITIAL_DCM_PUBLICATIONS);
  const earlierLegacyPub = sortedInitial[0];
  const baselineLegacyPub = sortedInitial[sortedInitial.length - 1];
  assert.ok(baselineLegacyPub, 'Baseline legacy publication fixture must exist');
  assert.ok(earlierLegacyPub, 'Earlier legacy publication fixture must exist');
  assert.notEqual(earlierLegacyPub.id, baselineLegacyPub.id, 'Need at least two distinct historical publications');

  // =========================================================================
  // STAGE 2 MANDATORY TEST 1: All 37 jurisdictions display approved classifications consistently
  // =========================================================================
  await runTest(
    'Stage 2 Test 1',
    'All 36 states and the FCT map to their approved classifications consistently',
    () => {
      assert.equal(NIGERIA_37_JURISDICTIONS.length, 37);
      assert.equal(DCM_GEO.states.length, 37);
      assert.equal(NIGERIA_ACCURATE_STATE_PATHS.length, 37);

      for (const pub of INITIAL_DCM_PUBLICATIONS) {
        const view = buildCanonicalPublicationView(pub);
        const audit = auditPublicationConsistency(pub);

        assert.equal(audit.consistent, true, `Audit failed for ${pub.id}: ${audit.errors.join('; ')}`);
        assert.equal(audit.stats.totalJurisdictions, 37);
        assert.equal(audit.stats.classifiedCount, 37);
        assert.equal(audit.stats.unavailableCount, 0);
        assert.equal(view.stateList.length, 37);

        for (const j of NIGERIA_37_JURISDICTIONS) {
          const sourceRec = pub.classifications[j.code];
          const stateView = view.statesByCode[j.code];
          assert.ok(sourceRec, `Source classification missing for ${j.code} in ${pub.id}`);
          assert.ok(stateView, `Canonical state view missing for ${j.code} in ${pub.id}`);
          assert.equal(stateView.classification, sourceRec.classification);
          assert.equal(stateView.isClassificationUnavailable, false);
          assert.equal(stateView.code, DCM_CLASSIFICATION_TO_CODE[sourceRec.classification]);
          assert.equal(stateView.hex, DCM_CANONICAL_PALETTE[stateView.code].hex);
        }
      }

      return `Audited all ${INITIAL_DCM_PUBLICATIONS.length} initial publications across all 37 jurisdictions with 0 unavailable and 0 palette mismatches.`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 2: Map colours, state cards, search results & legend agree 100%
  // =========================================================================
  await runTest(
    'Stage 2 Test 2',
    'Map colours correspond to the exact classification codes shown in state cards, search results, and legend',
    () => {
      // Verify canonical DCM colour definitions are preserved across types/dcm.ts and dcmConsistency.ts
      assert.equal(DCM_COLORS['Open'].fill, '#3e9a62');
      assert.equal(DCM_COLORS['Emerging concern'].fill, '#f6cd5c');
      assert.equal(DCM_COLORS['Constrained'].fill, '#e5822a');
      assert.equal(DCM_COLORS['Severely constrained'].fill, '#8f1d17');
      assert.equal(DCM_COLORS['Insufficient evidence'].fill, '#c9cdd2');

      assert.equal(DCM_CANONICAL_PALETTE.G.hex, DCM_COLORS['Open'].fill);
      assert.equal(DCM_CANONICAL_PALETTE.A.hex, DCM_COLORS['Emerging concern'].fill);
      assert.equal(DCM_CANONICAL_PALETTE.O.hex, DCM_COLORS['Constrained'].fill);
      assert.equal(DCM_CANONICAL_PALETTE.R.hex, DCM_COLORS['Severely constrained'].fill);
      assert.equal(DCM_CANONICAL_PALETTE.X.hex, DCM_COLORS['Insufficient evidence'].fill);

      const view = buildCanonicalPublicationView(baselineLegacyPub);

      // Verify every single SVG map path in BOTH DCM_GEO.states (DcmPreview) AND NIGERIA_ACCURATE_STATE_PATHS (DcmMap)
      // resolves to the EXACT same code, label & colour as the state card & search result
      let checkedPaths = 0;
      for (const geo of DCM_GEO.states) {
        const mapStateView = resolveCanonicalStateView(baselineLegacyPub, geo.name);
        const cardStateView = view.statesByCode[mapStateView.stateCode];
        assert.ok(cardStateView, `No canonical card view for DCM_GEO state ${geo.name}`);
        assert.equal(mapStateView.stateCode, cardStateView.stateCode);
        assert.equal(mapStateView.code, cardStateView.code);
        assert.equal(mapStateView.classification, cardStateView.classification);
        assert.equal(mapStateView.hex, cardStateView.hex);
        assert.equal(mapStateView.hex, DCM_CANONICAL_PALETTE[cardStateView.code].hex);
        checkedPaths++;
      }
      assert.equal(checkedPaths, 37);

      let checkedAccuratePaths = 0;
      for (const pathItem of NIGERIA_ACCURATE_STATE_PATHS) {
        const mapStateView = resolveCanonicalStateView(baselineLegacyPub, pathItem.code);
        const cardStateView = view.statesByCode[mapStateView.stateCode];
        assert.ok(cardStateView, `No canonical card view for SVG path ${pathItem.code}`);
        assert.equal(mapStateView.code, cardStateView.code);
        assert.equal(mapStateView.classification, cardStateView.classification);
        assert.equal(mapStateView.hex, cardStateView.hex);
        checkedAccuratePaths++;
      }
      assert.equal(checkedAccuratePaths, 37);

      // Verify legend tallies sum to 37 and match exact canonical code distribution
      const legendTotal = Object.values(view.counts).reduce((sum, n) => sum + n, 0);
      assert.equal(legendTotal, 37);
      assert.equal(view.unavailableCount, 0);

      // Verify FCT aliases ('FC', 'FCT', 'Federal Capital Territory') resolve identically
      const fc1 = resolveCanonicalStateView(baselineLegacyPub, 'FC');
      const fc2 = resolveCanonicalStateView(baselineLegacyPub, 'FCT');
      const fc3 = resolveCanonicalStateView(baselineLegacyPub, 'Federal Capital Territory');
      assert.equal(fc1.stateCode, 'FC');
      assert.equal(fc2.stateCode, 'FC');
      assert.equal(fc3.stateCode, 'FC');
      assert.equal(fc1.hex, fc3.hex);
      assert.equal(fc1.classification, fc3.classification);

      return `All 37 DCM_GEO paths, 37 SVG accurate paths, canonical state cards, legend counts (total=${legendTotal}), and FCT aliases agree 100% on code, label, and hex colour.`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 3: Carried-forward daily publication displays exact approved classifications unchanged
  // =========================================================================
  await runTest(
    'Stage 2 Test 3',
    'Carried-forward daily publication displays existing approved classifications unchanged',
    () => {
      const carriedDraft = createDailyDraft({
        assessmentDate: '2026-11-19',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        existingIds: INITIAL_DCM_PUBLICATIONS.map((p) => p.id),
        createdByUid: OWNER_UID
      });

      const publishedCarried: DcmPublication = {
        ...carriedDraft,
        status: 'published',
        isLatest: true,
        publishedAt: '2026-11-19T16:30:00.000Z',
        summary: 'Research-approved daily assessment as of 19 November 2026, 17:00 WAT (UTC+01:00).',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-19-01',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-19T16:10:00.000Z',
          recordedByUid: OWNER_UID,
          recordedByEmail: 'admin@athenacentre.org',
          recordedAt: '2026-11-19T16:25:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };

      const val = validateDailyPublication(publishedCarried, {
        isAuthorizedAdmin: true,
        actorUid: OWNER_UID,
        sourcePub: baselineLegacyPub
      });
      assert.equal(val.valid, true, val.errors.join('; '));

      const baseView = buildCanonicalPublicationView(baselineLegacyPub);
      const dailyView = buildCanonicalPublicationView(publishedCarried);

      for (const j of NIGERIA_37_JURISDICTIONS) {
        const b = baseView.statesByCode[j.code];
        const d = dailyView.statesByCode[j.code];
        assert.equal(d.classification, b.classification, `Carried-forward classification changed for ${j.code}`);
        assert.equal(d.hex, b.hex, `Carried-forward colour changed for ${j.code}`);
        assert.equal(d.keyFinding, b.keyFinding, `Carried-forward finding changed for ${j.code}`);
        assert.equal(d.carriedForward, true);
      }

      return `All 37 carried-forward classifications, hex colours, and approved findings match source ${baselineLegacyPub.id} verbatim.`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 4: Quiet-day publication displays without fabricated changes
  // =========================================================================
  await runTest(
    'Stage 2 Test 4',
    'Quiet-day publication displays without fabricated changes or invented direction claims',
    () => {
      const quietDraft = createDailyDraft({
        assessmentDate: '2026-11-20',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        existingIds: INITIAL_DCM_PUBLICATIONS.map((p) => p.id),
        isQuietDay: true,
        createdByUid: OWNER_UID
      });

      const publishedQuiet: DcmPublication = {
        ...quietDraft,
        status: 'published',
        isLatest: true,
        publishedAt: '2026-11-20T16:40:00.000Z',
        summary: 'Daily update as of 20 November 2026, 17:00 WAT (UTC+01:00). Previously approved state classifications remain carried forward.',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-20-QD',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-20T16:20:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-20T16:35:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };

      const comparison = compareDcmPublications(publishedQuiet, [...INITIAL_DCM_PUBLICATIONS, publishedQuiet]);
      assert.equal(comparison.hasPrevious, true);
      assert.equal(comparison.previousPublication?.id, baselineLegacyPub.id);
      assert.equal(comparison.totalChanged, 0);
      assert.equal(comparison.changedStates.length, 0);

      const view = buildCanonicalPublicationView(publishedQuiet);
      assert.equal(view.meta.isQuietDay, true);
      assert.equal(view.meta.evidenceCutoffLabel, '20 November 2026, 17:00 WAT (UTC+01:00)');

      for (const state of view.stateList) {
        const srcRec = publishedQuiet.classifications[state.stateCode];
        // Direction/confidence must ONLY be flagged true when explicitly present on the approved record
        assert.equal(state.hasApprovedDirection, Boolean(srcRec.direction && srcRec.direction.trim()));
        assert.equal(state.hasApprovedConfidence, Boolean(srcRec.confidence && srcRec.confidence.trim()));
      }

      return `Quiet-day ${publishedQuiet.id} shows 0 changes, explicit WAT cut-off, and 0 fabricated direction/confidence labels.`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 5: Historical edition displays original data and NEVER silently switches to latest
  // =========================================================================
  await runTest(
    'Stage 2 Test 5',
    'Historical publication displays its original data and never silently switches to the latest date',
    () => {
      const newerDaily: DcmPublication = {
        ...createDailyDraft({
          assessmentDate: '2026-11-21',
          cutoffTimeWat: '17:00',
          sourcePub: baselineLegacyPub,
          createdByUid: OWNER_UID
        }),
        status: 'published',
        isLatest: true,
        publishedAt: '2026-11-21T16:30:00.000Z',
        summary: 'Research-approved daily assessment for 21 November 2026, 17:00 WAT (UTC+01:00).',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-21-01',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-21T16:00:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-21T16:25:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };

      const initialPublic = resolvePublicDcmPublications(INITIAL_DCM_PUBLICATIONS);
      // User explicitly selects the earliest historical edition
      const selectedBeforeNewRelease = resolveSelectedPublication(initialPublic, earlierLegacyPub.id);
      assert.equal(selectedBeforeNewRelease.activePublication?.id, earlierLegacyPub.id);
      assert.equal(selectedBeforeNewRelease.isLatest, false);

      // Now a newer daily publication arrives in the list
      const updatedPublic = resolvePublicDcmPublications([...INITIAL_DCM_PUBLICATIONS, newerDaily]);
      assert.equal(updatedPublic[updatedPublic.length - 1].id, newerDaily.id, 'Default latest should be newest daily edition');

      // Default selection (null/undefined) picks latest published
      const defaultSelected = resolveSelectedPublication(updatedPublic, null);
      assert.equal(defaultSelected.activePublication?.id, newerDaily.id);
      assert.equal(defaultSelected.isLatest, true);

      // Explicit historical selection MUST remain locked on earlierLegacyPub (never silently switching to newerDaily)
      const selectedAfterNewRelease = resolveSelectedPublication(updatedPublic, earlierLegacyPub.id);
      assert.equal(selectedAfterNewRelease.activePublication?.id, earlierLegacyPub.id);
      assert.equal(selectedAfterNewRelease.isLatest, false);

      // Verify its classifications are strictly from the historical snapshot, not the latest edition
      const histView = buildCanonicalPublicationView(selectedAfterNewRelease.activePublication!);
      assert.equal(histView.meta.id, earlierLegacyPub.id);
      for (const j of NIGERIA_37_JURISDICTIONS) {
        assert.equal(
          histView.statesByCode[j.code].classification,
          earlierLegacyPub.classifications[j.code].classification
        );
      }

      return `Selected historical edition "${earlierLegacyPub.id}" stayed locked with original classifications after newer daily "${newerDaily.id}" arrived; default view uses "${defaultSelected.activePublication?.id}".`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 6: Drafts & approved-but-unpublished records remain private (daily AND legacy)
  // =========================================================================
  await runTest(
    'Stage 2 Test 6',
    'Draft and approved-but-unpublished records remain strictly private (daily and legacy)',
    () => {
      const dailyDraft = createDailyDraft({
        assessmentDate: '2026-11-25',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        createdByUid: OWNER_UID
      });

      const dailyApprovedPrivate: DcmPublication = {
        ...createDailyDraft({
          assessmentDate: '2026-11-26',
          cutoffTimeWat: '17:00',
          sourcePub: baselineLegacyPub,
          createdByUid: OWNER_UID
        }),
        status: 'approved',
        isLatest: true, // Even if misflagged isLatest: true, MUST NEVER leak!
        summary: 'Approved daily assessment awaiting scheduled release.',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-26-HOLD',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-26T16:00:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-26T16:05:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };

      // Simulate the exact live Firestore bug: a legacy draft marked `status: 'draft', isLatest: true`
      const legacyDraftWithIsLatest: DcmPublication = {
        ...baselineLegacyPub,
        id: 'dcm-2026-11-end',
        title: 'Democratic Competitiveness Map: 16th – 30th November 2026',
        reportingPeriodLabel: '16th – 30th November 2026',
        periodStart: '2026-11-16',
        periodEnd: '2026-11-30',
        status: 'draft',
        isLatest: true
      };

      const legacyArchived: DcmPublication = {
        ...baselineLegacyPub,
        id: 'dcm-2026-archived-test',
        status: 'archived',
        isLatest: true
      };

      const publicList = resolvePublicDcmPublications([
        ...INITIAL_DCM_PUBLICATIONS,
        dailyDraft,
        dailyApprovedPrivate,
        legacyDraftWithIsLatest,
        legacyArchived
      ]);

      assert.equal(publicList.some((p) => p.id === dailyDraft.id), false, 'Daily draft leaked!');
      assert.equal(publicList.some((p) => p.id === dailyApprovedPrivate.id), false, 'Daily approved record leaked!');
      assert.equal(publicList.some((p) => p.id === legacyDraftWithIsLatest.id), false, 'Legacy draft with isLatest:true leaked!');
      assert.equal(publicList.some((p) => p.id === legacyArchived.id), false, 'Archived legacy record leaked!');
      assert.equal(publicList.every((p) => p.status === 'published'), true);

      return 'Daily draft, daily approved-unreleased, legacy draft with isLatest=true, and archived records all excluded from public view.';
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 7: Publishing safeguards, approval reference, immutability & versioned corrections
  // =========================================================================
  await runTest(
    'Stage 2 Test 7',
    'CMS publishing safeguards block incomplete/unauthorised/unreferenced releases and protect immutability',
    () => {
      const draft = createDailyDraft({
        assessmentDate: '2026-11-22',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        createdByUid: OWNER_UID
      });

      // 7a. Manually typed approver name WITHOUT documented approvalReference or recorder identity MUST be rejected
      const typedNameOnlyErrors = validateApprovalRecord(
        {
          approved: true,
          approvalReference: '',
          approvedByName: 'Manually Typed Approver',
          approvedAt: '2026-11-22T16:00:00Z',
          recordedByUid: '',
          recordedAt: ''
        },
        OWNER_UID
      );
      assert.ok(typedNameOnlyErrors.length > 0);
      assert.ok(typedNameOnlyErrors.some((e) => e.toLowerCase().includes('reference')));
      assert.ok(typedNameOnlyErrors.some((e) => e.toLowerCase().includes('uid') || e.toLowerCase().includes('identity')));

      // 7b. Mismatched actorUid (attempting to forge recordedByUid of another admin) MUST be rejected
      const spoofedRecorderErrors = validateApprovalRecord(
        {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-22',
          approvedByName: 'Head of Research',
          approvedAt: '2026-11-22T16:00:00Z',
          recordedByUid: ACTIVE_ADMIN_UID,
          recordedAt: '2026-11-22T16:05:00Z'
        },
        OWNER_UID
      );
      assert.ok(spoofedRecorderErrors.length > 0);
      assert.ok(spoofedRecorderErrors.some((e) => e.toLowerCase().includes('match')));

      // 7c. Incomplete jurisdiction set (36 states instead of 37) MUST be blocked
      const incompleteClassifications = { ...draft.classifications };
      delete incompleteClassifications.FC;
      const incompleteDaily = validateDailyPublication(
        { ...draft, classifications: incompleteClassifications },
        { isAuthorizedAdmin: true, actorUid: OWNER_UID, sourcePub: baselineLegacyPub }
      );
      assert.equal(incompleteDaily.valid, false);
      assert.ok(incompleteDaily.errors.some((e) => e.includes('FC')));

      // 7d. Legacy publication publishing without approval reference MUST be blocked, and overwriting published legacy blocked
      const legacyUnapproved = validateLegacyPublication(
        { ...baselineLegacyPub, id: 'dcm-2026-12-15', status: 'published', approvalRecord: undefined },
        { isAuthorizedAdmin: true, actorUid: OWNER_UID }
      );
      assert.equal(legacyUnapproved.valid, false);
      assert.ok(legacyUnapproved.errors.some((e) => e.toLowerCase().includes('approval')));

      const legacyOverwrite = validateLegacyPublication(baselineLegacyPub, {
        isAuthorizedAdmin: true,
        actorUid: OWNER_UID,
        existingDoc: baselineLegacyPub
      });
      assert.equal(legacyOverwrite.valid, false);
      assert.ok(legacyOverwrite.errors.some((e) => e.toLowerCase().includes('overwritten')));

      // 7e. Issuing a corrected revision creates a new versioned draft preserving the original published snapshot
      const publishedDaily: DcmPublication = {
        ...draft,
        status: 'published',
        publishedAt: '2026-11-22T16:30:00.000Z',
        summary: 'Research-approved daily update for 22 November 2026, 17:00 WAT (UTC+01:00).',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-22-01',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-22T16:10:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-22T16:25:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };
      const correctionDraft = createCorrectionDraft(publishedDaily, [publishedDaily.id], OWNER_UID);
      assert.equal(correctionDraft.id, 'dcm-daily-2026-11-22-r2');
      assert.equal(correctionDraft.supersedesPublicationId, publishedDaily.id);
      assert.equal(correctionDraft.revisionNumber, 2);
      assert.equal(correctionDraft.status, 'draft');
      assert.equal(correctionDraft.approvalRecord, undefined, 'Correction draft must require fresh Research approval');
      // Original publishedDaily remains completely untouched
      assert.equal(publishedDaily.status, 'published');
      assert.equal(publishedDaily.id, 'dcm-daily-2026-11-22');

      // Published revision r2 sorts deterministically after r1
      const publishedCorrection: DcmPublication = {
        ...correctionDraft,
        status: 'published',
        publishedAt: '2026-11-22T18:00:00.000Z',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-22-02-CORR',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-22T17:50:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-22T17:55:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      };
      const sorted = getPublishedDcmSorted([publishedCorrection, publishedDaily]);
      assert.equal(sorted[0].id, publishedDaily.id);
      assert.equal(sorted[1].id, publishedCorrection.id);

      return 'Rejected typed-name-only approval, spoofed recorder UID, incomplete 36-state payload, and published overwrites; verified versioned correction draft (-r2) preserves original snapshot.';
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 8: Missing data displayed transparently (zero fabrication)
  // =========================================================================
  await runTest(
    'Stage 2 Test 8',
    'Missing classifications and missing public evidence display transparently without fabrication',
    () => {
      const partialPub: DcmPublication = {
        ...baselineLegacyPub,
        id: 'dcm-partial-transparency-test',
        classifications: {
          ...baselineLegacyPub.classifications
        }
      };
      // Remove Kaduna completely to test missing classification
      delete (partialPub.classifications as any).KD;
      // Clear Kano's keyFinding & classificationRationale to test missing finding (must NOT substitute generic description)
      partialPub.classifications.KN = {
        stateCode: 'KN',
        stateName: 'Kano',
        classification: 'Emerging concern',
        keyFinding: '',
        classificationRationale: ''
      };

      const missingKd = resolveCanonicalStateView(partialPub, 'KD');
      assert.equal(missingKd.isClassificationUnavailable, true);
      assert.equal(missingKd.code, 'U');
      assert.equal(missingKd.classification, 'Data unavailable');
      assert.equal(missingKd.hex, DCM_CANONICAL_PALETTE.U.hex);
      assert.notEqual(missingKd.classification, 'Insufficient evidence', 'Missing data must NEVER be silently coerced to Insufficient evidence');
      assert.equal(missingKd.hasApprovedFinding, false);
      assert.equal(missingKd.keyFinding, TRANSPARENT_MISSING_CLASSIFICATION_NOTE);
      assert.equal(missingKd.keyFinding.toLowerCase().includes('tear-gas'), false, 'Hardcoded Kaduna fallback text must NEVER appear');
      assert.equal(missingKd.hasApprovedDirection, false);
      assert.equal(missingKd.hasApprovedConfidence, false);

      const noFindingKn = resolveCanonicalStateView(partialPub, 'KN');
      assert.equal(noFindingKn.isClassificationUnavailable, false);
      assert.equal(noFindingKn.classification, 'Emerging concern');
      assert.equal(noFindingKn.hasApprovedFinding, false);
      // Must NEVER substitute generic methodology description like "A material incident or early evidence"
      assert.equal(noFindingKn.keyFinding.toLowerCase().includes('material incident'), false);
      assert.equal(noFindingKn.keyFinding, TRANSPARENT_MISSING_EVIDENCE_NOTE);
      assert.equal(noFindingKn.hasApprovedDirection, false);
      assert.equal(noFindingKn.hasApprovedConfidence, false);

      // Audit must transparently flag the missing jurisdiction KD and missing evidence KN
      const audit = auditPublicationConsistency(partialPub);
      assert.equal(audit.consistent, false);
      assert.equal(audit.stats.unavailableCount, 1);
      assert.ok(audit.errors.some((e) => e.includes('Kaduna (KD)')));
      assert.ok(audit.stats.missingEvidenceCount >= 1);

      // Also verify DcmMap.tsx and DcmPreview.tsx contain ZERO hardcoded Kaduna tear-gas fallback
      const dcmMapSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/DcmMap.tsx'), 'utf8');
      const dcmPreviewSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/DcmPreview.tsx'), 'utf8');
      assert.equal(dcmMapSrc.includes('tear-gas'), false, 'Hardcoded Kaduna text still in DcmMap.tsx');
      assert.equal(dcmPreviewSrc.includes('tear-gas'), false, 'Hardcoded Kaduna text still in DcmPreview.tsx');

      return `Missing KD rendered transparently as "${missingKd.classification}" (code U, ${missingKd.hex}); empty KN finding rendered transparent unavailable notice with 0 fabricated claims.`;
    }
  );

  // =========================================================================
  // STAGE 2 SECTION 6: Genuine Firestore Security Rules Verification (against ACTUAL firestore.rules)
  // =========================================================================
  await runTest(
    'Stage 2 Security Rules',
    'Actual firestore.rules enforces public read-only published access, draft privacy, admin auth, approval reference, and immutability',
    () => {
      const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
      const ruleset = parseFirestoreRules(rulesSrc);

      // Build isolated in-memory Firestore state (NEVER touches Production Firestore)
      const store = new Map<string, Record<string, any>>();
      store.set(`cms_admins/${ACTIVE_ADMIN_UID}`, { uid: ACTIVE_ADMIN_UID, status: 'Active', role: 'Administrator' });
      store.set(`cms_admins/${SUSPENDED_ADMIN_UID}`, { uid: SUSPENDED_ADMIN_UID, status: 'Suspended', role: 'Administrator' });

      const draftBase = createDailyDraft({
        assessmentDate: '2026-11-19',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        createdByUid: ACTIVE_ADMIN_UID
      });
      const draftDoc = makeValidDailyFirestoreDoc(draftBase);

      const approvedDoc = makeValidDailyFirestoreDoc({
        ...createDailyDraft({
          assessmentDate: '2026-11-20',
          cutoffTimeWat: '17:00',
          sourcePub: baselineLegacyPub,
          createdByUid: ACTIVE_ADMIN_UID
        }),
        status: 'approved',
        summary: 'Research-approved daily summary awaiting release.',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-20-APPR',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-20T16:10:00.000Z',
          recordedByUid: ACTIVE_ADMIN_UID,
          recordedAt: '2026-11-20T16:12:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      });

      const publishedDoc = makeValidDailyFirestoreDoc({
        ...createDailyDraft({
          assessmentDate: '2026-11-18',
          cutoffTimeWat: '17:00',
          sourcePub: baselineLegacyPub,
          createdByUid: OWNER_UID
        }),
        status: 'published',
        isLatest: true,
        publishedAt: '2026-11-18T16:30:00.000Z',
        summary: 'Research-approved daily assessment for 18 November 2026, 17:00 WAT (UTC+01:00).',
        approvalRecord: {
          approved: true,
          approvalReference: 'AEO-RES-2026-11-18-PUB',
          approvedByName: 'AEO Research Director',
          approvedAt: '2026-11-18T16:05:00.000Z',
          recordedByUid: OWNER_UID,
          recordedAt: '2026-11-18T16:20:00.000Z',
          verificationMode: 'admin-recorded-reference'
        }
      });

      store.set(`dcm_daily_publications/${draftDoc.id}`, draftDoc);
      store.set(`dcm_daily_publications/${approvedDoc.id}`, approvedDoc);
      store.set(`dcm_daily_publications/${publishedDoc.id}`, publishedDoc);
      store.set('cms/dcm_publications', { items: INITIAL_DCM_PUBLICATIONS });
      store.set('cms/reports', { items: [] });

      const assertions: Array<{ label: string; actual: boolean; expected: boolean }> = [
        // 1. Public users CAN read ONLY published records
        {
          label: 'Public GET published daily doc',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${publishedDoc.id}`, auth: null }).allowed,
          expected: true
        },
        {
          label: 'Public LIST published daily doc',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'list', path: `dcm_daily_publications/${publishedDoc.id}`, auth: null }).allowed,
          expected: true
        },
        // 2. Public users CANNOT read drafts or approved-but-unpublished records
        {
          label: 'Public GET draft daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${draftDoc.id}`, auth: null }).allowed,
          expected: false
        },
        {
          label: 'Public LIST draft daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'list', path: `dcm_daily_publications/${draftDoc.id}`, auth: null }).allowed,
          expected: false
        },
        {
          label: 'Public GET approved-unreleased daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${approvedDoc.id}`, auth: null }).allowed,
          expected: false
        },
        {
          label: 'Non-admin signed-in GET draft daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${draftDoc.id}`, auth: { uid: PUBLIC_SIGNED_IN_UID } }).allowed,
          expected: false
        },
        {
          label: 'Suspended admin GET draft daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${draftDoc.id}`, auth: { uid: SUSPENDED_ADMIN_UID } }).allowed,
          expected: false
        },
        // 3. Public / non-admin / suspended users CANNOT create, update, publish, or delete records
        {
          label: 'Public CREATE daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'create', path: 'dcm_daily_publications/dcm-daily-2026-11-29', auth: null, incomingData: draftDoc }).allowed,
          expected: false
        },
        {
          label: 'Non-admin signed-in CREATE daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'create',
            path: 'dcm_daily_publications/dcm-daily-2026-11-29',
            auth: { uid: PUBLIC_SIGNED_IN_UID },
            incomingData: { ...draftDoc, id: 'dcm-daily-2026-11-29', createdByUid: PUBLIC_SIGNED_IN_UID, updatedByUid: PUBLIC_SIGNED_IN_UID }
          }).allowed,
          expected: false
        },
        {
          label: 'Suspended admin CREATE daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'create',
            path: 'dcm_daily_publications/dcm-daily-2026-11-29',
            auth: { uid: SUSPENDED_ADMIN_UID },
            incomingData: { ...draftDoc, id: 'dcm-daily-2026-11-29', createdByUid: SUSPENDED_ADMIN_UID, updatedByUid: SUSPENDED_ADMIN_UID }
          }).allowed,
          expected: false
        },
        {
          label: 'Public WRITE legacy cms/dcm_publications (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'update', path: 'cms/dcm_publications', auth: null, incomingData: { items: [] } }).allowed,
          expected: false
        },
        {
          label: 'Non-admin WRITE legacy cms/dcm_publications (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'update', path: 'cms/dcm_publications', auth: { uid: PUBLIC_SIGNED_IN_UID }, incomingData: { items: [] } }).allowed,
          expected: false
        },
        // 4. Only authorised administrators CAN write drafts & publish valid approved records
        {
          label: 'Active admin GET draft daily doc (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: `dcm_daily_publications/${draftDoc.id}`, auth: { uid: ACTIVE_ADMIN_UID } }).allowed,
          expected: true
        },
        {
          label: 'Active admin CREATE valid daily draft (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'create',
            path: 'dcm_daily_publications/dcm-daily-2026-11-28',
            auth: { uid: ACTIVE_ADMIN_UID },
            incomingData: makeValidDailyFirestoreDoc(
              createDailyDraft({
                assessmentDate: '2026-11-28',
                cutoffTimeWat: '17:00',
                sourcePub: baselineLegacyPub,
                createdByUid: ACTIVE_ADMIN_UID
              })
            )
          }).allowed,
          expected: true
        },
        {
          label: 'Active admin PUBLISH without approvalReference (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'update',
            path: `dcm_daily_publications/${draftDoc.id}`,
            auth: { uid: ACTIVE_ADMIN_UID },
            incomingData: {
              ...draftDoc,
              status: 'published',
              publishedAt: '2026-11-19T16:30:00.000Z',
              summary: 'Attempting publish with typed name only and no approvalReference.',
              approvalRecord: {
                approved: true,
                approvedByName: 'Manually Typed Name',
                approvedAt: '2026-11-19T16:10:00.000Z',
                recordedByUid: ACTIVE_ADMIN_UID,
                recordedAt: '2026-11-19T16:12:00.000Z'
              }
            }
          }).allowed,
          expected: false
        },
        {
          label: 'Active admin PUBLISH with spoofed recordedByUid != request.auth.uid (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'update',
            path: `dcm_daily_publications/${draftDoc.id}`,
            auth: { uid: ACTIVE_ADMIN_UID },
            incomingData: {
              ...draftDoc,
              status: 'published',
              publishedAt: '2026-11-19T16:30:00.000Z',
              summary: 'Attempting publish with spoofed recorder UID.',
              approvalRecord: {
                approved: true,
                approvalReference: 'AEO-RES-SPOOF',
                approvedByName: 'Research Director',
                approvedAt: '2026-11-19T16:10:00.000Z',
                recordedByUid: OWNER_UID,
                recordedAt: '2026-11-19T16:12:00.000Z'
              }
            }
          }).allowed,
          expected: false
        },
        {
          label: 'Active admin PUBLISH with complete approvalReference + recordedByUid + recordedAt (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'update',
            path: `dcm_daily_publications/${draftDoc.id}`,
            auth: { uid: ACTIVE_ADMIN_UID },
            incomingData: {
              ...draftDoc,
              status: 'published',
              publishedAt: '2026-11-19T16:30:00.000Z',
              summary: 'Research-approved daily assessment as of 19 November 2026, 17:00 WAT (UTC+01:00).',
              approvalRecord: {
                approved: true,
                approvalReference: 'AEO-RES-2026-11-19-FINAL',
                approvedByName: 'AEO Research Director',
                approvedAt: '2026-11-19T16:10:00.000Z',
                recordedByUid: ACTIVE_ADMIN_UID,
                recordedByEmail: 'admin@athenacentre.org',
                recordedAt: '2026-11-19T16:28:00.000Z',
                verificationMode: 'admin-recorded-reference'
              }
            }
          }).allowed,
          expected: true
        },
        // 5. Published records CANNOT be overwritten or deleted (even by Owner / Active Admin)
        {
          label: 'Owner UPDATE/overwrite published daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'update',
            path: `dcm_daily_publications/${publishedDoc.id}`,
            auth: { uid: OWNER_UID },
            incomingData: { ...publishedDoc, summary: 'Silent overwrite attempt on published record!' }
          }).allowed,
          expected: false
        },
        {
          label: 'Active admin UPDATE/overwrite published daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'update',
            path: `dcm_daily_publications/${publishedDoc.id}`,
            auth: { uid: ACTIVE_ADMIN_UID },
            incomingData: { ...publishedDoc, updatedByUid: ACTIVE_ADMIN_UID, summary: 'Silent overwrite attempt!' }
          }).allowed,
          expected: false
        },
        {
          label: 'Owner DELETE published daily doc (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'delete',
            path: `dcm_daily_publications/${publishedDoc.id}`,
            auth: { uid: OWNER_UID }
          }).allowed,
          expected: false
        },
        {
          label: 'Owner CREATE versioned correction revision (-r2) alongside immutable published doc (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, {
            operation: 'create',
            path: 'dcm_daily_publications/dcm-daily-2026-11-18-r2',
            auth: { uid: OWNER_UID },
            incomingData: makeValidDailyFirestoreDoc(
              createCorrectionDraft(publishedDoc as DcmPublication, [publishedDoc.id], OWNER_UID)
            )
          }).allowed,
          expected: true
        },
        // 6. Legacy CMS draft isolation: cms/dcm_publications is strictly admin-only; cms/dcm_publications_public is published-only public read
        {
          label: 'Public READ legacy cms/dcm_publications containing unpublished draft (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: 'cms/dcm_publications', auth: null }).allowed,
          expected: false
        },
        {
          label: 'Active admin READ legacy cms/dcm_publications (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: 'cms/dcm_publications', auth: { uid: ACTIVE_ADMIN_UID } }).allowed,
          expected: true
        },
        {
          label: 'Public READ published-only cms/dcm_publications_public (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: 'cms/dcm_publications_public', auth: null }).allowed,
          expected: true
        },
        {
          label: 'Public WRITE cms/dcm_publications_public (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'update', path: 'cms/dcm_publications_public', auth: null, incomingData: { items: [] } }).allowed,
          expected: false
        },
        {
          label: 'Active admin WRITE legacy cms/dcm_publications (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'update', path: 'cms/dcm_publications', auth: { uid: ACTIVE_ADMIN_UID }, incomingData: { items: INITIAL_DCM_PUBLICATIONS } }).allowed,
          expected: true
        },
        {
          label: 'Public READ legacy cms/reports (ALLOW)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: 'cms/reports', auth: null }).allowed,
          expected: true
        },
        {
          label: 'Global default deny on unmatched collection (DENY)',
          actual: evaluateFirestoreRequest(ruleset, store, { operation: 'get', path: 'unmatched_secret_collection/doc1', auth: { uid: OWNER_UID } }).allowed,
          expected: false
        }
      ];

      for (const a of assertions) {
        assert.equal(
          a.actual,
          a.expected,
          `Firestore rule check failed: "${a.label}" — expected ${a.expected ? 'ALLOW' : 'DENY'}, got ${a.actual ? 'ALLOW' : 'DENY'}`
        );
      }

      return `Executed ${assertions.length}/${assertions.length} security rule assertions directly against parsed /firestore.rules (all ALLOW/DENY verdicts matched).`;
    }
  );

  // =========================================================================
  // STAGE 2 MANDATORY TEST 9: Existing DCM Brief requests & Microsoft Graph email unaffected
  // =========================================================================
  await runTest(
    'Stage 2 Test 9',
    'Existing DCM Brief requests and Microsoft Graph email integration remain unaffected',
    async () => {
      const healthRes = await fetch('http://localhost:3000/api/health');
      assert.equal(healthRes.status, 200, `Expected HTTP 200 from /api/health, got ${healthRes.status}`);
      const healthJson = await healthRes.json();
      assert.equal(healthJson.status, 'ok');
      assert.equal(healthJson.emailConfigured, true);
      assert.equal(healthJson.emailProvider, 'microsoft-graph');
      assert.equal(healthJson.emailTransports?.microsoftGraph, true);

      // Non-destructive validation check on /api/dcm-brief-request (never sends unsolicited email)
      const badReqRes = await fetch('http://localhost:3000/api/dcm-brief-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: 'Test' })
      });
      assert.ok(
        badReqRes.status === 400 || badReqRes.status === 429,
        `Expected HTTP 400 (validation) or 429 (rate-limit active) from /api/dcm-brief-request, got ${badReqRes.status}`
      );
      const badReqJson = await badReqRes.json();
      assert.equal(typeof badReqJson.error, 'string');

      return `GET /api/health HTTP 200 (provider=${healthJson.emailProvider}, emailConfigured=true); POST /api/dcm-brief-request active (HTTP ${badReqRes.status}, JSON error guard verified).`;
    }
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\nStage 2 Test Summary: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected Stage 2 test runner error:', err);
  process.exit(1);
});
