import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) => readFileSync(path.join(frontendRoot, file), 'utf8');

describe('profile accreditation image and mobile layout', () => {
  const html = readFrontend('profile.html');
  const css = readFrontend('assets/store.css');
  const script = readFrontend('assets/profile.js');

  it('loads the book as a real eager image that participates in readiness', () => {
    const document = new JSDOM(html).window.document;
    const art = document.querySelector<HTMLImageElement>('.accreditation-book-art');

    expect(art?.src).toContain('/Acreditation/Libro-antiguo.png');
    expect(art?.getAttribute('fetchpriority')).toBe('high');
    expect(script).toContain('ensureAccreditationBook()');
    expect(script).toContain('accreditationQrLoaded = loaded');
    expect(script).toContain('resolve(img.naturalWidth > 0)');
    expect(script).toContain("retryUrl.searchParams.set('crx_retry'");
    expect(css).not.toMatch(/\.accreditation-book::before\s*\{/);
  });

  it('uses centered, container-relative pages and valid responsive QR bounds', () => {
    expect(css).toMatch(/\.accreditation-pages\s*\{[^}]*left:\s*50%;[^}]*width:\s*100%;/s);
    expect(css).toContain('width: clamp(105px, 14vw, 170px);');
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?#cronox-member-qr\s*\{[^}]*width:\s*clamp\(66px, 21vw, 82px\);/);
    expect(css).not.toContain('clamp(170px, 34vw, 105px)');
    expect(css).not.toContain('clamp(15px, 3vw, 10px)');
  });
});
