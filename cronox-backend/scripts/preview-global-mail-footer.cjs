'use strict';
// Static local previews only. No database, SMTP or publication writes.
const fs = require('node:fs');
const path = require('node:path');
const { installTestEnvironment } = require('../test/test-environment.cjs');
installTestEnvironment({ force: true });
process.env.FRONTEND_URL = 'https://cronox.es'; process.env.API_PUBLIC_URL = 'https://cronox.es';
require('ts-node/register/transpile-only');
const { renderMail } = require('../src/email/managed/mail-renderer');
const { structuredDocumentForPurpose } = require('../src/email/managed/mail-template-documents');
const { mailPreviewData, welcomeDocument } = require('../src/email/managed/welcome-design');
const { composeApplicationMail } = require('../src/email/mail-footer-composition');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/playwright/mail-footer'); fs.mkdirSync(output, { recursive: true });
async function main() {
  await require('sharp')(path.join(root, 'cronox-front/assets/products/camiseta_washed_negra.png'))
    .resize(140, 140, { fit: 'contain', background: '#f7f7f5' }).png().toFile(path.join(output, 'preview-product.png'));
  const names = [];
  const footerOnly = await composeApplicationMail({}, { html: '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body bgcolor="#f7f7f5" style="margin:0;background:#f7f7f5;"></body></html>' }, { purpose: 'ORDER_CONFIRMATION', preview: true });
  names.push('footer-only'); save('footer-only', footerOnly);
  for (const circle of [1, 2, 3, 4, 5]) {
    const data = mailPreviewData('ORDER_CONFIRMATION', circle);
    data.items[0].imageUrl = 'https://cronox.es/assets/mail/preview-product.png';
    const document = { ...structuredDocumentForPurpose('ORDER_CONFIRMATION'), orderCircle: circle };
    const rendered = renderMail(document, 'Tu pedido CRONOX', '', 'ORDER_CONFIRMATION', data);
    const content = await composeApplicationMail({}, rendered, { purpose: 'ORDER_CONFIRMATION', preview: true });
    const name = `circle-${circle}`; names.push(name); save(name, content);
  }
  for (const purpose of ['PASSWORD_RESET', 'CART_ABANDONED', 'NEWSLETTER_WELCOME']) {
    const data = mailPreviewData(purpose, 2);
    data.items[0].imageUrl = 'https://cronox.es/assets/mail/preview-product.png';
    const rendered = renderMail(purpose === 'NEWSLETTER_WELCOME' ? welcomeDocument(false) : structuredDocumentForPurpose(purpose), 'CRONOX', '', purpose, data);
    const content = await composeApplicationMail({}, rendered, { purpose, preview: true });
    const name = purpose.toLowerCase(); names.push(name); save(name, content);
  }
  const index = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Footer global CRONOX · Vista previa</title></head><body style="font-family:Arial,sans-serif;background:#f7f7f5;color:#222;max-width:900px;margin:40px auto;padding:20px"><h1>Footer global CRONOX</h1><p>Vistas locales sin envíos. Instagram y soporte verificados en el proyecto; Instagram, TikTok y YouTube siempre visibles; las redes sin URL oficial no son interactivas.</p>${names.map(name => `<p><a href="${name}.html">${name}</a> · <a href="${name}.txt">Texto plano</a></p>`).join('')}<p>Los iconos y logos de estas copias apuntan a los archivos locales para permitir su revisión sin red.</p></body></html>`;
  fs.writeFileSync(path.join(output, 'index.html'), index);
  console.log('Generated ' + names.length + ' local previews in output/playwright/mail-footer');
}
function save(name, content) {
  fs.writeFileSync(path.join(output, name + '.html'), content.html.replaceAll('https://cronox.es/assets/mail/preview-product.png', 'preview-product.png').replaceAll('https://cronox.es/assets/', '../../../cronox-front/assets/'));
  fs.writeFileSync(path.join(output, name + '.txt'), content.text);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
