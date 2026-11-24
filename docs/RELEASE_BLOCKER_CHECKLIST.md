# AEO DCM Corrections — Release-Blocker Sign-Off Checklist

**Current Release Decision:** `NO-GO FOR PRODUCTION` (Hold until all P0 & P1 blockers below are verified and signed off).

| ID | Severity | Blocker | Responsible Party | Verification / Acceptance Criterion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **B1** | **Critical (P0)** | Official Firebase Firestore Rules Emulator execution | Engineering / Security | `firebase emulators:exec --only firestore --project aeo-dcm-staging-emulator "node tests/firestoreRules.emulator.mjs"` passes **8/8** on Java 17+ runner across all 5 personas | **OPEN (BLOCKED in sandbox — no Java 17+)** |
| **B2** | **Critical (P0)** | Isolated Staging Firebase project + 9 composite indexes built & verified live | Cloud / Infra Ops + Engineering | Dedicated Staging Firebase project created; all 9 indexes in `firestore.indexes.json` show **Enabled / Ready**; zero `failed-precondition` errors on public queries | **OPEN (BLOCKED — no Staging Firebase project provisioned)** |
| **B3** | **Critical (P0)** | Real multi-viewport browser & physical mobile QA (`320/375/390/768/1024/1440px`) | QA + Engineering | `node tests/dcmStage7BrowserQa.spec.mjs --url https://<STAGING_URL>` passes all checks + physical iOS/Android tap/scroll/permalink verification | **OPEN (BLOCKED in sandbox — no Chromium/Playwright)** |
| **B4** | **High (P1)** | GitHub feature branch & Pull Request on `thetechguy-okb/AEO` | Repository Maintainer / Engineering | `feature/aeo-dcm-corrections-stages-1-7` pushed from verified handover ZIP/patch; PR opened against `main` (`93d1bac`); CI `lint` + `build` + 71/71 tests green; **not merged** | **OPEN (BLOCKED in sandbox — no GitHub push token/SSH)** |
| **B5** | **High (P1)** | Research & CMS governance decision on Production record `dcm-2026-11-end` (`draft` + `isLatest: true`) | Research Lead + CMS Lead | Written decision recorded: either approve & publish `dcm-2026-11-end` with Research approval reference, OR clear `isLatest` while keeping it `draft` | **OPEN (Governance Decision Pending)** |
| **B6** | **Medium (P2)** | Clean exclusion of 20 legacy root `fix_*` scripts & `public/assets/aistudio/` artifacts during Git import | Engineering | `git status` on PR contains zero `fix_*.py/*.mjs/*.js` files, zero `public/assets/aistudio/*` files, and zero real `.env` / Production secret files | **MITIGATED IN STAGE 8 ZIP & PATCH** |
| **B7** | **Low (P3)** | Controlled Staging smoke test of Microsoft Graph `/api/dcm-brief-request` | Infra / Engineering | 1 controlled Staging brief request delivered to internal IT test mailbox only (never real subscribers or `aeo@athenacentre.org`) | **OPEN (Pending Staging Deployment)** |

## Production Cutover Sequencing Rule (After All Blockers Close)
1. Take full Production Firestore backup (`aeo-database19`) and archive current Production `firestore.rules`.
2. Deploy **ONLY `firestore.indexes.json`** to Production and wait for all 9 indexes to reach **Ready**.
3. Deploy `firestore.rules` to Production and verify public read of published editions + admin read of drafts.
4. Merge PR into `main` and deploy Production web build; run non-destructive post-deploy smoke checks.
