'use strict';
// Browser and MIME QA only. Production templates are optional read-only inputs.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'output/playwright/footer-spacing');
const production = process.argv.includes('--production-read');
const config = production ? require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env'))) : {};
require('../test/test-environment.cjs').installTestEnvironment({ force: true });
Object.assign(process.env, { FRONTEND_URL: 'https://cronox.es', API_PUBLIC_URL: 'https://cronox.es', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' });
require('ts-node/register/transpile-only');
const { ManagedMailService } = require('../src/email/managed/managed-mail.service');
const { structuredDocumentForPurpose } = require('../src/email/managed/mail-template-documents');
const { mailPreviewData } = require('../src/email/managed/welcome-design');
const { NEWSLETTER_ACCESS_COPY } = require('../src/email/managed/mail-editor-content');
const { mailCircleNumber } = require('../src/email/managed/mail-circle-folders');
const { cartAbandonedDocument, CART_COPY } = require('../src/email/managed/cart-abandoned-design');
const { containedOrderImage } = require('../src/email/managed/order-product-image');
const { createCartProductThumbnail } = require('../src/email/managed/order-product-thumbnail');
const { composeApplicationMail } = require('../src/email/mail-footer-composition');
const { compileMailMessage } = require('../src/email/mail-message');
const noSmtp = new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN'); } });
async function fixtures() {
  const result = [];
  fs.writeFileSync(path.join(output, 'cart-preview.png'), await createCartProductThumbnail(fs.readFileSync(path.join(root, 'cronox-front/assets/products/camiseta_washed_negra.png'))));
  const photo = await require('sharp')(path.join(root, 'cronox-front/assets/products/camiseta_washed_negra.png')).metadata();
  const build = async (db, templates) => {
    const service = new ManagedMailService(db, noSmtp);
    for (const template of templates) for (const scenario of ['default', 'registration', 'without-password']) {
      const circle = mailCircleNumber(template.folder.name);
      const rendered = await service.preview('NOREPLY', { ...template, scenario, view: 'preview' });
      const data = { ...mailPreviewData('NEWSLETTER_ACCESS', circle), circleLevel: circle };
      if (scenario === 'registration') Object.assign(data, { accountEligible: false, message: NEWSLETTER_ACCESS_COPY.registration, initialPassword: '', passwordMessage: '' });
      if (scenario === 'without-password') Object.assign(data, { initialPassword: '', passwordMessage: '' });
      // Rendering the draft for send preserves its own body even if publication
      // points to a different independent version. Never publish to make QA pass.
      const send = await service.render('NOREPLY', template, data, true);
      assert.equal(send.html, rendered.html); assert.equal(send.text, rendered.text);
      result.push({ name: `newsletter-${circle}-${scenario}`, purpose: 'NEWSLETTER_ACCESS', ...rendered });
    }
    for (const [name, purpose] of [['short', 'PASSWORD_RESET'], ['long', 'ORDER_CONFIRMATION'], ['basket', 'CART_ABANDONED']]) {
      const data = { ...mailPreviewData(purpose, 1), circleLevel: 1 };
      const count = name === 'long' ? 12 : 3;
      data.items = Array.from({ length: count }, (_, i) => ({ ...data.items[0], imageUrl: 'https://cronox.es/assets/products/camiseta_washed_negra.png', ...containedOrderImage(photo.width, photo.height), ...(purpose === 'CART_ABANDONED' ? { imageUrl: 'https://cronox.es/assets/mail/footer-spacing-cart.png', imageWidth: 70, imageHeight: 70 } : {}), name: `Prenda de ejemplo ${i + 1}` }));
      const rendered = await service.render('NOREPLY', { purpose, document: purpose === 'CART_ABANDONED' ? cartAbandonedDocument() : structuredDocumentForPurpose(purpose), subject: purpose === 'CART_ABANDONED' ? CART_COPY.subject : 'Vista previa CRONOX', preheader: '', signatureMode: 'none' }, data, true);
      result.push({ name, purpose, ...rendered });
    }
  };
  if (production) {
    const url = new URL(config.DATABASE_URL);
    assert.ok(url.hostname.endsWith('.supabase.com') && decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq'));
    const { PrismaClient } = require('@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
    try { await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const templates = await tx.managedEmailTemplate.findMany({ where: { senderKey: 'NOREPLY', purpose: 'NEWSLETTER_ACCESS', archivedAt: null }, include: { folder: true } });
      assert.deepEqual(templates.map(t => mailCircleNumber(t.folder.name)).sort(), [1, 2, 3, 4, 5]);
      const footprint = await tx.$queryRawUnsafe(`SELECT 'drafts' kind, md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) digest FROM "ManagedEmailTemplate" t UNION ALL SELECT 'versions', md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),'')) FROM "EmailTemplateVersion" v UNION ALL SELECT 'publications', md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY "senderKey",purpose),'')) FROM "EmailPublication" p ORDER BY kind`);
      const receipt = path.join(output, 'publication-footprint.json');
      if (fs.existsSync(receipt)) assert.deepEqual(footprint, JSON.parse(fs.readFileSync(receipt)), 'TEMPLATE_CONTENT_OR_PUBLICATION_CHANGED');
      else fs.writeFileSync(receipt, JSON.stringify(footprint, null, 2));
      await build(tx, templates);
    }, { timeout: 120000 }); } finally { await db.$disconnect(); }
  } else {
    const db = { emailFolder: { findFirst: async ({ where }) => ({ id: where.id, name: 'Círculo ' + where.id }) } };
    await build(db, [1, 2, 3, 4, 5].map(circle => ({ folder: { name: 'Círculo ' + circle }, folderId: String(circle), purpose: 'NEWSLETTER_ACCESS', subject: 'Tu acceso a CRONOX', preheader: '', signatureMode: 'none', document: structuredDocumentForPurpose('NEWSLETTER_ACCESS') })));
  }
  const { simpleParser } = require('mailparser');
  for (const fixture of result) {
    const sent = await composeApplicationMail({}, fixture, { purpose: fixture.purpose, recipients: ['fixture@example.test'] });
    const mime = await simpleParser((await compileMailMessage('noreply@example.test', { to: 'fixture@example.test', subject: fixture.subject, ...sent })).raw);
    fixture.wire = String(mime.html);
    fs.writeFileSync(path.join(output, fixture.name + '.html'), fixture.html);
    fs.writeFileSync(path.join(output, fixture.name + '-wire.html'), fixture.wire);
    fs.writeFileSync(path.join(output, fixture.name + '.txt'), mime.text);
  }
  return result;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const cases = await fixtures();
  const { chromium } = require(path.join(root, 'node_modules/playwright'));
  const sharp = require('sharp'), browser = await chromium.launch({ headless: true }), report = [];
  const logoBounds = {};
  for (const theme of ['light', 'dark']) {
    const { data, info } = await sharp(path.join(root, `cronox-front/assets/mail/order-confirmation/logo-${theme}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let top = info.height;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 30) top = Math.min(top, y);
    logoBounds[theme] = top / info.width;
  }
  try {
    for (const [mode, width, colorScheme] of [['desktop', 1100, 'light'], ['mobile', 390, 'light'], ['dark', 390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'cronox.es' && url.pathname === '/assets/mail/footer-spacing-cart.png') return route.fulfill({ path: path.join(output, 'cart-preview.png') });
        if (url.hostname === 'cronox.es' && url.pathname.startsWith('/assets/')) {
          const file = path.resolve(root, 'cronox-front', '.' + url.pathname);
          if (file.startsWith(path.join(root, 'cronox-front') + path.sep) && fs.existsSync(file)) return route.fulfill({ path: file });
        }
        return route.abort();
      });
      const page = await context.newPage();
      for (const fixture of cases) {
        // Exercise the actual admin sizing function in a same-origin sandbox,
        // with its real CSS; no API server, persisted edits or external requests.
        await page.setContent('<html><head><style>body{margin:0;background:#28282d}.mail-document-stage{width:100%}</style><style>' + fs.readFileSync(path.join(root, 'cronox-front/assets/admin-mails.css'), 'utf8') + '</style></head><body><div class="mail-document-stage"><iframe class="mail-html-email-preview" sandbox="allow-same-origin"></iframe></div></body></html>');
        const source = fs.readFileSync(path.join(root, 'cronox-front/assets/admin-mails.js'), 'utf8');
        const fitSource = source.slice(source.indexOf('  function fitMailPreviewFrame('), source.indexOf('  function previewFrameSource('));
        await page.addScriptTag({ content: fitSource + ';window.fitFooterFrame=fitMailPreviewFrame;' });
        const metrics = [];
        for (const [kind, html] of [['preview', fixture.html], ['wire', fixture.wire]]) {
          await page.evaluate(html => new Promise(resolve => {
            const frame = document.querySelector('iframe');
            frame.onload = () => { window.fitFooterFrame(frame); resolve(); };
            frame.srcdoc = html;
          }), html);
          const frame = page.frames()[1];
          await frame.evaluate(() => Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; }))));
          await page.evaluate(() => window.fitFooterFrame(document.querySelector('iframe')));
          const value = await frame.evaluate(logoBounds => {
            const footer = document.querySelector('.cronox-global-footer'), f = footer.getBoundingClientRect();
            const logo = [...footer.querySelectorAll('img[alt="CRONOX"]')].find(img => img.getBoundingClientRect().height > 0), l = logo.getBoundingClientRect();
            const preference = [...footer.querySelectorAll('a')].find(a => a.textContent === 'Actualiza tus preferencias'), p = preference.getBoundingClientRect();
            const rights = preference.closest('tr').previousElementSibling.querySelector('td');
            const range = document.createRange(); range.selectNodeContents(rights); const r = range.getBoundingClientRect();
            return { top: l.top + logoBounds[logo.src.includes('logo-dark') ? 'dark' : 'light'] * l.width - f.top, bottom: f.bottom - p.bottom, rightsGap: p.top - r.bottom, height: f.height, end: f.bottom, logoWidth: l.width, footerCount: document.querySelectorAll('.cronox-global-footer').length, parent: footer.parentElement.tagName, overflow: document.documentElement.scrollWidth > innerWidth };
          }, logoBounds);
          const frameHeight = await page.locator('iframe').evaluate(node => node.clientHeight);
          assert.equal(value.top, 14); assert.ok(value.bottom >= 6 && value.bottom <= 8);
          assert.equal(value.logoWidth, 120); assert.equal(value.footerCount, 1); assert.equal(value.parent, 'BODY'); assert.equal(value.overflow, false);
          assert.ok(Math.abs(frameHeight - value.end) <= 1, 'EXTRA_PREVIEW_CONTAINER_SPACE');
          metrics.push({ kind, frameHeight, ...value });
          if (kind === 'preview') {
            const png = await page.locator('iframe').screenshot({ path: path.join(output, fixture.name + '-' + mode + '.png') });
            const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const background = ((info.height - 10) * info.width + 10) * 4;
            let lastInk = 0;
            // Exclude the iframe border, including fractional edge rasterization.
            for (let y = info.height - 25; y < info.height - 3; y++) for (let x = 10; x < info.width - 10; x++) {
              const pixel = (y * info.width + x) * 4;
              if ([0, 1, 2].some(channel => Math.abs(data[pixel + channel] - data[background + channel]) > 40)) lastInk = Math.max(lastInk, y);
            }
            value.inkBottom = frameHeight - lastInk;
            assert.ok(value.inkBottom >= 6 && value.inkBottom <= 8, 'VISIBLE_PIXEL_BOTTOM_SPACING');
            const runs = []; let start = null;
            for (let y = info.height - 40; y < info.height - 3; y++) {
              let ink = false;
              for (let x = 10; x < info.width - 10; x++) {
                const pixel = (y * info.width + x) * 4;
                if ([0, 1, 2].some(channel => Math.abs(data[pixel + channel] - data[background + channel]) > 40)) { ink = true; break; }
              }
              if (ink && start === null) start = y;
              if (!ink && start !== null) { runs.push([start, y - 1]); start = null; }
            }
            assert.ok(runs.length >= 2);
            value.inkRightsGap = runs.at(-1)[0] - runs.at(-2)[1] - 1;
            assert.ok(value.inkRightsGap >= 6 && value.inkRightsGap <= 8, 'VISIBLE_RIGHTS_PREFERENCES_GAP');
          }
        }
        assert.equal(metrics[0].height, metrics[1].height);
        report.push({ name: fixture.name, mode, metrics });
      }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="es"><meta charset="utf-8"><title>Estabilidad del footer CRONOX</title><body><h1>Pruebas locales sin envío</h1>' + cases.map(fixture => '<h2>' + fixture.name + '</h2><p>' + ['desktop', 'mobile', 'dark'].map(mode => `<a href="${fixture.name}-${mode}.png">${mode}</a>`).join(' · ') + '</p>').join('') + '</body></html>');
  console.log(JSON.stringify({ templates: cases.length, browserComparisons: report.length, htmlPaths: ['preview', 'outgoing MIME'], top: 14, bottom: '6–8', visibleRightsGap: '6–8', extraContainerSpace: false, smtp: 'forbidden', productionInputs: production, publicationsChanged: false }, null, 2));
}
main().catch(error => { console.error(error.code || error.name || 'FOOTER_QA_FAILED'); process.exitCode = 1; });
