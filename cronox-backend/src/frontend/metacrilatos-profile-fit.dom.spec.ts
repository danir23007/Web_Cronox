import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const frontend = path.resolve(__dirname, '../../../cronox-front');
const source = readFileSync(path.join(frontend, 'assets/metacrilatos-profile.js'), 'utf8');
const html = readFileSync(path.join(frontend, 'profile.html'), 'utf8');
const properties = ['--meta-fit-width', '--meta-fit-height', '--meta-fit-scale'];
const layoutClass = 'metacrilatos-profile-desktop';

describe('METACRILATOS personal composition viewport fit', () => {
  const windows: any[] = [];
  afterEach(() => {
    for (const win of windows.splice(0)) win.close();
  });

  function setup(options: { width?: number; height?: number; naturalHeight?: number; top?: number; footer?: number; eligible?: boolean; preview?: boolean } = {}) {
    const dom = new JSDOM(html, {
      url: 'http://localhost/profile.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
    });
    const win = dom.window as any;
    windows.push(win);
    win.eval(readFileSync(path.join(frontend, 'assets/metacrilatos-presentation.js'), 'utf8'));
    const section = win.document.querySelector('[data-profile-section="accreditation"]');
    const shell = win.document.querySelector('[data-metacrilatos-fit]');
    const member = section.querySelector('[data-metacrilatos-member]');
    const footer = win.document.querySelector('body > .footer');
    const host = win.document.createElement('div');
    host.className = 'metacrilatos-host';
    host.innerHTML = '<div class="crx-slab" style="transform: rotateX(17deg) rotateY(73deg)"></div>';
    section.querySelector('.profile-card').prepend(host);
    section.classList.toggle('is-active', options.eligible !== false);
    section.dataset.accreditationRenderer = 'metacrilatos-v1';
    member.hidden = false;
    if (options.preview) win.document.body.replaceChildren(section);

    const metrics = {
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      naturalHeight: options.naturalHeight ?? 600,
      top: options.top ?? 220,
      footer: options.footer ?? 30,
      scrollY: 0,
      visualHeight: options.height ?? 1080,
      footerMarginTop: 0,
      footerMarginBottom: 0,
    };
    const bounds = (width: number, height: number, top = 0) => ({ width, height, top, bottom: top + height, x: 0, y: top, left: 0, right: width, toJSON() {} });
    const number = (property: string) => Number.parseFloat(shell.style.getPropertyValue(property));
    shell.getBoundingClientRect = () => bounds(number('--meta-fit-width') || 690, number('--meta-fit-height') || metrics.naturalHeight, metrics.top - metrics.scrollY);
    section.getBoundingClientRect = () => bounds(690 * (number('--meta-fit-scale') || 1), metrics.naturalHeight * (number('--meta-fit-scale') || 1));
    footer.getBoundingClientRect = () => bounds(metrics.width, metrics.footer);
    Object.defineProperty(win.document.documentElement, 'clientWidth', { get: () => metrics.width });
    Object.defineProperty(win, 'innerHeight', { get: () => metrics.height });
    Object.defineProperty(win, 'scrollY', { get: () => metrics.scrollY });
    const viewport = new win.EventTarget();
    Object.defineProperty(viewport, 'height', { get: () => metrics.visualHeight });
    win.visualViewport = viewport;
    const fonts = new win.EventTarget();
    Object.defineProperty(win.document, 'fonts', { value: fonts });
    const media = new win.EventTarget();
    media.matches = metrics.width >= 760;
    win.matchMedia = jest.fn(() => media);
    const computedStyle = win.getComputedStyle.bind(win);
    win.getComputedStyle = (element: any) => element === section
      ? { zoom: String(number('--meta-fit-scale') || 1) }
      : element === footer
        ? { marginTop: String(metrics.footerMarginTop), marginBottom: String(metrics.footerMarginBottom) }
        : computedStyle(element);

    let nextFrame = 0;
    const frames = new Map<number, (time: number) => void>();
    const allCallbacks: Array<(time: number) => void> = [];
    win.requestAnimationFrame = jest.fn((callback: (time: number) => void) => {
      allCallbacks.push(callback);
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    win.cancelAnimationFrame = jest.fn((id: number) => frames.delete(id));
    const resizeObservers: any[] = [];
    const mutationObservers: any[] = [];
    const observer = (instances: any[]) => class {
      disconnected = false;
      observed: any[] = [];
      constructor(public callback: () => void) { instances.push(this); }
      observe(element: any) { this.observed.push(element); }
      disconnect() { this.disconnected = true; }
    };
    win.ResizeObserver = observer(resizeObservers);
    win.MutationObserver = observer(mutationObservers);
    win.CRONOX_METACRILATOS = { mount: jest.fn() };
    win.CRONOX_ACCREDITATION_DESIGNS = { loadActive: jest.fn(), destroy: jest.fn() };
    win.eval(source);
    const flush = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(16));
    };
    const resize = (width: number, height: number) => {
      metrics.width = width;
      metrics.height = metrics.visualHeight = height;
      media.matches = width >= 760;
      media.dispatchEvent(new win.Event('change'));
      win.dispatchEvent(new win.Event('resize'));
      viewport.dispatchEvent(new win.Event('resize'));
      flush();
    };
    const mutation = () => { mutationObservers.filter(instance => !instance.disconnected).forEach(instance => instance.callback()); flush(); };
    return { win, section, shell, member, host, metrics, viewport, fonts, frames, allCallbacks, resizeObservers, mutationObservers, number, flush, resize, mutation };
  }

  it.each([
    { width: 1366, height: 768, expected: 1 },
    { width: 1920, height: 1080, expected: (1080 - 220 - 30 - 12) / 600 },
    { width: 3840, height: 2600, expected: (2600 - 220 - 30 - 12) / 600 },
  ])('uses the largest proportional height fit at $width × $height without an upper scale cap', ({ width, height, expected }) => {
    const f = setup({ width, height });
    f.flush();
    expect(f.number('--meta-fit-scale')).toBeCloseTo(expected, 4);
    expect(f.number('--meta-fit-width')).toBe(width - 48);
    expect(f.number('--meta-fit-height')).toBeCloseTo(Math.max(600, height - 220 - 30 - 12), 4);
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(true);
  });

  it('fits to available width when height is plentiful and reserves the full scaled dimensions', () => {
    const f = setup({ width: 1200, height: 2400 });
    f.flush();
    expect(f.number('--meta-fit-scale')).toBeCloseTo((1200 - 48) / 690, 4);
    expect(f.number('--meta-fit-width')).toBe(1152);
    expect(f.number('--meta-fit-height')).toBe(2400 - 220 - 30 - 12);
  });

  it('subtracts the measured content offset and footer, including their changes, independently of scroll position', () => {
    const f = setup();
    f.flush();
    f.metrics.top += 35;
    f.metrics.footer = 42;
    f.metrics.footerMarginTop = 4;
    f.metrics.footerMarginBottom = 6;
    f.metrics.scrollY = 125;
    f.resizeObservers[0].callback();
    f.flush();
    expect(f.number('--meta-fit-scale')).toBeCloseTo((1080 - 255 - 42 - 4 - 6 - 12) / 600, 4);
    const observed = f.resizeObservers[0].observed;
    expect(observed).toContain(f.win.document.querySelector('.topbar'));
    expect(observed).toContain(f.win.document.querySelector('.profile-tabs'));
    expect(observed).toContain(f.win.document.querySelector('.store-heading'));
    expect(observed).toContain(f.win.document.getElementById('profileMessage'));
  });

  it('recomputes natural height under the current exterior zoom without compounding or touching the renderer', () => {
    const f = setup();
    const slab = f.host.firstElementChild;
    const orientation = slab.style.transform;
    f.flush();
    f.resize(2560, 1600);
    expect(f.number('--meta-fit-scale')).toBeCloseTo((1600 - 220 - 30 - 12) / 600, 4);
    f.metrics.naturalHeight = 900;
    f.resizeObservers[0].callback();
    f.flush();
    expect(f.number('--meta-fit-scale')).toBeCloseTo((1600 - 220 - 30 - 12) / 900, 4);
    expect(f.host.firstElementChild).toBe(slab);
    expect(slab.style.transform).toBe(orientation);
    expect(f.win.CRONOX_METACRILATOS.mount).not.toHaveBeenCalled();
    expect(f.win.CRONOX_ACCREDITATION_DESIGNS.loadActive).not.toHaveBeenCalled();
    expect(f.win.CRONOX_ACCREDITATION_DESIGNS.destroy).not.toHaveBeenCalled();
  });

  it('preserves the readability floor and reserves scrollable content in a short or zoomed viewport', () => {
    const f = setup({ height: 450 });
    f.flush();
    expect(f.number('--meta-fit-scale')).toBe(1);
    expect(f.number('--meta-fit-height')).toBe(600);
    f.metrics.height = 1080;
    f.metrics.visualHeight = 400;
    f.viewport.dispatchEvent(new f.win.Event('resize'));
    f.flush();
    expect(f.number('--meta-fit-scale')).toBe(1);
    expect(f.number('--meta-fit-height')).toBe(600);
  });

  it('removes every desktop layout property on mobile and restores a fresh fit on returning to desktop', () => {
    const f = setup();
    f.flush();
    f.resize(375, 812);
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(false);
    properties.forEach(property => expect(f.shell.style.getPropertyValue(property)).toBe(''));
    f.resize(1920, 1080);
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(true);
    expect(f.number('--meta-fit-scale')).toBeCloseTo(818 / 600, 4);
  });

  it.each(['inactive', 'loading', 'hidden', 'book', 'member-hidden', 'host-removed'])('cleans up scaling for an ineligible state: %s', state => {
    const f = setup();
    f.flush();
    if (state === 'inactive') f.section.classList.remove('is-active');
    if (state === 'loading') f.section.classList.add('is-loading');
    if (state === 'hidden') f.section.hidden = true;
    if (state === 'book') f.section.dataset.accreditationRenderer = 'original-v1';
    if (state === 'member-hidden') f.member.hidden = true;
    if (state === 'host-removed') f.host.remove();
    f.mutation();
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(false);
    properties.forEach(property => expect(f.shell.style.getPropertyValue(property)).toBe(''));
    expect(f.win.CRONOX_ACCREDITATION_DESIGNS.destroy).not.toHaveBeenCalled();
  });

  it('does not initialize a desktop layout for the administrator preview without the profile shell', () => {
    const f = setup({ preview: true });
    expect(f.frames.size).toBe(0);
    expect(f.resizeObservers).toHaveLength(0);
    expect(f.mutationObservers).toHaveLength(0);
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(false);
  });

  it('coalesces font, data, and viewport changes into one measurement frame', () => {
    const f = setup();
    expect(f.frames.size).toBe(1);
    f.resizeObservers[0].callback();
    f.mutationObservers[0].callback();
    f.win.dispatchEvent(new f.win.Event('resize'));
    f.viewport.dispatchEvent(new f.win.Event('resize'));
    f.fonts.dispatchEvent(new f.win.Event('loadingdone'));
    expect(f.frames.size).toBe(1);
    f.flush();
    expect(f.frames.size).toBe(0);
    const layout = f.shell.style.cssText;
    f.resizeObservers[0].callback();
    f.flush();
    expect(f.shell.style.cssText).toBe(layout);
    expect(f.frames.size).toBe(0);
  });

  it('cancels pending work on pagehide, ignores stale callbacks, and starts only one observer set on pageshow', () => {
    const f = setup();
    const staleFrame = f.allCallbacks[0];
    f.win.dispatchEvent(new f.win.Event('pagehide'));
    expect(f.frames.size).toBe(0);
    expect(f.resizeObservers[0].disconnected).toBe(true);
    expect(f.mutationObservers[0].disconnected).toBe(true);
    staleFrame(16);
    f.resizeObservers[0].callback();
    f.win.dispatchEvent(new f.win.Event('resize'));
    f.viewport.dispatchEvent(new f.win.Event('resize'));
    f.fonts.dispatchEvent(new f.win.Event('loadingdone'));
    expect(f.frames.size).toBe(0);
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(false);
    properties.forEach(property => expect(f.shell.style.getPropertyValue(property)).toBe(''));
    f.win.dispatchEvent(new f.win.Event('pageshow'));
    f.win.dispatchEvent(new f.win.Event('pageshow'));
    expect(f.resizeObservers).toHaveLength(2);
    expect(f.mutationObservers).toHaveLength(2);
    expect(f.frames.size).toBe(1);
    f.flush();
    expect(f.win.document.body.classList.contains(layoutClass)).toBe(true);
    expect(f.frames.size).toBe(0);
  });
});
