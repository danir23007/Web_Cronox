// Focused, read-only verification for the explicitly approved UI media allowlist.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const repositoryRoot = path.resolve(__dirname, '../..');
const frontendRoot = path.join(repositoryRoot, 'cronox-front');
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const digest = (relativePath) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
    .digest('hex');

const manifest = JSON.parse(
  read('docs/original-assets/ui-media/manifest.json'),
);
const approvedImageChanges = new Set([
  'cronox-front/assets/CRONOX-preloader.webp',
  // Responsive derivatives requested by the performance review; original retained.
  'cronox-front/assets/CRONOX-preloader-320.webp',
  'cronox-front/assets/CRONOX-preloader-640.webp',
  'cronox-front/assets/logo-topbar.webp',
  'cronox-front/assets/maps/spain-provinces.svg',
  // Official PayPal artwork requested for the checkout payment selector.
  'cronox-front/assets/paypal-logo-white.png',
  // Byte-exact extractions from the five approved METACRILATOS references;
  // extract-assets.cjs --check verifies their content during release checks.
  'cronox-front/assets/metacrilatos/eye.png',
  'cronox-front/assets/metacrilatos/symbol.png',
  'cronox-front/assets/metacrilatos/wordmark.png',
  // Original PNGs explicitly approved for the welcome email. Byte identity and
  // dimensions are checked against their manifest below; no regeneration.
  'cronox-front/assets/mail/welcome/fondo-cortinas.png',
  // Requested same-resolution JPEG derivative; approved PNG stays byte exact.
  'cronox-front/assets/mail/welcome/fondo-cortinas-email.jpg',
  'cronox-front/assets/mail/welcome/instagram.png',
  // Requested white version, rendered from the original Instagram SVG paths.
  'cronox-front/assets/mail/welcome/instagram-blanco.png',
  'cronox-front/assets/mail/welcome/la-cara-b.png',
  'cronox-front/assets/mail/welcome/logo-cronox.png',
  'cronox-front/assets/mail/welcome/logo-cx.png',
  'cronox-front/assets/mail/welcome/logo-ojo.png',
  'docs/original-assets/ui-media/cronox-front/assets/CRONOX-GIF.gif',
  'docs/original-assets/ui-media/cronox-front/assets/logo_banner.png',
]);

function unapprovedImageChanges(porcelain) {
  return porcelain.split(/\r?\n/).filter(Boolean)
    .map(line => line.slice(3).replace(/\\/g, '/'))
    // npm ci replaces dependency assets, including historically tracked ones.
    // They are not application UI media; keep all project image checks intact.
    .filter(file => !file.split('/').includes('node_modules'))
    .filter(file => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file))
    .filter(file => !approvedImageChanges.has(file));
}

