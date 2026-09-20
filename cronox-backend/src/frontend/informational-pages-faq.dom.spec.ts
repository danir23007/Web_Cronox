import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

const infoPages = [
  'faqs.html',
  'shipping-policy.html',
  'returns-exchanges.html',
  'develop.html',
  'events.html',
  'privacy-policy.html',
  'cookie-policy.html',
  'terms-of-service.html',
  'aviso-legal.html',
];

describe('Informational pages and FAQ', () => {
  it.each(infoPages)('%s uses the shared topbar clearance contract', (file) => {
    const html = read(file);
    const document = new JSDOM(html).window.document;
    expect(document.body.classList.contains('page-info')).toBe(true);
    expect(
      document.querySelector('link[href="assets/info-page.css?v=3"]'),
    ).not.toBeNull();
    const inlineStyles = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent)
      .join('\n');
    expect(inlineStyles).not.toMatch(
      /body\s*\{[^}]*padding\s*:\s*(?:40|64)px\s+20px/s,
    );
  });

  it('defines one responsive, safe-area-aware gap and preserves gallery spacing', () => {
    const css = read('assets/info-page.css');
    expect(css).toContain('body.page-info:not(.page-gallery)');
    expect(css).toContain('var(--topbar-h, 64px)');
    expect(css).toContain('env(safe-area-inset-top)');
    expect(css).toContain('clamp(28px, 4vw, 52px)');
    expect(css).toContain('body.page-info.page-gallery');
  });

  it('contains 20–30 collapsed questions grouped into the seven expected categories', () => {
    const document = new JSDOM(read('faqs.html')).window.document;
    const categories = Array.from(
      document.querySelectorAll('.faq-category > h2'),
    ).map((heading) => heading.textContent?.trim());
    expect(categories).toEqual([
      'PEDIDOS Y COMPRA',
      'ENVÍOS',
      'CAMBIOS Y DEVOLUCIONES',
      'PAGOS',
      'PRODUCTOS Y TALLAS',
      'CUENTA',
      'PRIVACIDAD Y COOKIES',
    ]);
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '.faq-item button[aria-controls]',
      ),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(20);
    expect(buttons.length).toBeLessThanOrEqual(30);
    buttons.forEach((button) => {
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('button');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      const id = button.getAttribute('aria-controls')!;
      const answer = document.getElementById(id);
      expect(id).toMatch(/^faq-answer-\d+$/);
      expect(answer?.hidden).toBe(true);
    });
    expect(
      new Set(buttons.map((button) => button.getAttribute('aria-controls')))
        .size,
    ).toBe(buttons.length);
  });

  it('opens and closes an answer while keeping button keyboard semantics', () => {
    const dom = new JSDOM(read('faqs.html'), { runScripts: 'outside-only' });
    dom.window.eval(read('assets/faq.js'));
    const button =
      dom.window.document.querySelector<HTMLButtonElement>('.faq-item button')!;
    const answer = dom.window.document.getElementById(
      button.getAttribute('aria-controls')!,
    )!;
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(answer.hidden).toBe(false);
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('−');
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(answer.hidden).toBe(true);
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('+');
  });

  it('links only to real policy routes and includes responsive/reduced-motion safeguards', () => {
    const document = new JSDOM(read('faqs.html')).window.document;
    expect(
      Array.from(
        document.querySelectorAll<HTMLAnchorElement>('.faq-page a'),
      ).map((link) => link.getAttribute('href')),
    ).toEqual(
      expect.arrayContaining([
        '/envios',
        '/devoluciones',
        '/privacidad',
        '/cookies',
        '/terminos',
      ]),
    );
    const css = read('assets/faq.css');
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('width: min(920px, 100%)');
    expect(css).not.toContain('100vw');
  });

  it('keeps critical commercial values aligned with current policy sources', () => {
    const faq = read('faqs.html');
    const faqText = new JSDOM(faq).window.document.body.textContent?.replace(
      /\s+/g,
      ' ',
    );
    const shipping = read('shipping-policy.html');
    const returns = read('returns-exchanges.html');
    for (const value of [
      '1–5 días laborables',
      '2,95 €',
      '65 €',
      '24–48 horas',
      '4,95 €',
    ]) {
      expect(shipping.replace(/\s/g, '')).toContain(value.replace(/\s/g, ''));
    }
    for (const value of [
      '1 y 5 días laborables',
      '2,95 €',
      '65 €',
      '24 y 48 horas',
      '4,95 €',
    ]) {
      expect(faqText).toContain(value);
    }
    for (const value of ['30 días', '15 días', '5 y 10 días laborables']) {
      expect(returns.replace(/\s/g, '')).toContain(value.replace(/\s/g, ''));
    }
    for (const value of ['30 días', '15 días', '5 y 10 días laborables']) {
      expect(faqText).toContain(value);
    }
    expect(faq).not.toMatch(
      /\b(?:Visa|Mastercard|American Express|PayPal|Klarna)\b/i,
    );
  });
});
