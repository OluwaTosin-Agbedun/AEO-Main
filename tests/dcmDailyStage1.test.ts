import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_DCM_PUBLICATIONS } from '../src/data/dcmInitialData';
import { NIGERIA_37_JURISDICTIONS, DcmPublication } from '../src/types/dcm';
import {
  buildDailyPublicationId,
  carryForwardClassifications,
  createDailyDraft,
  diffClassificationsAgainstSource,
  formatDailyDateLabel,
  formatTimestampInWat,
  formatWatCutoff,
  validateDailyPublication
} from '../src/utils/dcmDaily';
import {
  getLatestDcmPublication,
  getPublishedDcmSorted
} from '../src/utils/dcmComparison';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

async function runTest(id: number, name: string, fn: () => Promise<string> | string) {
  try {
    const details = await fn();
    results.push({ id, name, passed: true, details });
    console.log(`[PASS] Test ${id}: ${name} — ${details}`);
  } catch (err: any) {
    results.push({ id, name, passed: false, details: err?.message || String(err) });
    console.error(`[FAIL] Test ${id}: ${name} — ${err?.message || String(err)}`);
  }
}

async function main() {
  const baselineLegacyPub = INITIAL_DCM_PUBLICATIONS[INITIAL_DCM_PUBLICATIONS.length - 1];
  assert.ok(baselineLegacyPub, 'Baseline legacy publication fixture must exist');

  // Test 1: Daily draft can be created and saved (isolated in-memory store, never exposed publicly while draft)
  await runTest(1, 'A daily draft can be created and saved', () => {
    const draft = createDailyDraft({
      assessmentDate: '2026-11-19',
      cutoffTimeWat: '17:00',
      sourcePub: baselineLegacyPub,
      existingIds: INITIAL_DCM_PUBLICATIONS.map((p) => p.id),
      createdByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2'
    });

    assert.equal(draft.id, 'dcm-daily-2026-11-19');
    assert.equal(draft.publicationFormat, 'daily');
    assert.equal(draft.status, 'draft');
    assert.equal(draft.isLatest, false);
    assert.equal(Object.keys(draft.classifications).length, 37);

    const validation = validateDailyPublication(draft, {
      isAuthorizedAdmin: true,
      sourcePub: baselineLegacyPub
    });
    assert.equal(validation.valid, true, `Draft validation errors: ${validation.errors.join('; ')}`);

    // Ensure draft is NOT visible publicly
    const publicList = getPublishedDcmSorted([...INITIAL_DCM_PUBLICATIONS, draft]);
    assert.equal(
      publicList.some((p) => p.id === draft.id),
      false,
      'Daily draft must NEVER appear in public published publications list'
    );

    // Ensure an 'approved' (unreleased) daily record is ALSO NOT visible publicly
    const approvedUnreleased: DcmPublication = {
      ...draft,
      status: 'approved',
      summary: 'Research-approved daily summary prepared for scheduled release.',
      approvalRecord: {
        approved: true,
        approvalReference: 'AEO-DCM-REF-2026-11-19-DRAFT',
        approvedByName: 'Head of Research',
        approvedAt: '2026-11-19T16:15:00Z',
        recordedByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2',
        recordedAt: '2026-11-19T16:16:00Z'
      }
    };
    const publicListWithApproved = getPublishedDcmSorted([...INITIAL_DCM_PUBLICATIONS, approvedUnreleased]);
    assert.equal(
      publicListWithApproved.some((p) => p.id === approvedUnreleased.id),
      false,
      'Approved-but-unpublished daily record must NOT appear publicly'
    );

    return `Draft ${draft.id} validated with 37 states; both draft and approved records excluded from public feed.`;
  });

  // Test 2: WAT cut-off displays correctly
  await runTest(2, 'The WAT cut-off displays correctly', () => {
    const validCutoff = formatWatCutoff('2026-11-19', '17:00');
    assert.equal(validCutoff.valid, true);
    assert.equal(validCutoff.isoWat, '2026-11-19T17:00:00+01:00');
    assert.equal(validCutoff.displayLabel, '19 November 2026, 17:00 WAT (UTC+01:00)');

    const publishedDisplay = formatTimestampInWat('2026-11-19T16:30:00.000Z');
    assert.equal(publishedDisplay, '19 November 2026, 17:30 WAT (UTC+01:00)');

    // Reject impossible calendar date and out-of-range time
    assert.equal(formatWatCutoff('2026-02-30', '17:00').valid, false);
    assert.equal(formatWatCutoff('2026-11-19', '25:99').valid, false);
    assert.equal(formatDailyDateLabel('2026-11-19'), '19 November 2026');

    return `Formatted "${validCutoff.displayLabel}" (${validCutoff.isoWat}) and publication timestamp "${publishedDisplay}".`;
  });

  // Test 3: Daily publication can retain all previously approved classifications
  await runTest(3, 'A daily publication can retain all previously approved classifications', () => {
    // Attach a supplied lastSubstantiveReviewDate on one state and omit on another
    const sourceWithReviewDate: DcmPublication = {
      ...baselineLegacyPub,
      classifications: {
        ...baselineLegacyPub.classifications,
        KD: {
          ...baselineLegacyPub.classifications.KD,
          lastSubstantiveReviewDate: '2026-10-14'
        }
      }
    };

    const carried = carryForwardClassifications(sourceWithReviewDate);
    assert.equal(Object.keys(carried).length, 37);

    for (const j of NIGERIA_37_JURISDICTIONS) {
      const src = sourceWithReviewDate.classifications[j.code];
      const dst = carried[j.code];
      assert.equal(dst.classification, src.classification, `Mismatch for ${j.code}`);
      assert.equal(dst.keyFinding || '', src.keyFinding || '', `Key finding altered for ${j.code}`);
      assert.equal(dst.carriedForward, true, `carriedForward must be true for ${j.code}`);
      assert.equal(dst.carriedForwardFromPublicationId, sourceWithReviewDate.id);
    }

    // Supplied review date preserved; omitted review date NOT fabricated
    assert.equal(carried.KD.lastSubstantiveReviewDate, '2026-10-14');
    assert.equal(carried.LA.lastSubstantiveReviewDate, undefined);

    const diff = diffClassificationsAgainstSource(carried, sourceWithReviewDate);
    assert.equal(diff.changedCodes.length, 0);
    assert.equal(diff.carriedForwardCount, 37);
    assert.equal(diff.updatedCount, 0);

    return 'All 37 classifications, findings, and supplied substantive review dates preserved verbatim with carriedForward=true.';
  });

  // Test 4: Quiet-day publication works
  await runTest(4, 'A quiet-day publication works', () => {
    const quietDraft = createDailyDraft({
      assessmentDate: '2026-11-20',
      cutoffTimeWat: '18:00',
      sourcePub: baselineLegacyPub,
      existingIds: INITIAL_DCM_PUBLICATIONS.map((p) => p.id),
      isQuietDay: true,
      createdByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2'
    });

    // Must NEVER auto-assert "no incidents occurred"
    assert.equal(quietDraft.summary, '');
    assert.equal(quietDraft.isQuietDay, true);
    assert.equal(quietDraft.carriedForwardAllStates, true);

    // Attempting to publish without an approved statement or approval record must fail
    const unapprovedCheck = validateDailyPublication(
      { ...quietDraft, status: 'published' },
      { isAuthorizedAdmin: true, sourcePub: baselineLegacyPub }
    );
    assert.equal(unapprovedCheck.valid, false);

    // Attempting to alter a state classification on a quiet-day update must fail
    const tamperedQuiet: DcmPublication = {
      ...quietDraft,
      status: 'published',
      summary: 'Daily update as of 20 November 2026, 18:00 WAT (UTC+01:00). All previously approved state classifications remain carried forward.',
      approvalRecord: {
        approved: true,
        approvalReference: 'AEO-DCM-QD-2026-11-20-BAD',
        approvedByName: 'AEO Research Desk',
        approvedAt: '2026-11-20T17:10:00Z',
        recordedByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2',
        recordedAt: '2026-11-20T17:11:00Z'
      },
      classifications: {
        ...quietDraft.classifications,
        LA: {
          ...quietDraft.classifications.LA,
          classification: 'Constrained',
          carriedForward: false
        }
      }
    };
    const tamperedCheck = validateDailyPublication(tamperedQuiet, {
      isAuthorizedAdmin: true,
      sourcePub: baselineLegacyPub
    });
    assert.equal(tamperedCheck.valid, false);

    // Valid Research-approved quiet-day publication passes and becomes latest published edition
    const approvedQuietPub: DcmPublication = {
      ...quietDraft,
      status: 'published',
      isLatest: true,
      publishedAt: '2026-11-20T17:15:00.000Z',
      summary: 'Daily update as of 20 November 2026, 18:00 WAT (UTC+01:00). Previously approved classifications across all 36 states and the FCT remain carried forward pending further verified assessments.',
      approvalRecord: {
        approved: true,
        approvedByName: 'Dr. Research Lead',
        approvedAt: '2026-11-20T17:10:00.000Z',
        approvalReference: 'AEO-DCM-QD-2026-11-20',
        recordedByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2',
        recordedAt: '2026-11-20T17:12:00.000Z',
        verificationMode: 'admin-recorded-reference'
      }
    };

    const validQuietCheck = validateDailyPublication(approvedQuietPub, {
      isAuthorizedAdmin: true,
      sourcePub: baselineLegacyPub
    });
    assert.equal(validQuietCheck.valid, true, validQuietCheck.errors.join('; '));

    const latest = getLatestDcmPublication([...INITIAL_DCM_PUBLICATIONS, approvedQuietPub]);
    assert.equal(latest?.id, approvedQuietPub.id);

    return `Quiet-day ${approvedQuietPub.id} rejected blank/tampered states, accepted Research-approved statement with WAT cut-off, and sorted as latest.`;
  });

  // Test 5: Unauthorised publishing is blocked (application layer + Firestore rules)
  await runTest(5, 'Unauthorised publishing is blocked', () => {
    const draft = createDailyDraft({
      assessmentDate: '2026-11-21',
      cutoffTimeWat: '17:00',
      sourcePub: baselineLegacyPub,
      createdByUid: 'unauthorised-public-user'
    });

    const unauthPublish = validateDailyPublication(
      {
        ...draft,
        status: 'published',
        summary: 'Attempted unauthorised public edit of daily DCM.',
        approvalRecord: {
          approved: true,
          approvalReference: 'UNAUTH-REF-001',
          approvedByName: 'Spoofed Name',
          approvedAt: '2026-11-21T16:00:00Z',
          recordedByUid: 'unauthorised-public-user',
          recordedAt: '2026-11-21T16:01:00Z'
        }
      },
      { isAuthorizedAdmin: false, sourcePub: baselineLegacyPub }
    );
    assert.equal(unauthPublish.valid, false);
    assert.ok(unauthPublish.errors.some((e) => e.toLowerCase().includes('unauthorised')));

    // Even an authorised admin cannot publish without recorded Research approval
    const noApprovalPublish = validateDailyPublication(
      {
        ...draft,
        status: 'published',
        summary: 'Admin attempt to publish without approval record.'
      },
      { isAuthorizedAdmin: true, sourcePub: baselineLegacyPub }
    );
    assert.equal(noApprovalPublish.valid, false);
    assert.ok(noApprovalPublish.errors.some((e) => e.toLowerCase().includes('approval')));

    // Verify firestore.rules enforces admin-only writes, approval gate, and published immutability
    const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    assert.ok(rulesText.includes('match /dcm_daily_publications/{publicationId}'));
    assert.ok(rulesText.includes('allow create: if isAuthorizedAdmin()'));
    assert.ok(rulesText.includes("existing().status != 'published'"));
    assert.ok(rulesText.includes('isValidDcmDailyApproval(data.approvalRecord)'));
    assert.ok(rulesText.includes("docId == 'dcm_publications' ? isAuthorizedAdmin() : true"));
    assert.ok(rulesText.includes('allow read, write: if false;'));

    return 'Unauthorised writes, unapproved publishes, and Firestore rule bypasses all blocked.';
  });

  // Test 6: Existing historical publications remain accessible and protected against overwrite
  await runTest(6, 'Existing historical publications remain accessible', () => {
    const publishedDaily: DcmPublication = {
      ...createDailyDraft({
        assessmentDate: '2026-11-19',
        cutoffTimeWat: '17:00',
        sourcePub: baselineLegacyPub,
        createdByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2'
      }),
      status: 'published',
      isLatest: true,
      publishedAt: '2026-11-19T16:30:00.000Z',
      summary: 'Research-approved daily update as of 19 November 2026, 17:00 WAT (UTC+01:00).',
      approvalRecord: {
        approved: true,
        approvalReference: 'AEO-DCM-REF-2026-11-19',
        approvedByName: 'Head of Research',
        approvedAt: '2026-11-19T16:20:00.000Z',
        recordedByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2',
        recordedAt: '2026-11-19T16:22:00.000Z',
        verificationMode: 'admin-recorded-reference'
      }
    };

    const combined = getPublishedDcmSorted([...INITIAL_DCM_PUBLICATIONS, publishedDaily]);
    // All existing legacy editions remain present and accessible before the new daily update
    for (const legacy of INITIAL_DCM_PUBLICATIONS) {
      assert.ok(
        combined.some((p) => p.id === legacy.id),
        `Historical legacy edition ${legacy.id} missing from published timeline`
      );
    }

    // Overwriting an existing published daily edition is blocked
    const overwriteAttempt = validateDailyPublication(publishedDaily, {
      isAuthorizedAdmin: true,
      existingDoc: publishedDaily,
      sourcePub: baselineLegacyPub
    });
    assert.equal(overwriteAttempt.valid, false);
    assert.ok(overwriteAttempt.errors.some((e) => e.toLowerCase().includes('immutable')));

    // Generating a new daily ID on the same date creates a distinct revision ID (-r2) instead of overwriting
    const secondId = buildDailyPublicationId('2026-11-19', [publishedDaily.id]);
    assert.equal(secondId, 'dcm-daily-2026-11-19-r2');

    return `${INITIAL_DCM_PUBLICATIONS.length} legacy editions intact alongside daily update; overwrite blocked and revision ID "${secondId}" generated.`;
  });

  // Test 7: No classification changes without approved data
  await runTest(7, 'No classification changes without approved data', () => {
    const draft = createDailyDraft({
      assessmentDate: '2026-11-22',
      cutoffTimeWat: '17:00',
      sourcePub: baselineLegacyPub,
      createdByUid: 's39PbuZxqdW1x63i0SsEVE7HqGQ2'
    });

    // Simulate a silent modification of a state classification while carriedForward remains true
    const silentChangeDraft: DcmPublication = {
      ...draft,
      classifications: {
        ...draft.classifications,
        KN: {
          ...draft.classifications.KN,
          classification: 'Severely constrained',
          carriedForward: true // Still flagged carriedForward despite changing!
        }
      }
    };

    const diff = diffClassificationsAgainstSource(silentChangeDraft.classifications, baselineLegacyPub);
    assert.deepEqual(diff.unapprovedSilentChanges, ['KN']);

    const validation = validateDailyPublication(silentChangeDraft, {
      isAuthorizedAdmin: true,
      sourcePub: baselineLegacyPub
    });
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes('KN')));

    // Verify carried-forward states have zero automatic classification changes on a new day
    const unmodifiedDiff = diffClassificationsAgainstSource(draft.classifications, baselineLegacyPub);
    assert.equal(unmodifiedDiff.changedCodes.length, 0);

    return 'Silent modification on carried-forward state (KN) rejected; new day produces 0 automatic state changes.';
  });

  // Test 8: Existing Microsoft 365 DCM Brief notifications remain operational
  await runTest(8, 'Existing Microsoft 365 DCM Brief notifications remain operational', async () => {
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert.equal(healthRes.status, 200, `Expected HTTP 200 from /api/health, got ${healthRes.status}`);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'ok');
    assert.equal(healthJson.emailConfigured, true);
    assert.equal(healthJson.emailProvider, 'microsoft-graph');
    assert.equal(healthJson.emailTransports?.microsoftGraph, true);

    // Non-destructive validation check on /api/dcm-brief-request (empty body should return HTTP 400 validation error, proving handler is live without sending an email)
    const validationRes = await fetch('http://localhost:3000/api/dcm-brief-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(validationRes.status, 400, `Expected HTTP 400 validation response from /api/dcm-brief-request, got ${validationRes.status}`);

    return `GET /api/health HTTP 200 (provider=${healthJson.emailProvider}, configured=${healthJson.emailConfigured}); POST /api/dcm-brief-request route active (HTTP 400 on empty payload).`;
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\nStage 1 Test Summary: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected test runner error:', err);
  process.exit(1);
});
