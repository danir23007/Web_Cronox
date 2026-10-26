import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

const frontend = resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(join(frontend, file), 'utf8');
const fontRoot = 'assets/fonts/cormorant-garamond';
const manifest = JSON.parse(read(`${fontRoot}/provenance.json`)) as {
  family: string;
  files: { file: string; style: string; weight: string; unicodeRange: string; bytes: number; sha256: string; url: string }[];
};
const pages = readdirSync(frontend).filter(file => file.endsWith('.html') && /<!doctype\s+html/i.test(read(file)));
const adminPages = pages.filter(file => /^admin(?:[.-]|$)/.test(file));
const previewPage = 'metacrilatos-preview.html';
const customerPages = pages.filter(file => !adminPages.includes(file) && file !== previewPage);

// WOFF2 keeps fvar, name and cmap untransformed. Read those actual binary tables
// rather than accepting a family name in CSS or a renamed unrelated font file.
function fontTables(bytes: Buffer): Map<number, Buffer> {
  expect(bytes.toString('ascii', 0, 4)).toBe('wOF2');
  expect(bytes.readUInt32BE(8)).toBe(bytes.length);
  let cursor = 48;
  const uintBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = bytes[cursor++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('Invalid WOFF2 table length');
  };
  const directory: { tag: number; length: number }[] = [];
  for (let i = 0; i < bytes.readUInt16BE(12); i++) {
    const flags = bytes[cursor++];
    const tag = flags & 0x3f;
    if (tag === 63) cursor += 4;
    const originalLength = uintBase128();
    const version = flags >> 6;
    const transformed = tag === 10 || tag === 11 ? version === 0 : version !== 0;
    directory.push({ tag, length: transformed ? uintBase128() : originalLength });
  }
  const data = brotliDecompressSync(bytes.subarray(cursor, cursor + bytes.readUInt32BE(20)));
  const result = new Map<number, Buffer>();
  let offset = 0;
  for (const entry of directory) {
    result.set(entry.tag, data.subarray(offset, offset + entry.length));
    offset += entry.length;
  }
  expect(offset).toBe(data.length);
  return result;
}

function unicodeNames(table: Buffer): string[] {
  const storage = table.readUInt16BE(4);
  const names: string[] = [];
  for (let i = 0; i < table.readUInt16BE(2); i++) {
    const record = 6 + i * 12;
    const platform = table.readUInt16BE(record);
    const nameId = table.readUInt16BE(record + 6);
    if (![0, 3].includes(platform) || ![1, 16].includes(nameId)) continue;
    const start = storage + table.readUInt16BE(record + 10);
    const bytes = table.subarray(start, start + table.readUInt16BE(record + 8));
    names.push(Buffer.from(bytes).swap16().toString('utf16le'));
  }
  return names;
}

function hasGlyph(table: Buffer, character: string): boolean {
  const codepoint = character.codePointAt(0)!;
  for (let i = 0; i < table.readUInt16BE(2); i++) {
    const offset = table.readUInt32BE(4 + i * 8 + 4);
    const format = table.readUInt16BE(offset);
    if (format === 12) {
      for (let group = 0; group < table.readUInt32BE(offset + 12); group++) {
        const record = offset + 16 + group * 12;
        if (codepoint >= table.readUInt32BE(record) && codepoint <= table.readUInt32BE(record + 4)) return true;
      }
    } else if (format === 4 && codepoint <= 0xffff) {
      const count = table.readUInt16BE(offset + 6) / 2;
      const ends = offset + 14;
      const starts = ends + count * 2 + 2;
      const deltas = starts + count * 2;
      const ranges = deltas + count * 2;
      for (let segment = 0; segment < count; segment++) {
        const start = table.readUInt16BE(starts + segment * 2);
        if (codepoint < start || codepoint > table.readUInt16BE(ends + segment * 2)) continue;
        const delta = table.readInt16BE(deltas + segment * 2);
        const rangeOffset = table.readUInt16BE(ranges + segment * 2);
        const glyph = rangeOffset ? table.readUInt16BE(ranges + segment * 2 + rangeOffset + (codepoint - start) * 2) : codepoint;
        if (glyph && ((glyph + delta) & 0xffff)) return true;
      }
    }
  }
  return false;
}

