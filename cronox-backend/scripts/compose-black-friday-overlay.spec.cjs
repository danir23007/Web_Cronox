'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { composeBlackFridayOverlay } = require('./compose-black-friday-overlay.cjs');

test('lossless static counter keeps its position and draws only black glyphs without a panel', async () => {
  const width = 900, height = 300;
  const original = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const result = await composeBlackFridayOverlay(original);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, width); assert.equal(metadata.height, height);
  assert.equal((result.svg.match(/>00<\/text>/g) || []).length, 4);
  assert.equal((result.svg.match(/>:<\/text>/g) || []).length, 3);
  for (const unit of ['DÍAS', 'HORAS', 'MINUTOS', 'SEGUNDOS']) assert(result.svg.includes('>' + unit + '</text>'));
  assert(result.svg.includes('<g fill="#000000"'));
  assert(!/<rect|<filter|<path|opacity|shadow|#ffffff/i.test(result.svg));
  assert(!/script|animate|Date\(|setInterval/i.test(result.svg));
  const { x, y, width: panelWidth, height: panelHeight } = result.bounds;
  const raw = await sharp(result.buffer).removeAlpha().raw().toBuffer();
  let unchanged = 0;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    if (col >= x && col < x + panelWidth && row >= y && row < y + panelHeight) continue;
    const offset = (row * width + col) * 3;
    assert.equal(raw[offset], 255); assert.equal(raw[offset + 1], 255); assert.equal(raw[offset + 2], 255);
    unchanged++;
  }
  assert(unchanged > width * height * .7);
  const fill = ((y + Math.round(panelHeight * .12)) * width + x + Math.round(panelWidth / 2)) * 3;
  assert.equal(raw[fill], 255, 'space around glyphs retains the original photo with no background');
  assert(raw.includes(0), 'counter glyphs contain opaque black pixels');
  assert.deepEqual(result.bounds, { x: 117, y: 205, width: 666, height: 80 });
});
