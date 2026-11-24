/**
 * AEO DCM Corrections — Stage 7: Official Firebase Firestore Rules Emulator Suite
 *
 * REQUIRES:
 *   - Java 17+ JDK installed on the runner host
 *   - Firebase CLI (`firebase --version`)
 *   - `@firebase/rules-unit-testing` and `firebase` available in node_modules
 *
 * RUN COMMAND (from repository root, NEVER against Production):
 *   npm install --no-save @firebase/rules-unit-testing
 *   firebase emulators:exec --only firestore --project aeo-dcm-staging-emulator "node tests/firestoreRules.emulator.mjs"
 *
 * PERSONAS TESTED (all 5 required by Stage 7 Section 2):
 *   1. Unauthenticated visitor
 *   2. Ordinary authenticated user (signed-in, not in /cms_admins)
 *   3. Suspended administrator (/cms_admins/{uid} with status: 'Suspended')
 *   4. Active administrator (/cms_admins/{uid} with status: 'Active')
 *   5. Owner UID ('s39PbuZxqdW1x63i0SsEVE7HqGQ2')
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ID = 'aeo-dcm-staging-emulator';
const OWNER_UID = 's39PbuZxqdW1x63i0SsEVE7HqGQ2';
const ACTIVE_ADMIN_UID = 'active-admin-uid-001';
const SUSPENDED_ADMIN_UID = 'suspended-admin-uid-002';
const ORDINARY_USER_UID = 'ordinary-user-uid-003';

const STATE_CODES = [
  'AB', 'AD', 'AK', 'AN', 'BA', 'BY', 'BE', 'BO', 'CR', 'DE',
  'EB', 'ED', 'EK', 'EN', 'FC', 'GO', 'IM', 'JI', 'KD', 'KN',
  'KT', 'KE', 'KO', 'KW', 'LA', 'NA', 'NI', 'OG', 'ON', 'OS',
  'OY', 'PL', 'RI', 'SO', 'TA', 'YO', 'ZA'
];

function build37Classifications() {
  const map = {};
  for (const code of STATE_CODES) {
    map[code] = {
      stateCode: code,
      stateName: code,
      classification: 'Insufficient evidence',
      keyFinding: '[SYNTHETIC EMULATOR FIXTURE] Carried forward.'
    };
  }
  return map;
}

function makeDailyDoc(id, { status = 'draft', uid = ACTIVE_ADMIN_UID, withApproval = false, revisionNumber = 1, supersedesPublicationId } = {}) {
  const now = 1795000000000;
  const doc = {
    id,
    publicationFormat: 'daily',
    title: `[SYNTHETIC EMULATOR FIXTURE] Daily Map ${id}`,
    year: 2026,
    month: 11,
    periodIndex: 19,
    periodStart: '2026-11-19',
    periodEnd: '2026-11-19',
    reportingPeriodLabel: '19 November 2026',
    publicationDate: '19 November 2026',
    evidenceCutoffDate: '19 November 2026, 17:00 WAT',
    assessmentDate: '2026-11-19',
    evidenceCutoffTimeWat: '17:00',
    evidenceCutoffDateTimeWat: '2026-11-19T17:00:00+01:00',
    methodologyVersion: 'Version 1.1',
    status,
    isLatest: false,
    summary: '[SYNTHETIC EMULATOR FIXTURE] Daily assessment summary for emulator security testing.',
    classifications: build37Classifications(),
    revisionNumber,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
    updatedByUid: uid
  };
  if (supersedesPublicationId) {
    doc.supersedesPublicationId = supersedesPublicationId;
  }
  if (withApproval) {
    doc.approvalRecord = {
      approved: true,
      approvalReference: 'SYNTH-EMULATOR-APP-2026-11-19',
      approvedByName: 'Synthetic Research Lead',
      approvedAt: '2026-11-19T16:45:00+01:00',
      recordedByUid: uid,
      recordedAt: '2026-11-19T16:50:00+01:00',
      verificationMode: 'admin-recorded-reference'
    };
  }
  if (status === 'published') {
    doc.publishedAt = '2026-11-19T17:05:00+01:00';
  }
  return doc;
}

function makeEvidenceDoc(id, { status = 'published', visibility = 'public', verificationStatus = 'Verified by Research', uid = ACTIVE_ADMIN_UID } = {}) {
  const now = 1795000000000;
  const doc = {
    id,
    stateCode: 'BE',
    stateName: 'Benue',
    linkedPublicationIds: ['dcm-daily-2026-11-19-pub'],
    title: `[SYNTHETIC EMULATOR FIXTURE] Evidence ${id}`,
    publicDescription: '[SYNTHETIC EMULATOR FIXTURE] Approved public description for security rules verification.',
    sourceName: 'Synthetic Gazette',
    sourcePublicationDate: '2026-11-19',
    sourceUrl: 'https://example.org/synthetic-evidence',
    verificationStatus,
    isDisputed: false,
    visibility,
    status,
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
    updatedByUid: uid
  };
  if (status !== 'draft') {
    doc.approvalRecord = {
      approved: true,
      approvalReference: 'SYNTH-EMULATOR-EV-2026-11-19',
      approvedByName: 'Synthetic Research Lead',
      approvedAt: '2026-11-19T16:45:00+01:00',
      recordedByUid: uid,
      recordedAt: '2026-11-19T16:50:00+01:00',
      verificationMode: 'admin-recorded-reference'
    };
  }
  if (status === 'published') {
    doc.publishedAt = '2026-11-19T17:05:00+01:00';
  }
  return doc;
}

function makeHandoverDoc(id, uid = ACTIVE_ADMIN_UID) {
  const now = 1795000000000;
  return {
    id,
    publicationId: 'dcm-daily-2026-11-19-pub',
    publicationAssessmentDate: '2026-11-19',
    stateCode: 'BE',
    stateName: 'Benue',
    exportType: 'newsletter-dcw',
    preparedByUid: uid,
    preparedByName: 'Synthetic Editor',
    exportedAtIso: '2026-11-19T17:30:00.000Z',
    exportedAtWatLabel: '19 November 2026, 18:30 WAT',
    handoverStatus: 'prepared',
    recipientTeam: 'AEO Daily Newsletter Desk',
    permanentRecordUrl: 'https://aeo.athenacentre.org/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19-pub',
    sourceApprovalReference: 'SYNTH-EMULATOR-APP-2026-11-19',
    governanceNotice: 'Handover does not represent new Research approval. Source classifications remain governed by Research.',
    hasEditorialDraftEdits: false,
    snapshotPayload: JSON.stringify({ publicationId: 'dcm-daily-2026-11-19-pub', state: 'Benue' }),
    createdAt: now,
    updatedAt: now,
    createdByUid: uid,
    updatedByUid: uid
  };
}

async function main() {
  let rulesUnitTesting;
  let firestoreMod;
  try {
    rulesUnitTesting = await import('@firebase/rules-unit-testing');
    firestoreMod = await import('firebase/firestore');
  } catch (err) {
    console.error('ERROR: Missing @firebase/rules-unit-testing or firebase SDK.');
    console.error('Install temporarily with: npm install --no-save @firebase/rules-unit-testing');
    console.error('Then run under Firebase Emulator (requires Java 17+):');
    console.error('  firebase emulators:exec --only firestore --project aeo-dcm-staging-emulator "node tests/firestoreRules.emulator.mjs"');
    process.exit(2);
  }

  const { initializeTestEnvironment, assertSucceeds, assertFails } = rulesUnitTesting;
  const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs } = firestoreMod;

  const rulesText = fs.readFileSync(path.resolve('firestore.rules'), 'utf-8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: rulesText,
      host: '127.0.0.1',
      port: 8080
    }
  });

  let passed = 0;
  let failed = 0;

  async function runCheck(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${name}:`, err?.message || err);
    }
  }

  try {
    // Seed baseline documents bypassing security rules
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'cms_admins', ACTIVE_ADMIN_UID), { status: 'Active', email: 'active@example.org' });
      await setDoc(doc(db, 'cms_admins', SUSPENDED_ADMIN_UID), { status: 'Suspended', email: 'suspended@example.org' });

      await setDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-19-pub'), makeDailyDoc('dcm-daily-2026-11-19-pub', { status: 'published', withApproval: true }));
      await setDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-20-draft'), makeDailyDoc('dcm-daily-2026-11-20-draft', { status: 'draft' }));
      await setDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-21-approved'), makeDailyDoc('dcm-daily-2026-11-21-approved', { status: 'approved', withApproval: true }));

      await setDoc(doc(db, 'dcm_evidence', 'ev-pub-public'), makeEvidenceDoc('ev-pub-public', { status: 'published', visibility: 'public' }));
      await setDoc(doc(db, 'dcm_evidence', 'ev-pub-private'), makeEvidenceDoc('ev-pub-private', { status: 'published', visibility: 'private' }));
      await setDoc(doc(db, 'dcm_evidence', 'ev-draft-public'), makeEvidenceDoc('ev-draft-public', { status: 'draft', visibility: 'public' }));
      await setDoc(doc(db, 'dcm_evidence', 'ev-unverified-private'), makeEvidenceDoc('ev-unverified-private', { status: 'draft', visibility: 'private', verificationStatus: 'Unverified Lead (Private)' }));

      await setDoc(doc(db, 'dcm_private_notes', 'note-conf-001'), {
        id: 'note-conf-001',
        targetType: 'evidence',
        targetId: 'ev-pub-public',
        stateCode: 'BE',
        confidentialNotes: '[SYNTHETIC] Strictly internal researcher note',
        confidentialContacts: '0800-SYNTH-PRIVATE',
        createdAt: 1795000000000,
        updatedAt: 1795000000000,
        createdByUid: ACTIVE_ADMIN_UID,
        updatedByUid: ACTIVE_ADMIN_UID
      });

      await setDoc(doc(db, 'dcm_editorial_handovers', 'handover-001'), makeHandoverDoc('handover-001', ACTIVE_ADMIN_UID));

      // Seed legacy cms/dcm_publications (contains unpublished November draft) vs published-only projection
      await setDoc(doc(db, 'cms', 'dcm_publications'), {
        items: [
          { id: 'dcm-2026-11-15', status: 'published', isLatest: false },
          { id: 'dcm-2026-11-end', status: 'draft', isLatest: true, summary: '[SYNTHETIC] Private draft' }
        ],
        updatedAt: 1795000000000
      });
      await setDoc(doc(db, 'cms', 'dcm_publications_public'), {
        items: [{ id: 'dcm-2026-11-15', status: 'published', isLatest: true }],
        updatedAt: 1795000000000
      });
    });

    const anonDb = testEnv.unauthenticatedContext().firestore();
    const ordinaryDb = testEnv.authenticatedContext(ORDINARY_USER_UID, { email: 'reader@example.org' }).firestore();
    const suspendedDb = testEnv.authenticatedContext(SUSPENDED_ADMIN_UID, { email: 'suspended@example.org' }).firestore();
    const activeAdminDb = testEnv.authenticatedContext(ACTIVE_ADMIN_UID, { email: 'active@example.org' }).firestore();
    const ownerDb = testEnv.authenticatedContext(OWNER_UID, { email: 'owner@example.org' }).firestore();

    console.log('\nRunning Official Firebase Firestore Rules Emulator Suite...\n');

    // 1. Draft & approved-unpublished records unreadable by non-admins
    await runCheck('1. Draft & approved-unpublished daily publications denied for anon, ordinary user, and suspended admin; allowed for active admin & owner', async () => {
      for (const db of [anonDb, ordinaryDb, suspendedDb]) {
        await assertSucceeds(getDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-19-pub')));
        await assertFails(getDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-20-draft')));
        await assertFails(getDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-21-approved')));
        await assertFails(getDocs(collection(db, 'dcm_daily_publications')));
        await assertSucceeds(getDocs(query(collection(db, 'dcm_daily_publications'), where('status', '==', 'published'), orderBy('assessmentDate', 'desc'), limit(60))));
      }
      for (const db of [activeAdminDb, ownerDb]) {
        await assertSucceeds(getDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-20-draft')));
        await assertSucceeds(getDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-21-approved')));
        await assertSucceeds(getDoc(doc(db, 'dcm_daily_publications', 'non-existent-check-id')));
      }
    });

    // 2. Evidence strictly published + public readable (including real Firestore allow list static query check)
    await runCheck('2. Evidence records strictly require published + public for visitor reads (both get and indexed list)', async () => {
      for (const db of [anonDb, ordinaryDb, suspendedDb]) {
        await assertSucceeds(getDoc(doc(db, 'dcm_evidence', 'ev-pub-public')));
        await assertFails(getDoc(doc(db, 'dcm_evidence', 'ev-pub-private')));
        await assertFails(getDoc(doc(db, 'dcm_evidence', 'ev-draft-public')));
        await assertFails(getDoc(doc(db, 'dcm_evidence', 'ev-unverified-private')));
        await assertSucceeds(
          getDocs(
            query(
              collection(db, 'dcm_evidence'),
              where('status', '==', 'published'),
              where('visibility', '==', 'public'),
              orderBy('sourcePublicationDate', 'desc'),
              limit(150)
            )
          )
        );
      }
      await assertSucceeds(getDoc(doc(activeAdminDb, 'dcm_evidence', 'ev-unverified-private')));
    });

    // 3. Confidential private notes isolated from all non-admins
    await runCheck('3. Confidential /dcm_private_notes denied for anon, ordinary user, and suspended admin; allowed for active admin & owner', async () => {
      for (const db of [anonDb, ordinaryDb, suspendedDb]) {
        await assertFails(getDoc(doc(db, 'dcm_private_notes', 'note-conf-001')));
        await assertFails(getDocs(collection(db, 'dcm_private_notes')));
      }
      await assertSucceeds(getDoc(doc(activeAdminDb, 'dcm_private_notes', 'note-conf-001')));
      await assertSucceeds(getDoc(doc(ownerDb, 'dcm_private_notes', 'note-conf-001')));
    });

    // 4. Unauthorised writes denied across all collections (anon, ordinary, suspended admin)
    await runCheck('4. Unauthorised writes denied for anon, ordinary user, and suspended admin', async () => {
      for (const [label, db, uid] of [
        ['anon', anonDb, 'anon'],
        ['ordinary', ordinaryDb, ORDINARY_USER_UID],
        ['suspended', suspendedDb, SUSPENDED_ADMIN_UID]
      ]) {
        await assertFails(setDoc(doc(db, 'dcm_daily_publications', `unauth-${label}`), makeDailyDoc(`unauth-${label}`, { uid })));
        await assertFails(setDoc(doc(db, 'dcm_evidence', `unauth-ev-${label}`), makeEvidenceDoc(`unauth-ev-${label}`, { status: 'draft', visibility: 'private', uid })));
        await assertFails(setDoc(doc(db, 'dcm_editorial_handovers', `unauth-ho-${label}`), makeHandoverDoc(`unauth-ho-${label}`, uid)));
      }
    });

    // 5. Publishing without Research approval reference or spoofed recorder UID denied even for active admin
    await runCheck('5. Publishing without valid Research approval reference or with spoofed recordedByUid denied', async () => {
      const noApproval = makeDailyDoc('dcm-daily-2026-11-22-noapp', { status: 'published', uid: ACTIVE_ADMIN_UID, withApproval: false });
      await assertFails(setDoc(doc(activeAdminDb, 'dcm_daily_publications', noApproval.id), noApproval));

      const spoofedRecorder = makeDailyDoc('dcm-daily-2026-11-22-spoof', { status: 'published', uid: ACTIVE_ADMIN_UID, withApproval: true });
      spoofedRecorder.approvalRecord.recordedByUid = OWNER_UID;
      await assertFails(setDoc(doc(activeAdminDb, 'dcm_daily_publications', spoofedRecorder.id), spoofedRecorder));

      const unverifiedPublic = makeEvidenceDoc('ev-bad-unverified', {
        status: 'published',
        visibility: 'public',
        verificationStatus: 'Unverified Lead (Private)',
        uid: ACTIVE_ADMIN_UID
      });
      await assertFails(setDoc(doc(activeAdminDb, 'dcm_evidence', unverifiedPublic.id), unverifiedPublic));
    });

    // 6. Published records are immutable and cannot be deleted even by active admin or owner
    await runCheck('6. Published daily records & evidence are immutable (update & delete denied even for active admin and owner)', async () => {
      for (const db of [activeAdminDb, ownerDb]) {
        await assertFails(updateDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-19-pub'), { summary: 'Tampered summary' }));
        await assertFails(deleteDoc(doc(db, 'dcm_daily_publications', 'dcm-daily-2026-11-19-pub')));
        await assertFails(updateDoc(doc(db, 'dcm_evidence', 'ev-pub-public'), { title: 'Tampered evidence' }));
        await assertFails(deleteDoc(doc(db, 'dcm_evidence', 'ev-pub-public')));
      }
    });

    // 7. Authorised admins can publish a versioned correction (-r2) superseding the published record
    await runCheck('7. Active admin & owner can create new versioned correction (-r2) superseding published edition', async () => {
      const r2 = makeDailyDoc('dcm-daily-2026-11-19-r2', {
        status: 'published',
        uid: ACTIVE_ADMIN_UID,
        withApproval: true,
        revisionNumber: 2,
        supersedesPublicationId: 'dcm-daily-2026-11-19-pub'
      });
      await assertSucceeds(setDoc(doc(activeAdminDb, 'dcm_daily_publications', r2.id), r2));
      const snap = await assertSucceeds(getDoc(doc(anonDb, 'dcm_daily_publications', r2.id)));
      assert.equal(snap.data()?.supersedesPublicationId, 'dcm-daily-2026-11-19-pub');
    });

    // 8. Editorial handovers admin-only, immutable snapshot on status update, delete always denied
    await runCheck('8. /dcm_editorial_handovers admin-only, snapshot immutable on status update, delete denied', async () => {
      for (const db of [anonDb, ordinaryDb, suspendedDb]) {
        await assertFails(getDoc(doc(db, 'dcm_editorial_handovers', 'handover-001')));
        await assertFails(getDocs(collection(db, 'dcm_editorial_handovers')));
      }
      await assertSucceeds(getDoc(doc(activeAdminDb, 'dcm_editorial_handovers', 'handover-001')));
      await assertSucceeds(
        updateDoc(doc(activeAdminDb, 'dcm_editorial_handovers', 'handover-001'), {
          handoverStatus: 'handed-over',
          updatedAt: 1795000005000,
          updatedByUid: ACTIVE_ADMIN_UID
        })
      );
      await assertFails(
        updateDoc(doc(activeAdminDb, 'dcm_editorial_handovers', 'handover-001'), {
          snapshotPayload: '{"tampered":true}',
          updatedAt: 1795000006000,
          updatedByUid: ACTIVE_ADMIN_UID
        })
      );
      await assertFails(deleteDoc(doc(activeAdminDb, 'dcm_editorial_handovers', 'handover-001')));
      await assertFails(deleteDoc(doc(ownerDb, 'dcm_editorial_handovers', 'handover-001')));
    });

    // 9. Legacy cms/dcm_publications (contains unpublished draft) strictly admin-only; cms/dcm_publications_public publicly readable & admin-only writable
    await runCheck('9. Legacy /cms/dcm_publications denied to non-admins; /cms/dcm_publications_public readable publicly & admin-only writable', async () => {
      for (const db of [anonDb, ordinaryDb, suspendedDb]) {
        await assertFails(getDoc(doc(db, 'cms', 'dcm_publications')));
        await assertFails(setDoc(doc(db, 'cms', 'dcm_publications'), { items: [] }));
        await assertSucceeds(getDoc(doc(db, 'cms', 'dcm_publications_public')));
        await assertFails(setDoc(doc(db, 'cms', 'dcm_publications_public'), { items: [] }));
      }
      for (const db of [activeAdminDb, ownerDb]) {
        await assertSucceeds(getDoc(doc(db, 'cms', 'dcm_publications')));
        await assertSucceeds(getDoc(doc(db, 'cms', 'dcm_publications_public')));
      }
    });

    console.log(`\nOfficial Emulator Suite Summary: ${passed}/${passed + failed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await testEnv.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
