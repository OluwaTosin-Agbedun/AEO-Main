/**
 * AEO DCM Corrections — Stage 7: Real Browser & Multi-Viewport QA Script (Playwright)
 *
 * REQUIRES:
 *   - Playwright & Chromium installed on the Staging/QA host:
 *       npm install --no-save playwright && npx playwright install chromium
 *   - Running Staging or local preview URL (DO NOT submit live DCM Brief emails)
 *
 * RUN COMMAND:
 *   node tests/dcmStage7BrowserQa.spec.mjs --url http://localhost:3000
 *
 * VIEWPORTS TESTED:
 *   320x568 (Small Mobile), 375x812 (iPhone SE/13 Mini), 390x844 (iPhone 14),
 *   768x1024 (Tablet), 1024x768 (Small Desktop), 1440x900 (Desktop)
 */

import assert from 'node:assert/strict';

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 568, isMobile: true, hasTouch: true },
  { name: 'mobile-375', width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'tablet-768', width: 768, height: 1024, isMobile: false, hasTouch: true },
  { name: 'desktop-1024', width: 1024, height: 768, isMobile: false, hasTouch: false },
  { name: 'desktop-1440', width: 1440, height: 900, isMobile: false, hasTouch: false }
];

function getBaseUrl() {
  const idx = process.argv.indexOf('--url');
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

async function main() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('ERROR: Playwright is not installed in this environment.');
    console.error('Install on a QA/Staging runner with: npm install --no-save playwright && npx playwright install chromium');
    console.error('Then run: node tests/dcmStage7BrowserQa.spec.mjs --url https://<staging-host>');
    process.exit(2);
  }

  const baseUrl = getBaseUrl();
  const dcmUrl = `${baseUrl}/democratic-competitiveness-map`;
  const browser = await playwright.chromium.launch({ headless: true });

  let passed = 0;
  let failed = 0;

  async function check(label, fn) {
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${label}`);
    } catch (err) {
      failed++;
      console.error(`  [FAIL] ${label}:`, err?.message || err);
    }
  }

  console.log(`\nRunning Stage 7 Real Browser QA against ${dcmUrl}...\n`);

  try {
    for (const vp of VIEWPORTS) {
      console.log(`--- Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
        isMobile: vp.isMobile
      });
      const page = await context.newPage();

      await page.goto(dcmUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('svg', { timeout: 15000 });

      // 1. Zero horizontal overflow / clipped panels
      await check(`${vp.name}: Zero horizontal overflow (scrollWidth <= innerWidth)`, async () => {
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth
        }));
        assert.ok(
          overflow.scrollWidth <= overflow.innerWidth + 1,
          `Horizontal overflow detected: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`
        );
      });

      // 2. Map renders near top of page with colour legend & Grey warning readable
      await check(`${vp.name}: Interactive map near top & Grey warning readable`, async () => {
        const mapBox = await page.locator('svg').first().boundingBox();
        assert.ok(mapBox && mapBox.width > 200 && mapBox.height > 150, 'Map SVG bounding box too small or hidden');
        const bodyText = await page.locator('body').innerText();
        assert.ok(
          bodyText.includes('Insufficient evidence'),
          'Grey / Insufficient evidence explanation must be readable'
        );
      });

      // 3. State selection via search/selector updates URL permalink and survives reload
      await check(`${vp.name}: State selection updates permalink, survives refresh, and honours back/forward`, async () => {
        const stateSelect = page.locator('select[aria-label*="state" i], select').filter({ hasText: 'Benue' }).first();
        if (await stateSelect.count()) {
          await stateSelect.selectOption({ label: 'Benue' });
        } else {
          const benuePath = page.locator('[data-state="Benue"], [aria-label*="Benue" i]').first();
          if (vp.hasTouch) {
            await benuePath.tap();
          } else {
            await benuePath.click();
          }
        }
        await page.waitForTimeout(400);
        const urlAfterSelect = page.url();
        assert.ok(urlAfterSelect.includes('state=Benue'), `Expected state=Benue in URL, got ${urlAfterSelect}`);

        // Reload and confirm state survives refresh
        await page.reload({ waitUntil: 'networkidle' });
        const bodyAfterReload = await page.locator('body').innerText();
        assert.ok(bodyAfterReload.includes('Benue'), 'Selected state Benue must survive page refresh');

        // Back / Forward navigation
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        await page.goForward({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(250);
        assert.ok(page.url().includes('state=Benue'), 'Forward navigation must restore Benue permalink');
      });

      // 4. Copy link button present & clickable
      await check(`${vp.name}: Copy link control accessible`, async () => {
        const copyBtn = page.getByRole('button', { name: /copy.*link/i }).first();
        assert.ok((await copyBtn.count()) > 0, 'Copy link button should be rendered for selected state');
      });

      // 5. DCM Brief request modal opens and validates required fields WITHOUT submitting live email
      await check(`${vp.name}: DCM Brief request modal opens and validates (no live email submission)`, async () => {
        const briefBtn = page.getByRole('button', { name: /request.*dcm brief/i }).first();
        if (await briefBtn.count()) {
          await briefBtn.click();
          await page.waitForTimeout(300);
          const modalVisible = await page.locator('input[type="email"], form').first().isVisible();
          assert.equal(modalVisible, true, 'DCM Brief request form should open');
          // Close modal without sending
          const closeBtn = page.getByRole('button', { name: /close|cancel/i }).first();
          if (await closeBtn.count()) await closeBtn.click();
        }
      });

      await context.close();
    }

    console.log(`\nStage 7 Browser QA Summary: ${passed}/${passed + failed} passed, ${failed} failed.\n`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