function coverage(range: string): number[] {
  return range.split(',').flatMap(part => {
    const [start, end = start] = part.trim().replace(/^U\+/, '').split('-').map(value => parseInt(value, 16));
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
}

describe('customer typography boundaries and official font assets', () => {
  it.each(customerPages)('%s opts in by surface, independently of the visitor role', file => {
    const dom = new JSDOM(read(file));
    const document = dom.window.document;
    expect(document.body.closest('[data-cronox-surface="customer"]')).not.toBeNull();
    expect(document.querySelectorAll('link[rel="stylesheet"][href*="customer-typography.css"]')).toHaveLength(1);
    const preloads = document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="font"]');
    expect(preloads).toHaveLength(1);
    expect(preloads[0].getAttribute('crossorigin')).not.toBeNull();
    expect(preloads[0].href).toContain('cormorant-garamond-normal-latin-');
    expect(document.querySelector('link[href*="fonts.googleapis.com"]')).toBeNull();
    dom.window.close();
  });

  it.each(adminPages)('%s retains its own font surface and does not load customer font CSS', file => {
    const dom = new JSDOM(read(file));
    const document = dom.window.document;
    expect(document.querySelector('[data-cronox-surface="customer"]')).toBeNull();
    expect(document.querySelector('link[href*="customer-typography"],link[href*="customer-fonts"],link[href*="cormorant-garamond"]')).toBeNull();
    dom.window.close();
  });

  it('limits customer typography to the artwork when an admin opens the accreditation preview', () => {
    const dom = new JSDOM(read(previewPage));
    const document = dom.window.document;
    const surfaces = document.querySelectorAll('[data-cronox-surface="customer"]');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].querySelector('[data-profile-section="accreditation"]')).not.toBeNull();
    expect(document.querySelector('[data-preview-circle]')!.closest('[data-cronox-surface="customer"]')).toBeNull();
    dom.window.close();
  });

  it('scopes all central typography rules, including native controls, without a universal important override', () => {
    const css = read('assets/customer-typography.css');
    const dom = new JSDOM(`<style>${css.replace(/@import[^;]+;/g, '')}</style>`);
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        const style = rule as CSSStyleRule;
        if (style.selectorText) {
          expect(style.selectorText).toContain('[data-cronox-surface="customer"]');
          expect(style.style.getPropertyPriority('font-family')).not.toBe('important');
        }
        if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    visit(dom.window.document.styleSheets[0].cssRules as unknown as CSSRuleList);
    for (const tag of ['button', 'input', 'select', 'textarea', 'option']) expect(css).toMatch(new RegExp(`\\b${tag}\\b`));
    dom.window.close();
  });

  it('does not request unavailable 800/900 weights in any stylesheet used by customer pages', () => {
    const linkedCss = new Set<string>();
    for (const file of customerPages) {
      const dom = new JSDOM(read(file));
      for (const link of Array.from(dom.window.document.querySelectorAll('link[rel="stylesheet"]'))) {
        const href = link.getAttribute('href')!.split('?')[0].replace(/^\//, '');
        if (!/^https?:/.test(href)) linkedCss.add(href);
      }
      dom.window.close();
    }
    for (const file of linkedCss) {
      const invalidWeights = read(file).match(/\bfont(?:-weight)?\s*:\s*[89]00\b/g);
      expect({ file, invalidWeights }).toEqual({ file, invalidWeights: null });
    }
  });

  it('serves the official upright variable subsets currently used by customer pages and their license', () => {
    const dom = new JSDOM(`<style>${read('assets/customer-fonts.css')}</style>`);
    const faces = Array.from(dom.window.document.styleSheets[0].cssRules) as unknown as CSSFontFaceRule[];
    expect(faces).toHaveLength(manifest.files.length);
    expect(manifest.family).toBe('Cormorant Garamond');
    expect(manifest.files.map(file => `${file.style}:${file.file.includes('latin-ext') ? 'ext' : 'latin'}`).sort()).toEqual(['normal:ext', 'normal:latin']);
    const cmaps = new Map<string, Buffer[]>();
    for (const face of faces) {
      const file = basename(face.style.getPropertyValue('src').match(/url\(['"]?([^)'"\s]+)/)![1]);
      const source = manifest.files.find(entry => entry.file === file)!;
      expect(source).toBeDefined();
      expect(face.style.getPropertyValue('font-family').replace(/['"]/g, '')).toBe(manifest.family);
      expect(face.style.getPropertyValue('font-display')).toBe('swap');
      expect(face.style.getPropertyValue('font-weight')).toBe('300 700');
      expect(face.style.getPropertyValue('font-style')).toBe(source.style);
      const exposed = coverage(face.style.getPropertyValue('unicode-range'));
      const official = new Set(coverage(source.unicodeRange));
      expect(exposed.length).toBeGreaterThan(0);
      expect(exposed.every(code => official.has(code) && /[\p{L}\p{M}]/u.test(String.fromCodePoint(code)))).toBe(true);
      expect(new URL(source.url).hostname).toBe('fonts.gstatic.com');
      const bytes = readFileSync(join(frontend, fontRoot, file));
      expect(bytes.length).toBe(source.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
      const tables = fontTables(bytes);
      expect(unicodeNames(tables.get(5)!)).toContain('Cormorant Garamond Light');
      const fvar = tables.get(47)!;
      expect(fvar.readUInt16BE(8)).toBe(1);
      const axis = fvar.readUInt16BE(4);
      expect(fvar.toString('ascii', axis, axis + 4)).toBe('wght');
      expect(fvar.readInt32BE(axis + 4) / 65536).toBe(300);
      expect(fvar.readInt32BE(axis + 12) / 65536).toBe(700);
      cmaps.set(source.style, [...(cmaps.get(source.style) || []), tables.get(0)!]);
    }
    const sample = 'CRONOX 0123456789 ÁÉÍÓÚÜÑ áéíóúüñ ¿¡ € % — “bienvenido” çœøæß čěğłřşž';
    for (const [style, tables] of cmaps) {
      const missing = [...new Set(sample)].filter(char => !tables.some(table => hasGlyph(table, char)));
      expect({ style, missing }).toEqual({ style, missing: [] });
    }
    expect(read(`${fontRoot}/OFL.txt`)).toContain('SIL OPEN FONT LICENSE Version 1.1');
    dom.window.close();
  });

  it('keeps digits, symbols, punctuation and all whitespace out of every Cormorant face, including the local loading fallback', () => {
    const css = read('assets/customer-fonts.css') + read('assets/customer-typography.css').replace(/@import[^;]+;/g, '');
    const dom = new JSDOM(`<style>${css}</style>`);
    const faces = Array.from(dom.window.document.styleSheets[0].cssRules)
      .filter(rule => 'style' in rule && (rule as CSSFontFaceRule).style.getPropertyValue('unicode-range')) as unknown as CSSFontFaceRule[];
    expect(faces).toHaveLength(4);
    const nonletters = '0123456789€$£¥%#-–—.,:;…()[]{}«»“”\'"¿?!¡/@*+=−×÷<>|\\_ªºµℓʻʼˆ \t\n\u00a0\u2009\u202f';
    for (const face of faces) {
      const codes = new Set(coverage(face.style.getPropertyValue('unicode-range')));
      expect([...codes].every(code => /[\p{L}\p{M}]/u.test(String.fromCodePoint(code)))).toBe(true);
      expect([...nonletters].filter(character => codes.has(character.codePointAt(0)!))).toEqual([]);
    }
    const webCodes = new Set(faces.slice(0, 2).flatMap(face => coverage(face.style.getPropertyValue('unicode-range'))));
    expect([...'CRONOXáéíóúüñÁÉÍÓÚÜÑçœøæßčěğłřşžA\u0308'].every(character => webCodes.has(character.codePointAt(0)!))).toBe(true);
    dom.window.close();
  });
});
