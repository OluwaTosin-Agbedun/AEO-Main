import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  History,
  Info,
  Link2,
  ShieldCheck
} from 'lucide-react';
import { StateAssessmentPanelData } from '../utils/dcmEvidence';
import { formatDailyDateLabel } from '../utils/dcmDaily';
import { PublicationCorrectionChain } from '../utils/dcmArchive';

export interface DcmStateAssessmentPanelProps {
  panelData: StateAssessmentPanelData;
  selectedPeriodLabel: string;
  evidenceCutoffLabel: string;
  onSelectHistoricalEdition: (publicationId: string) => void;
  /** Stage 5: Shareable permanent URL (relative & absolute) for this exact state + edition */
  statePermalinkUrl?: string;
  absolutePermalinkUrl?: string;
  /** Stage 5: Edition publication date label to distinguish from last substantive review date */
  publicationDateLabel?: string;
  /** Stage 5: Historical correction lineage for transparent navigation between original and corrected editions */
  correctionChain?: PublicationCorrectionChain | null;
  /** Stage 5: Helper to build shareable hrefs for Section E historical assessment items */
  buildHistoricalPermalink?: (publicationId: string) => string;
}

export const DcmStateAssessmentPanel: React.FC<DcmStateAssessmentPanelProps> = ({
  panelData,
  selectedPeriodLabel,
  evidenceCutoffLabel,
  onSelectHistoricalEdition,
  statePermalinkUrl,
  absolutePermalinkUrl,
  publicationDateLabel,
  correctionChain,
  buildHistoricalPermalink
}) => {
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [copiedPermalink, setCopiedPermalink] = useState(false);
  const [showPermalinkFallback, setShowPermalinkFallback] = useState(false);

  const shareUrl = absolutePermalinkUrl || statePermalinkUrl || '';

  const handleCopyPermalink = async () => {
    if (!shareUrl) return;
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      try {
        if (typeof document !== 'undefined') {
          const ta = document.createElement('textarea');
          ta.value = shareUrl;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedPermalink(true);
      setTimeout(() => setCopiedPermalink(false), 2400);
    } else {
      setShowPermalinkFallback(true);
    }
  };

  const {
    currentView,
    previousView,
    previousPeriodLabel,
    classificationChangedFromPrevious,
    approvedChangeOrRetentionReason,
    hasApprovedChangeOrRetentionReason,
    supportingEvidence,
    institutionalResponse,
    incidents,
    historicalEditions
  } = panelData;

  const visibleHistory = showAllHistory ? historicalEditions : historicalEditions.slice(0, 5);

  const formatBooleanStatus = (val: boolean | null): string => {
    if (val === true) return 'Yes';
    if (val === false) return 'No';
    return 'Not specified';
  };

  return (
    <div
      className="flex flex-col gap-4 mt-2 min-w-0 max-w-full"
      aria-label={`Detailed DCM assessment for ${panelData.stateName}`}
    >
      {/* Stage 5: Shareable Permalink Action Bar */}
      {shareUrl && (
        <div
          aria-label="Share this state assessment"
          className="bg-white border border-slate-200 rounded-lg p-3 flex flex-col gap-2 min-w-0 overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
            <div className="flex items-start gap-2 min-w-0">
              <Link2 className="w-4 h-4 text-[#1f5fa8] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900">
                  Permanent assessment link
                </div>
                <div className="text-[11px] text-slate-600 break-words">
                  Resolves permanently to {panelData.stateName} · {selectedPeriodLabel}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCopyPermalink}
              className="w-full sm:w-auto shrink-0 min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-[#1f5fa8] bg-white hover:bg-blue-50 text-xs font-semibold text-[#1f5fa8] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
            >
              {copiedPermalink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                  <span className="text-emerald-800">Link copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Copy link</span>
                </>
              )}
            </button>
          </div>
          {(showPermalinkFallback || copiedPermalink) && (
            <div className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 break-all select-all">
              {shareUrl}
            </div>
          )}
        </div>
      )}

      {/* Stage 5: Dated Historical Correction Notice (preserves original snapshot & links transparently to revisions) */}
      {correctionChain && (correctionChain.hasSubsequentCorrection || correctionChain.isCorrectedVersion) && (
        <div
          role="note"
          aria-label="Historical editorial correction notice"
          className="bg-amber-50 border border-amber-300 rounded-lg p-3 sm:p-3.5 text-xs text-amber-950 space-y-2 min-w-0 overflow-hidden"
        >
          <div className="flex items-start gap-2 min-w-0">
            <GitBranch className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              {correctionChain.hasSubsequentCorrection && correctionChain.latestCorrection ? (
                <>
                  <div className="font-bold text-amber-950 break-words">
                    Preserved original snapshot — Subsequent correction published
                    {correctionChain.correctionDateLabel ? ` (${correctionChain.correctionDateLabel})` : ''}
                  </div>
                  <p className="m-0 leading-relaxed text-amber-900 break-words">
                    You are viewing the preserved original published edition. A later corrected revision (r{correctionChain.latestCorrection.revisionNumber || 2}) was issued without altering this original snapshot.{' '}
                    <span className="font-medium">{correctionChain.editorialClarityNote}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {correctionChain.subsequentCorrections.map((rev) => {
                      const href = buildHistoricalPermalink ? buildHistoricalPermalink(rev.id) : undefined;
                      return href ? (
                        <a
                          key={rev.id}
                          href={href}
                          onClick={(e) => {
                            e.preventDefault();
                            onSelectHistoricalEdition(rev.id);
                          }}
                          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded border border-amber-700 bg-white hover:bg-amber-100 text-amber-950 font-semibold no-underline"
                        >
                          <span>View corrected revision (r{rev.revisionNumber || 2})</span>
                        </a>
                      ) : (
                        <button
                          key={rev.id}
                          type="button"
                          onClick={() => onSelectHistoricalEdition(rev.id)}
                          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded border border-amber-700 bg-white hover:bg-amber-100 text-amber-950 font-semibold cursor-pointer"
                        >
                          <span>View corrected revision (r{rev.revisionNumber || 2})</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-bold text-amber-950 break-words">
                    Corrected edition (Revision r{correctionChain.revisionNumber})
                    {correctionChain.correctionDateLabel ? ` · ${correctionChain.correctionDateLabel}` : ''}
                  </div>
                  <p className="m-0 leading-relaxed text-amber-900 break-words">
                    {correctionChain.revisionNote
                      ? `Correction note: ${correctionChain.revisionNote} `
                      : 'This record is a versioned editorial correction superseding an earlier published edition. '}
                    <span className="font-medium">{correctionChain.editorialClarityNote}</span>
                  </p>
                  {correctionChain.originalEdition && (
                    <div className="pt-0.5">
                      {buildHistoricalPermalink ? (
                        <a
                          href={buildHistoricalPermalink(correctionChain.originalEdition.id)}
                          onClick={(e) => {
                            e.preventDefault();
                            onSelectHistoricalEdition(correctionChain.originalEdition!.id);
                          }}
                          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded border border-amber-700 bg-white hover:bg-amber-100 text-amber-950 font-semibold no-underline"
                        >
                          <span>View preserved original edition</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectHistoricalEdition(correctionChain.originalEdition!.id)}
                          className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-[32px] px-2.5 py-1 rounded border border-amber-700 bg-white hover:bg-amber-100 text-amber-950 font-semibold cursor-pointer"
                        >
                          <span>View preserved original edition</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* A. CLASSIFICATION OVERVIEW */}
      <section
        aria-label="Classification overview"
        className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-4 h-4 text-[#1f5fa8] shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-bold tracking-wide text-slate-900 m-0">
              A. Classification Overview
            </h4>
          </div>
          {currentView.carriedForward && (
            <span className="text-xs font-medium text-slate-600">
              Carried forward
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {/* Current classification */}
          <div className="bg-white border border-slate-200 rounded-md p-2.5 space-y-1 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">
              Current classification
            </div>
            <div className="flex items-center gap-2 font-bold text-slate-900 min-w-0">
              <span
                aria-hidden="true"
                className="w-3.5 h-3.5 rounded-xs border border-slate-400 shrink-0 inline-block"
                style={{ backgroundColor: currentView.hex }}
              />
              <span className="break-words">{currentView.classification}</span>
            </div>
            <div className="text-[11px] text-slate-600 break-words">{selectedPeriodLabel}</div>
          </div>

          {/* Previous published classification */}
          <div className="bg-white border border-slate-200 rounded-md p-2.5 space-y-1 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">
              Previous published classification
            </div>
            {previousView ? (
              <>
                <div className="flex items-center gap-2 font-semibold text-slate-900 min-w-0">
                  <span
                    aria-hidden="true"
                    className="w-3.5 h-3.5 rounded-xs border border-slate-400 shrink-0 inline-block"
                    style={{ backgroundColor: previousView.hex }}
                  />
                  <span className="break-words">{previousView.classification}</span>
                </div>
                <div className="text-[11px] text-slate-600 break-words">
                  {previousPeriodLabel || 'Prior edition'}
                  <span aria-hidden="true"> · </span>
                  {classificationChangedFromPrevious ? 'Changed' : 'Retained'}
                </div>
              </>
            ) : (
              <div className="text-slate-500 italic">No prior published edition</div>
            )}
          </div>
        </div>

        {/* Metadata row: Direction, Confidence, Last Substantive Review Date */}
        <div className="grid grid-cols-1 gap-1.5 text-xs text-slate-700 pt-1 min-w-0">
          <div className="break-words">
            <span className="font-semibold text-slate-900">Direction: </span>
            <span>{currentView.directionLabel}</span>
          </div>
          <div className="break-words">
            <span className="font-semibold text-slate-900">Confidence: </span>
            <span>{currentView.confidenceLabel}</span>
          </div>
          {publicationDateLabel && (
            <div className="flex items-start gap-1.5 break-words">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Edition publication date: </strong>
                {publicationDateLabel}
              </span>
            </div>
          )}
          {currentView.lastSubstantiveReviewDate && (
            <div className="flex items-start gap-1.5 break-words">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong className="text-slate-900">Last substantive state review: </strong>
                {formatDailyDateLabel(currentView.lastSubstantiveReviewDate)}
              </span>
            </div>
          )}
        </div>

        {/* Approved reason for changing or retaining classification */}
        <div className="bg-white border border-slate-200 rounded-md p-3 text-xs leading-relaxed min-w-0">
          <div className="font-semibold text-slate-900 mb-1">
            {classificationChangedFromPrevious
              ? 'Approved reason for classification change'
              : 'Approved basis for current classification'}
          </div>
          {hasApprovedChangeOrRetentionReason ? (
            <p className="text-slate-700 m-0 break-words">{approvedChangeOrRetentionReason}</p>
          ) : (
            <p className="text-slate-600 italic m-0 break-words">{currentView.keyFinding}</p>
          )}
        </div>
      </section>

      {/* B. SUPPORTING EVIDENCE */}
      <section
        aria-label="Supporting evidence"
        className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-4 h-4 text-[#1f5fa8] shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-bold tracking-wide text-slate-900 m-0">
              B. Supporting Evidence ({supportingEvidence.length})
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Research-approved public records
          </span>
        </div>

        {supportingEvidence.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-md p-3 text-xs text-slate-600 flex items-start gap-2 min-w-0">
            <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-slate-800 m-0 break-words">
                No approved public evidence records published for this edition.
              </p>
              <p className="text-slate-600 mt-1 mb-0 break-words">
                Only explicitly Research-approved public evidence records are displayed here. Unverified leads and internal monitoring notes remain private.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {supportingEvidence.map((ev) => (
              <article
                key={ev.id}
                className="bg-white border border-slate-200 rounded-md p-3 space-y-2 text-xs min-w-0 overflow-hidden"
              >
                <div className="space-y-1 min-w-0">
                  <h5 className="font-bold text-slate-900 text-sm leading-snug m-0 break-words">
                    {ev.title}
                  </h5>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800 break-words">
                      {ev.verificationStatus}
                    </span>
                    {ev.revisionNumber > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-indigo-800 font-semibold">
                          Revision {ev.revisionNumber}
                        </span>
                      </>
                    )}
                    {ev.sourceDateDisplay && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{ev.sourceDateDisplay}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Disputed claim explicit callout */}
                {ev.isDisputed && (
                  <div className="bg-amber-50 border border-amber-300 rounded-md px-3 py-2 text-xs text-amber-950 flex items-start gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-0.5 min-w-0">
                      <div className="font-bold text-amber-900">
                        Disputed claim — identified by Research
                      </div>
                      <p className="m-0 leading-snug break-words">
                        {ev.disputedClaimNote ||
                          'Key aspects of this account remain contested between parties or institutions.'}
                      </p>
                    </div>
                  </div>
                )}

                <p className="text-slate-700 leading-relaxed m-0 break-words">
                  {ev.publicDescription}
                </p>

                {/* Dated source & document reference */}
                <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5 text-xs text-slate-600 min-w-0">
                  <div className="break-words">
                    <span className="font-semibold text-slate-800">Source: </span>
                    <span>{ev.sourceName}</span>
                    {ev.sourceDateDisplay && (
                      <span className="text-slate-500 tabular-nums"> ({ev.sourceDateDisplay})</span>
                    )}
                  </div>

                  {ev.safeSourceUrl && (
                    <div className="min-w-0">
                      <a
                        href={ev.safeSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 min-h-[36px] py-1 text-[#1f5fa8] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8] break-all"
                      >
                        <span className="break-words">Open dated source link</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      </a>
                      <div className="text-[11px] font-mono text-slate-500 break-all">
                        {ev.safeSourceUrl}
                      </div>
                    </div>
                  )}

                  {ev.documentReference && (
                    <div className="text-slate-600 break-words">
                      <span className="font-semibold text-slate-800">Approved document ref: </span>
                      <span className="font-mono text-[11px] break-all">{ev.documentReference}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-slate-500 pt-0.5 break-all">
                    <span>ID: {ev.id}</span>
                    {ev.incidentId && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Incident: {ev.incidentId}</span>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* C. INSTITUTIONAL RESPONSE */}
      <section
        aria-label="Institutional response"
        className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Building2 className="w-4 h-4 text-[#1f5fa8] shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-bold tracking-wide text-slate-900 m-0">
              C. Institutional Response
            </h4>
          </div>
          <span className="text-[11px] font-medium text-slate-600">
            {institutionalResponse.rightOfResponseStatusLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2 text-xs">
          <div className="bg-white border border-slate-200 rounded-md p-2.5 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">
              Response requested
            </div>
            <div className="font-bold text-slate-900 mt-0.5">
              {formatBooleanStatus(institutionalResponse.requested)}
            </div>
            {institutionalResponse.requestedDateDisplay && (
              <div className="text-[11px] text-slate-500 tabular-nums">
                {institutionalResponse.requestedDateDisplay}
              </div>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-md p-2.5 min-w-0">
            <div className="text-[11px] font-semibold text-slate-500">
              Response received
            </div>
            <div className="font-bold text-slate-900 mt-0.5">
              {formatBooleanStatus(institutionalResponse.received)}
            </div>
            {institutionalResponse.responseDateDisplay && (
              <div className="text-[11px] text-slate-500 tabular-nums">
                {institutionalResponse.responseDateDisplay}
              </div>
            )}
          </div>
        </div>

        {institutionalResponse.responses.length > 0 ? (
          <div className="space-y-2">
            {institutionalResponse.responses.map((resp) => (
              <div
                key={resp.evidenceId}
                className="bg-white border border-slate-200 rounded-md p-3 text-xs space-y-1 min-w-0 overflow-hidden"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="font-bold text-slate-900 break-words">
                    {resp.respondentName || 'Institutional respondent'}
                  </span>
                  {resp.responseDateDisplay && (
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      Responded: {resp.responseDateDisplay}
                    </span>
                  )}
                </div>
                {resp.publicSummary ? (
                  <p className="text-slate-700 leading-relaxed m-0 break-words">
                    {resp.publicSummary}
                  </p>
                ) : (
                  <p className="text-slate-500 italic m-0 break-words">
                    {resp.received
                      ? 'Response received; no approved public summary recorded.'
                      : 'Institutional response requested; no response received yet.'}
                  </p>
                )}
                <div className="text-[11px] text-slate-500 break-words">
                  Related record: {resp.evidenceTitle}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600 italic m-0 break-words">
            No approved public institutional response summary is recorded for this edition.
          </p>
        )}
      </section>

      {/* D. INCIDENT HISTORY */}
      <section
        aria-label="Incident history"
        className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <GitBranch className="w-4 h-4 text-[#1f5fa8] shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-bold tracking-wide text-slate-900 m-0">
              D. Incident History ({incidents.length})
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Chronological log
          </span>
        </div>

        {incidents.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-md p-3 text-xs text-slate-600 flex items-start gap-2 min-w-0">
            <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="m-0 break-words">
              No Research-approved public incident histories are recorded for {panelData.stateName} as of this edition.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {incidents.map((inc) => (
              <article
                key={inc.id}
                className="bg-white border border-slate-200 rounded-md p-3 space-y-2.5 text-xs min-w-0 overflow-hidden"
              >
                <div className="space-y-1 min-w-0">
                  <h5 className="font-bold text-slate-900 text-sm leading-snug m-0 break-words">
                    {inc.title}
                  </h5>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                    <span className="font-mono text-slate-500 break-all">ID: {inc.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-slate-800 break-words">
                      {inc.researchStatusLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">First reported: {inc.firstReportedDateDisplay}</span>
                    {inc.revisionNumber > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Rev {inc.revisionNumber}</span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-700 leading-relaxed m-0 break-words">{inc.summary}</p>
                </div>

                {/* Chronological developments under this Incident ID */}
                <div className="pt-2.5 border-t border-slate-100 min-w-0">
                  <div className="text-[11px] font-bold text-slate-700 mb-2">
                    Developments ({inc.developments.length})
                  </div>

                  {inc.developments.length === 0 ? (
                    <p className="text-xs text-slate-500 italic m-0 break-words">
                      No approved public follow-up developments published for this incident as of this edition.
                    </p>
                  ) : (
                    <ol className="space-y-3 list-none p-0 m-0 divide-y divide-slate-100">
                      {inc.developments.map((dev) => (
                        <li key={dev.id} className="pt-2.5 first:pt-0 space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                            <span className="font-mono font-bold text-slate-900 tabular-nums">
                              {dev.developmentDateDisplay}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">·</span>
                            <span className="font-semibold text-slate-700 break-words">
                              {dev.researchStatusLabel}
                            </span>
                            {dev.isRemedyOrFollowUp && (
                              <>
                                <span aria-hidden="true" className="text-slate-400">·</span>
                                <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                                  <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  Remedy / Follow-up
                                </span>
                              </>
                            )}
                          </div>
                          <div className="font-semibold text-slate-900 break-words">{dev.title}</div>
                          <p className="text-slate-700 leading-relaxed m-0 break-words">
                            {dev.approvedDescription}
                          </p>

                          {dev.sourceReferences.length > 0 && (
                            <div className="flex flex-col gap-1 pt-1 min-w-0">
                              {dev.sourceReferences.map((src, sIdx) => (
                                <div
                                  key={`${dev.id}-src-${sIdx}`}
                                  className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0 break-words"
                                >
                                  <span className="font-medium text-slate-800 break-words">
                                    {src.sourceName}
                                  </span>
                                  {src.dateDisplay && (
                                    <span className="text-slate-500 tabular-nums">({src.dateDisplay})</span>
                                  )}
                                  {src.safeUrl && (
                                    <a
                                      href={src.safeUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 min-h-[32px] text-[#1f5fa8] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8] break-all"
                                    >
                                      <span>Open source</span>
                                      <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                                    </a>
                                  )}
                                  {src.documentReference && (
                                    <span className="font-mono text-[11px] text-slate-500 break-all">
                                      Ref: {src.documentReference}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* E. HISTORICAL INFORMATION */}
      <section
        aria-label="Historical assessments"
        className="bg-slate-50 border border-slate-200 rounded-lg p-3 sm:p-4 space-y-3 min-w-0 overflow-hidden"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-slate-200 pb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <History className="w-4 h-4 text-[#1f5fa8] shrink-0" aria-hidden="true" />
            <h4 className="text-xs font-bold tracking-wide text-slate-900 m-0">
              E. Historical Assessments ({historicalEditions.length})
            </h4>
          </div>
          <span className="text-[11px] text-slate-500">
            Preserved editions
          </span>
        </div>

        <div className="space-y-2.5">
          {visibleHistory.map((ed) => (
            <div
              key={ed.publicationId}
              className={`rounded-md border p-3 text-xs space-y-2 transition-colors min-w-0 overflow-hidden ${
                ed.isSelected
                  ? 'bg-blue-50/70 border-[#1f5fa8]'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                <div className="space-y-1 min-w-0">
                  <div className="font-bold text-slate-900 break-words">
                    {ed.reportingPeriodLabel}
                    {ed.isDaily && (
                      <span className="ml-1.5 font-mono text-[11px] font-semibold text-indigo-700">
                        · Daily
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                    <span
                      aria-hidden="true"
                      className="w-3 h-3 rounded-xs border border-slate-400 inline-block shrink-0"
                      style={{ backgroundColor: ed.hex }}
                    />
                    <span className="break-words">{ed.classification}</span>
                  </div>
                </div>

                {ed.isSelected ? (
                  <span className="self-start sm:self-auto shrink-0 text-xs font-semibold text-[#1f5fa8]">
                    Currently viewing
                  </span>
                ) : buildHistoricalPermalink ? (
                  <a
                    href={buildHistoricalPermalink(ed.publicationId)}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectHistoricalEdition(ed.publicationId);
                    }}
                    className="w-full sm:w-auto shrink-0 min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center px-3 py-2 sm:py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#1f5fa8] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                  >
                    View edition
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectHistoricalEdition(ed.publicationId)}
                    className="w-full sm:w-auto shrink-0 min-h-[44px] sm:min-h-[36px] px-3 py-2 sm:py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-[#1f5fa8] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                  >
                    View edition
                  </button>
                )}
              </div>

              <div className="text-[11px] text-slate-600 break-words">
                <span>
                  Published evidence records:{' '}
                  <strong className="tabular-nums">{ed.publishedEvidenceCount}</strong>
                </span>
                {ed.evidenceTitles.length > 0 && (
                  <span className="text-slate-500">
                    {' '}· {ed.evidenceTitles.slice(0, 2).join('; ')}
                    {ed.evidenceTitles.length > 2 ? ` (+${ed.evidenceTitles.length - 2} more)` : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {historicalEditions.length > 5 && (
          <button
            type="button"
            onClick={() => setShowAllHistory((prev) => !prev)}
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
          >
            {showAllHistory ? (
              <>
                <ChevronUp className="w-4 h-4" aria-hidden="true" />
                <span>Show fewer editions</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                <span>Show all {historicalEditions.length} published editions</span>
              </>
            )}
          </button>
        )}
      </section>
    </div>
  );
};
