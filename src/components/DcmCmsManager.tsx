import React, { useState, useMemo, useRef } from 'react';
import { 
  Award, Plus, Trash2, Edit3, CheckCircle2, AlertCircle, 
  Download, UploadCloud, Eye, Save, X, RotateCcw, 
  Check, Filter, ShieldCheck, Sparkles, Layers, FileSpreadsheet,
  AlertTriangle, Calendar, Info, Clock, Lock, Copy, FileCheck2, Send,
  FileText, GitBranch, Newspaper
} from 'lucide-react';
import { useCMS } from '../context/CMSContext';
import { auth } from '../lib/firebase';
import { 
  DcmPublication, 
  DcmClassification, 
  DcmStateRecord, 
  RightOfResponseStatus,
  NIGERIA_37_JURISDICTIONS, 
  DCM_CLASSIFICATIONS, 
  DCM_DIRECTIONS,
  DCM_CONFIDENCE_LEVELS,
  RIGHT_OF_RESPONSE_OPTIONS,
  DCM_COLORS,
  MONTH_NAMES
} from '../types/dcm';
import { DcmMap } from './DcmMap';
import { INITIAL_DCM_PUBLICATIONS } from '../data/dcmInitialData';
import { getLatestDcmPublication, getPublishedDcmSorted } from '../utils/dcmComparison';
import {
  WAT_LABEL,
  buildDailyPublicationId,
  carryForwardClassifications,
  createBlank37Classifications,
  createCorrectionDraft,
  createDailyDraft,
  diffClassificationsAgainstSource,
  formatDailyDateLabel,
  formatTimestampInWat,
  formatWatCutoff,
  isDailyPublication,
  parseIsoDate,
  validateDailyPublication,
  validateLegacyPublication
} from '../utils/dcmDaily';
import { auditPublicationConsistency } from '../utils/dcmConsistency';
import { DcmEvidenceCmsManager } from './DcmEvidenceCmsManager';
import { DcmEditorialPublishingManager } from './DcmEditorialPublishingManager';

function createBlank37Jurisdictions(): Record<string, DcmStateRecord> {
  return createBlank37Classifications();
}

