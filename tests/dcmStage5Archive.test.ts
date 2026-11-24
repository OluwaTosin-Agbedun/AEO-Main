/**
 * AEO DCM Corrections — Stage 5 Verification Suite
 *
 * Covers Permanent State Links and Daily Archives (Section 9, items 1–14):
 *  1. Direct state assessment URL opens exact state (all 36 states + FCT) and exact edition
 *  2. Refreshing a historical URL preserves the exact historical assessment (never jumps to latest)
 *  3. URL sync preserves unrelated query parameters & supports browser Back/Forward (popstate)
 *  4. Newer daily publications arriving later do NOT alter older permalinks or reset locked views
 *  5. Corrected editions (-r2) have distinct stable permalinks & bidirectional editorial notices
 *  6. Original historical evidence stays intact on original permalink with dated correction notice (SSR verified)
 *  7. Daily and legacy twice-monthly publications coexist in archive index & DcmArchiveSection (SSR verified)
 *  8. 15th and final calendar day of each month work as comparison points (exact vs prior reference vs unavailable)
 *  9. Missing dates and invalid publication/state params return transparent unavailable messages (no fabrication)
 * 10. Draft and approved-but-unpublished records remain strictly inaccessible publicly
 * 11. Mobile archive & state selector overflow/touch-target audit (320px+)
 * 12. Performance & data integrity: bounded Firestore queries, on-demand loaders, Microsoft Graph DCM Brief continuity
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DcmApprovalRecord,
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPublication,
  NIGERIA_37_JURISDICTIONS
} from '../src/types/dcm';
import {
  EDITORIAL_CORRECTION_NOTICE_LABEL,
  buildAbsoluteDcmPermalink,
  buildDcmArchiveIndex,
  buildDcmPermalinkUrl,
  lookupArchiveByDate,
  parseDcmUrlParams,
  resolveBiMonthlyComparisonPoints,
  resolveDcmPermalink,
  resolvePublicationCorrectionChain
} from '../src/utils/dcmArchive';
import { resolveStateAssessmentPanelData } from '../src/utils/dcmEvidence';
import { DcmStateAssessmentPanel } from '../src/components/DcmStateAssessmentPanel';
import { DcmArchiveSection } from '../src/components/DcmArchiveSection';

const ROOT_DIR = process.cwd();
const dcmPreviewSource = fs.readFileSync(path.join(ROOT_DIR, 'src/components/DcmPreview.tsx'), 'utf8');
const archiveSectionSource = fs.readFileSync(path.join(ROOT_DIR, 'src/components/DcmArchiveSection.tsx'), 'utf8');
const statePanelSource = fs.readFileSync(path.join(ROOT_DIR, 'src/components/DcmStateAssessmentPanel.tsx'), 'utf8');
const cmsContextSource = fs.readFileSync(path.join(ROOT_DIR, 'src/context/CMSContext.tsx'), 'utf8');
const archiveUtilSource = fs.readFileSync(path.join(ROOT_DIR, 'src/utils/dcmArchive.ts'), 'utf8');
const serverSource = fs.readFileSync(path.join(ROOT_DIR, 'server.ts'), 'utf8');

const VALID_APPROVAL: DcmApprovalRecord = {
  approved: true,
  approvalReference: 'AEO-RES-2026-11-19',
  approvedByName: 'AEO Research Lead',
  approvedAt: '2026-11-19T17:00:00Z',
  recordedByUid: 'admin-uid-1',
  recordedByEmail: 'admin@athenacentre.org',
  recordedAt: '2026-11-19T17:05:00Z'
};

function makeAllStates(
  defaultClass: 'Open' | 'Emerging concern' | 'Constrained' | 'Severely constrained' | 'Insufficient evidence' = 'Insufficient evidence',
  overrides: Record<string, any> = {}
) {
  const states: Record<string, any> = {};
  for (const j of NIGERIA_37_JURISDICTIONS) {
    states[j.code] = {
      stateCode: j.code,
      stateName: j.name,
      classification: defaultClass,
      keyFinding: `Research-approved assessment for ${j.name}.`,
      direction: 'Unchanged',
      confidence: 'Moderate',
      carriedForward: false,
      ...(overrides[j.code] || {})
    };
  }
  return states;
}

function makePublication(overrides: Partial<DcmPublication>): DcmPublication {
  return {
    id: 'dcm-2026-11-p1',
    publicationFormat: 'legacy-period',
    title: 'Democratic Competitiveness Map: 1st – 15th November 2026',
    reportingPeriodLabel: '1st – 15th November 2026',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    year: 2026,
    month: 11,
    periodIndex: 1,
    publicationDate: '16 November 2026',
    evidenceCutoffDate: '15 November 2026, 17:00 WAT (UTC+01:00)',
    methodologyVersion: 'Version 1.1',
    status: 'published',
    isLatest: false,
    summary: 'Research-approved summary for 1–15 November 2026.',
    classifications: makeAllStates('Insufficient evidence'),
    approvalRecord: VALID_APPROVAL,
    createdAt: Date.parse('2026-11-16T08:00:00Z'),
    updatedAt: Date.parse('2026-11-16T08:00:00Z'),
    ...overrides
  };
}

// Synthetic fixtures spanning legacy periods, daily updates, a versioned editorial correction (-r2), and private drafts
const legacyOctEnd = makePublication({
  id: 'dcm-2026-10-end',
  reportingPeriodLabel: '16th – 31st October 2026',
  periodStart: '2026-10-16',
  periodEnd: '2026-10-31',
  year: 2026,
  month: 10,
  periodIndex: 2,
  publicationDate: '1 November 2026',
  evidenceCutoffDate: '31 October 2026, 17:00 WAT (UTC+01:00)',
  classifications: makeAllStates('Insufficient evidence', {
    BE: { classification: 'Constrained', keyFinding: 'October rally restrictions verified in Makurdi.' }
  })
});

const legacyNovMid = makePublication({
  id: 'dcm-2026-11-15',
  reportingPeriodLabel: '1st – 15th November 2026',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-15',
  year: 2026,
  month: 11,
  periodIndex: 1,
  publicationDate: '16 November 2026',
  evidenceCutoffDate: '15 November 2026, 17:00 WAT (UTC+01:00)',
  classifications: makeAllStates('Insufficient evidence', {
    BE: {
      classification: 'Emerging concern',
      keyFinding: 'Town hall held in Makurdi without reported incident.',
      lastSubstantiveReviewDate: '2026-11-15'
    },
    FC: {
      classification: 'Open',
      keyFinding: 'Broadly open campaign activities documented in Abuja.',
      lastSubstantiveReviewDate: '2026-11-14'
    }
  })
});

const dailyNov19Orig = makePublication({
  id: 'dcm-daily-2026-11-19',
  publicationFormat: 'daily',
  title: 'Democratic Competitiveness Map: 19 November 2026',
  reportingPeriodLabel: '19 November 2026',
  assessmentDate: '2026-11-19',
  periodStart: '2026-11-19',
  periodEnd: '2026-11-19',
  year: 2026,
  month: 11,
  periodIndex: 19,
  publicationDate: '19 November 2026',
  evidenceCutoffTimeWat: '17:00',
  evidenceCutoffDateTimeWat: '2026-11-19T17:00:00+01:00',
  evidenceCutoffDate: '19 November 2026, 17:00 WAT (UTC+01:00)',
  publishedAt: '2026-11-19T17:30:00+01:00',
  revisionNumber: 1,
  summary: 'Original 19 November daily update preserving Benue Emerging concern.',
  classifications: makeAllStates('Insufficient evidence', {
    BE: {
      classification: 'Emerging concern',
      keyFinding: 'Original 19 Nov finding for Benue.',
      carriedForward: true,
      lastSubstantiveReviewDate: '2026-11-15'
    }
  })
});

const dailyNov19Corrected = makePublication({
  id: 'dcm-daily-2026-11-19-r2',
  publicationFormat: 'daily',
  title: 'Democratic Competitiveness Map: 19 November 2026 (Revision 2)',
  reportingPeriodLabel: '19 November 2026',
  assessmentDate: '2026-11-19',
  periodStart: '2026-11-19',
  periodEnd: '2026-11-19',
  year: 2026,
  month: 11,
  periodIndex: 19,
  publicationDate: '20 November 2026',
  evidenceCutoffTimeWat: '17:00',
  evidenceCutoffDateTimeWat: '2026-11-19T17:00:00+01:00',
  evidenceCutoffDate: '19 November 2026, 17:00 WAT (UTC+01:00)',
  publishedAt: '2026-11-20T09:15:00+01:00',
  revisionNumber: 2,
  supersedesPublicationId: 'dcm-daily-2026-11-19',
  revisionNote: 'Corrected date citation in Benue court order reference.',
  summary: 'Corrected revision r2 of 19 November daily update with updated court citation.',
  classifications: makeAllStates('Insufficient evidence', {
    BE: {
      classification: 'Emerging concern',
      keyFinding: 'Corrected 19 Nov finding for Benue with verified court citation.',
      carriedForward: true,
      lastSubstantiveReviewDate: '2026-11-15'
    }
  })
});

const dailyNov20 = makePublication({
  id: 'dcm-daily-2026-11-20',
  publicationFormat: 'daily',
  title: 'Democratic Competitiveness Map: 20 November 2026',
  reportingPeriodLabel: '20 November 2026',
  assessmentDate: '2026-11-20',
  periodStart: '2026-11-20',
  periodEnd: '2026-11-20',
  year: 2026,
  month: 11,
  periodIndex: 20,
  publicationDate: '20 November 2026',
  evidenceCutoffTimeWat: '17:00',
  evidenceCutoffDateTimeWat: '2026-11-20T17:00:00+01:00',
  evidenceCutoffDate: '20 November 2026, 17:00 WAT (UTC+01:00)',
  publishedAt: '2026-11-20T17:30:00+01:00',
  isLatest: true,
  isQuietDay: true,
  summary: 'Quiet-day update confirming no new qualifying developments on 20 November 2026.',
  classifications: makeAllStates('Insufficient evidence', {
    BE: {
      classification: 'Emerging concern',
      keyFinding: 'Carried forward from 19 November 2026.',
      carriedForward: true,
      lastSubstantiveReviewDate: '2026-11-15'
    }
  })
});

const draftNov21 = makePublication({
  id: 'dcm-daily-2026-11-21-draft',
  publicationFormat: 'daily',
  assessmentDate: '2026-11-21',
  reportingPeriodLabel: '21 November 2026',
  status: 'draft',
  isLatest: true,
  summary: 'CONFIDENTIAL DRAFT — MUST NEVER BE PUBLIC.'
});

const approvedUnpublishedNov22 = makePublication({
  id: 'dcm-daily-2026-11-22-approved',
  publicationFormat: 'daily',
  assessmentDate: '2026-11-22',
  reportingPeriodLabel: '22 November 2026',
  status: 'approved',
  isLatest: false,
  summary: 'APPROVED BUT UNPUBLISHED — MUST NEVER BE PUBLIC.'
});

const allFixtures = [
  legacyOctEnd,
  legacyNovMid,
  dailyNov19Orig,
  dailyNov19Corrected,
  dailyNov20,
  draftNov21,
  approvedUnpublishedNov22
];

let passed = 0;
function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] Stage 5 Test ${passed}: ${name}`);
  } catch (err) {
    console.error(`[FAIL] Stage 5 Test: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Direct state assessment URL opens exact state (all 36 states + FCT) & exact edition
// ---------------------------------------------------------------------------
runTest('Direct state assessment URL resolves all 36 states + FCT and pins exact edition by publication ID', () => {
  // Verify canonical pattern for Benue on 19 Nov 2026
  const benueUrl = buildDcmPermalinkUrl({
    publication: dailyNov19Orig,
    stateName: 'Benue'
  });
  assert.equal(
    benueUrl,
    '/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19'
  );

  // Resolve exact historical edition (NOT latest Nov 20)
  const resolved = resolveDcmPermalink(allFixtures, benueUrl.split('?')[1]);
  assert.equal(resolved.activePublication?.id, 'dcm-daily-2026-11-19');
  assert.equal(resolved.selectedStateName, 'Benue');
  assert.equal(resolved.isPermalinkLocked, true);
  assert.equal(resolved.notice, null);

  // Verify every single one of the 36 states + FCT resolves cleanly
  for (const j of NIGERIA_37_JURISDICTIONS) {
    const url = buildDcmPermalinkUrl({ publication: legacyNovMid, stateName: j.name });
    const r = resolveDcmPermalink(allFixtures, url.split('?')[1]);
    assert.equal(r.selectedStateName, j.name, `Failed resolving jurisdiction ${j.name}`);
    assert.equal(r.activePublication?.id, 'dcm-2026-11-15');
  }

  // Verify FCT aliases ("Abuja", "FC") normalize cleanly to canonical FCT
  const fctAliasRes = resolveDcmPermalink(
    allFixtures,
    'state=Abuja&date=2026-11-15&publication=dcm-2026-11-15'
  );
  assert.equal(fctAliasRes.selectedStateName, 'FCT');
  assert.equal(fctAliasRes.activePublication?.id, 'dcm-2026-11-15');

  // Verify publication ID takes precedence even if date differs or multiple revisions share same date
  const precRes = resolveDcmPermalink(
    allFixtures,
    'state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19-r2'
  );
  assert.equal(precRes.activePublication?.id, 'dcm-daily-2026-11-19-r2');
});

// ---------------------------------------------------------------------------
// Test 2: Refresh preservation & unrelated query parameter preservation
// ---------------------------------------------------------------------------
runTest('Refreshing historical URL preserves exact snapshot and unrelated query parameters', () => {
  const urlWithExtras = buildDcmPermalinkUrl({
    publication: legacyOctEnd,
    stateName: 'Benue',
    existingSearch: '?utm_source=newsletter&ref=press_brief&state=Lagos&publication=old'
  });

  // Unrelated params preserved, old DCM params cleanly replaced
  assert.ok(urlWithExtras.includes('utm_source=newsletter'));
  assert.ok(urlWithExtras.includes('ref=press_brief'));
  assert.ok(urlWithExtras.includes('state=Benue'));
  assert.ok(urlWithExtras.includes('date=2026-10-31'));
  assert.ok(urlWithExtras.includes('publication=dcm-2026-10-end'));
  assert.equal(urlWithExtras.includes('Lagos'), false);

  // Simulating full page refresh on that exact search string resolves identical snapshot
  const refreshed = resolveDcmPermalink(allFixtures, urlWithExtras.split('?')[1]);
  assert.equal(refreshed.activePublication?.id, 'dcm-2026-10-end');
  assert.equal(refreshed.selectedStateName, 'Benue');
  assert.equal(refreshed.isPermalinkLocked, true);

  // Absolute permalink helper works cleanly
  const abs = buildAbsoluteDcmPermalink({
    publication: dailyNov19Orig,
    stateName: 'Benue',
    origin: 'https://aeo.athenacentre.org'
  });
  assert.equal(
    abs,
    'https://aeo.athenacentre.org/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19'
  );
});

// ---------------------------------------------------------------------------
// Test 3: Browser Back/Forward (popstate) and URL sync wiring in DcmPreview
// ---------------------------------------------------------------------------
runTest('DcmPreview synchronises pushState/popstate cleanly for browser Back and Forward without loops', () => {
  assert.ok(dcmPreviewSource.includes('window.history.pushState'), 'pushState sync required');
  assert.ok(dcmPreviewSource.includes("window.addEventListener('popstate', handlePopState)"), 'popstate listener required');
  assert.ok(dcmPreviewSource.includes('isApplyingPopstateRef'), 'Loop guard ref required during popstate restoration');
  assert.ok(
    dcmPreviewSource.includes('existingSearch: window.location.search'),
    'URL sync must preserve unrelated query parameters'
  );

  // Simulate Back -> Forward sequence across 3 historical URLs
  const historyStack = [
    'state=Benue&date=2026-10-31&publication=dcm-2026-10-end',
    'state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19',
    'state=FCT&date=2026-11-15&publication=dcm-2026-11-15'
  ];

  const step3 = resolveDcmPermalink(allFixtures, historyStack[2]);
  assert.equal(step3.activePublication?.id, 'dcm-2026-11-15');
  assert.equal(step3.selectedStateName, 'FCT');

  const backToStep2 = resolveDcmPermalink(allFixtures, historyStack[1]);
  assert.equal(backToStep2.activePublication?.id, 'dcm-daily-2026-11-19');
  assert.equal(backToStep2.selectedStateName, 'Benue');

  const backToStep1 = resolveDcmPermalink(allFixtures, historyStack[0]);
  assert.equal(backToStep1.activePublication?.id, 'dcm-2026-10-end');
  assert.equal(backToStep1.selectedStateName, 'Benue');

  const forwardToStep2 = resolveDcmPermalink(allFixtures, historyStack[1]);
  assert.equal(forwardToStep2.activePublication?.id, 'dcm-daily-2026-11-19');
});

// ---------------------------------------------------------------------------
// Test 4: Newer daily publication does NOT alter older permalinks
// ---------------------------------------------------------------------------
runTest('Adding a newer daily publication does not change or break an older permalink', () => {
  const olderPermalink = buildDcmPermalinkUrl({
    publication: dailyNov19Orig,
    stateName: 'Benue'
  });

  const newerDailyNov25 = makePublication({
    id: 'dcm-daily-2026-11-25',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-25',
    reportingPeriodLabel: '25 November 2026',
    periodStart: '2026-11-25',
    periodEnd: '2026-11-25',
    year: 2026,
    month: 11,
    periodIndex: 25,
    isLatest: true,
    classifications: makeAllStates('Open')
  });

  const expandedTimeline = [...allFixtures, newerDailyNov25];
  const resolved = resolveDcmPermalink(expandedTimeline, olderPermalink.split('?')[1]);

  assert.equal(resolved.activePublication?.id, 'dcm-daily-2026-11-19');
  assert.equal(resolved.activePublication?.classifications.BE.classification, 'Emerging concern');
  assert.equal(resolved.isPermalinkLocked, true);
});

// ---------------------------------------------------------------------------
// Test 5: Historical correction chain — distinct stable links & editorial clarity
// ---------------------------------------------------------------------------
runTest('Original and corrected editions have distinct permalinks and transparent bidirectional editorial notices', () => {
  const origPermalink = buildDcmPermalinkUrl({ publication: dailyNov19Orig, stateName: 'Benue' });
  const corrPermalink = buildDcmPermalinkUrl({ publication: dailyNov19Corrected, stateName: 'Benue' });

  assert.notEqual(origPermalink, corrPermalink, 'Original and corrected editions MUST have distinct stable URLs');
  assert.ok(origPermalink.includes('publication=dcm-daily-2026-11-19'));
  assert.ok(corrPermalink.includes('publication=dcm-daily-2026-11-19-r2'));

  // Inspecting original edition shows subsequent correction notice without replacing original snapshot
  const origChain = resolvePublicationCorrectionChain(allFixtures, dailyNov19Orig);
  assert.equal(origChain.hasSubsequentCorrection, true);
  assert.equal(origChain.isCorrectedVersion, false);
  assert.equal(origChain.latestCorrection?.id, 'dcm-daily-2026-11-19-r2');
  assert.equal(origChain.editorialClarityNote, EDITORIAL_CORRECTION_NOTICE_LABEL);

  // Inspecting corrected edition shows revision note and link back to preserved original
  const corrChain = resolvePublicationCorrectionChain(allFixtures, dailyNov19Corrected);
  assert.equal(corrChain.isCorrectedVersion, true);
  assert.equal(corrChain.hasSubsequentCorrection, false);
  assert.equal(corrChain.originalEdition?.id, 'dcm-daily-2026-11-19');
  assert.equal(corrChain.revisionNumber, 2);
  assert.equal(corrChain.revisionNote, 'Corrected date citation in Benue court order reference.');
});

// ---------------------------------------------------------------------------
// Test 6: Original historical evidence preserved on original permalink + dated correction notice rendered (SSR)
// ---------------------------------------------------------------------------
runTest('SSR DcmStateAssessmentPanel preserves original historical evidence & renders Share bar + dated correction notice', () => {
  const evidenceRecords: DcmEvidenceRecord[] = [
    {
      id: 'ev-be-2026-11-19-orig',
      stateCode: 'BE',
      stateName: 'Benue',
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      title: 'Original 19 Nov Makurdi Permit Record',
      publicDescription: 'Original approved evidence text preserved on r1 snapshot.',
      sourceName: 'Benue Civic Observer',
      sourcePublicationDate: '2026-11-19',
      sourceUrl: 'https://example.org/benue-r1',
      verificationStatus: 'Verified by Research',
      isDisputed: false,
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-19T12:00:00Z'),
      updatedAt: Date.parse('2026-11-19T12:00:00Z')
    },
    {
      id: 'ev-be-2026-11-19-r2',
      stateCode: 'BE',
      stateName: 'Benue',
      linkedPublicationIds: ['dcm-daily-2026-11-19-r2'],
      supersedesEvidenceId: 'ev-be-2026-11-19-orig',
      revisionNumber: 2,
      title: 'Corrected 19 Nov Makurdi Court Order Record (r2)',
      publicDescription: 'Updated citation text on r2 snapshot only.',
      sourceName: 'Benue Court Registry',
      sourcePublicationDate: '2026-11-19',
      sourceUrl: 'https://example.org/benue-r2',
      verificationStatus: 'Official Document / Public Record',
      isDisputed: false,
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-20T09:00:00Z'),
      updatedAt: Date.parse('2026-11-20T09:00:00Z')
    }
  ];

  const publishedOnly = [legacyOctEnd, legacyNovMid, dailyNov19Orig, dailyNov19Corrected, dailyNov20];
  const origPanelData = resolveStateAssessmentPanelData({
    selectedPub: dailyNov19Orig,
    previousPub: legacyNovMid,
    allPublishedSortedAsc: publishedOnly,
    stateKey: 'Benue',
    evidenceRecords,
    incidentRecords: [] as DcmIncidentRecord[],
    developmentRecords: [] as DcmIncidentDevelopment[]
  });

  // Original snapshot sees ONLY original evidence, NOT r2 evidence
  assert.equal(origPanelData.supportingEvidence.length, 1);
  assert.equal(origPanelData.supportingEvidence[0].id, 'ev-be-2026-11-19-orig');

  const origChain = resolvePublicationCorrectionChain(allFixtures, dailyNov19Orig);
  const html = renderToStaticMarkup(
    React.createElement(DcmStateAssessmentPanel, {
      panelData: origPanelData,
      selectedPeriodLabel: '19 November 2026',
      evidenceCutoffLabel: '19 November 2026, 17:00 WAT (UTC+01:00)',
      publicationDateLabel: '19 November 2026',
      statePermalinkUrl: '/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19',
      absolutePermalinkUrl: 'https://aeo.athenacentre.org/democratic-competitiveness-map?state=Benue&date=2026-11-19&publication=dcm-daily-2026-11-19',
      correctionChain: origChain,
      buildHistoricalPermalink: (id) => `/democratic-competitiveness-map?state=Benue&publication=${id}`,
      onSelectHistoricalEdition: () => {}
    })
  );

  assert.ok(html.includes('Permanent assessment link'));
  assert.ok(html.includes('Copy link'));

  // Section B (Supporting Evidence) must contain ONLY r1 original evidence, NEVER r2 evidence
  const secBStart = html.indexOf('aria-label="Supporting evidence"');
  const secBEnd = html.indexOf('aria-label="Institutional response"');
  assert.ok(secBStart > 0 && secBEnd > secBStart);
  const sectionBHtml = html.slice(secBStart, secBEnd);
  assert.ok(sectionBHtml.includes('Original 19 Nov Makurdi Permit Record'));
  assert.equal(sectionBHtml.includes('Corrected 19 Nov Makurdi Court Order Record (r2)'), false);

  assert.ok(html.includes('Preserved original snapshot'));
  assert.ok(html.includes('View corrected revision (r2)'));
  assert.ok(html.includes(EDITORIAL_CORRECTION_NOTICE_LABEL));
  assert.ok(html.includes('Edition publication date:'));
  assert.ok(html.includes('Last substantive state review:'));
});

// ---------------------------------------------------------------------------
// Test 7: Daily & legacy publications coexist in Archive Index & SSR DcmArchiveSection
// ---------------------------------------------------------------------------
runTest('Daily and legacy publications coexist in archive index and render cleanly via DcmArchiveSection', () => {
  const index = buildDcmArchiveIndex(allFixtures, { year: 2026, month: 11, stateName: 'Benue' });

  // Draft (Nov 21) and approved-unpublished (Nov 22) MUST be excluded; 4 published Nov editions included
  assert.equal(index.entries.length, 4);
  assert.equal(index.entries.some((e) => e.id === 'dcm-daily-2026-11-21-draft'), false);
  assert.equal(index.entries.some((e) => e.id === 'dcm-daily-2026-11-22-approved'), false);

  const hasDaily = index.entries.some((e) => e.isDaily);
  const hasLegacy = index.entries.some((e) => !e.isDaily);
  assert.equal(hasDaily, true);
  assert.equal(hasLegacy, true);

  const publishedOnly = [legacyOctEnd, legacyNovMid, dailyNov19Orig, dailyNov19Corrected, dailyNov20];
  const archiveHtml = renderToStaticMarkup(
    React.createElement(DcmArchiveSection, {
      publishedPublications: publishedOnly,
      activePublicationId: 'dcm-daily-2026-11-19',
      activeYear: 2026,
      activeMonth: 11,
      selectedStateName: 'Benue',
      onSelectArchiveEdition: () => {}
    })
  );

  assert.ok(archiveHtml.includes('Daily &amp; Historical DCM Archive'));
  assert.ok(archiveHtml.includes('Twice-Monthly Comparison Points'));
  assert.ok(archiveHtml.includes('15th of Month'));
  assert.ok(archiveHtml.includes('Month-End'));
  assert.ok(archiveHtml.includes('1st – 15th November 2026'));
  assert.ok(archiveHtml.includes('19 November 2026'));
  assert.ok(archiveHtml.includes('20 November 2026'));
  assert.ok(archiveHtml.includes('Benue snapshot'));
  assert.ok(archiveHtml.includes('Copy link'));
});

// ---------------------------------------------------------------------------
// Test 8: Twice-monthly comparison points (15th & month-end) exact vs prior vs unavailable
// ---------------------------------------------------------------------------
runTest('15th and final calendar day comparison points distinguish exact snapshots from prior references & unavailable dates', () => {
  // November 2026: 15th has exact published snapshot (dcm-2026-11-15); 30th has NO publication -> prior published reference (Nov 20)
  const novPoints = resolveBiMonthlyComparisonPoints(allFixtures, 2026, 11, 'Benue');
  assert.equal(novPoints.length, 2);

  assert.equal(novPoints[0].targetDateIso, '2026-11-15');
  assert.equal(novPoints[0].status, 'exact_published');
  assert.equal(novPoints[0].publication?.id, 'dcm-2026-11-15');

  assert.equal(novPoints[1].targetDateIso, '2026-11-30');
  assert.equal(novPoints[1].status, 'prior_published_reference');
  assert.equal(novPoints[1].publication?.id, 'dcm-daily-2026-11-20');
  assert.ok(novPoints[1].statusLabel.includes('No publication on 30 November 2026'));
  assert.ok(novPoints[1].statusLabel.includes('Most recent earlier published edition'));

  // February 2026 (28 days) & February 2028 (29 days leap year) calendar end-date accuracy
  const feb2026Points = resolveBiMonthlyComparisonPoints(allFixtures, 2026, 2);
  assert.equal(feb2026Points[1].targetDateIso, '2026-02-28');
  assert.equal(feb2026Points[0].status, 'none_available');
  assert.equal(feb2026Points[1].status, 'none_available');

  const feb2028Points = resolveBiMonthlyComparisonPoints(allFixtures, 2028, 2);
  assert.equal(feb2028Points[1].targetDateIso, '2028-02-29');
});

// ---------------------------------------------------------------------------
// Test 9: Missing publication dates & invalid params produce accurate unavailable notices
// ---------------------------------------------------------------------------
runTest('Missing dates and invalid publication/state parameters fail gracefully without fabricating assessments', () => {
  // Missing date (17 Nov 2026 has no publication)
  const missingLookup = lookupArchiveByDate(allFixtures, '2026-11-17');
  assert.equal(missingLookup.status, 'unavailable');
  assert.equal(missingLookup.matchedPublication, null);
  assert.ok(missingLookup.message.includes('No approved DCM publication exists for 17 November 2026'));
  assert.equal(missingLookup.mostRecentEarlierPublication?.id, 'dcm-2026-11-15');

  // Direct URL with missing date
  const missingDateUrlRes = resolveDcmPermalink(allFixtures, 'date=2026-11-17');
  assert.equal(missingDateUrlRes.noticeTone, 'info');
  assert.ok(missingDateUrlRes.notice?.includes('No approved DCM publication exists for 17 November 2026'));

  // Direct URL with impossible date & unknown state & unsafe publication ID
  const invalidParsed = parseDcmUrlParams('state=Atlantis&date=2026-02-30&publication=../../etc/passwd');
  assert.equal(invalidParsed.isStateInvalid, true);
  assert.equal(invalidParsed.isDateInvalid, true);
  assert.equal(invalidParsed.isPublicationIdInvalid, true);

  const invalidRes = resolveDcmPermalink(
    allFixtures,
    'state=Atlantis&date=2026-02-30&publication=../../etc/passwd'
  );
  assert.equal(invalidRes.noticeTone, 'warning');
  assert.ok(invalidRes.notice?.includes('not valid'));
  assert.ok(invalidRes.notice?.includes('Atlantis'));
});

// ---------------------------------------------------------------------------
// Test 10: Draft & approved-but-unpublished records remain strictly inaccessible publicly
// ---------------------------------------------------------------------------
runTest('Draft and approved-but-unpublished records are blocked from direct permalinks, date lookup, and archive', () => {
  const draftRes = resolveDcmPermalink(allFixtures, 'publication=dcm-daily-2026-11-21-draft');
  assert.notEqual(draftRes.activePublication?.id, 'dcm-daily-2026-11-21-draft');
  assert.equal(draftRes.noticeTone, 'warning');
  assert.ok(draftRes.notice?.includes('unavailable or has not been published'));

  const approvedRes = resolveDcmPermalink(allFixtures, 'publication=dcm-daily-2026-11-22-approved');
  assert.notEqual(approvedRes.activePublication?.id, 'dcm-daily-2026-11-22-approved');
  assert.equal(approvedRes.noticeTone, 'warning');

  const draftDateLookup = lookupArchiveByDate(allFixtures, '2026-11-21');
  assert.equal(draftDateLookup.status, 'unavailable');
  assert.equal(draftDateLookup.matchedPublication, null);
});

// ---------------------------------------------------------------------------
// Test 11: Mobile archive & state selector overflow / touch-target audit
// ---------------------------------------------------------------------------
runTest('Archive and state panel maintain zero unsafe fixed widths (>=300px) and mobile touch targets', () => {
  const unsafeWidthPattern = /\b(?:width|minWidth)\s*:\s*['"`][3-9]\d{2,}px['"`]/g;
  assert.equal((archiveSectionSource.match(unsafeWidthPattern) || []).length, 0);
  assert.equal((statePanelSource.match(unsafeWidthPattern) || []).length, 0);

  assert.ok(archiveSectionSource.includes('min-h-[44px]'), 'Archive controls must provide 44px touch targets on mobile');
  assert.ok(archiveSectionSource.includes('min-w-0'), 'Archive layout must enforce min-w-0 to prevent horizontal overflow');
  assert.ok(dcmPreviewSource.includes('href="#dcm-archive-section"'), 'Mobile quick-jump bar must link to Daily archive');
});

// ---------------------------------------------------------------------------
// Test 12: Bounded Firestore queries, on-demand loaders, read-only governance & Microsoft Graph continuity
// ---------------------------------------------------------------------------
runTest('Bounded Firestore queries, on-demand archive loaders, read-only utilities & Microsoft Graph route remain intact', () => {
  // Hardened chronologically ordered bounded public listeners (Stage 5 + Stage 6)
  assert.ok(
    cmsContextSource.includes("where('status', '==', 'published')") &&
      cmsContextSource.includes("orderBy('assessmentDate', 'desc')") &&
      cmsContextSource.includes('limit(DAILY_ARCHIVE_INITIAL_WINDOW)')
  );
  assert.ok(
    cmsContextSource.includes("where('visibility', '==', 'public')") &&
      cmsContextSource.includes("orderBy(orderField, 'desc')") &&
      cmsContextSource.includes('limit(maxItems)')
  );

  // On-demand loaders present
  assert.ok(cmsContextSource.includes('loadDcmPublicationById'));
  assert.ok(cmsContextSource.includes('loadDcmArchiveMonth'));
  assert.ok(cmsContextSource.includes('loadOlderDailyPublications'));
  assert.ok(cmsContextSource.includes('loadDcmStateEvidence'));

  // Read-only governance on Stage 5 utilities
  assert.equal(archiveUtilSource.includes('setDoc'), false);
  assert.equal(archiveUtilSource.includes('updateDoc'), false);
  assert.equal(archiveUtilSource.includes('deleteDoc'), false);

  // Microsoft Graph DCM Brief server endpoint untouched
  assert.ok(serverSource.includes("app.post('/api/dcm-brief-request'"));
});

console.log(`\nStage 5 Summary: ${passed}/12 passed.`);
