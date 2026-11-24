import { createContext, useContext, useState, useEffect, useMemo, useRef, ReactNode, Dispatch, SetStateAction, useCallback } from 'react';
import { Report, DiaryItem, EventItem, TeamMember, WeeklyIssue, HeroConfig, StatItemConfig, AnnouncementItem } from '../types';
import { 
  REPORTS as initialReports, 
  DIARY_NATIONAL as initialDiaryNat, 
  DIARY_LOCAL as initialDiaryLoc, 
  DIARY_AFRICA as initialDiaryAfr, 
  DIARY_OTHER as initialDiaryOth, 
  EVENTS as initialEvents, 
  TEAM as initialTeam, 
  WEEKLY_ISSUES as initialWeekly,
  ANNOUNCEMENTS as initialAnnouncements
} from '../data';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, deleteDoc, doc, DocumentData, getDocs, limit, onSnapshot, orderBy, query, QueryDocumentSnapshot, setDoc, getDoc, runTransaction, startAfter, where } from 'firebase/firestore';
import { checkIsAdminUser } from '../lib/adminSession';
import { saveAssetToFirestore, loadAssetFromFirestore, removeUndefined } from '../lib/firebaseAssets';
import { handleFirestoreError, OperationType } from '../lib/firebaseError';
import { sortItemsByDate } from '../utils/date';
import { generateSlug } from '../utils/url';
import {
  DcmEditorialHandoverRecord,
  DcmEditorialHandoverStatus,
  DcmEvidenceRecord,
  DcmIncidentDevelopment,
  DcmIncidentRecord,
  DcmPrivateNoteRecord,
  DcmPublication
} from '../types/dcm';
import { INITIAL_DCM_PUBLICATIONS } from '../data/dcmInitialData';
import {
  formatDailyDateLabel,
  formatWatCutoff,
  validateDailyPublication,
  validateLegacyPublication
} from '../utils/dcmDaily';
import { auditPublicationConsistency } from '../utils/dcmConsistency';
import { getDcmChronoTimestamp } from '../utils/dcmComparison';
import {
  sanitizeExternalUrl,
  validateEvidenceRecord,
  validateIncidentDevelopment,
  validateIncidentRecord,
  validatePrivateNoteRecord
} from '../utils/dcmEvidence';
import {
  DAILY_ARCHIVE_INITIAL_WINDOW,
  validateEditorialHandoverRecord
} from '../utils/dcmEditorial';
import { ApeaAudit, ApeaPublicReportFile, ApeaReportDetail, APEA_DATA, PUBLIC_REPORTS, REPORT_INFO } from '../data/apeaData';

const SUPER_ADMIN_UID = 's39PbuZxqdW1x63i0SsEVE7HqGQ2';

const INITIAL_HERO_CONFIG: HeroConfig = {
  badgeText: "Independent · Non-partisan · Evidence-based",
  title: "Monitoring election integrity across {Nigeria & Africa}.",
  description: "We observe, audit and report on electoral processes — anchored to primary documents and verifiable data, never to rumour. From live monitoring to forensic post-election analysis.",
  exploreButtonText: "Explore the EHII Index",
  auditButtonText: "Audit Reports",
  spotlightBadgeText: "Next election in view",
  spotlightStatusText: "IREV Data",
  spotlightTitle: "Osun State Governorship",
  spotlightDateText: "Saturday, 15 August 2026 · INEC Monitored",
  spotlightTargetDate: "2026-08-15T08:00:00+01:00",
  lgasCount: "30 LGAs + Area Office",
  registeredVoters: "2,339,233 voters",
  pollingUnits: "3,763 PUs",
  spotlightBottomText: "Athena is deploying 1,200 trained field observers to map BVAS compliance and upload forms EC8A to our independent verification pipeline.",
  diaryLinkText: "Open the Diary of Election",
  
  heroBgColor: "#1E3A5F",
  titleFontSize: "text-4xl sm:text-5xl lg:text-6xl",
  titleFontFamily: "font-display",
  titleColor: "#FFFFFF",
  titleHighlightFrom: "#93C5FD",
  titleHighlightTo: "#86EFAC",
  descriptionFontSize: "text-base sm:text-lg",
  descriptionFontFamily: "font-sans",
  descriptionColor: "#DBEAFE"
};

const INITIAL_STATS_CONFIG: StatItemConfig[] = [
  {
    id: 1,
    title: 'States Monitored',
    value: '4+',
    sub: 'Anambra · Ondo · Ekiti · Osun',
    color: 'bg-gradient-to-br from-blue-600 to-navy-dark',
    iconName: 'Shield',
    detail: 'Our state-by-state deployment maps regional irregularities, accreditation compliance, and local collation workflows.',
    cardBgType: 'gradient',
    cardBgSolid: '#1E3A5F',
    cardBgGradFrom: '#2563EB',
    cardBgGradTo: '#15304F',
    titleFontSize: 'text-xs',
    titleFontFamily: 'font-mono',
    titleColor: '#E2E8F0',
    valueFontSize: 'text-3xl sm:text-4xl',
    valueFontFamily: 'font-display',
    valueColor: '#FFFFFF'
  },
  {
    id: 2,
    title: 'Polling Units Audited',
    value: '12,000+',
    sub: 'Across recent off-cycle polls',
    color: 'bg-gradient-to-br from-green-600 to-green-950',
    iconName: 'Database',
    detail: 'Every single audited unit has its Form EC8A manually cross-checked with BVAS machine registers for discrepancy metrics.',
    cardBgType: 'gradient',
    cardBgSolid: '#166534',
    cardBgGradFrom: '#16A34A',
    cardBgGradTo: '#14532D',
    titleFontSize: 'text-xs',
    titleFontFamily: 'font-mono',
    titleColor: '#DCFCE7',
    valueFontSize: 'text-3xl sm:text-4xl',
    valueFontFamily: 'font-display',
    valueColor: '#FFFFFF'
  },
  {
    id: 3,
    title: 'Reports Published',
    value: '10+',
    sub: 'Forensic & analytical',
    color: 'bg-gradient-to-br from-brand-purple to-purple-950',
    iconName: 'FileSpreadsheet',
    detail: 'Includes peer-reviewed technology security whitepapers, post-election litigation reports, and procedural recommendations.',
    cardBgType: 'gradient',
    cardBgSolid: '#6B21A8',
    cardBgGradFrom: '#7C3AED',
    cardBgGradTo: '#3B0764',
    titleFontSize: 'text-xs',
    titleFontFamily: 'font-mono',
    titleColor: '#F3E8FF',
    valueFontSize: 'text-3xl sm:text-4xl',
    valueFontFamily: 'font-display',
    valueColor: '#FFFFFF'
  },
  {
    id: 4,
    title: 'Countries Tracked',
    value: '15',
    sub: 'Nigeria, Africa & beyond',
    color: 'bg-gradient-to-br from-slate-700 to-ink',
    iconName: 'Globe',
    detail: 'We track macro-democratic trends, regional election tribunals, and comparative electoral administration across West Africa.',
    cardBgType: 'gradient',
    cardBgSolid: '#374151',
    cardBgGradFrom: '#4B5563',
    cardBgGradTo: '#111827',
    titleFontSize: 'text-xs',
    titleFontFamily: 'font-mono',
    titleColor: '#F3F4F6',
    valueFontSize: 'text-3xl sm:text-4xl',
    valueFontFamily: 'font-display',
    valueColor: '#FFFFFF'
  }
];

interface CMSContextType {
  reports: Report[];
  diaryNat: DiaryItem[];
  diaryLoc: DiaryItem[];
  diaryAfr: DiaryItem[];
  diaryOth: DiaryItem[];
  events: EventItem[];
  announcements: AnnouncementItem[];
  team: TeamMember[];
  weekly: WeeklyIssue[];
  heroConfig: HeroConfig;
  statsConfig: StatItemConfig[];
  dataLoaded: boolean;
  
  // Update/Add/Delete handlers
  saveReport: (report: Report) => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
  
  saveDiaryItem: (category: 'national' | 'local' | 'africa' | 'other', item: DiaryItem) => Promise<void>;
  deleteDiaryItem: (category: 'national' | 'local' | 'africa' | 'other', id: string) => Promise<void>;
  
  saveEvent: (event: EventItem) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;

  saveAnnouncement: (announcement: AnnouncementItem) => Promise<void>;
  deleteAnnouncement: (id: string) => Promise<void>;
  
  saveTeamMember: (member: TeamMember) => Promise<void>;
  deleteTeamMember: (id: string) => Promise<void>;
  
  saveWeeklyIssue: (issue: WeeklyIssue) => Promise<void>;
  deleteWeeklyIssue: (id: string) => Promise<void>;
  
  saveHeroConfig: (config: HeroConfig) => Promise<void>;
  saveStatsConfig: (config: StatItemConfig[]) => Promise<void>;

  dcmPublications: DcmPublication[];
  dcmLegacyPublications: DcmPublication[];
  dcmDailyPublications: DcmPublication[];
  saveDcmPublication: (pub: DcmPublication) => Promise<void>;
  deleteDcmPublication: (id: string) => Promise<void>;
  saveDailyDcmPublication: (pub: DcmPublication) => Promise<DcmPublication>;
  deleteDailyDcmPublication: (id: string) => Promise<void>;

  // Stage 3: Public Evidence, Incident History & Admin-Only Confidential Notes
  dcmEvidence: DcmEvidenceRecord[];
  dcmIncidents: DcmIncidentRecord[];
  dcmIncidentDevelopments: DcmIncidentDevelopment[];
  dcmPrivateNotes: DcmPrivateNoteRecord[];
  saveDcmEvidence: (record: DcmEvidenceRecord) => Promise<DcmEvidenceRecord>;
  deleteDcmEvidence: (id: string) => Promise<void>;
  saveDcmIncident: (record: DcmIncidentRecord) => Promise<DcmIncidentRecord>;
  deleteDcmIncident: (id: string) => Promise<void>;
  saveDcmIncidentDevelopment: (record: DcmIncidentDevelopment) => Promise<DcmIncidentDevelopment>;
  deleteDcmIncidentDevelopment: (id: string) => Promise<void>;
  saveDcmPrivateNote: (note: DcmPrivateNoteRecord) => Promise<DcmPrivateNoteRecord>;
  deleteDcmPrivateNote: (id: string) => Promise<void>;

  // Stage 5, 6 & 7: Strictly bounded chronological archive queries, cursor pagination, accurate error & retry strategy
  dcmArchiveQueryMode: 'indexed-chronological' | 'index-required-error' | 'admin-full';
  dcmArchiveError: {
    code: 'missing-index' | 'query-error';
    collection: string;
    message: string;
    requiredIndex: string;
    canRetry: boolean;
    failedAtIso: string;
  } | null;
  dcmDailyHasMore: boolean;
  retryDcmArchiveQueries: () => void;
  loadDcmPublicationById: (publicationId: string) => Promise<DcmPublication | null>;
  loadDcmArchiveMonth: (year: number, month: number) => Promise<DcmPublication[]>;
  loadOlderDailyPublications: (beforeAssessmentDate?: string, pageSize?: number) => Promise<DcmPublication[]>;
  loadDcmStateEvidence: (stateCode: string) => Promise<void>;

  // Stage 6: Admin-only Editorial Handover Records (Newsletter & ClearPath extracts)
  dcmEditorialHandovers: DcmEditorialHandoverRecord[];
  saveDcmEditorialHandover: (record: DcmEditorialHandoverRecord) => Promise<DcmEditorialHandoverRecord>;
  updateDcmEditorialHandoverStatus: (
    handoverId: string,
    handoverStatus: DcmEditorialHandoverStatus,
    recipientTeam?: string
  ) => Promise<DcmEditorialHandoverRecord>;

  apeaAudits: ApeaAudit[];
  apeaPublicReports: Record<string, ApeaPublicReportFile>;
  apeaReportInfo: Record<string, ApeaReportDetail>;
  saveApeaAudit: (audit: ApeaAudit) => Promise<void>;
  deleteApeaAudit: (code: string) => Promise<void>;
  saveApeaReportPdf: (code: string, reportFile: ApeaPublicReportFile) => Promise<void>;
  saveApeaReportInfo: (code: string, detail: ApeaReportDetail) => Promise<void>;
  resetApeaData: () => Promise<void>;

  incrementPublicationStat: (type: 'report' | 'weekly' | 'announcement', id: string, statType: 'reads' | 'downloads') => Promise<void>;
  resetAllData: (confirmationPhrase?: string) => Promise<void>;
  restorePublicationsBackup: () => Promise<{ success: boolean; count: number }>;
  refreshData: () => Promise<void>;
  exportAllDataJson: () => string;
  importDataJson: (jsonStr: string, confirmationPhrase?: string) => Promise<{ success: boolean; message: string }>;
}

const CMSContext = createContext<CMSContextType | undefined>(undefined);

