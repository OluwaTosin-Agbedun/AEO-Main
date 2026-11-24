# AEO DCM Corrections (Stages 1–8) — GitHub Handover & Staging Setup Guide

## Handover Status
- **Target GitHub Repository:** `https://github.com/thetechguy-okb/AEO.git`
- **Verified `main` Baseline Commit:** `93d1bac300b89c7f420b25fdd76111ad8d8326ad` (`feat: add summary fields to state assessment data`)
- **Target Feature Branch:** `feature/aeo-dcm-corrections-stages-1-7`
- **GitHub Push Status:** **Not pushed** (authenticated GitHub write credentials/tokens/SSH keys are unavailable in this build container; read-only HTTPS verification against `main` succeeded).
- **Production Status:** **NO-GO FOR PRODUCTION.** Nothing has been merged to `main`, deployed to Production, or altered in `gen-lang-client-0961551337` / `aeo-database19`.

---

## Verified Release Artifacts (`release-artifacts/`)
1. `aeo-dcm-stages-1-8-handover.zip` — **Sanitized, credential-free ZIP archive** containing:
   - Full application source (`src/`, `api/`, `lib/`, `server.ts`, `index.html`, `vite.config.ts`, `tsconfig.json`, `vercel.json`)
   - All 10 Stage 1–7 automated, emulator, and Playwright QA test suites (`tests/`)
   - `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `firebase-blueprint.json`
   - Credential-free configuration templates (`firebase-applet-config.example.json`, `firebase-applet-config.staging.example.json`, `.env.example`, `docs/staging.env.example`)
   - Package manifests and lockfiles (`package.json`, `package-lock.json`)
   - Staging & release documentation (`docs/STAGING_SETUP.md`, `docs/RELEASE_BLOCKER_CHECKLIST.md`, `HANDOVER_INSTRUCTIONS.md`)
   - Exact zero-conflict Git patch against `main` (`aeo-dcm-stages-1-8-vs-main.patch`)
   - **Explicitly Excluded:** `firebase-applet-config.json` (Production config), `.env*` secrets, private keys/tokens, `node_modules/`, `dist/`, `.aistudio/`, `public/assets/aistudio/` chat screenshots/PDFs, and 20 unrelated legacy root `fix_*.py/*.mjs/*.js` scripts.
2. `aeo-dcm-stages-1-8-vs-main.patch` — **Exact unified Git patch** verified with `git apply --check` against clean `thetechguy-okb/AEO` `main` (`93d1bac300b89c7f420b25fdd76111ad8d8326ad`) with **0 conflicts**.
3. `MANIFEST-STAGE8.sha256` — SHA-256 checksum manifest covering the Stage 8 ZIP, patch, and all sanitized files.
4. *(Preserved Stage 7 artifacts: `aeo-dcm-stages-1-7-source-handover.tar.gz` and `MANIFEST.sha256` — note that the Stage 7 tarball was an unfiltered full workspace snapshot containing `firebase-applet-config.json`, `public/assets/aistudio/`, and legacy `fix_*` scripts; **use the sanitized Stage 8 ZIP or patch for GitHub import**.)*

---

## Recommended Option A: Clean GitHub Import via Verified Patch (Fastest & Cleanest PR Diff)

```bash
# 1. Clone and verify clean main
git clone https://github.com/thetechguy-okb/AEO.git aeo-dcm-handover
cd aeo-dcm-handover
git checkout main && git pull --ff-only origin main

# 2. Create the dedicated feature branch (NEVER overwrite or force-push main)
git checkout -b feature/aeo-dcm-corrections-stages-1-7

# 3. Verify checksum & apply the exact Stages 1-8 patch cleanly
sha256sum -c /path/to/MANIFEST-STAGE8.sha256 --ignore-missing
git apply --check /path/to/aeo-dcm-stages-1-8-vs-main.patch
git apply /path/to/aeo-dcm-stages-1-8-vs-main.patch

# 4. Inspect every changed file before committing
git status
git diff --stat
```

## Alternative Option B: Manual Import via Sanitized ZIP (`aeo-dcm-stages-1-8-handover.zip`)

```bash
git clone https://github.com/thetechguy-okb/AEO.git aeo-dcm-handover
cd aeo-dcm-handover
git checkout main && git pull --ff-only origin main
git checkout -b feature/aeo-dcm-corrections-stages-1-7

# Unpack sanitized archive into the feature branch working tree
# (Note: firebase-applet-config.json in your local repo is preserved untouched because the ZIP omits it)
unzip -o /path/to/aeo-dcm-stages-1-8-handover.zip -d .

# Inspect diff — verify zero unrelated files or credentials are modified
git status
git diff --stat
```

---

## Pre-PR Verification Commands (Run Before Pushing)

```bash
# 1. Install dependencies and verify TypeScript, Vite build, and 71/71 automated tests
npm ci
npm run lint
npm run build
for f in \
  tests/dcmDailyStage1.test.ts \
  tests/dcmStage2Consistency.test.ts \
  tests/dcmStage3Evidence.test.ts \
  tests/dcmStage4Mobile.test.ts \
  tests/dcmStage5Archive.test.ts \
  tests/dcmStage6Editorial.test.ts \
  tests/dcmStage7Audit.test.ts; do
  npx tsx "$f" || exit 1
done

# 2. Run Official Firebase Firestore Emulator Security Suite (requires Java 17+)
npm install --no-save @firebase/rules-unit-testing
firebase emulators:exec --only firestore --project aeo-dcm-staging-emulator "node tests/firestoreRules.emulator.mjs"

# 3. Commit and push feature branch (DO NOT merge into main; DO NOT force-push)
git add -A
git status
git commit -m "feat(dcm): AEO DCM Corrections Stages 1-8 (pre-deployment audited & staging-ready)"
git push -u origin feature/aeo-dcm-corrections-stages-1-7
```

Then open a **Draft Pull Request** from `feature/aeo-dcm-corrections-stages-1-7` → `main` on `thetechguy-okb/AEO`, follow `docs/STAGING_SETUP.md` to deploy to an **isolated Staging Firebase project + Vercel Preview**, run `tests/dcmStage7BrowserQa.spec.mjs`, and complete `docs/RELEASE_BLOCKER_CHECKLIST.md` before requesting final Production release approval.