export const DcmCmsManager: React.FC = () => {
  const {
    dcmPublications,
    saveDcmPublication,
    deleteDcmPublication,
    saveDailyDcmPublication,
    deleteDailyDcmPublication,
    dcmEvidence,
    dcmIncidents,
    dcmEditorialHandovers
  } = useCMS();

  const publications = useMemo(() => {
    if (dcmPublications && dcmPublications.length > 0) return dcmPublications;
    return INITIAL_DCM_PUBLICATIONS;
  }, [dcmPublications]);

  const publishedSourceOptions = useMemo(() => {
    // Newest published editions first (both legacy and daily) for carry-forward selection
    return [...getPublishedDcmSorted(publications)].reverse();
  }, [publications]);

  const [dcmSectionTab, setDcmSectionTab] = useState<'publications' | 'evidence' | 'incidents' | 'editorial'>('publications');
  const [formatFilter, setFormatFilter] = useState<'all' | 'daily' | 'legacy'>('all');
  const [editingPub, setEditingPub] = useState<Partial<DcmPublication> | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);
  const [classifications, setClassifications] = useState<Record<string, DcmStateRecord>>({});
  const [searchState, setSearchState] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [showLivePreview, setShowLivePreview] = useState(false);
  const [previewSelectedCode, setPreviewSelectedCode] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [approverName, setApproverName] = useState<string>('');
  const [approvalReference, setApprovalReference] = useState<string>('');
  const [approvalConfirmed, setApprovalConfirmed] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainListFileInputRef = useRef<HTMLInputElement>(null);
  const [showCsvGuide, setShowCsvGuide] = useState<boolean>(false);

  const isEditingDaily = isDailyPublication(editingPub);
  const existingRecord = useMemo(() => {
    if (!editingExistingId) return null;
    return publications.find((p) => p.id === editingExistingId) || null;
  }, [editingExistingId, publications]);

  const isReadOnlyPublishedDaily = Boolean(
    existingRecord && existingRecord.status === 'published'
  );

  const carryForwardSourcePub = useMemo(() => {
    if (!editingPub?.carriedForwardFromPublicationId) return null;
    return publications.find((p) => p.id === editingPub.carriedForwardFromPublicationId) || null;
  }, [editingPub?.carriedForwardFromPublicationId, publications]);

  const dailyDiff = useMemo(() => {
    if (!isEditingDaily) return null;
    return diffClassificationsAgainstSource(classifications, carryForwardSourcePub);
  }, [isEditingDaily, classifications, carryForwardSourcePub]);

  const liveConsistencyAudit = useMemo(() => {
    if (!editingPub) return null;
    const candidate: DcmPublication = {
      id: editingPub.id || 'draft-preview',
      publicationFormat: isEditingDaily ? 'daily' : 'legacy-period',
      title: editingPub.title || '',
      year: Number(editingPub.year) || 2026,
      month: Number(editingPub.month) || 1,
      periodIndex: Number(editingPub.periodIndex) || 1,
      periodStart: editingPub.assessmentDate || editingPub.periodStart || '',
      periodEnd: editingPub.assessmentDate || editingPub.periodEnd || '',
      reportingPeriodLabel: editingPub.reportingPeriodLabel || '',
      publicationDate: editingPub.publicationDate || '',
      evidenceCutoffDate: editingPub.evidenceCutoffDate || '',
      assessmentDate: editingPub.assessmentDate,
      evidenceCutoffTimeWat: editingPub.evidenceCutoffTimeWat,
      evidenceCutoffDateTimeWat: editingPub.evidenceCutoffDateTimeWat,
      isQuietDay: Boolean(editingPub.isQuietDay),
      carriedForwardAllStates: Boolean(editingPub.carriedForwardAllStates),
      carriedForwardFromPublicationId: editingPub.carriedForwardFromPublicationId,
      methodologyVersion: editingPub.methodologyVersion || 'Version 1.1',
      status: (editingPub.status as any) || 'draft',
      isLatest: Boolean(editingPub.isLatest),
      summary: editingPub.summary || '',
      classifications,
      createdAt: editingPub.createdAt || 0,
      updatedAt: editingPub.updatedAt || 0
    };
    return auditPublicationConsistency(candidate, carryForwardSourcePub);
  }, [editingPub, isEditingDaily, classifications, carryForwardSourcePub]);

  const dailyWatPreview = useMemo(() => {
    if (!isEditingDaily) return null;
    return formatWatCutoff(
      editingPub?.assessmentDate || '',
      editingPub?.evidenceCutoffTimeWat || ''
    );
  }, [isEditingDaily, editingPub?.assessmentDate, editingPub?.evidenceCutoffTimeWat]);

  const filteredPublicationsList = useMemo(() => {
    return publications.filter((pub) => {
      const daily = isDailyPublication(pub);
      if (formatFilter === 'daily') return daily;
      if (formatFilter === 'legacy') return !daily;
      return true;
    });
  }, [publications, formatFilter]);

  const dailyCount = useMemo(
    () => publications.filter((p) => isDailyPublication(p)).length,
    [publications]
  );
  const legacyCount = publications.length - dailyCount;

  const showStatus = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 6000);
  };

  // Start new DAILY DCM publication (carries forward all 37 previously approved classifications verbatim)
  const handleStartNewDaily = (opts?: { isQuietDay?: boolean; sourcePub?: DcmPublication | null }) => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const sourcePub =
      opts?.sourcePub !== undefined
        ? opts.sourcePub
        : getLatestDcmPublication(publications) || publishedSourceOptions[0] || null;

    const draft = createDailyDraft({
      assessmentDate: todayIso,
      cutoffTimeWat: '17:00',
      sourcePub,
      existingIds: publications.map((p) => p.id),
      isQuietDay: Boolean(opts?.isQuietDay),
      createdByUid: auth.currentUser?.uid
    });

    setEditingPub(draft);
    setEditingExistingId(null);
    setClassifications(draft.classifications);
    setApproverName('');
    setApprovalReference('');
    setApprovalConfirmed(false);
    setValidationErrors([]);
    setShowLivePreview(false);

    if (sourcePub) {
      showStatus(
        opts?.isQuietDay
          ? `Quiet-day daily draft initialized from "${sourcePub.reportingPeriodLabel}". All 37 approved classifications are retained without change. Enter the Research-approved quiet-day statement and WAT cut-off time.`
          : `Daily draft initialized from "${sourcePub.reportingPeriodLabel}". All 37 approved classifications have been carried forward unchanged.`
      );
    }
  };

  // Start new legacy reporting-period publication
  const handleStartNew = () => {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const isP1 = now.getDate() <= 15;

    const newId = `dcm-${curYear}-${String(curMonth).padStart(2, '0')}-${isP1 ? '15' : 'end'}`;
    const periodLabel = isP1 
      ? `1st – 15th ${MONTH_NAMES[curMonth - 1]} ${curYear}`
      : `16th – ${new Date(curYear, curMonth, 0).getDate()}th ${MONTH_NAMES[curMonth - 1]} ${curYear}`;

    setEditingPub({
      id: newId,
      publicationFormat: 'legacy-period',
      title: `Democratic Competitiveness Map: ${periodLabel}`,
      year: curYear,
      month: curMonth,
      periodIndex: isP1 ? 1 : 2,
      periodStart: isP1 ? `${curYear}-${String(curMonth).padStart(2, '0')}-01` : `${curYear}-${String(curMonth).padStart(2, '0')}-16`,
      periodEnd: isP1 ? `${curYear}-${String(curMonth).padStart(2, '0')}-15` : `${curYear}-${String(curMonth).padStart(2, '0')}-${new Date(curYear, curMonth, 0).getDate()}`,
      reportingPeriodLabel: periodLabel,
      publicationDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      evidenceCutoffDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      methodologyVersion: 'Version 1.1',
      revisionNote: '',
      status: 'draft',
      isLatest: false,
      summary: '',
      changesSummary: '',
      supportingDocumentUrl: ''
    });

    setEditingExistingId(null);
    setClassifications(createBlank37Jurisdictions());
    setApproverName('');
    setApprovalReference('');
    setApprovalConfirmed(false);
    setValidationErrors([]);
    setShowLivePreview(false);
  };

  // Issue a new versioned correction draft for a published edition (preserves previous published version intact)
  const handleCreateCorrectionRevision = (publishedPub: DcmPublication) => {
    const draft = createCorrectionDraft(
      publishedPub,
      publications.map((p) => p.id),
      auth.currentUser?.uid
    );
    setEditingPub(draft);
    setEditingExistingId(null);
    setClassifications(draft.classifications);
    setApproverName('');
    setApprovalReference('');
    setApprovalConfirmed(false);
    setValidationErrors([]);
    setShowLivePreview(false);
    showStatus(
      `Created corrected revision draft "${draft.id}" superseding "${publishedPub.id}". The previously published edition remains preserved and unchanged.`
    );
  };

  // Start editing or viewing existing publication
  const handleEdit = (pub: DcmPublication) => {
    setEditingPub({ ...pub });
    setEditingExistingId(pub.id);
    const map = { ...createBlank37Jurisdictions() };
    if (pub.classifications) {
      for (const [code, rec] of Object.entries(pub.classifications)) {
        if (map[code]) {
          map[code] = { ...map[code], ...rec };
        }
      }
    }
    setClassifications(map);
    setApproverName(pub.approvalRecord?.approvedByName || '');
    setApprovalReference(pub.approvalRecord?.approvalReference || '');
    setApprovalConfirmed(Boolean(pub.approvalRecord?.approved));
    setValidationErrors([]);
    setShowLivePreview(false);
  };

  // Cancel edit
  const handleCancel = () => {
    setEditingPub(null);
    setEditingExistingId(null);
    setClassifications({});
    setApproverName('');
    setApprovalReference('');
    setApprovalConfirmed(false);
    setValidationErrors([]);
    setShowLivePreview(false);
  };

  // Daily assessment date change: syncs ID (for unsaved drafts), reporting label, period dates, and WAT cut-off
  const handleDailyAssessmentDateChange = (nextDate: string) => {
    if (isReadOnlyPublishedDaily) return;
    const parsed = parseIsoDate(nextDate);
    setEditingPub((prev) => {
      if (!prev) return prev;
      const cutoffTime = prev.evidenceCutoffTimeWat || '17:00';
      const wat = formatWatCutoff(nextDate, cutoffTime);
      const label = parsed ? formatDailyDateLabel(nextDate) : prev.reportingPeriodLabel || '';
      const nextId = editingExistingId
        ? prev.id
        : buildDailyPublicationId(nextDate, publications.map((p) => p.id));

      return {
        ...prev,
        id: nextId,
        assessmentDate: nextDate,
        year: parsed ? parsed.year : prev.year,
        month: parsed ? parsed.month : prev.month,
        periodIndex: parsed ? (parsed.day <= 15 ? 1 : 2) : prev.periodIndex,
        periodStart: nextDate,
        periodEnd: nextDate,
        reportingPeriodLabel: label,
        publicationDate: label,
        title: parsed ? `Democratic Competitiveness Map — Daily Update: ${label}` : prev.title,
        evidenceCutoffDate: wat.valid ? wat.displayLabel : prev.evidenceCutoffDate,
        evidenceCutoffDateTimeWat: wat.valid ? wat.isoWat : ''
      };
    });
  };

  // Daily WAT cut-off time change
  const handleDailyCutoffTimeChange = (nextTime: string) => {
    if (isReadOnlyPublishedDaily) return;
    setEditingPub((prev) => {
      if (!prev) return prev;
      const wat = formatWatCutoff(prev.assessmentDate || '', nextTime);
      return {
        ...prev,
        evidenceCutoffTimeWat: nextTime,
        evidenceCutoffDate: wat.valid ? wat.displayLabel : prev.evidenceCutoffDate,
        evidenceCutoffDateTimeWat: wat.valid ? wat.isoWat : ''
      };
    });
  };

  // Re-apply carried-forward classifications from a selected approved edition
  const handleApplyCarryForwardSource = (sourceId: string) => {
    if (isReadOnlyPublishedDaily) return;
    const sourcePub = publications.find((p) => p.id === sourceId);
    if (!sourcePub) return;
    const carried = carryForwardClassifications(sourcePub);
    setClassifications(carried);
    setEditingPub((prev) =>
      prev
        ? {
            ...prev,
            carriedForwardAllStates: true,
            carriedForwardFromPublicationId: sourcePub.id
          }
        : prev
    );
    showStatus(
      `Carried forward all 37 approved classifications from "${sourcePub.reportingPeriodLabel}" without modification.`
    );
  };

  // Toggle Quiet-Day Update mode
  const handleToggleQuietDay = (checked: boolean) => {
    if (isReadOnlyPublishedDaily) return;
    if (checked && carryForwardSourcePub) {
      const carried = carryForwardClassifications(carryForwardSourcePub);
      setClassifications(carried);
      setEditingPub((prev) =>
        prev
          ? {
              ...prev,
              isQuietDay: true,
              carriedForwardAllStates: true
            }
          : prev
      );
      showStatus(
        'Quiet-day mode enabled: all 37 previously approved classifications are locked to carried-forward values. Enter the Research-approved statement below.'
      );
    } else {
      setEditingPub((prev) => (prev ? { ...prev, isQuietDay: checked } : prev));
    }
  };

  // Revert a single state back to its carried-forward approved value
  const handleRevertStateToCarriedForward = (stateCode: string) => {
    if (isReadOnlyPublishedDaily || !carryForwardSourcePub) return;
    const carriedAll = carryForwardClassifications(carryForwardSourcePub);
    const restored = carriedAll[stateCode];
    if (!restored) return;
    setClassifications((prev) => {
      const next = { ...prev, [stateCode]: restored };
      const allCarried = Object.values(next).every((r) => Boolean(r.carriedForward));
      setEditingPub((p) => (p ? { ...p, carriedForwardAllStates: allCarried } : p));
      return next;
    });
  };

  // Update classification for a state
  const handleClassificationChange = (stateCode: string, newClass: DcmClassification) => {
    if (isReadOnlyPublishedDaily) return;
    if (isEditingDaily && editingPub?.isQuietDay) {
      showStatus('Quiet-day updates cannot alter state classifications. Uncheck Quiet-Day Update to record approved changes.', 'error');
      return;
    }

    setClassifications(prev => {
      const existing = prev[stateCode] || {
        stateCode,
        stateName: NIGERIA_37_JURISDICTIONS.find(j => j.code === stateCode)?.name || stateCode,
        classification: 'Insufficient evidence' as DcmClassification
      };
      const updatedRecord: DcmStateRecord = {
        ...existing,
        classification: newClass,
        ...(isEditingDaily ? { carriedForward: false } : {})
      };
      return {
        ...prev,
        [stateCode]: updatedRecord
      };
    });

    if (isEditingDaily) {
      setEditingPub((p) => (p ? { ...p, carriedForwardAllStates: false } : p));
    }
  };

  // Update field for a state
  const handleStateFieldChange = (stateCode: string, field: keyof DcmStateRecord, value: string) => {
    if (isReadOnlyPublishedDaily) return;
    setClassifications(prev => {
      const existing = prev[stateCode] || {
        stateCode,
        stateName: NIGERIA_37_JURISDICTIONS.find(j => j.code === stateCode)?.name || stateCode,
        classification: 'Insufficient evidence' as DcmClassification
      };
      const clearsCarryForward =
        isEditingDaily &&
        !editingPub?.isQuietDay &&
        (field === 'keyFinding' || field === 'classificationRationale' || field === 'direction' || field === 'confidence');

      return {
        ...prev,
        [stateCode]: {
          ...existing,
          [field]: value,
          ...(clearsCarryForward ? { carriedForward: false } : {})
        }
      };
    });

    if (
      isEditingDaily &&
      !editingPub?.isQuietDay &&
      (field === 'keyFinding' || field === 'classificationRationale' || field === 'direction' || field === 'confidence')
    ) {
      setEditingPub((p) => (p ? { ...p, carriedForwardAllStates: false } : p));
    }
  };

  // Bulk quick-setters (disabled for quiet-day or immutable published daily updates)
  const handleBulkSetAll = (targetClass: DcmClassification) => {
    if (isReadOnlyPublishedDaily || (isEditingDaily && editingPub?.isQuietDay)) return;
    setClassifications(prev => {
      const updated: Record<string, DcmStateRecord> = {};
      for (const [code, rec] of Object.entries(prev)) {
        updated[code] = {
          ...rec,
          classification: targetClass,
          ...(isEditingDaily ? { carriedForward: false } : {})
        };
      }
      return updated;
    });
    if (isEditingDaily) {
      setEditingPub((p) => (p ? { ...p, carriedForwardAllStates: false } : p));
    }
    showStatus(`All 37 jurisdictions set to "${targetClass}".`);
  };

  // Acceptable CSV format generator
  const generateAcceptableCsv = (recordsMap?: Record<string, DcmStateRecord>): string => {
    const headers = [
      'state_code',
      'state_name',
      'classification',
      'direction',
      'confidence',
      'key_finding',
      'rationale',
      'evidence_summary',
      'right_of_response',
      'carried_forward',
      'last_substantive_review_date'
    ];
    const rows = NIGERIA_37_JURISDICTIONS.map(j => {
      const current = recordsMap?.[j.code] || classifications[j.code];
      const cls = current?.classification || 'Insufficient evidence';
      const dir = current?.direction || (cls === 'Insufficient evidence' ? 'insufficient-basis' : 'unchanged');
      const conf = current?.confidence || (cls === 'Insufficient evidence' ? 'Low' : 'Medium');
      const keyF = (current?.keyFinding || current?.classificationRationale || '').replace(/"/g, '""');
      const rat = (current?.classificationRationale || '').replace(/"/g, '""');
      const evi = (current?.evidenceSummary || '').replace(/"/g, '""');
      const ror = current?.rightOfResponseStatus || 'Not required';
      const cf = current?.carriedForward ? 'true' : 'false';
      const reviewDate = current?.lastSubstantiveReviewDate || '';
      return `"${j.code}","${j.name}","${cls}","${dir}","${conf}","${keyF}","${rat}","${evi}","${ror}","${cf}","${reviewDate}"`;
    });

    // Prepend UTF-8 BOM (\uFEFF) for seamless compatibility across Excel, Numbers, and Google Sheets
    return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  };

  // Download acceptable CSV file
  const handleDownloadAcceptableCsv = (customRecords?: Record<string, DcmStateRecord>, filenameSuffix = 'template') => {
    const csvContent = generateAcceptableCsv(customRecords);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedPeriod = editingPub?.reportingPeriodLabel?.replace(/[^a-zA-Z0-9]/g, '_') || filenameSuffix;
    link.download = `dcm_acceptable_format_37_jurisdictions_${sanitizedPeriod}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showStatus('Acceptable DCM CSV format downloaded (includes all 37 Nigerian jurisdictions).');
  };

  // Normalize classification from full name or code (G, A, O, R, X)
  const normalizeClassification = (val: string): DcmClassification | null => {
    if (!val) return null;
    const clean = val.trim().toLowerCase();
    
    // Short codes
    if (clean === 'g') return 'Open';
    if (clean === 'a') return 'Emerging concern';
    if (clean === 'o') return 'Constrained';
    if (clean === 'r') return 'Severely constrained';
    if (clean === 'x') return 'Insufficient evidence';

    // Full names and keywords
    if (clean.includes('open') || clean === 'green') {
      return 'Open';
    }
    if (clean.includes('emerging') || clean.includes('amber') || clean === 'yellow') {
      return 'Emerging concern';
    }
    if (clean.includes('severely') || clean.includes('severe') || clean === 'red') {
      return 'Severely constrained';
    }
    if (clean.includes('constrained') || clean === 'orange') {
      return 'Constrained';
    }
    if (clean.includes('insufficient') || clean.includes('grey') || clean.includes('gray') || clean.includes('none')) {
      return 'Insufficient evidence';
    }

    return null;
  };

  // Normalize direction from CSV input (does not auto-fabricate movement claims)
  const normalizeDirection = (val: string, fallbackCls: DcmClassification): string => {
    if (!val) return fallbackCls === 'Insufficient evidence' ? 'insufficient-basis' : 'unchanged';
    const clean = val.trim().toLowerCase().replace(/\s+/g, '-');
    if (clean.includes('new')) return 'newly-classified';
    if (clean.includes('deteriorat')) return 'deteriorating';
    if (clean.includes('insuffic') || clean.includes('basis')) return 'insufficient-basis';
    if (clean.includes('improv')) return 'improving';
    if (clean.includes('unchang')) return 'unchanged';
    if (clean.includes('stable')) return 'stable';
    return clean;
  };

  // Normalize confidence from CSV input
  const normalizeConfidence = (val: string, fallbackCls: DcmClassification): string => {
    if (!val) return fallbackCls === 'Insufficient evidence' ? 'Low' : 'Medium';
    const clean = val.trim().toLowerCase();
    if (clean.startsWith('h')) return 'High';
    if (clean.startsWith('m')) return 'Medium';
    if (clean.startsWith('l')) return 'Low';
    return 'Medium';
  };

  // Parse CSV text with quote and BOM support
  const parseDcmCsv = (text: string): {
    records: Record<string, DcmStateRecord>;
    matchedCount: number;
    unmatchedRows: string[];
  } => {
    const cleanText = text.replace(/^\uFEFF/, '').trim();
    const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV file has no data rows. Expected a header row followed by state rows.');
    }

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headerCols = parseLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, ''));
    const codeIdx = headerCols.findIndex(c => c === 'state_code' || c === 'code' || c.includes('code'));
    const nameIdx = headerCols.findIndex(c => c === 'state_name' || c === 'state' || c === 'name' || c.includes('name'));
    const classIdx = headerCols.findIndex(c => c === 'classification' || c === 'status' || c.includes('class') || c === 'category');
    const dirIdx = headerCols.findIndex(c => c === 'direction' || c === 'trend');
    const confIdx = headerCols.findIndex(c => c === 'confidence' || c === 'certainty');
    const keyFIdx = headerCols.findIndex(c => c === 'key_finding' || c === 'key_findings' || c.includes('finding'));
    const ratIdx = headerCols.findIndex(c => c === 'rationale' || c.includes('rationale') || c.includes('reason'));
    const eviIdx = headerCols.findIndex(c => c === 'evidence_summary' || c.includes('evidence') || c.includes('summary'));
    const rorIdx = headerCols.findIndex(c => c === 'right_of_response' || c.includes('response') || c.includes('ror'));
    const cfIdx = headerCols.findIndex(c => c === 'carried_forward' || c.includes('carried'));
    const reviewIdx = headerCols.findIndex(c => c === 'last_substantive_review_date' || c.includes('review_date'));

    if (codeIdx === -1 && nameIdx === -1) {
      throw new Error('CSV must contain at least a "state_code" or "state_name" column.');
    }
    if (classIdx === -1) {
      throw new Error('CSV must contain a "classification" or "status" column.');
    }

    const records = createBlank37Jurisdictions();
    let matchedCount = 0;
    const unmatchedRows: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

      const rawCode = (codeIdx >= 0 ? cols[codeIdx] : '')?.toUpperCase().replace(/[^A-Z]/g, '');
      const rawName = (nameIdx >= 0 ? cols[nameIdx] : '')?.trim();

      // Normalize common synonyms: FCT, Abuja, Federal Capital Territory
      const match = NIGERIA_37_JURISDICTIONS.find(j => {
        if (rawCode && j.code.toUpperCase() === rawCode) return true;
        if (rawCode === 'FCT' && j.code === 'FC') return true;
        if (rawName) {
          const cleanName = rawName.toLowerCase();
          const target = j.name.toLowerCase();
          if (cleanName === target) return true;
          if (j.code === 'FC' && (cleanName.includes('abuja') || cleanName.includes('federal capital'))) return true;
          if (cleanName.replace(/[^a-z]/g, '') === target.replace(/[^a-z]/g, '')) return true;
        }
        return false;
      });

      if (!match) {
        if (rawCode || rawName) {
          unmatchedRows.push(`Row ${i + 1}: ${rawCode || rawName}`);
        }
        continue;
      }

      const rawClass = classIdx >= 0 ? cols[classIdx] : '';
      const parsedClass = normalizeClassification(rawClass) || 'Insufficient evidence';
      
      const rawDir = (dirIdx >= 0 && cols[dirIdx]) ? cols[dirIdx] : '';
      const parsedDir = normalizeDirection(rawDir, parsedClass);

      const rawConf = (confIdx >= 0 && cols[confIdx]) ? cols[confIdx] : '';
      const parsedConf = normalizeConfidence(rawConf, parsedClass);

      const rawKeyF = (keyFIdx >= 0 && cols[keyFIdx]) ? cols[keyFIdx] : '';
      const rat = (ratIdx >= 0 && cols[ratIdx]) ? cols[ratIdx] : '';
      const evi = (eviIdx >= 0 && cols[eviIdx]) ? cols[eviIdx] : '';
      const rawRor = (rorIdx >= 0 && cols[rorIdx]) ? cols[rorIdx] : '';
      const ror = (RIGHT_OF_RESPONSE_OPTIONS.includes(rawRor as any)) 
        ? (rawRor as RightOfResponseStatus) 
        : 'Not required';
      const rawCf = (cfIdx >= 0 && cols[cfIdx]) ? cols[cfIdx].trim().toLowerCase() : '';
      const isCarried = rawCf === 'true' || rawCf === 'yes' || rawCf === '1';
      const rawReviewDate = (reviewIdx >= 0 && cols[reviewIdx]) ? cols[reviewIdx].trim() : '';
      const validReviewDate = parseIsoDate(rawReviewDate) ? rawReviewDate : undefined;

      records[match.code] = {
        stateCode: match.code,
        stateName: match.name,
        classification: parsedClass,
        direction: parsedDir,
        confidence: parsedConf,
        keyFinding: rawKeyF || rat,
        classificationRationale: rat || rawKeyF,
        evidenceSummary: evi,
        rightOfResponseStatus: ror,
        carriedForward: isCarried,
        ...(validReviewDate ? { lastSubstantiveReviewDate: validReviewDate } : {})
      };

      matchedCount++;
    }

    return { records, matchedCount, unmatchedRows };
  };

  // Upload CSV inside Publication Editor (updates current 37 jurisdictions)
  const handleUploadCsvInEditor = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnlyPublishedDaily) return;
    if (isEditingDaily && editingPub?.isQuietDay) {
      showStatus('Disable Quiet-Day Update before importing replacement state classifications.', 'error');
      e.target.value = '';
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) return;

        const { records, matchedCount, unmatchedRows } = parseDcmCsv(text);

        setClassifications(prev => {
          const merged: Record<string, DcmStateRecord> = { ...prev };
          for (const [code, imported] of Object.entries(records)) {
            const sourceRec = carryForwardSourcePub?.classifications?.[code];
            const changedFromSource = sourceRec && sourceRec.classification !== imported.classification;
            merged[code] = {
              ...imported,
              carriedForward: changedFromSource ? false : Boolean(imported.carriedForward),
              carriedForwardFromPublicationId:
                !changedFromSource && imported.carriedForward
                  ? (carryForwardSourcePub?.id || prev[code]?.carriedForwardFromPublicationId)
                  : undefined
            };
          }
          if (isEditingDaily) {
            const allCarried = Object.values(merged).every((r) => Boolean(r.carriedForward));
            setEditingPub((p) => (p ? { ...p, carriedForwardAllStates: allCarried } : p));
          }
          return merged;
        });

        let msg = `CSV uploaded: Successfully populated ${matchedCount}/37 jurisdictions.`;
        if (unmatchedRows.length > 0) {
          msg += ` (${unmatchedRows.length} unrecognized rows skipped)`;
        }
        showStatus(msg);
      } catch (err: any) {
        showStatus(`CSV import error: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Upload CSV from Main List (creates new publication and populates 37 jurisdictions)
  const handleUploadCsvForNewPublication = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) return;

        const { records, matchedCount } = parseDcmCsv(text);

        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth() + 1;
        const isP1 = now.getDate() <= 15;

        const newId = `dcm-${curYear}-${String(curMonth).padStart(2, '0')}-${isP1 ? '15' : 'end'}-${Date.now().toString().slice(-4)}`;
        const periodLabel = isP1 
          ? `1st – 15th ${MONTH_NAMES[curMonth - 1]} ${curYear}`
          : `16th – ${new Date(curYear, curMonth, 0).getDate()}th ${MONTH_NAMES[curMonth - 1]} ${curYear}`;

        setEditingPub({
          id: newId,
          title: `Democratic Competitiveness Map: ${periodLabel}`,
          year: curYear,
          month: curMonth,
          periodIndex: isP1 ? 1 : 2,
          periodStart: isP1 ? `${curYear}-${String(curMonth).padStart(2, '0')}-01` : `${curYear}-${String(curMonth).padStart(2, '0')}-16`,
          periodEnd: isP1 ? `${curYear}-${String(curMonth).padStart(2, '0')}-15` : `${curYear}-${String(curMonth).padStart(2, '0')}-${new Date(curYear, curMonth, 0).getDate()}`,
          reportingPeriodLabel: periodLabel,
          publicationDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          evidenceCutoffDate: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          methodologyVersion: 'Version 1.1',
          revisionNote: 'Uploaded via CSV batch import',
          status: 'draft',
          isLatest: false,
          summary: `Imported publication with ${matchedCount} state classifications.`,
          changesSummary: '',
          supportingDocumentUrl: ''
        });

        setClassifications(records);
        setValidationErrors([]);
        setShowLivePreview(false);

        showStatus(`CSV import successful! Created new publication draft with ${matchedCount}/37 jurisdictions populated.`);
      } catch (err: any) {
        showStatus(`CSV upload error: ${err.message}`, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Strict 37-Jurisdiction Validation Before Saving Legacy Period Publication
  const validateBeforeSave = (): boolean => {
    const errors: string[] = [];

    if (!editingPub?.title?.trim()) {
      errors.push('Publication title is required.');
    }
    if (!editingPub?.reportingPeriodLabel?.trim()) {
      errors.push('Reporting period label is required.');
    }
    if (!editingPub?.periodStart || !editingPub?.periodEnd) {
      errors.push('Period start and end dates are required.');
    }

    const unclassifiedStates: string[] = [];
    for (const j of NIGERIA_37_JURISDICTIONS) {
      const rec = classifications[j.code];
      if (!rec || !rec.classification || !DCM_CLASSIFICATIONS.includes(rec.classification)) {
        unclassifiedStates.push(`${j.name} (${j.code})`);
      }
    }

    if (unclassifiedStates.length > 0) {
      errors.push(
        `All 37 jurisdictions must have a controlled classification before saving. Missing/unclassified: ${unclassifiedStates.slice(0, 5).join(', ')}${unclassifiedStates.length > 5 ? ` and ${unclassifiedStates.length - 5} more` : ''}.`
      );
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  // Save Daily DCM publication with explicit target status ('draft' | 'approved' | 'published')
  const handleSaveDaily = async (targetStatus: 'draft' | 'approved' | 'published') => {
    if (!editingPub || isSaving || isReadOnlyPublishedDaily) return;

    const wat = formatWatCutoff(
      editingPub.assessmentDate || '',
      editingPub.evidenceCutoffTimeWat || ''
    );
    const parsedDate = parseIsoDate(editingPub.assessmentDate || '');
    const nowIso = new Date().toISOString();
    const dateLabel = editingPub.assessmentDate ? formatDailyDateLabel(editingPub.assessmentDate) : '';
    const allCarried = Object.values(classifications).every((r) => Boolean(r.carriedForward));
    const currentUid = auth.currentUser?.uid || '';
    const currentEmail = auth.currentUser?.email || undefined;

    const approvalRecord =
      approvalConfirmed && approverName.trim().length >= 2 && approvalReference.trim().length >= 3
        ? {
            approved: true,
            approvalReference: approvalReference.trim(),
            approvedByName: approverName.trim(),
            approvedAt: editingPub.approvalRecord?.approvedAt || nowIso,
            recordedByUid: currentUid,
            recordedByEmail: currentEmail,
            recordedAt: nowIso,
            approvedByUid: currentUid,
            approvedByEmail: currentEmail,
            verificationMode: 'admin-recorded-reference' as const
          }
        : undefined;

    const candidate: DcmPublication = {
      id: editingPub.id || buildDailyPublicationId(editingPub.assessmentDate || '', publications.map((p) => p.id)),
      publicationFormat: 'daily',
      title: editingPub.title?.trim() || `Democratic Competitiveness Map — Daily Update: ${dateLabel}`,
      year: parsedDate?.year || Number(editingPub.year) || new Date().getFullYear(),
      month: parsedDate?.month || Number(editingPub.month) || 1,
      periodIndex: parsedDate ? (parsedDate.day <= 15 ? 1 : 2) : 1,
      periodStart: editingPub.assessmentDate || '',
      periodEnd: editingPub.assessmentDate || '',
      reportingPeriodLabel: editingPub.reportingPeriodLabel?.trim() || dateLabel,
      publicationDate: editingPub.publicationDate?.trim() || dateLabel,
      evidenceCutoffDate: wat.valid ? wat.displayLabel : '',
      assessmentDate: editingPub.assessmentDate || '',
      evidenceCutoffTimeWat: editingPub.evidenceCutoffTimeWat || '',
      evidenceCutoffDateTimeWat: wat.valid ? wat.isoWat : '',
      publishedAt: targetStatus === 'published' ? nowIso : undefined,
      isQuietDay: Boolean(editingPub.isQuietDay),
      carriedForwardAllStates: allCarried,
      carriedForwardFromPublicationId: editingPub.carriedForwardFromPublicationId,
      supersedesPublicationId: editingPub.supersedesPublicationId,
      revisionNumber: editingPub.revisionNumber,
      approvalRecord,
      methodologyVersion: editingPub.methodologyVersion || 'Version 1.1',
      revisionNote: editingPub.revisionNote || '',
      status: targetStatus,
      isLatest: targetStatus === 'published',
      summary: editingPub.summary || '',
      changesSummary: editingPub.changesSummary || '',
      supportingDocumentUrl: editingPub.supportingDocumentUrl || '',
      classifications,
      createdAt: editingPub.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: editingPub.createdByUid || currentUid || undefined,
      updatedByUid: currentUid || undefined
    };

    const validation = validateDailyPublication(candidate, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined,
      existingDoc: existingRecord,
      sourcePub: carryForwardSourcePub
    });

    const consistency = auditPublicationConsistency(candidate, carryForwardSourcePub);
    const combinedErrors = [...validation.errors, ...consistency.errors];

    if (combinedErrors.length > 0) {
      setValidationErrors(combinedErrors);
      showStatus('Please resolve the validation and consistency requirements before continuing.', 'error');
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);
    try {
      await saveDailyDcmPublication(candidate);
      const actionLabel =
        targetStatus === 'published'
          ? 'published (now immutable and visible on the public DCM)'
          : targetStatus === 'approved'
          ? 'marked Research-Approved (private in CMS until published)'
          : 'saved as a private Draft';
      showStatus(`Daily DCM update "${candidate.reportingPeriodLabel}" ${actionLabel}.`);
      setEditingPub(null);
      setEditingExistingId(null);
      setClassifications({});
      setApproverName('');
      setApprovalReference('');
      setApprovalConfirmed(false);
    } catch (err: any) {
      showStatus(`Failed to save daily publication: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Save legacy reporting-period publication handler (with Stage 2 approval reference & immutability safeguards)
  const handleSave = async () => {
    if (isEditingDaily) {
      await handleSaveDaily('draft');
      return;
    }
    if (!editingPub || isReadOnlyPublishedDaily) return;

    const nowIso = new Date().toISOString();
    const currentUid = auth.currentUser?.uid || '';
    const currentEmail = auth.currentUser?.email || undefined;
    const targetStatus = (editingPub.status as any) || 'draft';

    const approvalRecord =
      approvalConfirmed && approverName.trim().length >= 2 && approvalReference.trim().length >= 3
        ? {
            approved: true,
            approvalReference: approvalReference.trim(),
            approvedByName: approverName.trim(),
            approvedAt: editingPub.approvalRecord?.approvedAt || nowIso,
            recordedByUid: currentUid,
            recordedByEmail: currentEmail,
            recordedAt: nowIso,
            approvedByUid: currentUid,
            approvedByEmail: currentEmail,
            verificationMode: 'admin-recorded-reference' as const
          }
        : undefined;

    const finalPub: DcmPublication = {
      id: editingPub.id || `dcm-${Date.now()}`,
      publicationFormat: 'legacy-period',
      title: editingPub.title || 'Democratic Competitiveness Map',
      year: Number(editingPub.year) || new Date().getFullYear(),
      month: Number(editingPub.month) || 10,
      periodIndex: Number(editingPub.periodIndex) || 1,
      periodStart: editingPub.periodStart || '2026-10-01',
      periodEnd: editingPub.periodEnd || '2026-10-15',
      reportingPeriodLabel: editingPub.reportingPeriodLabel || '1st – 15th October 2026',
      publicationDate: editingPub.publicationDate || new Date().toLocaleDateString('en-GB'),
      evidenceCutoffDate: editingPub.evidenceCutoffDate || new Date().toLocaleDateString('en-GB'),
      supersedesPublicationId: editingPub.supersedesPublicationId,
      revisionNumber: editingPub.revisionNumber,
      approvalRecord,
      publishedAt: targetStatus === 'published' ? (editingPub.publishedAt || nowIso) : undefined,
      methodologyVersion: editingPub.methodologyVersion || 'Version 1.1',
      revisionNote: editingPub.revisionNote || '',
      status: targetStatus,
      isLatest: targetStatus === 'published' ? Boolean(editingPub.isLatest) : false,
      summary: editingPub.summary || '',
      changesSummary: editingPub.changesSummary || '',
      supportingDocumentUrl: editingPub.supportingDocumentUrl || '',
      classifications: classifications,
      createdAt: editingPub.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: editingPub.createdByUid || currentUid || undefined,
      updatedByUid: currentUid || undefined
    };

    const validation = validateLegacyPublication(finalPub, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined,
      existingDoc: existingRecord
    });
    const consistency = auditPublicationConsistency(finalPub);
    const combinedErrors = [...validation.errors, ...consistency.errors];

    if (combinedErrors.length > 0) {
      setValidationErrors(combinedErrors);
      showStatus('Please resolve the validation and approval requirements before saving.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await saveDcmPublication(finalPub);
      showStatus(`Publication "${finalPub.title}" successfully saved.`);
      setEditingPub(null);
      setEditingExistingId(null);
      setClassifications({});
      setApproverName('');
      setApprovalReference('');
      setApprovalConfirmed(false);
      setValidationErrors([]);
    } catch (err: any) {
      showStatus(`Failed to save publication: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete publication handler (protects ALL published editions—daily and legacy—from deletion)
  const handleDelete = async (pub: DcmPublication) => {
    if (pub.status === 'published') {
      showStatus('Published DCM editions are immutable historical records and cannot be deleted. Issue a corrected revision instead.', 'error');
      return;
    }

    if (window.confirm(`Are you sure you want to delete "${pub.title}"? This action cannot be undone.`)) {
      try {
        if (isDailyPublication(pub)) {
          await deleteDailyDcmPublication(pub.id);
        } else {
          await deleteDcmPublication(pub.id);
        }
        showStatus(`Deleted "${pub.title}".`);
      } catch (err: any) {
        showStatus(`Failed to delete: ${err.message}`, 'error');
      }
    }
  };

  // Counts of current classifications in editor
  const counts = useMemo(() => {
    const res: Record<DcmClassification, number> = {
      'Open': 0,
      'Emerging concern': 0,
      'Constrained': 0,
      'Severely constrained': 0,
      'Insufficient evidence': 0
    };
    for (const rec of Object.values(classifications)) {
      if (rec?.classification && res[rec.classification] !== undefined) {
        res[rec.classification]++;
      }
    }
    return res;
  }, [classifications]);

  // Filtered jurisdictions in table editor
  const filteredJurisdictions = useMemo(() => {
    return NIGERIA_37_JURISDICTIONS.filter(j => {
      const matchSearch = j.name.toLowerCase().includes(searchState.toLowerCase()) || 
                          j.code.toLowerCase().includes(searchState.toLowerCase());
      const matchZone = zoneFilter === 'all' || j.zone === zoneFilter;
      const rec = classifications[j.code];
      const matchClass = classFilter === 'all' || (rec && rec.classification === classFilter);
      return matchSearch && matchZone && matchClass;
    });
  }, [searchState, zoneFilter, classFilter, classifications]);

  const uniqueZones = useMemo(() => {
    return Array.from(new Set(NIGERIA_37_JURISDICTIONS.map(j => j.zone)));
  }, []);

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {statusMsg && (
        <div className={`p-4 rounded-xl flex items-center gap-3 text-sm font-semibold transition-all shadow-sm ${
          statusMsg.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Stage 3 Top-Level DCM Workspace Tabs (Publications | Public Evidence & Sources | Incident History) */}
      {!editingPub && (
        <div className="flex flex-wrap items-center gap-2 bg-paper p-1.5 rounded-2xl border border-line">
          <button
            type="button"
            onClick={() => setDcmSectionTab('publications')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              dcmSectionTab === 'publications'
                ? 'bg-brand-blue text-white shadow-xs'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>DCM Publications ({publications.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDcmSectionTab('evidence')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              dcmSectionTab === 'evidence'
                ? 'bg-brand-blue text-white shadow-xs'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Public Evidence & Sources ({dcmEvidence.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDcmSectionTab('incidents')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              dcmSectionTab === 'incidents'
                ? 'bg-brand-blue text-white shadow-xs'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Incident History ({dcmIncidents.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setDcmSectionTab('editorial')}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all cursor-pointer ${
              dcmSectionTab === 'editorial'
                ? 'bg-brand-blue text-white shadow-xs'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <Newspaper className="w-3.5 h-3.5" />
            <span>DCM Editorial Publishing ({dcmEditorialHandovers.length})</span>
          </button>
        </div>
      )}

      {/* Stage 3 Evidence & Incident Managers & Stage 6 Editorial Publishing */}
      {!editingPub && dcmSectionTab === 'evidence' ? (
        <DcmEvidenceCmsManager mode="evidence" />
      ) : !editingPub && dcmSectionTab === 'incidents' ? (
        <DcmEvidenceCmsManager mode="incidents" />
      ) : !editingPub && dcmSectionTab === 'editorial' ? (
        <DcmEditorialPublishingManager />
      ) : !editingPub ? (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-brand-blue" />
                <h3 className="font-display font-bold text-xl text-ink">
                  Democratic Competitiveness Map (DCM) Publications
                </h3>
              </div>
              <p className="text-xs text-mut mt-1">
                Manage Research-approved daily DCM updates and historical reporting-period editions across all 36 states and the FCT.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input 
                type="file" 
                ref={mainListFileInputRef}
                accept=".csv,text/csv" 
                onChange={handleUploadCsvForNewPublication} 
                className="hidden" 
              />

              <button
                type="button"
                onClick={() => handleStartNewDaily({ isQuietDay: false })}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-dark text-white rounded-xl text-xs font-bold font-mono tracking-wider uppercase transition-all shadow-sm cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>New Daily DCM Update</span>
              </button>

              <button
                type="button"
                onClick={() => handleStartNewDaily({ isQuietDay: true })}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-xs cursor-pointer shrink-0"
                title="Create a daily publication retaining all 37 previously approved classifications without change"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-700" />
                <span>Quiet-Day Update</span>
              </button>

              <button
                type="button"
                onClick={handleStartNew}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-xs cursor-pointer shrink-0"
                title="Create a legacy reporting-period publication"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-600" />
                <span>Legacy Period Edition</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadAcceptableCsv(undefined, 'blank_template')}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-mono font-semibold transition-all shadow-xs cursor-pointer shrink-0"
                title="Download standard CSV format with all 37 Nigerian jurisdictions"
              >
                <Download className="w-3.5 h-3.5 text-brand-blue" />
                <span>CSV Template</span>
              </button>

              <button
                type="button"
                onClick={() => mainListFileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-purple-50 hover:bg-purple-100 text-brand-purple border border-purple-200 rounded-xl text-xs font-mono font-semibold transition-all shadow-xs cursor-pointer shrink-0"
                title="Upload a completed CSV to create a new DCM publication with all 37 states"
              >
                <UploadCloud className="w-3.5 h-3.5 text-brand-purple" />
                <span>Upload CSV</span>
              </button>

              <button
                type="button"
                onClick={() => setShowCsvGuide(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-mono font-semibold transition-all cursor-pointer shrink-0"
                title="View acceptable CSV headers and permitted values"
              >
                <Info className="w-3.5 h-3.5 text-slate-500" />
                <span>Format Guide</span>
              </button>

              <a
                href="/democratic-competitiveness-map"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-xs cursor-pointer shrink-0"
              >
                <Eye className="w-3.5 h-3.5 text-brand-blue" />
                <span>Live Map</span>
              </a>
            </div>
          </div>

          {/* Publication Format Filter Tabs */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="inline-flex items-center gap-1.5 bg-paper p-1 rounded-xl border border-line">
              <button
                type="button"
                onClick={() => setFormatFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                  formatFilter === 'all' ? 'bg-white text-ink shadow-xs' : 'text-mut hover:text-ink'
                }`}
              >
                All Editions ({publications.length})
              </button>
              <button
                type="button"
                onClick={() => setFormatFilter('daily')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                  formatFilter === 'daily' ? 'bg-white text-brand-blue shadow-xs' : 'text-mut hover:text-ink'
                }`}
              >
                Daily Updates ({dailyCount})
              </button>
              <button
                type="button"
                onClick={() => setFormatFilter('legacy')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                  formatFilter === 'legacy' ? 'bg-white text-ink shadow-xs' : 'text-mut hover:text-ink'
                }`}
              >
                Legacy Periods ({legacyCount})
              </button>
            </div>
            <span className="text-[11px] font-mono text-mut">
              Daily records stored individually in <code className="bg-paper px-1.5 py-0.5 rounded border border-line">/dcm_daily_publications</code> · Historical records protected
            </span>
          </div>

          {/* Publications Cards Grid */}
          {filteredPublicationsList.length === 0 ? (
            <div className="bg-white border border-dashed border-line rounded-2xl p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-ink">
                No {formatFilter === 'daily' ? 'daily DCM updates' : 'matching DCM publications'} found yet.
              </p>
              <p className="text-xs text-mut max-w-md mx-auto">
                Create a new daily DCM draft to carry forward all 37 previously approved classifications without automatic changes.
              </p>
              <button
                type="button"
                onClick={() => handleStartNewDaily({ isQuietDay: false })}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-blue hover:bg-brand-blue-dark text-white rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Daily Update</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredPublicationsList.map((pub) => {
                const classCount = pub.classifications ? Object.keys(pub.classifications).length : 0;
                const hasAll37 = classCount === 37;
                const daily = isDailyPublication(pub);
                const isImmutablePublished = pub.status === 'published';
                const carriedCount = pub.classifications
                  ? Object.values(pub.classifications).filter((r) => Boolean(r.carriedForward)).length
                  : 0;
                const statusBadgeStyle =
                  pub.status === 'published'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : pub.status === 'approved'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';

                return (
                  <div 
                    key={pub.id}
                    className="bg-white border border-line rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase border ${
                            daily
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}>
                            {daily ? 'Daily Update' : 'Legacy Period'}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase border ${statusBadgeStyle}`}>
                            {pub.status}
                          </span>
                          {pub.isQuietDay && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-teal-50 text-teal-800 border border-teal-200">
                              Quiet Day
                            </span>
                          )}
                          {isImmutablePublished && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-slate-100 text-slate-700 border border-slate-300 inline-flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" />
                              Immutable
                            </span>
                          )}
                          {pub.isLatest && pub.status === 'published' && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider uppercase bg-blue-50 text-brand-blue border border-blue-200 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              Latest
                            </span>
                          )}
                        </div>

                        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded shrink-0 ${
                          hasAll37 ? 'bg-emerald-100/60 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {classCount}/37 Classified
                        </span>
                      </div>

                      <h4 className="font-display font-bold text-lg text-ink leading-snug">
                        {pub.title}
                      </h4>

                      <div className="space-y-1 text-xs text-mut font-mono">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          <span>{pub.reportingPeriodLabel}</span>
                          <span className="text-[10px] text-slate-400">· {pub.methodologyVersion || 'v1.1'}</span>
                        </div>
                        {daily && pub.evidenceCutoffDate && (
                          <div className="flex items-center gap-2 text-indigo-700">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            <span>Cut-off: {pub.evidenceCutoffDate}</span>
                          </div>
                        )}
                        {daily && carriedCount > 0 && (
                          <div className="text-[11px] text-slate-600">
                            {carriedCount === 37
                              ? 'All 37 classifications carried forward from prior approved edition'
                              : `${carriedCount}/37 classifications carried forward · ${37 - carriedCount} updated`}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-ink2 line-clamp-2 leading-relaxed">
                        {pub.summary || 'No Research-approved summary entered yet.'}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-line flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-mut">
                        {daily && pub.publishedAt
                          ? `Published: ${formatTimestampInWat(pub.publishedAt)}`
                          : `Pub date: ${pub.publicationDate}`}
                      </span>

                      <div className="flex items-center gap-2">
                        {isImmutablePublished && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleStartNewDaily({ isQuietDay: false, sourcePub: pub })}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-semibold font-mono flex items-center gap-1 transition-colors cursor-pointer"
                              title="Create a new daily update carrying forward classifications from this published edition"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>New Daily</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCreateCorrectionRevision(pub)}
                              className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-semibold font-mono flex items-center gap-1 transition-colors cursor-pointer"
                              title="Issue a new versioned correction draft while preserving this published record intact"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Correct (New Version)</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => handleEdit(pub)}
                          className="px-3 py-1.5 rounded-lg bg-paper hover:bg-line text-ink text-xs font-semibold font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {isImmutablePublished ? (
                            <>
                              <Eye className="w-3.5 h-3.5 text-slate-600" />
                              <span>View Record</span>
                            </>
                          ) : (
                            <>
                              <Edit3 className="w-3.5 h-3.5 text-brand-blue" />
                              <span>Edit</span>
                            </>
                          )}
                        </button>

                        {!isImmutablePublished && (
                          <button
                            type="button"
                            onClick={() => handleDelete(pub)}
                            className="p-1.5 rounded-lg text-mut hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Delete publication"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* VIEW 2: PUBLICATION EDITOR & 37-JURISDICTION MATRIX */
        <div className="space-y-8 bg-paper border border-line rounded-2xl p-6 shadow-sm">
          {/* Editor Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider text-white ${
                  isEditingDaily ? 'bg-indigo-700' : 'bg-brand-blue'
                }`}>
                  {isEditingDaily ? 'Daily DCM Publication Editor' : 'Legacy Period DCM Editor'}
                </span>
                {isEditingDaily && editingPub.isQuietDay && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-teal-100 text-teal-800 border border-teal-200">
                    Quiet-Day Update
                  </span>
                )}
                {isReadOnlyPublishedDaily && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider bg-slate-200 text-slate-800 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Published · Read-Only
                  </span>
                )}
                <span className="text-xs font-mono text-mut">
                  {editingPub.id}
                </span>
              </div>
              <h3 className="font-display font-bold text-xl sm:text-2xl text-ink">
                {editingPub.title || 'Untitled DCM Publication'}
              </h3>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowLivePreview(!showLivePreview)}
                className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all border cursor-pointer ${
                  showLivePreview 
                    ? 'bg-brand-purple text-white border-brand-purple' 
                    : 'bg-white hover:bg-line text-ink border-line'
                }`}
              >
                <Eye className="w-4 h-4" />
                <span>{showLivePreview ? 'Hide Live Map Preview' : 'Live Map Preview'}</span>
              </button>

              <button
                type="button"
                onClick={handleCancel}
                className="px-3.5 py-2 rounded-xl text-xs font-mono font-semibold bg-white hover:bg-line text-mut hover:text-ink border border-line transition-all cursor-pointer"
              >
                {isReadOnlyPublishedDaily ? 'Back to List' : 'Cancel'}
              </button>

              {!isReadOnlyPublishedDaily ? (
                !isEditingDaily ? (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                    className="px-5 py-2 rounded-xl text-xs font-mono font-bold tracking-wider uppercase bg-brand-green hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving...' : 'Save Publication'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveDaily('draft')}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider uppercase bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving...' : 'Save Draft'}</span>
                  </button>
                )
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => existingRecord && handleCreateCorrectionRevision(existingRecord)}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider uppercase bg-amber-600 hover:bg-amber-700 text-white shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Issue Corrected Revision</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => existingRecord && handleStartNewDaily({ isQuietDay: false, sourcePub: existingRecord })}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider uppercase bg-brand-blue hover:bg-brand-blue-dark text-white shadow-sm flex items-center gap-2 transition-all cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Start New Daily From This</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Read-Only Immutability Notice */}
          {isReadOnlyPublishedDaily && (
            <div className="bg-slate-100 border border-slate-300 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-800">
              <Lock className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-bold">Published Historical Record (Immutable)</div>
                <p>
                  This DCM publication is locked against overwrite or deletion to preserve historical integrity
                  {editingPub.publishedAt ? ` (released ${formatTimestampInWat(editingPub.publishedAt)})` : ''}.
                  {editingPub.approvalRecord?.approvalReference && (
                    <> Documented Research reference: <strong>{editingPub.approvalRecord.approvalReference}</strong>.</>
                  )}
                  {editingPub.approvalRecord?.recordedByEmail && (
                    <> Recorded by admin: <strong>{editingPub.approvalRecord.recordedByEmail}</strong>.</>
                  )}{' '}
                  To issue a subsequent correction while preserving this version, click <strong>Issue Corrected Revision</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Validation Errors Box */}
          {validationErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-800 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Cannot save publication. Please resolve the following requirement{validationErrors.length > 1 ? 's' : ''}:</span>
              </div>
              <ul className="list-disc list-inside text-xs text-red-700 space-y-1 pl-1">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 1: Publication Metadata (Daily vs Legacy Period) */}
          {isEditingDaily ? (
            <div className="bg-white border border-line rounded-xl p-5 space-y-5">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-line pb-2">
                <h4 className="font-display font-bold text-sm text-ink uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-700" />
                  <span>Daily Publication Metadata, WAT Cut-Off & Carry-Forward</span>
                </h4>
                <span className="text-[11px] font-mono text-mut">
                  Current Status: <strong className="uppercase text-ink">{editingPub.status || 'draft'}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Daily Publication Title</label>
                  <input
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.title || ''}
                    onChange={e => setEditingPub(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Democratic Competitiveness Map — Daily Update: 19 November 2026"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-semibold focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Unique Publication ID</label>
                  <input
                    type="text"
                    disabled
                    value={editingPub.id || ''}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono bg-slate-50 text-slate-600"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Assessment Date (YYYY-MM-DD)</label>
                  <input
                    type="date"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.assessmentDate || ''}
                    onChange={e => handleDailyAssessmentDateChange(e.target.value)}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">
                    Evidence Cut-Off Time ({WAT_LABEL})
                  </label>
                  <input
                    type="time"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.evidenceCutoffTimeWat || '17:00'}
                    onChange={e => handleDailyCutoffTimeChange(e.target.value)}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Methodology Version</label>
                  <input
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.methodologyVersion || 'Version 1.1'}
                    onChange={e => setEditingPub(p => ({ ...p, methodologyVersion: e.target.value }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                {/* Live WAT Cut-off Preview Bar */}
                <div className="md:col-span-3 p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-indigo-950">
                    <Clock className="w-4 h-4 text-indigo-700 shrink-0" />
                    <span>
                      <strong>Formatted WAT Cut-Off:</strong>{' '}
                      {dailyWatPreview?.valid ? dailyWatPreview.displayLabel : 'Enter a valid assessment date and 24-hour WAT time.'}
                    </span>
                  </div>
                  {dailyWatPreview?.valid && (
                    <code className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border border-indigo-200 text-indigo-800">
                      {dailyWatPreview.isoWat}
                    </code>
                  )}
                </div>

                {/* Carry-Forward Source Control */}
                <div className="md:col-span-3 p-4 rounded-xl bg-slate-50 border border-line space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-ink">Carry Forward Previously Approved Classifications</div>
                      <p className="text-[11px] text-mut mt-0.5">
                        A new day never automatically changes state classifications. Previously approved classifications remain carried forward until Research-approved replacement assessments are entered.
                      </p>
                    </div>
                    {!isReadOnlyPublishedDaily && publishedSourceOptions.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap shrink-0">
                        <select
                          value={editingPub.carriedForwardFromPublicationId || ''}
                          onChange={(e) => {
                            const nextId = e.target.value;
                            setEditingPub((p) => (p ? { ...p, carriedForwardFromPublicationId: nextId || undefined } : p));
                          }}
                          className="text-xs py-1.5 px-2.5 border border-line rounded-lg font-mono bg-white"
                        >
                          <option value="">Select prior approved edition...</option>
                          {publishedSourceOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.reportingPeriodLabel} ({isDailyPublication(opt) ? 'Daily' : 'Legacy'})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!editingPub.carriedForwardFromPublicationId}
                          onClick={() =>
                            editingPub.carriedForwardFromPublicationId &&
                            handleApplyCarryForwardSource(editingPub.carriedForwardFromPublicationId)
                          }
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-50 text-ink border border-slate-300 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-brand-blue" />
                          <span>Carry Forward All 37</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Quiet-Day Toggle */}
                  <div className="pt-2 border-t border-line flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="dcm-quiet-day-toggle"
                      disabled={isReadOnlyPublishedDaily}
                      checked={Boolean(editingPub.isQuietDay)}
                      onChange={(e) => handleToggleQuietDay(e.target.checked)}
                      className="rounded text-teal-700 focus:ring-teal-600 w-4 h-4 mt-0.5 cursor-pointer disabled:cursor-not-allowed"
                    />
                    <label htmlFor="dcm-quiet-day-toggle" className="text-xs text-ink cursor-pointer">
                      <span className="font-bold">Quiet-Day Update (No classification changes)</span>
                      <span className="block text-[11px] text-mut mt-0.5">
                        Locks all 37 state classifications to the carried-forward approved snapshot. Enter the Research-approved quiet-day statement below, including the actual evidence cut-off time (WAT). The CMS never auto-asserts that no incidents occurred.
                      </span>
                    </label>
                  </div>
                </div>

                {/* Research-Approved Daily Summary / Quiet-Day Statement */}
                <div className="md:col-span-3 space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">
                    {editingPub.isQuietDay
                      ? 'Research-Approved Quiet-Day Statement (Include Actual WAT Cut-Off Time)'
                      : 'Research-Approved Daily Summary'}
                  </label>
                  <textarea
                    rows={4}
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.summary || ''}
                    onChange={e => setEditingPub(p => ({ ...p, summary: e.target.value }))}
                    placeholder={
                      editingPub.isQuietDay
                        ? `Enter the Research-approved statement verbatim, including the actual cut-off time (e.g. "${dailyWatPreview?.displayLabel || '19 November 2026, 17:00 WAT (UTC+01:00)'}"). Do not rely on automated text.`
                        : 'Enter the Research-approved daily summary verbatim...'
                    }
                    className="w-full text-xs p-2.5 border border-line rounded-lg focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="md:col-span-3 space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">
                    Revision Notes / Editorial Reference (Optional)
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.revisionNote || ''}
                    onChange={e => setEditingPub(p => ({ ...p, revisionNote: e.target.value }))}
                    placeholder="Optional internal editorial or methodology note..."
                    className="w-full text-xs p-2.5 border border-line rounded-lg focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-line rounded-xl p-5 space-y-4">
              <h4 className="font-display font-bold text-sm text-ink uppercase tracking-wider flex items-center gap-2 border-b border-line pb-2">
                <FileSpreadsheet className="w-4 h-4 text-brand-blue" />
                <span>Publication Metadata & Timeline Indexing (Legacy Reporting Period)</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Publication Title</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.title || ''}
                    onChange={e => setEditingPub(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Democratic Competitiveness Map: 1st – 15th October 2026"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-semibold focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Publication Status</label>
                  <select 
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.status || 'draft'}
                    onChange={e => setEditingPub(p => ({ ...p, status: e.target.value as any }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-semibold font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                  >
                    <option value="draft">Draft (Private in CMS)</option>
                    <option value="approved">Approved (Ready to Publish — Private)</option>
                    <option value="published">Published (Visible to Public)</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Reporting Period Label</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.reportingPeriodLabel || ''}
                    onChange={e => setEditingPub(p => ({ ...p, reportingPeriodLabel: e.target.value }))}
                    placeholder="e.g. 1st – 15th October 2026"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-semibold focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Period Start Date</label>
                  <input 
                    type="date"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.periodStart || ''}
                    onChange={e => setEditingPub(p => ({ ...p, periodStart: e.target.value }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Period End Date</label>
                  <input 
                    type="date"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.periodEnd || ''}
                    onChange={e => setEditingPub(p => ({ ...p, periodEnd: e.target.value }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Year</label>
                  <input 
                    type="number"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.year || 2026}
                    onChange={e => setEditingPub(p => ({ ...p, year: Number(e.target.value) }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Month (1-12)</label>
                  <select 
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.month || 10}
                    onChange={e => setEditingPub(p => ({ ...p, month: Number(e.target.value) }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                  >
                    {MONTH_NAMES.map((m, idx) => (
                      <option key={idx + 1} value={idx + 1}>{m} ({idx + 1})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Period Index</label>
                  <select 
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.periodIndex || 1}
                    onChange={e => setEditingPub(p => ({ ...p, periodIndex: Number(e.target.value) }))}
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                  >
                    <option value={1}>P1: 1st – 15th of month</option>
                    <option value={2}>P2: 16th – Month end</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Methodology Version</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.methodologyVersion || 'Version 1.1'}
                    onChange={e => setEditingPub(p => ({ ...p, methodologyVersion: e.target.value }))}
                    placeholder="e.g. Version 1.1"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Publication Date</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.publicationDate || ''}
                    onChange={e => setEditingPub(p => ({ ...p, publicationDate: e.target.value }))}
                    placeholder="e.g. 16 October 2026"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Evidence Cut-off Date</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.evidenceCutoffDate || ''}
                    onChange={e => setEditingPub(p => ({ ...p, evidenceCutoffDate: e.target.value }))}
                    placeholder="e.g. 15 October 2026"
                    className="w-full text-xs p-2.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="md:col-span-3 flex items-center gap-2 pt-1">
                  <input 
                    type="checkbox"
                    id="isLatest"
                    disabled={isReadOnlyPublishedDaily}
                    checked={Boolean(editingPub.isLatest)}
                    onChange={e => setEditingPub(p => ({ ...p, isLatest: e.target.checked }))}
                    className="rounded text-brand-blue focus:ring-brand-blue w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <label htmlFor="isLatest" className="text-xs font-semibold text-ink cursor-pointer">
                    Mark as Latest Publication (Default view for visitors at /democratic-competitiveness-map)
                  </label>
                </div>

                <div className="md:col-span-3 space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Executive Summary / National Overview</label>
                  <textarea 
                    rows={3}
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.summary || ''}
                    onChange={e => setEditingPub(p => ({ ...p, summary: e.target.value }))}
                    placeholder="Key national findings, regional deterioration, and contextual analysis..."
                    className="w-full text-xs p-2.5 border border-line rounded-lg focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>

                <div className="md:col-span-3 space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">Revision Notes / Methodology Changes (Optional)</label>
                  <input 
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={editingPub.revisionNote || ''}
                    onChange={e => setEditingPub(p => ({ ...p, revisionNote: e.target.value }))}
                    placeholder="e.g. Initial baseline benchmark or updated evidence threshold..."
                    className="w-full text-xs p-2.5 border border-line rounded-lg focus:outline-none focus:border-brand-blue disabled:bg-slate-50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Live Map Preview (if toggled) */}
          {showLivePreview && (
            <div className="bg-white border-2 border-brand-purple/40 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-brand-purple" />
                  <h4 className="font-display font-bold text-base text-ink">
                    Live Preview: 37-Jurisdiction Nigeria Map
                  </h4>
                </div>
                <span className="text-xs font-mono text-mut">
                  Click on any state in preview to view details
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8 bg-paper border border-line rounded-xl p-4">
                  <DcmMap 
                    publication={{
                      id: editingPub.id || 'preview',
                      title: editingPub.title || 'Preview',
                      year: Number(editingPub.year) || 2026,
                      month: Number(editingPub.month) || 10,
                      periodIndex: Number(editingPub.periodIndex) || 1,
                      periodStart: editingPub.periodStart || '2026-10-01',
                      periodEnd: editingPub.periodEnd || '2026-10-15',
                      reportingPeriodLabel: editingPub.reportingPeriodLabel || '',
                      publicationDate: editingPub.publicationDate || '',
                      evidenceCutoffDate: editingPub.evidenceCutoffDate || '',
                      methodologyVersion: editingPub.methodologyVersion || 'Version 1.1',
                      status: 'draft',
                      isLatest: false,
                      summary: editingPub.summary || '',
                      classifications: classifications,
                      createdAt: 0,
                      updatedAt: 0
                    }}
                    selectedStateCode={previewSelectedCode}
                    onSelectState={(code) => {
                      setPreviewSelectedCode(code);
                      if (code) {
                        setTimeout(() => {
                          const el = document.getElementById('dcm-cms-selected-state');
                          if (el && window.innerWidth < 1024) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }
                        }, 60);
                      }
                    }}
                    highlightChanges={false}
                    changedStateCodes={new Set<string>()}
                  />
                </div>

                <div 
                  id="dcm-cms-selected-state"
                  className="lg:col-span-4 bg-paper border border-line rounded-xl p-4 space-y-3 scroll-mt-6"
                >
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-mut">
                    Selected State Preview
                  </div>
                  {previewSelectedCode && classifications[previewSelectedCode] ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-display font-bold text-base text-ink">
                          {classifications[previewSelectedCode].stateName}
                        </span>
                        <span className="text-xs font-mono px-2 py-0.5 rounded font-bold" style={{
                          backgroundColor: DCM_COLORS[classifications[previewSelectedCode].classification]?.fill + '20',
                          color: DCM_COLORS[classifications[previewSelectedCode].classification]?.text
                        }}>
                          {classifications[previewSelectedCode].classification}
                        </span>
                      </div>
                      <p className="text-xs text-ink2 leading-relaxed">
                        {classifications[previewSelectedCode].classificationRationale || 'No rationale recorded.'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-mut italic">
                      Click any state on the map to preview its info card.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section 3: 37-Jurisdiction Classification Matrix */}
          <div className="bg-white border border-line rounded-xl p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
              <div>
                <h4 className="font-display font-bold text-base text-ink flex items-center gap-2">
                  <Layers className="w-4 h-4 text-brand-blue" />
                  <span>37-Jurisdiction Classification Matrix</span>
                </h4>
                <p className="text-xs text-mut mt-0.5">
                  All 36 states and the FCT. Every jurisdiction must be assigned a controlled DCM classification.
                </p>
              </div>

              {/* Bulk actions & CSV Tools */}
              <div className="flex items-center gap-2 flex-wrap">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept=".csv,text/csv" 
                  onChange={handleUploadCsvInEditor} 
                  className="hidden" 
                />
                
                <button
                  type="button"
                  onClick={() => handleDownloadAcceptableCsv(classifications, 'current_state_matrix')}
                  className="px-3.5 py-2 rounded-xl bg-paper hover:bg-line text-ink text-xs font-mono font-bold flex items-center gap-1.5 border border-line transition-colors cursor-pointer shadow-xs"
                  title="Download acceptable CSV format pre-populated with all 37 jurisdictions"
                >
                  <Download className="w-3.5 h-3.5 text-brand-blue" />
                  <span>Download Acceptable CSV Format</span>
                </button>

                <button
                  type="button"
                  disabled={isReadOnlyPublishedDaily || (isEditingDaily && Boolean(editingPub.isQuietDay))}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 disabled:opacity-50 text-brand-purple text-xs font-mono font-bold flex items-center gap-1.5 border border-purple-200 transition-colors cursor-pointer shadow-xs"
                  title="Upload CSV to populate all 37 jurisdictions"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-brand-purple" />
                  <span>Upload CSV to Populate States</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowCsvGuide(true)}
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-semibold flex items-center gap-1.5 border border-slate-200 transition-colors cursor-pointer"
                  title="View format guide and accepted values"
                >
                  <Info className="w-3.5 h-3.5 text-slate-500" />
                  <span>Format Guide</span>
                </button>
              </div>
            </div>

            {/* Daily Carry-Forward Status Strip */}
            {isEditingDaily && dailyDiff && (
              <div className="p-3 rounded-xl bg-slate-50 border border-line flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-slate-700">
                    <strong>{dailyDiff.carriedForwardCount}</strong> Carried Forward
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-indigo-700">
                    <strong>{dailyDiff.updatedCount}</strong> Updated in This Draft
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className={dailyDiff.changedCodes.length > 0 ? 'text-amber-800 font-bold' : 'text-emerald-700'}>
                    <strong>{dailyDiff.changedCodes.length}</strong> Classification Change{dailyDiff.changedCodes.length === 1 ? '' : 's'} vs Source
                  </span>
                </div>
                {editingPub.isQuietDay && (
                  <span className="text-teal-800 font-bold">
                    Quiet-Day Lock Active (classifications unchanged)
                  </span>
                )}
              </div>
            )}

            {/* Classification Summary Statistics Banner */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              {DCM_CLASSIFICATIONS.map(cls => {
                const conf = DCM_COLORS[cls];
                return (
                  <div 
                    key={cls}
                    className="p-2.5 rounded-xl border flex flex-col justify-between"
                    style={{ borderColor: conf.fill + '40', backgroundColor: conf.fill + '08' }}
                  >
                    <span className="text-[10px] font-mono font-bold uppercase truncate" style={{ color: conf.text }}>
                      {cls}
                    </span>
                    <div className="flex items-baseline justify-between mt-1">
                      <span className="text-xl font-display font-bold" style={{ color: conf.text }}>
                        {counts[cls]}
                      </span>
                      {!isReadOnlyPublishedDaily && !(isEditingDaily && editingPub.isQuietDay) && (
                        <button
                          type="button"
                          onClick={() => handleBulkSetAll(cls)}
                          className="text-[9px] font-mono underline hover:opacity-80 cursor-pointer"
                          style={{ color: conf.text }}
                        >
                          Set all
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <input 
                type="text"
                placeholder="Search state or code..."
                value={searchState}
                onChange={e => setSearchState(e.target.value)}
                className="w-full sm:w-64 text-xs p-2 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue"
              />

              <select 
                value={zoneFilter}
                onChange={e => setZoneFilter(e.target.value)}
                className="w-full sm:w-44 text-xs p-2 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white"
              >
                <option value="all">All Zones (6)</option>
                {uniqueZones.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>

              <select 
                value={classFilter}
                onChange={e => setClassFilter(e.target.value)}
                className="w-full sm:w-56 text-xs p-2 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white"
              >
                <option value="all">All Classifications (5)</option>
                {DCM_CLASSIFICATIONS.map(cls => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>

              <div className="ml-auto text-xs font-mono text-mut">
                Showing {filteredJurisdictions.length} of 37 states
              </div>
            </div>

            {/* 37-Jurisdiction Table */}
            <div className="overflow-x-auto border border-line rounded-xl max-h-[550px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-paper border-b border-line sticky top-0 z-10 font-mono text-[10px] text-mut uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Code / State</th>
                    <th className="py-2.5 px-3">Geopolitical Zone</th>
                    {isEditingDaily && <th className="py-2.5 px-3 min-w-[130px]">Basis</th>}
                    <th className="py-2.5 px-3 min-w-[170px]">Classification</th>
                    <th className="py-2.5 px-3 min-w-[150px]">Direction</th>
                    <th className="py-2.5 px-3 min-w-[110px]">Confidence</th>
                    <th className="py-2.5 px-3 min-w-[240px]">Key Finding / Rationale</th>
                    <th className="py-2.5 px-3 min-w-[160px]">Right of Response</th>
                    {isEditingDaily && <th className="py-2.5 px-3 min-w-[140px]">Last Substantive Review</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredJurisdictions.map(j => {
                    const rec = classifications[j.code] || {
                      stateCode: j.code,
                      stateName: j.name,
                      classification: 'Insufficient evidence',
                      direction: 'insufficient-basis',
                      confidence: 'Low',
                      keyFinding: '',
                      classificationRationale: '',
                      evidenceSummary: '',
                      rightOfResponseStatus: 'Not required',
                      carriedForward: false
                    };

                    const colorConf = DCM_COLORS[rec.classification];
                    const rowLocked = isReadOnlyPublishedDaily || (isEditingDaily && Boolean(editingPub.isQuietDay));

                    return (
                      <tr key={j.code} className="hover:bg-paper/60 transition-colors">
                        <td className="py-2 px-3 font-semibold whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] bg-line/80 px-1.5 py-0.5 rounded font-bold text-ink2">
                              {j.code}
                            </span>
                            <span className="text-ink">{j.name}</span>
                          </div>
                        </td>

                        <td className="py-2 px-3 text-mut font-mono text-[11px] whitespace-nowrap">
                          {j.zone}
                        </td>

                        {isEditingDaily && (
                          <td className="py-2 px-3 whitespace-nowrap">
                            {rec.carriedForward ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                Carried forward
                              </span>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                                  Updated
                                </span>
                                {!rowLocked && carryForwardSourcePub && (
                                  <button
                                    type="button"
                                    onClick={() => handleRevertStateToCarriedForward(j.code)}
                                    className="text-[10px] font-mono text-mut hover:text-brand-blue underline cursor-pointer"
                                    title="Restore carried-forward approved classification"
                                  >
                                    Revert
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        )}

                        <td className="py-2 px-3">
                          <select 
                            disabled={rowLocked}
                            value={rec.classification}
                            onChange={e => handleClassificationChange(j.code, e.target.value as DcmClassification)}
                            className="w-full text-xs py-1.5 px-2 border rounded-lg font-semibold font-mono focus:outline-none disabled:opacity-75 disabled:cursor-not-allowed"
                            style={{
                              borderColor: colorConf?.fill || '#CBD5E1',
                              backgroundColor: (colorConf?.fill || '#64748B') + '15',
                              color: colorConf?.text || '#1E293B'
                            }}
                          >
                            {DCM_CLASSIFICATIONS.map(cls => (
                              <option key={cls} value={cls} className="bg-white text-ink">
                                {cls}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2 px-3">
                          <select 
                            disabled={rowLocked}
                            value={rec.direction || (rec.classification === 'Insufficient evidence' ? 'insufficient-basis' : 'unchanged')}
                            onChange={e => handleStateFieldChange(j.code, 'direction', e.target.value)}
                            className="w-full text-xs py-1.5 px-2 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                          >
                            {DCM_DIRECTIONS.map(d => (
                              <option key={d.value} value={d.value}>{d.label}</option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2 px-3">
                          <select 
                            disabled={rowLocked}
                            value={rec.confidence || (rec.classification === 'Insufficient evidence' ? 'Low' : 'Medium')}
                            onChange={e => handleStateFieldChange(j.code, 'confidence', e.target.value)}
                            className="w-full text-xs py-1.5 px-2 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                          >
                            {DCM_CONFIDENCE_LEVELS.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </td>

                        <td className="py-2 px-3">
                          <input 
                            type="text"
                            disabled={rowLocked}
                            value={rec.keyFinding || rec.classificationRationale || ''}
                            onChange={e => {
                              handleStateFieldChange(j.code, 'keyFinding', e.target.value);
                              handleStateFieldChange(j.code, 'classificationRationale', e.target.value);
                            }}
                            placeholder="Key finding or decision rationale..."
                            className="w-full text-xs p-1.5 border border-line rounded-lg focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                          />
                        </td>

                        <td className="py-2 px-3">
                          <select 
                            disabled={rowLocked}
                            value={rec.rightOfResponseStatus || 'Not required'}
                            onChange={e => handleStateFieldChange(j.code, 'rightOfResponseStatus', e.target.value)}
                            className="w-full text-[11px] p-1.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                          >
                            {RIGHT_OF_RESPONSE_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </td>

                        {isEditingDaily && (
                          <td className="py-2 px-3">
                            <input
                              type="date"
                              disabled={isReadOnlyPublishedDaily}
                              value={rec.lastSubstantiveReviewDate || ''}
                              onChange={e => handleStateFieldChange(j.code, 'lastSubstantiveReviewDate', e.target.value)}
                              title="Date of last substantive state review (only enter where supplied by Research)"
                              className="w-full text-[11px] p-1.5 border border-line rounded-lg font-mono focus:outline-none focus:border-brand-blue bg-white disabled:bg-slate-50"
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Section 4: Pre-Release Consistency Checks & Research Approval Gate (Applies to Daily & Legacy Releases) */}
            <div className="bg-slate-50 border border-indigo-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-indigo-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-indigo-700" />
                  <h4 className="font-display font-bold text-sm text-ink uppercase tracking-wider">
                    Pre-Release Consistency Check &amp; Research Approval Gate
                  </h4>
                </div>
                <span className="text-[11px] font-mono text-indigo-800">
                  Documented Research approval reference &amp; signed-in admin record required to publish
                </span>
              </div>

              {/* Review Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="bg-white border border-line rounded-lg p-3 space-y-0.5">
                  <div className="text-[10px] font-mono uppercase text-mut">
                    {isEditingDaily ? 'Assessment Date' : 'Reporting Period'}
                  </div>
                  <div className="font-bold text-ink">
                    {isEditingDaily
                      ? (editingPub.assessmentDate ? formatDailyDateLabel(editingPub.assessmentDate) : 'Not set')
                      : (editingPub.reportingPeriodLabel || 'Not set')}
                  </div>
                </div>
                <div className="bg-white border border-line rounded-lg p-3 space-y-0.5">
                  <div className="text-[10px] font-mono uppercase text-mut">
                    {isEditingDaily ? 'Evidence Cut-Off (WAT)' : 'Evidence Cut-Off'}
                  </div>
                  <div className="font-bold text-indigo-800">
                    {isEditingDaily
                      ? (dailyWatPreview?.valid ? dailyWatPreview.displayLabel : 'Invalid / Missing')
                      : (editingPub.evidenceCutoffDate || 'Not set')}
                  </div>
                </div>
                <div className="bg-white border border-line rounded-lg p-3 space-y-0.5">
                  <div className="text-[10px] font-mono uppercase text-mut">Consistency Audit</div>
                  <div className={`font-bold ${liveConsistencyAudit?.consistent ? 'text-emerald-700' : 'text-red-700'}`}>
                    {liveConsistencyAudit?.consistent
                      ? `${liveConsistencyAudit.stats.classifiedCount}/37 Verified · Map/Card Parity OK`
                      : `${liveConsistencyAudit?.errors.length || 0} consistency error(s)`}
                  </div>
                </div>
                <div className="bg-white border border-line rounded-lg p-3 space-y-0.5">
                  <div className="text-[10px] font-mono uppercase text-mut">Approved Summary</div>
                  <div className={`font-bold ${(editingPub.summary || '').trim().length >= 10 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {(editingPub.summary || '').trim().length >= 10 ? 'Entered (Ready for review)' : 'Missing / Too short'}
                  </div>
                </div>
              </div>

              {/* Transparent Missing-Evidence Audit Note */}
              {liveConsistencyAudit && liveConsistencyAudit.warnings.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-900 space-y-1">
                  <div className="font-mono font-bold uppercase tracking-wider text-amber-800">
                    Public Evidence Transparency Notice
                  </div>
                  {liveConsistencyAudit.warnings.map((w, idx) => (
                    <p key={idx} className="leading-relaxed">{w}</p>
                  ))}
                </div>
              )}

              {/* Explicit Non-Verification Disclosure */}
              <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg p-3 text-[11px] text-indigo-950 flex items-start gap-2">
                <Info className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5 leading-relaxed">
                  <p>
                    <strong>Administrative record notice:</strong> Entering a Research approver name is an administrative record only and is <strong>not</strong> independent verification that Research approval occurred. A documented Research approval reference (e.g. memo, email log, or sign-off ticket ID) is mandatory prior to publication.
                  </p>
                  <p className="font-mono text-[10px] text-indigo-800">
                    Recording Administrator Identity:{' '}
                    <strong>{auth.currentUser?.email || auth.currentUser?.uid || 'Not signed in'}</strong>
                    {' '}· Timestamp stamped automatically on save.
                  </p>
                </div>
              </div>

              {/* Approval Record Form */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">
                    Documented Research Approval Reference <span className="text-red-600">* (Required to Approve / Publish)</span>
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={approvalReference}
                    onChange={e => setApprovalReference(e.target.value)}
                    placeholder="e.g. AEO-RES-2026-11-19 or Memo/Sign-Off ID"
                    className="w-full text-xs p-2.5 border border-line rounded-lg bg-white font-mono focus:outline-none focus:border-brand-blue disabled:bg-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] font-mono font-bold uppercase text-mut">
                    Recorded Research Approver Name <span className="text-red-600">* (Administrative Record)</span>
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnlyPublishedDaily}
                    value={approverName}
                    onChange={e => setApproverName(e.target.value)}
                    placeholder="e.g. Dr. Amina Bello — Head of Research"
                    className="w-full text-xs p-2.5 border border-line rounded-lg bg-white focus:outline-none focus:border-brand-blue disabled:bg-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-start gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="dcm-research-approval-confirm"
                  disabled={isReadOnlyPublishedDaily}
                  checked={approvalConfirmed}
                  onChange={e => setApprovalConfirmed(e.target.checked)}
                  className="rounded text-indigo-700 focus:ring-indigo-600 w-4 h-4 mt-0.5 cursor-pointer disabled:cursor-not-allowed"
                />
                <label htmlFor="dcm-research-approval-confirm" className="text-xs text-ink cursor-pointer">
                  <span className="font-bold">Record Documented Research Approval</span>
                  <span className="block text-[11px] text-mut mt-0.5">
                    I confirm that this publication summary, evidence cut-off, and all 37 state classifications match the documented Research approval reference above. My administrator UID and timestamp will be stored with this record, and once published it will be locked against overwrite or deletion.
                  </span>
                </label>
              </div>

              {isEditingDaily && !isReadOnlyPublishedDaily && (
                <div className="flex items-center justify-end gap-2.5 flex-wrap pt-2 border-t border-indigo-100">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveDaily('draft')}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider bg-white hover:bg-slate-100 text-ink border border-slate-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Draft</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving || !approvalConfirmed || approverName.trim().length < 2 || approvalReference.trim().length < 3}
                    onClick={() => handleSaveDaily('approved')}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>Save as Approved</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving || !approvalConfirmed || approverName.trim().length < 2 || approvalReference.trim().length < 3}
                    onClick={() => handleSaveDaily('published')}
                    className="px-5 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider bg-brand-green hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Publishing...' : 'Publish Daily Update'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="flex items-center justify-between pt-3 border-t border-line">
              <div className="text-xs font-mono text-mut">
                Status: <span className="font-bold text-ink">{counts['Open'] + counts['Emerging concern'] + counts['Constrained'] + counts['Severely constrained'] + counts['Insufficient evidence']} / 37</span> States Accounted For
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 text-xs font-mono font-semibold text-mut hover:text-ink cursor-pointer"
                >
                  {isReadOnlyPublishedDaily ? 'Close' : 'Cancel'}
                </button>
                {!isEditingDaily && !isReadOnlyPublishedDaily && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                    className="px-6 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider bg-brand-green hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving...' : 'Save Publication'}</span>
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Acceptable CSV Format Guide Modal */}
      {showCsvGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-line">
            {/* Modal Header */}
            <div className="p-5 border-b border-line flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-brand-blue">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-ink">
                    Acceptable DCM CSV Format Guide
                  </h3>
                  <p className="text-xs text-mut">
                    Data specification for bulk uploading 37-jurisdiction classifications
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowCsvGuide(false)}
                className="p-1.5 text-mut hover:text-ink hover:bg-line rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-ink text-xs">
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 space-y-1.5 text-blue-900">
                <div className="font-bold font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5 text-brand-blue">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>37 Jurisdictions Supported</span>
                </div>
                <p className="leading-relaxed">
                  The DCM parser automatically maps all 36 Nigerian States and the Federal Capital Territory (FCT). Rows match either by 2-letter state code (<code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">state_code</code>) or official name (<code className="bg-blue-100 px-1 py-0.5 rounded font-mono font-bold">state_name</code>).
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-mono font-bold text-[11px] uppercase tracking-wider text-mut">
                  Required & Supported CSV Columns
                </h4>
                <div className="border border-line rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-paper border-b border-line text-[10px] font-mono uppercase text-mut">
                      <tr>
                        <th className="py-2.5 px-3">Column Name</th>
                        <th className="py-2.5 px-3">Required?</th>
                        <th className="py-2.5 px-3">Allowed Values / Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-xs font-mono">
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">state_code</td>
                        <td className="py-2.5 px-3 text-emerald-700 font-bold">Required*</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          2-letter state code: e.g. <code className="font-mono bg-paper px-1 rounded">AB</code>, <code className="font-mono bg-paper px-1 rounded">KD</code>, <code className="font-mono bg-paper px-1 rounded">LA</code>, <code className="font-mono bg-paper px-1 rounded">FC</code>. (*Either state_code or state_name is required).
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">state_name</td>
                        <td className="py-2.5 px-3 text-emerald-700 font-bold">Required*</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          State name: e.g. <code className="font-mono bg-paper px-1 rounded">Abia</code>, <code className="font-mono bg-paper px-1 rounded">Kaduna</code>, <code className="font-mono bg-paper px-1 rounded">Lagos</code>, <code className="font-mono bg-paper px-1 rounded">FCT</code>.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">classification</td>
                        <td className="py-2.5 px-3 text-red-700 font-bold">Required</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          Accepts full name or single letter code:
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1.5">
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#3e9a62]"></span> <strong>Open</strong> or <code className="font-mono">G</code></span>
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#f6cd5c]"></span> <strong>Emerging concern</strong> or <code className="font-mono">A</code></span>
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#e5822a]"></span> <strong>Constrained</strong> or <code className="font-mono">O</code></span>
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#8f1d17]"></span> <strong>Severely constrained</strong> or <code className="font-mono">R</code></span>
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#c9cdd2]"></span> <strong>Insufficient evidence</strong> or <code className="font-mono">X</code></span>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">direction</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          Trajectory of competition space: <code className="font-mono bg-paper px-1 rounded">newly-classified</code>, <code className="font-mono bg-paper px-1 rounded">deteriorating</code>, <code className="font-mono bg-paper px-1 rounded">insufficient-basis</code>, <code className="font-mono bg-paper px-1 rounded">improving</code>, <code className="font-mono bg-paper px-1 rounded">stable</code>.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">confidence</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          Evidence certainty level: <code className="font-mono bg-paper px-1 rounded">High</code>, <code className="font-mono bg-paper px-1 rounded">Medium</code>, <code className="font-mono bg-paper px-1 rounded">Low</code>.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">key_finding</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          Primary observation or incident summary displayed in Flourish hover cards (e.g. tear gas usage, rally denials, assembly access).
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">rationale</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          1–3 sentences justifying the assigned classification level.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">evidence_summary</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          Summary of incident reports, INEC forms, court rulings, or audit citations.
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-3 font-bold text-brand-blue">right_of_response</td>
                        <td className="py-2.5 px-3 text-mut">Optional</td>
                        <td className="py-2.5 px-3 text-ink2 font-sans">
                          One of: <code className="font-mono text-[10px]">Not required</code>, <code className="font-mono text-[10px]">Requested – Pending</code>, <code className="font-mono text-[10px]">Received & incorporated</code>, <code className="font-mono text-[10px]">Refused / No response</code>.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-paper p-3.5 rounded-xl border border-line space-y-1.5 font-mono text-[11px]">
                <div className="font-bold text-ink text-xs uppercase tracking-wider">Example CSV Snippet:</div>
                <pre className="text-slate-700 whitespace-pre overflow-x-auto p-2 bg-white rounded border border-line">
{`state_code,state_name,classification,direction,confidence,key_finding,rationale,evidence_summary,right_of_response
"KD","Kaduna","Emerging concern","newly-classified","Medium","Police confirm using tear gas at the ADC launch; supporters allege attacks.","Police confirm using tear gas at the ADC launch; supporters allege attacks.","ADC launch incident 28 Sep","Requested"
"BN","Benue","Constrained","deteriorating","High","Systemic access restrictions for opposition observers","Material restrictions across LGAs","Audited in report APEA-2026","Received & incorporated"
"FC","FCT","Open","stable","High","Unimpeded access across all 6 area councils","Full open political competition","Observer report","Not required"`}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-line bg-paper flex items-center justify-between gap-3">
              <span className="text-[11px] font-mono text-mut">
                Click below to download the pre-populated template with all 37 jurisdictions.
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCsvGuide(false)}
                  className="px-4 py-2 text-xs font-mono font-semibold text-mut hover:text-ink cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadAcceptableCsv(undefined, 'blank_template')}
                  className="px-4 py-2 rounded-xl text-xs font-mono font-bold tracking-wider uppercase bg-brand-blue hover:bg-brand-blue-dark text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Acceptable CSV Format</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

