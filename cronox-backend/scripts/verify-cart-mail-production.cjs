'use strict';
// Read-only production content verification. Does not boot Nest or any worker.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
async function main() {
  assert.ok(process.argv.includes('--production'), 'EXPLICIT_PRODUCTION_TARGET_REQUIRED');
  const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
  const url = new URL(config.DATABASE_URL);
  assert.ok(decodeURIComponent(url.username).includes('frqlgocxnyppzdgxxjuq') && url.hostname.endsWith('.supabase.com'), 'UNEXPECTED_PRODUCTION_PROJECT');
  Object.assign(process.env, config, { NODE_ENV: 'production', FRONTEND_URL: 'https://cronox.es', API_PUBLIC_URL: 'https://cronox.es', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false' });
  const { PrismaClient, Prisma } = require('@prisma/client');
  const { JSDOM } = require('jsdom');
  const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
  const { mailPreviewData } = require('../dist/email/managed/welcome-design');
  const { previewCatalogProduct } = require('../dist/email/managed/mail-preview-product');
  const { mailCircleNumber } = require('../dist/email/managed/mail-circle-folders');
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const service = new ManagedMailService(tx, new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN'); } }));
      const templates = await tx.managedEmailTemplate.findMany({ where: { senderKey: 'NOREPLY', purpose: 'CART_ABANDONED', archivedAt: null }, include: { folder: true } });
      assert.deepEqual(templates.map(t => mailCircleNumber(t.folder.name)).sort(), [1, 2, 3, 4, 5]);
      const checked = [];
      for (const template of templates) {
        const circle = mailCircleNumber(template.folder.name);
        const preview = await service.preview('NOREPLY', { ...template, view: 'preview' });
        const data = { ...mailPreviewData('CART_ABANDONED', circle), circleLevel: circle };
        // Use the same catalog choice, avoiding random fixture differences.
        Object.assign(data, (await previewCatalogProduct(tx, preview.previewProduct?.productId, preview.previewProduct?.variantId, 'CART_ABANDONED')).data);
        const published = await service.published('NOREPLY', 'CART_ABANDONED', data);
        assert.ok(published, 'CIRCLE_NOT_PUBLISHED');
        assert.equal(preview.html, published.html); assert.equal(preview.text, published.text);
        const document = new JSDOM(published.html).window.document;
        assert.equal(document.querySelectorAll('.cronox-global-footer').length, 1);
        const frames = [...document.querySelectorAll('.cart-mail-thumbnail')]; assert.ok(frames.length);
        for (const frame of frames) {
          assert.equal(frame.getAttribute('width'), '70'); assert.equal(frame.getAttribute('height'), '70');
          assert.equal(frame.querySelector('td').getAttribute('bgcolor'), null);
        }
        assert.equal(document.querySelector('.cronox-footer-rule').closest('table').getAttribute('width'), '210');
        const support = document.querySelector('a[href="mailto:support@cronox.es"]').parentElement;
        assert.equal(support.textContent, 'Si tienes cualquier problema o duda, escríbenos: support@cronox.es');
        assert.equal(support.querySelector('br'), null);
        assert.ok(published.text.includes('Si tienes cualquier problema o duda, escríbenos: support@cronox.es'));
        checked.push(circle);
      }
      return { circles: checked.sort(), previewEqualsPublished: true, squareFrames: true, separator: 210, support: 'inline', transaction: 'read-only', smtp: 'forbidden', publicationsChanged: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 120000 });
    console.log(JSON.stringify(result, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name || 'CONTENT_VERIFICATION_FAILED'); process.exitCode = 1; });
