'use strict';
// Explicit, bounded maintenance. Never UPDATE storage's internal tables.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const PROJECT = 'https://frqlgocxnyppzdgxxjuq.supabase.co';
const CACHE = 'max-age=31536000';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const immutableImage = row => ['gallery', 'product-images'].includes(row.bucket_id)
  && /\/(?:originals\/[a-f0-9]{64}\.webp|variants\/[a-f0-9]{64}\/[a-z]+\.webp)$/.test(row.name)
  && row.metadata?.mimetype === 'image/webp' && !row.owner && !row.owner_id;
function updateHeaders(row, cache) {
  return { 'Content-Type': row.metadata.mimetype, 'Cache-Control': cache,
    'x-metadata': Buffer.from(JSON.stringify(row.user_metadata || {})).toString('base64'),
    ...(row.metadata.contentEncoding ? { 'Content-Encoding': row.metadata.contentEncoding } : {}) };
}
function mergePreview(before, preview) {
  if (preview.role !== 'preview' || !preview.url || !preview.width || !preview.height) throw Error('INVALID_PREVIEW');
  return { ...(before || {}), preview };
}
async function main(args = process.argv.slice(2)) {
  const mode = args[0];
  if (!['plan', 'execute', 'verify', 'restore-cache'].includes(mode)) throw Error('MODE_REQUIRED');
  const directory = args[1];
  if (!directory || !path.isAbsolute(directory)) throw Error('ABSOLUTE_PRIVATE_DIRECTORY_REQUIRED');
  const backend = path.resolve(__dirname, '..');
  const checkout = path.dirname(backend);
  if (path.resolve(directory).startsWith(checkout + path.sep)) throw Error('BACKUP_MUST_BE_OUTSIDE_CHECKOUT');
  const env = require('dotenv').parse(fs.readFileSync(path.join(backend, '.env')));
  if (env.SUPABASE_URL?.replace(/\/$/, '') !== PROJECT || !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('EXPECTED_PROJECT_REQUIRED');
  const db = new (require('pg').Client)({ connectionString: env.DIRECT_URL || env.DATABASE_URL });
  await db.connect();
  const headers = { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const storagePath = row => row.bucket_id + '/' + row.name.split('/').map(encodeURIComponent).join('/');
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw Error('STORAGE_HTTP_' + response.status);
    return response;
  };
  const readObject = async row => Buffer.from(await (await request(PROJECT + '/storage/v1/object/authenticated/' + storagePath(row))).arrayBuffer());
  const readRow = async row => (await db.query('SELECT id,bucket_id,name,metadata,user_metadata,owner,owner_id FROM storage.objects WHERE bucket_id=$1 AND name=$2', [row.bucket_id, row.name])).rows[0];
  const file = name => path.join(directory, name);
  const save = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2), { mode: 0o600 });
  const processor = () => new (require('../dist/images/image-processor.service').ImageProcessorService)();
  try {
    if (mode === 'plan') {
      fs.mkdirSync(directory, { mode: 0o700 }); // Existing plan is never overwritten.
      const galleries = (await db.query('SELECT id,"publicUrl","storageKey",width,height,variants FROM "GalleryAsset" ORDER BY id')).rows.filter(row => !row.variants?.preview);
      const objects = (await db.query("SELECT id,bucket_id,name,metadata,user_metadata,owner,owner_id FROM storage.objects WHERE bucket_id IN ('gallery','product-images') ORDER BY bucket_id,name")).rows.filter(immutableImage).filter(row => row.metadata.cacheControl !== CACHE);
      if (galleries.length > 30 || objects.length > 200) throw Error('SCOPE_LIMIT_EXCEEDED');
      const plan = { project: PROJECT, at: new Date().toISOString(), galleries: [], objects: [] };
      for (const row of objects) {
        const bytes = await readObject(row), hash = digest(bytes), blob = hash + '.bin';
        if (bytes.length !== Number(row.metadata.size)) throw Error('OBJECT_SIZE_CHANGED');
        fs.writeFileSync(file(blob), bytes, { mode: 0o600 });
        plan.objects.push({ ...row, hash, blob });
      }
      for (const row of galleries) {
        const original = new URL(row.publicUrl);
        if (original.origin !== PROJECT || !original.pathname.startsWith('/storage/v1/object/public/gallery/')) throw Error('UNEXPECTED_GALLERY_ORIGIN');
        const bytes = Buffer.from(await (await request(original)).arrayBuffer());
        const hash = digest(bytes), blob = hash + '.bin';
        fs.writeFileSync(file(blob), bytes, { mode: 0o600 });
        const [preview] = await processor().createVariants(bytes, ['galleryPreview']);
        const key = `fotos-antiguas/variants/${hash}/preview.webp`;
        const existing = (await db.query('SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2', ['gallery', key])).rowCount;
        if (existing) throw Error('UNEXPECTED_PREVIEW_ALREADY_EXISTS');
        const derivativeBlob = digest(preview.buffer) + '.bin';
        fs.writeFileSync(file(derivativeBlob), preview.buffer, { mode: 0o600 });
        plan.galleries.push({ ...row, hash, blob, derivativeBlob, derivativeHash: digest(preview.buffer), preview: {
          role: 'preview', storageKey: key, url: PROJECT + '/storage/v1/object/public/gallery/' + key,
          mimeType: 'image/webp', width: preview.width, height: preview.height, fileSize: preview.fileSize,
        } });
      }
      save('plan.json', plan);
      fs.writeFileSync(file('plan.sha256'), digest(fs.readFileSync(file('plan.json'))), { mode: 0o600 });
      console.log(JSON.stringify({ mode, galleries: plan.galleries.length, objects: plan.objects.length, bytes: plan.objects.reduce((n,r) => n + r.metadata.size, 0), planHash: digest(fs.readFileSync(file('plan.json'))), backup: directory }));
      return;
    }
    const raw = fs.readFileSync(file('plan.json'));
    if (digest(raw) !== fs.readFileSync(file('plan.sha256'), 'utf8')) throw Error('PLAN_CHECKSUM_MISMATCH');
    const plan = JSON.parse(raw);
    if (plan.project !== PROJECT || plan.objects.length > 200 || plan.galleries.length > 30 || !plan.objects.every(immutableImage)) throw Error('PLAN_SCOPE_MISMATCH');
    // Verify every recovery copy before the first mutation, including resumed runs.
    for (const row of [...plan.objects, ...plan.galleries]) {
      if (digest(fs.readFileSync(file(row.blob))) !== row.hash) throw Error('BACKUP_CHECKSUM_MISMATCH');
      if (row.derivativeBlob && digest(fs.readFileSync(file(row.derivativeBlob))) !== row.derivativeHash) throw Error('PREVIEW_CHECKSUM_MISMATCH');
    }
    const journalPath = file('journal.json');
    const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath)) : { objects: [], galleries: [] };
    const results = { mode, objects: 0, galleries: 0, publicHeaders: 0 };
    for (const row of plan.objects) {
      const current = await readRow(row);
      if (!current || current.id !== row.id || !same(current.user_metadata, row.user_metadata) || current.metadata.mimetype !== row.metadata.mimetype) throw Error('OBJECT_IDENTITY_CHANGED');
      const bytes = await readObject(row);
      if (digest(bytes) !== row.hash) throw Error('OBJECT_CONTENT_CHANGED');
      const target = mode === 'restore-cache' ? row.metadata.cacheControl : CACHE;
      if (current.metadata.cacheControl !== target) {
        if (mode === 'verify') throw Error('CACHE_NOT_UPDATED');
        if (![row.metadata.cacheControl, CACHE].includes(current.metadata.cacheControl)) throw Error('CACHE_CHANGED_EXTERNALLY');
        await request(PROJECT + '/storage/v1/object/' + storagePath(row), { method: 'PUT', headers: updateHeaders(row, target), body: fs.readFileSync(file(row.blob)) });
      }
      const after = await readRow(row);
      if (after.metadata.cacheControl !== target || after.metadata.mimetype !== row.metadata.mimetype || !same(after.user_metadata, row.user_metadata) || digest(await readObject(row)) !== row.hash) throw Error('CACHE_UPDATE_VERIFICATION_FAILED');
      const publicResponse = await fetch(PROJECT + '/storage/v1/object/public/' + storagePath(row) + '?cacheNonce=cronox-20261103', { method: 'HEAD' });
      if (publicResponse.ok && publicResponse.headers.get('cache-control')?.includes(target)) results.publicHeaders++;
      results.objects++;
      if (!journal.objects.includes(row.name)) { journal.objects.push(row.name); save('journal.json', journal); }
    }
    if (mode !== 'restore-cache') for (const row of plan.galleries) {
      const current = (await db.query('SELECT "publicUrl",variants FROM "GalleryAsset" WHERE id=$1', [row.id])).rows[0];
      const expected = mergePreview(row.variants, row.preview);
      if (!current || current.publicUrl !== row.publicUrl || (!same(current.variants, row.variants) && !same(current.variants, expected))) throw Error('GALLERY_CHANGED_EXTERNALLY');
      if (mode === 'execute' && !same(current.variants, expected)) {
        const source = Buffer.from(await (await request(row.publicUrl)).arrayBuffer());
        if (digest(source) !== row.hash) throw Error('GALLERY_ORIGINAL_CHANGED');
        const existing = await db.query('SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2', ['gallery', row.preview.storageKey]);
        if (!existing.rowCount) await request(PROJECT + '/storage/v1/object/gallery/' + row.preview.storageKey, { method: 'POST', headers: { 'Content-Type': 'image/webp', 'Cache-Control': CACHE, 'x-upsert': 'false' }, body: fs.readFileSync(file(row.derivativeBlob)) });
        const check = await readObject({ bucket_id: 'gallery', name: row.preview.storageKey });
        if (digest(check) !== row.derivativeHash) throw Error('PREVIEW_UPLOAD_MISMATCH');
        const changed = await db.query('UPDATE "GalleryAsset" SET variants=$1::jsonb WHERE id=$2 AND variants IS NOT DISTINCT FROM $3::jsonb AND "publicUrl"=$4', [JSON.stringify(expected), row.id, JSON.stringify(row.variants), row.publicUrl]);
        if (changed.rowCount !== 1) throw Error('GALLERY_CONCURRENT_UPDATE');
      } else if (mode === 'verify' && !same(current.variants, expected)) throw Error('PREVIEW_NOT_APPLIED');
      const check = await readObject({ bucket_id: 'gallery', name: row.preview.storageKey });
      if (digest(check) !== row.derivativeHash) throw Error('PREVIEW_BYTES_MISMATCH');
      results.galleries++;
      if (!journal.galleries.includes(row.id)) { journal.galleries.push(row.id); save('journal.json', journal); }
    }
    save(mode + '-result.json', results);
    console.log(JSON.stringify(results));
  } finally { await db.end(); }
}
module.exports = { immutableImage, updateHeaders, mergePreview, main };
if (require.main === module) main().catch(error => { console.error(/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'MAINTENANCE_FAILED_DETAILS_WITHHELD'); process.exitCode = 1; });