// Helper to apply remote collection updates from Firestore as authoritative source of truth,
// while preserving in-memory base64 PDF/image data for items referencing asset docs until hydration completes.
function applyRemoteCollection<T extends { id: string; pdfUrl?: string; image?: string; date?: string; title?: string }>(
  localItems: T[],
  remoteItems: T[]
): T[] {
  if (!remoteItems || !Array.isArray(remoteItems)) return localItems || [];

  const localMap = new Map((localItems || []).map(item => [item.id, item]));

  const merged = remoteItems.map(remoteItem => {
    const localMatch = localMap.get(remoteItem.id);
    const itemCopy = { ...remoteItem } as any;

    if (itemCopy.title && !itemCopy.slug) {
      itemCopy.slug = generateSlug(itemCopy.title);
    }

    if (itemCopy.pdfUrl && itemCopy.pdfUrl.startsWith('ref:')) {
      if (localMatch && localMatch.pdfUrl && !localMatch.pdfUrl.startsWith('ref:')) {
        itemCopy.pdfUrl = localMatch.pdfUrl;
      }
    }

    if (itemCopy.image && itemCopy.image.startsWith('ref:')) {
      if (localMatch && localMatch.image && !localMatch.image.startsWith('ref:')) {
        itemCopy.image = localMatch.image;
      }
    }

    // Preserve existing local reads & downloads counters if remote item does not define them
    if (typeof itemCopy.reads !== 'number' && typeof (localMatch as any)?.reads === 'number') {
      itemCopy.reads = (localMatch as any).reads;
    }
    if (typeof itemCopy.downloads !== 'number' && typeof (localMatch as any)?.downloads === 'number') {
      itemCopy.downloads = (localMatch as any).downloads;
    }

    return itemCopy as T;
  });

  return sortItemsByDate(merged, 'date', 'desc');
}

// Sanitizes item heavy assets before saving to collection array document
async function sanitizeItemAssets(item: any): Promise<any> {
  if (!item || !item.id) return item;
  const copy = { ...item };
  if (copy.pdfUrl && copy.pdfUrl.startsWith('data:')) {
    const refKey = await saveAssetToFirestore('pdf', copy.id, copy.pdfUrl);
    copy.pdfUrl = refKey;
  }
  if (copy.image && copy.image.startsWith('data:')) {
    const refKey = await saveAssetToFirestore('img', copy.id, copy.image);
    copy.image = refKey;
  }
  return removeUndefined(copy);
}

// Automatic multi-layer backup to protect against data wipe
const saveBackupSnapshot = async (
  currentReports: Report[],
  currentWeekly: WeeklyIssue[],
  currentAnnouncements: AnnouncementItem[]
) => {
  try {
    const payload = {
      reports: currentReports.map(r => ({
        ...r,
        pdfUrl: r.pdfUrl?.startsWith('data:') ? `ref:pdf_${r.id}` : r.pdfUrl,
        image: r.image?.startsWith('data:') ? `ref:img_${r.id}` : r.image
      })),
      weekly: currentWeekly.map(w => ({
        ...w,
        pdfUrl: w.pdfUrl?.startsWith('data:') ? `ref:pdf_${w.id}` : w.pdfUrl,
        image: w.image?.startsWith('data:') ? `ref:img_${w.id}` : w.image
      })),
      announcements: currentAnnouncements,
      backedUpAt: Date.now()
    };

    // 1. Cloud Firestore backup document
    await setDoc(doc(db, 'cms', 'publications_backup'), removeUndefined(payload));

    // 2. Browser LocalStorage backup
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('aeo_publications_backup', JSON.stringify(payload));
      } catch (e) {
        // LocalStorage quota limit ignored
      }
    }
  } catch (err) {
    console.warn('Backup snapshot error:', err);
    handleFirestoreError(err, OperationType.WRITE, 'cms/publications_backup');
  }
};

