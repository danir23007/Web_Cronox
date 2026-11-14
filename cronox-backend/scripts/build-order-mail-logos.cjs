// Deterministic email-compatible exports of the exact topbar artwork.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const { orderRingSvg } = require('./order-mail-rings.cjs');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'cronox-front/assets/mail/order-confirmation');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const source = path.join(root, 'cronox-front/assets/logo-topbar.webp');
  // Separate pipelines: Sharp flattens before negating within one pipeline,
  // which would invert the protective light canvas as well as the artwork.
  const cropped = await sharp(source).trim({ background: '#00000000', threshold: 1 }).png().toBuffer();
  const black = await sharp(cropped).negate({ alpha: false }).png().toBuffer();
  await sharp(black).flatten({ background: '#f7f7f5' }).png().toFile(path.join(out, 'logo-light.png'));
  await sharp(cropped).png().toFile(path.join(out, 'logo-dark.png'));
  // Same centre and evenly spaced radii in every version. Raster PNGs also
  // work in mail clients which cannot display inline SVG. No content baked in.
  for (const theme of ['light', 'dark']) for (let selected = 1; selected <= 5; selected++) {
    await sharp(Buffer.from(orderRingSvg(selected, theme))).png().toFile(path.join(out, `rings-${selected}-${theme}.png`));
  }
  console.log('Cropped official logos and ten concentric-ring email PNGs exported.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
