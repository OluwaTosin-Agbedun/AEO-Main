import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  EyeOff,
  FileCheck2,
  FileText,
  GitBranch,
  Globe,
  Info,
  Lock,
  Plus,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import { useCMS } from '../context/CMSContext';
import { auth } from '../lib/firebase';
import {
  DCM_EVIDENCE_VERIFICATION_STATUSES,
  DcmEvidenceRecord,
  DcmEvidenceVerificationStatus,
  DcmEvidenceVisibility,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPrivateNoteRecord,
  DcmRecordPublishStatus,
  DcmSourceReference,
  NIGERIA_37_JURISDICTIONS
} from '../types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../data/dcmInitialData';
import { getPublishedDcmSorted } from '../utils/dcmComparison';
import {
  createDevelopmentCorrectionDraft,
  createEvidenceCorrectionDraft,
  createIncidentCorrectionDraft,
  formatIsoDateShort,
  sanitizeExternalUrl,
  validateEvidenceRecord,
  validateIncidentDevelopment,
  validateIncidentRecord,
  validatePrivateNoteRecord
} from '../utils/dcmEvidence';

export interface DcmEvidenceCmsManagerProps {
  mode: 'evidence' | 'incidents';
}

function generateUniqueRecordId(prefix: string, stateCode: string, existingIds: string[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const base = `${prefix}-${stateCode.toLowerCase()}-${today}`;
  const existing = new Set(existingIds);
  let seq = 1;
  while (existing.has(`${base}-${String(seq).padStart(2, '0')}`)) {
    seq++;
  }
  return `${base}-${String(seq).padStart(2, '0')}`;
}

export const DcmEvidenceCmsManager: React.FC<DcmEvidenceCmsManagerProps> = ({ mode }) => {
  const {
    dcmPublications,
    dcmEvidence,
    dcmIncidents,
    dcmIncidentDevelopments,
    dcmPrivateNotes,
    saveDcmEvidence,
    deleteDcmEvidence,
    saveDcmIncident,
    deleteDcmIncident,
    saveDcmIncidentDevelopment,
    deleteDcmIncidentDevelopment,
    saveDcmPrivateNote,
    deleteDcmPrivateNote
  } = useCMS();

  const publishedEditions = useMemo(() => {
    const source = dcmPublications && dcmPublications.length > 0 ? dcmPublications : INITIAL_DCM_PUBLICATIONS;
    return [...getPublishedDcmSorted(source)].reverse();
  }, [dcmPublications]);

  // Shared UI status & filter state
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [visibilityFilter, setVisibilityFilter] = useState<string>('ALL');
  const [statusBanner, setStatusBanner] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Evidence editor state
  const [editingEvidence, setEditingEvidence] = useState<Partial<DcmEvidenceRecord> | null>(null);
  const [editingEvidenceExistingId, setEditingEvidenceExistingId] = useState<string | null>(null);

  // Incident editor state
  const [editingIncident, setEditingIncident] = useState<Partial<DcmIncidentRecord> | null>(null);
  const [editingIncidentExistingId, setEditingIncidentExistingId] = useState<string | null>(null);
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(null);

  // Incident Development editor state
  const [editingDev, setEditingDev] = useState<Partial<DcmIncidentDevelopment> | null>(null);
  const [editingDevExistingId, setEditingDevExistingId] = useState<string | null>(null);

  // Shared approval fields for active editor
  const [approvalRef, setApprovalRef] = useState<string>('');
  const [approverName, setApproverName] = useState<string>('');
  const [approvalConfirmed, setApprovalConfirmed] = useState<boolean>(false);

  // Separate Admin-Only Confidential Note drawer state (`/dcm_private_notes`)
  const [privateNoteTarget, setPrivateNoteTarget] = useState<{
    targetType: DcmPrivateNoteRecord['targetType'];
    targetId: string;
    stateCode: string;
    label: string;
  } | null>(null);
  const [noteText, setNoteText] = useState<string>('');
  const [noteContacts, setNoteContacts] = useState<string>('');
  const [noteLeads, setNoteLeads] = useState<string>('');
  const [savingNote, setSavingNote] = useState<boolean>(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    kind: 'evidence' | 'incident' | 'development';
    id: string;
    title: string;
    isPublished: boolean;
  } | null>(null);
  const [confirmPublishedDelete, setConfirmPublishedDelete] = useState<boolean>(false);
  const [isDeletingRecord, setIsDeletingRecord] = useState<boolean>(false);

  const showBanner = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusBanner({ text, type });
    setTimeout(() => setStatusBanner(null), 7000);
  };

  const resetApprovalFields = (record?: { approvalRecord?: { approvalReference?: string; approvedByName?: string; approved?: boolean } } | null) => {
    setApprovalRef(record?.approvalRecord?.approvalReference || '');
    setApproverName(record?.approvalRecord?.approvedByName || '');
    setApprovalConfirmed(Boolean(record?.approvalRecord?.approved));
  };

  const buildApprovalPayload = (existingApprovedAt?: string) => {
    const currentUid = auth.currentUser?.uid || '';
    const currentEmail = auth.currentUser?.email || undefined;
    const nowIso = new Date().toISOString();
    if (!approvalConfirmed) {
      return undefined;
    }
    return {
      approved: true,
      approvalReference: approvalRef.trim(),
      approvedByName: approverName.trim(),
      approvedAt: existingApprovedAt || nowIso,
      recordedByUid: currentUid,
      recordedByEmail: currentEmail,
      recordedAt: nowIso,
      approvedByUid: currentUid,
      approvedByEmail: currentEmail,
      verificationMode: 'admin-recorded-reference' as const
    };
  };

  // Open separate admin-only private notes editor for an evidence or incident record
  const openPrivateNotes = (
    targetType: DcmPrivateNoteRecord['targetType'],
    targetId: string,
    stateCode: string,
    label: string
  ) => {
    const existing = dcmPrivateNotes.find(
      (n) => n.targetType === targetType && n.targetId === targetId
    );
    setPrivateNoteTarget({ targetType, targetId, stateCode, label });
    setNoteText(existing?.confidentialNotes || '');
    setNoteContacts(existing?.confidentialContacts || '');
    setNoteLeads(existing?.unverifiedLeads || '');
  };

  const handleSavePrivateNote = async () => {
    if (!privateNoteTarget || savingNote) return;
    const currentUid = auth.currentUser?.uid || '';
    const existing = dcmPrivateNotes.find(
      (n) => n.targetType === privateNoteTarget.targetType && n.targetId === privateNoteTarget.targetId
    );
    const noteId = existing?.id || `pnote-${privateNoteTarget.targetType}-${privateNoteTarget.targetId}`.slice(0, 120);
    const candidate: DcmPrivateNoteRecord = {
      id: noteId,
      targetType: privateNoteTarget.targetType,
      targetId: privateNoteTarget.targetId,
      stateCode: privateNoteTarget.stateCode,
      confidentialNotes: noteText.trim(),
      confidentialContacts: noteContacts.trim() || undefined,
      unverifiedLeads: noteLeads.trim() || undefined,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: existing?.createdByUid || currentUid,
      updatedByUid: currentUid
    };

    const validation = validatePrivateNoteRecord(candidate, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined
    });
    if (!validation.valid) {
      showBanner(validation.errors[0], 'error');
      return;
    }

    setSavingNote(true);
    try {
      await saveDcmPrivateNote(candidate);
      showBanner(`Confidential notes saved securely to /dcm_private_notes/${candidate.id} (admin-only).`);
      setPrivateNoteTarget(null);
    } catch (err: any) {
      showBanner(`Failed to save confidential notes: ${err.message}`, 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeletePrivateNote = async () => {
    if (!privateNoteTarget) return;
    const existing = dcmPrivateNotes.find(
      (n) => n.targetType === privateNoteTarget.targetType && n.targetId === privateNoteTarget.targetId
    );
    if (!existing) {
      setPrivateNoteTarget(null);
      return;
    }
    try {
      await deleteDcmPrivateNote(existing.id);
      showBanner('Confidential note deleted from /dcm_private_notes.');
      setPrivateNoteTarget(null);
    } catch (err: any) {
      showBanner(`Failed to delete confidential note: ${err.message}`, 'error');
    }
  };

  // =========================================================================
  // EVIDENCE HANDLERS
  // =========================================================================

  const filteredEvidence = useMemo(() => {
    return dcmEvidence.filter((ev) => {
      if (stateFilter !== 'ALL' && ev.stateCode !== stateFilter) return false;
      if (statusFilter !== 'ALL' && ev.status !== statusFilter) return false;
      if (visibilityFilter !== 'ALL' && ev.visibility !== visibilityFilter) return false;
      return true;
    });
  }, [dcmEvidence, stateFilter, statusFilter, visibilityFilter]);

  const existingEvidenceDoc = useMemo(() => {
    if (!editingEvidenceExistingId) return null;
    return dcmEvidence.find((e) => e.id === editingEvidenceExistingId) || null;
  }, [dcmEvidence, editingEvidenceExistingId]);

  const isEvidenceReadOnly = Boolean(existingEvidenceDoc && existingEvidenceDoc.status === 'published');

  const handleNewEvidence = () => {
    const defaultState = stateFilter !== 'ALL' ? stateFilter : 'LA';
    const meta = NIGERIA_37_JURISDICTIONS.find((j) => j.code === defaultState) || NIGERIA_37_JURISDICTIONS[0];
    const newId = generateUniqueRecordId('ev', meta.code, dcmEvidence.map((e) => e.id));
    const latestPubId = publishedEditions[0]?.id;

    setEditingEvidence({
      id: newId,
      stateCode: meta.code,
      stateName: meta.name,
      incidentId: '',
      linkedPublicationIds: latestPubId ? [latestPubId] : [],
      title: '',
      publicDescription: '',
      sourceName: '',
      sourcePublicationDate: new Date().toISOString().slice(0, 10),
      sourceUrl: '',
      documentReference: '',
      verificationStatus: 'Verified by Research',
      isDisputed: false,
      disputedClaimNote: '',
      institutionalResponse: {
        requested: false,
        requestedDate: '',
        received: false,
        responseDate: '',
        respondentName: '',
        publicSummary: ''
      },
      visibility: 'private',
      status: 'draft'
    });
    setEditingEvidenceExistingId(null);
    resetApprovalFields(null);
    setValidationErrors([]);
  };

  const handleEditEvidence = (ev: DcmEvidenceRecord) => {
    setEditingEvidence({
      ...ev,
      linkedPublicationIds: Array.isArray(ev.linkedPublicationIds) ? [...ev.linkedPublicationIds] : [],
      institutionalResponse: ev.institutionalResponse
        ? { ...ev.institutionalResponse }
        : {
            requested: false,
            requestedDate: '',
            received: false,
            responseDate: '',
            respondentName: '',
            publicSummary: ''
          }
    });
    setEditingEvidenceExistingId(ev.id);
    resetApprovalFields(ev);
    setValidationErrors([]);
  };

  const handleIssueEvidenceCorrection = (publishedEv: DcmEvidenceRecord) => {
    const draft = createEvidenceCorrectionDraft(
      publishedEv,
      dcmEvidence.map((e) => e.id),
      auth.currentUser?.uid
    );
    setEditingEvidence(draft);
    setEditingEvidenceExistingId(null);
    resetApprovalFields(null);
    setValidationErrors([]);
    showBanner(
      `Created corrected revision draft "${draft.id}" superseding "${publishedEv.id}". The original published record remains preserved.`
    );
  };

  const handleSaveEvidenceAction = async (targetStatus: DcmRecordPublishStatus) => {
    if (!editingEvidence || isSaving || isEvidenceReadOnly) return;
    const stateMeta = NIGERIA_37_JURISDICTIONS.find((j) => j.code === editingEvidence.stateCode);
    const currentUid = auth.currentUser?.uid || '';
    const nowIso = new Date().toISOString();
    const approvalRecord = buildApprovalPayload(editingEvidence.approvalRecord?.approvedAt);

    const resp = editingEvidence.institutionalResponse;
    const hasRespContent = Boolean(
      resp && (resp.requested || resp.received || (resp.publicSummary || '').trim() || (resp.respondentName || '').trim())
    );

    const candidate: DcmEvidenceRecord = {
      id: (editingEvidence.id || '').trim(),
      stateCode: editingEvidence.stateCode || '',
      stateName: stateMeta?.name || editingEvidence.stateName || '',
      incidentId: (editingEvidence.incidentId || '').trim() || undefined,
      linkedPublicationIds: Array.isArray(editingEvidence.linkedPublicationIds)
        ? editingEvidence.linkedPublicationIds
        : [],
      title: (editingEvidence.title || '').trim(),
      publicDescription: (editingEvidence.publicDescription || '').trim(),
      sourceName: (editingEvidence.sourceName || '').trim(),
      sourcePublicationDate: (editingEvidence.sourcePublicationDate || '').trim(),
      sourceUrl: (editingEvidence.sourceUrl || '').trim() || undefined,
      documentReference: (editingEvidence.documentReference || '').trim() || undefined,
      verificationStatus:
        (editingEvidence.verificationStatus as DcmEvidenceVerificationStatus) || 'Verified by Research',
      isDisputed: Boolean(editingEvidence.isDisputed),
      disputedClaimNote: editingEvidence.isDisputed
        ? (editingEvidence.disputedClaimNote || '').trim() || undefined
        : undefined,
      institutionalResponse: hasRespContent
        ? {
            requested: Boolean(resp?.requested),
            requestedDate: (resp?.requestedDate || '').trim() || undefined,
            received: Boolean(resp?.received),
            responseDate: (resp?.responseDate || '').trim() || undefined,
            respondentName: (resp?.respondentName || '').trim() || undefined,
            publicSummary: (resp?.publicSummary || '').trim() || undefined
          }
        : undefined,
      visibility: (editingEvidence.visibility as DcmEvidenceVisibility) || 'private',
      status: targetStatus,
      approvalRecord,
      supersedesEvidenceId: editingEvidence.supersedesEvidenceId,
      revisionNumber: editingEvidence.revisionNumber || 1,
      publishedAt: targetStatus === 'published' ? nowIso : undefined,
      createdAt: editingEvidence.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: editingEvidence.createdByUid || currentUid || undefined,
      updatedByUid: currentUid || undefined
    };

    const validation = validateEvidenceRecord(candidate, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined,
      existingDoc: existingEvidenceDoc
    });

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      showBanner('Please resolve the validation errors before saving.', 'error');
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);
    try {
      await saveDcmEvidence(candidate);
      const label =
        targetStatus === 'published'
          ? candidate.visibility === 'public'
            ? 'published publicly (immutable)'
            : 'published as Private (hidden from public site)'
          : targetStatus === 'approved'
          ? 'saved as Research-Approved (not yet published)'
          : 'saved as a private Draft';
      showBanner(`Evidence record "${candidate.id}" ${label}.`);
      setEditingEvidence(null);
      setEditingEvidenceExistingId(null);
    } catch (err: any) {
      showBanner(`Failed to save evidence record: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvidenceAction = (ev: DcmEvidenceRecord) => {
    setDeleteConfirmTarget({
      kind: 'evidence',
      id: ev.id,
      title: ev.title,
      isPublished: ev.status === 'published'
    });
    setConfirmPublishedDelete(false);
  };

  const handleConfirmDeleteRecord = async () => {
    if (!deleteConfirmTarget || isDeletingRecord) return;
    if (deleteConfirmTarget.isPublished && !confirmPublishedDelete) return;

    const target = deleteConfirmTarget;
    setIsDeletingRecord(true);
    try {
      if (target.kind === 'evidence') {
        await deleteDcmEvidence(target.id);
        if (editingEvidenceExistingId === target.id) {
          setEditingEvidence(null);
          setEditingEvidenceExistingId(null);
        }
        showBanner(`Deleted evidence record "${target.id}".`);
      } else if (target.kind === 'incident') {
        await deleteDcmIncident(target.id);
        if (editingIncidentExistingId === target.id) {
          setEditingIncident(null);
          setEditingIncidentExistingId(null);
        }
        showBanner(`Deleted incident record "${target.id}".`);
      } else {
        await deleteDcmIncidentDevelopment(target.id);
        if (editingDevExistingId === target.id) {
          setEditingDev(null);
          setEditingDevExistingId(null);
        }
        showBanner(`Deleted incident development "${target.id}".`);
      }
      setDeleteConfirmTarget(null);
      setConfirmPublishedDelete(false);
    } catch (err: any) {
      showBanner(`Failed to delete ${target.kind}: ${err.message}`, 'error');
    } finally {
      setIsDeletingRecord(false);
    }
  };

  // =========================================================================
  // INCIDENT & DEVELOPMENT HANDLERS
  // =========================================================================

  const filteredIncidents = useMemo(() => {
    return dcmIncidents.filter((inc) => {
      if (stateFilter !== 'ALL' && inc.stateCode !== stateFilter) return false;
      if (statusFilter !== 'ALL' && inc.status !== statusFilter) return false;
      if (visibilityFilter !== 'ALL' && inc.visibility !== visibilityFilter) return false;
      return true;
    });
  }, [dcmIncidents, stateFilter, statusFilter, visibilityFilter]);

  const existingIncidentDoc = useMemo(() => {
    if (!editingIncidentExistingId) return null;
    return dcmIncidents.find((i) => i.id === editingIncidentExistingId) || null;
  }, [dcmIncidents, editingIncidentExistingId]);

  const isIncidentReadOnly = Boolean(existingIncidentDoc && existingIncidentDoc.status === 'published');

  const existingDevDoc = useMemo(() => {
    if (!editingDevExistingId) return null;
    return dcmIncidentDevelopments.find((d) => d.id === editingDevExistingId) || null;
  }, [dcmIncidentDevelopments, editingDevExistingId]);

  const isDevReadOnly = Boolean(existingDevDoc && existingDevDoc.status === 'published');

  const handleNewIncident = () => {
    const defaultState = stateFilter !== 'ALL' ? stateFilter : 'LA';
    const meta = NIGERIA_37_JURISDICTIONS.find((j) => j.code === defaultState) || NIGERIA_37_JURISDICTIONS[0];
    const newId = generateUniqueRecordId('inc', meta.code, dcmIncidents.map((i) => i.id));
    const latestPubId = publishedEditions[0]?.id;

    setEditingIncident({
      id: newId,
      stateCode: meta.code,
      stateName: meta.name,
      title: '',
      summary: '',
      researchStatusLabel: 'Under Research monitoring',
      firstReportedDate: new Date().toISOString().slice(0, 10),
      linkedPublicationIds: latestPubId ? [latestPubId] : [],
      visibility: 'private',
      status: 'draft'
    });
    setEditingIncidentExistingId(null);
    setEditingDev(null);
    resetApprovalFields(null);
    setValidationErrors([]);
  };

  const handleEditIncident = (inc: DcmIncidentRecord) => {
    setEditingIncident({
      ...inc,
      linkedPublicationIds: Array.isArray(inc.linkedPublicationIds) ? [...inc.linkedPublicationIds] : []
    });
    setEditingIncidentExistingId(inc.id);
    setEditingDev(null);
    resetApprovalFields(inc);
    setValidationErrors([]);
  };

  const handleIssueIncidentCorrection = (publishedInc: DcmIncidentRecord) => {
    const draft = createIncidentCorrectionDraft(
      publishedInc,
      dcmIncidents.map((i) => i.id),
      auth.currentUser?.uid
    );
    setEditingIncident(draft);
    setEditingIncidentExistingId(null);
    setEditingDev(null);
    resetApprovalFields(null);
    setValidationErrors([]);
    showBanner(`Created incident correction draft "${draft.id}" superseding "${publishedInc.id}".`);
  };

  const handleSaveIncidentAction = async (targetStatus: DcmRecordPublishStatus) => {
    if (!editingIncident || isSaving || isIncidentReadOnly) return;
    const stateMeta = NIGERIA_37_JURISDICTIONS.find((j) => j.code === editingIncident.stateCode);
    const currentUid = auth.currentUser?.uid || '';
    const nowIso = new Date().toISOString();
    const approvalRecord = buildApprovalPayload(editingIncident.approvalRecord?.approvedAt);

    const candidate: DcmIncidentRecord = {
      id: (editingIncident.id || '').trim(),
      stateCode: editingIncident.stateCode || '',
      stateName: stateMeta?.name || editingIncident.stateName || '',
      title: (editingIncident.title || '').trim(),
      summary: (editingIncident.summary || '').trim(),
      researchStatusLabel: (editingIncident.researchStatusLabel || '').trim(),
      firstReportedDate: (editingIncident.firstReportedDate || '').trim(),
      linkedPublicationIds: Array.isArray(editingIncident.linkedPublicationIds)
        ? editingIncident.linkedPublicationIds
        : [],
      visibility: (editingIncident.visibility as DcmEvidenceVisibility) || 'private',
      status: targetStatus,
      approvalRecord,
      supersedesIncidentId: editingIncident.supersedesIncidentId,
      revisionNumber: editingIncident.revisionNumber || 1,
      publishedAt: targetStatus === 'published' ? nowIso : undefined,
      createdAt: editingIncident.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: editingIncident.createdByUid || currentUid || undefined,
      updatedByUid: currentUid || undefined
    };

    const validation = validateIncidentRecord(candidate, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined,
      existingDoc: existingIncidentDoc
    });

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      showBanner('Please resolve the incident validation errors before saving.', 'error');
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);
    try {
      await saveDcmIncident(candidate);
      showBanner(`Incident "${candidate.id}" saved as ${targetStatus}. State map classification remains unchanged.`);
      setEditingIncident(null);
      setEditingIncidentExistingId(null);
      setExpandedIncidentId(candidate.id);
    } catch (err: any) {
      showBanner(`Failed to save incident: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteIncidentAction = (inc: DcmIncidentRecord) => {
    setDeleteConfirmTarget({
      kind: 'incident',
      id: inc.id,
      title: inc.title,
      isPublished: inc.status === 'published'
    });
    setConfirmPublishedDelete(false);
  };

  // Developments under an Incident ID
  const handleNewDevelopment = (parentInc: DcmIncidentRecord) => {
    const existingDevs = dcmIncidentDevelopments.filter((d) => d.incidentId === parentInc.id);
    const seq = existingDevs.length + 1;
    let candidateId = `dev-${parentInc.id}-${String(seq).padStart(2, '0')}`;
    const allIds = new Set(dcmIncidentDevelopments.map((d) => d.id));
    let n = seq;
    while (allIds.has(candidateId)) {
      n++;
      candidateId = `dev-${parentInc.id}-${String(n).padStart(2, '0')}`;
    }

    setEditingDev({
      id: candidateId,
      incidentId: parentInc.id,
      stateCode: parentInc.stateCode,
      developmentDate: new Date().toISOString().slice(0, 10),
      title: '',
      approvedDescription: '',
      researchStatusLabel: 'Reported — Research-supplied status',
      isRemedyOrFollowUp: false,
      sourceReferences: [
        {
          sourceName: '',
          publicationDate: new Date().toISOString().slice(0, 10),
          url: '',
          documentReference: ''
        }
      ],
      linkedPublicationIds: [...(parentInc.linkedPublicationIds || [])],
      visibility: 'private',
      status: 'draft'
    });
    setEditingDevExistingId(null);
    setEditingIncident(null);
    resetApprovalFields(null);
    setValidationErrors([]);
  };

  const handleEditDevelopment = (dev: DcmIncidentDevelopment) => {
    setEditingDev({
      ...dev,
      sourceReferences: (dev.sourceReferences || []).map((s) => ({ ...s })),
      linkedPublicationIds: Array.isArray(dev.linkedPublicationIds) ? [...dev.linkedPublicationIds] : []
    });
    setEditingDevExistingId(dev.id);
    setEditingIncident(null);
    resetApprovalFields(dev);
    setValidationErrors([]);
  };

  const handleIssueDevCorrection = (publishedDev: DcmIncidentDevelopment) => {
    const draft = createDevelopmentCorrectionDraft(
      publishedDev,
      dcmIncidentDevelopments.map((d) => d.id),
      auth.currentUser?.uid
    );
    setEditingDev(draft);
    setEditingDevExistingId(null);
    setEditingIncident(null);
    resetApprovalFields(null);
    setValidationErrors([]);
    showBanner(`Created development correction draft "${draft.id}" superseding "${publishedDev.id}".`);
  };

  const handleSaveDevelopmentAction = async (targetStatus: DcmRecordPublishStatus) => {
    if (!editingDev || isSaving || isDevReadOnly) return;
    const currentUid = auth.currentUser?.uid || '';
    const nowIso = new Date().toISOString();
    const approvalRecord = buildApprovalPayload(editingDev.approvalRecord?.approvedAt);

    const cleanedSources: DcmSourceReference[] = (editingDev.sourceReferences || [])
      .filter((s) => (s.sourceName || '').trim() || (s.url || '').trim() || (s.documentReference || '').trim())
      .map((s) => ({
        sourceName: (s.sourceName || '').trim(),
        publicationDate: (s.publicationDate || '').trim(),
        url: (s.url || '').trim() || undefined,
        documentReference: (s.documentReference || '').trim() || undefined
      }));

    const candidate: DcmIncidentDevelopment = {
      id: (editingDev.id || '').trim(),
      incidentId: (editingDev.incidentId || '').trim(),
      stateCode: editingDev.stateCode || '',
      developmentDate: (editingDev.developmentDate || '').trim(),
      title: (editingDev.title || '').trim(),
      approvedDescription: (editingDev.approvedDescription || '').trim(),
      researchStatusLabel: (editingDev.researchStatusLabel || '').trim(),
      isRemedyOrFollowUp: Boolean(editingDev.isRemedyOrFollowUp),
      sourceReferences: cleanedSources,
      linkedPublicationIds: Array.isArray(editingDev.linkedPublicationIds)
        ? editingDev.linkedPublicationIds
        : [],
      visibility: (editingDev.visibility as DcmEvidenceVisibility) || 'private',
      status: targetStatus,
      approvalRecord,
      supersedesDevelopmentId: editingDev.supersedesDevelopmentId,
      revisionNumber: editingDev.revisionNumber || 1,
      publishedAt: targetStatus === 'published' ? nowIso : undefined,
      createdAt: editingDev.createdAt || Date.now(),
      updatedAt: Date.now(),
      createdByUid: editingDev.createdByUid || currentUid || undefined,
      updatedByUid: currentUid || undefined
    };

    const validation = validateIncidentDevelopment(candidate, {
      isAuthorizedAdmin: Boolean(auth.currentUser),
      actorUid: currentUid || undefined,
      existingDoc: existingDevDoc
    });

    if (!validation.valid) {
      setValidationErrors(validation.errors);
      showBanner('Please resolve the development validation errors before saving.', 'error');
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);
    try {
      await saveDcmIncidentDevelopment(candidate);
      showBanner(
        `Development "${candidate.title}" (${candidate.developmentDate}) saved under Incident ${candidate.incidentId}. State map classification remains unchanged.`
      );
      setEditingDev(null);
      setEditingDevExistingId(null);
      setExpandedIncidentId(candidate.incidentId);
    } catch (err: any) {
      showBanner(`Failed to save development: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDevelopmentAction = (dev: DcmIncidentDevelopment) => {
    setDeleteConfirmTarget({
      kind: 'development',
      id: dev.id,
      title: dev.title,
      isPublished: dev.status === 'published'
    });
    setConfirmPublishedDelete(false);
  };

  // Helper to toggle linked publication IDs
  const toggleLinkedPub = (
    currentIds: string[] | undefined,
    pubId: string,
    setter: (next: string[]) => void
  ) => {
    const set = new Set(currentIds || []);
    if (set.has(pubId)) set.delete(pubId);
    else set.add(pubId);
    setter(Array.from(set));
  };

  const evidenceUrlCheck = editingEvidence ? sanitizeExternalUrl(editingEvidence.sourceUrl) : null;

  // Shared Research Approval Panel
  const renderApprovalSection = (isReadOnly: boolean) => (
    <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-brand-blue shrink-0" />
          <h5 className="text-xs font-mono font-bold uppercase tracking-wider text-ink m-0">
            Research Approval (Confirmation Required Before Approval or Publication)
          </h5>
        </div>
        <span className="text-[10px] font-mono text-slate-600">
          Recorder: {auth.currentUser?.email || auth.currentUser?.uid || 'Not signed in'}
        </span>
      </div>

      <p className="text-[11px] text-slate-700 leading-relaxed m-0">
        Approval reference and approver name are optional internal administrative fields. Confirming below attaches your authenticated administrator account and timestamp to this record.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-mono font-bold uppercase text-slate-700 mb-1">
            Research Approval Reference <span className="text-slate-500">(Optional)</span>
          </label>
          <input
            type="text"
            disabled={isReadOnly}
            value={approvalRef}
            onChange={(e) => setApprovalRef(e.target.value)}
            placeholder="Optional — e.g. AEO-RES-2026-11-19-EV01"
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
          />
        </div>
        <div>
          <label className="block text-[11px] font-mono font-bold uppercase text-slate-700 mb-1">
            Recorded Research Approver Name <span className="text-slate-500">(Optional)</span>
          </label>
          <input
            type="text"
            disabled={isReadOnly}
            value={approverName}
            onChange={(e) => setApproverName(e.target.value)}
            placeholder="Optional — e.g. Research Lead"
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
          />
        </div>
      </div>

      <label className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
        <input
          type="checkbox"
          disabled={isReadOnly}
          checked={approvalConfirmed}
          onChange={(e) => setApprovalConfirmed(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          I confirm this record contains only Research-approved public facts and no confidential contacts, internal notes, or unverified leads.
        </span>
      </label>
    </div>
  );

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="space-y-6">
      {/* Status Toast */}
      {statusBanner && (
        <div
          className={`p-3.5 rounded-xl flex items-center gap-3 text-xs font-semibold border ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          {statusBanner.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{statusBanner.text}</span>
        </div>
      )}

      {/* Validation Errors Box */}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1.5 text-xs text-red-900">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Action blocked — resolve the following safeguards:</span>
          </div>
          <ul className="list-disc pl-5 space-y-1 m-0">
            {validationErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ADMIN-ONLY CONFIDENTIAL NOTES MODAL / DRAWER */}
      {privateNoteTarget && (
        <div className="bg-slate-900 text-white rounded-2xl p-5 space-y-4 border border-slate-700 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-amber-300 text-xs font-mono font-bold uppercase tracking-wider">
                <Lock className="w-4 h-4 shrink-0" />
                <span>Admin-Only Confidential Notes — Physically Isolated Storage</span>
              </div>
              <h4 className="font-display font-bold text-base text-white mt-1 mb-0">
                {privateNoteTarget.label} ({privateNoteTarget.targetId})
              </h4>
              <p className="text-[11px] text-slate-300 mt-1 mb-0">
                Stored exclusively in <code className="bg-slate-800 px-1.5 py-0.5 rounded">/dcm_private_notes</code>. Never queried by or exposed to public visitors.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrivateNoteTarget(null)}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 cursor-pointer"
              aria-label="Close confidential notes"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-300 mb-1">
                Internal Research / Verification Notes (Private)
              </label>
              <textarea
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Internal notes, review comments, or pending verification steps..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-300 mb-1">
                Confidential Contacts / Source Identities (Private)
              </label>
              <textarea
                rows={2}
                value={noteContacts}
                onChange={(e) => setNoteContacts(e.target.value)}
                placeholder="Protected observer or witness contact details (never placed in public records)..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-300 mb-1">
                Unverified Leads (Private)
              </label>
              <textarea
                rows={2}
                value={noteLeads}
                onChange={(e) => setNoteLeads(e.target.value)}
                placeholder="Unverified tips or allegations awaiting Research confirmation..."
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-700">
            <button
              type="button"
              onClick={handleDeletePrivateNote}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/60 hover:bg-red-800 text-red-100 text-xs font-mono font-bold cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Private Note</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPrivateNoteTarget(null)}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingNote}
                onClick={handleSavePrivateNote}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-mono font-bold cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingNote ? 'Saving...' : 'Save Confidential Note'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* MODE 1: PUBLIC EVIDENCE & SOURCES                                   */}
      {/* =================================================================== */}
      {mode === 'evidence' && (
        <>
          {editingEvidence ? (
            <div className="bg-white border border-line rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-brand-blue border border-blue-200 text-[10px] font-mono font-bold uppercase">
                      Evidence Editor
                    </span>
                    <span className="font-mono text-xs text-mut">{editingEvidence.id}</span>
                    {isEvidenceReadOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 text-[10px] font-mono font-bold uppercase">
                        <Lock className="w-3 h-3" />
                        Published · Immutable
                      </span>
                    )}
                  </div>
                  <h4 className="font-display font-bold text-lg text-ink mt-1 mb-0">
                    {isEvidenceReadOnly
                      ? 'Viewing Published Evidence Record'
                      : editingEvidence.supersedesEvidenceId
                      ? `Versioned Correction Draft (Supersedes ${editingEvidence.supersedesEvidenceId})`
                      : 'Create / Edit Evidence Record'}
                  </h4>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isEvidenceReadOnly && existingEvidenceDoc && (
                    <button
                      type="button"
                      onClick={() => handleIssueEvidenceCorrection(existingEvidenceDoc)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-mono font-bold uppercase cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Issue Corrected Revision (-r2)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEvidence(null);
                      setEditingEvidenceExistingId(null);
                      setValidationErrors([]);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-mono font-bold text-slate-700 cursor-pointer"
                  >
                    Back to List
                  </button>
                </div>
              </div>

              {/* Core Evidence Fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Unique Evidence ID *
                  </label>
                  <input
                    type="text"
                    disabled={Boolean(editingEvidenceExistingId) || isEvidenceReadOnly}
                    value={editingEvidence.id || ''}
                    onChange={(e) => setEditingEvidence({ ...editingEvidence, id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Associated State / FCT *
                  </label>
                  <select
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.stateCode || 'LA'}
                    onChange={(e) => {
                      const code = e.target.value;
                      const st = NIGERIA_37_JURISDICTIONS.find((j) => j.code === code);
                      setEditingEvidence({
                        ...editingEvidence,
                        stateCode: code,
                        stateName: st?.name || code
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {NIGERIA_37_JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.name} ({j.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Related Incident ID (Optional)
                  </label>
                  <select
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.incidentId || ''}
                    onChange={(e) =>
                      setEditingEvidence({ ...editingEvidence, incidentId: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="">None / Standalone evidence</option>
                    {dcmIncidents
                      .filter((i) => i.stateCode === editingEvidence.stateCode)
                      .map((inc) => (
                        <option key={inc.id} value={inc.id}>
                          {inc.id} — {inc.title}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="md:col-span-2">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Evidence Title *
                  </label>
                  <input
                    type="text"
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.title || ''}
                    onChange={(e) => setEditingEvidence({ ...editingEvidence, title: e.target.value })}
                    placeholder="Concise, neutral Research-approved title"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Approved Public Description * (Never include confidential contacts or unverified internal notes)
                  </label>
                  <textarea
                    rows={4}
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.publicDescription || ''}
                    onChange={(e) =>
                      setEditingEvidence({ ...editingEvidence, publicDescription: e.target.value })
                    }
                    placeholder="Research-approved public summary of this evidence record..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Source Name *
                  </label>
                  <input
                    type="text"
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.sourceName || ''}
                    onChange={(e) =>
                      setEditingEvidence({ ...editingEvidence, sourceName: e.target.value })
                    }
                    placeholder="e.g. Premium Times / Police Command Statement / Court Filing"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Source Publication Date (YYYY-MM-DD) *
                  </label>
                  <input
                    type="date"
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.sourcePublicationDate || ''}
                    onChange={(e) =>
                      setEditingEvidence({
                        ...editingEvidence,
                        sourcePublicationDate: e.target.value
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Source URL (Strictly validated https:// or http://)
                  </label>
                  <input
                    type="url"
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.sourceUrl || ''}
                    onChange={(e) =>
                      setEditingEvidence({ ...editingEvidence, sourceUrl: e.target.value })
                    }
                    placeholder="https://example.org/article"
                    className={`w-full px-3 py-2 border rounded-lg disabled:bg-slate-100 ${
                      evidenceUrlCheck && !evidenceUrlCheck.valid
                        ? 'border-red-400 bg-red-50'
                        : 'border-slate-300'
                    }`}
                  />
                  {evidenceUrlCheck && !evidenceUrlCheck.valid && (
                    <p className="text-[11px] text-red-700 mt-1 mb-0">{evidenceUrlCheck.error}</p>
                  )}
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Approved Document Reference (Alternative / Companion to URL)
                  </label>
                  <input
                    type="text"
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.documentReference || ''}
                    onChange={(e) =>
                      setEditingEvidence({
                        ...editingEvidence,
                        documentReference: e.target.value
                      })
                    }
                    placeholder="e.g. AEO-DOC-2026-11-04 / Official Gazette Ref"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Evidence Verification Status (Supplied by Research) *
                  </label>
                  <select
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.verificationStatus || 'Verified by Research'}
                    onChange={(e) => {
                      const nextStatus = e.target.value as DcmEvidenceVerificationStatus;
                      setEditingEvidence({
                        ...editingEvidence,
                        verificationStatus: nextStatus,
                        visibility:
                          nextStatus === 'Unverified Lead (Private)'
                            ? 'private'
                            : editingEvidence.visibility
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {DCM_EVIDENCE_VERIFICATION_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Public / Private Visibility *
                  </label>
                  <select
                    disabled={
                      isEvidenceReadOnly ||
                      editingEvidence.verificationStatus === 'Unverified Lead (Private)'
                    }
                    value={editingEvidence.visibility || 'private'}
                    onChange={(e) =>
                      setEditingEvidence({
                        ...editingEvidence,
                        visibility: e.target.value as DcmEvidenceVisibility
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="private">Private (Admin-only, never shown on public DCM)</option>
                    <option value="public">Public (Eligible for public display once Published)</option>
                  </select>
                </div>
              </div>

              {/* Disputed Claim Flag */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs">
                <label className="flex items-center gap-2 font-semibold text-amber-950 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isEvidenceReadOnly}
                    checked={Boolean(editingEvidence.isDisputed)}
                    onChange={(e) =>
                      setEditingEvidence({ ...editingEvidence, isDisputed: e.target.checked })
                    }
                  />
                  <span>Mark as Disputed Claim (Displays explicit Research-disputed indicator publicly)</span>
                </label>
                {editingEvidence.isDisputed && (
                  <textarea
                    rows={2}
                    disabled={isEvidenceReadOnly}
                    value={editingEvidence.disputedClaimNote || ''}
                    onChange={(e) =>
                      setEditingEvidence({
                        ...editingEvidence,
                        disputedClaimNote: e.target.value
                      })
                    }
                    placeholder="Briefly describe the competing accounts as supplied by Research..."
                    className="w-full px-3 py-2 border border-amber-300 rounded-lg bg-white disabled:bg-slate-100"
                  />
                )}
              </div>

              {/* Institutional Response Section */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                <div className="flex items-center gap-2 font-mono font-bold uppercase text-[11px] text-slate-800">
                  <Building2 className="w-4 h-4 text-brand-blue" />
                  <span>Institutional Response (Where Supplied by Research)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={isEvidenceReadOnly}
                      checked={Boolean(editingEvidence.institutionalResponse?.requested)}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: e.target.checked,
                            received: Boolean(editingEvidence.institutionalResponse?.received),
                            requestedDate: editingEvidence.institutionalResponse?.requestedDate || '',
                            responseDate: editingEvidence.institutionalResponse?.responseDate || '',
                            respondentName: editingEvidence.institutionalResponse?.respondentName || '',
                            publicSummary: editingEvidence.institutionalResponse?.publicSummary || ''
                          }
                        })
                      }
                    />
                    <span className="font-semibold">Response Requested</span>
                  </label>
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-600 mb-0.5">
                      Requested Date
                    </label>
                    <input
                      type="date"
                      disabled={isEvidenceReadOnly}
                      value={editingEvidence.institutionalResponse?.requestedDate || ''}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: Boolean(editingEvidence.institutionalResponse?.requested),
                            received: Boolean(editingEvidence.institutionalResponse?.received),
                            requestedDate: e.target.value,
                            responseDate: editingEvidence.institutionalResponse?.responseDate || '',
                            respondentName: editingEvidence.institutionalResponse?.respondentName || '',
                            publicSummary: editingEvidence.institutionalResponse?.publicSummary || ''
                          }
                        })
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    />
                  </div>
                  <label className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={isEvidenceReadOnly}
                      checked={Boolean(editingEvidence.institutionalResponse?.received)}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: Boolean(editingEvidence.institutionalResponse?.requested),
                            received: e.target.checked,
                            requestedDate: editingEvidence.institutionalResponse?.requestedDate || '',
                            responseDate: editingEvidence.institutionalResponse?.responseDate || '',
                            respondentName: editingEvidence.institutionalResponse?.respondentName || '',
                            publicSummary: editingEvidence.institutionalResponse?.publicSummary || ''
                          }
                        })
                      }
                    />
                    <span className="font-semibold">Response Received</span>
                  </label>
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-600 mb-0.5">
                      Response Date
                    </label>
                    <input
                      type="date"
                      disabled={isEvidenceReadOnly}
                      value={editingEvidence.institutionalResponse?.responseDate || ''}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: Boolean(editingEvidence.institutionalResponse?.requested),
                            received: Boolean(editingEvidence.institutionalResponse?.received),
                            requestedDate: editingEvidence.institutionalResponse?.requestedDate || '',
                            responseDate: e.target.value,
                            respondentName: editingEvidence.institutionalResponse?.respondentName || '',
                            publicSummary: editingEvidence.institutionalResponse?.publicSummary || ''
                          }
                        })
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-600 mb-0.5">
                      Institution / Respondent Name
                    </label>
                    <input
                      type="text"
                      disabled={isEvidenceReadOnly}
                      value={editingEvidence.institutionalResponse?.respondentName || ''}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: Boolean(editingEvidence.institutionalResponse?.requested),
                            received: Boolean(editingEvidence.institutionalResponse?.received),
                            requestedDate: editingEvidence.institutionalResponse?.requestedDate || '',
                            responseDate: editingEvidence.institutionalResponse?.responseDate || '',
                            respondentName: e.target.value,
                            publicSummary: editingEvidence.institutionalResponse?.publicSummary || ''
                          }
                        })
                      }
                      placeholder="e.g. State Police Command"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-mono uppercase text-slate-600 mb-0.5">
                      Approved Public Response Summary
                    </label>
                    <textarea
                      rows={2}
                      disabled={isEvidenceReadOnly}
                      value={editingEvidence.institutionalResponse?.publicSummary || ''}
                      onChange={(e) =>
                        setEditingEvidence({
                          ...editingEvidence,
                          institutionalResponse: {
                            requested: Boolean(editingEvidence.institutionalResponse?.requested),
                            received: Boolean(editingEvidence.institutionalResponse?.received),
                            requestedDate: editingEvidence.institutionalResponse?.requestedDate || '',
                            responseDate: editingEvidence.institutionalResponse?.responseDate || '',
                            respondentName: editingEvidence.institutionalResponse?.respondentName || '',
                            publicSummary: e.target.value
                          }
                        })
                      }
                      placeholder="Summary of the official institutional response approved for public display..."
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Linked Published Editions */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="font-mono font-bold uppercase text-[11px] text-slate-800">
                  Linked DCM Publications (Preserves Historical Evidence per Edition)
                </div>
                <p className="text-[11px] text-slate-600 m-0">
                  Select the published DCM editions this evidence supports. Historical editions retain their linked evidence even when later revisions are published.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {publishedEditions.map((pub) => {
                    const checked = (editingEvidence.linkedPublicationIds || []).includes(pub.id);
                    return (
                      <label
                        key={pub.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer ${
                          checked
                            ? 'bg-blue-50 border-brand-blue text-brand-blue font-semibold'
                            : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={isEvidenceReadOnly}
                          checked={checked}
                          onChange={() =>
                            toggleLinkedPub(editingEvidence.linkedPublicationIds, pub.id, (next) =>
                              setEditingEvidence({ ...editingEvidence, linkedPublicationIds: next })
                            )
                          }
                        />
                        <span>{pub.reportingPeriodLabel}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Approval Reference Block */}
              {renderApprovalSection(isEvidenceReadOnly)}

              {/* Action Buttons */}
              {!isEvidenceReadOnly && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-line">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveEvidenceAction('draft')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-mono font-bold uppercase cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Private Draft</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveEvidenceAction('approved')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-brand-blue border border-blue-200 text-xs font-mono font-bold uppercase cursor-pointer disabled:opacity-50"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Mark Approved (Private)</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveEvidenceAction('published')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold uppercase cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish Record</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* EVIDENCE LIST VIEW */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-brand-blue" />
                    <h3 className="font-display font-bold text-xl text-ink m-0">
                      DCM Public Evidence & Sources
                    </h3>
                  </div>
                  <p className="text-xs text-mut mt-1 mb-0">
                    Manage structured Research-approved public evidence records, dated source links, disputed flags, and institutional responses. Stored in{' '}
                    <code className="bg-paper px-1 py-0.5 rounded border border-line">/dcm_evidence</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleNewEvidence}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-dark text-white rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Evidence Record</span>
                </button>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All 37 States & FCT</option>
                  {NIGERIA_37_JURISDICTIONS.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.name} ({j.code})
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved (Private)</option>
                  <option value="published">Published</option>
                </select>
                <select
                  value={visibilityFilter}
                  onChange={(e) => setVisibilityFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All Visibility</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
                <span className="text-mut font-mono text-[11px] ml-auto">
                  Showing {filteredEvidence.length} of {dcmEvidence.length} records
                </span>
              </div>

              {filteredEvidence.length === 0 ? (
                <div className="bg-white border border-dashed border-line rounded-2xl p-8 text-center space-y-2">
                  <p className="text-sm font-semibold text-ink m-0">
                    No evidence records match the current filter.
                  </p>
                  <p className="text-xs text-mut m-0">
                    Create a draft evidence record to attach dated Research-approved sources and institutional responses to any state assessment.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredEvidence.map((ev) => {
                    const isPub = ev.status === 'published';
                    const hasPrivateNote = dcmPrivateNotes.some(
                      (n) => n.targetType === 'evidence' && n.targetId === ev.id
                    );
                    const safeUrl = sanitizeExternalUrl(ev.sourceUrl).sanitizedUrl;
                    return (
                      <div
                        key={ev.id}
                        className="bg-white border border-line rounded-2xl p-4 space-y-3 shadow-xs flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-mono font-bold">
                              {ev.stateName} ({ev.stateCode})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${
                                isPub
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : ev.status === 'approved'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {ev.status}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${
                                ev.visibility === 'public'
                                  ? 'bg-teal-50 text-teal-800 border-teal-200'
                                  : 'bg-slate-200 text-slate-700 border-slate-300'
                              }`}
                            >
                              {ev.visibility === 'public' ? (
                                <Globe className="w-2.5 h-2.5" />
                              ) : (
                                <EyeOff className="w-2.5 h-2.5" />
                              )}
                              {ev.visibility}
                            </span>
                            {ev.isDisputed && (
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-mono font-bold uppercase">
                                Disputed
                              </span>
                            )}
                          </div>

                          <h4 className="font-display font-bold text-sm text-ink m-0 leading-snug">
                            {ev.title}
                          </h4>
                          <p className="text-xs text-slate-600 m-0 line-clamp-3">
                            {ev.publicDescription}
                          </p>

                          <div className="text-[11px] text-slate-600 space-y-0.5 pt-1 border-t border-slate-100">
                            <div>
                              <strong>Source:</strong> {ev.sourceName} ({formatIsoDateShort(ev.sourcePublicationDate)})
                            </div>
                            <div>
                              <strong>Research Status:</strong> {ev.verificationStatus}
                            </div>
                            {safeUrl && (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-brand-blue hover:underline font-semibold"
                              >
                                <span>Verified source URL</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <div className="font-mono text-[10px] text-slate-400">
                              ID: {ev.id}
                              {ev.approvalRecord?.approvalReference
                                ? ` · Approval: ${ev.approvalRecord.approvalReference}`
                                : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line">
                          <button
                            type="button"
                            onClick={() => handleEditEvidence(ev)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>{isPub ? 'View' : 'Edit'}</span>
                          </button>

                          {isPub && (
                            <button
                              type="button"
                              onClick={() => handleIssueEvidenceCorrection(ev)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-xs font-semibold text-indigo-800 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Correction (-r2)</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openPrivateNotes('evidence', ev.id, ev.stateCode, ev.title)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                              hasPrivateNote
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <Lock className="w-3 h-3" />
                            <span>{hasPrivateNote ? 'Confidential Notes (Saved)' : 'Confidential Notes'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteEvidenceAction(ev)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 cursor-pointer ml-auto"
                            title={isPub ? 'Delete published evidence record (in case of error)' : 'Delete evidence draft'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* =================================================================== */}
      {/* MODE 2: INCIDENT HISTORY & CHRONOLOGICAL DEVELOPMENTS               */}
      {/* =================================================================== */}
      {mode === 'incidents' && (
        <>
          {/* Non-automatic map-colour safeguard notice */}
          <div className="bg-slate-50 border border-slate-300 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-slate-700">
            <ShieldAlert className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
            <div>
              <strong className="text-slate-900">Technical Safeguard:</strong> Creating or updating incident records and developments{' '}
              <strong>never automatically changes</strong> any state&apos;s DCM map classification or colour, and never auto-labels developments as verified or resolved. Display statuses are supplied verbatim by Research.
            </div>
          </div>

          {editingDev ? (
            /* DEVELOPMENT EDITOR */
            <div className="bg-white border border-line rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-mono font-bold uppercase">
                      Incident Development Editor
                    </span>
                    <span className="font-mono text-xs text-mut">Parent Incident: {editingDev.incidentId}</span>
                  </div>
                  <h4 className="font-display font-bold text-lg text-ink mt-1 mb-0">
                    {isDevReadOnly ? 'Viewing Published Development' : 'Add / Edit Chronological Development'}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  {isDevReadOnly && existingDevDoc && (
                    <button
                      type="button"
                      onClick={() => handleIssueDevCorrection(existingDevDoc)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-mono font-bold uppercase cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Issue Corrected Revision (-r2)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDev(null);
                      setEditingDevExistingId(null);
                      setValidationErrors([]);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-mono font-bold text-slate-700 cursor-pointer"
                  >
                    Back to Incidents
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Development Date (YYYY-MM-DD) *
                  </label>
                  <input
                    type="date"
                    disabled={isDevReadOnly}
                    value={editingDev.developmentDate || ''}
                    onChange={(e) => setEditingDev({ ...editingDev, developmentDate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Research-Supplied Status Label *
                  </label>
                  <input
                    type="text"
                    disabled={isDevReadOnly}
                    value={editingDev.researchStatusLabel || ''}
                    onChange={(e) => setEditingDev({ ...editingDev, researchStatusLabel: e.target.value })}
                    placeholder="e.g. Confirmed by Research / Reported / Remedy noted"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Visibility *
                  </label>
                  <select
                    disabled={isDevReadOnly}
                    value={editingDev.visibility || 'private'}
                    onChange={(e) =>
                      setEditingDev({ ...editingDev, visibility: e.target.value as DcmEvidenceVisibility })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="private">Private (Admin-only)</option>
                    <option value="public">Public (Eligible once Published)</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Development Title * (e.g. &ldquo;Venue access denied&rdquo;, &ldquo;Approval restored&rdquo;, &ldquo;Rally held&rdquo;)
                  </label>
                  <input
                    type="text"
                    disabled={isDevReadOnly}
                    value={editingDev.title || ''}
                    onChange={(e) => setEditingDev({ ...editingDev, title: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="md:col-span-3">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Approved Public Description *
                  </label>
                  <textarea
                    rows={3}
                    disabled={isDevReadOnly}
                    value={editingDev.approvedDescription || ''}
                    onChange={(e) => setEditingDev({ ...editingDev, approvedDescription: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl p-3 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={isDevReadOnly}
                  checked={Boolean(editingDev.isRemedyOrFollowUp)}
                  onChange={(e) => setEditingDev({ ...editingDev, isRemedyOrFollowUp: e.target.checked })}
                />
                <span>Flag as Remedy / Subsequent Follow-up Development (Research-supplied indicator; does not auto-change map colour)</span>
              </label>

              {/* Dated Source References */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold uppercase text-[11px] text-slate-800">
                    Dated Source References
                  </span>
                  {!isDevReadOnly && (
                    <button
                      type="button"
                      onClick={() =>
                        setEditingDev({
                          ...editingDev,
                          sourceReferences: [
                            ...(editingDev.sourceReferences || []),
                            {
                              sourceName: '',
                              publicationDate: editingDev.developmentDate || new Date().toISOString().slice(0, 10),
                              url: '',
                              documentReference: ''
                            }
                          ]
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-[11px] font-semibold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Source</span>
                    </button>
                  )}
                </div>

                {(editingDev.sourceReferences || []).map((src, idx) => {
                  const check = sanitizeExternalUrl(src.url);
                  return (
                    <div
                      key={idx}
                      className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-4 gap-2.5 items-start"
                    >
                      <input
                        type="text"
                        disabled={isDevReadOnly}
                        placeholder="Source name *"
                        value={src.sourceName}
                        onChange={(e) => {
                          const next = [...(editingDev.sourceReferences || [])];
                          next[idx] = { ...next[idx], sourceName: e.target.value };
                          setEditingDev({ ...editingDev, sourceReferences: next });
                        }}
                        className="px-2.5 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        type="date"
                        disabled={isDevReadOnly}
                        value={src.publicationDate}
                        onChange={(e) => {
                          const next = [...(editingDev.sourceReferences || [])];
                          next[idx] = { ...next[idx], publicationDate: e.target.value };
                          setEditingDev({ ...editingDev, sourceReferences: next });
                        }}
                        className="px-2.5 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <div>
                        <input
                          type="url"
                          disabled={isDevReadOnly}
                          placeholder="https://source-url"
                          value={src.url || ''}
                          onChange={(e) => {
                            const next = [...(editingDev.sourceReferences || [])];
                            next[idx] = { ...next[idx], url: e.target.value };
                            setEditingDev({ ...editingDev, sourceReferences: next });
                          }}
                          className={`w-full px-2.5 py-1.5 border rounded-lg disabled:bg-slate-100 ${
                            !check.valid ? 'border-red-400 bg-red-50' : 'border-slate-300'
                          }`}
                        />
                        {!check.valid && (
                          <span className="text-[10px] text-red-700">{check.error}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          disabled={isDevReadOnly}
                          placeholder="Document ref (optional)"
                          value={src.documentReference || ''}
                          onChange={(e) => {
                            const next = [...(editingDev.sourceReferences || [])];
                            next[idx] = { ...next[idx], documentReference: e.target.value };
                            setEditingDev({ ...editingDev, sourceReferences: next });
                          }}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                        />
                        {!isDevReadOnly && (editingDev.sourceReferences || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = (editingDev.sourceReferences || []).filter((_, i) => i !== idx);
                              setEditingDev({ ...editingDev, sourceReferences: next });
                            }}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                            aria-label="Remove source"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {renderApprovalSection(isDevReadOnly)}

              {!isDevReadOnly && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-line">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveDevelopmentAction('draft')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Draft</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveDevelopmentAction('approved')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-brand-blue border border-blue-200 text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Mark Approved</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveDevelopmentAction('published')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish Development</span>
                  </button>
                </div>
              )}
            </div>
          ) : editingIncident ? (
            /* INCIDENT EDITOR */
            <div className="bg-white border border-line rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-blue-50 text-brand-blue border border-blue-200 text-[10px] font-mono font-bold uppercase">
                      Incident Record Editor
                    </span>
                    <span className="font-mono text-xs text-mut">{editingIncident.id}</span>
                    {isIncidentReadOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 text-[10px] font-mono font-bold uppercase">
                        <Lock className="w-3 h-3" />
                        Published · Immutable
                      </span>
                    )}
                  </div>
                  <h4 className="font-display font-bold text-lg text-ink mt-1 mb-0">
                    {isIncidentReadOnly ? 'Viewing Published Incident Record' : 'Create / Edit Incident Record'}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  {isIncidentReadOnly && existingIncidentDoc && (
                    <button
                      type="button"
                      onClick={() => handleIssueIncidentCorrection(existingIncidentDoc)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-mono font-bold uppercase cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Issue Corrected Revision (-r2)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIncident(null);
                      setEditingIncidentExistingId(null);
                      setValidationErrors([]);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-mono font-bold text-slate-700 cursor-pointer"
                  >
                    Back to Incidents
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Unique Incident ID *
                  </label>
                  <input
                    type="text"
                    disabled={Boolean(editingIncidentExistingId) || isIncidentReadOnly}
                    value={editingIncident.id || ''}
                    onChange={(e) => setEditingIncident({ ...editingIncident, id: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Associated State / FCT *
                  </label>
                  <select
                    disabled={isIncidentReadOnly}
                    value={editingIncident.stateCode || 'LA'}
                    onChange={(e) => {
                      const code = e.target.value;
                      const st = NIGERIA_37_JURISDICTIONS.find((j) => j.code === code);
                      setEditingIncident({
                        ...editingIncident,
                        stateCode: code,
                        stateName: st?.name || code
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {NIGERIA_37_JURISDICTIONS.map((j) => (
                      <option key={j.code} value={j.code}>
                        {j.name} ({j.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    First Reported Date (YYYY-MM-DD) *
                  </label>
                  <input
                    type="date"
                    disabled={isIncidentReadOnly}
                    value={editingIncident.firstReportedDate || ''}
                    onChange={(e) =>
                      setEditingIncident({ ...editingIncident, firstReportedDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Incident Title *
                  </label>
                  <input
                    type="text"
                    disabled={isIncidentReadOnly}
                    value={editingIncident.title || ''}
                    onChange={(e) => setEditingIncident({ ...editingIncident, title: e.target.value })}
                    placeholder="e.g. Public venue access dispute — Ikeja town hall"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Research-Supplied Status Label *
                  </label>
                  <input
                    type="text"
                    disabled={isIncidentReadOnly}
                    value={editingIncident.researchStatusLabel || ''}
                    onChange={(e) =>
                      setEditingIncident({ ...editingIncident, researchStatusLabel: e.target.value })
                    }
                    placeholder="Displayed verbatim from Research"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Approved Public Overview *
                  </label>
                  <textarea
                    rows={3}
                    disabled={isIncidentReadOnly}
                    value={editingIncident.summary || ''}
                    onChange={(e) => setEditingIncident({ ...editingIncident, summary: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-mono font-bold uppercase text-[11px] text-slate-700 mb-1">
                    Visibility *
                  </label>
                  <select
                    disabled={isIncidentReadOnly}
                    value={editingIncident.visibility || 'private'}
                    onChange={(e) =>
                      setEditingIncident({
                        ...editingIncident,
                        visibility: e.target.value as DcmEvidenceVisibility
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="private">Private (Admin-only)</option>
                    <option value="public">Public (Eligible once Published)</option>
                  </select>
                </div>
              </div>

              {/* Linked Published Editions */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="font-mono font-bold uppercase text-[11px] text-slate-800">
                  Linked DCM Publications
                </div>
                <div className="flex flex-wrap gap-2">
                  {publishedEditions.map((pub) => {
                    const checked = (editingIncident.linkedPublicationIds || []).includes(pub.id);
                    return (
                      <label
                        key={pub.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] cursor-pointer ${
                          checked
                            ? 'bg-blue-50 border-brand-blue text-brand-blue font-semibold'
                            : 'bg-white border-slate-300 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={isIncidentReadOnly}
                          checked={checked}
                          onChange={() =>
                            toggleLinkedPub(editingIncident.linkedPublicationIds, pub.id, (next) =>
                              setEditingIncident({ ...editingIncident, linkedPublicationIds: next })
                            )
                          }
                        />
                        <span>{pub.reportingPeriodLabel}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {renderApprovalSection(isIncidentReadOnly)}

              {!isIncidentReadOnly && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-line">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveIncidentAction('draft')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Draft</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveIncidentAction('approved')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-brand-blue border border-blue-200 text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Mark Approved</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleSaveIncidentAction('published')}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold uppercase cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Publish Incident</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* INCIDENTS LIST + NESTED CHRONOLOGICAL DEVELOPMENTS */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-5 h-5 text-brand-blue" />
                    <h3 className="font-display font-bold text-xl text-ink m-0">
                      DCM Incident History & Chronological Developments
                    </h3>
                  </div>
                  <p className="text-xs text-mut mt-1 mb-0">
                    Group multiple dated developments under a single Incident ID. Stored in{' '}
                    <code className="bg-paper px-1 py-0.5 rounded border border-line">/dcm_incidents</code> and{' '}
                    <code className="bg-paper px-1 py-0.5 rounded border border-line">/dcm_incident_developments</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleNewIncident}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-dark text-white rounded-xl text-xs font-mono font-bold uppercase tracking-wider cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Incident Record</span>
                </button>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All 37 States & FCT</option>
                  {NIGERIA_37_JURISDICTIONS.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.name} ({j.code})
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="approved">Approved (Private)</option>
                  <option value="published">Published</option>
                </select>
                <select
                  value={visibilityFilter}
                  onChange={(e) => setVisibilityFilter(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-xl bg-white font-semibold"
                >
                  <option value="ALL">All Visibility</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
                <span className="text-mut font-mono text-[11px] ml-auto">
                  {filteredIncidents.length} incident(s)
                </span>
              </div>

              {filteredIncidents.length === 0 ? (
                <div className="bg-white border border-dashed border-line rounded-2xl p-8 text-center space-y-2">
                  <Info className="w-5 h-5 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold text-ink m-0">
                    No incident records match the current filter.
                  </p>
                  <p className="text-xs text-mut m-0">
                    Create an Incident ID first, then attach dated chronological developments (including remedies or follow-ups) under that Incident ID.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredIncidents.map((inc) => {
                    const isPub = inc.status === 'published';
                    const devs = dcmIncidentDevelopments
                      .filter((d) => d.incidentId === inc.id)
                      .sort((a, b) => a.developmentDate.localeCompare(b.developmentDate));
                    const isExpanded = expandedIncidentId === inc.id || devs.length > 0;
                    const hasPrivateNote = dcmPrivateNotes.some(
                      (n) => n.targetType === 'incident' && n.targetId === inc.id
                    );

                    return (
                      <div
                        key={inc.id}
                        className="bg-white border border-line rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono font-bold text-slate-800">
                                {inc.stateName} ({inc.stateCode})
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-600">
                                {inc.id}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${
                                  isPub
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {inc.status}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-[10px] font-semibold text-slate-700">
                                {inc.researchStatusLabel}
                              </span>
                            </div>
                            <h4 className="font-display font-bold text-base text-ink m-0">
                              {inc.title}
                            </h4>
                            <p className="text-xs text-slate-600 m-0">{inc.summary}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleNewDevelopment(inc)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-blue hover:bg-brand-blue-dark text-white text-xs font-mono font-bold uppercase cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Add Development</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditIncident(inc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>{isPub ? 'View' : 'Edit'}</span>
                            </button>
                            {isPub && (
                              <button
                                type="button"
                                onClick={() => handleIssueIncidentCorrection(inc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-semibold cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                <span>Correction</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openPrivateNotes('incident', inc.id, inc.stateCode, inc.title)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                                hasPrivateNote
                                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                                  : 'bg-slate-50 border-slate-300 text-slate-700'
                              }`}
                            >
                              <Lock className="w-3 h-3" />
                              <span>Private Notes</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIncidentAction(inc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-semibold cursor-pointer"
                              title={isPub ? 'Delete published incident record (in case of error)' : 'Delete incident draft'}
                              aria-label={`Delete incident ${inc.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Chronological Developments List */}
                        {isExpanded && (
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                            <div className="text-[11px] font-mono font-bold uppercase text-slate-600">
                              Chronological Developments under {inc.id} ({devs.length})
                            </div>
                            {devs.length === 0 ? (
                              <p className="text-xs text-slate-500 italic m-0">
                                No developments recorded under this Incident ID yet. Use &ldquo;Add Development&rdquo; above.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {devs.map((dev) => {
                                  const devPub = dev.status === 'published';
                                  return (
                                    <div
                                      key={dev.id}
                                      className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-start justify-between gap-2 text-xs"
                                    >
                                      <div className="space-y-1 flex-1 min-w-[220px]">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="font-mono font-bold text-slate-900">
                                            {formatIsoDateShort(dev.developmentDate)}
                                          </span>
                                          <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-[10px] font-semibold">
                                            {dev.researchStatusLabel}
                                          </span>
                                          <span
                                            className={`px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase font-bold ${
                                              devPub
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : 'bg-amber-50 text-amber-800 border-amber-200'
                                            }`}
                                          >
                                            {dev.status} · {dev.visibility}
                                          </span>
                                          {dev.isRemedyOrFollowUp && (
                                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-semibold">
                                              Remedy / Follow-up
                                            </span>
                                          )}
                                        </div>
                                        <div className="font-bold text-slate-900">{dev.title}</div>
                                        <p className="text-slate-600 m-0">{dev.approvedDescription}</p>
                                      </div>

                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                          type="button"
                                          onClick={() => handleEditDevelopment(dev)}
                                          className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold cursor-pointer"
                                        >
                                          {devPub ? 'View' : 'Edit'}
                                        </button>
                                        {devPub && (
                                          <button
                                            type="button"
                                            onClick={() => handleIssueDevCorrection(dev)}
                                            className="px-2.5 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold cursor-pointer"
                                          >
                                            Correction
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteDevelopmentAction(dev)}
                                          className="p-1.5 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 cursor-pointer"
                                          title={devPub ? 'Delete published development (in case of error)' : 'Delete development'}
                                          aria-label="Delete development"
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* IN-APP DELETE CONFIRMATION MODAL */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 bg-red-50/70 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900">
                    Delete {deleteConfirmTarget.isPublished ? 'Published ' : ''}
                    {deleteConfirmTarget.kind === 'evidence'
                      ? 'Evidence Record'
                      : deleteConfirmTarget.kind === 'incident'
                      ? 'Incident Record'
                      : 'Incident Development'}?
                  </h4>
                  <p className="text-xs font-mono text-slate-500 mt-0.5 break-all">{deleteConfirmTarget.id}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingRecord}
                onClick={() => {
                  setDeleteConfirmTarget(null);
                  setConfirmPublishedDelete(false);
                }}
                className="p-1 rounded-lg hover:bg-white text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close delete dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-700">
              <p>
                You are about to permanently delete <span className="font-semibold text-slate-900">&ldquo;{deleteConfirmTarget.title}&rdquo;</span>. This action cannot be undone.
              </p>

              {deleteConfirmTarget.isPublished && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs text-red-900">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Published Record:</strong> Deleting this record permanently removes it from Firestore and any public state view referencing it.
                    </span>
                  </div>
                  <label className="flex items-start gap-2 text-xs text-red-950 font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={confirmPublishedDelete}
                      onChange={(e) => setConfirmPublishedDelete(e.target.checked)}
                      className="mt-0.5 rounded border-red-300 text-red-600 focus:ring-red-500"
                    />
                    <span>I confirm this published record contains an error and should be permanently deleted.</span>
                  </label>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingRecord}
                onClick={() => {
                  setDeleteConfirmTarget(null);
                  setConfirmPublishedDelete(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-100 text-slate-600 border border-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingRecord || (deleteConfirmTarget.isPublished && !confirmPublishedDelete)}
                onClick={handleConfirmDeleteRecord}
                className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingRecord ? 'Deleting...' : deleteConfirmTarget.isPublished ? 'Delete Permanently' : 'Delete Record'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
