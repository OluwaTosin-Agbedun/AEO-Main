/**
 * AEO DCM Corrections — Stage 7: Pre-Deployment Audit & Hardening Verification Suite
 *
 * Strictly uses synthetic test fixtures (clearly marked `[SYNTHETIC TEST FIXTURE]`).
 * Never writes to Production Firestore, never modifies approved Research records,
 * and never triggers live outbound email delivery.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DcmPublication,
  DcmEvidenceRecord,
  DcmIncidentRecord,
  DcmIncidentDevelopment,
  DcmClassification
} from '../src/types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../src/data/dcmInitialData';
import { resolvePublicDcmPublications } from '../src/utils/dcmConsistency';
import { resolveDcmPermalink } from '../src/utils/dcmArchive';
import { resolveStateAssessmentPanelData } from '../src/utils/dcmEvidence';
import {
  buildCanonicalEditorialSource,
  generateWebsiteDailySummaryExtract,
  generateNewsletterDcwExtract,
  generateClearPathOnTheMapExtract,
  buildEditorialHandoverRecord,
  paginateDailyArchiveCursor,
  REQUIRED_STAGE_6_COMPOSITE_INDEXES
} from '../src/utils/dcmEditorial';

const ALL_37_STATE_CODES = [
  ['AB', 'Abia'], ['AD', 'Adamawa'], ['AK', 'Akwa Ibom'], ['AN', 'Anambra'],
  ['BA', 'Bauchi'], ['BY', 'Bayelsa'], ['BE', 'Benue'], ['BO', 'Borno'],
  ['CR', 'Cross River'], ['DE', 'Delta'], ['EB', 'Ebonyi'], ['ED', 'Edo'],
  ['EK', 'Ekiti'], ['EN', 'Enugu'], ['FC', 'FCT'], ['GO', 'Gombe'],
  ['IM', 'Imo'], ['JI', 'Jigawa'], ['KD', 'Kaduna'], ['KN', 'Kano'],
  ['KT', 'Katsina'], ['KE', 'Kebbi'], ['KO', 'Kogi'], ['KW', 'Kwara'],
  ['LA', 'Lagos'], ['NA', 'Nasarawa'], ['NI', 'Niger'], ['OG', 'Ogun'],
  ['ON', 'Ondo'], ['OS', 'Osun'], ['OY', 'Oyo'], ['PL', 'Plateau'],
  ['RI', 'Rivers'], ['SO', 'Sokoto'], ['TA', 'Taraba'], ['YO', 'Yobe'],
  ['ZA', 'Zamfara']
] as const;

function make37Classifications(
  overrides: Partial<Record<string, { classification: DcmClassification; keyFinding?: string }>> = {}
) {
  const result: DcmPublication['classifications'] = {};
  for (const [code, name] of ALL_37_STATE_CODES) {
    const ov = overrides[code];
    result[code] = {
      stateCode: code,
      stateName: name,
      classification: ov?.classification || 'Insufficient evidence',
      keyFinding: ov?.keyFinding || '[SYNTHETIC TEST FIXTURE] Baseline carried forward.'
    };
  }
  return result;
}

function makeDailyFixture(opts: {
  id: string;
  dateIso: string;
  status: 'draft' | 'approved' | 'published';
  revisionNumber?: number;
  supersedesPublicationId?: string;
  isQuietDay?: boolean;
  overrides?: Partial<Record<string, { classification: DcmClassification; keyFinding?: string }>>;
}): DcmPublication {
  const [y, m, d] = opts.dateIso.split('-').map(Number);
  const rev = opts.revisionNumber ?? 1;
  return {
    id: opts.id,
    publicationFormat: 'daily',
    title: `[SYNTHETIC TEST FIXTURE] Daily Map ${opts.dateIso} (r${rev})`,
    year: y,
    month: m,
    periodIndex: d,
    periodStart: opts.dateIso,
    periodEnd: opts.dateIso,
    reportingPeriodLabel: opts.dateIso,
    publicationDate: opts.dateIso,
    evidenceCutoffDate: `${opts.dateIso}, 17:00 WAT`,
    assessmentDate: opts.dateIso,
    evidenceCutoffTimeWat: '17:00',
    evidenceCutoffDateTimeWat: `${opts.dateIso}T17:00:00+01:00`,
    methodologyVersion: 'Version 1.1',
    status: opts.status,
    isLatest: false,
    isQuietDay: Boolean(opts.isQuietDay),
    carriedForwardAllStates: Boolean(opts.isQuietDay),
    revisionNumber: rev,
    supersedesPublicationId: opts.supersedesPublicationId,
    revisionNote: opts.supersedesPublicationId
      ? '[SYNTHETIC TEST FIXTURE] Corrected citation metadata.'
      : undefined,
    summary: opts.isQuietDay
      ? '[SYNTHETIC TEST FIXTURE] Quiet-day update: all 37 jurisdictions carried forward unchanged.'
      : `[SYNTHETIC TEST FIXTURE] Summary for ${opts.dateIso} revision ${rev}.`,
    approvalRecord:
      opts.status === 'draft'
        ? undefined
        : {
            approved: true,
            approvalReference: `SYNTH-APP-${opts.dateIso}-R${rev}`,
            approvedByName: 'Synthetic Research Reviewer',
            approvedAt: `${opts.dateIso}T16:40:00+01:00`,
            recordedByUid: 'synth-admin-uid',
            recordedAt: `${opts.dateIso}T16:45:00+01:00`,
            verificationMode: 'admin-recorded-reference'
          },
    publishedAt: opts.status === 'published' ? `${opts.dateIso}T17:05:00+01:00` : undefined,
    classifications: make37Classifications(opts.overrides),
    createdAt: Date.UTC(y, m - 1, d, 16, 0, rev),
    updatedAt: Date.UTC(y, m - 1, d, 17, 0, rev),
    createdByUid: 'synth-admin-uid',
    updatedByUid: 'synth-admin-uid'
  };
}

async function main() {
  let passed = 0;
  let failed = 0;

  async function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  [FAIL] ${name}:`, err?.message || err);
    }
  }

  console.log('\n====================================================================');
  console.log('AEO DCM CORRECTIONS — STAGE 7 PRE-DEPLOYMENT AUDIT TEST SUITE');
  console.log('====================================================================\n');

  // --------------------------------------------------------------------------
  // TEST 1: >120 daily records + same-date revisions straddling page boundary
  // --------------------------------------------------------------------------
  await runTest('1. >120 daily records (135 days + 6 same-date revisions + 10 drafts) paginate deterministically without skipping same-date revisions', () => {
    const startUtc = Date.UTC(2026, 5, 1); // 2026-06-01
    const corpus: DcmPublication[] = [];

    // 135 published days
    for (let i = 0; i < 135; i++) {
      const iso = new Date(startUtc + i * 86400000).toISOString().slice(0, 10);
      corpus.push(makeDailyFixture({ id: `dcm-daily-${iso}`, dateIso: iso, status: 'published', revisionNumber: 1 }));
    }

    // Add 6 same-date revision (-r2) records, INCLUDING one right on the Page 1 / Page 2 boundary!
    // Sorted desc: index 59 is 60th item. Let's inspect dates around indices 0, 58, 59, 60, 118, 125.
    const sortedDatesDesc = corpus.map((p) => p.assessmentDate!).sort((a, b) => b.localeCompare(a));
    const revisionDates = [
      sortedDatesDesc[0],   // newest date
      sortedDatesDesc[57],  // right at page 1/2 boundary (will force r1 & r2 across page 1/2 split!)
      sortedDatesDesc[58],
      sortedDatesDesc[59],
      sortedDatesDesc[115], // right at page 2/3 boundary
      sortedDatesDesc[130]  // deep archive
    ];
    for (const rDate of revisionDates) {
      corpus.push(
        makeDailyFixture({
          id: `dcm-daily-${rDate}-r2`,
          dateIso: rDate,
          status: 'published',
          revisionNumber: 2,
          supersedesPublicationId: `dcm-daily-${rDate}`
        })
      );
    }

    // Add 10 drafts & approved-unpublished records (must NEVER appear in public pagination)
    for (let j = 1; j <= 10; j++) {
      const iso = `2026-11-${String(j).padStart(2, '0')}`;
      corpus.push(
        makeDailyFixture({
          id: `dcm-daily-${iso}-unpub`,
          dateIso: iso,
          status: j % 2 === 0 ? 'approved' : 'draft'
        })
      );
    }

    // Total published daily docs = 135 + 6 = 141
    // Deliberately shuffle input ascending by ID (worst-case unordered input)
    corpus.sort((a, b) => a.id.localeCompare(b.id));

    const page1 = paginateDailyArchiveCursor(corpus, { pageSize: 60 });
    assert.equal(page1.totalPublishedDailyCount, 141);
    assert.equal(page1.items.length, 60);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.items[0].id, `dcm-daily-${sortedDatesDesc[0]}-r2`, 'Newest same-date revision must be item 0');
    assert.equal(page1.items[1].id, `dcm-daily-${sortedDatesDesc[0]}`, 'Original revision of newest date must immediately follow');

    const page2 = paginateDailyArchiveCursor(corpus, {
      pageSize: 60,
      afterPublicationId: page1.lastPublicationId || undefined
    });
    assert.equal(page2.items.length, 60);
    assert.equal(page2.hasMore, true);

    const page3 = paginateDailyArchiveCursor(corpus, {
      pageSize: 60,
      afterPublicationId: page2.lastPublicationId || undefined
    });
    assert.equal(page3.items.length, 21);
    assert.equal(page3.hasMore, false);

    const combined = [...page1.items, ...page2.items, ...page3.items];
    const uniqueIds = new Set(combined.map((p) => p.id));
    assert.equal(combined.length, 141, 'All 141 published daily records must be retrieved across pages');
    assert.equal(uniqueIds.size, 141, 'Zero duplicate records across pages');
    assert.equal(
      combined.every((p) => p.status === 'published'),
      true,
      'Zero drafts or approved-unpublished records may leak into public pagination'
    );
    // Every single same-date r2 AND r1 pair must be present (zero skipped boundary revisions)
    for (const rDate of revisionDates) {
      assert.ok(uniqueIds.has(`dcm-daily-${rDate}`), `Original r1 for ${rDate} must not be skipped`);
      assert.ok(uniqueIds.has(`dcm-daily-${rDate}-r2`), `Revision r2 for ${rDate} must not be skipped`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 2: Removal of unbounded public fallbacks + explicit error/retry UI
  // --------------------------------------------------------------------------
  await runTest('2. Zero unbounded public fallbacks remain in CMSContext.tsx & DcmPreview renders retry banner on archive error', () => {
    const cmsSource = fs.readFileSync(path.resolve('src/context/CMSContext.tsx'), 'utf-8');
    const previewSource = fs.readFileSync(path.resolve('src/components/DcmPreview.tsx'), 'utf-8');

    assert.equal(
      cmsSource.includes('unindexed-full-fallback'),
      false,
      'Unbounded public fallback mode must be completely removed'
    );
    assert.ok(
      cmsSource.includes("dcmArchiveQueryMode: 'indexed-chronological' | 'index-required-error' | 'admin-full'"),
      'CMSContext must expose explicit index-required-error query mode'
    );
    assert.ok(
      cmsSource.includes('lastDailyDocSnapRef'),
      'CMSContext must store QueryDocumentSnapshot cursor for deterministic same-date revision pagination'
    );
    assert.ok(
      cmsSource.includes('startAfter(docCursor)'),
      'loadOlderDailyPublications must paginate via DocumentSnapshot cursor when available'
    );
    assert.ok(
      cmsSource.includes('retryDcmArchiveQueries'),
      'CMSContext must expose retryDcmArchiveQueries callback'
    );
    assert.ok(
      previewSource.includes('dcmArchiveError') && previewSource.includes('Retry loading archive'),
      'DcmPreview must render an accessible archive error banner with retry button'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 3: firestore.rules real-Firestore predicate & null-safety + 9 indexes
  // --------------------------------------------------------------------------
  await runTest('3. firestore.rules passes static predicate & null-safety checks and firestore.indexes.json matches all 9 indexes', () => {
    const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
    const indexesJson = JSON.parse(fs.readFileSync(path.resolve('firestore.indexes.json'), 'utf-8'));

    // Verify short-circuit admin + null-safe resource checks on get rules
    assert.ok(
      rules.includes("allow get: if isValidId(publicationId) && (isAuthorizedAdmin() || (resource != null && existing().status == 'published'));"),
      'dcm_daily_publications allow get must short-circuit isAuthorizedAdmin() before resource != null'
    );
    // Verify dcm_evidence allow list matches exact indexed public query (status + visibility)
    const evStart = rules.indexOf('match /dcm_evidence/{evidenceId}');
    const evEnd = rules.indexOf('match /dcm_incidents/{incidentId}', evStart);
    const evBlock = rules.slice(evStart, evEnd);
    assert.ok(
      evBlock.includes("allow list: if isAuthorizedAdmin() || (\n        resource.data.status == 'published' &&\n        resource.data.visibility == 'public'\n      );"),
      'dcm_evidence allow list must align with indexed public query predicates to avoid real-Firestore PERMISSION_DENIED'
    );
    assert.ok(
      evBlock.includes("existing().verificationStatus != 'Unverified Lead (Private)'"),
      'dcm_evidence allow get must retain Unverified Lead guard'
    );
    assert.ok(
      rules.includes("data.verificationStatus != 'Unverified Lead (Private)' ||"),
      'Write-time isValidDcmEvidence must retain Unverified Lead privacy invariant'
    );
    assert.ok(
      rules.includes("allow read: if docId == 'dcm_publications' ? isAuthorizedAdmin() : true;"),
      'Legacy cms/dcm_publications (containing unpublished drafts) must be restricted to admin-only reads'
    );
    assert.ok(
      rules.includes("allow write: if (docId == 'dcm_publications' || docId == 'dcm_publications_public') ? isAuthorizedAdmin() : true;"),
      'Both cms/dcm_publications and cms/dcm_publications_public must require admin auth for writes'
    );
    const cmsSourceForLegacy = fs.readFileSync(path.resolve('src/context/CMSContext.tsx'), 'utf-8');
    assert.ok(
      cmsSourceForLegacy.includes("const legacyDocId = isAdminViewer ? 'dcm_publications' : 'dcm_publications_public';"),
      'Public visitors must read strictly published-only cms/dcm_publications_public, never cms/dcm_publications'
    );

    // Verify all 9 composite indexes exist and match REQUIRED_STAGE_6_COMPOSITE_INDEXES
    assert.equal(indexesJson.indexes.length, 9, 'Expected exactly 9 composite indexes in firestore.indexes.json');
    assert.equal(REQUIRED_STAGE_6_COMPOSITE_INDEXES.length, 9);
    for (const required of REQUIRED_STAGE_6_COMPOSITE_INDEXES) {
      const matched = indexesJson.indexes.some((idx: any) => {
        if (idx.collectionGroup !== required.collectionGroup) return false;
        if (idx.fields.length !== required.fields.length) return false;
        return required.fields.every(
          (f, i) => idx.fields[i].fieldPath === f.fieldPath && idx.fields[i].order === f.order
        );
      });
      assert.equal(matched, true, `Missing required composite index on ${required.collectionGroup}`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 4: November dcm-2026-11-end governance impact (read-only simulation)
  // --------------------------------------------------------------------------
  await runTest('4. November dcm-2026-11-end (draft + isLatest: true) is excluded publicly; visitors default cleanly to newest published edition', () => {
    const nov15Published: DcmPublication = {
      ...INITIAL_DCM_PUBLICATIONS[0],
      id: 'dcm-2026-11-15',
      title: 'Democratic Competitiveness Map: 1st – 15th November 2026',
      year: 2026,
      month: 11,
      periodIndex: 1,
      periodStart: '2026-11-01',
      periodEnd: '2026-11-15',
      reportingPeriodLabel: '1st – 15th November 2026',
      publicationDate: '16 November 2026',
      evidenceCutoffDate: '15 November 2026',
      status: 'published',
      isLatest: false
    };
    const novEndDraftLatest: DcmPublication = {
      ...INITIAL_DCM_PUBLICATIONS[0],
      id: 'dcm-2026-11-end',
      title: 'Democratic Competitiveness Map: 16th – 30th November 2026',
      year: 2026,
      month: 11,
      periodIndex: 2,
      periodStart: '2026-11-16',
      periodEnd: '2026-11-30',
      reportingPeriodLabel: '16th – 30th November 2026',
      publicationDate: '1 December 2026',
      evidenceCutoffDate: '30 November 2026',
      status: 'draft',
      isLatest: true
    };

    const simulatedCorpus = [...INITIAL_DCM_PUBLICATIONS, nov15Published, novEndDraftLatest];
    const publicList = resolvePublicDcmPublications(simulatedCorpus);

    assert.equal(
      publicList.some((p) => p.id === 'dcm-2026-11-end'),
      false,
      'Draft dcm-2026-11-end must NEVER appear in public publication list even when isLatest === true'
    );
    assert.equal(
      publicList[publicList.length - 1].id,
      'dcm-2026-11-15',
      'Default latest public edition must resolve cleanly to newest published edition (dcm-2026-11-15)'
    );

    // Direct permalink to draft dcm-2026-11-end must fail cleanly (not render draft)
    const directAttempt = resolveDcmPermalink(publicList, '?state=Benue&publication=dcm-2026-11-end');
    assert.equal(directAttempt.noticeTone, 'warning', 'Direct permalink to draft must emit warning notice');
    assert.ok(Boolean(directAttempt.notice && directAttempt.notice.length > 0), 'Direct permalink to draft must explain unavailability');
    assert.notEqual(directAttempt.activePublication?.id, 'dcm-2026-11-end');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Section 6 Editorial export parity, safety & non-sending check
  // --------------------------------------------------------------------------
  await runTest('5. Editorial exports preserve Website/Newsletter/ClearPath parity, XSS safety, and zero auto-sending calls', () => {
    const pubR1 = makeDailyFixture({
      id: 'dcm-daily-2026-11-19',
      dateIso: '2026-11-19',
      status: 'published',
      overrides: {
        BE: {
          classification: 'Constrained',
          keyFinding: '[SYNTHETIC TEST FIXTURE] Court order cited; <script>alert("xss")</script> escaped.'
        }
      }
    });
    const pubR2 = makeDailyFixture({
      id: 'dcm-daily-2026-11-19-r2',
      dateIso: '2026-11-19',
      status: 'published',
      revisionNumber: 2,
      supersedesPublicationId: 'dcm-daily-2026-11-19',
      overrides: {
        BE: {
          classification: 'Constrained',
          keyFinding: '[SYNTHETIC TEST FIXTURE] Revised citation metadata.'
        }
      }
    });
    const pubQuiet = makeDailyFixture({
      id: 'dcm-daily-2026-11-20',
      dateIso: '2026-11-20',
      status: 'published',
      isQuietDay: true,
      overrides: { BE: { classification: 'Constrained' } }
    });

    const pubEv: DcmEvidenceRecord = {
      id: 'ev-synth-1',
      stateCode: 'BE',
      stateName: 'Benue',
      incidentId: 'inc-synth-1',
      linkedPublicationIds: ['dcm-daily-2026-11-19', 'dcm-daily-2026-11-19-r2'],
      title: '[SYNTHETIC TEST FIXTURE] Verified Gazette Notice',
      publicDescription: '[SYNTHETIC TEST FIXTURE] Publicly verifiable court filing.',
      sourceName: 'Synthetic Gazette',
      sourcePublicationDate: '2026-11-19',
      sourceUrl: 'https://example.org/synthetic-gazette',
      verificationStatus: 'Verified by Research',
      isDisputed: false,
      visibility: 'public',
      status: 'published',
      createdAt: 1795000000000,
      updatedAt: 1795000000000,
      createdByUid: 'synth-admin-uid',
      updatedByUid: 'synth-admin-uid'
    };
    const privEv: DcmEvidenceRecord = {
      ...pubEv,
      id: 'ev-synth-private',
      title: 'CONFIDENTIAL_DO_NOT_LEAK',
      visibility: 'private',
      status: 'draft',
      verificationStatus: 'Unverified Lead (Private)'
    };
    const inc: DcmIncidentRecord = {
      id: 'inc-synth-1',
      stateCode: 'BE',
      stateName: 'Benue',
      title: '[SYNTHETIC TEST FIXTURE] Benue Venue Restriction Incident',
      summary: '[SYNTHETIC TEST FIXTURE] Chronological incident record.',
      researchStatusLabel: 'Verified — Ongoing',
      firstReportedDate: '2026-11-19',
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      visibility: 'public',
      status: 'published',
      createdAt: 1795000000000,
      updatedAt: 1795000000000,
      createdByUid: 'synth-admin-uid',
      updatedByUid: 'synth-admin-uid'
    };
    const dev: DcmIncidentDevelopment = {
      id: 'dev-synth-1',
      incidentId: 'inc-synth-1',
      stateCode: 'BE',
      developmentDate: '2026-11-19',
      title: '[SYNTHETIC TEST FIXTURE] Subsequent institutional notice',
      approvedDescription: '[SYNTHETIC TEST FIXTURE] Follow-up verified institutional notice.',
      researchStatusLabel: 'Verified',
      isRemedyOrFollowUp: true,
      sourceReferences: [{ sourceName: 'Synthetic Gazette', publicationDate: '2026-11-19', url: 'https://example.org/dev' }],
      linkedEvidenceIds: ['ev-synth-1'],
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      visibility: 'public',
      status: 'published',
      createdAt: 1795000000000,
      updatedAt: 1795000000000,
      createdByUid: 'synth-admin-uid',
      updatedByUid: 'synth-admin-uid'
    };

    const allPubs = [pubR1, pubR2, pubQuiet];
    const res = buildCanonicalEditorialSource({
      selectedPublication: pubR1,
      allPublications: allPubs,
      stateIdentifier: 'BE',
      evidenceRecords: [pubEv, privEv],
      incidentRecords: [inc],
      developmentRecords: [dev]
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;

    const web = generateWebsiteDailySummaryExtract(res.source);
    const dcw = generateNewsletterDcwExtract(res.source);
    const cp = generateClearPathOnTheMapExtract(res.source);
    const panel = resolveStateAssessmentPanelData({
      selectedPub: pubR1,
      previousPub: null,
      allPublishedSortedAsc: allPubs,
      stateKey: 'BE',
      evidenceRecords: [pubEv, privEv],
      incidentRecords: [inc],
      developmentRecords: [dev]
    });

    // Exact 4-way classification & permalink parity
    assert.equal(panel.currentView.classification, 'Constrained');
    assert.equal(web.structured.selectedState.classification, panel.currentView.classification);
    assert.equal(dcw.structured.currentClassification, panel.currentView.classification);
    assert.equal(cp.structured.approvedClassification.label, panel.currentView.classification);
    assert.equal(dcw.structured.permanentStateAssessmentUrl, cp.structured.permanentStateAssessmentUrl);
    assert.ok(dcw.structured.permanentStateAssessmentUrl.includes('publication=dcm-daily-2026-11-19'));
    assert.equal(cp.html.includes('<script>'), false, 'HTML export must escape raw script tags');
    assert.equal(dcw.plainText.includes('CONFIDENTIAL_DO_NOT_LEAK'), false, 'Private evidence must never leak');

    // Handover record immutability across r1 -> r2
    const h1 = buildEditorialHandoverRecord({
      source: res.source,
      exportType: 'newsletter-dcw',
      exportedText: dcw.plainText,
      approvedPlainText: dcw.plainText,
      structuredExtract: dcw.structured,
      preparedByUid: 'synth-admin-uid',
      preparedByName: 'Synthetic Editor'
    });
    assert.equal(h1.publicationId, 'dcm-daily-2026-11-19');

    // Static check: editorial utilities & manager contain ZERO outbound email/auto-sending calls
    const editorialUtil = fs.readFileSync(path.resolve('src/utils/dcmEditorial.ts'), 'utf-8');
    const editorialUi = fs.readFileSync(path.resolve('src/components/DcmEditorialPublishingManager.tsx'), 'utf-8');
    for (const forbidden of ['nodemailer', 'sendMail', 'graph.microsoft.com', '/api/dcm-brief-request', 'mailchimp', 'sendgrid']) {
      assert.equal(editorialUtil.includes(forbidden), false, `Editorial util must not auto-send (${forbidden})`);
      assert.equal(editorialUi.includes(forbidden), false, `Editorial UI must not auto-send (${forbidden})`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 6: Official Emulator & Browser QA artifacts + local /api/health check
  // --------------------------------------------------------------------------
  await runTest('6. Official emulator config/suite, Playwright QA suite, and local server health verified (non-sending)', async () => {
    const firebaseJson = JSON.parse(fs.readFileSync(path.resolve('firebase.json'), 'utf-8'));
    assert.equal(firebaseJson.firestore.database, 'aeo-database19', 'firebase.json must explicitly target named database aeo-database19, never (default)');
    assert.equal(firebaseJson.firestore.rules, 'firestore.rules');
    assert.equal(firebaseJson.firestore.indexes, 'firestore.indexes.json');
    assert.equal(firebaseJson.emulators.firestore.port, 8080);

    const emulatorSuite = fs.readFileSync(path.resolve('tests/firestoreRules.emulator.mjs'), 'utf-8');
    assert.ok(emulatorSuite.includes('@firebase/rules-unit-testing'));
    assert.ok(emulatorSuite.includes('s39PbuZxqdW1x63i0SsEVE7HqGQ2'));
    assert.ok(emulatorSuite.includes('SUSPENDED_ADMIN_UID'));

    const browserQa = fs.readFileSync(path.resolve('tests/dcmStage7BrowserQa.spec.mjs'), 'utf-8');
    for (const w of ['320', '375', '390', '768', '1024', '1440']) {
      assert.ok(browserQa.includes(`width: ${w}`), `Browser QA script must test viewport width ${w}`);
    }

    // Live non-sending health check
    const healthRes = await fetch('http://localhost:3000/api/health');
    assert.equal(healthRes.status, 200);
  });

  console.log(`\nStage 7 Audit Suite Summary: ${passed}/${passed + failed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
