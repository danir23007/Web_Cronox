import sharp from 'sharp';
import { join } from 'node:path';
import { parseDocument } from 'htmlparser2';
import { orderCanvas, orderRingsUrl } from './order-confirmation-design';

const { orderRingSvg } = require('../../../scripts/order-mail-rings.cjs');
const radii = [268, 220, 172, 124, 76];
const colors = ['#000000', '#000000', '#7C7C7C', '#FFFFFF', '#B1001A'];
const cases = [1, 2, 3, 4, 5].flatMap(circle => ['light', 'dark'].map(theme => ({ circle, theme })));
describe('five visible order rings with a single active colour', () => {
  it.each(cases)('keeps the approved geometry and outside-to-inside identity ($circle/$theme)', ({ circle, theme }) => {
    const rings: any[] = [];
    const visit = (node: any) => { if (node.attribs?.['data-ring']) rings.push(node.attribs); node.children?.forEach(visit); };
    visit(parseDocument(orderRingSvg(circle, theme)));
    expect(rings).toHaveLength(5);
    rings.forEach((ring, i) => {
      expect([ring.cx, ring.cy, ring.r]).toEqual(['450', '700', String(radii[i])]);
      expect(ring['data-ring']).toBe(String(i + 1));
      expect(ring.stroke).toBe(i + 1 === circle ? colors[i] : theme === 'dark' ? '#B0B0B0' : '#686868');
    });
  });
  it.each(cases)('exports all five distinguishable strokes in the actual PNG ($circle/$theme)', async ({ circle, theme }) => {
    const file = join(__dirname, '../../../../cronox-front/assets/mail/order-confirmation', `rings-${circle}-${theme}.png`);
    const base = theme === 'light' ? [247, 247, 245] : [27, 27, 27];
    const { data, info } = await sharp(file).flatten({ background: { r: base[0], g: base[1], b: base[2] } }).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([640, 1400]);
    const difference = (y: number) => Math.max(...base.map((value, c) => Math.abs(data[(y * info.width + 450) * info.channels + c] - value)));
    const strengths = radii.map(radius => Math.max(...Array.from({ length: 11 }, (_, i) => difference(700 - radius - 5 + i))));
    // Previous resources had inactive strokes only 1–4 RGB levels from the
    // canvas. This checks the flattened raster, not just five SVG elements.
    expect(strengths.every(strength => strength >= 10)).toBe(true);
    expect(strengths[circle - 1]).toBeGreaterThan(Math.max(...strengths.filter((_, i) => i !== circle - 1)) * 1.25);
    const bands: number[][] = [];
    for (let y = 420; y <= 635; y++) if (difference(y) >= 7) {
      if (!bands.length || bands[bands.length - 1].at(-1)! !== y - 1) bands.push([]);
      bands[bands.length - 1].push(y);
    }
    expect(bands).toHaveLength(5);
    bands.forEach((band, i) => expect(Math.abs((band[0] + band.at(-1)!) / 2 - (700 - radii[i]))).toBeLessThan(2));
  });
  it('updates only the resource URL and keeps the approved canvas position and scale', () => {
    for (let circle = 1; circle <= 5; circle++) {
      expect(orderRingsUrl(circle)).toContain(`rings-${circle}-light.png?v=${circle === 5 ? 4 : circle === 4 ? 3 : 2}`);
      expect(orderCanvas('<p>Contenido original</p>', circle)).toContain('background-size:640px 1400px;background-position:70% center;');
    }
  });
  it.each(['light', 'dark'])('keeps the centre of circle IV pure opaque white in the final PNG (%s)', async theme => {
    const file = join(__dirname, '../../../../cronox-front/assets/mail/order-confirmation', `rings-4-${theme}.png`);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const offset = (576 * info.width + 450) * info.channels;
    expect([...data.subarray(offset, offset + 4)]).toEqual([255, 255, 255, 255]);
    expect(orderRingSvg(4, theme)).toMatch(/data-ring="4"[^>]*stroke="#FFFFFF"[^>]*stroke-width="2" opacity="1"/);
  });
  it.each(['light', 'dark'])('uses the historical brand red exclusively on the inner active V (%s)', async theme => {
    const svg = orderRingSvg(5, theme);
    expect(svg).toMatch(/data-ring="5"[^>]*r="76"[^>]*stroke="#B1001A"/);
    expect(svg.match(/#B1001A/g)).toHaveLength(1);
    const file = join(__dirname, '../../../../cronox-front/assets/mail/order-confirmation', `rings-5-${theme}.png`);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const offset = (624 * info.width + 450) * info.channels;
    // Transparent antialiasing rounds premultiplied 8-bit channels.
    expect(Math.abs(data[offset] - 177)).toBeLessThanOrEqual(2);
    expect(data[offset + 1]).toBe(0); expect(Math.abs(data[offset + 2] - 26)).toBeLessThanOrEqual(1);
  });
});
