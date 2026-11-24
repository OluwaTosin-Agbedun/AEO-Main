import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { DCM_GEO } from '../data/dcmGeoData';

import { useCMS } from '../context/CMSContext';
import { INITIAL_DCM_PUBLICATIONS } from '../data/dcmInitialData';
import { DcmPublication } from '../types/dcm';
import { formatDailyDateLabel } from '../utils/dcmDaily';
import {
  buildCanonicalPublicationView,
  CanonicalPublicationView,
  CanonicalStateView,
  DCM_CANONICAL_CODES,
  DCM_CANONICAL_PALETTE,
  DCM_DIRECTION_LABELS,
  resolveJurisdictionMeta,
  resolvePublicDcmPublications,
  resolveSelectedPublication,
  TRANSPARENT_CARRIED_FORWARD_NO_NOTE,
  TRANSPARENT_MISSING_CLASSIFICATION_NOTE,
  TRANSPARENT_MISSING_EVIDENCE_NOTE
} from '../utils/dcmConsistency';
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink, GitBranch } from 'lucide-react';
import { resolveStateAssessmentPanelData } from '../utils/dcmEvidence';
import { DcmStateAssessmentPanel } from './DcmStateAssessmentPanel';
import { DcmArchiveSection } from './DcmArchiveSection';
import {
  buildUnifiedPublicationOptions,
  DCM_LEGEND_DEFINITIONS,
  INSUFFICIENT_EVIDENCE_DISCLAIMER,
  MAP_SELECTION_INSTRUCTION,
  resolveDailyUpdateBanner
} from '../utils/dcmMobile';
import {
  buildAbsoluteDcmPermalink,
  buildDcmPermalinkUrl,
  resolveDcmPermalink,
  resolvePublicationCorrectionChain
} from '../utils/dcmArchive';

// Classification Categories and Palette (sourced from canonical palette)
export const DCM_CAT: Record<string, { name: string; hex: string }> = {
  G: { name: DCM_CANONICAL_PALETTE.G.name, hex: DCM_CANONICAL_PALETTE.G.hex },
  A: { name: DCM_CANONICAL_PALETTE.A.name, hex: DCM_CANONICAL_PALETTE.A.hex },
  O: { name: DCM_CANONICAL_PALETTE.O.name, hex: DCM_CANONICAL_PALETTE.O.hex },
  R: { name: DCM_CANONICAL_PALETTE.R.name, hex: DCM_CANONICAL_PALETTE.R.hex },
  X: { name: DCM_CANONICAL_PALETTE.X.name, hex: DCM_CANONICAL_PALETTE.X.hex },
  U: { name: DCM_CANONICAL_PALETTE.U.name, hex: DCM_CANONICAL_PALETTE.U.hex }
};

export const DCM_ORDER = DCM_CANONICAL_CODES;

export const DCM_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Base classifications as shown on the map reference
export const DCM_BASE: Record<string, string> = {
  Borno: 'A',
  Kaduna: 'A',
  Kwara: 'A',
  Kogi: 'A',
  Benue: 'O',
  Enugu: 'O',
  Delta: 'O',
  Anambra: 'O',
  Imo: 'A',
  'Akwa Ibom': 'A'
};

function dcmWith(base: Record<string, string>, ch: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = { ...base };
  for (const k in ch) o[k] = ch[k];
  return o;
}

// 1st July – 30th September 2026 (baseline period)
export const DCM_P1 = { ...DCM_BASE };

// 1st – 15th October 2026 (current publication with Edo, Kano, and Oyo newly classified)
export const DCM_P2 = dcmWith(DCM_P1, {
  Edo: 'O',
  Kano: 'A',
  Oyo: 'O'
});

export interface DcmStateDetail {
  keyFinding?: string;
  confidence?: 'High' | 'Medium' | 'Low' | string;
  direction?: 'newly-classified' | 'deteriorating' | 'improving' | 'stable' | 'unchanged' | 'insufficient-basis' | string;
  rightOfResponse?: string;
  carriedForward?: boolean;
  lastSubstantiveReviewDate?: string;
}

export const BASELINE_DETAILS: Record<string, DcmStateDetail> = {
  Kaduna: {
    keyFinding: 'Police confirm using tear gas at the ADC governorship launch; supporters of both main parties allege attacks.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Benue: {
    keyFinding: 'Material restrictions and security concerns affecting political mobilisation across multiple LGAs.',
    confidence: 'High',
    direction: 'newly-classified'
  },
  Delta: {
    keyFinding: 'Verified interference with opposition campaign mobilisation and logistical movement.',
    confidence: 'High',
    direction: 'newly-classified'
  },
  Enugu: {
    keyFinding: 'Contested access to political assembly and documented security incidents affecting party offices.',
    confidence: 'High',
    direction: 'newly-classified'
  },
  Anambra: {
    keyFinding: 'Security concerns and movement restrictions impacting evening and weekend voter mobilisation.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Imo: {
    keyFinding: 'Unresolved disputes and heightened security tension affecting political gatherings in rural constituencies.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Abia: {
    keyFinding: 'Emerging pressure on party campaign signages and localized assembly friction.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Kogi: {
    keyFinding: 'Documented incidents of partisan intimidation and disruption of voter mobilization outings.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Osun: {
    keyFinding: 'Partisan friction and contested administrative neutrality ahead of governorship preparation.',
    confidence: 'Medium',
    direction: 'newly-classified'
  },
  Rivers: {
    keyFinding: 'Intense institutional disputes and threats affecting party coordination structures.',
    confidence: 'High',
    direction: 'newly-classified'
  }
};

export interface DcmPubItem {
  id: string;
  year: number;
  month: number; // 0-indexed: 8 = Sept, 9 = Oct
  half: number;  // 0 = 1st-15th, 1 = 16th-end
  publicationFormat?: 'legacy-period' | 'daily';
  assessmentDate?: string;
  evidenceCutoffTimeWat?: string;
  evidenceCutoffDateTimeWat?: string;
  publishedAt?: string;
  isQuietDay?: boolean;
  carriedForwardAllStates?: boolean;
  pubTitle?: string;
  label: string;
  short: string;
  cutoff: string;
  method: string;
  revisions: string;
  summary?: string;
  changesSummary?: string;
  cls: Record<string, string>;
  details?: Record<string, DcmStateDetail>;
  canonicalView?: CanonicalPublicationView;
  rawPublication?: DcmPublication;
}

/**
 * Returns state display metadata strictly from the approved publication record.
 * Never fabricates direction from colour ranks, never fabricates confidence,
 * never substitutes generic classification descriptions for missing findings,
 * and displays missing classification/evidence transparently.
 */
export function getStateDetails(
  pub: DcmPubItem,
  _prevPub: DcmPubItem | null,
  stateName: string
): {
  code: string;
  hex: string;
  classification: string;
  isClassificationUnavailable: boolean;
  direction: string;
  rawDirection: string;
  confidence: string;
  keyFinding: string;
  hasApprovedFinding: boolean;
  rightOfResponse: string;
  carriedForward: boolean;
  lastSubstantiveReviewDate: string;
} {
  // Primary path: pull directly from the canonical publication view (single source of truth)
  const canonical: CanonicalStateView | undefined = pub.canonicalView?.statesByMapName[stateName];
  if (canonical) {
    return {
      code: canonical.code,
      hex: canonical.hex,
      classification: canonical.classification,
      isClassificationUnavailable: canonical.isClassificationUnavailable,
      direction: canonical.directionLabel,
      rawDirection: canonical.rawDirection,
      confidence: canonical.confidenceLabel,
      keyFinding: canonical.keyFinding,
      hasApprovedFinding: canonical.hasApprovedFinding,
      rightOfResponse: canonical.rightOfResponseLabel,
      carriedForward: canonical.carriedForward,
      lastSubstantiveReviewDate: canonical.lastSubstantiveReviewDate
    };
  }

  // Fallback path for standalone DcmPubItem objects (strictly zero-fabrication)
  const explicit = pub.details?.[stateName];
  const rawCode = pub.cls && pub.cls[stateName];
  const catCode = rawCode && DCM_CAT[rawCode] ? rawCode : 'U';
  const catObj = DCM_CAT[catCode] || DCM_CAT.U;
  const isUnavailable = catCode === 'U';
  const isCarriedForward = Boolean(explicit?.carriedForward);

  if (isUnavailable) {
    return {
      code: 'U',
      hex: DCM_CAT.U.hex,
      classification: DCM_CAT.U.name,
      isClassificationUnavailable: true,
      direction: 'Not recorded',
      rawDirection: '',
      confidence: 'Not recorded',
      keyFinding: TRANSPARENT_MISSING_CLASSIFICATION_NOTE,
      hasApprovedFinding: false,
      rightOfResponse: 'Not recorded',
      carriedForward: false,
      lastSubstantiveReviewDate: ''
    };
  }

  const rawDir = (explicit?.direction || '').trim();
  const directionLabel = rawDir
    ? (DCM_DIRECTION_LABELS[rawDir.toLowerCase()] || rawDir)
    : (isCarriedForward ? 'Carried forward (unchanged)' : 'Not specified');

  const confidence = (explicit?.confidence || '').trim() || 'Not specified';
  const approvedFinding = (explicit?.keyFinding || '').trim();
  const hasApprovedFinding = approvedFinding.length > 0;
  const keyFinding = hasApprovedFinding
    ? approvedFinding
    : (isCarriedForward ? TRANSPARENT_CARRIED_FORWARD_NO_NOTE : TRANSPARENT_MISSING_EVIDENCE_NOTE);

  return {
    code: catCode,
    hex: catObj.hex,
    classification: catObj.name,
    isClassificationUnavailable: false,
    direction: directionLabel,
    rawDirection: rawDir,
    confidence,
    keyFinding,
    hasApprovedFinding,
    rightOfResponse: (explicit?.rightOfResponse || '').trim() || 'Not specified',
    carriedForward: isCarriedForward,
    lastSubstantiveReviewDate: explicit?.lastSubstantiveReviewDate || ''
  };
}

export const DCM_PUBS: DcmPubItem[] = [
  {
    id: 'legacy-pilot-2026-06',
    year: 2026,
    month: 5,
    half: 1,
    pubTitle: 'Democratic Competitiveness Map',
    label: '16th – 30th June 2026',
    short: '16th – 30th June 2026',
    cutoff: '30 June 2026',
    method: 'v1.0 (pilot)',
    revisions: 'none',
    summary: 'Initial pilot map establishing baseline classifications across Nigeria’s 36 states and the FCT.',
    cls: DCM_BASE,
    details: BASELINE_DETAILS
  },
  {
    id: 'legacy-baseline-2026-09',
    year: 2026,
    month: 8,
    half: 1,
    pubTitle: 'Democratic Competitiveness Map',
    label: '1st July – 30th September 2026',
    short: '1st July – 30th September 2026',
    cutoff: '30 September 2026',
    method: 'v1.0 (pilot)',
    revisions: 'none',
    summary: 'Initial national assessment evaluating political competition space across Nigeria ahead of the 2027 general elections. Concerns around political mobilisation are evident in Benue, Delta and Enugu, while campaign-access issues have emerged in Anambra, Abia, Imo, Kaduna, Kogi, Osun and Rivers.',
    cls: DCM_P1,
    details: BASELINE_DETAILS
  },
  {
    id: 'legacy-oct-2026-15',
    year: 2026,
    month: 9,
    half: 0,
    pubTitle: 'Democratic Competitiveness Map',
    label: '1st – 15th October 2026',
    short: '1st – 15th October 2026',
    cutoff: '15 October 2026',
    method: 'v1.1',
    revisions: 'none',
    summary: 'Three months before the 2027 general elections, the space for opposition campaigning is narrowing in a growing number of states. In the first half of October, five more states showed material concerns, and violence against opposition events and party offices spread beyond the South-East. This brief sets out where conditions are deteriorating, why it matters, and what each institution can do before campaigns intensify.',
    cls: DCM_P2,
    details: {
      ...BASELINE_DETAILS,
      Edo: {
        keyFinding: 'Classification changed following verified incidents affecting campaign access, armed attacks on candidate convoys in Igueben, and threatening rhetoric against political...',
        confidence: 'High',
        direction: 'deteriorating',
        rightOfResponse: 'Requested'
      },
      Kano: {
        keyFinding: 'Classification changed following emerging political assembly friction and aggressive statements against rival mobilization in urban centers.',
        confidence: 'Medium',
        direction: 'newly-classified',
        rightOfResponse: 'Requested'
      },
      Oyo: {
        keyFinding: 'Classification changed following violent disruption of political reception in Ibadan South-West resulting in a confirmed supporter fatality.',
        confidence: 'High',
        direction: 'deteriorating',
        rightOfResponse: 'Requested'
      }
    }
  }
];

