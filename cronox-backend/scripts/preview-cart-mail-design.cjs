'use strict';
const fs = require('node:fs'), path = require('node:path'), sharp = require('sharp');
require('../test/test-environment.cjs').installTestEnvironment({ force: true });
process.env.FRONTEND_URL = 'https://cronox.es'; process.env.API_PUBLIC_URL = 'https://cronox.es';
require('ts-node/register/transpile-only');
const { CART_COPY, cartAbandonedDocument } = require('../src/email/managed/cart-abandoned-design');
const { ManagedMailService } = require('../src/email/managed/managed-mail.service');
const { containedOrderImage } = require('../src/email/managed/order-product-image');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'output/playwright/cart-mail-design');
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const photos = [[400, 800, 'vertical'], [800, 400, 'horizontal'], [500, 500, 'cuadrada']];
  const items = [];
  for (const [width, height, name] of photos) {
    await sharp(path.join(root, 'cronox-front/assets/products/camiseta_washed_negra.png')).resize(width, height, { fit: 'contain', background: { r: 11, g: 11, b: 11, alpha: 1 } }).png().toFile(path.join(output, name + '.png'));
    items.push({ name: 'Camiseta CRONOX ' + name, variantName: name === 'vertical' ? 'M' : 'L', quantity: 2,
      imageUrl: 'https://example.test/' + name + '.png', ...containedOrderImage(width, height), lineTotalFormatted: '69,90 €' });
  }
  const db = { footerSettings: { findUnique: async () => null } };
  const transport = new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN'); } });
  const managed = new ManagedMailService(db, transport);
  for (const circle of [1, 2, 3, 4, 5]) {
    const rendered = await managed.render('NOREPLY', { purpose: 'CART_ABANDONED', document: cartAbandonedDocument(), subject: CART_COPY.subject, preheader: CART_COPY.preheader, signatureMode: 'none' }, { circleLevel: circle, items, actionUrl: 'https://example.test/cesta' }, true);
    const html = rendered.html.replaceAll('https://cronox.es/assets/', '../../../cronox-front/assets/').replaceAll('https://example.test/', '');
    fs.writeFileSync(path.join(output, `circle-${circle}.html`), html); fs.writeFileSync(path.join(output, `circle-${circle}.txt`), rendered.text);
  }
  console.log('Generated I-V using the real ManagedMailService renderer; three photo proportions; SMTP forbidden.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
