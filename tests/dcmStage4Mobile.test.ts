/**
 * AEO DCM Corrections — Stage 4 Verification Suite
 *
 * Covers Mobile Layout and Responsiveness requirements:
 *  1. Mobile-first top-of-page hierarchy & preserved explanatory content below map
 *  2. "What changed today?" vs "Latest published update" vs dated historical headings & no fabrication
 *  3. Unified full-width mobile publication selector (daily + legacy, stable IDs, no auto-reset)
 *  4. Desktop 3-column Year/Month/Period selector preservation & desktop grid regression checks
 *  5. Interactive Nigeria map scaling, clamped tooltips, 40px+ mobile touch controls & selected-state feedback
 *  6. Classification legend stacked mobile definitions, canonical hex palette & required disclaimer
 *  7. Stage 3 State Assessment Panel SSR render verification with long URLs/titles/incidents/responses
 *  8. Zero horizontal overflow / fixed-width audit for 320px, 375px, 390px, 768px, and 1024px+ viewports
 *  9. Embedded homepage mode (hideAside) isolation & DCM Brief modal / Microsoft Graph route continuity
 * 10. Read-only governance verification (no Production mutations or rule deployment)
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
import { DCM_GEO } from '../src/data/dcmGeoData';
import {
  DCM_CANONICAL_PALETTE,
  resolvePublicDcmPublications,
  resolveSelectedPublication
} from '../src/utils/dcmConsistency';
import {
  DCM_LEGEND_DEFINITIONS,
  INSUFFICIENT_EVIDENCE_DISCLAIMER,
  MAP_SELECTION_INSTRUCTION,
  TRANSPARENT_MISSING_SUMMARY_MESSAGE,
  buildUnifiedPublicationOptions,
  getTodayWatIsoDate,
  resolveDailyUpdateBanner
} from '../src/utils/dcmMobile';
import { resolveStateAssessmentPanelData } from '../src/utils/dcmEvidence';
import { DcmStateAssessmentPanel } from '../src/components/DcmStateAssessmentPanel';

const ROOT_DIR = process.cwd();
const dcmPreviewSource = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/DcmPreview.tsx'),
  'utf8'
);
const statePanelSource = fs.readFileSync(
  path.join(ROOT_DIR, 'src/components/DcmStateAssessmentPanel.tsx'),
  'utf8'
);
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

function makeAllStates(defaultClass: 'Open' | 'Emerging concern' | 'Constrained' | 'Severely constrained' | 'Insufficient evidence' = 'Insufficient evidence') {
  const states: Record<string, any> = {};
  for (const j of NIGERIA_37_JURISDICTIONS) {
    states[j.code] = {
      stateCode: j.code,
      stateName: j.name,
      classification: defaultClass,
      keyFinding: `Research-approved assessment for ${j.name}.`,
      direction: 'Unchanged',
      confidence: 'Moderate',
      carriedForward: false
    };
  }
  return states;
}

function makePublication(overrides: Partial<DcmPublication>): DcmPublication {
  return {
    id: 'dcm-2026-11-p1',
    title: 'Democratic Competitiveness Map: 1st – 15th November 2026',
    reportingPeriodLabel: '1st – 15th November 2026',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    year: 2026,
    month: 11,
    periodIndex: 1,
    publicationDate: '2026-11-16',
    evidenceCutoffDate: '15 November 2026, 18:00 WAT',
    methodologyVersion: '1.1',
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

let passed = 0;
function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] Stage 4 Test ${passed}: ${name}`);
  } catch (err) {
    console.error(`[FAIL] Stage 4 Test: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Test 1: Mobile-first top-of-page order and preserved long explanatory content
// ---------------------------------------------------------------------------
runTest('Mobile-first page hierarchy order and preserved explanatory sections', () => {
  const titleIdx = dcmPreviewSource.indexOf('>Democratic Competitiveness Map<') !== -1
    ? dcmPreviewSource.indexOf('>Democratic Competitiveness Map<')
    : dcmPreviewSource.indexOf('Democratic Competitiveness Map\n');
  const purposeIdx = dcmPreviewSource.indexOf(
    'Evidence-based classifications of the practical conditions for political competition across Nigeria'
  );
  const watCutoffIdx = dcmPreviewSource.indexOf('Evidence cut-off:');
  const mapCardIdx = dcmPreviewSource.indexOf('id="dcm-map-section"');
  const mapInstructionIdx = dcmPreviewSource.indexOf('{MAP_SELECTION_INSTRUCTION}');
  const dailyUpdateIdx = dcmPreviewSource.indexOf('id="dcm-daily-update"');
  const quickNavIdx = dcmPreviewSource.indexOf('aria-label="Jump to DCM page sections"');
  const controlsAsideIdx = dcmPreviewSource.indexOf('id="dcm-date-selector"');
  const legendIdx = dcmPreviewSource.indexOf('id="dcm-colour-legend"');
  const whatIsDcmIdx = dcmPreviewSource.indexOf('What is DCM?');

  assert.ok(titleIdx > 0, 'Title must exist');
  assert.ok(purposeIdx > titleIdx, 'Short purpose statement must follow title');
  assert.ok(watCutoffIdx > purposeIdx, 'WAT cut-off metadata must follow purpose statement');
  assert.ok(mapCardIdx > watCutoffIdx, 'Interactive Nigeria map must follow WAT cut-off');
  assert.ok(mapInstructionIdx > mapCardIdx, 'Map selection instruction must follow map');
  assert.ok(dailyUpdateIdx > mapInstructionIdx, '"What changed today?" section must sit immediately below map');
  assert.ok(quickNavIdx > dailyUpdateIdx, 'Mobile quick-jump links must follow update section');
  assert.ok(controlsAsideIdx > quickNavIdx, 'Date selection & state evidence panel must follow');
  assert.ok(legendIdx > controlsAsideIdx, 'Colour legend definitions must follow below main map experience');
  assert.ok(whatIsDcmIdx > legendIdx, 'Long explanatory methodology sections must sit below legend');

  // Exact instruction copy check
  assert.equal(
    MAP_SELECTION_INSTRUCTION,
    'Select a state to see its classification and the evidence behind it.'
  );

  // All original long explanatory headings must remain intact (never deleted)
  for (const heading of [
    'What is DCM?',
    'What does it track?',
    'What does it seek to achieve?',
    'What is it not?',
    'How do the colours work?'
  ]) {
    assert.ok(
      dcmPreviewSource.includes(heading),
      `Preserved explanatory heading missing: ${heading}`
    );
  }

  // Collapsible on mobile (< lg), always expanded on desktop (lg:block)
  assert.ok(
    dcmPreviewSource.includes("openExplanatoryMobile.whatIsDcm ? 'block mt-3' : 'hidden'} lg:block"),
    'Long explanatory content must collapse cleanly on mobile and stay expanded on desktop'
  );
});

// ---------------------------------------------------------------------------
// Test 2: "What changed today?" heading logic & zero-fabrication guarantee
// ---------------------------------------------------------------------------
runTest('"What changed today?" vs "Latest published update" & no fabricated text', () => {
  // Reference clock: 2026-11-20 12:00 UTC => 2026-11-20 13:00 WAT
  const nowUtc = new Date('2026-11-20T12:00:00Z');
  assert.equal(getTodayWatIsoDate(nowUtc), '2026-11-20');

  // Late-night UTC boundary: 2026-11-19 23:30 UTC => 2026-11-20 00:30 WAT
  assert.equal(getTodayWatIsoDate(new Date('2026-11-19T23:30:00Z')), '2026-11-20');

  const todayDaily = makePublication({
    id: 'dcm-daily-2026-11-20',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-20',
    reportingPeriodLabel: '20 November 2026',
    evidenceCutoffTimeWat: '18:00 WAT',
    evidenceCutoffDate: '20 November 2026, 18:00 WAT',
    isLatest: true,
    summary: 'Research-approved daily summary: Kaduna moved to Amber following verified court order.',
    supportingDocumentUrl: 'https://aeo.athenacentre.org/dcm/2026-11-20'
  });

  const yesterdayDaily = makePublication({
    id: 'dcm-daily-2026-11-19',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-19',
    reportingPeriodLabel: '19 November 2026',
    isLatest: true,
    summary: 'Research-approved summary for 19 November 2026.',
    supportingDocumentUrl: 'javascript:alert(1)'
  });

  const legacyHistorical = makePublication({
    id: 'dcm-2026-11-p1',
    publicationFormat: 'legacy-period',
    reportingPeriodLabel: '1st – 15th November 2026',
    summary: 'Historical twice-monthly summary.'
  });

  const noSummaryDaily = makePublication({
    id: 'dcm-daily-2026-11-20-empty',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-20',
    reportingPeriodLabel: '20 November 2026',
    summary: '   ',
    changesSummary: ''
  });

  const draftPub = makePublication({
    id: 'dcm-daily-draft',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-20',
    status: 'draft',
    summary: 'Unpublished draft text that must NEVER appear publicly.'
  });

  // Case A: Viewing today's published daily edition -> "What changed today?"
  const bannerToday = resolveDailyUpdateBanner(todayDaily, todayDaily, nowUtc);
  assert.equal(bannerToday.heading, 'What changed today?');
  assert.equal(bannerToday.isTodayDailyEdition, true);
  assert.equal(bannerToday.hasApprovedSummary, true);
  assert.equal(bannerToday.completeRecordUrl, 'https://aeo.athenacentre.org/dcm/2026-11-20');

  // Case B: Viewing latest published edition from yesterday -> "Latest published update" (NOT "What changed today?")
  const bannerYesterdayLatest = resolveDailyUpdateBanner(yesterdayDaily, yesterdayDaily, nowUtc);
  assert.equal(bannerYesterdayLatest.heading, 'Latest published update');
  assert.equal(bannerYesterdayLatest.isTodayDailyEdition, false);
  assert.equal(bannerYesterdayLatest.completeRecordUrl, null, 'javascript: URLs must be rejected');

  // Case C: Viewing manually selected historical edition -> accurately dated heading
  const bannerHistorical = resolveDailyUpdateBanner(legacyHistorical, todayDaily, nowUtc);
  assert.equal(bannerHistorical.heading, 'Published update — 1st – 15th November 2026');
  assert.equal(bannerHistorical.isTodayDailyEdition, false);
  assert.equal(bannerHistorical.isLatestEdition, false);

  // Case D: Missing approved summary -> transparent unavailable message, never fabricated
  const bannerMissing = resolveDailyUpdateBanner(noSummaryDaily, noSummaryDaily, nowUtc);
  assert.equal(bannerMissing.hasApprovedSummary, false);
  assert.equal(bannerMissing.summaryParagraphs.length, 0);
  assert.equal(bannerMissing.unavailableMessage, TRANSPARENT_MISSING_SUMMARY_MESSAGE);

  // Case E: Draft publication -> blocked transparently
  const bannerDraft = resolveDailyUpdateBanner(draftPub, todayDaily, nowUtc);
  assert.equal(bannerDraft.hasApprovedSummary, false);
  assert.equal(bannerDraft.summaryParagraphs.length, 0);
});

// ---------------------------------------------------------------------------
// Test 3: Unified full-width mobile publication selector & historical lock
// ---------------------------------------------------------------------------
runTest('Mobile publication selector supports daily + legacy options with stable IDs and no auto-reset', () => {
  const legacy1 = makePublication({
    id: 'dcm-2026-10-p2',
    reportingPeriodLabel: '16th – 31st October 2026',
    year: 2026,
    month: 10,
    periodIndex: 2,
    periodStart: '2026-10-16',
    periodEnd: '2026-10-31',
    publicationDate: '2026-11-01'
  });
  const legacy2 = makePublication({
    id: 'dcm-2026-11-p1',
    reportingPeriodLabel: '1st – 15th November 2026',
    year: 2026,
    month: 11,
    periodIndex: 1,
    periodStart: '2026-11-01',
    periodEnd: '2026-11-15',
    publicationDate: '2026-11-16'
  });
  const daily1 = makePublication({
    id: 'dcm-daily-2026-11-18',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-18',
    reportingPeriodLabel: '18 November 2026',
    year: 2026,
    month: 11,
    periodIndex: 2,
    periodStart: '2026-11-18',
    periodEnd: '2026-11-18',
    publicationDate: '2026-11-18',
    evidenceCutoffDate: '18 November 2026, 18:00 WAT'
  });
  const daily2 = makePublication({
    id: 'dcm-daily-2026-11-19',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-19',
    reportingPeriodLabel: '19 November 2026',
    year: 2026,
    month: 11,
    periodIndex: 2,
    periodStart: '2026-11-19',
    periodEnd: '2026-11-19',
    publicationDate: '2026-11-19',
    evidenceCutoffDate: '19 November 2026, 18:00 WAT',
    isLatest: true
  });

  const canonicalAsc = resolvePublicDcmPublications([legacy2, daily2, legacy1, daily1]);
  const options = buildUnifiedPublicationOptions(canonicalAsc);

  assert.equal(options.length, 4);
  // Newest-first ordering for mobile usability
  assert.equal(options[0].id, 'dcm-daily-2026-11-19');
  assert.equal(options[0].isLatest, true);
  assert.equal(options[0].isDaily, true);
  assert.ok(options[0].label.includes('19 November 2026') && options[0].label.includes('(Daily)'));

  assert.equal(options[1].id, 'dcm-daily-2026-11-18');
  assert.equal(options[2].id, 'dcm-2026-11-p1');
  assert.equal(options[2].label, '1st – 15th November 2026');
  assert.equal(options[3].id, 'dcm-2026-10-p2');
  assert.equal(options[3].label, '16th – 31st October 2026');

  // Selecting an older historical publication stays locked even when newer editions exist
  const locked = resolveSelectedPublication(canonicalAsc, 'dcm-2026-10-p2', false);
  assert.equal(locked.activePublication?.id, 'dcm-2026-10-p2');
  assert.equal(locked.isLatest, false);

  // Confirm DcmPreview renders #dcm-mobile-publication full-width on < lg and preserves desktop 3-col on lg+
  assert.ok(dcmPreviewSource.includes('id="dcm-mobile-publication"'));
  assert.ok(dcmPreviewSource.includes('className="flex flex-col gap-1.5 lg:hidden min-w-0"'));
  assert.ok(dcmPreviewSource.includes('className="hidden lg:grid lg:grid-cols-3 gap-2.5 min-w-0"'));
});

// ---------------------------------------------------------------------------
// Test 4: Desktop layout regression protection
// ---------------------------------------------------------------------------
runTest('Desktop two-column layout and Year/Month/Period selectors preserved', () => {
  assert.ok(
    dcmPreviewSource.includes('lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]'),
    'Desktop 2-column grid with sticky right controls must be preserved'
  );
  assert.ok(dcmPreviewSource.includes('id="dcm-year"'), 'Desktop Year selector preserved');
  assert.ok(dcmPreviewSource.includes('id="dcm-month"'), 'Desktop Month selector preserved');
  assert.ok(dcmPreviewSource.includes('id="dcm-period"'), 'Desktop Period selector preserved');
  assert.ok(
    dcmPreviewSource.includes('className="hidden md:block overflow-x-auto my-4 border border-line rounded-xl"'),
    'Desktop 3-column colour legend table preserved on md+'
  );
});

// ---------------------------------------------------------------------------
// Test 5: Interactive Nigeria map geometry, touch targets, clamped tooltip & selected-state feedback
// ---------------------------------------------------------------------------
runTest('Map preserves all 37 Nigeria jurisdictions, touch targets, clamped tooltip & selected-state bar', () => {
  assert.equal(DCM_GEO.states.length, 37, 'All 36 states + FCT must exist in DCM_GEO.states');
  assert.ok(dcmPreviewSource.includes('viewBox="0 0 760 617"'), 'Accurate Nigeria SVG viewBox preserved');
  assert.ok(
    dcmPreviewSource.includes('w-10 h-10 sm:w-8 sm:h-8'),
    'Map zoom/label/search buttons must provide 40px touch targets on mobile'
  );
  assert.ok(
    dcmPreviewSource.includes("width: 'min(240px, calc(100vw - 96px))'"),
    'Map search popover width must be clamped for 320px viewports'
  );
  assert.ok(
    dcmPreviewSource.includes('const cardW = Math.min(296, Math.max(220, containerW - 16));'),
    'Floating map tooltip width must clamp to container width on narrow mobile viewports'
  );
  assert.ok(
    dcmPreviewSource.includes('Inspect evidence'),
    'Selected-state feedback bar below map must offer direct jump to state evidence'
  );
});

// ---------------------------------------------------------------------------
// Test 6: Classification legend canonical palette & disclaimer
// ---------------------------------------------------------------------------
runTest('Classification legend uses canonical 5 colours, stacked mobile cards & required disclaimer', () => {
  assert.equal(DCM_LEGEND_DEFINITIONS.length, 5);
  assert.equal(
    INSUFFICIENT_EVIDENCE_DISCLAIMER,
    'Insufficient evidence does not mean conditions are open.'
  );

  for (const item of DCM_LEGEND_DEFINITIONS) {
    assert.equal(
      item.hex,
      DCM_CANONICAL_PALETTE[item.code].hex,
      `Legend hex for ${item.classification} must match canonical map palette`
    );
    assert.equal(
      item.classification,
      DCM_CANONICAL_PALETTE[item.code].name,
      `Legend label for ${item.code} must match canonical classification name`
    );
  }

  // Disclaimer must appear in both map legend and definitions legend
  const disclaimerOccurrences = (
    dcmPreviewSource.match(/\{INSUFFICIENT_EVIDENCE_DISCLAIMER\}/g) || []
  ).length;
  assert.ok(
    disclaimerOccurrences >= 2,
    `Expected INSUFFICIENT_EVIDENCE_DISCLAIMER beside map legend and colour definitions legend, found ${disclaimerOccurrences}`
  );
  assert.ok(
    dcmPreviewSource.includes('className="md:hidden space-y-3"'),
    'Stacked mobile legend cards must be present for narrow screens'
  );
});

// ---------------------------------------------------------------------------
// Test 7: Stage 3 State Assessment Panel SSR mobile-readability & wrapping
// ---------------------------------------------------------------------------
runTest('Stage 3 DcmStateAssessmentPanel renders mobile-safe wrapped HTML for long URLs, responses & incidents', () => {
  const longUrl =
    'https://reports.independent-election-monitor.example.org/2026/11/nigeria/kaduna/verified-public-order-directive-and-rally-access-restoration-chronology?edition=2026-11-19&ref=AEO-EVID-001';

  const prevPub = makePublication({
    id: 'dcm-2026-11-p1',
    reportingPeriodLabel: '1st – 15th November 2026',
    publicationDate: '2026-11-16'
  });

  const currentPub = makePublication({
    id: 'dcm-daily-2026-11-19',
    publicationFormat: 'daily',
    assessmentDate: '2026-11-19',
    reportingPeriodLabel: '19 November 2026',
    periodStart: '2026-11-19',
    periodEnd: '2026-11-19',
    publicationDate: '2026-11-19',
    evidenceCutoffDate: '19 November 2026, 18:00 WAT',
    isLatest: true,
    classifications: {
      ...makeAllStates('Insufficient evidence'),
      KD: {
        stateCode: 'KD',
        stateName: 'Kaduna',
        classification: 'Emerging concern',
        keyFinding: 'Verified temporary restriction on rally venue access later reversed after formal review.',
        direction: 'Deteriorating',
        confidence: 'High',
        carriedForward: false
      }
    }
  });

  const evidenceRecords: DcmEvidenceRecord[] = [
    {
      id: 'ev-kd-2026-11-19-01',
      stateCode: 'KD',
      stateName: 'Kaduna',
      incidentId: 'inc-kd-2026-11-19-01',
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      title: 'Municipal Stadium Venue Permit Suspension and Subsequent Administrative Reversal Notice',
      publicDescription:
        'Public notice issued by state facilities agency suspending opposition rally booking, followed 24 hours later by formal written restoration.',
      sourceName: 'Kaduna State Public Facilities Gazette & Independent Civic Legal Desk',
      sourcePublicationDate: '2026-11-18',
      sourceUrl: longUrl,
      documentReference: 'DOC-KAD-2026-11-18-EXTENDED-REFERENCE-9988776655',
      verificationStatus: 'Corroborated (Multiple Sources)',
      isDisputed: true,
      disputedClaimNote: 'State agency disputed initial notice timeline.',
      institutionalResponse: {
        requested: true,
        requestedDate: '2026-11-18',
        received: true,
        responseDate: '2026-11-19',
        respondentName: 'Kaduna State Facilities Directorate',
        publicSummary: 'Confirmed booking restoration after scheduled maintenance review.'
      },
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-19T10:00:00Z'),
      updatedAt: Date.parse('2026-11-19T12:00:00Z')
    }
  ];

  const incidentRecords: DcmIncidentRecord[] = [
    {
      id: 'inc-kd-2026-11-19-01',
      stateCode: 'KD',
      stateName: 'Kaduna',
      title: 'Kaduna Central Rally Venue Access Dispute',
      summary: 'Multi-day sequence tracking denial, review, and restoration of public stadium venue access.',
      researchStatusLabel: 'Access restored — under monitoring',
      firstReportedDate: '2026-11-17',
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-17T10:00:00Z'),
      updatedAt: Date.parse('2026-11-19T12:00:00Z')
    }
  ];

  const developmentRecords: DcmIncidentDevelopment[] = [
    {
      id: 'dev-inc-kd-01',
      incidentId: 'inc-kd-2026-11-19-01',
      stateCode: 'KD',
      developmentDate: '2026-11-17',
      title: 'Venue access denied',
      approvedDescription: 'Venue access denied via late afternoon administrative memo.',
      researchStatusLabel: 'Verified by Research',
      sourceReferences: [
        {
          sourceName: 'Civic Legal Desk',
          publicationDate: '2026-11-17',
          url: longUrl
        }
      ],
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-17T16:00:00Z'),
      updatedAt: Date.parse('2026-11-17T16:00:00Z')
    },
    {
      id: 'dev-inc-kd-02',
      incidentId: 'inc-kd-2026-11-19-01',
      stateCode: 'KD',
      developmentDate: '2026-11-18',
      title: 'Approval restored',
      approvedDescription: 'Approval restored in writing by facilities directorate.',
      researchStatusLabel: 'Verified by Research',
      isRemedyOrFollowUp: true,
      sourceReferences: [],
      linkedPublicationIds: ['dcm-daily-2026-11-19'],
      visibility: 'public',
      status: 'published',
      approvalRecord: VALID_APPROVAL,
      createdAt: Date.parse('2026-11-18T16:00:00Z'),
      updatedAt: Date.parse('2026-11-18T16:00:00Z')
    }
  ];

  const panelData = resolveStateAssessmentPanelData({
    selectedPub: currentPub,
    previousPub: prevPub,
    allPublishedSortedAsc: [prevPub, currentPub],
    stateKey: 'Kaduna',
    evidenceRecords,
    incidentRecords,
    developmentRecords
  });

  assert.equal(panelData.supportingEvidence.length, 1, 'Expected 1 approved public evidence record');
  assert.equal(panelData.incidents.length, 1, 'Expected 1 approved public incident record');
  assert.equal(panelData.incidents[0].developments.length, 2, 'Expected 2 developments under incident');

  const html = renderToStaticMarkup(
    React.createElement(DcmStateAssessmentPanel, {
      panelData,
      selectedPeriodLabel: '19 November 2026',
      evidenceCutoffLabel: '19 November 2026, 18:00 WAT',
      onSelectHistoricalEdition: () => {}
    })
  );

  // All 5 sections (A–E) render publicly without requiring DCM Brief request
  assert.ok(html.includes('Classification Overview'));
  assert.ok(html.includes('Supporting Evidence'));
  assert.ok(html.includes('Institutional Response'));
  assert.ok(html.includes('Incident History'));
  assert.ok(html.includes('Historical Assessments'));

  // Long URL and document reference render with mobile wrapping classes (break-all / break-words / min-w-0)
  assert.ok(html.includes('break-all'));
  assert.ok(html.includes('break-words'));
  assert.ok(html.includes('min-w-0'));
  assert.ok(html.includes('min-h-[44px]'));
  assert.ok(html.includes('State agency disputed initial notice timeline.'));
  assert.ok(html.includes('Kaduna Central Rally Venue Access Dispute'));
  assert.ok(html.includes('Venue access denied'));
  assert.ok(html.includes('Approval restored'));
  assert.ok(html.includes('View edition'));
});

// ---------------------------------------------------------------------------
// Test 8: Multi-viewport overflow & fixed-width audit (320px, 375px, 390px, 768px, 1024px+)
// ---------------------------------------------------------------------------
runTest('Zero unsafe fixed pixel widths (>=300px) and mobile overflow protection across 320px-1024px+', () => {
  // Root container prevents horizontal scroll bleed
  assert.ok(
    dcmPreviewSource.includes('overflow-x-hidden'),
    'DcmPreview root container must enforce overflow-x-hidden'
  );

  // Verify no inline fixed pixel width or minWidth >= 300px in DcmPreview or DcmStateAssessmentPanel
  const unsafeWidthPattern = /\b(?:width|minWidth)\s*:\s*['"`][3-9]\d{2,}px['"`]/g;
  const previewMatches = dcmPreviewSource.match(unsafeWidthPattern) || [];
  const panelMatches = statePanelSource.match(unsafeWidthPattern) || [];

  assert.equal(
    previewMatches.length,
    0,
    `Unsafe fixed width >=300px found in DcmPreview.tsx: ${previewMatches.join(', ')}`
  );
  assert.equal(
    panelMatches.length,
    0,
    `Unsafe fixed width >=300px found in DcmStateAssessmentPanel.tsx: ${panelMatches.join(', ')}`
  );

  // Verify Year Trend Grid 12-month abbreviations fit 320px viewports
  assert.ok(
    dcmPreviewSource.includes('text-[9px] sm:text-[11px] leading-tight'),
    '12-column month abbreviation strip must scale cleanly to 320px viewports'
  );
});

// ---------------------------------------------------------------------------
// Test 9: Embedded homepage mode (hideAside) & DCM Brief Microsoft Graph continuity
// ---------------------------------------------------------------------------
runTest('Embedded homepage mode stays clean and Microsoft Graph DCM Brief integration remains intact', () => {
  assert.ok(
    dcmPreviewSource.includes('{!hideAside && ('),
    'Standalone mobile header, update card, and about/legend blocks must remain scoped to standalone DCM page'
  );
  assert.ok(
    dcmPreviewSource.includes("fetch('/api/dcm-brief-request'"),
    'DCM Brief modal must continue posting to /api/dcm-brief-request'
  );
  assert.ok(
    serverSource.includes("app.post('/api/dcm-brief-request'"),
    'Backend Microsoft Graph DCM Brief request route must remain untouched'
  );
});

// ---------------------------------------------------------------------------
// Test 10: Governance check — no Stage 4 writes to Production or rules deployment
// ---------------------------------------------------------------------------
runTest('Stage 4 mobile module stays purely read-only with no Firestore mutations', () => {
  const dcmMobileSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src/utils/dcmMobile.ts'),
    'utf8'
  );
  assert.equal(dcmMobileSource.includes('setDoc'), false);
  assert.equal(dcmMobileSource.includes('updateDoc'), false);
  assert.equal(dcmMobileSource.includes('deleteDoc'), false);
  assert.equal(dcmMobileSource.includes('addDoc'), false);
});

console.log(`\nStage 4 Summary: ${passed}/10 passed.`);
