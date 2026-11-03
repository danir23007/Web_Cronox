const { test } = require('node:test');
const assert = require('node:assert/strict');
const { immutableImage, updateHeaders, mergePreview } = require('./maintain-storefront-images.cjs');
const row = { bucket_id: 'gallery', name: `fotos-antiguas/variants/${'a'.repeat(64)}/grid.webp`, metadata: { mimetype: 'image/webp', contentEncoding: 'identity' }, user_metadata: { caption: 'Prenda — CRONOX', nested: { retained: true } } };
test('limits long caching to content addressed public product/gallery WebP paths', () => {
  assert.equal(immutableImage(row), true);
  for (const replacement of [
    { bucket_id: 'newsletter' }, { bucket_id: 'Acreditation' }, { owner_id: 'a-user' },
    { name: 'fotos-antiguas/current.webp' }, { name: 'fotos-antiguas/2026/photo.webp' },
    { metadata: { mimetype: 'application/pdf' } },
  ]) assert.equal(immutableImage({ ...row, ...replacement }), false);
});
test('supported PUT preserves content type, encoding and complete user metadata', () => {
  const headers = updateHeaders(row, 'max-age=31536000');
  assert.equal(headers['Cache-Control'], 'max-age=31536000');
  assert.equal(headers['Content-Type'], 'image/webp');
  assert.equal(headers['Content-Encoding'], 'identity');
  assert.deepEqual(JSON.parse(Buffer.from(headers['x-metadata'], 'base64')), row.user_metadata);
  assert.equal(headers['x-upsert'], undefined);
  assert.equal(updateHeaders(row, '31536000')['Cache-Control'], '31536000');
});
test('adds only preview and preserves original grid and enlarged metadata', () => {
  const grid = { url: 'grid', width: 1500 }, large = { url: 'large', width: 3000 };
  const before = { grid, large }, preview = { role: 'preview', url: 'preview', width: 720, height: 960 };
  assert.deepEqual(mergePreview(before, preview), { grid, large, preview });
  assert.deepEqual(before, { grid, large });
  assert.throws(() => mergePreview(before, { ...preview, role: 'large' }), /INVALID_PREVIEW/);
});
