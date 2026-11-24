'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict'), sharp = require('sharp');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'output/playwright/cart-mail-design');
async function main() {
  const alpha = {};
  for (const name of ['instagram', 'tiktok', 'youtube']) {
    const { data, info } = await sharp(path.join(root, `cronox-front/assets/mail/global-footer/${name}-light.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, right = 0;
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 30) { left = Math.min(left, x); right = Math.max(right, x + 1); }
    alpha[name] = { left: left / info.width, right: right / info.width };
  }
  const { chromium } = require(path.join(root, 'node_modules/playwright'));
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [mode, width, colorScheme] of [['desktop', 1100, 'light'], ['mobile', 390, 'light'], ['dark', 390, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height: 1 }, colorScheme });
      await context.route(/^https?:/, route => route.abort());
      const page = await context.newPage();
      for (const circle of [1, 2, 3, 4, 5]) {
        await page.goto(pathToFileURL(path.join(output, `circle-${circle}.html`)).href);
        const metrics = await page.evaluate(alpha => {
          const footer = document.querySelector('.cronox-global-footer');
          const images = [...document.querySelectorAll('.cart-mail-product img')].map(img => { const rect = img.getBoundingClientRect(); return { width: rect.width, height: rect.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; });
          const icons = [...footer.querySelectorAll('img')].filter(img => alpha[img.alt.toLowerCase()] && img.getBoundingClientRect().width > 0).map(img => {
            const r = img.getBoundingClientRect(), bounds = alpha[img.alt.toLowerCase()];
            return { name: img.alt, left: r.left + bounds.left * r.width, right: r.left + bounds.right * r.width, linked: Boolean(img.closest('a')) };
          });
          const preference = [...footer.querySelectorAll('a')].find(link => link.textContent === 'Actualiza tus preferencias');
          return { images, icons, gaps: icons.slice(1).map((icon, index) => icon.left - icons[index].right),
            preferences: [...document.querySelectorAll('a')].filter(link => link.textContent === 'Actualiza tus preferencias').length,
            footerCount: document.querySelectorAll('.cronox-global-footer').length,
            footerBottom: footer.getBoundingClientRect().bottom - preference.getBoundingClientRect().bottom,
            supportFirst: footer.querySelector('a[href="mailto:support@cronox.es"]').parentElement.firstElementChild.textContent,
            overflow: document.documentElement.scrollWidth > innerWidth };
        }, alpha);
        assert.equal(metrics.images.length, 3); for (const image of metrics.images) { assert.ok(image.width <= 70 && image.height <= 70); assert.ok(Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight) < .01); }
        assert.deepEqual(metrics.icons.map(icon => icon.name), ['Instagram', 'TikTok', 'YouTube']);
        assert.deepEqual(metrics.icons.map(icon => icon.linked), [true, false, false]);
        assert.ok(metrics.gaps.every(gap => gap >= 10 && gap <= 12));
        assert.ok(metrics.footerBottom >= 6 && metrics.footerBottom <= 8);
        assert.equal(metrics.footerCount, 1); assert.equal(metrics.preferences, 1); assert.equal(metrics.supportFirst, 'support@cronox.es'); assert.equal(metrics.overflow, false);
        await page.screenshot({ path: path.join(output, `circle-${circle}-${mode}.png`), fullPage: true });
        results.push({ circle, mode, ...metrics });
      }
      await context.close();
    }
  } finally { await browser.close(); }
  await fs.writeFile(path.join(output, 'layout-verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ checked: results.length, iconVisibleGaps: results[0].gaps, footerBottom: results[0].footerBottom, proportionsPreserved: true, overflow: false }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
