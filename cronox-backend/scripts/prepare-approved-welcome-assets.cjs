'use strict';
// Copies only the original PNGs used by the approved HTML. Uploading is explicit
// and uses the existing email-image validator/storage service; no remote DB/mail.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const backend = path.resolve(__dirname, '..');
const destination = path.resolve(backend, '../cronox-front/assets/mail/welcome');
const sourceIndex = process.argv.indexOf('--source');
assert.ok(sourceIndex >= 0 && process.argv[sourceIndex + 1], 'Provide --source with the approved package directory');
const source = path.resolve(process.argv[sourceIndex + 1]);
const names = ['fondo-cortinas.png', 'logo-cronox.png', 'la-cara-b.png', 'logo-cx.png', 'instagram.png', 'logo-ojo.png'];
const whiteInstagram = 'instagram-blanco.png';
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
async function main() {
  fs.mkdirSync(destination, { recursive: true });
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { assets: {} };
  let storage;
  if (process.argv.includes('--upload-assets')) {
    // Deliberately load only Storage settings. Production DB/SMTP settings are
    // never installed in this process or used by the upload service.
    const values = require('dotenv').parse(fs.readFileSync(path.join(backend, '.env')));
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_EMAIL_STORAGE_BUCKET', 'SUPABASE_GALLERY_STORAGE_BUCKET']) process.env[key] = values[key] || '';
    const { SupabaseStorageService } = require('../dist/common/storage/supabase-storage.service');
    storage = new SupabaseStorageService();
  }
  // The user requested a white Instagram mark. Reuse the original vector
  // geometry; change only its two paint values, preserving the source assets.
  const svg = fs.readFileSync(path.join(source, 'assets', 'instagram.svg'), 'utf8');
  assert.equal((svg.match(/#000/g) || []).length, 2);
  const whiteSvg = svg.replaceAll('#000', '#fff');
  const whiteBuffer = await require('sharp')(Buffer.from(whiteSvg)).png().toBuffer();
  const assetNames = [...names, whiteInstagram];
  for (const name of assetNames) {
    const buffer = name === whiteInstagram ? whiteBuffer : fs.readFileSync(path.join(source, 'assets', name));
    fs.writeFileSync(path.join(destination, name), buffer);
    const sha256 = digest(buffer);
    assert.equal(digest(fs.readFileSync(path.join(destination, name))), sha256);
    if (manifest.assets[name]) assert.equal(manifest.assets[name].sha256, sha256, 'Previously uploaded source changed');
    if (!manifest.assets[name] && storage) {
      const uploaded = await storage.uploadEmailImage({ buffer, mimetype: 'image/png', originalname: name }, 'NOREPLY');
      manifest.assets[name] = { ...uploaded, sha256, ...(name === whiteInstagram ? { source: 'instagram.svg', sourceSha256: digest(Buffer.from(svg)), change: 'Original vector geometry; stroke/fill white' } : {}) };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    if (manifest.assets[name]) {
      const url = new URL(manifest.assets[name].url);
      assert.equal(url.protocol, 'https:'); assert.equal(url.search, '');
      const publicFile = await fetch(url);
      assert.equal(publicFile.status, 200, 'Public image must be accessible without authentication');
      assert.equal(digest(Buffer.from(await publicFile.arrayBuffer())), sha256, 'Public original differs from approved PNG');
    }
  }
  const optimizedName = 'fondo-cortinas-email.jpg';
  if (process.argv.includes('--optimize-background') || manifest.derivatives?.[optimizedName]) {
    const settings = { quality: 92, chromaSubsampling: '4:4:4', progressive: false };
    const optimized = await require('sharp')(path.join(destination, 'fondo-cortinas.png')).jpeg(settings).toBuffer();
    const sha256 = digest(optimized);
    assert.ok(optimized.length < manifest.assets['fondo-cortinas.png'].fileSize * 0.15);
    fs.writeFileSync(path.join(destination, optimizedName), optimized);
    if (manifest.derivatives?.[optimizedName]) assert.equal(manifest.derivatives[optimizedName].sha256, sha256);
    if (!manifest.derivatives?.[optimizedName] && storage) {
      const uploaded = await storage.uploadEmailImage({ buffer: optimized, mimetype: 'image/jpeg', originalname: optimizedName }, 'NOREPLY');
      manifest.derivatives = { [optimizedName]: { ...uploaded, sha256, source: 'fondo-cortinas.png', sourceSha256: manifest.assets['fondo-cortinas.png'].sha256, encoding: settings } };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
    assert.ok(manifest.derivatives?.[optimizedName], 'Upload the optimized background explicitly before integrating it');
    const url = new URL(manifest.derivatives[optimizedName].url);
    assert.equal(url.protocol, 'https:'); assert.equal(url.search, '');
    const publicFile = await fetch(url);
    assert.equal(publicFile.status, 200);
    assert.equal(digest(Buffer.from(await publicFile.arrayBuffer())), sha256);
  }
  if (assetNames.every(name => manifest.assets[name])) {
    let body = fs.readFileSync(path.join(source, 'cuerpo.hbs'), 'utf8');
    assert.ok(body.includes('Como privilegio de iniciación<br>'));
    body = body.replace('Como privilegio de iniciación<br>', 'Como privilegio de iniciación,<br>');
    body = body.replace(/url\('assets\/([^']+)'\)/g, (_match, name) => 'url(&quot;' + manifest.assets[name].url + '&quot;)');
    for (const name of names) body = body.replaceAll('assets/' + name, manifest.assets[name].url);
    if (manifest.derivatives?.[optimizedName]) body = body.replaceAll(manifest.assets['fondo-cortinas.png'].url, manifest.derivatives[optimizedName].url);
    body = body.replace('<td align="center" valign="top" background=', '<td class="welcome-backdrop" align="center" valign="top" background=');
    const footerStart = body.indexOf('<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;"><tr>\n<td valign="middle"');
    const footerEnd = body.indexOf('</tr></table>', footerStart) + '</tr></table>'.length;
    assert.ok(footerStart >= 0 && footerEnd > footerStart, 'Approved contact footer not found');
    // One shared row/line box: neither contact inherits a different table strut.
    // Middle-aligned block images avoid the extra baseline gap of inline images.
    const type = "font-family:Georgia,'Times New Roman',serif;font-size:11px;line-height:16px;color:#ffffff;";
    const link = type + 'display:block;letter-spacing:1px;text-decoration:none;white-space:nowrap;';
    body = body.slice(0, footerStart) + `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 auto;"><tr>
<td valign="middle" style="padding:0 4px 0 0;font-size:0px;line-height:0;"><img src="${manifest.assets['logo-cx.png'].url}" alt="" width="32" style="display:block;width:32px;height:auto;border:0;"></td>
<td valign="middle" style="padding:0 3px 0 0;font-size:0px;line-height:0;"><a href="https://www.instagram.com/cronox.es/" title="Instagram de CRONOX" style="display:block;text-decoration:none;color:#ffffff;"><img class="welcome-instagram" src="${manifest.assets[whiteInstagram].url}" alt="Instagram:" width="11" height="11" style="display:block;width:11px;height:11px;border:0;"></a></td>
<td class="welcome-footer" valign="middle" style="padding:0;${type}"><a class="welcome-footer" href="https://www.instagram.com/cronox.es/" style="${link}">cronox.es</a></td>
<td class="welcome-footer" valign="middle" style="padding:0 11px;${type}">·</td>
<td class="welcome-footer" valign="middle" style="padding:0;${type}"><a class="welcome-footer" href="mailto:support@cronox.es" style="${link}">support@cronox.es</a></td>
<td valign="middle" style="padding:0 0 0 8px;font-size:0px;line-height:0;"><img src="${manifest.assets['logo-ojo.png'].url}" alt="" width="47" style="display:block;width:47px;height:auto;border:0;"></td>
</tr></table>` + body.slice(footerEnd);
    body = body.replace('title="Ir a CRONOX" style="text-decoration:none;"', 'title="Ir a CRONOX" style="text-decoration:none;color:#080808;"');
    body = body.replace('letter-spacing:3px;color:#080808;">{{discountCode}}', 'letter-spacing:3px;color:#080808;overflow-wrap:anywhere;word-break:break-word;">{{discountCode}}');
    body = body.replaceAll('{{#if discountCode}}', '').replaceAll('{{/if}}', '');
    // The renderer owns the full-width page and the single 600px reading frame.
    // Keep only this design's background/content table, not another page/frame.
    const outer = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#aaa9a6;">\n<tr><td align="center">\n';
    const frame = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:collapse;">';
    assert.ok(body.startsWith(outer + frame));
    body = body.slice(outer.length).trimEnd();
    const close = '</td></tr></table>';
    assert.ok(body.endsWith(close));
    body = body.slice(0, -close.length).trimEnd() + '\n';
    body = body.replace(frame, '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:0;border-collapse:collapse;background-color:#aaa9a6;">');
    // Supply both dimensions so clients reserve each image's aspect ratio even
    // before its network response, without changing responsive rendered sizes.
    for (const [name, height] of [['logo-cronox.png', 50], ['la-cara-b.png', 69], ['logo-cx.png', 23], ['logo-ojo.png', 14]]) {
      const start = body.indexOf('<img src="' + manifest.assets[name].url + '"');
      const end = body.indexOf('>', start);
      assert.ok(start >= 0 && end > start);
      const tag = body.slice(start, end);
      body = body.slice(0, start) + tag.replace(/ width="(\d+)"/, '$& height="' + height + '"') + body.slice(end);
    }
    // Keep selectable code and the original spacing/text, without extra advice.
    assert.ok(body.includes('padding:29px 25px 30px;'));
    assert.ok(!body.includes('Mantén pulsado'));
    assert.ok(!body.includes('assets/'));
    assert.ok(!/CRX-EJEMPLO|BIENVENIDA10|CÓDIGO DE EJEMPLO/.test(body));
    fs.writeFileSync(path.join(backend, 'src/email/templates/newsletter-welcome-approved.hbs'), body, 'utf8');
  }
  console.log(JSON.stringify({ originalsCopied: names.length, publicAssetsVerified: Object.keys(manifest.assets).length + Object.keys(manifest.derivatives || {}).length, optimizedBackground: manifest.derivatives?.[optimizedName] ? { originalBytes: manifest.assets['fondo-cortinas.png'].fileSize, bytes: manifest.derivatives[optimizedName].fileSize } : null, whiteInstagramUsesOriginalVector: true, originalArtworkRedrawn: false, remoteDatabaseWrites: false, mailSent: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
