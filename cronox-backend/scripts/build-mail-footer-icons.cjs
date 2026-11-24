'use strict';
// Rasterize the existing website brand icons; no icon fonts or embedded SVG in mail.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
async function main() {
  const root = path.resolve(__dirname, '../../cronox-front/assets');
  const output = path.join(root, 'mail/global-footer'); fs.mkdirSync(output, { recursive: true });
  for (const icon of ['instagram', 'tiktok', 'youtube']) {
    const source = fs.readFileSync(path.join(root, 'icons', icon + '.svg'), 'utf8');
    for (const theme of ['light', 'dark']) {
      const fill = theme === 'light' ? '#111111' : '#eeeeee';
      const svg = source.replace(/#ffffff|#fff\b/gi, fill);
      await sharp(Buffer.from(svg)).resize(60, 60, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(output, `${icon}-${theme}.png`));
    }
  }
  // Raster PNG basket: email clients do not need SVG, icon fonts or emoji.
  const basket = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#eeeeee" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18M4 9l2 11h12l2-11M8 3L4 9M16 3l4 6M9 12v5M15 12v5"/></svg>';
  await sharp(Buffer.from(basket)).resize(60, 60).png().toFile(path.join(output, 'basket-dark.png'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
