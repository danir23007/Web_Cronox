'use strict';
// Real local app/database/authentication. Only the camera source is simulated:
// a canvas video stream contains the authenticated account's actual rendered QR.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Client } = require('../../cronox-backend/node_modules/pg');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');

(async () => {
  const env = loadLocalEnvironment();
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Local database required');
  const localOrigin = new URL(env.FRONTEND_URL).origin;
  const db = new Client({ connectionString: env.DATABASE_URL });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  const page = await context.newPage();
  const prefix = 'TEST METACRILATOS ' + randomUUID();
  const groups = [];
  const errors = [];
  const checks = [];
  const out = path.resolve('output/metacrilatos');
  await fs.mkdir(out, { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  await db.connect();
  try {
    const beforeSelection = (await db.query('SELECT * FROM "AccreditationSelection" ORDER BY id')).rows;
    const beforeOriginal = (await db.query('SELECT * FROM "AccreditationDesign" WHERE id=\'original\'')).rows;
    await page.goto(localOrigin + '/admin.html#section-accreditations');
    await expect(page.locator('#adminLoginForm')).toBeVisible();
    await page.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);
    await page.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);
    await page.locator('#adminLoginSubmit').click();
    await expect(page).toHaveURL(/\/admin\.html/);
    await page.waitForFunction(() => typeof window.CRONOX_ADMIN_NAV?.navigate === 'function');
    await page.evaluate(() => window.CRONOX_ADMIN_NAV.navigate('section-accreditations'));
    const section = page.locator('#section-accreditations');
    await expect(section.locator('[data-design-select="metacrilatos"]')).toHaveCount(1);
    await section.locator('[data-design-select="metacrilatos"]').click();
    const preview = section.frameLocator('iframe');
    await expect(preview.locator('.crx-metacrilatos')).toBeVisible();
    for (const circle of ['1', '2', '3', '4', '5']) {
      await preview.getByLabel('Círculo de muestra').selectOption(circle);
      await expect(preview.locator('.crx-ring')).toHaveCount(Number(circle));
      await preview.locator('[data-crx-flip]').click();
      await expect(preview.locator('.crx-back')).toHaveAttribute('aria-hidden', 'false');
    }
    await page.screenshot({ path: path.join(out, 'normal-admin-preview.png'), fullPage: true });
    await section.locator('[data-design-close]').click();
    checks.push('Real authenticated preview loads all five variants with real CSP; no activation/configuration mutation');

    const headers = (await page.request.get(localOrigin + '/admin.html')).headers();
    expect(headers['permissions-policy']).toContain('camera=(self)');
    expect(headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
    const publicHeaders = (await page.request.get(localOrigin + '/profile.html')).headers();
    expect(publicHeaders['permissions-policy']).toContain('camera=()');
    expect(publicHeaders['content-security-policy']).not.toContain("'wasm-unsafe-eval'");
    const ownCardResponse = await page.request.get(localOrigin + '/api/membership/me/accreditation');
    expect(ownCardResponse.status()).toBe(200);
    const ownCard = await ownCardResponse.json();
    await page.addInitScript(() => { delete window.BarcodeDetector; });

    async function injectCamera() {
      await page.evaluate(dataUrl => {
        delete window.BarcodeDetector;
        window.testStreams = [];
        const media = navigator.mediaDevices;
        Object.defineProperty(media, 'getUserMedia', { configurable: true, value: async constraints => {
          if (constraints.audio !== false) throw new Error('Unexpected microphone request');
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 640;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 640);
          const image = new Image(); image.src = dataUrl; await image.decode();
          ctx.drawImage(image, 24, 24, 592, 592);
          const stream = canvas.captureStream(5); window.testStreams.push(stream);
          window.testCanvas = canvas;
          return stream;
        } });
        Object.defineProperty(media, 'enumerateDevices', { configurable: true, value: async () => [] });
      }, ownCard.qrDataUrl);
    }
    await page.evaluate(() => window.CRONOX_ADMIN_NAV.navigate('section-qr-events'));
    await expect(page.locator('#section-qr-events')).toBeVisible();
    await expect(page.locator('#qrEventsList')).toHaveAttribute('aria-busy', 'false');
    for (let i = 1; i <= 2; i++) {
      if (i === 2) await page.locator('#qrEventsBack').click();
      await page.locator('#qrEventsCreate input[name="name"]').fill(prefix + ' ' + i);
      await page.locator('#qrEventsCreate button').click();
      await expect(page.locator('#qrEventsGroupName')).toHaveText(prefix + ' ' + i);
      const id = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('group');
      groups.push({ id, name: prefix + ' ' + i });
      await injectCamera();
      await page.locator('#qrEventsCameraOpen').click();
      await expect(page.locator('#qrEventsScanMessage')).toContainText('Registrado', { timeout: 30000 });
      await expect(page.locator('#qrEventsTotal')).toHaveText('1 participantes');
      await expect(page.locator('#qrEventsParticipants tr')).toHaveCount(1);
      await page.locator('#qrEventsCameraStop').click();
      expect(await page.evaluate(() => window.testStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
      // Reopen immediately: the cooldown must suppress floods, then report duplicate.
      await page.locator('#qrEventsCameraOpen').click();
      await expect(page.locator('#qrEventsScanMessage')).toContainText('Ya registrado en este grupo', { timeout: 10000 });
      await page.locator('#qrEventsCameraStop').click();
      await page.reload();
      await expect(page.locator('#qrEventsGroupName')).toHaveText(prefix + ' ' + i);
      await expect(page.locator('#qrEventsParticipants tr')).toHaveCount(1);
      await expect(page.locator('#qrEventsTotal')).toHaveText('1 participantes');
    }
    checks.push('Real browser create, locally bundled Wasm decode from simulated camera, server registration, duplicate/reopen, persisted reload and same person in second group');
    // Additional fresh authorized browser context = independent device session.
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    await second.goto(localOrigin + '/admin.html');
    await second.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);
    await second.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);
    await second.locator('#adminLoginSubmit').click();
    await expect(second).toHaveURL(/\/admin\.html/);
    await second.goto(localOrigin + '/admin.html#section-qr-events?group=' + groups[0].id);
    await expect(second.locator('#qrEventsParticipants tr')).toHaveCount(1);
    await expect(second.locator('#qrEventsTotal')).toHaveText('1 participantes');
    await secondContext.close();
    checks.push('Independent logged-in browser session reads the same persisted participant and count');
    expect((await db.query('SELECT * FROM "AccreditationSelection" ORDER BY id')).rows).toEqual(beforeSelection);
    expect((await db.query('SELECT * FROM "AccreditationDesign" WHERE id=\'original\'')).rows).toEqual(beforeOriginal);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    // Restrict cleanup to synthetic fixtures this invocation created, including
    // uncertain create responses (name includes this invocation's random UUID).
    const found = (await db.query('SELECT id,name FROM "QrEventGroup" WHERE name=$1 OR name=$2', [prefix + ' 1', prefix + ' 2'])).rows;
    await db.query('BEGIN');
    try {
      for (const item of found) {
        await db.query('DELETE FROM "QrEventParticipant" WHERE "groupId"=$1', [item.id]);
        await db.query('DELETE FROM "QrEventGroup" WHERE id=$1 AND name=$2', [item.id, item.name]);
      }
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { await db.end(); }
  }
  await fs.writeFile(path.join(out, 'normal-browser.json'), JSON.stringify({ passed: true, localOrigin,
    camera: 'simulated canvas video containing real authorized QR; no physical device claim', checks, pageErrors: errors,
    originalSelectionPreserved: true, syntheticGroupsCleaned: true }, null, 2));
  console.log('PASS normal local app: real auth/CSP/preview, camera simulation with real QR, persisted groups, duplicate scans, second browser, original unchanged, synthetic groups cleaned');
})().catch(error => { console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
