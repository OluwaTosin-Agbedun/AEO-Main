import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Calendar,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  Link2,
  Search
} from 'lucide-react';
import { DcmPublication } from '../types/dcm';
import {
  buildAbsoluteDcmPermalink,
  buildDcmArchiveIndex,
  buildDcmPermalinkUrl,
  lookupArchiveByDate,
  resolveBiMonthlyComparisonPoints
} from '../utils/dcmArchive';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const PAGE_SIZE = 12;

export interface DcmArchiveSectionProps {
  /** Strictly published canonical publications (ascending) */
  publishedPublications: DcmPublication[];
  /** Currently active publication ID */
  activePublicationId: string;
  /** Currently active publication year & month (used as initial archive view) */
  activeYear: number;
  activeMonth: number;
  /** Currently selected state name on the map/panel, if any */
  selectedStateName: string | null;
  /** Opens a specific immutable publication (optionally keeping/setting state) and syncs permalink URL */
  onSelectArchiveEdition: (publicationId: string, stateName?: string | null) => void;
  /** Optional on-demand month loader to query Firestore for older archive months */
  onLoadArchiveMonth?: (year: number, month: number) => Promise<DcmPublication[]>;
}

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }
  } catch {
    // Ignore
  }
  return false;
}

export const DcmArchiveSection: React.FC<DcmArchiveSectionProps> = ({
  publishedPublications,
  activePublicationId,
  activeYear,
  activeMonth,
  selectedStateName,
  onSelectArchiveEdition,
  onLoadArchiveMonth
}) => {
  const [filterYear, setFilterYear] = useState<number>(activeYear);
  const [filterMonth, setFilterMonth] = useState<number | 'all'>(activeMonth);
  const [dateLookupInput, setDateLookupInput] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingMonth, setLoadingMonth] = useState<boolean>(false);

  // Build full index for available years/months and filtered entries
  const archiveIndex = useMemo(
    () =>
      buildDcmArchiveIndex(publishedPublications, {
        year: filterYear,
        month: filterMonth === 'all' ? null : filterMonth,
        stateName: selectedStateName
      }),
    [publishedPublications, filterYear, filterMonth, selectedStateName]
  );

  // Keep filterYear valid when published data loads
  useEffect(() => {
    if (archiveIndex.years.length > 0 && !archiveIndex.years.includes(filterYear)) {
      setFilterYear(archiveIndex.years[0]);
    }
  }, [archiveIndex.years, filterYear]);

  // Reset pagination when filter changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterYear, filterMonth]);

  // Trigger on-demand date-scoped Firestore load when visitor browses a specific month
  useEffect(() => {
    if (!onLoadArchiveMonth || filterMonth === 'all') return;
    let active = true;
    setLoadingMonth(true);
    onLoadArchiveMonth(filterYear, filterMonth)
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingMonth(false);
      });
    return () => {
      active = false;
    };
  }, [filterYear, filterMonth, onLoadArchiveMonth]);

  const comparisonMonth = useMemo(() => {
    if (filterMonth !== 'all') return filterMonth;
    const monthsInYear = archiveIndex.monthsByYear[filterYear] || [];
    return monthsInYear[0] || activeMonth || 1;
  }, [filterMonth, archiveIndex.monthsByYear, filterYear, activeMonth]);

  const comparisonPoints = useMemo(
    () =>
      resolveBiMonthlyComparisonPoints(
        publishedPublications,
        filterYear,
        comparisonMonth,
        selectedStateName
      ),
    [publishedPublications, filterYear, comparisonMonth, selectedStateName]
  );

  const dateLookupResult = useMemo(() => {
    if (!dateLookupInput.trim()) return null;
    return lookupArchiveByDate(publishedPublications, dateLookupInput.trim(), selectedStateName);
  }, [publishedPublications, dateLookupInput, selectedStateName]);

  const visibleEntries = archiveIndex.entries.slice(0, visibleCount);
  const hasMore = archiveIndex.entries.length > visibleCount;

  const handleCopyLink = async (pub: DcmPublication, keyId: string, stateForLink?: string | null) => {
    const absUrl = buildAbsoluteDcmPermalink({
      publication: pub,
      stateName: stateForLink ?? selectedStateName
    });
    const ok = await copyTextSafe(absUrl);
    if (ok) {
      setCopiedId(keyId);
      setTimeout(() => {
        setCopiedId((cur) => (cur === keyId ? null : cur));
      }, 2400);
    }
  };

  const pubById = useMemo(() => {
    const map = new Map<string, DcmPublication>();
    for (const p of publishedPublications) map.set(p.id, p);
    return map;
  }, [publishedPublications]);

  return (
    <section
      id="dcm-archive-section"
      aria-label="DCM Daily and Historical Publication Archive"
      className="bg-white border border-[#d5d9de] rounded-md p-4 sm:p-6 flex flex-col gap-5 min-w-0 scroll-mt-6"
    >
      {/* Archive Header */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 text-[#1f5fa8]">
          <Archive className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-xs font-mono font-bold uppercase tracking-wider">
            Immutable Published Archive
          </span>
        </div>
        <h2 className="m-0 text-xl sm:text-2xl font-bold text-[#1c232b] leading-snug">
          Daily &amp; Historical DCM Archive
        </h2>
        <p className="m-0 text-sm text-[#3d4752] leading-relaxed">
          Browse approved daily DCM publications and earlier twice-monthly reporting periods. Every published edition has a permanent link that preserves its original snapshot.
        </p>
      </div>

      {/* Controls: Year, Month & Specific Date Lookup */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-md p-3.5 min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="dcm-archive-year" className="text-xs font-semibold text-[#1c232b]">
            Archive year
          </label>
          <select
            id="dcm-archive-year"
            value={filterYear}
            onChange={(e) => setFilterYear(Number(e.target.value))}
            className="w-full min-h-[44px] px-3 py-2 text-sm border border-[#8a939c] rounded bg-white text-[#1c232b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
          >
            {(archiveIndex.years.length > 0 ? archiveIndex.years : [activeYear]).map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="dcm-archive-month" className="text-xs font-semibold text-[#1c232b]">
            Archive month
          </label>
          <select
            id="dcm-archive-month"
            value={filterMonth}
            onChange={(e) =>
              setFilterMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            className="w-full min-h-[44px] px-3 py-2 text-sm border border-[#8a939c] rounded bg-white text-[#1c232b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
          >
            <option value="all">All months in {filterYear}</option>
            {MONTH_NAMES.map((name, idx) => {
              const mNum = idx + 1;
              const hasLocal = (archiveIndex.monthsByYear[filterYear] || []).includes(mNum);
              return (
                <option key={name} value={mNum}>
                  {name}{hasLocal ? '' : ' (check archive)'}
                </option>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="dcm-archive-date-lookup" className="text-xs font-semibold text-[#1c232b]">
            Check specific date
          </label>
          <div className="relative flex items-center min-w-0">
            <input
              id="dcm-archive-date-lookup"
              type="date"
              value={dateLookupInput}
              onChange={(e) => setDateLookupInput(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm border border-[#8a939c] rounded bg-white text-[#1c232b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
            />
            {dateLookupInput && (
              <button
                type="button"
                onClick={() => setDateLookupInput('')}
                aria-label="Clear date lookup"
                className="ml-1.5 min-w-[36px] min-h-[44px] px-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-300 rounded cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Specific Date Lookup Result (Transparent unavailable notice when no approved publication exists) */}
      {dateLookupResult && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border p-3.5 text-sm min-w-0 space-y-2 ${
            dateLookupResult.matchedPublication
              ? 'bg-blue-50/70 border-blue-200 text-slate-900'
              : 'bg-slate-50 border-slate-300 text-slate-800'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            <Search className="w-4 h-4 text-[#1f5fa8] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="m-0 font-semibold break-words">{dateLookupResult.message}</p>
              {dateLookupResult.matchedPublication && dateLookupResult.matchedPermalink && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <a
                    href={dateLookupResult.matchedPermalink}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectArchiveEdition(
                        dateLookupResult.matchedPublication!.id,
                        selectedStateName
                      );
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded bg-[#1f5fa8] hover:bg-[#174880] text-white text-xs font-semibold no-underline"
                  >
                    Open published snapshot
                  </a>
                </div>
              )}
              {!dateLookupResult.matchedPublication &&
                dateLookupResult.mostRecentEarlierPublication &&
                dateLookupResult.mostRecentEarlierLabel && (
                  <div className="text-xs text-[#3d4752] space-y-1.5 pt-1 border-t border-slate-200">
                    <p className="m-0 break-words">
                      <strong>Most recent earlier published edition</strong> (not published on{' '}
                      {dateLookupResult.requestedDateLabel}):{' '}
                      {dateLookupResult.mostRecentEarlierLabel}
                    </p>
                    <a
                      href={buildDcmPermalinkUrl({
                        publication: dateLookupResult.mostRecentEarlierPublication,
                        stateName: selectedStateName
                      })}
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectArchiveEdition(
                          dateLookupResult.mostRecentEarlierPublication!.id,
                          selectedStateName
                        );
                      }}
                      className="inline-flex items-center gap-1 text-[#1f5fa8] font-semibold hover:underline"
                    >
                      View earlier published edition ({dateLookupResult.mostRecentEarlierLabel}) →
                    </a>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* Twice-Monthly Comparison Reference Points (15th & Month-End) */}
      <div className="space-y-2.5 min-w-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="m-0 text-sm font-bold text-[#1c232b] uppercase tracking-wider font-mono">
            Twice-Monthly Comparison Points — {MONTH_NAMES[comparisonMonth - 1]} {filterYear}
          </h3>
          <span className="text-xs text-[#3d4752]">
            15th &amp; month-end historical comparison benchmarks
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
          {comparisonPoints.map((pt) => {
            const isExact = pt.status === 'exact_published';
            const isPrior = pt.status === 'prior_published_reference';
            const isActivePt = Boolean(pt.publication && pt.publication.id === activePublicationId);

            return (
              <div
                key={pt.targetDateIso}
                className={`rounded-md border p-3.5 flex flex-col justify-between gap-2.5 min-w-0 ${
                  isActivePt
                    ? 'border-[#1f5fa8] bg-blue-50/40'
                    : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-mono font-bold text-[#1c232b] uppercase">
                      {pt.kind === 'mid-month' ? '15th of Month' : 'Month-End'} · {pt.targetDateLabel}
                    </span>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                        isExact
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : isPrior
                          ? 'bg-amber-50 text-amber-900 border-amber-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {isExact
                        ? 'Exact published snapshot'
                        : isPrior
                        ? 'Prior published reference'
                        : 'Unavailable'}
                    </span>
                  </div>
                  <p className="m-0 text-xs text-[#3d4752] leading-relaxed break-words">
                    {pt.statusLabel}
                  </p>
                </div>

                {pt.publication && pt.permalink && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={pt.permalink}
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectArchiveEdition(pt.publication!.id, selectedStateName);
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded border border-[#1f5fa8] bg-white hover:bg-blue-50 text-xs font-semibold text-[#1f5fa8] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                    >
                      <Calendar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {isExact ? 'Open snapshot' : 'Open earlier published edition'}
                      </span>
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Published Archive Entries List */}
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 pb-2">
          <h3 className="m-0 text-sm font-bold text-[#1c232b]">
            Published Editions ({archiveIndex.entries.length})
          </h3>
          {loadingMonth && (
            <span className="text-xs text-slate-500">Checking archive records…</span>
          )}
        </div>

        {visibleEntries.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-[#3d4752]">
            No approved DCM publications exist for{' '}
            {filterMonth === 'all'
              ? `${filterYear}`
              : `${MONTH_NAMES[filterMonth - 1]} ${filterYear}`}
            . Unpublished drafts are never shown in the public archive.
          </div>
        ) : (
          <ol className="m-0 p-0 list-none flex flex-col gap-3 min-w-0">
            {visibleEntries.map((entry) => {
              const isSelected = entry.id === activePublicationId;
              const rawPub = pubById.get(entry.id);
              const editionOnlyPermalink = rawPub
                ? buildDcmPermalinkUrl({ publication: rawPub, stateName: null })
                : entry.permalink;
              const stateSpecificPermalink =
                rawPub && selectedStateName
                  ? buildDcmPermalinkUrl({ publication: rawPub, stateName: selectedStateName })
                  : null;

              return (
                <li
                  key={entry.id}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`rounded-md border p-3.5 sm:p-4 flex flex-col gap-2.5 min-w-0 transition-colors ${
                    isSelected
                      ? 'border-[#1f5fa8] bg-blue-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold text-sm sm:text-base text-[#1c232b] break-words">
                          {entry.periodLabel}
                        </span>
                        <span className="text-[11px] font-mono font-semibold text-slate-600 uppercase">
                          {entry.isDaily ? 'Daily update' : 'Twice-monthly edition'}
                        </span>
                        {isSelected && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#1f5fa8] text-white">
                            Currently viewing
                          </span>
                        )}
                        {entry.isQuietDay && (
                          <span className="text-[11px] font-medium text-slate-600">
                            · Quiet-day update
                          </span>
                        )}
                        {entry.isCorrectedVersion && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            <GitBranch className="w-3 h-3" aria-hidden="true" />
                            Correction r{entry.revisionNumber}
                          </span>
                        )}
                        {entry.hasSubsequentCorrection && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            Subsequent correction published
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#3d4752] tabular-nums">
                        <span>
                          <strong>Published:</strong> {entry.publicationDateLabel}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="font-mono text-[11px] text-slate-500 break-all">
                          ID: {entry.id}
                        </span>
                      </div>
                    </div>
                  </div>

                  {entry.hasApprovedSummary ? (
                    <p className="m-0 text-xs sm:text-sm text-[#3d4752] leading-relaxed break-words line-clamp-3">
                      {entry.summaryPreview}
                    </p>
                  ) : (
                    <p className="m-0 text-xs italic text-slate-500">
                      No Research-approved summary text recorded for this edition.
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 min-w-0">
                    <a
                      href={editionOnlyPermalink}
                      onClick={(e) => {
                        e.preventDefault();
                        onSelectArchiveEdition(entry.id, selectedStateName);
                      }}
                      className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded text-xs font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8] ${
                        isSelected
                          ? 'bg-slate-800 text-white'
                          : 'bg-[#1f5fa8] hover:bg-[#174880] text-white'
                      }`}
                    >
                      <Link2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{isSelected ? 'Viewing edition' : 'Open published edition'}</span>
                    </a>

                    {stateSpecificPermalink && selectedStateName && (
                      <a
                        href={stateSpecificPermalink}
                        onClick={(e) => {
                          e.preventDefault();
                          onSelectArchiveEdition(entry.id, selectedStateName);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#1c232b] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                      >
                        <span>{selectedStateName} snapshot</span>
                      </a>
                    )}

                    {rawPub && (
                      <button
                        type="button"
                        onClick={() => handleCopyLink(rawPub, entry.id, selectedStateName)}
                        className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
                      >
                        {copiedId === entry.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                            <span className="text-emerald-800">Permalink copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>Copy link</span>
                          </>
                        )}
                      </button>
                    )}

                    {entry.completeRecordUrl && (
                      <a
                        href={entry.completeRecordUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] px-2 text-xs font-semibold text-[#1f5fa8] hover:underline"
                      >
                        <span>Full record</span>
                        <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="w-full sm:w-auto self-start min-h-[44px] px-4 py-2 rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-[#1c232b] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f5fa8]"
          >
            Load more archived editions ({archiveIndex.entries.length - visibleCount} remaining)
          </button>
        )}
      </div>
    </section>
  );
};

export default DcmArchiveSection;
