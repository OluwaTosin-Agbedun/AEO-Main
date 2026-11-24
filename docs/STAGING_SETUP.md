# AEO DCM Corrections — Isolated Staging Setup & Verification Guide

> **HARD ISOLATION MANDATE**
> - **Production Firebase Project:** `gen-lang-client-0961551337` (**DO NOT USE FOR STAGING**)
> - **Production Firestore Database:** `aeo-database19` (**DO NOT USE FOR STAGING**)
> - **Production Email Recipient:** `aeo@athenacentre.org` (**DO NOT USE FOR STAGING**)
> - Never copy live `/dcm_private_notes`, confidential contacts, or unverified leads into Staging.
> - Never alter Production record `dcm-2026-11-end`.

---

## 1. Provision a Dedicated Staging Firebase Project
1. In the Firebase Console, create a new isolated project (e.g., `aeo-dcm-staging` — use your organisation's actual approved naming convention).
2. Enable **Authentication** → **Google** sign-in provider (using Staging OAuth consent/authorised domains only).
3. Create a dedicated **Cloud Firestore** database in the Staging project (e.g., `(default)` or a named staging DB — **never** `aeo-database19`).
4. Register a Web App in the Staging project and copy its config values into Vercel Preview/Staging environment variables (`docs/staging.env.example`) and local `.env.local` (git-ignored).
5. Seed `/cms_admins/{uid}` in Staging with **test-only** accounts:
   - One `status: 'Active'` test admin UID
   - One `status: 'Suspended'` test admin UID
   - One ordinary signed-in test user (not listed in `/cms_admins`)

## 2. Deploy Firestore Rules & All 9 Composite Indexes to STAGING ONLY
```bash
# Confirm active Firebase project is Staging — NEVER gen-lang-client-0961551337
firebase use <STAGING_FIREBASE_PROJECT_ID>
firebase projects:list

# Deploy rules and all 9 composite indexes to Staging ONLY
firebase deploy --only firestore:indexes,firestore:rules
```
Wait in the Staging Firebase Console (**Firestore → Indexes**) until **all 9 composite indexes** show status **Enabled / Ready**:
1. `dcm_daily_publications`: `(status ASC, assessmentDate DESC)`
2. `dcm_daily_publications`: `(status ASC, year ASC, month ASC, assessmentDate DESC)`
3. `dcm_evidence`: `(status ASC, visibility ASC, sourcePublicationDate DESC)`
4. `dcm_evidence`: `(status ASC, visibility ASC, stateCode ASC, sourcePublicationDate DESC)`
5. `dcm_incidents`: `(status ASC, visibility ASC, firstReportedDate DESC)`
6. `dcm_incidents`: `(status ASC, visibility ASC, stateCode ASC, firstReportedDate DESC)`
7. `dcm_incident_developments`: `(status ASC, visibility ASC, developmentDate DESC)`
8. `dcm_incident_developments`: `(status ASC, visibility ASC, stateCode ASC, developmentDate DESC)`
9. `dcm_editorial_handovers`: `(publicationId ASC, createdAt DESC)`

## 3. Configure Isolated Vercel Preview / Staging Deployment
1. Push the feature branch `feature/aeo-dcm-corrections-stages-1-7` to `thetechguy-okb/AEO` and open a **Draft Pull Request** against `main` (do **not** merge).
2. In Vercel Project Settings → **Environment Variables** (scoped strictly to **Preview** for branch `feature/aeo-dcm-corrections-stages-1-7`, or in a separate Staging Vercel project):
   - Set `VITE_APP_ENV=staging` (activates the runtime isolation guard in `src/lib/firebase.ts` that throws a fatal error if Production project/database IDs are detected).
   - Set all 7 `VITE_FIREBASE_*` variables from the dedicated Staging Firebase Web App (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_DATABASE_ID`).
   - Set `DCM_BRIEF_RECIPIENT` to an internal IT test mailbox ONLY (never `aeo@athenacentre.org` or real subscribers), or leave mail transport secrets unset during automated QA.
3. Add the Vercel Preview domain to Staging Firebase Auth → **Settings → Authorized domains**.
4. Verify before testing:
   - Open browser DevTools → Network on the Staging URL and confirm all Firestore requests target `projects/<STAGING_FIREBASE_PROJECT_ID>/databases/<STAGING_DATABASE_ID>` — **zero** requests to `gen-lang-client-0961551337` or `aeo-database19`.

## 4. Seed Synthetic Staging Data Only
- Use clearly labelled `[SYNTHETIC STAGING TEST]` records (daily editions, quiet-day edition, `-r2` correction revision, public evidence + dated sources, multi-development incident, and synthetic private note).
- Do **not** import live confidential research notes or alter Production records.

## 5. Run Official Firebase Emulator Security Suite (Requires Java 17+)
```bash
java -version   # Must be 17+
npm ci
npm install --no-save @firebase/rules-unit-testing
firebase emulators:exec --only firestore --project aeo-dcm-staging-emulator "node tests/firestoreRules.emulator.mjs"
```
Expected result: **8/8 checks PASSED** across all 5 personas (Unauthenticated, Ordinary user, Suspended admin, Active admin, Owner UID `s39PbuZxqdW1x63i0SsEVE7HqGQ2`).

## 6. Run Multi-Viewport Browser QA Against Staging (Requires Playwright + Chromium)
```bash
npm install --no-save playwright
npx playwright install chromium
node tests/dcmStage7BrowserQa.spec.mjs --url https://<STAGING_VERCEL_PREVIEW_DOMAIN>
```
Verify all 6 viewports (`320px`, `375px`, `390px`, `768px`, `1024px`, `1440px`) plus manual physical iOS/Android spot-checks for touch selection, horizontal overflow, evidence/incident inspection, permalink refresh, browser Back/Forward, and DCM Brief modal validation (without live subscriber emails).
