// Rebuild the responsive storefront derivatives, preserving the uploaded animation.
// Run from any directory: node cronox-backend/scripts/optimize-storefront-preloader.cjs
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const assetDirectory = path.resolve(__dirname, '../../cronox-front/assets');
const original = path.join(assetDirectory, 'CRONOX-preloader.webp');

async function main() {
  const before = await sharp(original, { animated: true }).metadata();
  // The logo is 160 CSS px, inside scale(1.2), with a scale(1.02) exit.
  // 640×360 preserves 16:9 and covers >3× its maximum 195.84px visible width.
  // Maximum WebP quality preserves the metallic detail at the rendered size.
  const originalBytes = (await fs.stat(original)).size;
  const results = [];
  for (const width of [320, 640]) {
    const derivative = path.join(assetDirectory, `CRONOX-preloader-${width}.webp`);
    await sharp(original, { animated: true })
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 100, alphaQuality: 100, effort: 6, loop: before.loop, delay: before.delay })
      .toFile(derivative);
    const after = await sharp(derivative, { animated: true }).metadata();
    if (after.pages !== before.pages || after.loop !== before.loop || after.hasAlpha !== before.hasAlpha || JSON.stringify(after.delay) !== JSON.stringify(before.delay)) {
      throw new Error('The preloader derivative changed animation metadata');
    }
    if (after.width * before.pageHeight !== before.width * after.pageHeight) {
      throw new Error('The preloader derivative changed its aspect ratio');
    }
    const derivedBytes = (await fs.stat(derivative)).size;
    results.push({ originalBytes, derivedBytes, savedPercent: 100 * (1 - derivedBytes / originalBytes), width: after.width, frameHeight: after.pageHeight, frames: after.pages, durationMs: after.delay.reduce((sum, value) => sum + value, 0), loop: after.loop, alpha: after.hasAlpha });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