export function CMSProvider({ children }: { children: ReactNode }) {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [reports, setReports] = useState<Report[]>(initialReports);
  const [diaryNat, setDiaryNat] = useState<DiaryItem[]>(initialDiaryNat);
  const [diaryLoc, setDiaryLoc] = useState<DiaryItem[]>(initialDiaryLoc);
  const [diaryAfr, setDiaryAfr] = useState<DiaryItem[]>(initialDiaryAfr);
  const [diaryOth, setDiaryOth] = useState<DiaryItem[]>(initialDiaryOth);
  const [events, setEvents] = useState<EventItem[]>(initialEvents);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>(initialAnnouncements);
  const [team, setTeam] = useState<TeamMember[]>(initialTeam);
  const [weekly, setWeekly] = useState<WeeklyIssue[]>(initialWeekly);
  const [heroConfig, setHeroConfig] = useState<HeroConfig>(INITIAL_HERO_CONFIG);
  const [statsConfig, setStatsConfig] = useState<StatItemConfig[]>(INITIAL_STATS_CONFIG);
  const [dcmLegacyPublications, setDcmLegacyPublications] = useState<DcmPublication[]>(INITIAL_DCM_PUBLICATIONS);
  const [dcmDailyPublications, setDcmDailyPublications] = useState<DcmPublication[]>([]);
  const [dcmEvidence, setDcmEvidence] = useState<DcmEvidenceRecord[]>([]);
  const [dcmIncidents, setDcmIncidents] = useState<DcmIncidentRecord[]>([]);
  const [dcmIncidentDevelopments, setDcmIncidentDevelopments] = useState<DcmIncidentDevelopment[]>([]);
  const [dcmPrivateNotes, setDcmPrivateNotes] = useState<DcmPrivateNoteRecord[]>([]);
  const [dcmEditorialHandovers, setDcmEditorialHandovers] = useState<DcmEditorialHandoverRecord[]>([]);
  const [dcmArchiveQueryMode, setDcmArchiveQueryMode] = useState<'indexed-chronological' | 'index-required-error' | 'admin-full'>('indexed-chronological');
  const [dcmArchiveError, setDcmArchiveError] = useState<{
    code: 'missing-index' | 'query-error';
    collection: string;
    message: string;
    requiredIndex: string;
    canRetry: boolean;
    failedAtIso: string;
  } | null>(null);
  const [dcmDailyHasMore, setDcmDailyHasMore] = useState<boolean>(false);
  const [dcmQueryRetryToken, setDcmQueryRetryToken] = useState<number>(0);
  const lastDailyDocSnapRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [isAdminViewer, setIsAdminViewer] = useState<boolean>(false);

  const retryDcmArchiveQueries = useCallback(() => {
    setDcmArchiveError(null);
    lastDailyDocSnapRef.current = null;
    setDcmQueryRetryToken((n) => n + 1);
  }, []);
  const [apeaAudits, setApeaAudits] = useState<ApeaAudit[]>(APEA_DATA);
  const [apeaPublicReports, setApeaPublicReports] = useState<Record<string, ApeaPublicReportFile>>(PUBLIC_REPORTS);
  const [apeaReportInfo, setApeaReportInfo] = useState<Record<string, ApeaReportDetail>>(REPORT_INFO);

  // Merge legacy period publications and scalable daily publications (deduplicated by ID, newest first)
  const dcmPublications = useMemo(() => {
    const byId = new Map<string, DcmPublication>();
    for (const legacy of dcmLegacyPublications) {
      if (legacy && legacy.id) {
        byId.set(legacy.id, {
          ...legacy,
          publicationFormat: legacy.publicationFormat || 'legacy-period'
        });
      }
    }
    for (const daily of dcmDailyPublications) {
      if (daily && daily.id) {
        byId.set(daily.id, {
          ...daily,
          publicationFormat: 'daily'
        });
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a)
    );
  }, [dcmLegacyPublications, dcmDailyPublications]);

  // Subscribe to Firestore in Real-Time for global site sync with STRICT 100% READ-ONLY LISTENERS
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];
    let loadedCount = 0;
    const totalDocs = 13;

    const subscribeSafe = <T,>(
      docName: string, 
      setter: Dispatch<SetStateAction<T>>, 
      fallbackVal: T,
      transform?: (data: T) => T
    ) => {
      const docRef = doc(db, 'cms', docName);
      let isFirst = true;
      return onSnapshot(docRef, snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data && (data.items !== undefined || data.config !== undefined)) {
            let raw = data.items !== undefined ? data.items : data.config;

            if (Array.isArray(raw)) {
              raw = raw.filter((item: any) => item && item.id);
            }

            const finalVal = transform ? transform(raw as T) : (raw as T);
            if (Array.isArray(finalVal)) {
              setter(localVal => applyRemoteCollection(localVal as any, finalVal as any) as unknown as T);
            } else {
              setter(finalVal);
            }
          }
        } else {
          // Document does NOT exist in Firestore:
          // CRITICAL REQUIREMENT: 100% READ-ONLY! Set local fallback state, NEVER call setDoc or syncToFirestore!
          setter(fallbackVal);
        }
        
        if (isFirst) {
          isFirst = false;
          loadedCount++;
          if (loadedCount >= totalDocs) {
            setDataLoaded(true);
          }
        }
      }, err => {
        console.warn(`Firestore snapshot error for ${docName}:`, err);
        handleFirestoreError(err, OperationType.GET, `cms/${docName}`);
        if (isFirst) {
          isFirst = false;
          loadedCount++;
          if (loadedCount >= totalDocs) {
            setDataLoaded(true);
          }
        }
      });
    };

    unsubscribes.push(subscribeSafe('reports', setReports, initialReports));
    unsubscribes.push(subscribeSafe('diary_nat', setDiaryNat, initialDiaryNat));
    unsubscribes.push(subscribeSafe('diary_loc', setDiaryLoc, initialDiaryLoc));
    unsubscribes.push(subscribeSafe('diary_afr', setDiaryAfr, initialDiaryAfr));
    unsubscribes.push(subscribeSafe('diary_oth', setDiaryOth, initialDiaryOth));
    unsubscribes.push(subscribeSafe('events', setEvents, initialEvents));
    unsubscribes.push(subscribeSafe('announcements', setAnnouncements, initialAnnouncements));
    unsubscribes.push(subscribeSafe('team', setTeam, initialTeam));
    unsubscribes.push(subscribeSafe('weekly', setWeekly, initialWeekly));
    unsubscribes.push(subscribeSafe('hero', setHeroConfig, INITIAL_HERO_CONFIG, (cfg: HeroConfig) => {
      if (cfg.spotlightStatusText === 'Off-Cycle') cfg.spotlightStatusText = 'IREV Data';
      if (cfg.registeredVoters === '1,955,657 voters' || cfg.registeredVoters === '1,955,657') {
        cfg.registeredVoters = '2,339,233 voters';
      }
      return cfg;
    }));
    unsubscribes.push(subscribeSafe('stats', setStatsConfig, INITIAL_STATS_CONFIG));
    // Legacy DCM publications are subscribed conditionally by auth role below:
    // - Public visitors read strictly published-only projection `/cms/dcm_publications_public`
    // - Authorised admins read full `/cms/dcm_publications` (preserving unpublished drafts such as dcm-2026-11-end)

    // Custom listener for APEA audits document
    const apeaDocRef = doc(db, 'cms', 'apea_audits');
    unsubscribes.push(onSnapshot(apeaDocRef, snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data?.audits && Array.isArray(data.audits)) {
          setApeaAudits(data.audits);
        }
        if (data?.reports && typeof data.reports === 'object') {
          setApeaPublicReports(prev => ({ ...prev, ...data.reports }));
        }
        if (data?.reportInfo && typeof data.reportInfo === 'object') {
          setApeaReportInfo(prev => ({ ...prev, ...data.reportInfo }));
        }
      }
    }, err => {
      console.warn('Firestore snapshot error for apea_audits:', err);
    }));

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, []);

  // Track authorised admin authentication state to scope daily DCM collection queries safely
  useEffect(() => {
    let active = true;
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        if (active) setIsAdminViewer(false);
        return;
      }
      try {
        const res = await checkIsAdminUser(user);
        if (active) setIsAdminViewer(res.isAuthorized);
      } catch {
        if (active) setIsAdminViewer(false);
      }
    });
    return () => {
      active = false;
      unsubAuth();
    };
  }, []);

  // Role-scoped legacy DCM listener (data-access isolation for unpublished drafts in /cms/dcm_publications):
  // - Unauthenticated / non-admin visitors NEVER read `/cms/dcm_publications` (which holds unpublished drafts such as dcm-2026-11-end).
  //   They read strictly published-only records from `/cms/dcm_publications_public` (falling back to published INITIAL_DCM_PUBLICATIONS).
  // - Authorised admins read `/cms/dcm_publications` and non-destructively project ONLY `status === 'published'`
  //   legacy editions into `/cms/dcm_publications_public` without altering any draft record.
  useEffect(() => {
    let cancelled = false;
    const legacyDocId = isAdminViewer ? 'dcm_publications' : 'dcm_publications_public';
    const legacyDocRef = doc(db, 'cms', legacyDocId);

    const unsubLegacy = onSnapshot(
      legacyDocRef,
      (snapshot) => {
        if (cancelled) return;
        if (snapshot.exists() && Array.isArray(snapshot.data()?.items)) {
          const rawItems = snapshot.data()!.items as DcmPublication[];
          const scopedItems = isAdminViewer
            ? rawItems
            : rawItems.filter((item) => item && item.status === 'published');
          setDcmLegacyPublications(scopedItems.length > 0 || isAdminViewer ? scopedItems : INITIAL_DCM_PUBLICATIONS);

          if (isAdminViewer && auth.currentUser) {
            const publishedProjection = rawItems.filter((item) => item && item.status === 'published');
            const publicRef = doc(db, 'cms', 'dcm_publications_public');
            getDoc(publicRef)
              .then((pubSnap) => {
                if (cancelled) return;
                const existingPublic: DcmPublication[] =
                  pubSnap.exists() && Array.isArray(pubSnap.data()?.items) ? pubSnap.data()!.items : [];
                const existingSig = existingPublic.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
                const nextSig = publishedProjection.map((p) => `${p.id}:${p.updatedAt || 0}`).join('|');
                if (!pubSnap.exists() || existingSig !== nextSig) {
                  return setDoc(
                    publicRef,
                    removeUndefined({
                      items: publishedProjection,
                      updatedAt: Date.now()
                    })
                  );
                }
              })
              .catch((syncErr) => {
                console.warn('Notice syncing published-only legacy DCM projection:', syncErr?.message || syncErr);
              });
          }
        } else if (!isAdminViewer) {
          setDcmLegacyPublications(INITIAL_DCM_PUBLICATIONS);
        }
      },
      (err) => {
        console.warn(`Firestore snapshot notice for cms/${legacyDocId}:`, err?.message || err);
        if (!isAdminViewer) {
          setDcmLegacyPublications(INITIAL_DCM_PUBLICATIONS);
        }
      }
    );

    return () => {
      cancelled = true;
      unsubLegacy();
    };
  }, [isAdminViewer]);

  // Scalable read-only real-time listener for individual daily DCM publication documents.
  // Stage 6 & 7 Hardening:
  // - Public visitors execute a strictly bounded chronological query:
  //     where('status', '==', 'published'), orderBy('assessmentDate', 'desc'), limit(60)
  //   so the newest published daily editions ALWAYS appear first and Firestore reads stay bounded.
  // - Captures the trailing QueryDocumentSnapshot cursor so cursor-based pagination (loadOlderDailyPublications)
  //   never skips same-date revisions (e.g. -r1 / -r2) across page boundaries.
  // - NEVER executes an unbounded full-collection fallback in Production and NEVER silently truncates with an
  //   unordered limit(). If a required composite index is missing ('failed-precondition'), surfaces an accurate
  //   error state (dcmArchiveError) with an explicit retry strategy (retryDcmArchiveQueries).
  useEffect(() => {
    const dailyCol = collection(db, 'dcm_daily_publications');
    let activeUnsub: (() => void) | null = null;
    let cancelled = false;

    const applySnapshot = (snapshot: any, isPublicBounded: boolean) => {
      const loaded: DcmPublication[] = [];
      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data() as DcmPublication;
        if (data && data.id) {
          if (!isAdminViewer && data.status !== 'published') return;
          loaded.push({
            ...data,
            publicationFormat: 'daily'
          });
        }
      });
      if (isPublicBounded) {
        const docs = snapshot.docs || [];
        lastDailyDocSnapRef.current = docs.length > 0 ? docs[docs.length - 1] : null;
        setDcmDailyHasMore(docs.length >= DAILY_ARCHIVE_INITIAL_WINDOW);
      } else {
        lastDailyDocSnapRef.current = null;
        setDcmDailyHasMore(false);
      }
      setDcmArchiveError((prev) =>
        prev?.collection === 'dcm_daily_publications' ? null : prev
      );
      setDcmDailyPublications((prev) => {
        // Merge any previously on-demand fetched published historical editions with the live window
        const byId = new Map<string, DcmPublication>();
        for (const existing of prev) {
          if (!isAdminViewer && existing.status !== 'published') continue;
          byId.set(existing.id, existing);
        }
        for (const item of loaded) {
          byId.set(item.id, item);
        }
        const merged = Array.from(byId.values());
        merged.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
        return merged;
      });
    };

    if (isAdminViewer) {
      setDcmArchiveQueryMode('admin-full');
      activeUnsub = onSnapshot(
        dailyCol,
        (snap) => applySnapshot(snap, false),
        (err) => {
          console.warn('Firestore snapshot notice for dcm_daily_publications (admin):', err?.message || err);
          setDcmDailyPublications([]);
        }
      );
    } else {
      setDcmArchiveQueryMode('indexed-chronological');
      const indexedChronoQuery = query(
        dailyCol,
        where('status', '==', 'published'),
        orderBy('assessmentDate', 'desc'),
        limit(DAILY_ARCHIVE_INITIAL_WINDOW)
      );

      activeUnsub = onSnapshot(
        indexedChronoQuery,
        (snap) => applySnapshot(snap, true),
        (err: any) => {
          if (cancelled) return;
          const isMissingIndex =
            err?.code === 'failed-precondition' ||
            String(err?.message || '').toLowerCase().includes('index');
          const requiredIndex = 'dcm_daily_publications (status ASC, assessmentDate DESC)';
          setDcmArchiveQueryMode('index-required-error');
          setDcmArchiveError({
            code: isMissingIndex ? 'missing-index' : 'query-error',
            collection: 'dcm_daily_publications',
            message: isMissingIndex
              ? 'The daily DCM archive index is not yet available in this database environment. Latest daily publications cannot be verified until the required Firestore composite index is deployed.'
              : 'Unable to load the latest daily DCM archive right now. Please retry.',
            requiredIndex,
            canRetry: true,
            failedAtIso: new Date().toISOString()
          });
          console.warn(
            `Bounded chronological query failed for ${requiredIndex}:`,
            err?.message || err
          );
        }
      );
    }

    return () => {
      cancelled = true;
      if (activeUnsub) activeUnsub();
    };
  }, [isAdminViewer, dcmQueryRetryToken]);

  // Stage 3, 5, 6 & 7: Strictly bounded chronologically ordered real-time listeners for Public Evidence,
  // Incident History, Incident Developments, and Admin-Only Isolated Confidential Notes & Editorial Handovers.
  // Never performs unbounded public full-collection scans if a composite index is missing; surfaces accurate error + retry.
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    let cancelled = false;

    const subscribeBoundedOrderedPublic = <T extends { id: string; status?: string; visibility?: string }>(
      colName: string,
      orderField: string,
      maxItems: number,
      onItems: (items: T[]) => void,
      onFail: () => void
    ) => {
      const colRef = collection(db, colName);
      const parseSnap = (snapshot: any) => {
        const items: T[] = [];
        snapshot.forEach((docSnap: any) => {
          const data = docSnap.data() as T;
          if (!data || !data.id) return;
          if (!isAdminViewer && (data.status !== 'published' || data.visibility !== 'public')) return;
          items.push(data);
        });
        setDcmArchiveError((prev) => (prev?.collection === colName ? null : prev));
        onItems(items);
      };

      if (isAdminViewer) {
        unsubs.push(
          onSnapshot(colRef, parseSnap, (err) => {
            console.warn(`Firestore snapshot notice for ${colName}:`, err?.message || err);
            onFail();
          })
        );
        return;
      }

      const primaryQuery = query(
        colRef,
        where('status', '==', 'published'),
        where('visibility', '==', 'public'),
        orderBy(orderField, 'desc'),
        limit(maxItems)
      );

      const primaryUnsub = onSnapshot(
        primaryQuery,
        parseSnap,
        (err: any) => {
          if (cancelled) return;
          const isMissingIndex =
            err?.code === 'failed-precondition' ||
            String(err?.message || '').toLowerCase().includes('index');
          const requiredIndex = `${colName} (status ASC, visibility ASC, ${orderField} DESC)`;
          if (isMissingIndex) {
            setDcmArchiveError((prev) =>
              prev || {
                code: 'missing-index',
                collection: colName,
                message: `Public ${colName.replace(/^dcm_/, '').replace(/_/g, ' ')} records require the composite Firestore index (${requiredIndex}) before loading.`,
                requiredIndex,
                canRetry: true,
                failedAtIso: new Date().toISOString()
              }
            );
          }
          console.warn(`Bounded chronological query failed for ${requiredIndex}:`, err?.message || err);
          onFail();
        }
      );

      unsubs.push(primaryUnsub);
    };

    subscribeBoundedOrderedPublic<DcmEvidenceRecord>(
      'dcm_evidence',
      'sourcePublicationDate',
      150,
      (items) => {
        setDcmEvidence((prev) => {
          const byId = new Map<string, DcmEvidenceRecord>();
          for (const existing of prev) {
            if (!isAdminViewer && (existing.status !== 'published' || existing.visibility !== 'public')) continue;
            byId.set(existing.id, existing);
          }
          for (const item of items) byId.set(item.id, item);
          const merged = Array.from(byId.values());
          merged.sort((a, b) => (b.sourcePublicationDate || '').localeCompare(a.sourcePublicationDate || ''));
          return merged;
        });
      },
      () => setDcmEvidence([])
    );

    subscribeBoundedOrderedPublic<DcmIncidentRecord>(
      'dcm_incidents',
      'firstReportedDate',
      150,
      (items) => {
        setDcmIncidents((prev) => {
          const byId = new Map<string, DcmIncidentRecord>();
          for (const existing of prev) {
            if (!isAdminViewer && (existing.status !== 'published' || existing.visibility !== 'public')) continue;
            byId.set(existing.id, existing);
          }
          for (const item of items) byId.set(item.id, item);
          const merged = Array.from(byId.values());
          merged.sort((a, b) => (b.firstReportedDate || '').localeCompare(a.firstReportedDate || ''));
          return merged;
        });
      },
      () => setDcmIncidents([])
    );

    subscribeBoundedOrderedPublic<DcmIncidentDevelopment>(
      'dcm_incident_developments',
      'developmentDate',
      250,
      (items) => {
        setDcmIncidentDevelopments((prev) => {
          const byId = new Map<string, DcmIncidentDevelopment>();
          for (const existing of prev) {
            if (!isAdminViewer && (existing.status !== 'published' || existing.visibility !== 'public')) continue;
            byId.set(existing.id, existing);
          }
          for (const item of items) byId.set(item.id, item);
          const merged = Array.from(byId.values());
          merged.sort((a, b) => (a.developmentDate || '').localeCompare(b.developmentDate || ''));
          return merged;
        });
      },
      () => setDcmIncidentDevelopments([])
    );

    if (isAdminViewer) {
      const notesCol = collection(db, 'dcm_private_notes');
      unsubs.push(
        onSnapshot(
          notesCol,
          (snapshot) => {
            const items: DcmPrivateNoteRecord[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as DcmPrivateNoteRecord;
              if (data && data.id) items.push(data);
            });
            items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            setDcmPrivateNotes(items);
          },
          (err) => {
            console.warn('Firestore snapshot notice for dcm_private_notes:', err?.message || err);
            setDcmPrivateNotes([]);
          }
        )
      );

      // Stage 6: Admin-only Editorial Handovers audit collection
      const handoversCol = collection(db, 'dcm_editorial_handovers');
      unsubs.push(
        onSnapshot(
          handoversCol,
          (snapshot) => {
            const items: DcmEditorialHandoverRecord[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data() as DcmEditorialHandoverRecord;
              if (data && data.id) items.push(data);
            });
            items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setDcmEditorialHandovers(items);
          },
          (err) => {
            console.warn('Firestore snapshot notice for dcm_editorial_handovers:', err?.message || err);
            setDcmEditorialHandovers([]);
          }
        )
      );
    } else {
      setDcmPrivateNotes([]);
      setDcmEditorialHandovers([]);
    }

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [isAdminViewer, dcmQueryRetryToken]);

  // Sync individual PDF and Image documents from Firestore once live data is connected
  useEffect(() => {
    if (!dataLoaded) return;
    let cancelled = false;

    const hydrateAssets = async () => {
      // Hydrate Reports
      for (const r of reports) {
        if (cancelled) return;
        if (r.id && r.pdfUrl && r.pdfUrl.startsWith('ref:')) {
          try {
            const fullPdf = await loadAssetFromFirestore('pdf', r.pdfUrl);
            if (fullPdf && !cancelled) {
              setReports(prev => prev.map(item => item.id === r.id ? { ...item, pdfUrl: fullPdf } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate PDF for ${r.id}:`, e);
          }
        }
        if (r.id && r.image && r.image.startsWith('ref:')) {
          try {
            const fullImg = await loadAssetFromFirestore('img', r.image);
            if (fullImg && !cancelled) {
              setReports(prev => prev.map(item => item.id === r.id ? { ...item, image: fullImg } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate image for ${r.id}:`, e);
          }
        }
      }

      // Hydrate Weekly Issues
      for (const w of weekly) {
        if (cancelled) return;
        if (w.id && w.pdfUrl && w.pdfUrl.startsWith('ref:')) {
          try {
            const fullPdf = await loadAssetFromFirestore('pdf', w.pdfUrl);
            if (fullPdf && !cancelled) {
              setWeekly(prev => prev.map(item => item.id === w.id ? { ...item, pdfUrl: fullPdf } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate weekly PDF for ${w.id}:`, e);
          }
        }
        if (w.id && w.image && w.image.startsWith('ref:')) {
          try {
            const fullImg = await loadAssetFromFirestore('img', w.image);
            if (fullImg && !cancelled) {
              setWeekly(prev => prev.map(item => item.id === w.id ? { ...item, image: fullImg } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate weekly image for ${w.id}:`, e);
          }
        }
      }

      // Hydrate Announcements
      for (const a of announcements) {
        if (cancelled) return;
        if (a.id && a.pdfUrl && a.pdfUrl.startsWith('ref:')) {
          try {
            const fullPdf = await loadAssetFromFirestore('pdf', a.pdfUrl);
            if (fullPdf && !cancelled) {
              setAnnouncements(prev => prev.map(item => item.id === a.id ? { ...item, pdfUrl: fullPdf } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate announcement PDF for ${a.id}:`, e);
          }
        }
        if (a.id && a.image && a.image.startsWith('ref:')) {
          try {
            const fullImg = await loadAssetFromFirestore('img', a.image);
            if (fullImg && !cancelled) {
              setAnnouncements(prev => prev.map(item => item.id === a.id ? { ...item, image: fullImg } : item));
            }
          } catch (e) {
            console.warn(`Could not hydrate announcement image for ${a.id}:`, e);
          }
        }
      }
    };

    hydrateAssets();

    return () => {
      cancelled = true;
    };
  }, [
    dataLoaded,
    reports.map(r => r.id + (r.pdfUrl ? r.pdfUrl.substring(0, 8) : '') + (r.image ? r.image.substring(0, 8) : '')).join(','),
    weekly.map(w => w.id + (w.pdfUrl ? w.pdfUrl.substring(0, 8) : '') + (w.image ? w.image.substring(0, 8) : '')).join(','),
    announcements.map(a => a.id + (a.pdfUrl ? a.pdfUrl.substring(0, 8) : '') + (a.image ? a.image.substring(0, 8) : '')).join(',')
  ]);

  // SAFE TRANSACTIONAL MUTATION HANDLERS
  // Reads live authoritative document state directly within runTransaction to prevent race conditions

  const saveReport = async (report: Report) => {
    const path = 'cms/reports';
    try {
      const sanitizedReport = await sanitizeItemAssets({
        ...report,
        slug: report.slug ? generateSlug(report.slug) : generateSlug(report.title),
        createdAt: report.createdAt || Date.now()
      });

      let updatedSorted: Report[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'reports');
        const sfDoc = await transaction.get(docRef);
        let currentItems: Report[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const existsIndex = currentItems.findIndex(r => r.id === report.id);
        let updatedItems: Report[];
        if (existsIndex > -1) {
          const existing = currentItems[existsIndex];
          const merged: Report = {
            ...existing,
            ...sanitizedReport,
            reads: typeof report.reads === 'number' ? report.reads : (typeof existing.reads === 'number' ? existing.reads : 0),
            downloads: typeof report.downloads === 'number' ? report.downloads : (typeof existing.downloads === 'number' ? existing.downloads : 0),
          };
          updatedItems = [...currentItems];
          updatedItems[existsIndex] = merged;
        } else {
          updatedItems = [{
            ...sanitizedReport,
            reads: typeof report.reads === 'number' ? report.reads : 0,
            downloads: typeof report.downloads === 'number' ? report.downloads : 0,
          }, ...currentItems];
        }

        updatedSorted = sortItemsByDate(updatedItems, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setReports(updatedSorted);
      await saveBackupSnapshot(updatedSorted, weekly, announcements);
    } catch (err) {
      console.error('Error saving report in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteReport = async (id: string) => {
    const path = 'cms/reports';
    try {
      let updatedSorted: Report[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'reports');
        const sfDoc = await transaction.get(docRef);
        let currentItems: Report[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const next = currentItems.filter(r => r.id !== id);
        updatedSorted = sortItemsByDate(next, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setReports(updatedSorted);
      await saveBackupSnapshot(updatedSorted, weekly, announcements);
    } catch (err) {
      console.error('Error deleting report in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveWeeklyIssue = async (issue: WeeklyIssue) => {
    const path = 'cms/weekly';
    try {
      const sanitizedIssue = await sanitizeItemAssets({
        ...issue,
        slug: issue.slug ? generateSlug(issue.slug) : generateSlug(issue.title),
        createdAt: issue.createdAt || Date.now()
      });

      let updatedSorted: WeeklyIssue[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'weekly');
        const sfDoc = await transaction.get(docRef);
        let currentItems: WeeklyIssue[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const existsIndex = currentItems.findIndex(w => w.id === issue.id);
        let updatedItems: WeeklyIssue[];
        if (existsIndex > -1) {
          const existing = currentItems[existsIndex];
          const merged: WeeklyIssue = {
            ...existing,
            ...sanitizedIssue,
            reads: typeof issue.reads === 'number' ? issue.reads : (typeof existing.reads === 'number' ? existing.reads : 0),
            downloads: typeof issue.downloads === 'number' ? issue.downloads : (typeof existing.downloads === 'number' ? existing.downloads : 0),
          };
          updatedItems = [...currentItems];
          updatedItems[existsIndex] = merged;
        } else {
          updatedItems = [{
            ...sanitizedIssue,
            reads: typeof issue.reads === 'number' ? issue.reads : 0,
            downloads: typeof issue.downloads === 'number' ? issue.downloads : 0,
          }, ...currentItems];
        }

        updatedSorted = sortItemsByDate(updatedItems, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setWeekly(updatedSorted);
      await saveBackupSnapshot(reports, updatedSorted, announcements);
    } catch (err) {
      console.error('Error saving weekly issue in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteWeeklyIssue = async (id: string) => {
    const path = 'cms/weekly';
    try {
      let updatedSorted: WeeklyIssue[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'weekly');
        const sfDoc = await transaction.get(docRef);
        let currentItems: WeeklyIssue[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const next = currentItems.filter(w => w.id !== id);
        updatedSorted = sortItemsByDate(next, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setWeekly(updatedSorted);
      await saveBackupSnapshot(reports, updatedSorted, announcements);
    } catch (err) {
      console.error('Error deleting weekly issue in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveAnnouncement = async (announcement: AnnouncementItem) => {
    const path = 'cms/announcements';
    try {
      const sanitizedAnn = await sanitizeItemAssets({
        ...announcement,
        slug: announcement.slug ? generateSlug(announcement.slug) : generateSlug(announcement.title),
        createdAt: announcement.createdAt || Date.now()
      });

      let updatedSorted: AnnouncementItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'announcements');
        const sfDoc = await transaction.get(docRef);
        let currentItems: AnnouncementItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const existsIndex = currentItems.findIndex(a => a.id === announcement.id);
        let updatedItems: AnnouncementItem[];
        if (existsIndex > -1) {
          const existing = currentItems[existsIndex];
          const merged: AnnouncementItem = {
            ...existing,
            ...sanitizedAnn,
            reads: typeof announcement.reads === 'number' ? announcement.reads : (typeof existing.reads === 'number' ? existing.reads : 0),
            downloads: typeof announcement.downloads === 'number' ? announcement.downloads : (typeof existing.downloads === 'number' ? existing.downloads : 0),
          };
          updatedItems = [...currentItems];
          updatedItems[existsIndex] = merged;
        } else {
          updatedItems = [{
            ...sanitizedAnn,
            reads: typeof announcement.reads === 'number' ? announcement.reads : 0,
            downloads: typeof announcement.downloads === 'number' ? announcement.downloads : 0,
          }, ...currentItems];
        }

        updatedSorted = sortItemsByDate(updatedItems, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setAnnouncements(updatedSorted);
      await saveBackupSnapshot(reports, weekly, updatedSorted);
    } catch (err) {
      console.error('Error saving announcement in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteAnnouncement = async (id: string) => {
    const path = 'cms/announcements';
    try {
      let updatedSorted: AnnouncementItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'announcements');
        const sfDoc = await transaction.get(docRef);
        let currentItems: AnnouncementItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const next = currentItems.filter(a => a.id !== id);
        updatedSorted = sortItemsByDate(next, 'date', 'desc');
        transaction.set(docRef, removeUndefined({ items: updatedSorted, updatedAt: Date.now() }));
      });

      setAnnouncements(updatedSorted);
      await saveBackupSnapshot(reports, weekly, updatedSorted);
    } catch (err) {
      console.error('Error deleting announcement in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveDiaryItem = async (category: 'national' | 'local' | 'africa' | 'other', item: DiaryItem) => {
    const docKey = category === 'national' ? 'diary_nat' : category === 'local' ? 'diary_loc' : category === 'africa' ? 'diary_afr' : 'diary_oth';
    const path = `cms/${docKey}`;
    try {
      let nextSorted: DiaryItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', docKey);
        const sfDoc = await transaction.get(docRef);
        let current: DiaryItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const exists = current.some(d => d.id === item.id);
        const unsorted = exists ? current.map(d => d.id === item.id ? item : d) : [...current, item];
        nextSorted = sortItemsByDate(unsorted, 'date', 'asc');
        transaction.set(docRef, removeUndefined({ items: nextSorted, updatedAt: Date.now() }));
      });

      if (category === 'national') setDiaryNat(nextSorted);
      else if (category === 'local') setDiaryLoc(nextSorted);
      else if (category === 'africa') setDiaryAfr(nextSorted);
      else if (category === 'other') setDiaryOth(nextSorted);
    } catch (err) {
      console.error(`Error saving diary ${category} in transaction:`, err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteDiaryItem = async (category: 'national' | 'local' | 'africa' | 'other', id: string) => {
    const docKey = category === 'national' ? 'diary_nat' : category === 'local' ? 'diary_loc' : category === 'africa' ? 'diary_afr' : 'diary_oth';
    const path = `cms/${docKey}`;
    try {
      let nextSorted: DiaryItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', docKey);
        const sfDoc = await transaction.get(docRef);
        let current: DiaryItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const next = current.filter(d => d.id !== id);
        nextSorted = sortItemsByDate(next, 'date', 'asc');
        transaction.set(docRef, removeUndefined({ items: nextSorted, updatedAt: Date.now() }));
      });

      if (category === 'national') setDiaryNat(nextSorted);
      else if (category === 'local') setDiaryLoc(nextSorted);
      else if (category === 'africa') setDiaryAfr(nextSorted);
      else if (category === 'other') setDiaryOth(nextSorted);
    } catch (err) {
      console.error(`Error deleting diary ${category} in transaction:`, err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveEvent = async (event: EventItem) => {
    const path = 'cms/events';
    try {
      let nextEvents: EventItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'events');
        const sfDoc = await transaction.get(docRef);
        let current: EventItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const exists = current.some(e => e.id === event.id);
        nextEvents = exists ? current.map(e => e.id === event.id ? event : e) : [...current, event];
        transaction.set(docRef, removeUndefined({ items: nextEvents, updatedAt: Date.now() }));
      });

      setEvents(nextEvents);
    } catch (err) {
      console.error('Error saving event in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteEvent = async (id: string) => {
    const path = 'cms/events';
    try {
      let nextEvents: EventItem[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'events');
        const sfDoc = await transaction.get(docRef);
        let current: EventItem[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        nextEvents = current.filter(e => e.id !== id);
        transaction.set(docRef, removeUndefined({ items: nextEvents, updatedAt: Date.now() }));
      });

      setEvents(nextEvents);
    } catch (err) {
      console.error('Error deleting event in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveTeamMember = async (member: TeamMember) => {
    const path = 'cms/team';
    try {
      let nextTeam: TeamMember[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'team');
        const sfDoc = await transaction.get(docRef);
        let current: TeamMember[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const exists = current.some(t => t.id === member.id);
        nextTeam = exists ? current.map(t => t.id === member.id ? member : t) : [...current, member];
        transaction.set(docRef, removeUndefined({ items: nextTeam, updatedAt: Date.now() }));
      });

      setTeam(nextTeam);
    } catch (err) {
      console.error('Error saving team member in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteTeamMember = async (id: string) => {
    const path = 'cms/team';
    try {
      let nextTeam: TeamMember[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'team');
        const sfDoc = await transaction.get(docRef);
        let current: TeamMember[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        nextTeam = current.filter(t => t.id !== id);
        transaction.set(docRef, removeUndefined({ items: nextTeam, updatedAt: Date.now() }));
      });

      setTeam(nextTeam);
    } catch (err) {
      console.error('Error deleting team member in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const saveHeroConfig = async (config: HeroConfig) => {
    const path = 'cms/hero';
    try {
      await setDoc(doc(db, 'cms', 'hero'), removeUndefined({ config, updatedAt: Date.now() }));
      setHeroConfig(config);
    } catch (err) {
      console.error('Error saving hero config:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const saveStatsConfig = async (config: StatItemConfig[]) => {
    const path = 'cms/stats';
    try {
      await setDoc(doc(db, 'cms', 'stats'), removeUndefined({ items: config, updatedAt: Date.now() }));
      setStatsConfig(config);
    } catch (err) {
      console.error('Error saving stats config:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const saveDcmPublication = async (pub: DcmPublication) => {
    const path = 'cms/dcm_publications';
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Unauthorised: You must be signed in as an authorised AEO administrator to save DCM publications.');
    }
    const authCheck = await checkIsAdminUser(currentUser);
    if (!authCheck.isAuthorized) {
      throw new Error(authCheck.reason || 'Unauthorised: Administrator privileges are required to modify DCM publications.');
    }

    // Route daily publications automatically to the scalable daily collection
    if (pub.publicationFormat === 'daily') {
      await saveDailyDcmPublication(pub);
      return;
    }

    try {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const stampedApproval =
        pub.approvalRecord?.approved
          ? {
              ...pub.approvalRecord,
              approved: true,
              recordedByUid: currentUser.uid,
              recordedByEmail: currentUser.email || undefined,
              recordedAt: pub.approvalRecord.recordedAt || nowIso,
              approvedByUid: currentUser.uid,
              approvedByEmail: currentUser.email || undefined,
              verificationMode: 'admin-recorded-reference' as const
            }
          : undefined;

      const sanitizedPub = await sanitizeItemAssets({
        ...pub,
        publicationFormat: 'legacy-period',
        approvalRecord: stampedApproval,
        publishedAt: pub.status === 'published' ? (pub.publishedAt || nowIso) : undefined,
        isLatest: pub.status === 'published' ? Boolean(pub.isLatest) : false,
        updatedAt: now,
        createdByUid: pub.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      });

      let nextDcm: DcmPublication[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'dcm_publications');
        const sfDoc = await transaction.get(docRef);
        const current: DcmPublication[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items)
          ? sfDoc.data()!.items
          : INITIAL_DCM_PUBLICATIONS;

        const existingDoc = current.find(p => p.id === sanitizedPub.id) || null;
        if (existingDoc && existingDoc.status === 'published') {
          throw new Error(
            `Historical protection: Published edition "${existingDoc.id}" cannot be overwritten. Issue a corrected revision instead so the previous version is preserved.`
          );
        }

        const validation = validateLegacyPublication(sanitizedPub, {
          isAuthorizedAdmin: true,
          actorUid: currentUser.uid,
          existingDoc
        });
        if (!validation.valid) {
          throw new Error(validation.errors.join(' '));
        }

        const consistency = auditPublicationConsistency(sanitizedPub);
        if (!consistency.consistent) {
          throw new Error(`Consistency check failed: ${consistency.errors.join(' ')}`);
        }

        const exists = Boolean(existingDoc);
        nextDcm = exists ? current.map(p => p.id === sanitizedPub.id ? sanitizedPub : p) : [sanitizedPub, ...current];
        if (sanitizedPub.status === 'published' && sanitizedPub.isLatest) {
          nextDcm = nextDcm.map(p => p.id === sanitizedPub.id ? p : { ...p, isLatest: false });
        }

        nextDcm.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
        const tsNow = Date.now();
        transaction.set(docRef, removeUndefined({ items: nextDcm, updatedAt: tsNow }));
        transaction.set(
          doc(db, 'cms', 'dcm_publications_public'),
          removeUndefined({
            items: nextDcm.filter((p) => p && p.status === 'published'),
            updatedAt: tsNow
          })
        );
      });

      setDcmLegacyPublications(nextDcm);
    } catch (err) {
      console.error('Error saving DCM publication in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
      throw err;
    }
  };

  const deleteDcmPublication = async (id: string) => {
    const path = 'cms/dcm_publications';
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Unauthorised: You must be signed in as an authorised AEO administrator to delete DCM publications.');
    }
    const authCheck = await checkIsAdminUser(currentUser);
    if (!authCheck.isAuthorized) {
      throw new Error(authCheck.reason || 'Unauthorised: Administrator privileges are required to delete DCM publications.');
    }

    try {
      let nextDcm: DcmPublication[] = [];

      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'dcm_publications');
        const sfDoc = await transaction.get(docRef);
        const current: DcmPublication[] = sfDoc.exists() && Array.isArray(sfDoc.data()?.items) ? sfDoc.data()!.items : [];

        const target = current.find(p => p.id === id);
        if (target && target.status === 'published') {
          throw new Error(
            `Historical protection: Published DCM edition "${id}" cannot be deleted.`
          );
        }

        nextDcm = current.filter(p => p.id !== id);
        const tsNow = Date.now();
        transaction.set(docRef, removeUndefined({ items: nextDcm, updatedAt: tsNow }));
        transaction.set(
          doc(db, 'cms', 'dcm_publications_public'),
          removeUndefined({
            items: nextDcm.filter((p) => p && p.status === 'published'),
            updatedAt: tsNow
          })
        );
      });

      setDcmLegacyPublications(nextDcm);
    } catch (err) {
      console.error('Error deleting DCM publication in transaction:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
      throw err;
    }
  };

  const saveDailyDcmPublication = async (pub: DcmPublication): Promise<DcmPublication> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Unauthorised: You must be signed in as an authorised AEO administrator to manage daily DCM publications.');
    }
    const authCheck = await checkIsAdminUser(currentUser);
    if (!authCheck.isAuthorized) {
      throw new Error(authCheck.reason || 'Unauthorised: Administrator privileges are required to publish daily DCM updates.');
    }

    const docPath = `dcm_daily_publications/${pub.id}`;
    const docRef = doc(db, 'dcm_daily_publications', pub.id);

    try {
      const existingSnap = await getDoc(docRef);
      const existingDoc = existingSnap.exists() ? (existingSnap.data() as DcmPublication) : null;

      if (existingDoc && existingDoc.status === 'published') {
        throw new Error(
          `Historical protection: Published daily edition "${existingDoc.id}" cannot be overwritten. Issue a corrected revision or start a new daily edition instead.`
        );
      }

      const watCutoff = formatWatCutoff(pub.assessmentDate || '', pub.evidenceCutoffTimeWat || '');
      const dateLabel = pub.assessmentDate ? formatDailyDateLabel(pub.assessmentDate) : pub.reportingPeriodLabel;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      const stampedApproval =
        pub.approvalRecord?.approved
          ? {
              ...pub.approvalRecord,
              approved: true,
              recordedByUid: currentUser.uid,
              recordedByEmail: currentUser.email || undefined,
              recordedAt: pub.approvalRecord.recordedAt || nowIso,
              approvedByUid: currentUser.uid,
              approvedByEmail: currentUser.email || undefined,
              verificationMode: 'admin-recorded-reference' as const
            }
          : undefined;

      const candidate: DcmPublication = {
        ...pub,
        publicationFormat: 'daily',
        periodStart: pub.assessmentDate || pub.periodStart,
        periodEnd: pub.assessmentDate || pub.periodEnd,
        reportingPeriodLabel: pub.reportingPeriodLabel?.trim() || dateLabel,
        publicationDate: pub.publicationDate?.trim() || dateLabel,
        evidenceCutoffDate: watCutoff.valid ? watCutoff.displayLabel : (pub.evidenceCutoffDate || ''),
        evidenceCutoffDateTimeWat: watCutoff.valid ? watCutoff.isoWat : (pub.evidenceCutoffDateTimeWat || ''),
        approvalRecord: stampedApproval,
        publishedAt: pub.status === 'published' ? (pub.publishedAt || nowIso) : undefined,
        isLatest: pub.status === 'published' ? Boolean(pub.isLatest) : false,
        createdAt: existingDoc?.createdAt || pub.createdAt || now,
        updatedAt: now,
        createdByUid: existingDoc?.createdByUid || pub.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      };

      const sourcePub = candidate.carriedForwardFromPublicationId
        ? dcmPublications.find((p) => p.id === candidate.carriedForwardFromPublicationId) || null
        : null;

      const validation = validateDailyPublication(candidate, {
        isAuthorizedAdmin: true,
        actorUid: currentUser.uid,
        existingDoc,
        sourcePub
      });

      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      const consistency = auditPublicationConsistency(candidate, sourcePub);
      if (!consistency.consistent) {
        throw new Error(`Consistency check failed: ${consistency.errors.join(' ')}`);
      }

      const payload = removeUndefined(candidate);
      await setDoc(docRef, payload);

      setDcmDailyPublications((prev) => {
        const filtered = prev.filter((item) => item.id !== candidate.id);
        return [candidate, ...filtered].sort(
          (a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a)
        );
      });

      return candidate;
    } catch (err) {
      console.error('Error saving daily DCM publication:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
      throw err;
    }
  };

  const deleteDailyDcmPublication = async (id: string): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('Unauthorised: You must be signed in as an authorised AEO administrator to delete daily drafts.');
    }
    const authCheck = await checkIsAdminUser(currentUser);
    if (!authCheck.isAuthorized) {
      throw new Error(authCheck.reason || 'Unauthorised: Administrator privileges are required.');
    }

    const docPath = `dcm_daily_publications/${id}`;
    const docRef = doc(db, 'dcm_daily_publications', id);

    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        const existingDoc = existingSnap.data() as DcmPublication;
        if (existingDoc.status === 'published') {
          throw new Error(
            `Historical protection: Published daily edition "${id}" cannot be deleted.`
          );
        }
      }

      await deleteDoc(docRef);
      setDcmDailyPublications((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Error deleting daily DCM publication:', err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
      throw err;
    }
  };

  // =========================================================================
  // STAGE 3: PUBLIC EVIDENCE, INCIDENT HISTORY & CONFIDENTIAL NOTES HANDLERS
  // Never automatically changes any state's DCM map classification or colour.
  // =========================================================================

  const requireAuthorizedAdmin = async (actionLabel: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error(`Unauthorised: You must be signed in as an authorised AEO administrator to ${actionLabel}.`);
    }
    const authCheck = await checkIsAdminUser(currentUser);
    if (!authCheck.isAuthorized) {
      throw new Error(authCheck.reason || `Unauthorised: Administrator privileges are required to ${actionLabel}.`);
    }
    return currentUser;
  };

  const stampAdminApproval = (
    approval: DcmEvidenceRecord['approvalRecord'],
    currentUser: { uid: string; email?: string | null },
    nowIso: string
  ) => {
    if (!approval) return undefined;
    return {
      ...approval,
      approvalReference: (approval.approvalReference || '').trim(),
      approvedByName: (approval.approvedByName || '').trim(),
      recordedByUid: currentUser.uid,
      recordedByEmail: currentUser.email || undefined,
      recordedAt: approval.recordedAt || nowIso,
      approvedByUid: currentUser.uid,
      approvedByEmail: currentUser.email || undefined,
      verificationMode: 'admin-recorded-reference' as const
    };
  };

  const saveDcmEvidence = async (record: DcmEvidenceRecord): Promise<DcmEvidenceRecord> => {
    const currentUser = await requireAuthorizedAdmin('save or publish evidence records');
    const docPath = `dcm_evidence/${record.id}`;
    const docRef = doc(db, 'dcm_evidence', record.id);

    try {
      const existingSnap = await getDoc(docRef);
      const existingDoc = existingSnap.exists() ? (existingSnap.data() as DcmEvidenceRecord) : null;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const urlCheck = sanitizeExternalUrl(record.sourceUrl);
      if (!urlCheck.valid) {
        throw new Error(urlCheck.error || 'Invalid source URL.');
      }

      const candidate: DcmEvidenceRecord = {
        ...record,
        sourceUrl: urlCheck.sanitizedUrl || '',
        documentReference: (record.documentReference || '').trim() || undefined,
        incidentId: (record.incidentId || '').trim() || undefined,
        linkedPublicationIds: Array.isArray(record.linkedPublicationIds) ? record.linkedPublicationIds.filter(Boolean) : [],
        approvalRecord: stampAdminApproval(record.approvalRecord, currentUser, nowIso),
        revisionNumber: record.revisionNumber || 1,
        publishedAt: record.status === 'published' ? record.publishedAt || nowIso : record.publishedAt,
        createdAt: existingDoc?.createdAt || record.createdAt || now,
        updatedAt: now,
        createdByUid: existingDoc?.createdByUid || record.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      };

      const validation = validateEvidenceRecord(candidate, {
        isAuthorizedAdmin: true,
        actorUid: currentUser.uid,
        existingDoc
      });
      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      await setDoc(docRef, removeUndefined(candidate));
      setDcmEvidence((prev) => {
        const filtered = prev.filter((item) => item.id !== candidate.id);
        return [candidate, ...filtered].sort((a, b) =>
          (b.sourcePublicationDate || '').localeCompare(a.sourcePublicationDate || '')
        );
      });
      return candidate;
    } catch (err) {
      console.error('Error saving DCM evidence record:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
      throw err;
    }
  };

  const deleteDcmEvidence = async (id: string): Promise<void> => {
    await requireAuthorizedAdmin('delete evidence drafts');
    const docPath = `dcm_evidence/${id}`;
    const docRef = doc(db, 'dcm_evidence', id);
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists() && (existingSnap.data() as DcmEvidenceRecord).status === 'published') {
        throw new Error(`Historical protection: Published evidence record "${id}" cannot be deleted.`);
      }
      await deleteDoc(docRef);
      setDcmEvidence((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Error deleting DCM evidence record:', err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
      throw err;
    }
  };

  const saveDcmIncident = async (record: DcmIncidentRecord): Promise<DcmIncidentRecord> => {
    const currentUser = await requireAuthorizedAdmin('save or publish incident records');
    const docPath = `dcm_incidents/${record.id}`;
    const docRef = doc(db, 'dcm_incidents', record.id);

    try {
      const existingSnap = await getDoc(docRef);
      const existingDoc = existingSnap.exists() ? (existingSnap.data() as DcmIncidentRecord) : null;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      const candidate: DcmIncidentRecord = {
        ...record,
        linkedPublicationIds: Array.isArray(record.linkedPublicationIds) ? record.linkedPublicationIds.filter(Boolean) : [],
        approvalRecord: stampAdminApproval(record.approvalRecord, currentUser, nowIso),
        revisionNumber: record.revisionNumber || 1,
        publishedAt: record.status === 'published' ? record.publishedAt || nowIso : record.publishedAt,
        createdAt: existingDoc?.createdAt || record.createdAt || now,
        updatedAt: now,
        createdByUid: existingDoc?.createdByUid || record.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      };

      const validation = validateIncidentRecord(candidate, {
        isAuthorizedAdmin: true,
        actorUid: currentUser.uid,
        existingDoc
      });
      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      await setDoc(docRef, removeUndefined(candidate));
      setDcmIncidents((prev) => {
        const filtered = prev.filter((item) => item.id !== candidate.id);
        return [candidate, ...filtered].sort((a, b) =>
          (b.firstReportedDate || '').localeCompare(a.firstReportedDate || '')
        );
      });
      return candidate;
    } catch (err) {
      console.error('Error saving DCM incident record:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
      throw err;
    }
  };

  const deleteDcmIncident = async (id: string): Promise<void> => {
    await requireAuthorizedAdmin('delete incident drafts');
    const docPath = `dcm_incidents/${id}`;
    const docRef = doc(db, 'dcm_incidents', id);
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists() && (existingSnap.data() as DcmIncidentRecord).status === 'published') {
        throw new Error(`Historical protection: Published incident record "${id}" cannot be deleted.`);
      }
      await deleteDoc(docRef);
      setDcmIncidents((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Error deleting DCM incident record:', err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
      throw err;
    }
  };

  const saveDcmIncidentDevelopment = async (
    record: DcmIncidentDevelopment
  ): Promise<DcmIncidentDevelopment> => {
    const currentUser = await requireAuthorizedAdmin('save or publish incident developments');
    const docPath = `dcm_incident_developments/${record.id}`;
    const docRef = doc(db, 'dcm_incident_developments', record.id);

    try {
      const existingSnap = await getDoc(docRef);
      const existingDoc = existingSnap.exists() ? (existingSnap.data() as DcmIncidentDevelopment) : null;
      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      const sanitizedRefs = (record.sourceReferences || []).map((ref) => {
        const check = sanitizeExternalUrl(ref.url);
        if (!check.valid) throw new Error(check.error || 'Invalid source URL on development.');
        return {
          sourceName: (ref.sourceName || '').trim(),
          publicationDate: ref.publicationDate,
          ...(check.sanitizedUrl ? { url: check.sanitizedUrl } : {}),
          ...(ref.documentReference?.trim() ? { documentReference: ref.documentReference.trim() } : {})
        };
      });

      const candidate: DcmIncidentDevelopment = {
        ...record,
        sourceReferences: sanitizedRefs,
        linkedEvidenceIds: Array.isArray(record.linkedEvidenceIds) ? record.linkedEvidenceIds.filter(Boolean) : undefined,
        linkedPublicationIds: Array.isArray(record.linkedPublicationIds) ? record.linkedPublicationIds.filter(Boolean) : undefined,
        approvalRecord: stampAdminApproval(record.approvalRecord, currentUser, nowIso),
        revisionNumber: record.revisionNumber || 1,
        publishedAt: record.status === 'published' ? record.publishedAt || nowIso : record.publishedAt,
        createdAt: existingDoc?.createdAt || record.createdAt || now,
        updatedAt: now,
        createdByUid: existingDoc?.createdByUid || record.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      };

      const validation = validateIncidentDevelopment(candidate, {
        isAuthorizedAdmin: true,
        actorUid: currentUser.uid,
        existingDoc
      });
      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      await setDoc(docRef, removeUndefined(candidate));
      setDcmIncidentDevelopments((prev) => {
        const filtered = prev.filter((item) => item.id !== candidate.id);
        return [candidate, ...filtered].sort((a, b) =>
          (a.developmentDate || '').localeCompare(b.developmentDate || '')
        );
      });
      return candidate;
    } catch (err) {
      console.error('Error saving DCM incident development:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
      throw err;
    }
  };

  const deleteDcmIncidentDevelopment = async (id: string): Promise<void> => {
    await requireAuthorizedAdmin('delete incident development drafts');
    const docPath = `dcm_incident_developments/${id}`;
    const docRef = doc(db, 'dcm_incident_developments', id);
    try {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists() && (existingSnap.data() as DcmIncidentDevelopment).status === 'published') {
        throw new Error(`Historical protection: Published incident development "${id}" cannot be deleted.`);
      }
      await deleteDoc(docRef);
      setDcmIncidentDevelopments((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Error deleting DCM incident development:', err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
      throw err;
    }
  };

  const saveDcmPrivateNote = async (note: DcmPrivateNoteRecord): Promise<DcmPrivateNoteRecord> => {
    const currentUser = await requireAuthorizedAdmin('save confidential notes');
    const docPath = `dcm_private_notes/${note.id}`;
    const docRef = doc(db, 'dcm_private_notes', note.id);

    try {
      const existingSnap = await getDoc(docRef);
      const existingDoc = existingSnap.exists() ? (existingSnap.data() as DcmPrivateNoteRecord) : null;
      const now = Date.now();
      const candidate: DcmPrivateNoteRecord = {
        ...note,
        confidentialNotes: (note.confidentialNotes || '').trim(),
        confidentialContacts: (note.confidentialContacts || '').trim() || undefined,
        unverifiedLeads: (note.unverifiedLeads || '').trim() || undefined,
        createdAt: existingDoc?.createdAt || note.createdAt || now,
        updatedAt: now,
        createdByUid: existingDoc?.createdByUid || currentUser.uid,
        updatedByUid: currentUser.uid
      };

      const validation = validatePrivateNoteRecord(candidate, {
        isAuthorizedAdmin: true,
        actorUid: currentUser.uid
      });
      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      await setDoc(docRef, removeUndefined(candidate));
      setDcmPrivateNotes((prev) => {
        const filtered = prev.filter((item) => item.id !== candidate.id);
        return [candidate, ...filtered].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      });
      return candidate;
    } catch (err) {
      console.error('Error saving confidential DCM note:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
      throw err;
    }
  };

  const deleteDcmPrivateNote = async (id: string): Promise<void> => {
    await requireAuthorizedAdmin('delete confidential notes');
    const docPath = `dcm_private_notes/${id}`;
    try {
      await deleteDoc(doc(db, 'dcm_private_notes', id));
      setDcmPrivateNotes((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Error deleting confidential DCM note:', err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
      throw err;
    }
  };

  const saveApeaAudit = async (audit: ApeaAudit) => {
    const path = 'cms/apea_audits';
    try {
      let nextAudits: ApeaAudit[] = [];
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'apea_audits');
        const sfDoc = await transaction.get(docRef);
        const data = sfDoc.exists() ? sfDoc.data() : {};
        const currentAudits: ApeaAudit[] = Array.isArray(data?.audits) ? data.audits : APEA_DATA;

        const existsIdx = currentAudits.findIndex(a => a.code === audit.code);
        if (existsIdx >= 0) {
          nextAudits = [...currentAudits];
          nextAudits[existsIdx] = audit;
        } else {
          nextAudits = [audit, ...currentAudits];
        }

        const currentReports = data?.reports || apeaPublicReports;
        const currentInfo = data?.reportInfo || apeaReportInfo;

        transaction.set(docRef, removeUndefined({
          audits: nextAudits,
          reports: currentReports,
          reportInfo: currentInfo,
          updatedAt: Date.now()
        }));
      });
      setApeaAudits(nextAudits);
    } catch (err) {
      console.error('Error saving APEA audit in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
      throw err;
    }
  };

  const deleteApeaAudit = async (code: string) => {
    const path = 'cms/apea_audits';
    try {
      let nextAudits: ApeaAudit[] = [];
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'apea_audits');
        const sfDoc = await transaction.get(docRef);
        const data = sfDoc.exists() ? sfDoc.data() : {};
        const currentAudits: ApeaAudit[] = Array.isArray(data?.audits) ? data.audits : APEA_DATA;

        nextAudits = currentAudits.filter(a => a.code !== code);
        const currentReports = data?.reports || apeaPublicReports;
        const currentInfo = data?.reportInfo || apeaReportInfo;

        transaction.set(docRef, removeUndefined({
          audits: nextAudits,
          reports: currentReports,
          reportInfo: currentInfo,
          updatedAt: Date.now()
        }));
      });
      setApeaAudits(nextAudits);
    } catch (err) {
      console.error('Error deleting APEA audit:', err);
      handleFirestoreError(err, OperationType.DELETE, path);
      throw err;
    }
  };

  const saveApeaReportPdf = async (code: string, reportFile: ApeaPublicReportFile) => {
    const path = 'cms/apea_audits';
    try {
      let nextReports: Record<string, ApeaPublicReportFile> = {};
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'apea_audits');
        const sfDoc = await transaction.get(docRef);
        const data = sfDoc.exists() ? sfDoc.data() : {};
        const currentReports = data?.reports || apeaPublicReports;

        nextReports = {
          ...currentReports,
          [code]: reportFile
        };

        const currentAudits = data?.audits || apeaAudits;
        const currentInfo = data?.reportInfo || apeaReportInfo;

        transaction.set(docRef, removeUndefined({
          audits: currentAudits,
          reports: nextReports,
          reportInfo: currentInfo,
          updatedAt: Date.now()
        }));
      });
      setApeaPublicReports(nextReports);
    } catch (err) {
      console.error('Error saving APEA report PDF in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
      throw err;
    }
  };

  const saveApeaReportInfo = async (code: string, detail: ApeaReportDetail) => {
    const path = 'cms/apea_audits';
    try {
      let nextInfo: Record<string, ApeaReportDetail> = {};
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', 'apea_audits');
        const sfDoc = await transaction.get(docRef);
        const data = sfDoc.exists() ? sfDoc.data() : {};
        const currentInfo = data?.reportInfo || apeaReportInfo;

        nextInfo = {
          ...currentInfo,
          [code]: detail
        };

        const currentAudits = data?.audits || apeaAudits;
        const currentReports = data?.reports || apeaPublicReports;

        transaction.set(docRef, removeUndefined({
          audits: currentAudits,
          reports: currentReports,
          reportInfo: nextInfo,
          updatedAt: Date.now()
        }));
      });
      setApeaReportInfo(nextInfo);
    } catch (err) {
      console.error('Error saving APEA report detail in transaction:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
      throw err;
    }
  };

  const resetApeaData = async () => {
    const path = 'cms/apea_audits';
    try {
      await setDoc(doc(db, 'cms', 'apea_audits'), removeUndefined({
        audits: APEA_DATA,
        reports: PUBLIC_REPORTS,
        reportInfo: REPORT_INFO,
        updatedAt: Date.now()
      }));
      setApeaAudits(APEA_DATA);
      setApeaPublicReports(PUBLIC_REPORTS);
      setApeaReportInfo(REPORT_INFO);
    } catch (err) {
      console.error('Error resetting APEA data:', err);
      handleFirestoreError(err, OperationType.WRITE, path);
      throw err;
    }
  };

  // Safe transactional stat incrementation: atomic update inside transaction without full document rewrite or asset loss
  const incrementPublicationStat = async (type: 'report' | 'weekly' | 'announcement', id: string, statType: 'reads' | 'downloads') => {
    // 1. Immediately update in-memory state so session counters increment smoothly in UI
    if (type === 'report') {
      setReports(prev => prev.map(item => item.id === id ? { ...item, [statType]: (typeof item[statType] === 'number' ? item[statType]! : 0) + 1 } : item));
    } else if (type === 'weekly') {
      setWeekly(prev => prev.map(item => item.id === id ? { ...item, [statType]: (typeof item[statType] === 'number' ? item[statType]! : 0) + 1 } : item));
    } else if (type === 'announcement') {
      setAnnouncements(prev => prev.map(item => item.id === id ? { ...item, [statType]: (typeof item[statType] === 'number' ? item[statType]! : 0) + 1 } : item));
    }

    // 2. Persist directly to Firestore via atomic transaction (accessible to all public visitors & researchers)
    const collectionKey = type === 'report' ? 'reports' : type === 'weekly' ? 'weekly' : 'announcements';
    try {
      await runTransaction(db, async (transaction) => {
        const docRef = doc(db, 'cms', collectionKey);
        const sfDoc = await transaction.get(docRef);

        if (!sfDoc.exists()) {
          // Initialize document in Firestore if not yet stored
          let baseList: any[] = [];
          if (type === 'report') baseList = [...reports];
          else if (type === 'weekly') baseList = [...weekly];
          else if (type === 'announcement') baseList = [...announcements];

          const itemIndex = baseList.findIndex((item: any) => item && item.id === id);
          if (itemIndex > -1) {
            const currentVal = typeof baseList[itemIndex][statType] === 'number' ? baseList[itemIndex][statType] : 0;
            baseList[itemIndex] = { ...baseList[itemIndex], [statType]: currentVal + 1 };
          }
          transaction.set(docRef, removeUndefined({ items: baseList, updatedAt: Date.now() }));
          return;
        }

        const data = sfDoc.data();
        const items = Array.isArray(data?.items) ? [...data.items] : [];
        const itemIndex = items.findIndex((item: any) => item && item.id === id);

        if (itemIndex > -1) {
          const item = { ...items[itemIndex] };
          const currentValue = typeof item[statType] === 'number' ? item[statType] : 0;
          item[statType] = currentValue + 1;
          items[itemIndex] = item;
          transaction.update(docRef, { items, updatedAt: Date.now() });
        } else {
          // If the item exists in local state but was not yet pushed to Firestore
          let fallbackItem: any = null;
          if (type === 'report') fallbackItem = reports.find(r => r.id === id);
          else if (type === 'weekly') fallbackItem = weekly.find(w => w.id === id);
          else if (type === 'announcement') fallbackItem = announcements.find(a => a.id === id);

          if (fallbackItem) {
            const currentVal = typeof fallbackItem[statType] === 'number' ? fallbackItem[statType] : 0;
            const newItem = { ...fallbackItem, [statType]: currentVal + 1 };
            items.push(newItem);
            transaction.update(docRef, { items, updatedAt: Date.now() });
          }
        }
      });
    } catch (error) {
      console.warn(`Stat increment skipped in Firestore for ${type} ${id}:`, error);
    }
  };

  // Reset function requiring Super Admin UID and explicit confirmation string, NEVER destroying publication collections!
  const resetAllData = async (confirmationPhrase?: string) => {
    const currentUid = auth.currentUser?.uid;
    if (currentUid !== SUPER_ADMIN_UID) {
      throw new Error("Unauthorized: Only the permanent Super Administrator can reset CMS templates.");
    }

    if (!confirmationPhrase || confirmationPhrase.trim().toUpperCase() !== 'CONFIRM RESET DATA') {
      throw new Error("Confirmation required: Please enter 'CONFIRM RESET DATA' to proceed with resetting general templates.");
    }

    // Reset ONLY non-publication general templates. Publications, DCM, and assets are NEVER wiped!
    setDiaryNat(initialDiaryNat);
    setDiaryLoc(initialDiaryLoc);
    setDiaryAfr(initialDiaryAfr);
    setDiaryOth(initialDiaryOth);
    setEvents(initialEvents);
    setTeam(initialTeam);
    setHeroConfig(INITIAL_HERO_CONFIG);
    setStatsConfig(INITIAL_STATS_CONFIG);

    const safeSync = async (docName: string, payload: any) => {
      try {
        await setDoc(doc(db, 'cms', docName), removeUndefined(payload));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `cms/${docName}`);
      }
    };

    await safeSync('diary_nat', { items: initialDiaryNat, updatedAt: Date.now() });
    await safeSync('diary_loc', { items: initialDiaryLoc, updatedAt: Date.now() });
    await safeSync('diary_afr', { items: initialDiaryAfr, updatedAt: Date.now() });
    await safeSync('diary_oth', { items: initialDiaryOth, updatedAt: Date.now() });
    await safeSync('events', { items: initialEvents, updatedAt: Date.now() });
    await safeSync('team', { items: initialTeam, updatedAt: Date.now() });
    await safeSync('hero', { config: INITIAL_HERO_CONFIG, updatedAt: Date.now() });
    await safeSync('stats', { items: INITIAL_STATS_CONFIG, updatedAt: Date.now() });
  };

  // Restore publications from cloud backup or local storage safely
  const restorePublicationsBackup = async (): Promise<{ success: boolean; count: number }> => {
    try {
      // 1. Try cloud backup
      const backupSnap = await getDoc(doc(db, 'cms', 'publications_backup'));
      let backupData = backupSnap.exists() ? backupSnap.data() : null;

      // 2. Fall back to local storage
      if (!backupData && typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem('aeo_publications_backup');
        if (stored) {
          try {
            backupData = JSON.parse(stored);
          } catch {}
        }
      }

      // 3. Fall back to initial hardcoded restored dataset
      const restoredReports = backupData?.reports || initialReports;
      const restoredWeekly = backupData?.weekly || initialWeekly;
      const restoredAnnouncements = backupData?.announcements || initialAnnouncements;

      if (restoredReports && restoredReports.length > 0) {
        setReports(restoredReports);
        await setDoc(doc(db, 'cms', 'reports'), removeUndefined({ items: restoredReports, updatedAt: Date.now() }));
      }
      if (restoredWeekly && restoredWeekly.length > 0) {
        setWeekly(restoredWeekly);
        await setDoc(doc(db, 'cms', 'weekly'), removeUndefined({ items: restoredWeekly, updatedAt: Date.now() }));
      }
      if (restoredAnnouncements && restoredAnnouncements.length > 0) {
        setAnnouncements(restoredAnnouncements);
        await setDoc(doc(db, 'cms', 'announcements'), removeUndefined({ items: restoredAnnouncements, updatedAt: Date.now() }));
      }

      const total = (restoredReports?.length || 0) + (restoredWeekly?.length || 0) + (restoredAnnouncements?.length || 0);
      return { success: true, count: total };
    } catch (err) {
      console.error('Error restoring publications backup:', err);
      handleFirestoreError(err, OperationType.WRITE, 'cms/reports');
      return { success: false, count: 0 };
    }
  };

  // Explicit refresh from cloud without destroying any data
  const refreshData = async () => {
    try {
      const repSnap = await getDoc(doc(db, 'cms', 'reports'));
      if (repSnap.exists() && Array.isArray(repSnap.data()?.items)) {
        setReports(repSnap.data()?.items);
      }
      const weekSnap = await getDoc(doc(db, 'cms', 'weekly'));
      if (weekSnap.exists() && Array.isArray(weekSnap.data()?.items)) {
        setWeekly(weekSnap.data()?.items);
      }
      const annSnap = await getDoc(doc(db, 'cms', 'announcements'));
      if (annSnap.exists() && Array.isArray(annSnap.data()?.items)) {
        setAnnouncements(annSnap.data()?.items);
      }
      const dNatSnap = await getDoc(doc(db, 'cms', 'diary_nat'));
      if (dNatSnap.exists() && Array.isArray(dNatSnap.data()?.items)) {
        setDiaryNat(dNatSnap.data()?.items);
      }
      const dLocSnap = await getDoc(doc(db, 'cms', 'diary_loc'));
      if (dLocSnap.exists() && Array.isArray(dLocSnap.data()?.items)) {
        setDiaryLoc(dLocSnap.data()?.items);
      }
      const dAfrSnap = await getDoc(doc(db, 'cms', 'diary_afr'));
      if (dAfrSnap.exists() && Array.isArray(dAfrSnap.data()?.items)) {
        setDiaryAfr(dAfrSnap.data()?.items);
      }
      const dOthSnap = await getDoc(doc(db, 'cms', 'diary_oth'));
      if (dOthSnap.exists() && Array.isArray(dOthSnap.data()?.items)) {
        setDiaryOth(dOthSnap.data()?.items);
      }
      const evtSnap = await getDoc(doc(db, 'cms', 'events'));
      if (evtSnap.exists() && Array.isArray(evtSnap.data()?.items)) {
        setEvents(evtSnap.data()?.items);
      }
      const teamSnap = await getDoc(doc(db, 'cms', 'team'));
      if (teamSnap.exists() && Array.isArray(teamSnap.data()?.items)) {
        setTeam(teamSnap.data()?.items);
      }
      const legacyRefreshDocId = isAdminViewer ? 'dcm_publications' : 'dcm_publications_public';
      const dcmSnap = await getDoc(doc(db, 'cms', legacyRefreshDocId));
      if (dcmSnap.exists() && Array.isArray(dcmSnap.data()?.items)) {
        const rawItems = dcmSnap.data()!.items as DcmPublication[];
        setDcmLegacyPublications(
          isAdminViewer ? rawItems : rawItems.filter((p) => p && p.status === 'published')
        );
      }
      try {
        const dailyCol = collection(db, 'dcm_daily_publications');
        const dailyQuery = isAdminViewer
          ? dailyCol
          : query(
              dailyCol,
              where('status', '==', 'published'),
              orderBy('assessmentDate', 'desc'),
              limit(DAILY_ARCHIVE_INITIAL_WINDOW)
            );
        const dailySnap = await getDocs(dailyQuery);
        const dailyItems: DcmPublication[] = [];
        dailySnap.forEach((d) => {
          const data = d.data() as DcmPublication;
          if (data && data.id) {
            dailyItems.push({ ...data, publicationFormat: 'daily' });
          }
        });
        dailyItems.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
        setDcmDailyPublications(dailyItems);
      } catch (dailyErr) {
        console.warn('Notice refreshing dcm_daily_publications:', dailyErr);
      }
    } catch (e) {
      console.warn('Error refreshing cloud data:', e);
      handleFirestoreError(e, OperationType.GET, 'cms/all');
    }
  };

  // Export entire CMS data as formatted JSON string
  const exportAllDataJson = useCallback(() => {
    const backupObj = {
      version: 2,
      exportedAt: new Date().toISOString(),
      reports,
      weekly,
      announcements,
      diaryNat,
      diaryLoc,
      diaryAfr,
      diaryOth,
      events,
      team,
      heroConfig,
      statsConfig,
      dcmPublications: dcmLegacyPublications,
      dcmDailyPublications
    };
    return JSON.stringify(backupObj, null, 2);
  }, [reports, weekly, announcements, diaryNat, diaryLoc, diaryAfr, diaryOth, events, team, heroConfig, statsConfig, dcmLegacyPublications, dcmDailyPublications]);

  // Import entire CMS data from JSON string with Super Admin UID check, schema validation, and double confirmation
  const importDataJson = async (jsonStr: string, confirmationPhrase?: string): Promise<{ success: boolean; message: string }> => {
    const currentUid = auth.currentUser?.uid;
    if (currentUid !== SUPER_ADMIN_UID) {
      return { success: false, message: 'Unauthorized: Only the Super Administrator can import database backups.' };
    }

    if (!confirmationPhrase || confirmationPhrase.trim().toUpperCase() !== 'CONFIRM RESTORE DATABASE') {
      return { success: false, message: "Confirmation required: Please type 'CONFIRM RESTORE DATABASE' to apply database backup import." };
    }

    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== 'object') {
        return { success: false, message: 'Invalid JSON file format.' };
      }

      // Schema verification helpers
      const validateItems = (arr: any[], requiredFields: string[]) => {
        if (!Array.isArray(arr)) return [];
        return arr.filter(item => item && typeof item === 'object' && requiredFields.every(field => item[field] !== undefined));
      };

      let count = 0;
      const validReports = validateItems(parsed.reports, ['id', 'title', 'summary']);
      if (validReports.length > 0) {
        setReports(validReports);
        await setDoc(doc(db, 'cms', 'reports'), removeUndefined({ items: validReports, updatedAt: Date.now() }));
        count += validReports.length;
      }

      const validWeekly = validateItems(parsed.weekly, ['id', 'title', 'summary']);
      if (validWeekly.length > 0) {
        setWeekly(validWeekly);
        await setDoc(doc(db, 'cms', 'weekly'), removeUndefined({ items: validWeekly, updatedAt: Date.now() }));
        count += validWeekly.length;
      }

      const validAnnouncements = validateItems(parsed.announcements, ['id', 'title', 'summary']);
      if (validAnnouncements.length > 0) {
        setAnnouncements(validAnnouncements);
        await setDoc(doc(db, 'cms', 'announcements'), removeUndefined({ items: validAnnouncements, updatedAt: Date.now() }));
        count += validAnnouncements.length;
      }

      const validDNat = validateItems(parsed.diaryNat, ['id', 'title', 'date']);
      if (validDNat.length > 0) {
        setDiaryNat(validDNat);
        await setDoc(doc(db, 'cms', 'diary_nat'), removeUndefined({ items: validDNat, updatedAt: Date.now() }));
      }

      const validDLoc = validateItems(parsed.diaryLoc, ['id', 'title', 'date']);
      if (validDLoc.length > 0) {
        setDiaryLoc(validDLoc);
        await setDoc(doc(db, 'cms', 'diary_loc'), removeUndefined({ items: validDLoc, updatedAt: Date.now() }));
      }

      const validDAfr = validateItems(parsed.diaryAfr, ['id', 'title', 'date']);
      if (validDAfr.length > 0) {
        setDiaryAfr(validDAfr);
        await setDoc(doc(db, 'cms', 'diary_afr'), removeUndefined({ items: validDAfr, updatedAt: Date.now() }));
      }

      const validDOth = validateItems(parsed.diaryOth, ['id', 'title', 'date']);
      if (validDOth.length > 0) {
        setDiaryOth(validDOth);
        await setDoc(doc(db, 'cms', 'diary_oth'), removeUndefined({ items: validDOth, updatedAt: Date.now() }));
      }

      const validEvents = validateItems(parsed.events, ['id', 'title']);
      if (validEvents.length > 0) {
        setEvents(validEvents);
        await setDoc(doc(db, 'cms', 'events'), removeUndefined({ items: validEvents, updatedAt: Date.now() }));
      }

      const validTeam = validateItems(parsed.team, ['id', 'name', 'role']);
      if (validTeam.length > 0) {
        setTeam(validTeam);
        await setDoc(doc(db, 'cms', 'team'), removeUndefined({ items: validTeam, updatedAt: Date.now() }));
      }

      if (parsed.heroConfig && typeof parsed.heroConfig === 'object' && parsed.heroConfig.title) {
        setHeroConfig(parsed.heroConfig);
        await setDoc(doc(db, 'cms', 'hero'), removeUndefined({ config: parsed.heroConfig, updatedAt: Date.now() }));
      }

      const validStats = validateItems(parsed.statsConfig, ['id', 'title', 'value']);
      if (validStats.length > 0) {
        setStatsConfig(validStats);
        await setDoc(doc(db, 'cms', 'stats'), removeUndefined({ items: validStats, updatedAt: Date.now() }));
      }

      const validDcm = validateItems(parsed.dcmPublications, ['id', 'title']).filter(
        (item: any) => item.publicationFormat !== 'daily'
      );
      if (validDcm.length > 0) {
        setDcmLegacyPublications(validDcm);
        const tsNow = Date.now();
        await setDoc(doc(db, 'cms', 'dcm_publications'), removeUndefined({ items: validDcm, updatedAt: tsNow }));
        await setDoc(
          doc(db, 'cms', 'dcm_publications_public'),
          removeUndefined({
            items: validDcm.filter((p: any) => p && p.status === 'published'),
            updatedAt: tsNow
          })
        );
        count += validDcm.length;
      }

      await saveBackupSnapshot(
        validReports.length > 0 ? validReports : reports,
        validWeekly.length > 0 ? validWeekly : weekly,
        validAnnouncements.length > 0 ? validAnnouncements : announcements
      );

      return { success: true, message: `Successfully validated and restored ${count} verified records into production Firestore.` };
    } catch (e: any) {
      console.error('Import error:', e);
      handleFirestoreError(e, OperationType.WRITE, 'cms/all');
      return { success: false, message: e?.message || 'Failed to parse or validate JSON backup file.' };
    }
  };


  // Stage 5: On-demand O(1) fetch for a deep historical daily publication permalink
  const loadDcmPublicationById = useCallback(async (publicationId: string): Promise<DcmPublication | null> => {
    const cleanId = (publicationId || '').trim();
    if (!cleanId) return null;
    try {
      const snap = await getDoc(doc(db, 'dcm_daily_publications', cleanId));
      if (!snap.exists()) return null;
      const data = snap.data() as DcmPublication;
      if (!data || !data.id) return null;
      // Strict public privacy enforcement: non-admin visitors can only ever receive published records
      if (!isAdminViewer && data.status !== 'published') return null;
      const normalized: DcmPublication = { ...data, publicationFormat: 'daily' };
      setDcmDailyPublications((prev) => {
        if (prev.some((p) => p.id === normalized.id)) return prev;
        const merged = [...prev, normalized];
        merged.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
        return merged;
      });
      return normalized;
    } catch (err: any) {
      console.warn(`On-demand DCM publication load notice for ${cleanId}:`, err?.message || err);
      return null;
    }
  }, [isAdminViewer]);

  // Stage 5, 6 & 7: Strictly bounded date-scoped on-demand fetch for an archive month ordered newest-first.
  // Never performs an unbounded fallback; surfaces accurate error state if required composite index is missing.
  const loadDcmArchiveMonth = useCallback(async (year: number, month: number): Promise<DcmPublication[]> => {
    try {
      const dailyCol = collection(db, 'dcm_daily_publications');
      const indexedMonthQuery = query(
        dailyCol,
        where('status', '==', 'published'),
        where('year', '==', year),
        where('month', '==', month),
        orderBy('assessmentDate', 'desc'),
        limit(62)
      );
      const snap = await getDocs(indexedMonthQuery);
      const loaded: DcmPublication[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data() as DcmPublication;
        if (data && data.id && data.status === 'published') {
          loaded.push({ ...data, publicationFormat: 'daily' });
        }
      });
      loaded.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
      if (loaded.length > 0) {
        setDcmDailyPublications((prev) => {
          const byId = new Map<string, DcmPublication>();
          for (const existing of prev) byId.set(existing.id, existing);
          for (const item of loaded) byId.set(item.id, item);
          const merged = Array.from(byId.values());
          merged.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
          return merged;
        });
      }
      return loaded;
    } catch (err: any) {
      const isMissingIndex =
        err?.code === 'failed-precondition' ||
        String(err?.message || '').toLowerCase().includes('index');
      if (isMissingIndex) {
        const requiredIndex = 'dcm_daily_publications (status ASC, year ASC, month ASC, assessmentDate DESC)';
        setDcmArchiveError({
          code: 'missing-index',
          collection: 'dcm_daily_publications',
          message: `Month-scoped archive lookup for ${year}-${String(month).padStart(2, '0')} requires composite index ${requiredIndex}.`,
          requiredIndex,
          canRetry: true,
          failedAtIso: new Date().toISOString()
        });
      }
      console.warn(`Date-scoped DCM archive load notice for ${year}-${month}:`, err?.message || err);
      return [];
    }
  }, []);

  // Stage 6 & 7: Strictly bounded cursor-based chronological pagination for loading older daily editions beyond 60.
  // Uses QueryDocumentSnapshot cursor (startAfter(lastDocSnap)) when available so same-date revisions (-r1 / -r2)
  // straddling a page boundary are NEVER skipped; never executes an unbounded collection scan.
  const loadOlderDailyPublications = useCallback(
    async (
      beforeAssessmentDate?: string,
      pageSize: number = DAILY_ARCHIVE_INITIAL_WINDOW
    ): Promise<DcmPublication[]> => {
      const boundedLimit = Math.max(1, Math.min(120, pageSize));
      const cleanCursor = (beforeAssessmentDate || '').trim();
      const docCursor = lastDailyDocSnapRef.current;
      if (!docCursor && !/^\d{4}-\d{2}-\d{2}$/.test(cleanCursor)) return [];

      try {
        const dailyCol = collection(db, 'dcm_daily_publications');
        const paginatedQuery = docCursor
          ? query(
              dailyCol,
              where('status', '==', 'published'),
              orderBy('assessmentDate', 'desc'),
              startAfter(docCursor),
              limit(boundedLimit)
            )
          : query(
              dailyCol,
              where('status', '==', 'published'),
              orderBy('assessmentDate', 'desc'),
              startAfter(cleanCursor),
              limit(boundedLimit)
            );
        const snap = await getDocs(paginatedQuery);

        const docs = snap.docs || [];
        if (docs.length > 0) {
          lastDailyDocSnapRef.current = docs[docs.length - 1];
        }
        setDcmDailyHasMore(docs.length >= boundedLimit);

        const loaded: DcmPublication[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as DcmPublication;
          if (!data || !data.id || data.status !== 'published') return;
          loaded.push({ ...data, publicationFormat: 'daily' });
        });
        loaded.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));

        if (loaded.length > 0) {
          setDcmDailyPublications((prev) => {
            const byId = new Map<string, DcmPublication>();
            for (const existing of prev) byId.set(existing.id, existing);
            for (const item of loaded) byId.set(item.id, item);
            const merged = Array.from(byId.values());
            merged.sort((a, b) => getDcmChronoTimestamp(b) - getDcmChronoTimestamp(a));
            return merged;
          });
        }
        return loaded;
      } catch (err: any) {
        const isMissingIndex =
          err?.code === 'failed-precondition' ||
          String(err?.message || '').toLowerCase().includes('index');
        if (isMissingIndex) {
          const requiredIndex = 'dcm_daily_publications (status ASC, assessmentDate DESC)';
          setDcmArchiveError({
            code: 'missing-index',
            collection: 'dcm_daily_publications',
            message: `Older daily archive pagination requires composite index ${requiredIndex}.`,
            requiredIndex,
            canRetry: true,
            failedAtIso: new Date().toISOString()
          });
        }
        console.warn(`Paginated older daily archive load notice:`, err?.message || err);
        return [];
      }
    },
    []
  );

  // Stage 5, 6 & 7: Strictly bounded state-scoped on-demand fetch for historical public evidence & incidents.
  // Never performs an unbounded fallback; reports accurate error state if composite index is missing.
  const loadDcmStateEvidence = useCallback(async (stateCode: string): Promise<void> => {
    const cleanCode = (stateCode || '').trim().toUpperCase();
    if (!cleanCode) return;

    const getOrderedStateDocs = async (colName: string, orderField: string, maxItems: number) => {
      const colRef = collection(db, colName);
      return await getDocs(
        query(
          colRef,
          where('status', '==', 'published'),
          where('visibility', '==', 'public'),
          where('stateCode', '==', cleanCode),
          orderBy(orderField, 'desc'),
          limit(maxItems)
        )
      );
    };

    try {
      const [evSnap, incSnap, devSnap] = await Promise.all([
        getOrderedStateDocs('dcm_evidence', 'sourcePublicationDate', 100),
        getOrderedStateDocs('dcm_incidents', 'firstReportedDate', 100),
        getOrderedStateDocs('dcm_incident_developments', 'developmentDate', 200)
      ]);

      const loadedEv: DcmEvidenceRecord[] = [];
      evSnap.forEach((d) => {
        const item = d.data() as DcmEvidenceRecord;
        if (item?.id && item.status === 'published' && item.visibility === 'public') loadedEv.push(item);
      });
      if (loadedEv.length > 0) {
        setDcmEvidence((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          for (const item of loadedEv) byId.set(item.id, item);
          return Array.from(byId.values()).sort((a, b) =>
            (b.sourcePublicationDate || '').localeCompare(a.sourcePublicationDate || '')
          );
        });
      }

      const loadedInc: DcmIncidentRecord[] = [];
      incSnap.forEach((d) => {
        const item = d.data() as DcmIncidentRecord;
        if (item?.id && item.status === 'published' && item.visibility === 'public') loadedInc.push(item);
      });
      if (loadedInc.length > 0) {
        setDcmIncidents((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          for (const item of loadedInc) byId.set(item.id, item);
          return Array.from(byId.values()).sort((a, b) =>
            (b.firstReportedDate || '').localeCompare(a.firstReportedDate || '')
          );
        });
      }

      const loadedDev: DcmIncidentDevelopment[] = [];
      devSnap.forEach((d) => {
        const item = d.data() as DcmIncidentDevelopment;
        if (item?.id && item.status === 'published' && item.visibility === 'public') loadedDev.push(item);
      });
      if (loadedDev.length > 0) {
        setDcmIncidentDevelopments((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]));
          for (const item of loadedDev) byId.set(item.id, item);
          return Array.from(byId.values()).sort((a, b) =>
            (a.developmentDate || '').localeCompare(b.developmentDate || '')
          );
        });
      }
    } catch (err: any) {
      console.warn(`State-scoped DCM evidence load notice for ${cleanCode}:`, err?.message || err);
    }
  }, []);

  // Stage 6: Admin-only Editorial Handover persistence (immutable source snapshot)
  const saveDcmEditorialHandover = useCallback(
    async (record: DcmEditorialHandoverRecord): Promise<DcmEditorialHandoverRecord> => {
      const currentUser = auth.currentUser;
      const adminCheck = currentUser ? await checkIsAdminUser(currentUser) : null;
      const isAdmin = Boolean(adminCheck?.isAuthorized);
      const sourcePub = dcmPublications.find((p) => p.id === record.publicationId);

      const validation = validateEditorialHandoverRecord(record, {
        isAuthorizedAdmin: isAdmin,
        actorUid: currentUser?.uid,
        sourcePublicationStatus: sourcePub?.status || 'draft'
      });
      if (!validation.valid) {
        throw new Error(validation.errors.join(' '));
      }

      const nowMs = Date.now();
      const sanitizedRecord: DcmEditorialHandoverRecord = removeUndefined({
        ...record,
        preparedByUid: currentUser!.uid,
        createdByUid: currentUser!.uid,
        updatedByUid: currentUser!.uid,
        createdAt: record.createdAt || nowMs,
        updatedAt: nowMs
      });

      const docRef = doc(db, 'dcm_editorial_handovers', sanitizedRecord.id);
      await setDoc(docRef, sanitizedRecord);

      setDcmEditorialHandovers((prev) => {
        const next = [sanitizedRecord, ...prev.filter((h) => h.id !== sanitizedRecord.id)];
        next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return next;
      });

      return sanitizedRecord;
    },
    [dcmPublications]
  );

  const updateDcmEditorialHandoverStatus = useCallback(
    async (
      handoverId: string,
      handoverStatus: DcmEditorialHandoverStatus,
      recipientTeam?: string
    ): Promise<DcmEditorialHandoverRecord> => {
      const currentUser = auth.currentUser;
      const adminCheck = currentUser ? await checkIsAdminUser(currentUser) : null;
      const isAdmin = Boolean(adminCheck?.isAuthorized);
      if (!isAdmin || !currentUser) {
        throw new Error('Only signed-in authorised AEO administrators may update editorial handover status.');
      }

      const docRef = doc(db, 'dcm_editorial_handovers', handoverId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        throw new Error(`Editorial handover record "${handoverId}" was not found.`);
      }
      const existing = snap.data() as DcmEditorialHandoverRecord;
      const updated: DcmEditorialHandoverRecord = removeUndefined({
        ...existing,
        handoverStatus,
        ...(recipientTeam !== undefined
          ? recipientTeam.trim()
            ? { recipientTeam: recipientTeam.trim() }
            : {}
          : existing.recipientTeam
          ? { recipientTeam: existing.recipientTeam }
          : {}),
        updatedAt: Date.now(),
        updatedByUid: currentUser.uid
      });
      if (recipientTeam !== undefined && !recipientTeam.trim()) {
        delete (updated as any).recipientTeam;
      }

      await setDoc(docRef, updated);
      setDcmEditorialHandovers((prev) =>
        prev.map((h) => (h.id === handoverId ? updated : h))
      );
      return updated;
    },
    []
  );

  return (
    <CMSContext.Provider value={{
      reports,
      diaryNat,
      diaryLoc,
      diaryAfr,
      diaryOth,
      events,
      announcements,
      team,
      weekly,
      heroConfig,
      statsConfig,
      dcmPublications,
      dcmLegacyPublications,
      dcmDailyPublications,
      saveDcmPublication,
      deleteDcmPublication,
      saveDailyDcmPublication,
      deleteDailyDcmPublication,
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
      deleteDcmPrivateNote,
      dcmArchiveQueryMode,
      dcmArchiveError,
      dcmDailyHasMore,
      retryDcmArchiveQueries,
      loadDcmPublicationById,
      loadDcmArchiveMonth,
      loadOlderDailyPublications,
      loadDcmStateEvidence,
      dcmEditorialHandovers,
      saveDcmEditorialHandover,
      updateDcmEditorialHandoverStatus,
      apeaAudits,
      apeaPublicReports,
      apeaReportInfo,
      saveApeaAudit,
      deleteApeaAudit,
      saveApeaReportPdf,
      saveApeaReportInfo,
      resetApeaData,
      dataLoaded,
      saveReport,
      deleteReport,
      saveDiaryItem,
      deleteDiaryItem,
      saveEvent,
      deleteEvent,
      saveAnnouncement,
      deleteAnnouncement,
      saveTeamMember,
      deleteTeamMember,
      saveWeeklyIssue,
      deleteWeeklyIssue,
      saveHeroConfig,
      saveStatsConfig,
      incrementPublicationStat,
      resetAllData,
      restorePublicationsBackup,
      refreshData,
      exportAllDataJson,
      importDataJson
    }}>
      {children}
    </CMSContext.Provider>
  );
}

export function useCMS() {
  const context = useContext(CMSContext);
  if (!context) {
    throw new Error('useCMS must be used within a CMSProvider');
  }
  return context;
}
