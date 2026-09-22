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
  'cronox-front/assets/logo-topbar.webp',
  'docs/original-assets/ui-media/cronox-front/assets/CRONOX-GIF.gif',
  'docs/original-assets/ui-media/cronox-front/assets/logo_banner.png',
]);

async function main() {
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
  assert.match(index, /class="preloader__logo"[^>]*src=|src="assets\/CRONOX-preloader\.webp"[\s\S]*?class="preloader__logo"/);
  assert.match(index, /class="topbar__logo"[\s\S]*?src="assets\/logo-topbar\.webp"/);
  assert.match(index, /class="hero-video"[^>]*poster="assets\/logo_banner\.png"/);
  assert.match(index, /class="footer-logo"/);
  assert.match(checkout, /src="assets\/CRONOX-preloader\.webp"/);
  assert.match(profile, /img\.src = 'assets\/CRONOX-preloader\.webp'/);
  assert.match(profileHtml, /assets\/profile\.js\?v=10/);
  assert.match(keyScreen, /src="assets\/CRONOX-GIF\.gif"/);
  assert.match(newsletter, /supabase\.co\/storage\/v1\/object\/public\/newsletter\/chains-newsletter\.jpg/);
  assert.ok(!index.includes('assets/CRONOX-GIF.gif'));
  assert.ok(!index.includes('src="assets/logo_banner.png"\n           alt="CRONOX" class="topbar__logo-img"'));
  for (const asset of manifest.assets) assert.ok(!index.includes(asset.archivePath));

  const changed = execFileSync('git', ['status', '--porcelain', '-uall'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/\\/g, '/'))
    .filter((file) => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file));
  const outsideAllowlist = changed.filter(
    (file) => !approvedImageChanges.has(file),
  );
  assert.deepEqual(outsideAllowlist, []);

  const appModule = read('cronox-backend/src/app.module.ts');
  assert.ok(!frontendRoot.startsWith(path.join(repositoryRoot, 'docs')));
  assert.match(appModule, /rootPath: join\(__dirname, '\.\.', '\.\.', 'cronox-front'\)/);
  assert.match(appModule, /exclude: \['\/api', '\/docs', '\/webhooks'\]/);

  console.log('UI media allowlist, archive, metadata and runtime references verified.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
