import React, { useMemo, useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  History,
  Link2,
  Lock,
  Newspaper,
  Radio,
  RotateCcw,
  ShieldCheck,
  Globe
} from 'lucide-react';
import { useCMS } from '../context/CMSContext';
import { auth } from '../lib/firebase';
import {
  DCM_EDITORIAL_HANDOVER_STATUSES,
  DcmEditorialExportType,
  DcmEditorialHandoverRecord,
  DcmEditorialHandoverStatus,
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPublication,
  NIGERIA_37_JURISDICTIONS
} from '../types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../data/dcmInitialData';
import { resolvePublicDcmPublications, resolvePublicationMetadata } from '../utils/dcmConsistency';
import { isDailyPublication } from '../utils/dcmDaily';
import { resolvePublicationCorrectionChain } from '../utils/dcmArchive';
import {
  DEFAULT_DCM_CANONICAL_ORIGIN,
  EDITORIAL_HANDOVER_GOVERNANCE_NOTICE,
  NOT_SUPPLIED_LABEL,
  buildCanonicalEditorialSource,
  buildEditorialHandoverRecord,
  generateClearPathOnTheMapExtract,
  generateNewsletterDcwExtract,
  generateWebsiteDailySummaryExtract
} from '../utils/dcmEditorial';

export interface DcmEditorialPublishingViewProps {
  allPublications: DcmPublication[];
  evidenceRecords: DcmEvidenceRecord[];
  incidentRecords: DcmIncidentRecord[];
  developmentRecords: DcmIncidentDevelopment[];
  handovers: DcmEditorialHandoverRecord[];
  onSaveHandover: (record: DcmEditorialHandoverRecord) => Promise<DcmEditorialHandoverRecord>;
  onUpdateHandoverStatus: (
    handoverId: string,
    status: DcmEditorialHandoverStatus,
    recipientTeam?: string
  ) => Promise<DcmEditorialHandoverRecord>;
  currentUser?: { uid: string; displayName?: string | null; email?: string | null } | null;
  origin?: string;
  initialStateCode?: string;
  initialPublicationId?: string;
  initialExportType?: DcmEditorialExportType;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
  return false;
}

const EXPORT_TYPE_META: Record<
  DcmEditorialExportType,
  { label: string; shortLabel: string; recipientSuggestion: string }
> = {
  'newsletter-dcw': {
    label: 'Newsletter: Democratic Competitiveness Watch',
    shortLabel: 'Democratic Competitiveness Watch',
    recipientSuggestion: 'AEO Daily Newsletter Desk'
  },
  'clearpath-on-the-map': {
    label: 'ClearPath: On the Map',
    shortLabel: 'On the Map',
    recipientSuggestion: 'ClearPath Electoral Matters Editorial Team'
  },
  'website-summary': {
    label: 'Website Daily Summary',
    shortLabel: 'Website Daily Summary',
    recipientSuggestion: 'AEO Website Publishing Desk'
  }
};