// Small state label font size adjustment mapping
export const DCM_SMALL: Record<string, number> = {
  Anambra: 1,
  Imo: 1,
  Abia: 1,
  Ebonyi: 1,
  Lagos: 1,
  Rivers: 1,
  Bayelsa: 1,
  'Akwa Ibom': 1,
  Enugu: 1,
  FCT: 1,
  Ekiti: 1,
  Osun: 1
};

export const SECTORS = [
  { value: 'media', label: 'Media' },
  { value: 'cso', label: 'Civil society organisation' },
  { value: 'research', label: 'Academic or research institution' },
  { value: 'partner', label: 'Development partner or diplomatic mission' },
  { value: 'private', label: 'Private sector' },
  { value: 'party', label: 'Political party, candidate or campaign' },
  { value: 'government', label: 'Government or public institution' },
  { value: 'individual', label: 'Individual or other' }
];

export interface DcmPreviewProps {
  isEmbedded?: boolean;
  hideAside?: boolean;
}

export const DcmPreview: React.FC<DcmPreviewProps> = ({ isEmbedded = false, hideAside = false }) => {
  const {
    dcmPublications,
    dcmEvidence,
    dcmIncidents,
    dcmIncidentDevelopments,
    dcmArchiveError,
    retryDcmArchiveQueries,
    loadDcmPublicationById,
    loadDcmArchiveMonth,
    loadDcmStateEvidence
  } = useCMS();

  const isStandaloneUrlMode = !isEmbedded && !hideAside;

  // Single canonical source of strictly published DCM editions (daily + legacy) sorted chronologically ascending
  const publishedCanonical: DcmPublication[] = useMemo(() => {
    return resolvePublicDcmPublications(dcmPublications, INITIAL_DCM_PUBLICATIONS);
  }, [dcmPublications]);

  // Project each canonical publication through buildCanonicalPublicationView so map, cards, search, legend,
  // metadata, and trend cells all share the exact same approved publication snapshot.
  const allPubs: DcmPubItem[] = useMemo(() => {
    return publishedCanonical.map((pub) => {
      const view = buildCanonicalPublicationView(pub);
      const clsMap: Record<string, string> = {};
      const detailsMap: Record<string, DcmStateDetail> = {};

      for (const st of view.stateList) {
        clsMap[st.mapName] = st.code;
        detailsMap[st.mapName] = {
          keyFinding: st.hasApprovedFinding ? st.keyFinding : '',
          confidence: st.hasApprovedConfidence ? st.confidenceLabel : '',
          direction: st.hasApprovedDirection ? st.rawDirection : '',
          rightOfResponse: st.rightOfResponseLabel !== 'Not specified' ? st.rightOfResponseLabel : '',
          carriedForward: st.carriedForward,
          lastSubstantiveReviewDate: st.lastSubstantiveReviewDate
        };
      }

      return {
        id: pub.id,
        year: view.meta.year,
        month: view.meta.month - 1,
        half: view.meta.periodIndex === 1 ? 0 : 1,
        publicationFormat: view.meta.isDaily ? 'daily' : 'legacy-period',
        assessmentDate: pub.assessmentDate,
        evidenceCutoffTimeWat: pub.evidenceCutoffTimeWat,
        evidenceCutoffDateTimeWat: pub.evidenceCutoffDateTimeWat,
        publishedAt: pub.publishedAt,
        isQuietDay: view.meta.isQuietDay,
        carriedForwardAllStates: Boolean(pub.carriedForwardAllStates),
        pubTitle: view.meta.title,
        label: view.meta.periodLabel,
        short: view.meta.periodLabel,
        cutoff: view.meta.evidenceCutoffLabel,
        method: view.meta.methodologyVersion,
        revisions: view.meta.revisionNote || 'none',
        summary: pub.summary || '',
        changesSummary: pub.changesSummary || '',
        cls: clsMap,
        details: detailsMap,
        canonicalView: view,
        rawPublication: pub
      };
    });
  }, [publishedCanonical]);

  // Initial URL permalink resolution (standalone DCM page only)
  const initialUrlResolution = useMemo(() => {
    if (!isStandaloneUrlMode || typeof window === 'undefined') return null;
    return resolveDcmPermalink(publishedCanonical, window.location.search, {
      allowOnDemandFetchForUnknownId: true
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable publication ID selection (never silently jumps a manually chosen or URL-pinned historical edition to latest)
  const [selectedPubId, setSelectedPubId] = useState<string | null>(() => {
    if (initialUrlResolution?.requiresOnDemandFetchId) {
      return initialUrlResolution.requiresOnDemandFetchId;
    }
    if (initialUrlResolution?.isPermalinkLocked && initialUrlResolution.activePublication) {
      return initialUrlResolution.activePublication.id;
    }
    const latest = publishedCanonical[publishedCanonical.length - 1];
    return latest ? latest.id : null;
  });
  const [hasManualSelection, setHasManualSelection] = useState<boolean>(() =>
    Boolean(initialUrlResolution?.isPermalinkLocked)
  );
  const [permalinkNotice, setPermalinkNotice] = useState<{
    message: string;
    tone: 'warning' | 'info';
  } | null>(() =>
    initialUrlResolution?.notice && initialUrlResolution.noticeTone !== 'none'
      ? { message: initialUrlResolution.notice, tone: initialUrlResolution.noticeTone }
      : null
  );

  const fetchedDeepIdsRef = useRef<Set<string>>(new Set());
  const fetchedStateEvidenceRef = useRef<Set<string>>(new Set());
  const isApplyingPopstateRef = useRef<boolean>(false);
  const hasHydratedUrlAfterLoadRef = useRef<boolean>(false);

  // Selected state on map/dropdown (normalized across all 36 states + FCT when specified in URL)
  const [sel, setSel] = useState<string | null>(() => {
    if (initialUrlResolution?.selectedStateName) {
      return initialUrlResolution.selectedStateName;
    }
    if (typeof window !== 'undefined' && !isStandaloneUrlMode) {
      const params = new URLSearchParams(window.location.search);
      const st = params.get('state');
      if (st) return resolveJurisdictionMeta(st)?.name || null;
    }
    return null;
  });

  // On-demand fetch for deep historical permalinks not in the initial bounded 60-edition window
  useEffect(() => {
    if (!isStandaloneUrlMode || typeof window === 'undefined') return;
    const res = resolveDcmPermalink(publishedCanonical, window.location.search, {
      allowOnDemandFetchForUnknownId: true
    });

    if (res.requiresOnDemandFetchId && !fetchedDeepIdsRef.current.has(res.requiresOnDemandFetchId)) {
      const targetId = res.requiresOnDemandFetchId;
      fetchedDeepIdsRef.current.add(targetId);
      loadDcmPublicationById(targetId).then((loaded) => {
        if (loaded) {
          setHasManualSelection(true);
          setSelectedPubId(loaded.id);
          setPermalinkNotice(null);
        } else {
          // Record does not exist or is unpublished/draft — reject gracefully
          const fallbackRes = resolveDcmPermalink(publishedCanonical, window.location.search, {
            allowOnDemandFetchForUnknownId: false
          });
          setHasManualSelection(false);
          if (fallbackRes.activePublication) {
            setSelectedPubId(fallbackRes.activePublication.id);
          }
          if (fallbackRes.notice && fallbackRes.noticeTone !== 'none') {
            setPermalinkNotice({ message: fallbackRes.notice, tone: fallbackRes.noticeTone });
          }
        }
      });
      return;
    }

    // Re-apply URL once live Firestore data arrives (only if user has not manually navigated away)
    if (!hasHydratedUrlAfterLoadRef.current && res.parsed.hasAnyDcmParam) {
      if (res.isPermalinkLocked && res.activePublication) {
        hasHydratedUrlAfterLoadRef.current = true;
        setHasManualSelection(true);
        setSelectedPubId(res.activePublication.id);
        if (res.selectedStateName) setSel(res.selectedStateName);
        if (res.notice && res.noticeTone !== 'none') {
          setPermalinkNotice({ message: res.notice, tone: res.noticeTone });
        } else {
          setPermalinkNotice(null);
        }
      } else if (res.notice && res.noticeTone !== 'none') {
        setPermalinkNotice({ message: res.notice, tone: res.noticeTone });
      }
    }
  }, [isStandaloneUrlMode, publishedCanonical, loadDcmPublicationById]);

  // Sync default selection to the latest released edition ONLY on homepage (hideAside) or before manual/permalink lock
  useEffect(() => {
    if (publishedCanonical.length === 0) return;
    const latestId = publishedCanonical[publishedCanonical.length - 1].id;
    const selectionStillExists = Boolean(selectedPubId && publishedCanonical.some((p) => p.id === selectedPubId));
    const isPendingOnDemandFetch = Boolean(
      selectedPubId && fetchedDeepIdsRef.current.has(selectedPubId) && !selectionStillExists
    );
    if (hideAside || !hasManualSelection || (!selectionStillExists && !isPendingOnDemandFetch)) {
      if (selectedPubId !== latestId) {
        setSelectedPubId(latestId);
      }
    }
  }, [hideAside, hasManualSelection, publishedCanonical, selectedPubId]);

  // Trigger on-demand state-scoped evidence fetch whenever a state is selected
  useEffect(() => {
    if (!sel) return;
    const meta = resolveJurisdictionMeta(sel);
    if (!meta || fetchedStateEvidenceRef.current.has(meta.code)) return;
    fetchedStateEvidenceRef.current.add(meta.code);
    loadDcmStateEvidence(meta.code).catch(() => {});
  }, [sel, loadDcmStateEvidence]);

  // Synchronise browser address bar without infinite loops or clobbering unrelated query parameters
  const syncBrowserUrl = useCallback(
    (pub: DcmPublication | null | undefined, stateName: string | null) => {
      if (!isStandaloneUrlMode || typeof window === 'undefined' || !pub) return;
      if (isApplyingPopstateRef.current) return;

      const nextUrl = buildDcmPermalinkUrl({
        publication: pub,
        stateName,
        pathname: window.location.pathname,
        existingSearch: window.location.search
      });
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (nextUrl !== currentUrl) {
        window.history.pushState({ dcmPubId: pub.id, dcmState: stateName }, '', nextUrl);
      }
    },
    [isStandaloneUrlMode]
  );

  // Handle browser Back / Forward navigation cleanly
  useEffect(() => {
    if (!isStandaloneUrlMode || typeof window === 'undefined') return;

    const handlePopState = () => {
      isApplyingPopstateRef.current = true;
      const res = resolveDcmPermalink(publishedCanonical, window.location.search, {
        allowOnDemandFetchForUnknownId: false
      });
      if (res.activePublication) {
        setSelectedPubId(res.activePublication.id);
      }
      setHasManualSelection(res.isPermalinkLocked);
      setSel(res.selectedStateName);
      setPermalinkNotice(
        res.notice && res.noticeTone !== 'none'
          ? { message: res.notice, tone: res.noticeTone }
          : null
      );
      setTimeout(() => {
        isApplyingPopstateRef.current = false;
      }, 0);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isStandaloneUrlMode, publishedCanonical]);

  // Hovered state for interactive tooltip card
  const [hoveredState, setHoveredState] = useState<{
    name: string;
    cx: number;
    cy: number;
  } | null>(null);
  // Highlight changes toggle
  const [showChanges, setShowChanges] = useState<boolean>(false);

  // Zoom & Pan states for two-finger mobile zoom and desktop zoom
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isGestureActive, setIsGestureActive] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [showTwoFingerHint, setShowTwoFingerHint] = useState<boolean>(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const stateInfoRef = useRef<HTMLDivElement | null>(null);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search states for searching states on map and aside panel
  const [stateSearchQuery, setStateSearchQuery] = useState<string>('');
  const [mapSearchOpen, setMapSearchOpen] = useState<boolean>(false);
  const [mapSearchQuery, setMapSearchQuery] = useState<string>('');
  // Toggle for state name labels on the map
  const [showMapLabels, setShowMapLabels] = useState<boolean>(true);
  // Collapsible explanatory sections on mobile (desktop lg+ always displays expanded)
  const [openExplanatoryMobile, setOpenExplanatoryMobile] = useState<Record<string, boolean>>({});
  const toggleExplanatoryMobile = useCallback((sectionKey: string) => {
    setOpenExplanatoryMobile((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }, []);

  // Helper to select a publication by ID and sync shareable URL
  const selectEditionAndSyncUrl = useCallback(
    (pubId: string, nextStateOverride?: string | null, shouldScrollToTop = false) => {
      const targetPub = publishedCanonical.find((p) => p.id === pubId);
      if (!targetPub) return;
      const resolvedState = nextStateOverride !== undefined ? nextStateOverride : sel;
      setHasManualSelection(true);
      setSelectedPubId(targetPub.id);
      if (nextStateOverride !== undefined) {
        setSel(nextStateOverride);
      }
      setPermalinkNotice(null);
      syncBrowserUrl(targetPub, resolvedState);
      if (shouldScrollToTop && typeof window !== 'undefined') {
        const mapEl = document.getElementById('dcm-map-section');
        if (mapEl) {
          mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    },
    [publishedCanonical, sel, syncBrowserUrl]
  );

  // Automatically scroll to the state info section when a state is clicked or selected, and sync shareable URL
  const selectState = useCallback(
    (stateName: string | null, shouldScroll = true) => {
      setHoveredState(null);
      const normalizedState = stateName ? resolveJurisdictionMeta(stateName)?.name || stateName : null;
      setSel(normalizedState);
      setPermalinkNotice(null);

      const currentPub =
        publishedCanonical.find((p) => p.id === selectedPubId) ||
        publishedCanonical[publishedCanonical.length - 1] ||
        null;
      if (currentPub) {
        syncBrowserUrl(currentPub, normalizedState);
      }

      if (normalizedState && shouldScroll) {
        setTimeout(() => {
          if (stateInfoRef.current) {
            const rect = stateInfoRef.current.getBoundingClientRect();
            const windowHeight = window.innerHeight || document.documentElement.clientHeight;
            const isFullyVisible = rect.top >= 20 && rect.bottom <= windowHeight - 20;

            // On mobile / stacked screens, aside is underneath map, so scroll directly to it
            // On desktop, scroll smoothly if not already fully visible
            if (!isFullyVisible || window.innerWidth < 1024) {
              stateInfoRef.current.scrollIntoView({
                behavior: 'smooth',
                block: window.innerWidth < 1024 ? 'start' : 'nearest'
              });
            }
          }
        }, 70);
      }
    },
    [publishedCanonical, selectedPubId, syncBrowserUrl]
  );

  const touchDataRef = useRef<{
    startDist: number;
    startCenter: { x: number; y: number };
    startPan: { x: number; y: number };
    startZoom: number;
    isTwoFinger: boolean;
    singleTouchStart: { x: number; y: number; time: number } | null;
  }>({
    startDist: 0,
    startCenter: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    startZoom: 1,
    isTwoFinger: false,
    singleTouchStart: null
  });

  const mouseDragRef = useRef<{
    isDown: boolean;
    startX: number;
    startY: number;
    startPan: { x: number; y: number };
    hasDragged: boolean;
  }>({
    isDown: false,
    startX: 0,
    startY: 0,
    startPan: { x: 0, y: 0 },
    hasDragged: false
  });

  const clampPan = useCallback((newPan: { x: number; y: number }, currentZoom: number, containerW: number, containerH: number) => {
    if (currentZoom <= 1.02) return { x: 0, y: 0 };
    const maxPanX = (containerW * (currentZoom - 1)) / 2 + 50;
    const maxPanY = (containerH * (currentZoom - 1)) / 2 + 40;
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newPan.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newPan.y))
    };
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => {
      const next = Math.min(4.5, Number((prev * 1.35).toFixed(2)));
      if (mapContainerRef.current) {
        const rect = mapContainerRef.current.getBoundingClientRect();
        setPan((p) => clampPan(p, next, rect.width, rect.height));
      }
      return next;
    });
  }, [clampPan]);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => {
      const next = Math.max(1, Number((prev / 1.35).toFixed(2)));
      if (next <= 1.05) {
        setPan({ x: 0, y: 0 });
        return 1;
      }
      if (mapContainerRef.current) {
        const rect = mapContainerRef.current.getBoundingClientRect();
        setPan((p) => clampPan(p, next, rect.width, rect.height));
      }
      return next;
    });
  }, [clampPan]);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Set up native non-passive touch & wheel listeners for the map container
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // If at zoom 1 and scrolling down without Ctrl/pinch, let page scroll normally
      if (zoom <= 1.01 && e.deltaY > 0 && !e.ctrlKey) {
        return;
      }

      e.preventDefault();
      setIsGestureActive(true);

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const nextZoom = Math.min(4.5, Math.max(1, zoom * zoomFactor));

      if (nextZoom <= 1.02) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else {
        const scaleRatio = nextZoom / zoom;
        const nextPanX = mouseX - (mouseX - pan.x) * scaleRatio;
        const nextPanY = mouseY - (mouseY - pan.y) * scaleRatio;
        setZoom(nextZoom);
        setPan(clampPan({ x: nextPanX, y: nextPanY }, nextZoom, rect.width, rect.height));
      }

      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = setTimeout(() => {
        setIsGestureActive(false);
      }, 120);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Two fingers: Pinch-to-zoom and pan on mobile
        e.preventDefault();
        setIsGestureActive(true);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
        touchDataRef.current = {
          startDist: dist,
          startCenter: center,
          startPan: { ...pan },
          startZoom: zoom,
          isTwoFinger: true,
          singleTouchStart: null
        };
      } else if (e.touches.length === 1) {
        // One finger: do NOT preventDefault, letting page scroll vertically
        touchDataRef.current = {
          startDist: 0,
          startCenter: { x: 0, y: 0 },
          startPan: { ...pan },
          startZoom: zoom,
          isTwoFinger: false,
          singleTouchStart: {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
            time: Date.now()
          }
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && touchDataRef.current.isTwoFinger) {
        // Two fingers active: perform smooth pinch & pan
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };

        const rect = container.getBoundingClientRect();
        const initialDist = touchDataRef.current.startDist || dist;
        const scaleChange = dist / initialDist;
        const nextZoom = Math.min(4.5, Math.max(1, touchDataRef.current.startZoom * scaleChange));

        const dx = center.x - touchDataRef.current.startCenter.x;
        const dy = center.y - touchDataRef.current.startCenter.y;
        const rawPan = {
          x: touchDataRef.current.startPan.x + dx,
          y: touchDataRef.current.startPan.y + dy
        };

        setZoom(nextZoom);
        setPan(clampPan(rawPan, nextZoom, rect.width, rect.height));
      } else if (e.touches.length === 1 && zoom > 1.1) {
        // If user drags with 1 finger while map is zoomed in, show 2-finger gesture guidance
        const st = touchDataRef.current.singleTouchStart;
        if (st) {
          const dx = Math.abs(e.touches[0].clientX - st.x);
          const dy = Math.abs(e.touches[0].clientY - st.y);
          if (dx > 25 && dx > dy) {
            setShowTwoFingerHint(true);
            if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
            hintTimeoutRef.current = setTimeout(() => setShowTwoFingerHint(false), 2000);
          }
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (touchDataRef.current.isTwoFinger && e.touches.length < 2) {
        touchDataRef.current.isTwoFinger = false;
        setIsGestureActive(false);
        if (zoom <= 1.05) {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [zoom, pan, clampPan]);

  // Modal dialog states
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [formDone, setFormDone] = useState<boolean>(false);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fName, setFName] = useState<string>('');
  const [fEmail, setFEmail] = useState<string>('');
  const [fOrg, setFOrg] = useState<string>('');
  const [fSector, setFSector] = useState<string>('');
  const [fUse, setFUse] = useState<string>('');
  const [fConsent, setFConsent] = useState<boolean>(false);
  const [fWebsite, setFWebsite] = useState<string>('');

  const selectionResolution = useMemo(() => {
    return resolveSelectedPublication(publishedCanonical, selectedPubId, hideAside || !hasManualSelection);
  }, [publishedCanonical, selectedPubId, hideAside, hasManualSelection]);

  const safePi = Math.max(0, selectionResolution.activeIndex);
  const activePub = allPubs[safePi] || allPubs[allPubs.length - 1];
  const activeView = activePub?.canonicalView || null;
  const curCls = activePub.cls;
  const prevPub = safePi > 0 ? allPubs[safePi - 1] : null;
  const prevCls = prevPub ? prevPub.cls : null;

  const getCatCode = (map: Record<string, string> | null, name: string): string => {
    if (!map) return 'U';
    const code = map[name];
    return code && DCM_CAT[code] ? code : 'U';
  };

  // Available dropdown options (ordered newest-first for Year, chronological for Month, stable ID for Period)
  const years = useMemo(() => {
    const list: number[] = [];
    allPubs.forEach((p) => {
      if (!list.includes(p.year)) list.push(p.year);
    });
    return list;
  }, [allPubs]);

  const monthsInYear = useMemo(() => {
    const list: number[] = [];
    allPubs.forEach((p) => {
      if (p.year === activePub.year && !list.includes(p.month)) {
        list.push(p.month);
      }
    });
    return list;
  }, [allPubs, activePub.year]);

  const periodOpts = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    allPubs.forEach((p) => {
      if (p.year === activePub.year && p.month === activePub.month) {
        const optionLabel = p.publicationFormat === 'daily'
          ? `${p.label} (Daily)`
          : p.label;
        list.push({ value: p.id, label: optionLabel });
      }
    });
    return list;
  }, [allPubs, activePub.year, activePub.month]);

  // Stage 4: Unified full-width publication selector options (daily + legacy, newest first, stable IDs)
  const unifiedPubOptions = useMemo(() => {
    return buildUnifiedPublicationOptions(publishedCanonical);
  }, [publishedCanonical]);

  // Stage 4: Latest published edition metadata & accurate "What changed today?" / "Latest published update" banner
  const latestPublishedCanonical = useMemo(() => {
    return publishedCanonical.length > 0 ? publishedCanonical[publishedCanonical.length - 1] : null;
  }, [publishedCanonical]);

  const dailyUpdateBanner = useMemo(() => {
    return resolveDailyUpdateBanner(selectionResolution.activePublication, latestPublishedCanonical);
  }, [selectionResolution.activePublication, latestPublishedCanonical]);

  const latestPubCutoffSummary = useMemo(() => {
    const latestItem = allPubs.length > 0 ? allPubs[allPubs.length - 1] : null;
    if (!latestItem) return null;
    return {
      periodLabel: latestItem.short,
      cutoffLabel: latestItem.cutoff,
      isDaily: latestItem.publicationFormat === 'daily'
    };
  }, [allPubs]);

  // State options sorted alphabetically
  const stateOpts = useMemo(() => {
    return DCM_GEO.states.map((s) => s.name).sort((a, b) => (a < b ? -1 : 1));
  }, []);

  // Search filtering for aside search bar and map search bar
  const filteredStateOptions = useMemo(() => {
    if (!stateSearchQuery.trim()) return stateOpts;
    const q = stateSearchQuery.trim().toLowerCase();
    return stateOpts.filter((name) => name.toLowerCase().includes(q));
  }, [stateOpts, stateSearchQuery]);

  const mapFilteredStates = useMemo(() => {
    if (!mapSearchQuery.trim()) return stateOpts;
    const q = mapSearchQuery.trim().toLowerCase();
    return stateOpts.filter((name) => name.toLowerCase().includes(q));
  }, [stateOpts, mapSearchQuery]);

  // Selected state info (strictly sourced from activePub's canonical view)
  const selDetails = useMemo(() => {
    return sel ? getStateDetails(activePub, prevPub, sel) : null;
  }, [activePub, prevPub, sel]);
  const selCatObj = selDetails
    ? { name: selDetails.classification, hex: selDetails.hex }
    : DCM_CAT.U;

  // Stage 5: Historical correction lineage and permalink helpers for active edition
  const activeCorrectionChain = useMemo(() => {
    return resolvePublicationCorrectionChain(publishedCanonical, selectionResolution.activePublication);
  }, [publishedCanonical, selectionResolution.activePublication]);

  const activeStatePermalink = useMemo(() => {
    if (!selectionResolution.activePublication || !sel) return '';
    return buildDcmPermalinkUrl({
      publication: selectionResolution.activePublication,
      stateName: sel
    });
  }, [selectionResolution.activePublication, sel]);

  const activeAbsoluteStatePermalink = useMemo(() => {
    if (!selectionResolution.activePublication || !sel) return '';
    return buildAbsoluteDcmPermalink({
      publication: selectionResolution.activePublication,
      stateName: sel
    });
  }, [selectionResolution.activePublication, sel]);

  const buildHistoricalPermalinkForSelectedState = useCallback(
    (pubId: string) => {
      const found = publishedCanonical.find((p) => p.id === pubId);
      if (!found) return '/democratic-competitiveness-map';
      return buildDcmPermalinkUrl({
        publication: found,
        stateName: sel
      });
    },
    [publishedCanonical, sel]
  );

  // Stage 3: Full State Assessment Panel data (Sections A-E) resolved from canonical selected publication
  const selectedStatePanelData = useMemo(() => {
    if (!sel || !selectionResolution.activePublication) return null;
    return resolveStateAssessmentPanelData({
      selectedPub: selectionResolution.activePublication,
      previousPub: selectionResolution.previousPublication,
      allPublishedSortedAsc: publishedCanonical,
      stateKey: sel,
      evidenceRecords: dcmEvidence,
      incidentRecords: dcmIncidents,
      developmentRecords: dcmIncidentDevelopments
    });
  }, [
    sel,
    selectionResolution.activePublication,
    selectionResolution.previousPublication,
    publishedCanonical,
    dcmEvidence,
    dcmIncidents,
    dcmIncidentDevelopments
  ]);

  // Trend grid for selected state (12 months x 2 halves; respects stable pubId)
  const monthTrends = useMemo(() => {
    return DCM_MONTHS.map((mName, m) => {
      const halves = [0, 1].map((h) => {
        let foundPub: DcmPubItem | null = null;
        allPubs.forEach((p) => {
          if (p.year === activePub.year && p.month === m && p.half === h) {
            // Prefer the currently selected publication if multiple editions fall in the same half-month
            if (p.id === activePub.id || !foundPub || foundPub.id !== activePub.id) {
              foundPub = p;
            }
          }
        });
        const part = h === 0 ? '1st to 15th' : '16th to month-end';
        if (!foundPub || !sel) {
          return {
            hex: '#f1f2f4',
            disabled: true,
            aria: `${mName} ${activePub.year}, ${part}: no publication`,
            isActive: false,
            pubId: ''
          };
        }
        const matched = foundPub as DcmPubItem;
        const cCode = getCatCode(matched.cls, sel);
        const catMeta = DCM_CAT[cCode] || DCM_CAT.U;
        const isActive = matched.id === activePub.id;
        return {
          hex: catMeta.hex,
          disabled: false,
          aria: `${mName} ${activePub.year}, ${part} (${matched.short}): ${catMeta.name}${isActive ? ' (map shown)' : ''}`,
          isActive,
          pubId: matched.id
        };
      });
      return {
        name: mName,
        abbr: mName.slice(0, 3),
        halves
      };
    });
  }, [allPubs, activePub.year, activePub.id, sel]);

  // Validation for form submission
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const isEmailValid = emailRegex.test(fEmail.trim());
  const canSubmit = Boolean(fName.trim().length >= 2 && isEmailValid && fSector && fConsent);

  const handleSubmitBrief = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || formSubmitting) return;

    setFormSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch('/api/dcm-brief-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fName.trim(),
          email: fEmail.trim(),
          organisation: fOrg.trim(),
          sector: fSector,
          intendedUse: fUse.trim(),
          consent: fConsent,
          publicationTitle: activePub.pubTitle || 'Democratic Competitiveness Map',
          reportingPeriod: activePub.short || activePub.label,
          selectedState: sel || 'All States',
          submittedAt: new Date().toISOString(),
          website: fWebsite
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setFormError(
          data?.error || 'Unable to submit your DCM Brief request right now. Please try again later.'
        );
        return;
      }

      setFormDone(true);
    } catch {
      setFormError('Network error while sending your request. Your entries have been preserved — please try again.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    if (formSubmitting) return;
    const wasDone = formDone;
    setFormOpen(false);
    setFormDone(false);
    setFormError(null);
    if (wasDone) {
      setFName('');
      setFEmail('');
      setFOrg('');
      setFSector('');
      setFUse('');
      setFConsent(false);
      setFWebsite('');
    }
  };

  // Change selector handlers (using stable publication IDs and synchronising shareable URL)
  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const y = Number(e.target.value);
    for (let i = allPubs.length - 1; i >= 0; i--) {
      if (allPubs[i].year === y) {
        selectEditionAndSyncUrl(allPubs[i].id);
        return;
      }
    }
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const m = Number(e.target.value);
    for (let i = allPubs.length - 1; i >= 0; i--) {
      if (allPubs[i].year === activePub.year && allPubs[i].month === m) {
        selectEditionAndSyncUrl(allPubs[i].id);
        return;
      }
    }
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    selectEditionAndSyncUrl(e.target.value);
  };

  const handleStateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    selectState(val ? val : null, true);
  };

  // Sort states so selected, highlighted, or hovered state renders on top
  const renderedShapes = useMemo(() => {
    return DCM_GEO.states.map((s) => {
      const c = getCatCode(curCls, s.name);
      const catMeta = DCM_CAT[c] || DCM_CAT.U;
      const isChanged = Boolean(prevCls && getCatCode(prevCls, s.name) !== c);
      const isSel = s.name === sel;
      const isHovered = !sel && hoveredState?.name === s.name;
      const isHi = isChanged && showChanges;

      let rank = 0;
      if (isHi) rank = 1;
      if (isSel) rank = 2;
      if (isHovered) rank = 3;

      const isBoldWhite = isSel || isHovered || isHi;

      return {
        ...s,
        cCode: c,
        fill: catMeta.hex,
        opacity: (!sel || isSel) ? 1 : (isHovered ? 1 : 0.35),
        stroke: isBoldWhite ? '#ffffff' : '#1c232b',
        strokeWidth: isBoldWhite ? 3.8 : 0.95,
        isBoldWhite,
        rank,
        title: `${s.name}: ${catMeta.name}`
      };
    }).sort((a, b) => a.rank - b.rank);
  }, [curCls, prevCls, sel, showChanges, hoveredState]);

  return (
    <div
      className={`overflow-x-hidden ${isEmbedded ? 'bg-transparent min-h-0' : 'bg-[#f3f4f6] min-h-screen'}`}
      style={{
        fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: '#1c232b'
      }}
    >
      {/* Main Container (Mobile-first padding, zero horizontal overflow down to 320px, full 1320px desktop presence) */}
      <div
        className={`mx-auto box-border flex flex-col gap-4 sm:gap-6 min-w-0 ${
          isEmbedded ? 'max-w-full pb-4' : 'max-w-[1320px] px-3 sm:px-6 pt-5 sm:pt-8 pb-10 sm:pb-14'
        }`}
      >
        {/* 1, 2, 3. Header Block: Title, Short Purpose Statement, Latest Published Review Date & WAT Cut-off */}
        {!isEmbedded ? (
          <header className="flex flex-col gap-2 min-w-0">
            <h1 className="m-0 text-2xl sm:text-[32px] lg:text-[34px] leading-[1.15] font-bold tracking-tight text-[#1c232b] text-balance">
              Democratic Competitiveness Map
            </h1>
            <p className="m-0 text-sm sm:text-base lg:text-[17px] leading-relaxed text-[#3d4752] max-w-[760px]">
              Evidence-based classifications of the practical conditions for political competition across Nigeria’s 36 states and the FCT.
            </p>
            {latestPubCutoffSummary && (
              <div
                aria-label="Latest published evidence review date and cut-off"
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-[13px] text-[#3d4752] pt-0.5 min-w-0"
              >
                <span>
                  <strong className="text-[#1c232b] font-semibold">Latest published review:</strong>{' '}
                  <span className="tabular-nums">{latestPubCutoffSummary.periodLabel}</span>
                </span>
                {latestPubCutoffSummary.cutoffLabel && (
                  <>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span>
                      <strong className="text-[#1c232b] font-semibold">Evidence cut-off:</strong>{' '}
                      <span className="tabular-nums">{latestPubCutoffSummary.cutoffLabel}</span>
                    </span>
                  </>
                )}
              </div>
            )}
            {/* Stage 5: Transparent notice when a direct URL requests an invalid/unpublished edition, unknown state, or missing date */}
            {permalinkNotice && (
              <div
                role="alert"
                className={`mt-1 rounded-md border px-3.5 py-2.5 text-xs sm:text-sm flex items-start justify-between gap-3 min-w-0 ${
                  permalinkNotice.tone === 'warning'
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-blue-50 border-blue-200 text-slate-900'
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-800" aria-hidden="true" />
                  <span className="break-words leading-relaxed">{permalinkNotice.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPermalinkNotice(null)}
                  aria-label="Dismiss notice"
                  className="shrink-0 bg-transparent border-0 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer px-1"
                >
                  ✕
                </button>
              </div>
            )}
            {/* Stage 7: Accurate error & retry notice if a bounded Firestore chronological index or query fails (never silently incomplete) */}
            {dcmArchiveError && (
              <div
                role="alert"
                className="mt-1 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-xs sm:text-sm text-red-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
                  <span className="break-words leading-relaxed">
                    {dcmArchiveError.message}
                  </span>
                </div>
                {dcmArchiveError.canRetry && (
                  <button
                    type="button"
                    onClick={retryDcmArchiveQueries}
                    className="shrink-0 min-h-[44px] px-3.5 py-2 rounded-md bg-white border border-red-300 text-xs font-semibold text-red-900 hover:bg-red-100 cursor-pointer"
                  >
                    Retry loading archive
                  </button>
                )}
              </div>
            )}
          </header>
        ) : (
          <div className="flex items-start justify-between flex-wrap gap-4 pb-1 min-w-0">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-[11px] font-mono font-bold tracking-wider text-[#1f5fa8] uppercase">
                Interactive Map Visualization
              </span>
              <h2 className="m-0 text-2xl sm:text-[28px] font-bold text-[#1c232b] tracking-tight leading-tight">
                Democratic Competitiveness Map (DCM)
              </h2>
              <p className="mt-1 mb-0 text-sm sm:text-[15px] text-slate-600 max-w-[840px] leading-relaxed">
                Nigeria’s political competition environment remains uneven, with concerns concentrated around political mobilisation, campaign access and institutional neutrality as the 2027 elections approach.
              </p>
            </div>
            <div>
              <a
                href="/democratic-competitiveness-map"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState({}, '', '/democratic-competitiveness-map');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  window.scrollTo(0, 0);
                }}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 bg-[#1f5fa8] hover:bg-[#174880] text-white rounded-lg text-[13px] font-bold no-underline shadow-xs transition-colors whitespace-nowrap"
              >
                <span>View Full DCM Page</span>
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        )}

        {/* Main Responsive Grid: Single column on mobile/tablet (<1024px) with Map first, Two columns on desktop (1024px+) */}
        <div
          className={`grid grid-cols-1 gap-4 sm:gap-6 items-start min-w-0 ${
            hideAside ? '' : 'lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_420px]'
          }`}
        >
          {/* PRIMARY / LEFT COLUMN: Interactive Map + Instruction + What Changed Today / Latest Update */}
          <div className="flex flex-col gap-4 sm:gap-6 min-w-0">
            {/* 4. Interactive Nigeria DCM Map Card */}
            <section
              id="dcm-map-section"
              aria-label="Map"
              className="bg-white border border-[#d5d9de] rounded-md p-3.5 sm:p-5 flex flex-col gap-3 sm:gap-3.5 min-w-0"
            >
              <div className="flex justify-between items-start sm:items-center flex-wrap gap-2 min-w-0">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <h2 className="m-0 text-lg sm:text-xl font-bold text-[#1c232b] leading-snug break-words">
                    Map as published for {activePub.short}
                  </h2>
                  {activePub.cutoff && (
                    <span className="text-xs text-slate-600 tabular-nums break-words">
                      Evidence cut-off: {activePub.cutoff}
                    </span>
                  )}
                </div>
                {sel && (
                  <button
                    type="button"
                    onClick={() => selectState(null, false)}
                    className="min-h-[40px] px-3 py-1.5 text-[13px] font-semibold border border-[#8a939c] rounded bg-white hover:bg-slate-50 text-[#1f5fa8] cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                  >
                    Reset / All states
                  </button>
                )}
              </div>

              {/* Compact Classification Legend (Clean responsive grid on 320px+, flex wrap on wider screens) */}
              <div className="space-y-2 min-w-0">
                <div
                  aria-label="Classification colour legend"
                  className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-2 items-center"
                >
                  {DCM_ORDER.map((k) => {
                    const item = DCM_CAT[k];
                    return (
                      <span key={k} className="flex items-center gap-2 text-xs sm:text-sm text-[#1c232b] min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-4 h-4 sm:w-[18px] sm:h-[18px] rounded-[3px] border border-[#8a939c] shrink-0 inline-block"
                          style={{ background: item.hex }}
                        />
                        <span className="break-words leading-tight">{item.name}</span>
                      </span>
                    );
                  })}
                  {activeView && activeView.unavailableCount > 0 && (
                    <span className="flex items-center gap-2 text-xs sm:text-sm text-slate-600 min-w-0">
                      <span
                        aria-hidden="true"
                        className="w-4 h-4 sm:w-[18px] sm:h-[18px] rounded-[3px] border border-dashed border-slate-400 shrink-0 inline-block"
                        style={{ background: DCM_CAT.U.hex }}
                      />
                      <span className="break-words leading-tight">{DCM_CAT.U.name}</span>
                    </span>
                  )}
                </div>

                <p className="m-0 text-xs sm:text-sm text-[#3d4752] leading-snug">
                  {INSUFFICIENT_EVIDENCE_DISCLAIMER}
                </p>
              </div>

              {/* Interactive SVG Nigeria Map with Two-Finger Mobile Zoom and Desktop Zoom */}
              <div
                ref={mapContainerRef}
                style={{
                  position: 'relative',
                  width: '100%',
                  overflow: 'hidden',
                  borderRadius: '6px',
                  background: '#eceef1',
                  touchAction: 'pan-y',
                  userSelect: 'none'
                }}
              onMouseDown={(e) => {
                if (zoom > 1) {
                  mouseDragRef.current = {
                    isDown: true,
                    startX: e.clientX,
                    startY: e.clientY,
                    startPan: { ...pan },
                    hasDragged: false
                  };
                  setIsPanning(true);
                  setIsGestureActive(true);
                }
              }}
              onMouseMove={(e) => {
                if (mouseDragRef.current.isDown && zoom > 1) {
                  const dx = e.clientX - mouseDragRef.current.startX;
                  const dy = e.clientY - mouseDragRef.current.startY;
                  if (Math.hypot(dx, dy) > 5) {
                    mouseDragRef.current.hasDragged = true;
                  }
                  const container = mapContainerRef.current;
                  if (container) {
                    const rect = container.getBoundingClientRect();
                    const rawPan = {
                      x: mouseDragRef.current.startPan.x + dx,
                      y: mouseDragRef.current.startPan.y + dy
                    };
                    setPan(clampPan(rawPan, zoom, rect.width, rect.height));
                  }
                }
              }}
              onMouseUp={() => {
                if (mouseDragRef.current.isDown) {
                  mouseDragRef.current.isDown = false;
                  setIsPanning(false);
                  setIsGestureActive(false);
                }
              }}
              onMouseLeave={() => {
                if (mouseDragRef.current.isDown) {
                  mouseDragRef.current.isDown = false;
                  setIsPanning(false);
                  setIsGestureActive(false);
                }
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                const container = mapContainerRef.current;
                if (!container) return;
                if (zoom > 1.8) {
                  handleResetZoom();
                } else {
                  const rect = container.getBoundingClientRect();
                  const mouseX = e.clientX - rect.left - rect.width / 2;
                  const mouseY = e.clientY - rect.top - rect.height / 2;
                  const nextZoom = 2.2;
                  const ratio = nextZoom / zoom;
                  const nextPanX = mouseX - (mouseX - pan.x) * ratio;
                  const nextPanY = mouseY - (mouseY - pan.y) * ratio;
                  setZoom(nextZoom);
                  setPan(clampPan({ x: nextPanX, y: nextPanY }, nextZoom, rect.width, rect.height));
                }
              }}
            >
              {/* Floating Zoom & Reset Toolbar */}
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  zIndex: 40,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  background: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(4px)',
                  border: '1px solid #d5d9de',
                  borderRadius: '6px',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
                  padding: '4px'
                }}
              >
                <button
                  type="button"
                  onClick={handleZoomIn}
                  title="Zoom in (or two-finger pinch on mobile, mouse wheel on desktop)"
                  aria-label="Zoom in"
                  className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border-0 bg-transparent text-[19px] font-bold text-[#1c232b] rounded hover:bg-[#f3f4f6] transition-colors"
                  style={{
                    cursor: zoom >= 4.5 ? 'not-allowed' : 'pointer',
                    opacity: zoom >= 4.5 ? 0.35 : 1
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  title="Zoom out"
                  aria-label="Zoom out"
                  className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border-0 bg-transparent text-[20px] font-bold text-[#1c232b] rounded hover:bg-[#f3f4f6] transition-colors"
                  style={{
                    cursor: zoom <= 1 ? 'not-allowed' : 'pointer',
                    opacity: zoom <= 1 ? 0.35 : 1
                  }}
                >
                  –
                </button>
                {zoom > 1 && (
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    title="Reset map zoom"
                    aria-label="Reset map zoom"
                    className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border-0 bg-[#eff6ff] hover:bg-[#dbeafe] text-[13px] font-bold text-[#1f5fa8] rounded cursor-pointer transition-colors"
                  >
                    ↺
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMapLabels((prev) => !prev)}
                  title={showMapLabels ? 'Hide state names on map' : 'Show state names on map'}
                  aria-label={showMapLabels ? 'Hide state names on map' : 'Show state names on map'}
                  className={`w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border-0 text-[11px] font-extrabold rounded cursor-pointer transition-colors ${
                    showMapLabels
                      ? 'bg-[#eff6ff] text-[#1d4ed8]'
                      : 'bg-transparent text-[#64748b] hover:bg-[#f3f4f6]'
                  }`}
                >
                  Aa
                </button>
              </div>

              {/* Floating Map Search Button / Popover */}
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  zIndex: 45
                }}
              >
                {!mapSearchOpen ? (
                  <button
                    type="button"
                    onClick={() => setMapSearchOpen(true)}
                    title="Search states on map"
                    aria-label="Search states on map"
                    className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center bg-white/95 hover:bg-[#f3f4f6] backdrop-blur-sm border border-[#d5d9de] rounded-md shadow-sm cursor-pointer text-[#1c232b] transition-colors"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </button>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      background: '#ffffff',
                      border: '1px solid #d5d9de',
                      borderRadius: '6px',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
                      width: 'min(240px, calc(100vw - 96px))',
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 10px', gap: '6px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        autoFocus
                        type="text"
                        value={mapSearchQuery}
                        onChange={(e) => setMapSearchQuery(e.target.value)}
                        placeholder="Search state..."
                        aria-label="Search state on map"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          border: 'none',
                          outline: 'none',
                          fontSize: '14px',
                          color: '#1c232b',
                          background: 'transparent'
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Close map search"
                        onClick={() => {
                          setMapSearchOpen(false);
                          setMapSearchQuery('');
                        }}
                        className="min-w-[28px] min-h-[28px] flex items-center justify-center bg-transparent border-0 cursor-pointer text-[#64748b] text-[13px]"
                      >
                        ✕
                      </button>
                    </div>
                    {mapSearchQuery.trim() && (
                      <div style={{ maxHeight: '180px', overflowY: 'auto', borderTop: '1px solid #f1f5f9' }}>
                        {mapFilteredStates.length > 0 ? (
                          mapFilteredStates.map((st) => {
                            const c = getCatCode(curCls, st);
                            const catMeta = DCM_CAT[c] || DCM_CAT.U;
                            return (
                              <button
                                key={st}
                                type="button"
                                onClick={() => {
                                  selectState(st, true);
                                  setMapSearchOpen(false);
                                  setMapSearchQuery('');
                                }}
                                style={{
                                  width: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '6px',
                                  padding: '10px 12px',
                                  border: 'none',
                                  borderBottom: '1px solid #f8fafc',
                                  background: sel === st ? '#eff6ff' : 'transparent',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  fontSize: '13px'
                                }}
                              >
                                <span style={{ fontWeight: 600, color: '#1c232b' }} className="truncate">{st}</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#64748b' }} className="shrink-0">
                                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: catMeta.hex }} />
                                  {catMeta.name}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ padding: '8px 12px', fontSize: '12px', color: '#64748b' }}>
                            No match
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Active Zoom Badge */}
              {zoom > 1 && (
                <div
                  className={mapSearchOpen ? 'hidden sm:block' : ''}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    left: mapSearchOpen ? '262px' : '60px',
                    zIndex: 40,
                    background: 'rgba(255, 255, 255, 0.92)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid #d5d9de',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#475569',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                    pointerEvents: 'none',
                    transition: 'left 0.2s ease'
                  }}
                >
                  {Math.round(zoom * 100)}%
                </div>
              )}

              {/* Mobile Two-Finger Guidance Toast */}
              {showTwoFingerHint && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '16px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 50,
                    background: 'rgba(15, 23, 42, 0.92)',
                    color: '#ffffff',
                    padding: '8px 16px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <span>✌️ Use two fingers to pan map</span>
                </div>
              )}

              {/* Transformed Map Layer */}
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: '50% 50%',
                  transition: isGestureActive ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)',
                  cursor: zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : 'default'
                }}
              >
                <svg
                  viewBox="0 0 760 617"
                  role="img"
                  aria-label="Map of Nigeria showing the classification of each state and the FCT for the selected publication"
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                >
                  {/* State Paths */}
                  {renderedShapes.map((s) => {
                    return (
                      <path
                        key={s.name}
                        d={s.d}
                        onClick={() => {
                          if (mouseDragRef.current.hasDragged) {
                            mouseDragRef.current.hasDragged = false;
                            return;
                          }
                          const next = s.name === sel ? null : s.name;
                          selectState(next, true);
                        }}
                        onMouseEnter={() => {
                          if (!sel && !mouseDragRef.current.isDown) {
                            setHoveredState({ name: s.name, cx: s.cx, cy: s.cy });
                          }
                        }}
                        onMouseLeave={() => setHoveredState(null)}
                        style={{
                          fill: s.fill,
                          fillOpacity: s.opacity,
                          stroke: s.stroke,
                          strokeWidth: `${s.strokeWidth}px`,
                          strokeLinejoin: 'round',
                          cursor: 'pointer',
                          filter: s.isBoldWhite ? 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45))' : undefined,
                          transition: 'fill 0.2s ease, fill-opacity 0.2s ease, stroke-width 0.15s ease'
                        }}
                      >
                        <title>{s.title}</title>
                      </path>
                    );
                  })}

                  {/* State Text Labels - Bold and does not increase when zoomed into */}
                  {showMapLabels && DCM_GEO.states.map((s) => {
                    const c = getCatCode(curCls, s.name);
                    const isSmall = Boolean(DCM_SMALL[s.name]);
                    const baseFontSize = isSmall ? 7.5 : 9.5;
                    const fontFill = c === 'R' ? '#ffffff' : '#1c232b';
                    const isSelected = s.name === sel;
                    const labelOpacity = (!sel || isSelected) ? 1 : 0.45;

                    return (
                      <text
                        key={`label-${s.name}`}
                        x={s.cx}
                        y={s.cy}
                        transform={zoom !== 1 ? `translate(${s.cx}, ${s.cy}) scale(${1 / zoom}) translate(${-s.cx}, ${-s.cy})` : undefined}
                        style={{
                          fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                          fontWeight: isSelected ? 800 : 700,
                          fontSize: `${baseFontSize}px`,
                          letterSpacing: '0.025em',
                          fill: fontFill,
                          opacity: labelOpacity,
                          textAnchor: 'middle',
                          dominantBaseline: 'central',
                          pointerEvents: 'none',
                          userSelect: 'none'
                        }}
                      >
                        {s.name.toUpperCase()}
                      </text>
                    );
                  })}
                </svg>
              </div>

              {/* Flourish-style Floating Hover / Pinned Card (positioned relative to zoomed state coordinates) */}
              {(() => {
                const selectedStateGeo = hideAside && sel
                  ? DCM_GEO.states.find((s) => s.name === sel) || null
                  : null;
                const isPinned = Boolean(selectedStateGeo);
                const activeTooltipState = selectedStateGeo
                  ? { name: selectedStateGeo.name, cx: selectedStateGeo.cx, cy: selectedStateGeo.cy }
                  : (!sel ? hoveredState : null);

                if (!activeTooltipState) return null;

                const details = getStateDetails(activePub, prevPub, activeTooltipState.name);
                const cutoffText = activePub.cutoff || 'Not recorded';

                const containerW = mapContainerRef.current?.clientWidth || 760;
                const containerH = mapContainerRef.current?.clientHeight || 617;
                const u = activeTooltipState.cx / 760;
                const v = activeTooltipState.cy / 617;
                const visualX = containerW / 2 + (u * containerW - containerW / 2) * zoom + pan.x;
                const visualY = containerH / 2 + (v * containerH - containerH / 2) * zoom + pan.y;

                const cardW = Math.min(296, Math.max(220, containerW - 16));
                const isRightSide = visualX > containerW * 0.52;
                const rawLeft = isRightSide ? visualX - cardW - 12 : visualX + 12;
                const tooltipLeft = Math.max(8, Math.min(containerW - cardW - 8, rawLeft));
                const tooltipTop = Math.max(8, Math.min(Math.max(8, containerH - 220), visualY - 50));

                return (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${tooltipLeft}px`,
                      top: `${tooltipTop}px`,
                      pointerEvents: isPinned ? 'auto' : 'none',
                      background: '#ffffff',
                      color: '#1c232b',
                      padding: '16px 18px',
                      borderRadius: '6px',
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.16), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
                      border: '1px solid #d5d9de',
                      width: `${cardW}px`,
                      maxWidth: 'calc(100% - 16px)',
                      zIndex: 60,
                      fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
                      <div style={{ fontSize: '20px', fontWeight: 800, color: '#1c232b', letterSpacing: '-0.01em' }}>
                        {activeTooltipState.name}
                      </div>
                      {isPinned && (
                        <button
                          type="button"
                          onClick={() => selectState(null, false)}
                          aria-label={`Close ${activeTooltipState.name} details`}
                          title="Close"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#64748b',
                            fontSize: '15px',
                            lineHeight: 1,
                            padding: '2px 4px',
                            borderRadius: '4px'
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', lineHeight: 1.45 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#1e293b' }}>DCM Classification: </strong>
                        <span
                          aria-hidden="true"
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '2px',
                            background: details.hex,
                            border: '1px solid #8a939c',
                            display: 'inline-block'
                          }}
                        />
                        <span style={{ color: '#334155' }}>{details.classification}</span>
                      </div>

                      <div>
                        <strong style={{ color: '#1e293b' }}>Direction: </strong>
                        <span style={{ color: '#334155' }}>{details.direction}</span>
                      </div>

                      <div>
                        <strong style={{ color: '#1e293b' }}>Confidence: </strong>
                        <span style={{ color: '#334155' }}>{details.confidence}</span>
                      </div>

                      <div>
                        <strong style={{ color: '#1e293b' }}>Key Finding: </strong>
                        <span style={{ color: details.hasApprovedFinding ? '#334155' : '#64748b', fontStyle: details.hasApprovedFinding ? 'normal' : 'italic' }}>
                          {details.keyFinding}
                        </span>
                      </div>

                      {details.carriedForward && (
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          <strong style={{ color: '#1e293b' }}>Assessment Status: </strong>
                          <span>Carried forward from prior approved assessment</span>
                        </div>
                      )}

                      {details.lastSubstantiveReviewDate && (
                        <div style={{ fontSize: '12px', color: '#475569' }}>
                          <strong style={{ color: '#1e293b' }}>Last Substantive Review: </strong>
                          <span>{formatDailyDateLabel(details.lastSubstantiveReviewDate)}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                      <div>AEO Democratic Competitiveness Map (DCM)</div>
                      <div>{activePub.publicationFormat === 'daily' ? `Evidence cut-off: ${cutoffText}` : `Updated: ${cutoffText}`}</div>
                    </div>
                  </div>
                );
              })()}
            </div>

              {/* 5. Map Selection Instruction & Visible Selected-State Feedback Bar */}
              <div className="flex flex-col gap-2.5 pt-1 min-w-0">
                <p className="m-0 text-sm font-medium text-[#1c232b] leading-snug">
                  {MAP_SELECTION_INSTRUCTION}
                </p>

                {sel && !hideAside && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-slate-50 border border-slate-200 rounded-md p-3 min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className="w-4 h-4 rounded-[3px] border border-[#8a939c] shrink-0 inline-block"
                        style={{ backgroundColor: selCatObj.hex }}
                      />
                      <div className="text-xs sm:text-sm min-w-0 break-words">
                        <strong className="text-[#1c232b]">{sel}</strong>
                        <span aria-hidden="true" className="text-slate-400"> · </span>
                        <span className="text-[#3d4752] font-medium">{selCatObj.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          stateInfoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="flex-1 sm:flex-none min-h-[44px] sm:min-h-[36px] px-3 py-2 sm:py-1.5 rounded bg-[#1f5fa8] hover:bg-[#174880] text-white text-xs font-semibold cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                      >
                        Inspect evidence ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => selectState(null, false)}
                        className="min-h-[44px] sm:min-h-[36px] px-3 py-2 sm:py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 6. "What changed today?" / "Latest published update" Section Immediately Below the Map */}
            {!isEmbedded && (
              <section
                id="dcm-daily-update"
                aria-label={dailyUpdateBanner.heading}
                className="bg-white border border-[#d5d9de] rounded-md p-4 sm:p-5 flex flex-col gap-2.5 min-w-0"
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <h2 className="m-0 text-lg font-bold text-[#1c232b] leading-snug break-words">
                    {dailyUpdateBanner.heading}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#3d4752] tabular-nums">
                    <span className="font-semibold text-[#1c232b]">{dailyUpdateBanner.dateLabel}</span>
                    {dailyUpdateBanner.evidenceCutoffLabel && (
                      <>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span>Evidence cut-off: {dailyUpdateBanner.evidenceCutoffLabel}</span>
                      </>
                    )}
                    {dailyUpdateBanner.isQuietDay && (
                      <>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span>Quiet-day update</span>
                      </>
                    )}
                  </div>
                </div>

                {dailyUpdateBanner.hasApprovedSummary ? (
                  <div className="space-y-2.5">
                    {dailyUpdateBanner.summaryParagraphs.map((paragraph, idx) => (
                      <p
                        key={idx}
                        className="m-0 text-sm sm:text-[15px] leading-relaxed text-[#3d4752] break-words"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-sm italic text-slate-600 leading-relaxed">
                    {dailyUpdateBanner.unavailableMessage}
                  </p>
                )}

                {dailyUpdateBanner.completeRecordUrl && (
                  <div className="pt-1">
                    <a
                      href={dailyUpdateBanner.completeRecordUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-semibold text-[#1f5fa8] hover:underline break-words"
                    >
                      <span>View complete published record</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </a>
                  </div>
                )}

                {/* Stage 5: Edition-level Historical Correction Notice (visible even before selecting a state) */}
                {(activeCorrectionChain.hasSubsequentCorrection || activeCorrectionChain.isCorrectedVersion) && (
                  <div
                    role="note"
                    aria-label="Edition editorial correction notice"
                    className="mt-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-1.5 min-w-0"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <GitBranch className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {activeCorrectionChain.hasSubsequentCorrection && activeCorrectionChain.latestCorrection ? (
                          <>
                            <p className="m-0 font-semibold break-words">
                              Preserved original edition — A later editorial correction (r
                              {activeCorrectionChain.latestCorrection.revisionNumber || 2}) was published
                              {activeCorrectionChain.correctionDateLabel
                                ? ` on ${activeCorrectionChain.correctionDateLabel}`
                                : ''}
                              . {activeCorrectionChain.editorialClarityNote}
                            </p>
                            <a
                              href={buildHistoricalPermalinkForSelectedState(activeCorrectionChain.latestCorrection.id)}
                              onClick={(e) => {
                                e.preventDefault();
                                selectEditionAndSyncUrl(activeCorrectionChain.latestCorrection!.id);
                              }}
                              className="inline-flex items-center gap-1 font-semibold text-amber-950 underline hover:text-amber-800"
                            >
                              Open corrected revision (r{activeCorrectionChain.latestCorrection.revisionNumber || 2}) →
                            </a>
                          </>
                        ) : (
                          <>
                            <p className="m-0 font-semibold break-words">
                              Corrected edition (Revision r{activeCorrectionChain.revisionNumber}).{' '}
                              {activeCorrectionChain.revisionNote ? `${activeCorrectionChain.revisionNote} ` : ''}
                              {activeCorrectionChain.editorialClarityNote}
                            </p>
                            {activeCorrectionChain.originalEdition && (
                              <a
                                href={buildHistoricalPermalinkForSelectedState(activeCorrectionChain.originalEdition.id)}
                                onClick={(e) => {
                                  e.preventDefault();
                                  selectEditionAndSyncUrl(activeCorrectionChain.originalEdition!.id);
                                }}
                                className="inline-flex items-center gap-1 font-semibold text-amber-950 underline hover:text-amber-800"
                              >
                                View preserved original edition →
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* 7. Mobile Quick-Jump Navigation Strip (Access to Date Selection, Evidence, Archive, Legend & Methodology) */}
            {!isEmbedded && !hideAside && (
              <nav
                aria-label="Jump to DCM page sections"
                className="lg:hidden grid grid-cols-2 sm:grid-cols-5 gap-2"
              >
                <a
                  href="#dcm-date-selector"
                  className="min-h-[44px] flex items-center justify-center px-3 py-2 bg-white border border-[#d5d9de] rounded-md text-xs font-semibold text-[#1c232b] no-underline hover:bg-slate-50 text-center"
                >
                  Change date
                </a>
                <a
                  href="#dcm-state-info"
                  className="min-h-[44px] flex items-center justify-center px-3 py-2 bg-white border border-[#d5d9de] rounded-md text-xs font-semibold text-[#1c232b] no-underline hover:bg-slate-50 text-center"
                >
                  State evidence
                </a>
                <a
                  href="#dcm-archive-section"
                  className="min-h-[44px] flex items-center justify-center px-3 py-2 bg-white border border-[#d5d9de] rounded-md text-xs font-semibold text-[#1c232b] no-underline hover:bg-slate-50 text-center"
                >
                  Daily archive
                </a>
                <a
                  href="#dcm-colour-legend"
                  className="min-h-[44px] flex items-center justify-center px-3 py-2 bg-white border border-[#d5d9de] rounded-md text-xs font-semibold text-[#1c232b] no-underline hover:bg-slate-50 text-center"
                >
                  Colour legend
                </a>
                <a
                  href="#dcm-about-section"
                  className="col-span-2 sm:col-span-1 min-h-[44px] flex items-center justify-center px-3 py-2 bg-white border border-[#d5d9de] rounded-md text-xs font-semibold text-[#1c232b] no-underline hover:bg-slate-50 text-center"
                >
                  Methodology
                </a>
              </nav>
            )}
          </div>

          {/* RIGHT / SECONDARY COLUMN: Publication Selector, State Search & Stage 3 Evidence Panel */}
          {!hideAside && (
          <aside
            aria-label="Map controls and state evidence"
            className="min-w-0 bg-white border border-[#d5d9de] rounded-md p-4 sm:p-5 flex flex-col gap-6"
          >
            {/* View a published map (Single Full-Width Selector on Mobile/Tablet; 3-column Year/Month/Period preserved on Desktop) */}
            <div id="dcm-date-selector" className="flex flex-col gap-3 scroll-mt-6 min-w-0">
              <h2 className="m-0 text-lg font-bold text-[#1c232b]">
                View a published map
              </h2>

              {/* Mobile & Tablet (<1024px): Single readable full-width publication selector (zero clipping) */}
              <div className="flex flex-col gap-1.5 lg:hidden min-w-0">
                <label htmlFor="dcm-mobile-publication" className="text-sm font-semibold text-[#1c232b]">
                  Published edition
                </label>
                <select
                  id="dcm-mobile-publication"
                  value={activePub.id}
                  onChange={handlePeriodChange}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-[#8a939c] rounded bg-white text-[#1c232b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                >
                  {unifiedPubOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}{opt.isLatest ? ' — Latest' : ''}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-[#3d4752]">
                  Select any published daily update or historical reporting period.
                </span>
              </div>

              {/* Desktop (1024px+): Preserved Year / Month / Period controls */}
              <div className="hidden lg:grid lg:grid-cols-3 gap-2.5 min-w-0">
                {/* Year Select */}
                <div className="flex flex-col gap-1 min-w-0">
                  <label htmlFor="dcm-year" className="text-sm font-semibold">
                    Year
                  </label>
                  <select
                    id="dcm-year"
                    value={activePub.year}
                    onChange={handleYearChange}
                    className="w-full min-w-0 min-h-[44px] px-2 py-1.5 text-[15px] border border-[#8a939c] rounded bg-white text-[#1c232b]"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {/* Month Select */}
                <div className="flex flex-col gap-1 min-w-0">
                  <label htmlFor="dcm-month" className="text-sm font-semibold">
                    Month
                  </label>
                  <select
                    id="dcm-month"
                    value={activePub.month}
                    onChange={handleMonthChange}
                    className="w-full min-w-0 min-h-[44px] px-2 py-1.5 text-[15px] border border-[#8a939c] rounded bg-white text-[#1c232b]"
                  >
                    {monthsInYear.map((m) => (
                      <option key={m} value={m}>{DCM_MONTHS[m]}</option>
                    ))}
                  </select>
                </div>

                {/* Period Select */}
                <div className="flex flex-col gap-1 min-w-0">
                  <label htmlFor="dcm-period" className="text-sm font-semibold">
                    Period
                  </label>
                  <select
                    id="dcm-period"
                    value={activePub.id}
                    onChange={handlePeriodChange}
                    className="w-full min-w-0 min-h-[44px] px-2 py-1.5 text-[15px] border border-[#8a939c] rounded bg-white text-[#1c232b]"
                  >
                    {periodOpts.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Follow a State / State Information Section */}
            <div
              ref={stateInfoRef}
              id="dcm-state-info"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                scrollMarginTop: '28px'
              }}
            >
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                Follow a state
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label htmlFor="dcm-state-search" style={{ fontSize: '14px', fontWeight: 600 }}>
                  Search or select state
                </label>

                {/* State Search Input */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ position: 'absolute', left: '12px', pointerEvents: 'none' }}
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    id="dcm-state-search"
                    type="text"
                    value={stateSearchQuery}
                    onChange={(e) => setStateSearchQuery(e.target.value)}
                    placeholder="Search state (e.g. Kaduna, Edo, Kano)..."
                    style={{
                      width: '100%',
                      font: 'inherit',
                      fontSize: '14px',
                      minHeight: '40px',
                      padding: '8px 32px 8px 36px',
                      border: '1px solid #8a939c',
                      borderRadius: '4px',
                      background: '#ffffff',
                      color: '#1c232b',
                      boxSizing: 'border-box',
                      outline: 'none'
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#2563eb'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#8a939c'; }}
                  />
                  {stateSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setStateSearchQuery('')}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '14px',
                        color: '#64748b'
                      }}
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Quick match suggestion chips if searching */}
                {stateSearchQuery.trim() && filteredStateOptions.length > 0 && filteredStateOptions.length <= 8 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {filteredStateOptions.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          selectState(st, true);
                          setStateSearchQuery('');
                        }}
                        style={{
                          fontSize: '12px',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          border: sel === st ? '1px solid #2563eb' : '1px solid #cbd5e1',
                          background: sel === st ? '#2563eb' : '#f8fafc',
                          color: sel === st ? '#ffffff' : '#1e293b',
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                )}

                {/* Dropdown Select */}
                <select
                  id="dcm-state"
                  value={sel || ''}
                  onChange={handleStateSelect}
                  style={{
                    font: 'inherit',
                    fontSize: '15px',
                    minHeight: '44px',
                    padding: '6px 8px',
                    border: '1px solid #8a939c',
                    borderRadius: '4px',
                    background: '#ffffff',
                    color: '#1c232b'
                  }}
                >
                  <option value="">{stateSearchQuery ? `Filtered states (${filteredStateOptions.length})` : 'All states'}</option>
                  {filteredStateOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <span style={{ fontSize: '13px', color: '#3d4752' }}>
                  Search above, choose from the list, or click any state on the map.
                </span>
              </div>

              {!sel && (
                <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.5, color: '#3d4752' }}>
                  Choose a state to see its classification trend for {activePub.year}.
                </p>
              )}

              {sel && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>
                        {sel}
                      </h3>
                      <button
                        type="button"
                        onClick={() => selectState(null, false)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#1f5fa8',
                          fontSize: '13px',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline'
                        }}
                      >
                        Clear selection
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px', fontWeight: 600 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '3px',
                          border: '1px solid #8a939c',
                          background: selCatObj.hex,
                          flex: 'none',
                          display: 'inline-block'
                        }}
                      />
                      {selCatObj.name}
                      <span style={{ fontWeight: 400, color: '#3d4752' }}>
                        ({activePub.short})
                      </span>
                    </div>

                    {/* Stage 3 & Stage 5 Enhanced State Assessment Panel (Permalinks, Correction Notices, Sections A–E) */}
                    {selectedStatePanelData && (
                      <DcmStateAssessmentPanel
                        panelData={selectedStatePanelData}
                        selectedPeriodLabel={activePub.short}
                        evidenceCutoffLabel={activePub.cutoff || 'Not recorded'}
                        publicationDateLabel={
                          selectionResolution.activePublication?.publicationDate || activePub.short
                        }
                        statePermalinkUrl={activeStatePermalink}
                        absolutePermalinkUrl={activeAbsoluteStatePermalink}
                        correctionChain={activeCorrectionChain}
                        buildHistoricalPermalink={buildHistoricalPermalinkForSelectedState}
                        onSelectHistoricalEdition={(pubId) => {
                          selectEditionAndSyncUrl(pubId);
                        }}
                      />
                    )}
                  </div>

                  {/* Year Trend Grid */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600 }}>
                      {activePub.year} trend
                    </span>

                    <div
                      role="group"
                      aria-label={`${activePub.year} classification trend for ${sel}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        border: '1px solid #d5d9de'
                      }}
                    >
                      {monthTrends.map((m, mIdx) => (
                        <div
                          key={m.name}
                          style={{
                            display: 'flex',
                            aspectRatio: '1 / 1',
                            borderRight: mIdx < 11 ? '1px solid #ffffff' : 'none'
                          }}
                        >
                          {m.halves.map((h, hIdx) => (
                            <button
                              key={`${m.name}-${hIdx}`}
                              type="button"
                              disabled={h.disabled}
                              onClick={() => {
                                if (!h.disabled && h.pubId) {
                                  selectEditionAndSyncUrl(h.pubId);
                                }
                              }}
                              aria-label={h.aria}
                              title={h.aria}
                              style={{
                                flex: '1 1 0',
                                minWidth: 0,
                                padding: 0,
                                margin: 0,
                                border: 'none',
                                borderRight: hIdx === 0 ? '1px solid #ffffff' : 'none',
                                background: h.hex,
                                boxShadow: h.isActive ? 'inset 0 0 0 2px #1f5fa8' : 'none',
                                cursor: h.disabled ? 'default' : 'pointer'
                              }}
                            />
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* Month Abbreviations */}
                    <div
                      aria-hidden="true"
                      className="grid grid-cols-12 text-[9px] sm:text-[11px] leading-tight text-[#3d4752] text-center overflow-hidden"
                    >
                      {monthTrends.map((m) => (
                        <span key={m.name} className="min-w-0 truncate">{m.abbr}</span>
                      ))}
                    </div>

                    <p style={{ margin: '4px 0 0', fontSize: '13px', lineHeight: 1.5, color: '#3d4752' }}>
                      Each month is split in two: the left half is the publication for the 1st to the 15th, the right half the publication for the 16th to month-end. A pale cell means no publication.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Request Brief CTA Button */}
            <button
              type="button"
              onClick={() => {
                setFormOpen(true);
                setFormDone(false);
              }}
              style={{
                font: 'inherit',
                fontSize: '16px',
                fontWeight: 600,
                minHeight: '48px',
                padding: '10px 16px',
                borderRadius: '4px',
                border: 'none',
                background: '#1c232b',
                color: '#ffffff',
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              Request the DCM Brief for this period
            </button>

            <p style={{ margin: '-12px 0 0', fontSize: '14px', textAlign: 'center', color: '#3d4752' }}>
              Seen something we may have missed?
              <br />
              <a
                href="https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=wNynuw5quEuIVaAKwkD2XQCOpLjLwJxLukh_kFKHtNRUNk1TODY5NTBINFE3VE5HT0kxSFNQWEtXNy4u"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  marginTop: '4px',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#1f5fa8'
                }}
              >
                Tell us
              </a>
            </p>
          </aside>
          )}
        </div>

        {/* Stage 5: Daily & Historical DCM Publication Archive (Month/Year Navigation, 15th & Month-End Comparison Points, Permanent Snapshot Links) */}
        {!isEmbedded && !hideAside && (
          <DcmArchiveSection
            publishedPublications={publishedCanonical}
            activePublicationId={activePub.id}
            activeYear={activePub.year}
            activeMonth={activePub.month + 1}
            selectedStateName={sel}
            onSelectArchiveEdition={(pubId, nextState) => {
              selectEditionAndSyncUrl(pubId, nextState, true);
            }}
            onLoadArchiveMonth={loadDcmArchiveMonth}
          />
        )}

        {/* DCM Explanatory, Legend Definitions & Methodology Section (Positioned below main map experience) */}
        {!isEmbedded && (
          <section
            id="dcm-about-section"
            aria-label="About the Democratic Competitiveness Map"
            className="bg-white border border-line rounded-xl sm:rounded-2xl p-4 sm:p-8 lg:p-10 space-y-6 sm:space-y-8 shadow-sm min-w-0 scroll-mt-6"
          >
            {/* 1. How do the colours work? (Always visible on mobile & desktop; stacked cards on mobile, table on md+) */}
            <div id="dcm-colour-legend" className="space-y-4 sm:space-y-5 text-ink2 text-sm sm:text-base leading-relaxed scroll-mt-6 min-w-0">
              <div className="space-y-2">
                <h2 className="font-display font-bold text-xl sm:text-2xl text-ink m-0">
                  How do the colours work?
                </h2>
                <p className="m-0">
                  The DCM uses five colour classifications. The colours are evidence-based and time-bound; they are not permanent labels assigned to states.
                </p>
                <p className="m-0 text-sm font-semibold text-[#1c232b] bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
                  {INSUFFICIENT_EVIDENCE_DISCLAIMER}
                </p>
              </div>

              {/* Mobile Stacked Colour Definitions (<768px — zero horizontal clipping or scroll) */}
              <div className="md:hidden space-y-3" aria-label="Classification colour definitions">
                {DCM_LEGEND_DEFINITIONS.map((item) => (
                  <div
                    key={item.code}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1.5 min-w-0"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        aria-hidden="true"
                        className="w-4 h-4 rounded-[3px] border border-[#8a939c] shrink-0 inline-block"
                        style={{ backgroundColor: item.hex }}
                      />
                      <span className="font-bold text-sm text-[#1c232b] break-words">
                        {item.colourName} — {item.classification}
                      </span>
                    </div>
                    <p className="m-0 text-xs sm:text-sm text-[#3d4752] leading-relaxed break-words">
                      {item.definition}
                    </p>
                  </div>
                ))}
              </div>

              {/* Tablet & Desktop Table (768px+ — preserved horizontal colour table with canonical hex swatches) */}
              <div className="hidden md:block overflow-x-auto my-4 border border-line rounded-xl">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-paper border-b border-line text-ink font-mono text-xs uppercase">
                      <th className="p-4 font-bold">Colour</th>
                      <th className="p-4 font-bold">Classification</th>
                      <th className="p-4 font-bold">What it means</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-ink2">
                    {DCM_LEGEND_DEFINITIONS.map((item) => (
                      <tr key={item.code} className="hover:bg-paper/50">
                        <td className="p-4 font-semibold text-ink align-top whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="w-3.5 h-3.5 rounded-[3px] border border-[#8a939c] inline-block shrink-0"
                              style={{ backgroundColor: item.hex }}
                            />
                            {item.colourName}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-ink align-top">{item.classification}</td>
                        <td className="p-4">{item.definition}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. What is DCM? (Collapsible on mobile <1024px, always open on desktop lg+) */}
            <div className="border-t border-line pt-5 sm:pt-7 min-w-0">
              <button
                type="button"
                aria-expanded={Boolean(openExplanatoryMobile.whatIsDcm)}
                onClick={() => toggleExplanatoryMobile('whatIsDcm')}
                className="lg:hidden w-full min-h-[44px] flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="font-display font-bold text-lg text-ink">What is DCM?</span>
                {openExplanatoryMobile.whatIsDcm ? (
                  <ChevronUp className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                )}
              </button>
              <h2 className="hidden lg:block font-display font-bold text-2xl text-ink mb-4">What is DCM?</h2>
              <div className={`${openExplanatoryMobile.whatIsDcm ? 'block mt-3' : 'hidden'} lg:block space-y-4 text-ink2 text-sm sm:text-base leading-relaxed`}>
                <p className="m-0">
                  The Democratic Competitiveness Map (DCM) is the Athena Election Observatory’s evidence-based system for monitoring the conditions under which legitimate political actors compete across Nigeria’s thirty-six states and the Federal Capital Territory.
                </p>
                <p className="m-0">
                  A credible election requires more than a credible election day. Political actors must also have a practical opportunity to organise, communicate, move, assemble and compete before voters cast their ballots.
                </p>
                <p className="m-0">
                  Election integrity examines whether voting, counting and collation reflect the will of voters. The DCM examines the environment in which political actors compete, whether the political actors have a reasonably open and fair opportunity to compete for those votes.
                </p>
                <p className="m-0">
                  The DCM assesses whether political parties, candidates and other legitimate political actors can organise, communicate, mobilise, move, campaign, access relevant institutions and participate in political competition under conditions of political pluralism, institutional neutrality, legal certainty and practical fairness.
                </p>
              </div>
            </div>

            {/* 3. What does it track? */}
            <div className="border-t border-line pt-5 sm:pt-7 min-w-0">
              <button
                type="button"
                aria-expanded={Boolean(openExplanatoryMobile.whatTracks)}
                onClick={() => toggleExplanatoryMobile('whatTracks')}
                className="lg:hidden w-full min-h-[44px] flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="font-display font-bold text-lg text-ink">What does it track?</span>
                {openExplanatoryMobile.whatTracks ? (
                  <ChevronUp className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                )}
              </button>
              <h2 className="hidden lg:block font-display font-bold text-2xl text-ink mb-4">What does it track?</h2>
              <div className={`${openExplanatoryMobile.whatTracks ? 'block mt-3' : 'hidden'} lg:block space-y-4 text-ink2 text-sm sm:text-base leading-relaxed`}>
                <p className="m-0">The DCM tracks five dimensions of the political competition environment:</p>
                <ul className="list-disc pl-5 sm:pl-6 space-y-2.5 m-0">
                  <li>
                    <strong className="text-ink">Political Space — Freedom of Association and Movement:</strong> Whether political actors can organise, assemble, move and campaign without unjustified or discriminatory restrictions.
                  </li>
                  <li>
                    <strong className="text-ink">Freedom of Speech and Expression:</strong> Whether political actors can communicate, campaign and express political positions without materially restrictive interference.
                  </li>
                  <li>
                    <strong className="text-ink">Administrative and Regulatory Neutrality:</strong> Whether administrative, regulatory and legal powers are applied impartially and without creating discriminatory competitive effects.
                  </li>
                  <li>
                    <strong className="text-ink">Security Neutrality:</strong> Whether police and security institutions protect lawful political activity and enforce applicable rules impartially across political actors.
                  </li>
                  <li>
                    <strong className="text-ink">Political Intimidation and Violence:</strong> Whether threats, coercion or violence materially restrict political actors from participating in political competition.
                  </li>
                </ul>
              </div>
            </div>

            {/* 4. What does it seek to achieve? */}
            <div className="border-t border-line pt-5 sm:pt-7 min-w-0">
              <button
                type="button"
                aria-expanded={Boolean(openExplanatoryMobile.whatAchieves)}
                onClick={() => toggleExplanatoryMobile('whatAchieves')}
                className="lg:hidden w-full min-h-[44px] flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="font-display font-bold text-lg text-ink">What does it seek to achieve?</span>
                {openExplanatoryMobile.whatAchieves ? (
                  <ChevronUp className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                )}
              </button>
              <h2 className="hidden lg:block font-display font-bold text-2xl text-ink mb-4">What does it seek to achieve?</h2>
              <div className={`${openExplanatoryMobile.whatAchieves ? 'block mt-3' : 'hidden'} lg:block space-y-4 text-ink2 text-sm sm:text-base leading-relaxed`}>
                <p className="m-0">The DCM is designed to:</p>
                <ul className="list-disc pl-5 sm:pl-6 space-y-2.5 m-0">
                  <li>Provide an evidence-based picture of political competition conditions across Nigeria before election day.</li>
                  <li>Identify emerging restrictions and pressure points that may affect the ability of political actors to compete.</li>
                  <li>Track changes in competitive conditions over time, including whether conditions improve, deteriorate or remain unchanged.</li>
                  <li>Make the evidence behind each classification transparent and traceable, allowing users to examine the basis for a state’s classification.</li>
                  <li>Highlight areas requiring closer attention from political actors, institutions, civil society, researchers and other stakeholders as elections approach.</li>
                </ul>
              </div>
            </div>

            {/* 5. What is it not? */}
            <div className="border-t border-line pt-5 sm:pt-7 min-w-0">
              <button
                type="button"
                aria-expanded={Boolean(openExplanatoryMobile.whatNot)}
                onClick={() => toggleExplanatoryMobile('whatNot')}
                className="lg:hidden w-full min-h-[44px] flex items-center justify-between gap-2 text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="font-display font-bold text-lg text-ink">What is it not?</span>
                {openExplanatoryMobile.whatNot ? (
                  <ChevronUp className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-600 shrink-0" aria-hidden="true" />
                )}
              </button>
              <h2 className="hidden lg:block font-display font-bold text-2xl text-ink mb-4">What is it not?</h2>
              <div className={`${openExplanatoryMobile.whatNot ? 'block mt-3' : 'hidden'} lg:block space-y-4 text-ink2 text-sm sm:text-base leading-relaxed`}>
                <p className="m-0">The DCM:</p>
                <ul className="list-disc pl-5 sm:pl-6 space-y-2.5 m-0">
                  <li>Does not rank states or political parties.</li>
                  <li>Does not assign numerical scores, weights or composite values.</li>
                  <li>Does not measure political popularity, vote share or predict electoral outcomes.</li>
                  <li>Does not assess whether a court reached the correct legal conclusion.</li>
                  <li>Does not treat allegations as established facts without sufficient verification.</li>
                  <li>Is not a general democracy, governance or civil-liberties index.</li>
                  <li>Does not equate limited reporting or lack of evidence with an open political environment.</li>
                  <li>Does not replace AEO’s election-day monitoring or Post-Election Audit workstreams.</li>
                </ul>
                <p className="mt-3 mb-0">
                  Each colour represents the current state of evidence for a defined reporting period, rather than a permanent judgment about a state. Classifications can change as conditions change, restrictions are remedied, or stronger evidence becomes available.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Embedded Mode Footer Banner */}
        {isEmbedded && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '16px 22px',
              background: '#ffffff',
              border: '1px solid #d5d9de',
              borderRadius: '8px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)'
            }}
          >
            <div style={{ fontSize: '14px', color: '#334155', lineHeight: 1.5 }}>
              <strong style={{ color: '#0f172a' }}>Explore full dataset:</strong> View all historical bi-monthly publications, inspect detailed evidentiary rationales for all 37 jurisdictions, and request official briefs.
            </div>
            <a
              href="/democratic-competitiveness-map"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/democratic-competitiveness-map');
                window.dispatchEvent(new PopStateEvent('popstate'));
                window.scrollTo(0, 0);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: '#1f5fa8',
                fontSize: '13px',
                fontWeight: 700,
                textDecoration: 'none',
                cursor: 'pointer'
              }}
            >
              <span>Explore Complete DCM Archive</span>
              <span>→</span>
            </a>
          </div>
        )}

        {/* Modal Dialog: Request the DCM Brief */}
        {formOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(28, 35, 43, 0.55)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              padding: '32px 16px',
              overflowY: 'auto',
              zIndex: 9999,
              boxSizing: 'border-box'
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseModal();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dcm-form-title"
              style={{
                background: '#ffffff',
                borderRadius: '6px',
                width: '100%',
                maxWidth: '580px',
                padding: '28px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
              }}
            >
              {!formDone ? (
                <form onSubmit={handleSubmitBrief} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <h2 id="dcm-form-title" style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
                      Request the DCM Brief
                    </h2>
                    <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.5, color: '#3d4752' }}>
                      Publication: {activePub.short}. The brief covers all 36 states and the FCT and is free of charge.
                    </p>
                  </div>

                  {/* Honeypot field for automated spam protection */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '-10000px',
                      width: '1px',
                      height: '1px',
                      overflow: 'hidden'
                    }}
                    aria-hidden="true"
                  >
                    <label htmlFor="dcm-f-website">Website</label>
                    <input
                      id="dcm-f-website"
                      name="website"
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={fWebsite}
                      onChange={(e) => setFWebsite(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="dcm-f-name" style={{ fontSize: '14px', fontWeight: 600 }}>
                      Full name <span style={{ color: '#8f1d17' }}>*</span>
                    </label>
                    <input
                      id="dcm-f-name"
                      type="text"
                      required
                      disabled={formSubmitting}
                      autoComplete="name"
                      value={fName}
                      onChange={(e) => setFName(e.target.value)}
                      placeholder="e.g. Amina Bello"
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        minHeight: '44px',
                        padding: '6px 10px',
                        border: '1px solid #8a939c',
                        borderRadius: '4px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="dcm-f-email" style={{ fontSize: '14px', fontWeight: 600 }}>
                      Email address <span style={{ color: '#8f1d17' }}>*</span>
                    </label>
                    <input
                      id="dcm-f-email"
                      type="email"
                      required
                      disabled={formSubmitting}
                      autoComplete="email"
                      value={fEmail}
                      onChange={(e) => setFEmail(e.target.value)}
                      placeholder="name@organisation.org"
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        minHeight: '44px',
                        padding: '6px 10px',
                        border: '1px solid #8a939c',
                        borderRadius: '4px',
                        boxSizing: 'border-box'
                      }}
                    />
                    <span style={{ fontSize: '13px', color: '#3d4752' }}>
                      The AEO team will contact you at this address regarding your request.
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="dcm-f-org" style={{ fontSize: '14px', fontWeight: 600 }}>
                      Organisation (optional)
                    </label>
                    <input
                      id="dcm-f-org"
                      type="text"
                      disabled={formSubmitting}
                      autoComplete="organization"
                      value={fOrg}
                      onChange={(e) => setFOrg(e.target.value)}
                      placeholder="e.g. Centre for Democracy"
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        minHeight: '44px',
                        padding: '6px 10px',
                        border: '1px solid #8a939c',
                        borderRadius: '4px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="dcm-f-sector" style={{ fontSize: '14px', fontWeight: 600 }}>
                      Which best describes you? <span style={{ color: '#8f1d17' }}>*</span>
                    </label>
                    <select
                      id="dcm-f-sector"
                      required
                      disabled={formSubmitting}
                      value={fSector}
                      onChange={(e) => setFSector(e.target.value)}
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        minHeight: '44px',
                        padding: '6px 8px',
                        border: '1px solid #8a939c',
                        borderRadius: '4px',
                        background: '#ffffff',
                        color: '#1c232b'
                      }}
                    >
                      <option value="">Select one</option>
                      {SECTORS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label htmlFor="dcm-f-use" style={{ fontSize: '14px', fontWeight: 600 }}>
                      How will you use the brief? (optional)
                    </label>
                    <textarea
                      id="dcm-f-use"
                      rows={3}
                      disabled={formSubmitting}
                      value={fUse}
                      onChange={(e) => setFUse(e.target.value)}
                      placeholder="e.g. Research, civic voter awareness, news reporting..."
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        padding: '8px 10px',
                        border: '1px solid #8a939c',
                        borderRadius: '4px',
                        boxSizing: 'border-box',
                        resize: 'vertical'
                      }}
                    />
                  </div>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      cursor: formSubmitting ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <input
                      type="checkbox"
                      disabled={formSubmitting}
                      checked={fConsent}
                      onChange={(e) => setFConsent(e.target.checked)}
                      style={{ width: '18px', height: '18px', margin: '2px 0 0', flex: 'none' }}
                    />
                    <span>
                      I agree that AEO may use these details to review my request and contact me regarding the brief, as set out in the privacy notice.
                    </span>
                  </label>

                  {formError && (
                    <div
                      role="alert"
                      style={{
                        padding: '12px 14px',
                        borderRadius: '4px',
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#991b1b',
                        fontSize: '14px',
                        lineHeight: 1.5
                      }}
                    >
                      {formError}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      disabled={formSubmitting}
                      onClick={handleCloseModal}
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        minHeight: '44px',
                        padding: '8px 18px',
                        borderRadius: '4px',
                        border: '1px solid #8a939c',
                        background: '#ffffff',
                        color: '#1c232b',
                        cursor: formSubmitting ? 'not-allowed' : 'pointer',
                        opacity: formSubmitting ? 0.65 : 1
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmit || formSubmitting}
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        fontWeight: 600,
                        minHeight: '44px',
                        padding: '8px 18px',
                        borderRadius: '4px',
                        border: 'none',
                        background: canSubmit && !formSubmitting ? '#1c232b' : '#8a939c',
                        color: '#ffffff',
                        cursor: canSubmit && !formSubmitting ? 'pointer' : 'not-allowed'
                      }}
                    >
                      {formSubmitting ? 'Sending request...' : 'Request the brief'}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h2 id="dcm-form-title" style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>
                    Request received
                  </h2>
                  <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.5 }}>
                    Thank you. Your DCM Brief request has been received. The AEO team will contact you using the email address provided.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      style={{
                        font: 'inherit',
                        fontSize: '15px',
                        fontWeight: 600,
                        minHeight: '44px',
                        padding: '8px 18px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#1c232b',
                        color: '#ffffff',
                        cursor: 'pointer'
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DcmPreview;