async function main() {
  const welcome = JSON.parse(read('cronox-front/assets/mail/welcome/manifest.json'));
  assert.deepEqual(Object.keys(welcome.assets).sort(), ['fondo-cortinas.png', 'instagram-blanco.png', 'instagram.png', 'la-cara-b.png', 'logo-cronox.png', 'logo-cx.png', 'logo-ojo.png']);
  for (const [name, asset] of Object.entries(welcome.assets)) {
    const relative = `cronox-front/assets/mail/welcome/${name}`;
    assert.equal(digest(relative), asset.sha256, 'Approved welcome originals must remain byte-identical');
    assert.equal(fs.statSync(path.join(repositoryRoot, relative)).size, asset.fileSize);
    const info = await sharp(path.join(repositoryRoot, relative)).metadata();
    assert.equal(info.width, asset.width); assert.equal(info.height, asset.height);
  }
  assert.deepEqual(Object.keys(welcome.derivatives || {}), ['fondo-cortinas-email.jpg']);
  const derivative = welcome.derivatives['fondo-cortinas-email.jpg'];
  assert.equal(derivative.sourceSha256, welcome.assets['fondo-cortinas.png'].sha256);
  assert.equal(derivative.source, 'fondo-cortinas.png');
  const derivativePath = path.join(frontendRoot, 'assets/mail/welcome/fondo-cortinas-email.jpg');
  assert.equal(digest('cronox-front/assets/mail/welcome/fondo-cortinas-email.jpg'), derivative.sha256);
  assert.equal(fs.statSync(derivativePath).size, derivative.fileSize);
  assert.ok(derivative.fileSize < welcome.assets[derivative.source].fileSize * 0.15);
  const derivativeInfo = await sharp(derivativePath).metadata();
  assert.equal(derivativeInfo.width, 1024); assert.equal(derivativeInfo.height, 1536);
  const originalPixels = await sharp(path.join(frontendRoot, 'assets/mail/welcome/fondo-cortinas.png')).removeAlpha().raw().toBuffer();
  const optimizedPixels = await sharp(derivativePath).removeAlpha().raw().toBuffer();
  assert.equal(originalPixels.length, optimizedPixels.length);
  let channelError = 0;
  for (let i = 0; i < originalPixels.length; i++) channelError += Math.abs(originalPixels[i] - optimizedPixels[i]);
  assert.ok(channelError / originalPixels.length < 2, 'Compression must preserve the original artwork closely');
  const whiteMark = await sharp(path.join(frontendRoot, 'assets/mail/welcome/instagram-blanco.png')).ensureAlpha().raw().toBuffer();
  let opaquePixels = 0;
  for (let i = 0; i < whiteMark.length; i += 4) if (whiteMark[i + 3]) {
    assert.equal(whiteMark[i], 255); assert.equal(whiteMark[i + 1], 255); assert.equal(whiteMark[i + 2], 255); opaquePixels++;
  }
  assert.ok(opaquePixels > 0 && opaquePixels < whiteMark.length / 4, 'White mark must retain transparency');
  assert.deepEqual(
    manifest.assets.map((asset) => asset.purpose),
    ['storefront-preloader', 'homepage-topbar-logo'],
  );

  for (const asset of manifest.assets) {
    assert.equal(digest(asset.archivePath), asset.originalSha256);
    const optimizedPath = path.join(
      'cronox-front',
      asset.optimizedPublicPath.replace(/^\//, ''),
    );
    assert.equal(digest(optimizedPath), asset.optimizedSha256);
    assert.equal(fs.statSync(path.join(repositoryRoot, asset.archivePath)).size, asset.originalBytes);
    assert.equal(fs.statSync(path.join(repositoryRoot, optimizedPath)).size, asset.optimizedBytes);
    assert.ok(asset.optimizedBytes < asset.originalBytes * 0.8);
    assert.ok(!asset.archivePath.startsWith('cronox-front/'));
  }

  const animation = await sharp(
    path.join(frontendRoot, 'assets/CRONOX-preloader.webp'),
    { animated: true },
  ).metadata();
  assert.deepEqual(
    {
      format: animation.format,
      width: animation.width,
      pageHeight: animation.pageHeight,
      pages: animation.pages,
      loop: animation.loop,
      delay: animation.delay,
      hasAlpha: animation.hasAlpha,
    },
    {
      format: 'webp',
      width: 1280,
      pageHeight: 720,
      pages: 81,
      loop: 0,
      delay: Array(81).fill(30),
      hasAlpha: true,
    },
  );

  for (const width of [320, 640]) {
    const derivative = path.join(frontendRoot, `assets/CRONOX-preloader-${width}.webp`);
    const responsive = await sharp(derivative, { animated: true }).metadata();
    assert.equal(responsive.format, animation.format);
    assert.equal(responsive.width, width);
    assert.equal(responsive.pageHeight, width * 9 / 16);
    assert.equal(responsive.pages, animation.pages);
    assert.equal(responsive.loop, animation.loop);
    assert.equal(responsive.hasAlpha, animation.hasAlpha);
    assert.deepEqual(responsive.delay, animation.delay);
    assert.ok(fs.statSync(derivative).size < fs.statSync(path.join(frontendRoot, 'assets/CRONOX-preloader.webp')).size);
  }

  const originalLogo = await sharp(
    path.join(frontendRoot, 'assets/logo_banner.png'),
  ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const optimizedLogo = await sharp(
    path.join(frontendRoot, 'assets/logo-topbar.webp'),
  ).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(optimizedLogo.info, originalLogo.info);
  assert.ok(optimizedLogo.data.equals(originalLogo.data));

  const index = read('cronox-front/index.html');
  const checkout = read('cronox-front/checkout.html');
  const profile = read('cronox-front/assets/profile.js');
  const profileHtml = read('cronox-front/profile.html');
  const keyScreen = read('cronox-front/key-screen.html');
  const newsletter = read('cronox-front/assets/newsletter-renderer.js');
  for (const html of [index, checkout]) {
    const preloader = html.match(/<img\b[^>]*class="preloader__logo"[^>]*>/)?.[0];
    assert.ok(preloader, 'The visible animated preloader must remain present');
    assert.match(preloader, /src="assets\/CRONOX-preloader-640\.webp"/);
    assert.match(preloader, /srcset="assets\/CRONOX-preloader-320\.webp 320w, assets\/CRONOX-preloader-640\.webp 640w"/);
    assert.match(preloader, /sizes="196px"/);
  }
  assert.match(index, /class="topbar__logo"[\s\S]*?src="assets\/logo-topbar\.webp"/);
  assert.match(index, /<img class="hero-video"[^>]*data-media-placement="home\.hero\.video"/);
  assert.doesNotMatch(index, /<video class="hero-video"/);
  assert.match(index, /class="footer-logo"/);
  assert.match(profile, /img\.src = 'assets\/CRONOX-preloader-640\.webp'/);
  assert.match(profile, /img\.srcset = 'assets\/CRONOX-preloader-320\.webp 320w, assets\/CRONOX-preloader-640\.webp 640w'/);
  assert.match(profile, /img\.sizes = '196px'/);
  const profileVersion = /assets\/profile\.js\?v=(\d+)/.exec(profileHtml);
  assert.ok(profileVersion && Number(profileVersion[1]) >= 24,
    'Profile must retain the media optimization cache version or a newer release');
  assert.match(profileHtml, /assets\/accreditation-layout\.js\?v=2/);
  assert.match(keyScreen, /src="assets\/CRONOX-GIF\.gif"/);
  assert.match(newsletter, /supabase\.co\/storage\/v1\/object\/public\/newsletter\/chains-newsletter\.jpg/);
  assert.ok(!index.includes('assets/CRONOX-GIF.gif'));
  assert.ok(!index.includes('src="assets/logo_banner.png"\n           alt="CRONOX" class="topbar__logo-img"'));
  for (const asset of manifest.assets) assert.ok(!index.includes(asset.archivePath));

  const status = execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  assert.deepEqual(unapprovedImageChanges(status), []);

  const appModule = read('cronox-backend/src/app.module.ts');
  assert.ok(!frontendRoot.startsWith(path.join(repositoryRoot, 'docs')));
  assert.match(appModule, /rootPath: join\(__dirname, '\.\.', '\.\.', 'cronox-front'\)/);
  assert.match(appModule, /exclude: \['\/api', '\/docs', '\/webhooks'\]/);

  console.log('UI media allowlist, archive, metadata and runtime references verified.');
}

module.exports = { unapprovedImageChanges };
if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