export const DcmEditorialPublishingView: React.FC<DcmEditorialPublishingViewProps> = ({
  allPublications,
  evidenceRecords,
  incidentRecords,
  developmentRecords,
  handovers,
  onSaveHandover,
  onUpdateHandoverStatus,
  currentUser,
  origin,
  initialStateCode = '',
  initialPublicationId = '',
  initialExportType = 'newsletter-dcw'
}) => {
  // Strictly published editions only (newest first); drafts/approved/scheduled are explicitly excluded
  const publishedDescending = useMemo(() => {
    const asc = resolvePublicDcmPublications(allPublications);
    return [...asc].reverse();
  }, [allPublications]);

  const excludedDraftCount = useMemo(() => {
    return (allPublications || []).filter((p) => p && p.status !== 'published').length;
  }, [allPublications]);

  const [selectedPubId, setSelectedPubId] = useState<string>(
    initialPublicationId || publishedDescending[0]?.id || ''
  );
  // Editorial staff MUST choose the state manually (never auto-select "most important state")
  const [selectedStateCode, setSelectedStateCode] = useState<string>(initialStateCode);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [activeExportType, setActiveExportType] = useState<DcmEditorialExportType>(initialExportType);

  // Separate editable editorial draft buffers per export type + publication + state key
  const [draftEditsByKey, setDraftEditsByKey] = useState<Record<string, string>>({});
  const [preparedByName, setPreparedByName] = useState<string>(
    currentUser?.displayName || currentUser?.email?.split('@')[0] || ''
  );
  const [recipientTeam, setRecipientTeam] = useState<string>(
    EXPORT_TYPE_META[initialExportType].recipientSuggestion
  );
  const [handoverStatus, setHandoverStatus] = useState<DcmEditorialHandoverStatus>('prepared');
  const [isSavingHandover, setIsSavingHandover] = useState<boolean>(false);
  const [updatingHandoverId, setUpdatingHandoverId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const effectiveOrigin = useMemo(() => {
    if (origin) return origin;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return DEFAULT_DCM_CANONICAL_ORIGIN;
  }, [origin]);

  // Keep selectedPubId valid if publishedDescending updates
  useEffect(() => {
    if (!selectedPubId && publishedDescending.length > 0) {
      setSelectedPubId(publishedDescending[0].id);
    } else if (
      selectedPubId &&
      publishedDescending.length > 0 &&
      !publishedDescending.some((p) => p.id === selectedPubId)
    ) {
      setSelectedPubId(publishedDescending[0].id);
    }
  }, [publishedDescending, selectedPubId]);

  const selectedPublication = useMemo(
    () => publishedDescending.find((p) => p.id === selectedPubId) || null,
    [publishedDescending, selectedPubId]
  );

  // Build canonical editorial source (returns error cleanly if no state selected yet)
  const sourceResult = useMemo(() => {
    if (!selectedPublication || !selectedStateCode) return null;
    return buildCanonicalEditorialSource({
      selectedPublication,
      allPublications: publishedDescending,
      stateIdentifier: selectedStateCode,
      evidenceRecords,
      incidentRecords,
      developmentRecords,
      selectedIncidentId: selectedIncidentId || null,
      origin: effectiveOrigin
    });
  }, [
    selectedPublication,
    selectedStateCode,
    publishedDescending,
    evidenceRecords,
    incidentRecords,
    developmentRecords,
    selectedIncidentId,
    effectiveOrigin
  ]);

  const canonicalSource = sourceResult && sourceResult.ok ? sourceResult.source : null;

  // Reset selected incident if it does not exist on the newly selected state/edition
  useEffect(() => {
    if (!selectedIncidentId || !canonicalSource) return;
    if (!canonicalSource.allStateIncidents.some((i) => i.id === selectedIncidentId)) {
      setSelectedIncidentId('');
    }
  }, [canonicalSource, selectedIncidentId]);

  const websiteExtract = useMemo(
    () => (canonicalSource ? generateWebsiteDailySummaryExtract(canonicalSource) : null),
    [canonicalSource]
  );
  const newsletterExtract = useMemo(
    () => (canonicalSource ? generateNewsletterDcwExtract(canonicalSource) : null),
    [canonicalSource]
  );
  const clearPathExtract = useMemo(
    () => (canonicalSource ? generateClearPathOnTheMapExtract(canonicalSource) : null),
    [canonicalSource]
  );

  const activeExtract =
    activeExportType === 'newsletter-dcw'
      ? newsletterExtract
      : activeExportType === 'clearpath-on-the-map'
      ? clearPathExtract
      : websiteExtract;

  const draftBufferKey = canonicalSource
    ? `${canonicalSource.publicationId}::${canonicalSource.stateCode}::${selectedIncidentId || 'all'}::${activeExportType}`
    : '';

  const approvedPlainText = activeExtract?.plainText || '';
  const currentDraftText =
    draftBufferKey && draftEditsByKey[draftBufferKey] !== undefined
      ? draftEditsByKey[draftBufferKey]
      : approvedPlainText;

  const isDraftModified =
    Boolean(activeExtract) && currentDraftText.trim() !== approvedPlainText.trim();

  const handleSelectExportType = (nextType: DcmEditorialExportType) => {
    setActiveExportType(nextType);
    setRecipientTeam(EXPORT_TYPE_META[nextType].recipientSuggestion);
    setFeedback(null);
  };

  const handleCopyText = async (text: string, key: string, successLabel: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setFeedback({ text: successLabel, tone: 'success' });
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    } else {
      setFeedback({
        text: 'Clipboard copy was blocked by the browser. Select the text manually to copy.',
        tone: 'error'
      });
    }
  };

  const handleDownloadJson = () => {
    if (!canonicalSource || !activeExtract) return;
    const payload = {
      governanceNotice: EDITORIAL_HANDOVER_GOVERNANCE_NOTICE,
      hasEditorialDraftEdits: isDraftModified,
      approvedExtract: activeExtract.structured,
      ...(isDraftModified ? { editorialDraftText: currentDraftText } : {})
    };
    const filename = `aeo-dcm-${activeExportType}-${canonicalSource.stateCode.toLowerCase()}-${canonicalSource.assessmentDateIso}.json`;
    downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    setFeedback({ text: `Exported structured JSON (${filename}).`, tone: 'success' });
  };

  const handleDownloadHtml = () => {
    if (!canonicalSource || !activeExtract) return;
    const filename = `aeo-dcm-${activeExportType}-${canonicalSource.stateCode.toLowerCase()}-${canonicalSource.assessmentDateIso}.html`;
    const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AEO DCM — ${activeExtract.templateName} (${canonicalSource.stateName}, ${canonicalSource.assessmentDateIso})</title>
</head>
<body>
${activeExtract.html}
  <footer>
    <p><small>${EDITORIAL_HANDOVER_GOVERNANCE_NOTICE}</small></p>
  </footer>
</body>
</html>`;
    downloadTextFile(filename, htmlDoc, 'text/html;charset=utf-8');
    setFeedback({ text: `Exported clean HTML (${filename}).`, tone: 'success' });
  };

  const handleRecordHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canonicalSource || !activeExtract) return;
    if (!currentUser?.uid) {
      setFeedback({
        text: 'Sign in as an authorised AEO administrator to record an editorial handover.',
        tone: 'error'
      });
      return;
    }
    const cleanPreparedName = preparedByName.trim();
    if (cleanPreparedName.length < 2) {
      setFeedback({
        text: 'Enter the preparing editorial staff member name before recording the handover.',
        tone: 'error'
      });
      return;
    }

    setIsSavingHandover(true);
    setFeedback(null);
    try {
      const record = buildEditorialHandoverRecord({
        source: canonicalSource,
        exportType: activeExportType,
        exportedText: currentDraftText,
        approvedPlainText,
        structuredExtract: activeExtract.structured,
        preparedByUid: currentUser.uid,
        preparedByName: cleanPreparedName,
        preparedByEmail: currentUser.email || undefined,
        handoverStatus,
        recipientTeam: recipientTeam.trim() || undefined
      });
      const saved = await onSaveHandover(record);
      setFeedback({
        text: `Editorial handover "${saved.id}" recorded for ${saved.stateName} (${saved.publicationId}). Immutable source snapshot preserved.`,
        tone: 'success'
      });
    } catch (err: any) {
      setFeedback({
        text: err?.message || 'Unable to record editorial handover.',
        tone: 'error'
      });
    } finally {
      setIsSavingHandover(false);
    }
  };

  const handleChangeLoggedHandoverStatus = async (
    handover: DcmEditorialHandoverRecord,
    nextStatus: DcmEditorialHandoverStatus
  ) => {
    setUpdatingHandoverId(handover.id);
    setFeedback(null);
    try {
      await onUpdateHandoverStatus(handover.id, nextStatus, handover.recipientTeam);
      setFeedback({
        text: `Updated handover "${handover.id}" status to "${nextStatus}". Original exported snapshot remains immutable.`,
        tone: 'success'
      });
    } catch (err: any) {
      setFeedback({
        text: err?.message || 'Unable to update handover status.',
        tone: 'error'
      });
    } finally {
      setUpdatingHandoverId(null);
    }
  };

  const publicSortedAsc = useMemo(
    () => resolvePublicDcmPublications(allPublications),
    [allPublications]
  );

  return (
    <div className="space-y-6" data-testid="dcm-editorial-publishing-manager">
      {/* Header Banner */}
      <div className="bg-white border border-line rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Newspaper className="w-5 h-5 text-brand-blue" />
              <h3 className="font-display font-bold text-xl text-ink">
                DCM Editorial Publishing
              </h3>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono font-bold uppercase tracking-wider">
                Published Records Only
              </span>
            </div>
            <p className="text-xs text-mut max-w-3xl leading-relaxed">
              Generate consistent, Research-approved extracts from immutable published DCM records for the daily newsletter
              (<strong>Democratic Competitiveness Watch</strong>), <strong>ClearPath Electoral Matters</strong> (<strong>On the Map</strong>),
              and Website summary parity. Editorial staff choose which state or approved development to feature; no automated publishing or external sending occurs here.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600 bg-paper px-3 py-2 rounded-xl border border-line shrink-0">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>
              {publishedDescending.length} published edition{publishedDescending.length === 1 ? '' : 's'} eligible
              {excludedDraftCount > 0 ? ` · ${excludedDraftCount} draft/unapproved excluded` : ''}
            </span>
          </div>
        </div>

        {/* Governance Notice */}
        <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-700">
          <ShieldCheck className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Editorial Governance Boundary:</strong> {EDITORIAL_HANDOVER_GOVERNANCE_NOTICE} Missing Research fields
            are displayed transparently as <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200">{NOT_SUPPLIED_LABEL}</code> rather
            than generated or extrapolated.
          </p>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs border ${
            feedback.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {feedback.tone === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Step 1: Select Published Edition, State & Optional Approved Incident */}
      <div className="bg-white border border-line rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
            1. Select Published Edition &amp; State
          </h4>
          <span className="text-[11px] font-mono text-mut">
            Manual editorial selection — system never ranks or auto-selects a featured state
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Published Edition Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="editorial-pub-select"
              className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
            >
              Published DCM Edition
            </label>
            <select
              id="editorial-pub-select"
              value={selectedPubId}
              onChange={(e) => {
                setSelectedPubId(e.target.value);
                setSelectedIncidentId('');
                setFeedback(null);
              }}
              className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              {publishedDescending.length === 0 ? (
                <option value="">No published editions available</option>
              ) : (
                publishedDescending.map((pub) => {
                  const meta = resolvePublicationMetadata(pub);
                  const tags = [
                    isDailyPublication(pub) ? 'Daily' : 'Legacy',
                    pub.isQuietDay ? 'Quiet Day' : '',
                    (pub.revisionNumber || 1) > 1 ? `Rev ${pub.revisionNumber}` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <option key={pub.id} value={pub.id}>
                      {meta.periodLabel} [{tags}] ({pub.id})
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {/* State Selector (All 36 States + FCT) */}
          <div className="space-y-1.5">
            <label
              htmlFor="editorial-state-select"
              className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
            >
              State / Jurisdiction (36 States + FCT)
            </label>
            <select
              id="editorial-state-select"
              value={selectedStateCode}
              onChange={(e) => {
                setSelectedStateCode(e.target.value);
                setSelectedIncidentId('');
                setFeedback(null);
              }}
              className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              <option value="">— Select a state manually —</option>
              {NIGERIA_37_JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.name} ({j.code}) — {j.zone}
                </option>
              ))}
            </select>
          </div>

          {/* Optional Approved Incident Focus */}
          <div className="space-y-1.5">
            <label
              htmlFor="editorial-incident-select"
              className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
            >
              Approved Incident Focus (Optional)
            </label>
            <select
              id="editorial-incident-select"
              value={selectedIncidentId}
              disabled={!canonicalSource || canonicalSource.allStateIncidents.length === 0}
              onChange={(e) => {
                setSelectedIncidentId(e.target.value);
                setFeedback(null);
              }}
              className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {!canonicalSource
                  ? 'Select a state first'
                  : canonicalSource.allStateIncidents.length === 0
                  ? 'No published public incidents for this state snapshot'
                  : `All approved state evidence (${canonicalSource.allStateIncidents.length} incident${
                      canonicalSource.allStateIncidents.length === 1 ? '' : 's'
                    })`}
              </option>
              {canonicalSource?.allStateIncidents.map((inc) => (
                <option key={inc.id} value={inc.id}>
                  [{inc.firstReportedDate}] {inc.title} ({inc.id})
                </option>
              ))}
            </select>
          </div>
        </div>

        {!selectedStateCode && (
          <div className="bg-paper border border-dashed border-line rounded-xl p-4 text-xs text-slate-600">
            Choose a published DCM edition and select any of Nigeria&apos;s 36 states or the FCT above to inspect the
            immutable Research-approved record and generate extracts for <strong>Democratic Competitiveness Watch</strong>,{' '}
            <strong>On the Map</strong>, or the <strong>Website Daily Summary</strong>.
          </div>
        )}

        {sourceResult && sourceResult.ok === false && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
            <span>{'error' in sourceResult ? sourceResult.error : 'Unable to resolve canonical editorial source.'}</span>
          </div>
        )}
      </div>

      {/* Step 2 & 3: Canonical Source Record Inspector + Extract Generator */}
      {canonicalSource && activeExtract && (
        <>
          {/* Step 2: Immutable Research-Approved Source Summary */}
          <div className="bg-white border border-line rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                  2. Immutable Research-Approved Source Record
                </h4>
                <p className="text-[11px] text-mut mt-0.5">
                  Read-only canonical data shared with the live DCM map, state assessment panel, and daily summary.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyText(
                      canonicalSource.permanentStateAbsoluteUrl,
                      'permalink',
                      `Copied permanent state assessment link for ${canonicalSource.stateName} (${canonicalSource.publicationId}).`
                    )
                  }
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 bg-slate-50 hover:bg-slate-100 text-ink border border-line rounded-xl text-xs font-mono font-semibold cursor-pointer"
                >
                  {copiedKey === 'permalink' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5 text-brand-blue" />
                  )}
                  <span>Copy permanent state link</span>
                </button>
                <a
                  href={canonicalSource.permanentStateRelativeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 bg-white hover:bg-slate-50 text-brand-blue border border-blue-200 rounded-xl text-xs font-mono font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open public snapshot</span>
                </a>
              </div>
            </div>

            {/* Correction Notice if applicable */}
            {(canonicalSource.correction.isCorrectedVersion ||
              canonicalSource.correction.hasSubsequentCorrection) && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-950 space-y-1">
                <div className="flex items-center gap-2 font-mono font-bold uppercase text-[11px] text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>{canonicalSource.correction.editorialClarityNote}</span>
                </div>
                {canonicalSource.correction.isCorrectedVersion && (
                  <p>
                    This edition is <strong>Revision {canonicalSource.correction.revisionNumber}</strong>
                    {canonicalSource.correction.supersedesPublicationId
                      ? `, superseding ${canonicalSource.correction.supersedesPublicationId}`
                      : ''}
                    .
                    {canonicalSource.correction.revisionNote
                      ? ` Revision note: ${canonicalSource.correction.revisionNote}`
                      : ''}
                  </p>
                )}
                {canonicalSource.correction.hasSubsequentCorrection &&
                  canonicalSource.correction.latestCorrectionId && (
                    <p>
                      A later published correction exists:{' '}
                      <code className="bg-white px-1.5 py-0.5 rounded border border-amber-300">
                        {canonicalSource.correction.latestCorrectionId}
                      </code>
                      . Exports generated from this edition remain permanently linked to{' '}
                      <code>{canonicalSource.publicationId}</code>.
                    </p>
                  )}
              </div>
            )}

            {/* Key Canonical Facts Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-paper border border-line rounded-xl p-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-mut">
                  Approved Classification
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-sm border border-black/20 shrink-0"
                    style={{ backgroundColor: canonicalSource.currentClassificationHex }}
                  />
                  <span className="text-sm font-bold text-ink">
                    {canonicalSource.currentClassification}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-slate-600">
                  {canonicalSource.currentClassificationColourName} · Code {canonicalSource.currentClassificationCode} ·{' '}
                  {canonicalSource.currentClassificationHex}
                </p>
              </div>

              <div className="bg-paper border border-line rounded-xl p-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-mut">
                  Comparison &amp; Movement
                </span>
                <p className="text-xs font-semibold text-ink">
                  Previous: {canonicalSource.previousClassification || NOT_SUPPLIED_LABEL}
                </p>
                <p className="text-[11px] text-slate-600 leading-snug">
                  {canonicalSource.classificationMovementSummary}
                </p>
              </div>

              <div className="bg-paper border border-line rounded-xl p-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-mut">
                  Publication &amp; WAT Cut-off
                </span>
                <p className="text-xs font-semibold text-ink">{canonicalSource.periodLabel}</p>
                <p className="text-[11px] font-mono text-slate-600 break-all">
                  ID: {canonicalSource.publicationId}
                </p>
                <p className="text-[11px] text-slate-600">
                  Cut-off: {canonicalSource.evidenceCutoffWatLabel}
                </p>
              </div>

              <div className="bg-paper border border-line rounded-xl p-3 space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-mut">
                  Research Provenance &amp; Evidence
                </span>
                <p className="text-xs font-mono font-semibold text-ink break-all">
                  Ref: {canonicalSource.sourceApprovalReference}
                </p>
                <p className="text-[11px] text-slate-600">
                  {canonicalSource.supportingEvidence.length} public evidence ·{' '}
                  {canonicalSource.disputedClaims.length} disputed ·{' '}
                  {canonicalSource.sourceReferences.length} dated source
                  {canonicalSource.sourceReferences.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-slate-600 shrink-0">
                Permanent State Link:
              </span>
              <code className="text-[11px] font-mono text-brand-blue break-all">
                {canonicalSource.permanentStateAbsoluteUrl}
              </code>
            </div>
          </div>

          {/* Step 3: Extract Format Tabs, Editable Editorial Draft & Export Controls */}
          <div className="bg-white border border-line rounded-2xl p-5 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
              <div>
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                  3. Generate &amp; Export Approved Extracts
                </h4>
                <p className="text-[11px] text-mut mt-0.5">
                  All three formats derive from the exact same published record (<code>{canonicalSource.publicationId}</code>).
                </p>
              </div>

              {/* Template Switcher */}
              <div className="flex items-center gap-1.5 flex-wrap bg-paper p-1 rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => handleSelectExportType('newsletter-dcw')}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                    activeExportType === 'newsletter-dcw'
                      ? 'bg-brand-blue text-white shadow-xs'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <Newspaper className="w-3.5 h-3.5" />
                  <span>Democratic Competitiveness Watch</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectExportType('clearpath-on-the-map')}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                    activeExportType === 'clearpath-on-the-map'
                      ? 'bg-brand-blue text-white shadow-xs'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>ClearPath: On the Map</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectExportType('website-summary')}
                  className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                    activeExportType === 'website-summary'
                      ? 'bg-brand-blue text-white shadow-xs'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Website Daily Summary</span>
                </button>
              </div>
            </div>

            {/* Structured Immutable Preview + Editable Editorial Draft Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Left Column: Immutable Research-Approved Structured Fields */}
              <div className="space-y-3 bg-paper border border-line rounded-xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-900 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                    <Lock className="w-3 h-3" />
                    <span>Research-Approved Source Extract (Read-Only)</span>
                  </span>
                </div>

                {activeExportType === 'newsletter-dcw' && newsletterExtract && (
                  <dl className="space-y-2.5 text-xs">
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Publication Date &amp; WAT Cut-off</dt>
                      <dd className="text-ink font-medium">
                        {newsletterExtract.structured.publicationDate} ({newsletterExtract.structured.assessmentDateIso}) ·{' '}
                        {newsletterExtract.structured.watEvidenceCutoff}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Selected State &amp; Classification</dt>
                      <dd className="text-ink font-medium">
                        {newsletterExtract.structured.selectedState} ({newsletterExtract.structured.selectedStateCode}) —{' '}
                        <strong>{newsletterExtract.structured.currentClassification}</strong> (Previous:{' '}
                        {newsletterExtract.structured.previousClassification})
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Classification Change Status</dt>
                      <dd className="text-slate-700">{newsletterExtract.structured.classificationChangeStatus}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Approved Development Summary</dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {newsletterExtract.structured.approvedDevelopmentSummary}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">
                        Practical Effect on Political Competitiveness
                      </dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {newsletterExtract.structured.practicalEffectOnPoliticalCompetitiveness}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Approved Classification Rationale</dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {newsletterExtract.structured.approvedRationale}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Dated Source References</dt>
                      <dd className="text-slate-700">
                        {newsletterExtract.structured.datedSourceReferences.length > 0 ? (
                          <ul className="list-disc pl-4 space-y-1">
                            {newsletterExtract.structured.datedSourceReferences.map((ref, idx) => (
                              <li key={`${ref.sourceName}-${idx}`} className="break-words">
                                {ref.sourceName} ({ref.publicationDateDisplay})
                                {ref.documentReference ? ` · Ref: ${ref.documentReference}` : ''}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          NOT_SUPPLIED_LABEL
                        )}
                      </dd>
                    </div>
                  </dl>
                )}

                {activeExportType === 'clearpath-on-the-map' && clearPathExtract && (
                  <dl className="space-y-2.5 text-xs">
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">1. Selected state</dt>
                      <dd className="text-ink font-semibold">
                        {clearPathExtract.structured.selectedState} ({clearPathExtract.structured.selectedStateCode})
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">2. What happened</dt>
                      <dd className="text-slate-800 whitespace-pre-line">{clearPathExtract.structured.whatHappened}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">3. What AEO verified</dt>
                      <dd className="text-slate-800 whitespace-pre-line">{clearPathExtract.structured.whatAeoVerified}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">4. Approved classification</dt>
                      <dd className="text-slate-800">
                        <strong>{clearPathExtract.structured.approvedClassification.label}</strong> (
                        {clearPathExtract.structured.approvedClassification.colourName} ·{' '}
                        {clearPathExtract.structured.approvedClassification.code}) —{' '}
                        {clearPathExtract.structured.approvedClassification.movementStatus}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">
                        5. Why the classification changed or stayed the same
                      </dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {clearPathExtract.structured.whyClassificationChangedOrStayedTheSame}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">6. Disputed claims</dt>
                      <dd className="text-slate-800 whitespace-pre-line">{clearPathExtract.structured.disputedClaims}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">7. Institutional response</dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {clearPathExtract.structured.institutionalResponse}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">
                        8. Verified remedy or subsequent development
                      </dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {clearPathExtract.structured.verifiedRemedyOrSubsequentDevelopment}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">9. Source references</dt>
                      <dd className="text-slate-700">
                        {clearPathExtract.structured.sourceReferences.length > 0
                          ? `${clearPathExtract.structured.sourceReferences.length} dated approved source(s)`
                          : NOT_SUPPLIED_LABEL}
                      </dd>
                    </div>
                  </dl>
                )}

                {activeExportType === 'website-summary' && websiteExtract && (
                  <dl className="space-y-2.5 text-xs">
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Website Section Heading</dt>
                      <dd className="text-ink font-semibold">{websiteExtract.structured.heading}</dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Edition Date &amp; Cut-off</dt>
                      <dd className="text-slate-800">
                        {websiteExtract.structured.publicationDateLabel} ({websiteExtract.structured.assessmentDateIso}) ·{' '}
                        {websiteExtract.structured.evidenceCutoffWatLabel}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Approved Publication Summary</dt>
                      <dd className="text-slate-800 whitespace-pre-line">
                        {websiteExtract.structured.summaryParagraphs.length > 0
                          ? websiteExtract.structured.summaryParagraphs.join('\n\n')
                          : NOT_SUPPLIED_LABEL}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-mono text-[10px] uppercase text-mut">Selected State Parity Check</dt>
                      <dd className="text-slate-800">
                        {websiteExtract.structured.selectedState.stateName}:{' '}
                        <strong>{websiteExtract.structured.selectedState.classification}</strong> (
                        {websiteExtract.structured.selectedState.colourName} ·{' '}
                        {websiteExtract.structured.selectedState.hex})
                      </dd>
                    </div>
                  </dl>
                )}
              </div>

              {/* Right Column: Editable Editorial Draft & Export Buttons */}
              <div className="space-y-3 flex flex-col">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${
                      isDraftModified
                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                        : 'bg-blue-50 text-brand-blue border-blue-200'
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>
                      {isDraftModified
                        ? 'Editorial Draft Modified (Local Working Copy)'
                        : 'Editable Editorial Draft (Matches Approved Source)'}
                    </span>
                  </span>

                  {isDraftModified && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftEditsByKey((prev) => {
                          const next = { ...prev };
                          delete next[draftBufferKey];
                          return next;
                        });
                        setFeedback({
                          text: 'Reset working draft to the immutable Research-approved source extract.',
                          tone: 'success'
                        });
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-amber-900 hover:text-amber-950 underline cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset to Research-approved extract</span>
                    </button>
                  )}
                </div>

                {isDraftModified && (
                  <p className="text-[11px] text-amber-900 bg-amber-50/70 border border-amber-200 rounded-lg px-3 py-2">
                    Edits below modify only this working editorial handover copy. The published DCM record (
                    <code>{canonicalSource.publicationId}</code>) remains locked and unchanged.
                  </p>
                )}

                <label htmlFor="editorial-draft-textarea" className="sr-only">
                  Editable editorial extract text
                </label>
                <textarea
                  id="editorial-draft-textarea"
                  value={currentDraftText}
                  onChange={(e) =>
                    setDraftEditsByKey((prev) => ({
                      ...prev,
                      [draftBufferKey]: e.target.value
                    }))
                  }
                  rows={16}
                  className="w-full flex-1 font-mono text-xs leading-relaxed p-3.5 bg-white border border-line rounded-xl text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />

                {/* Export Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        currentDraftText,
                        'formatted-text',
                        `Copied formatted ${activeExtract.templateName} text to clipboard.`
                      )
                    }
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-brand-blue hover:bg-brand-blue-dark text-white rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {copiedKey === 'formatted-text' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    <span>Copy formatted text</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleCopyText(
                        canonicalSource.permanentStateAbsoluteUrl,
                        'state-link-btn',
                        'Copied permanent state assessment link to clipboard.'
                      )
                    }
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-ink border border-line rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer"
                  >
                    {copiedKey === 'state-link-btn' ? (
                      <Check className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Link2 className="w-4 h-4 text-brand-blue" />
                    )}
                    <span>Copy permanent state link</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-white hover:bg-slate-50 text-ink border border-line rounded-xl text-xs font-mono font-semibold cursor-pointer"
                  >
                    <FileJson className="w-4 h-4 text-indigo-700" />
                    <span>Export structured JSON</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadHtml}
                    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-white hover:bg-slate-50 text-ink border border-line rounded-xl text-xs font-mono font-semibold cursor-pointer"
                  >
                    <Code2 className="w-4 h-4 text-emerald-700" />
                    <span>Export clean HTML</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Step 4: Editorial Handover Recording Form */}
          <form
            onSubmit={handleRecordHandover}
            className="bg-white border border-line rounded-2xl p-5 shadow-xs space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
                  4. Record Editorial Handover (Admin Audit Log)
                </h4>
                <p className="text-[11px] text-mut mt-0.5">
                  Saves an immutable snapshot of this handover with WAT timestamp and permanent source link. Does not send emails or publish externally.
                </p>
              </div>
              <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                Handover ≠ New Research Approval
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="handover-prepared-by"
                  className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
                >
                  Prepared By (Staff Name)
                </label>
                <input
                  id="handover-prepared-by"
                  type="text"
                  required
                  value={preparedByName}
                  onChange={(e) => setPreparedByName(e.target.value)}
                  placeholder="e.g. AEO Editorial Desk Officer"
                  className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="handover-recipient"
                  className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
                >
                  Recipient Team (Optional)
                </label>
                <input
                  id="handover-recipient"
                  type="text"
                  value={recipientTeam}
                  onChange={(e) => setRecipientTeam(e.target.value)}
                  placeholder="e.g. ClearPath Electoral Matters"
                  className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="handover-status"
                  className="block text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600"
                >
                  Initial Handover Status
                </label>
                <select
                  id="handover-status"
                  value={handoverStatus}
                  onChange={(e) => setHandoverStatus(e.target.value as DcmEditorialHandoverStatus)}
                  className="w-full min-h-[44px] px-3 py-2 bg-white border border-line rounded-xl text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  {DCM_EDITORIAL_HANDOVER_STATUSES.filter((s) => s.value !== 'archived').map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-600">
                Source Research Approval Reference carried from <code>{canonicalSource.publicationId}</code>:{' '}
                <code className="bg-paper px-1.5 py-0.5 rounded border border-line">
                  {canonicalSource.sourceApprovalReference}
                </code>
              </p>
              <button
                type="submit"
                disabled={isSavingHandover}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 shrink-0"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{isSavingHandover ? 'Recording Handover...' : 'Record Editorial Handover'}</span>
              </button>
            </div>
          </form>
        </>
      )}

      {/* Recorded Editorial Handovers Log */}
      <div className="bg-white border border-line rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-brand-blue" />
            <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-ink">
              Editorial Handover Audit Log ({handovers.length})
            </h4>
          </div>
          <span className="text-[11px] font-mono text-mut">
            Stored in admin-only <code className="bg-paper px-1.5 py-0.5 rounded border border-line">/dcm_editorial_handovers</code> · Snapshots immutable
          </span>
        </div>

        {handovers.length === 0 ? (
          <p className="text-xs text-mut py-4 text-center">
            No editorial handovers have been recorded yet. Select a published edition and state above to prepare an extract.
          </p>
        ) : (
          <div className="space-y-3">
            {handovers.map((ho) => {
              const sourcePub = publicSortedAsc.find((p) => p.id === ho.publicationId) || null;
              const chain = sourcePub ? resolvePublicationCorrectionChain(publicSortedAsc, sourcePub) : null;
              return (
                <div
                  key={ho.id}
                  className="bg-paper border border-line rounded-xl p-4 space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-mono font-bold uppercase">
                        {EXPORT_TYPE_META[ho.exportType]?.shortLabel || ho.exportType}
                      </span>
                      <span className="text-xs font-bold text-ink">
                        {ho.stateName} ({ho.stateCode})
                      </span>
                      <code className="text-[11px] font-mono text-slate-600 bg-white px-1.5 py-0.5 rounded border border-line">
                        {ho.publicationId}
                      </code>
                      {ho.hasEditorialDraftEdits && (
                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-mono font-bold uppercase">
                          Draft Edited
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <label htmlFor={`ho-status-${ho.id}`} className="sr-only">
                        Update status for handover {ho.id}
                      </label>
                      <select
                        id={`ho-status-${ho.id}`}
                        value={ho.handoverStatus}
                        disabled={updatingHandoverId === ho.id}
                        onChange={(e) =>
                          handleChangeLoggedHandoverStatus(
                            ho,
                            e.target.value as DcmEditorialHandoverStatus
                          )
                        }
                        className="min-h-[38px] px-2.5 py-1 bg-white border border-line rounded-lg text-[11px] font-mono font-semibold text-ink"
                      >
                        {DCM_EDITORIAL_HANDOVER_STATUSES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(
                            `${ho.id}-snapshot.json`,
                            ho.snapshotPayload,
                            'application/json;charset=utf-8'
                          )
                        }
                        className="inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1 bg-white hover:bg-slate-50 border border-line rounded-lg text-[11px] font-mono text-slate-700 cursor-pointer"
                        title="Download immutable JSON snapshot captured at export time"
                      >
                        <Download className="w-3.5 h-3.5 text-brand-blue" />
                        <span>Snapshot</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-600">
                    <div>
                      <strong>Prepared by:</strong> {ho.preparedByName}
                      {ho.recipientTeam ? ` → ${ho.recipientTeam}` : ''}
                    </div>
                    <div>
                      <strong>Exported (WAT):</strong> {ho.exportedAtWatLabel}
                    </div>
                    <div className="break-all">
                      <strong>Source Approval Ref:</strong> <code>{ho.sourceApprovalReference}</code>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-brand-blue break-all">
                    <a
                      href={ho.permanentRecordUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {ho.permanentRecordUrl}
                    </a>
                  </div>

                  {chain?.hasSubsequentCorrection && chain.latestCorrection && (
                    <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-1.5">
                      Original handover snapshot preserved — a newer correction revision (
                      <code>{chain.latestCorrection.id}</code>) now exists in the DCM archive.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const DcmEditorialPublishingManager: React.FC = () => {
  const {
    dcmPublications,
    dcmEvidence,
    dcmIncidents,
    dcmIncidentDevelopments,
    dcmEditorialHandovers,
    saveDcmEditorialHandover,
    updateDcmEditorialHandoverStatus
  } = useCMS();

  const publications = useMemo(() => {
    if (dcmPublications && dcmPublications.length > 0) return dcmPublications;
    return INITIAL_DCM_PUBLICATIONS;
  }, [dcmPublications]);

  const user = auth.currentUser;

  return (
    <DcmEditorialPublishingView
      allPublications={publications}
      evidenceRecords={dcmEvidence}
      incidentRecords={dcmIncidents}
      developmentRecords={dcmIncidentDevelopments}
      handovers={dcmEditorialHandovers}
      onSaveHandover={saveDcmEditorialHandover}
      onUpdateHandoverStatus={updateDcmEditorialHandoverStatus}
      currentUser={
        user
          ? { uid: user.uid, displayName: user.displayName, email: user.email }
          : null
      }
    />
  );
};
