import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const source = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/black-friday.js'),
  'utf8',
);
const madrid = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/key-screen-time.js'),
  'utf8',
);
const start = Date.parse('2026-11-26T20:00:00Z');
const data = {
  enabled: true,
  startsAt: new Date(start).toISOString(),
  endsAt: '2026-11-27T23:00:00.000Z',
  title: 'BLACK FRIDAY',
  bannerText: 'PROMO',
  eventText: 'YA ESTÁ AQUÍ',
  textColor: '#ffffff',
  backgroundColor: '#111111',
  serverTime: new Date(start - 2000).toISOString(),
};
async function setup(settings: object, home = true) {
  const dom = new JSDOM(
    `<body class="${home ? 'page-home' : ''}"><header class="topbar"></header>${home ? '<section id="hero"></section>' : ''}</body>`,
    {
      url: 'http://localhost:3000/',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    },
  );
  const window = dom.window as any;
  let elapsed = 0;
  window.performance.now = () => elapsed;
  window.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => settings });
  window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.setInterval = (fn: () => void, ms: number) => {
    if (ms === 250) window.__tick = fn;
    return 1;
  };
  window.eval(source);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    dom,
    window,
    advance: (ms: number) => {
      elapsed = ms;
      window.__tick?.();
    },
  };
}
describe('Black Friday public rendering', () => {
  it('leaves disabled, malformed and expired pages without any campaign layout', async () => {
    for (const settings of [
      { enabled: false },
      { ...data, endsAt: 'invalid' },
      { ...data, serverTime: data.endsAt },
    ]) {
      const { dom, window } = await setup(settings);
      expect(window.document.querySelector('.bf-hero,.bf-banner')).toBeNull();
      expect(window.document.documentElement.className).not.toContain('bf-');
      dom.window.close();
    }
  });
  it('transitions across start and end with an absolute clock, including a background tab jump', async () => {
    const { dom, window, advance } = await setup(data);
    expect(
      window.document.querySelector('.bf-hero .bf-clock-label').textContent,
    ).toBe('EMPIEZA EN');
    expect(
      window.document.querySelector('.bf-banner').getAttribute('aria-hidden'),
    ).toBe('true');
    advance(2500);
    expect(window.document.querySelector('.bf-hero')).toBeNull();
    expect(window.document.querySelector('#hero').classList.contains('bf-host')).toBe(false);
    expect(window.document.querySelector('.bf-banner .bf-text').textContent).toBe(data.bannerText);
    expect(
      window.document.querySelector('.bf-banner .bf-clock-label').textContent,
    ).toBe('TERMINA EN');
    expect(window.document.querySelector('.bf-sr').textContent).toContain(
      'Europe/Madrid',
    );
    advance(Date.parse(data.endsAt) - start + 3000);
    expect(window.document.querySelector('.bf-hero,.bf-banner')).toBeNull();
    expect(
      window.document.documentElement.style.getPropertyValue('--bf-offset'),
    ).toBe('');
    dom.window.close();
  });
  it('uses the compact banner directly on interior pages and hides decorative duplicates from accessibility', async () => {
    const { dom, window } = await setup(data, false);
    expect(window.document.querySelector('.bf-hero')).toBeNull();
    expect(
      window.document.documentElement.classList.contains('bf-compact'),
    ).toBe(true);
    expect(
      window.document.querySelector('.bf-copy').getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      window.document.querySelector('.bf-clock').getAttribute('aria-hidden'),
    ).toBe('true');
    expect(window.document.querySelector('[aria-live]')).toBeNull();
    dom.window.close();
  });
  it('handles Madrid dates independently of the browser zone and rejects DST gaps/ambiguities', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(madrid);
    const time = (dom.window as any).CRONOX_MADRID_TIME;
    expect(time.madridLocalToUtc('2026-11-26T21:00')).toBe(data.startsAt);
    expect(time.utcToMadridLocal(data.startsAt)).toBe('2026-11-26T21:00');
    expect(() => time.madridLocalToUtc('2026-03-29T02:30')).toThrow(
      'NONEXISTENT',
    );
    expect(() => time.madridLocalToUtc('2026-10-25T02:30')).toThrow(
      'AMBIGUOUS',
    );
    dom.window.close();
  });
});
