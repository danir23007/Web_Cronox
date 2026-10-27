// Reproducible extraction from the approved references, without editing them.
// node metacrilatos-codex/extract-assets.cjs [--check]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('../cronox-backend/node_modules/sharp');

async function main() {

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'MANIFEST.json'), 'utf8'));
const target = path.resolve(__dirname, '../cronox-front/assets');
const check = process.argv.includes('--check');
const assets = new Map();
const styles = [];
// Storefront composition is an integration layer. Keep the approved source
// bytes intact, including each circle's geometry and artwork.
function customerTypography(css) {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector, body) => {
    const prefix = /\.crx-(?:roman|label-grade)\b/.test(selector) ? '' : 'var(--customer-font-prefix,) ';
    body = body.replace(/font-family:([^;}]+)/g, (_, family) =>
      `--customer-original-font: ${family}; font-family:${prefix}var(--customer-original-font)`);
    body = body.replace(/font:(12px) ([^;}]+)/g, (_, size, family) =>
      `--customer-original-font: ${family}; font:${size} ${prefix}var(--customer-original-font)`);
    return `${selector}{${body}}`;
  });
}
for (const entry of manifest.disenos) {
  const bytes = fs.readFileSync(path.join(__dirname, entry.archivo));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || hash !== entry.sha256) throw new Error(`Reference mismatch: ${entry.archivo}`);
  const html = bytes.toString('utf8');
  const root = html.match(/^<div id="([^"]+)"/)[1];
  const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)];
  ['symbol.png', 'wordmark.png', 'eye.png'].forEach((name, index) => {
    const asset = Buffer.from(images[index][1], 'base64');
    if (assets.has(name) && !assets.get(name).equals(asset)) throw new Error(`Unexpected distinct logo: ${name}`);
    assets.set(name, asset);
  });
  // Scope each exact reference independently. Never merge the different contours.
  let css = html.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
  css = css.replaceAll(`#${root}`, `.crx-metacrilatos[data-crx-level="${entry.circulo}"]`);
  // Ink and background removal are baked into RGBA PNGs below. Keeping the
  // original canvas and pixel positions preserves every approved contour.
  css = css.replace(/;filter:url\(#[^)]+-(?:label|circle)-ink\)/g, '');
  css = css.replace(/(\.crx-eye-logo\{)([^}]+)/g, (_, selector, body) =>
    selector + body.replace(/;mix-blend-mode:[^;}]+|;filter:[^;}]+/g, ''));
  // Only the external concept panel is removed. The acrylic, 68 edges and card
  // layers remain verbatim. Variables (including V's burgundy) stay in scope.
  css = css.replace('isolation:isolate;background:#080809;border-radius:18px;overflow:hidden', 'background:transparent');
  styles.push(`/* Approved circle ${entry.circulo}; source SHA256 ${hash}. */\n${css}`);
}
const integration = `
/* Host integration: preserve the approved slab geometry; shrink the entire 3D
   scene proportionally only when its real container is narrower. */
.crx-metacrilatos{width:100%;position:relative;min-width:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:400;line-height:normal;box-sizing:border-box}
/* The artwork deliberately mixes dark cards and pale labels. Declare those
   actual surfaces so automatic darkening does not invert just their grounds.
   Forced-colors/contrast preferences remain enabled. */
.crx-metacrilatos{color-scheme:only dark}
.crx-metacrilatos .crx-label,.crx-metacrilatos[data-crx-level="4"] .crx-card{color-scheme:only light}
.metacrilatos-host{width:100%;min-width:0}
[data-accreditation-renderer='metacrilatos-v1']>.profile-card>.accreditation-stage{display:none!important}
.crx-metacrilatos .crx-scale{position:relative;transform-style:preserve-3d;transform:scale(var(--crx-scale,1));transform-origin:center}
.crx-metacrilatos .crx-stage{height:calc(var(--crx-stage-height,487px) * var(--crx-scale,1))!important;overflow:visible}
/* Some WebKit environments paint a hidden backface. Reuse the face
   state already maintained by the renderer; the rim and 3D transforms stay intact. */
.crx-metacrilatos .crx-face[aria-hidden="true"]{visibility:hidden}
.crx-metacrilatos .crx-name{min-height:1.15em;line-height:normal}
.crx-metacrilatos .crx-label-code{display:block;min-width:0;max-width:100%}
.crx-metacrilatos .crx-qr:empty::before{content:'QR no disponible';display:grid;place-items:center;height:100%;font:12px Arial,sans-serif;text-align:center;color:#49212c;padding:12px}
.crx-metacrilatos .crx-unavailable{padding:32px 16px;text-align:center;color:inherit}
@media(max-width:390px){.crx-metacrilatos{--crx-stage-height:472px}}
`;

// Equivalent source pixels, not newly drawn/traced artwork. Wordmark uses the
// reference's sRGB inverse-luminance matrix; symbol uses its existing alpha.
// Eye screen/multiply backgrounds become true alpha, retaining antialiasing.
const inks = [
  ['#111315', '#d8dadd'], ['#111315', '#d8dadd'], ['#25282b', '#d3d6d7'],
  ['#25282b', '#3f4548'], ['#191419', '#d4b69b'],
];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
for (const name of ['symbol', 'wordmark', 'eye']) {
  const { data, info } = await sharp(assets.get(`${name}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let level = 1; level <= 5; level++) {
    const pixels = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      let color, alpha;
      if (name === 'symbol') { color = rgb(inks[level - 1][0]); alpha = data[i + 3] / 255; }
      else if (name === 'wordmark') { color = rgb(inks[level - 1][1]); alpha = 1 - luma; }
      else if (level === 4) { color = [0, 0, 0]; alpha = luma * 0.78; }
      else if (level < 5) { color = [255, 255, 255]; alpha = luma * 0.84; }
      else {
        // Reference sepia(.3), saturate(.6), brightness(.93), applied to white.
        const sepia = [1.351, 1.203, 0.937].map(v => 0.7 + 0.3 * v);
        const gray = 0.213 * sepia[0] + 0.715 * sepia[1] + 0.072 * sepia[2];
        color = sepia.map(v => Math.min(1, (gray * 0.4 + v * 0.6) * 0.93) * 255);
        alpha = luma;
      }
      for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(color[channel]);
      pixels[i + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
    assets.set(`${name}-${level}.png`, await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
  }
}
const outputs = new Map([
  ['metacrilatos.css', Buffer.from(customerTypography(`/* Generated by metacrilatos-codex/extract-assets.cjs. */\n${styles.join('\n\n')}\n${integration}`) + `
/* The serif's smaller x-height needs readable captions at the same card size.
   The design plane, artwork, QR and motion geometry remain unchanged. */
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-label-title {font-size:12px;letter-spacing:.4px}
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-label-code {font-size:14px;letter-spacing:.7px}
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-date,
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-url {font-size:14px;letter-spacing:.7px}
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-actions button {font-size:16px;font-weight:600;line-height:1.2}
body[data-cronox-surface="customer"] .crx-metacrilatos .crx-qr:empty::before {font-size:16px}
`, 'utf8')],
  ...[...assets].map(([name, buffer]) => [`metacrilatos/${name}`, buffer]),
]);
for (const [name, bytes] of outputs) {
  const file = path.join(target, name);
  if (check) {
    if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) throw new Error(`Generated asset differs: ${name}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
}
console.log(`Verified all 5 approved hashes and byte lengths; ${check ? 'checked' : 'extracted'} ${outputs.size} assets.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
