import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const renderer = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/metacrilatos.js'), 'utf8');
const identityFormatter = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/user-identity.js'), 'utf8');
const person = { circleLevel: 1, name: 'Daniel Rivas', createdAt: '2020-01-01T00:00:00Z', registrationNumber: 1, memberCode: 'CRX-000050', visibleId: 'stable-identity' };
// The existing 650ms turn finishes on the first 16ms frame at/after 650ms,
// following the initial zero-elapsed frame. The visible-face hold starts there.
const completedTurnMs = 672;

// This browser clock drives actual event listeners and rendered transforms. It
// deliberately does not expose or depend on the renderer's private state.
class BrowserClock {
  now = 1000;
  private nextId = 0;
  private jobs = new Map<number, { due: number; frame: boolean; callback: (time?: number) => void }>();
  schedule(callback: (time?: number) => void, delay: number, frame = false) {
    const id = ++this.nextId;
    this.jobs.set(id, { due: this.now + Math.max(0, delay), frame, callback });
    return id;
  }
  cancel = (id: number) => { this.jobs.delete(id); };
  get timers() { return [...this.jobs.values()].filter(job => !job.frame).length; }
  get frames() { return [...this.jobs.values()].filter(job => job.frame).length; }
  advance(milliseconds: number) {
    const end = this.now + milliseconds;
    let iterations = 0;
    while (true) {
      const first = [...this.jobs.entries()].filter(([, job]) => job.due <= end)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!first) break;
      if (++iterations > 100000) throw new Error('Animation or timer loop did not settle');
      const [id, job] = first;
      this.jobs.delete(id);
      this.now = job.due;
      job.callback(job.frame ? this.now : undefined);
    }
    this.now = end;
  }
}

async function fixture(options: { level?: number; hidden?: boolean; containerHidden?: boolean; intersecting?: boolean; reduced?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><link rel="stylesheet" href="/assets/metacrilatos.css?v=2"><div id="root"></div>', {
    url: 'http://localhost/profile.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const win = dom.window as any;
  if (options.containerHidden) win.document.body.style.visibility = 'hidden';
  const clock = new BrowserClock();
  let hidden = options.hidden ?? false;
  let intersecting = options.intersecting ?? true;
  const observers: any[] = [];
  const resizeObservers: any[] = [];
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 480, width: 320, height: 480, toJSON() { return this; } };
  const media = new win.EventTarget();
  media.matches = options.reduced ?? false;
  media.media = '(prefers-reduced-motion: reduce)';
  media.addListener = (callback: any) => media.addEventListener('change', callback);
  media.removeListener = (callback: any) => media.removeEventListener('change', callback);
  win.matchMedia = () => media;
  win.Date.now = () => clock.now;
  Object.defineProperty(win.performance, 'now', { value: () => clock.now });
  Object.defineProperty(win.document, 'hidden', { get: () => hidden });
  Object.defineProperty(win.document, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible' });
  Object.defineProperty(win.HTMLImageElement.prototype, 'complete', { get: () => true });
  Object.defineProperty(win.HTMLImageElement.prototype, 'naturalWidth', { get: () => 100 });
  Object.defineProperty(win.document.querySelector('link'), 'sheet', { get: () => ({}) });
  win.setTimeout = (callback: any, delay = 0) => clock.schedule(callback, delay);
  win.clearTimeout = clock.cancel;
  win.requestAnimationFrame = (callback: any) => clock.schedule(callback, 16, true);
  win.cancelAnimationFrame = clock.cancel;
  win.Element.prototype.getBoundingClientRect = () => rect;
  win.Element.prototype.getClientRects = () => intersecting ? [rect] : [];
  Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { get: () => 264 });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', { get: () => 414 });
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { get: () => 320 });
  Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { get: () => 480 });
  win.ResizeObserver = class {
    disconnected = false;
    constructor(public callback: any) { resizeObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  win.IntersectionObserver = class {
    disconnected = false;
    target: any;
    constructor(public callback: any) { observers.push(this); }
    observe(target: any) { this.target = target; Promise.resolve().then(() => this.notify()); }
    notify() { if (!this.disconnected) this.callback([{ target: this.target, isIntersecting: intersecting, intersectionRatio: intersecting ? 1 : 0 }]); }
    disconnect() { this.disconnected = true; }
  };
  const captured = new WeakMap<object, number>();
  win.HTMLElement.prototype.setPointerCapture = function(id: number) { captured.set(this, id); };
  win.HTMLElement.prototype.hasPointerCapture = function(id: number) { return captured.get(this) === id; };
  win.HTMLElement.prototype.releasePointerCapture = function(id: number) {
    if (captured.get(this) !== id) return;
    captured.delete(this);
    const event = new win.Event('lostpointercapture');
    Object.defineProperty(event, 'pointerId', { value: id });
    this.dispatchEvent(event);
  };
  win.eval(identityFormatter);
  win.eval(renderer);
  const host = win.document.getElementById('root');
  let instance = win.CRONOX_METACRILATOS.mount(host, { ...person, circleLevel: options.level ?? 1 });
  await instance.ready;
  await Promise.resolve();
  const slab = () => host.querySelector('.crx-slab');
  const orientation = (element = slab()) => {
    const match = /rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/.exec(element.style.transform);
    if (!match) throw new Error(`Invalid orientation: ${element.style.transform}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  function pointer(type: string, extra: Record<string, any> = {}, target = host.querySelector('.crx-stage')) {
    const event = new win.Event(type, { bubbles: true, cancelable: true });
    Object.entries({ button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, isPrimary: true, ...extra })
      .forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    target.dispatchEvent(event);
  }
  const flip = () => host.querySelector('[data-crx-flip]').click();
  return {
    win, host, clock, slab, orientation, pointer, flip, observers, resizeObservers,
    get instance() { return instance; },
    async reopen() { instance = win.CRONOX_METACRILATOS.mount(host, person); await instance.ready; await Promise.resolve(); },
    hidden(value: boolean) { hidden = value; win.document.dispatchEvent(new win.Event('visibilitychange')); },
    intersecting(value: boolean) { intersecting = value; observers.forEach(observer => observer.notify()); },
    reduced(value: boolean) { media.matches = value; media.dispatchEvent(new win.Event('change')); },
    close() { instance.destroy(); win.close(); },
  };
}

describe('METACRILATOS shared motion lifecycle', () => {
  it('prints the stored public code verbatim, preserving QR and avoiding administrative/identity/token fallbacks', async () => {
    const f = await fixture({ reduced: true });
    const qrDataUrl = 'data:image/png;base64,AA==';
    try {
      for (const memberCode of ['CRX-000050', '000007', '0', undefined, null, '', 7]) {
        await f.instance.update({ ...person, memberCode, qrDataUrl,
          id: 999, publicMemberToken: 'not-a-display-code' });
        const expected = typeof memberCode === 'string' && memberCode ? memberCode : '—';
        const label = f.host.querySelector('[data-crx-id]');
        expect(label.textContent).toBe(expected);
        expect(label.title).toBe(expected);
        expect(f.host.querySelector('.crx-qr img').getAttribute('src')).toBe(qrDataUrl);
        expect(f.host.textContent).not.toContain(person.visibleId);
        expect(label.textContent).not.toBe(String(person.registrationNumber));
      }
      await f.instance.update({ ...person, registrationNumber: 1042, qrDataUrl });
      expect(f.host.querySelector('[data-crx-id]').textContent).toBe('CRX-000050');
      expect(f.host.querySelector('.crx-qr img').getAttribute('src')).toBe(qrDataUrl);
    } finally { f.close(); }
  });
  it.each([1, 2, 3, 4, 5])('starts automatic motion for visible circle %i with one native face button and matching label', async level => {
    const f = await fixture({ level });
    try {
      expect(f.host.querySelectorAll('.crx-actions button')).toHaveLength(1);
      expect(f.host.querySelector('[data-crx-auto]')).toBeNull();
      const button = f.host.querySelector('[data-crx-flip]');
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('button');
      const before = f.orientation();
      f.clock.advance(1016);
      expect(f.orientation().y - before.y).toBeCloseTo(20.832, 3);
      expect(f.clock.frames).toBe(1);
      expect(button.textContent).toBe('Ver reverso');
      f.clock.advance(6000);
      expect(f.host.querySelector('.crx-back').getAttribute('aria-hidden')).toBe('false');
      expect(button.textContent).toBe('Ver anverso');
    } finally { f.close(); }
  });

  it('retains the face button text node between frames and updates accessible faces when the card turns', async () => {
    const f = await fixture();
    try {
      const button = f.host.querySelector('[data-crx-flip]');
      const initialLabel = button.firstChild;
      const changes: MutationRecord[] = [];
      const observer = new f.win.MutationObserver((records: MutationRecord[]) => changes.push(...records));
      for (const face of f.host.querySelectorAll('.crx-face')) {
        observer.observe(face, { attributes: true, attributeFilter: ['aria-hidden'] });
      }
      f.clock.advance(1016);
      await Promise.resolve();
      expect(button.firstChild).toBe(initialLabel);
      expect(changes).toHaveLength(0);
      f.clock.advance(6000);
      await Promise.resolve();
      expect(button.textContent).toBe('Ver anverso');
      expect(f.host.querySelector('.crx-front').getAttribute('aria-hidden')).toBe('true');
      expect(f.host.querySelector('.crx-back').getAttribute('aria-hidden')).toBe('false');
      expect(changes).toHaveLength(2);
      observer.disconnect();
    } finally { f.close(); }
  });

  it('starts only when visible and resets its frame baseline after visibility suspension', async () => {
    const f = await fixture({ hidden: true });
    try {
      const start = f.orientation();
      f.clock.advance(20000);
      expect(f.orientation()).toEqual(start);
      expect(f.clock.frames).toBe(0);
      f.hidden(false);
      f.clock.advance(1016);
      expect(f.orientation().y - start.y).toBeCloseTo(20.832, 3);
      f.hidden(true);
      const suspended = f.orientation();
      f.clock.advance(20000);
      expect(f.orientation()).toEqual(suspended);
      f.hidden(false);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(suspended);
      f.clock.advance(16);
      expect(f.orientation().y - suspended.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it('waits for an intersecting instance and resumes from the same angle when it becomes visible', async () => {
    const f = await fixture({ intersecting: false });
    try {
      const start = f.orientation();
      f.clock.advance(5000);
      expect(f.orientation()).toEqual(start);
      f.intersecting(true);
      f.clock.advance(1016);
      expect(f.orientation().y - start.y).toBeCloseTo(20.832, 3);
      f.intersecting(false);
      const paused = f.orientation();
      f.clock.advance(12000);
      expect(f.orientation()).toEqual(paused);
      f.intersecting(true);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(paused);
      f.clock.advance(16);
      expect(f.orientation().y).toBeGreaterThan(paused.y);
    } finally { f.close(); }
  });

  it('starts after the administrator preview reveals its initially hidden ancestor', async () => {
    const f = await fixture({ containerHidden: true });
    try {
      const initial = f.orientation();
      f.clock.advance(3000);
      expect(f.orientation()).toEqual(initial);
      expect(f.clock.frames).toBe(0);
      f.win.document.body.style.visibility = 'visible';
      await Promise.resolve();
      f.clock.advance(1016);
      expect(f.orientation().y - initial.y).toBeCloseTo(20.832, 3);
      f.win.document.body.hidden = true;
      await Promise.resolve();
      const hidden = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(hidden);
      expect(f.clock.frames).toBe(0);
      f.win.document.body.hidden = false;
      await Promise.resolve();
      f.clock.advance(32);
      expect(f.orientation().y).toBeGreaterThan(hidden.y);
    } finally { f.close(); }
  });

  it('turns smoothly and holds the requested face for five full seconds after placement', async () => {
    const f = await fixture();
    try {
      f.clock.advance(1000);
      const original = f.orientation();
      f.flip();
      expect(f.orientation()).toEqual(original);
      expect(f.clock.timers).toBe(0);
      f.clock.advance(320);
      const middle = f.orientation();
      expect(middle).not.toEqual(original);
      expect(Math.abs(middle.y % 180)).toBeGreaterThan(1);
      f.clock.advance(completedTurnMs - 320);
      const facing = f.orientation();
      expect(facing.x).toBeCloseTo(0);
      expect(Math.abs(facing.y % 360)).toBeCloseTo(180);
      expect(f.clock.frames).toBe(0);
      expect(f.host.querySelector('[data-crx-flip]').textContent).toBe('Ver anverso');
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.timers).toBe(1);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(facing);
      f.clock.advance(32);
      expect(f.orientation().y - facing.y).toBeCloseTo(.672, 3);
    } finally { f.close(); }
  });

  it('restarts a single inactivity timer on repeated button activations, including native keyboard-generated clicks', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(4000);
      f.host.querySelector('[data-crx-flip]').dispatchEvent(new f.win.MouseEvent('click', { bubbles: true, detail: 0 }));
      expect(f.clock.timers).toBe(0);
      f.clock.advance(completedTurnMs);
      const front = f.orientation();
      expect(front.x).toBeCloseTo(0);
      expect(front.y % 360).toBeCloseTo(0);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(front);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(0);
    } finally { f.close(); }
  });

  it('holds a mouse gesture beyond five seconds, cancels an old timeout, and waits five seconds only after release', async () => {
    const f = await fixture();
    const pointerType = 'mouse';
    try {
      f.flip();
      f.clock.advance(500);
      const before = f.orientation();
      f.pointer('pointerdown', { pointerType });
      expect(f.orientation()).toEqual(before);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointermove', { pointerType, clientX: 140, clientY: 120 });
      const dragged = f.orientation();
      expect(dragged.y - before.y).toBeCloseTo(26);
      expect(dragged.x - before.x).toBeCloseTo(-6);
      f.clock.advance(15000);
      expect(f.orientation()).toEqual(dragged);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointerup', { pointerType, clientX: 140, clientY: 120 });
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(dragged);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(dragged);
      f.clock.advance(32);
      expect(f.orientation().y - dragged.y).toBeCloseTo(.672, 3);
      expect(f.orientation().x).toBe(dragged.x);
    } finally { f.close(); }
  });

  it.each(['touch', 'pen'])('resumes a %s gesture immediately from its exact final orientation without a timer', async pointerType => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(completedTurnMs + 1000);
      expect(f.clock.timers).toBe(1);
      const before = f.orientation();
      f.pointer('pointerdown', { pointerType });
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointermove', { pointerType, clientX: 140, clientY: 120 });
      const dragged = f.orientation();
      expect(dragged.y - before.y).toBeCloseTo(26);
      expect(dragged.x - before.x).toBeCloseTo(-6);
      f.clock.advance(15000);
      expect(f.orientation()).toEqual(dragged);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointerup', { pointerType, clientX: 140, clientY: 120 });
      expect(f.orientation()).toEqual(dragged);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(dragged);
      f.clock.advance(32);
      expect(f.orientation().y - dragged.y).toBeCloseTo(.672, 3);
      expect(f.orientation().x).toBe(dragged.x);
      f.clock.advance(6000);
      expect(f.orientation().y).toBeGreaterThan(dragged.y);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
    } finally { f.close(); }
  });

  it.each(['turning', 'holding'])('a simple touch cancels a button that is %s without creating a release pause or repositioning', async phase => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(phase === 'turning' ? 200 : completedTurnMs + 1000);
      const touched = f.orientation();
      f.pointer('pointerdown', { pointerType: 'touch' });
      expect(f.orientation()).toEqual(touched);
      expect(f.clock.timers).toBe(0);
      f.clock.advance(6000);
      expect(f.orientation()).toEqual(touched);
      f.pointer('pointerup', { pointerType: 'touch' });
      expect(f.orientation()).toEqual(touched);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - touched.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(touched.x);
    } finally { f.close(); }
  });

  it.each(['pointercancel', 'lostpointercapture'])('releases a touch gesture after %s immediately without blocking or creating a restart timer', async eventType => {
    const f = await fixture();
    try {
      f.pointer('pointerdown', { pointerType: 'touch' });
      f.pointer('pointermove', { pointerType: 'touch', clientX: 150 });
      // Capture-loss events need not carry pointerType. Use the original down.
      f.pointer(eventType, { pointerType: undefined });
      const after = f.orientation();
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.pointer('pointerup', { pointerType: 'touch' });
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - after.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(after.x);
      f.pointer('pointerdown', { pointerId: 2 });
      f.pointer('pointermove', { pointerId: 2, clientX: 110 });
      expect(f.orientation().y - after.y).toBeGreaterThan(6);
    } finally { f.close(); }
  });

  it.each(['pointercancel', 'lostpointercapture'])('retains the five-second mouse release wait after %s without duplicating its timer', async eventType => {
    const f = await fixture();
    try {
      f.pointer('pointerdown');
      f.pointer('pointermove', { clientX: 150 });
      const cancelled = f.orientation();
      f.pointer(eventType, { pointerType: undefined });
      expect(f.orientation()).toEqual(cancelled);
      expect(f.clock.timers).toBe(1);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointerup');
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(cancelled);
      f.clock.advance(33);
      expect(f.orientation().y - cancelled.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(cancelled.x);
    } finally { f.close(); }
  });

  it.each([390, 1440])('uses the actual pointer type on a hybrid device at width %i rather than screen size or touch capability', async width => {
    const f = await fixture();
    try {
      Object.defineProperty(f.win, 'innerWidth', { value: width });
      Object.defineProperty(f.win.navigator, 'maxTouchPoints', { value: 5 });
      f.pointer('pointerdown', { pointerType: 'mouse', pointerId: 1 });
      f.pointer('pointerup', { pointerType: 'mouse', pointerId: 1 });
      expect(f.clock.timers).toBe(1);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(2500);
      f.pointer('pointerdown', { pointerType: 'touch', pointerId: 2 });
      f.pointer('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 150 });
      const touched = f.orientation();
      f.pointer('pointerup', { pointerType: 'touch', pointerId: 2 });
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - touched.y).toBeCloseTo(.336, 3);
      f.pointer('pointerdown', { pointerType: 'mouse', pointerId: 3 });
      const mouse = f.orientation();
      f.pointer('pointerup', { pointerType: 'mouse', pointerId: 3 });
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(mouse);
      f.clock.advance(33);
      expect(f.orientation().y - mouse.y).toBeCloseTo(.336, 3);
      expect(f.clock.timers).toBe(0);
    } finally { f.close(); }
  });

  it('resumes a touch gesture on blur when pointer capture is unavailable and no release event supplies a pointer type', async () => {
    const f = await fixture();
    try {
      f.host.querySelector('.crx-stage').setPointerCapture = () => { throw new Error('No capture'); };
      f.pointer('pointerdown', { pointerType: 'touch' });
      f.pointer('pointermove', { pointerType: 'touch', clientX: 150, clientY: 120 });
      const held = f.orientation();
      f.win.dispatchEvent(new f.win.Event('blur'));
      expect(f.orientation()).toEqual(held);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - held.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(held.x);
      f.pointer('pointerup', { pointerType: 'touch' }, f.win);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
    } finally { f.close(); }
  });

  it('uses the same complete five-second face hold for a touch-originated button click', async () => {
    const f = await fixture();
    try {
      Object.defineProperty(f.win, 'innerWidth', { value: 390 });
      Object.defineProperty(f.win.navigator, 'maxTouchPoints', { value: 5 });
      const button = f.host.querySelector('[data-crx-flip]');
      f.pointer('pointerdown', { pointerType: 'touch' }, button);
      f.pointer('pointerup', { pointerType: 'touch' }, button);
      f.flip();
      expect(f.clock.timers).toBe(0);
      f.clock.advance(completedTurnMs);
      const facing = f.orientation();
      expect(Math.abs(facing.y % 360)).toBeCloseTo(180);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(33);
      expect(f.orientation().y - facing.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it('ignores hover, unpressed moves and releases from an unrelated pointer', async () => {
    const f = await fixture();
    try {
      f.clock.advance(1016);
      const spinning = f.orientation();
      f.pointer('pointerenter');
      f.pointer('pointermove', { clientX: 300, clientY: 250 });
      f.clock.advance(1008);
      expect(f.orientation().y - spinning.y).toBeCloseTo(21.168, 3);
      expect(f.clock.timers).toBe(0);
      f.pointer('pointerdown', { pointerId: 2 });
      const held = f.orientation();
      f.pointer('pointerup', { pointerId: 99 });
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(held);
      expect(f.clock.timers).toBe(0);
      f.pointer('pointerup', { pointerId: 2 });
      f.clock.advance(5000);
      f.pointer('pointermove', { clientX: 400 });
      f.clock.advance(2000);
      expect(f.clock.frames).toBe(1);
    } finally { f.close(); }
  });

  it('coordinates rapid face activations and a new drag without competing animation loops or stale timers', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 12; i++) {
        f.flip();
        expect(f.clock.frames).toBeLessThanOrEqual(1);
        expect(f.clock.timers).toBe(0);
        f.clock.advance(75);
      }
      f.pointer('pointerdown');
      f.pointer('pointermove', { clientX: 200 });
      const held = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(held);
      expect(f.clock.frames).toBe(0);
      expect(f.clock.timers).toBe(0);
      f.pointer('pointerup');
      f.clock.advance(5000);
      f.flip();
      f.clock.advance(completedTurnMs);
      const lastFace = f.orientation();
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(lastFace);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(0);
    } finally { f.close(); }
  });

  it('recovers on outside release and window blur when pointer capture is unavailable', async () => {
    const f = await fixture();
    try {
      f.host.querySelector('.crx-stage').setPointerCapture = () => { throw new Error('Pointer no longer active'); };
      f.pointer('pointerdown');
      const held = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(held);
      f.pointer('pointerup', {}, f.win);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(5032);
      expect(f.orientation().y).toBeGreaterThan(held.y);
      f.pointer('pointerdown');
      f.win.dispatchEvent(new f.win.Event('blur'));
      const blurred = f.orientation();
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(blurred);
      f.clock.advance(33);
      expect(f.orientation().y).toBeGreaterThan(blurred.y);
    } finally { f.close(); }
  });

  it('keeps inactivity and animation independent across two simultaneous instances', async () => {
    const f = await fixture();
    let second: any;
    try {
      const secondHost = f.win.document.createElement('div');
      f.win.document.body.append(secondHost);
      second = f.win.CRONOX_METACRILATOS.mount(secondHost, { ...person, circleLevel: 5 });
      await second.ready;
      await Promise.resolve();
      const secondSlab = secondHost.querySelector('.crx-slab');
      const initial = f.orientation(secondSlab);
      expect(f.clock.frames).toBe(2);
      f.flip();
      f.clock.advance(completedTurnMs);
      expect(f.orientation(secondSlab).y).toBeGreaterThan(initial.y);
      const firstPaused = f.orientation();
      secondHost.querySelector('[data-crx-flip]').click();
      expect(f.clock.timers).toBe(1);
      f.clock.advance(completedTurnMs);
      const secondPaused = f.orientation(secondSlab);
      expect(f.clock.timers).toBe(2);
      f.clock.advance(5000 - completedTurnMs - 1);
      expect(f.orientation()).toEqual(firstPaused);
      expect(f.orientation(secondSlab)).toEqual(secondPaused);
      f.clock.advance(33);
      expect(f.orientation().y).toBeGreaterThan(firstPaused.y);
      expect(f.orientation(secondSlab)).toEqual(secondPaused);
      f.instance.destroy();
      expect(f.clock.frames).toBe(0);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(1000);
      expect(f.orientation(secondSlab).y).toBeGreaterThan(secondPaused.y);
      second.destroy();
      expect(f.clock.frames).toBe(0);
      expect(f.clock.timers).toBe(0);
    } finally { second?.destroy(); f.close(); }
  });

  it('keeps the original inactivity deadline through page hiding and resumes without accumulated frame time', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(completedTurnMs + 1000);
      const facing = f.orientation();
      f.hidden(true);
      f.clock.advance(3000);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.hidden(false);
      f.clock.advance(999);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(facing);
      f.hidden(true);
      f.clock.advance(20000);
      expect(f.clock.frames).toBe(0);
      f.hidden(false);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(facing);
      f.clock.advance(16);
      expect(f.orientation().y - facing.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it('does not run an expired inactivity timer while hidden but restarts when visible', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(1000);
      f.hidden(true);
      const facing = f.orientation();
      f.clock.advance(20000);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.hidden(false);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(facing);
      f.clock.advance(16);
      expect(f.orientation().y - facing.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it('treats page hiding during a touch gesture as cancellation and resumes immediately on return without a deadline', async () => {
    const f = await fixture();
    try {
      f.pointer('pointerdown', { pointerType: 'touch' });
      f.pointer('pointermove', { pointerType: 'touch', clientX: 160 });
      const stage = f.host.querySelector('.crx-stage');
      const held = f.orientation();
      expect(stage.hasPointerCapture(1)).toBe(true);
      f.hidden(true);
      expect(stage.hasPointerCapture(1)).toBe(false);
      expect(f.clock.timers).toBe(0);
      f.clock.advance(3000);
      f.hidden(false);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(held);
      f.clock.advance(16);
      expect(f.orientation().y - held.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it.each(['mouse', 'touch', 'pen'])('keeps a held %s gesture in control when the face button is activated', async pointerType => {
    const f = await fixture();
    try {
      f.pointer('pointerdown', { pointerType });
      const held = f.orientation();
      f.flip();
      f.clock.advance(12000);
      expect(f.orientation()).toEqual(held);
      expect(f.clock.frames).toBe(0);
      expect(f.clock.timers).toBe(0);
      f.pointer('pointermove', { pointerType, clientX: 160, clientY: 110 });
      const released = f.orientation();
      f.pointer('pointerup', { pointerType });
      expect(f.orientation()).toEqual(released);
      if (pointerType === 'mouse') {
        expect(f.clock.timers).toBe(1);
        f.clock.advance(4999);
        expect(f.orientation()).toEqual(released);
        expect(f.clock.frames).toBe(0);
        f.clock.advance(1);
      } else expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - released.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(released.x);
    } finally { f.close(); }
  });

  it('preserves an inactivity deadline across pagehide/pageshow lifecycle events', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(completedTurnMs + 1000);
      const facing = f.orientation();
      f.win.dispatchEvent(new f.win.Event('pagehide'));
      f.clock.advance(3000);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      f.win.dispatchEvent(new f.win.Event('pageshow'));
      expect(f.clock.timers).toBe(1);
      f.clock.advance(999);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      f.clock.advance(32);
      expect(f.orientation().y - facing.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it('suspends an unfinished face transition at its rendered angle and starts the five-second hold only on completion', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(200);
      const intermediate = f.orientation();
      f.hidden(true);
      f.clock.advance(2000);
      expect(f.orientation()).toEqual(intermediate);
      expect(f.clock.frames).toBe(0);
      f.hidden(false);
      f.clock.advance(16);
      expect(f.orientation()).toEqual(intermediate);
      f.clock.advance(480);
      const facing = f.orientation();
      expect(Math.abs(facing.y % 360)).toBeCloseTo(180);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(4999);
      expect(f.orientation()).toEqual(facing);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
    } finally { f.close(); }
  });

  it('respects reduced motion at mount and on preference changes while retaining native face and drag controls', async () => {
    const f = await fixture({ reduced: true });
    try {
      const front = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(front);
      expect(f.clock.frames).toBe(0);
      f.flip();
      const back = f.orientation();
      expect(back.x).toBeCloseTo(0);
      expect(Math.abs(back.y % 360)).toBeCloseTo(180);
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(back);
      expect(f.clock.frames).toBe(0);
      f.pointer('pointerdown');
      f.pointer('pointermove', { clientX: 130 });
      f.pointer('pointerup');
      const dragged = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(dragged);
      f.reduced(false);
      f.clock.advance(32);
      expect(f.orientation().y).toBeGreaterThan(dragged.y);
      f.reduced(true);
      const stopped = f.orientation();
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(stopped);
      expect(f.clock.frames).toBe(0);
    } finally { f.close(); }
  });

  it('settles an unfinished button turn immediately when reduced motion becomes active', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(200);
      expect(Math.abs(f.orientation().y % 360)).not.toBeCloseTo(180);
      f.reduced(true);
      const back = f.orientation();
      expect(back.x).toBeCloseTo(0);
      expect(Math.abs(back.y % 360)).toBeCloseTo(180);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(2000);
      f.reduced(false);
      f.clock.advance(2999);
      expect(f.orientation()).toEqual(back);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
    } finally { f.close(); }
  });

  it.each(['touch', 'pen'])('keeps reduced motion respected after an immediate %s release without introducing an idle timer', async pointerType => {
    const f = await fixture({ reduced: true });
    try {
      f.flip();
      expect(f.clock.timers).toBe(1);
      f.pointer('pointerdown', { pointerType });
      f.pointer('pointermove', { pointerType, clientX: 160, clientY: 110 });
      f.pointer('pointerup', { pointerType });
      const dragged = f.orientation();
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(dragged);
      f.reduced(false);
      f.clock.advance(32);
      expect(f.orientation().y - dragged.y).toBeCloseTo(.336, 3);
      expect(f.orientation().x).toBe(dragged.x);
      expect(f.clock.timers).toBe(0);
    } finally { f.close(); }
  });

  it('coalesces geometry resize work without rotating a held card or extending the release deadline', async () => {
    const f = await fixture();
    try {
      f.pointer('pointerdown');
      f.pointer('pointermove', { clientX: 145, clientY: 115 });
      const held = f.orientation();
      const rim = f.host.querySelector('.crx-rim');
      const initialPanel = rim.firstChild;
      const observer = f.resizeObservers[0];
      for (let i = 0; i < 8; i++) observer.callback([]);
      f.win.dispatchEvent(new f.win.Event('resize'));
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(0);
      expect(rim.firstChild).toBe(initialPanel);
      f.clock.advance(16);
      expect(rim.firstChild).not.toBe(initialPanel);
      expect(rim.childElementCount).toBe(68);
      expect(f.orientation()).toEqual(held);
      expect(f.clock.frames).toBe(0);
      f.clock.advance(10000);
      expect(f.orientation()).toEqual(held);
      f.pointer('pointerup');
      f.clock.advance(3000);
      for (let i = 0; i < 8; i++) observer.callback([]);
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(1999);
      expect(f.orientation()).toEqual(held);
      expect(f.clock.frames).toBe(0);
      expect(f.clock.timers).toBe(1);
      f.clock.advance(1);
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(0);
      f.clock.advance(32);
      expect(f.orientation().y - held.y).toBeCloseTo(.336, 3);
    } finally { f.close(); }
  });

  it.each(['update', 'destroy'])('cancels pending geometry work on %s and ignores late callbacks from the disposed scene', async action => {
    const f = await fixture();
    try {
      f.pointer('pointerdown');
      const oldRim = f.host.querySelector('.crx-rim');
      const oldPanel = oldRim.firstChild;
      const oldObserver = f.resizeObservers[0];
      oldObserver.callback([]);
      expect(f.clock.frames).toBe(1);
      if (action === 'update') {
        await f.instance.update({ ...person, circleLevel: 5 });
        await Promise.resolve();
      } else f.instance.destroy();
      expect(oldObserver.disconnected).toBe(true);
      expect(f.clock.frames).toBe(action === 'update' ? 1 : 0);
      oldObserver.callback([]);
      oldObserver.callback([]);
      expect(f.clock.frames).toBe(action === 'update' ? 1 : 0);
      f.clock.advance(32);
      expect(oldRim.firstChild).toBe(oldPanel);
      expect(f.clock.timers).toBe(0);
      if (action === 'update') {
        expect(f.host.querySelectorAll('.crx-rim-panel')).toHaveLength(68);
        f.resizeObservers[1].callback([]);
        expect(f.clock.frames).toBe(2);
        f.instance.destroy();
        expect(f.clock.frames).toBe(0);
      }
    } finally { f.close(); }
  });

  it('cleans timers, frames, captures and old listeners on update, destroy and reopening', async () => {
    const f = await fixture();
    try {
      f.flip();
      f.clock.advance(200);
      const oldSlab = f.slab();
      const oldOrientation = f.orientation(oldSlab);
      const oldStage = f.host.querySelector('.crx-stage');
      const oldButton = f.host.querySelector('[data-crx-flip]');
      await f.instance.update({ ...person, circleLevel: 5 });
      await Promise.resolve();
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      oldButton.click();
      f.pointer('pointerdown', {}, oldStage);
      f.pointer('pointermove', { clientX: 300 }, oldStage);
      f.clock.advance(1000);
      expect(f.orientation(oldSlab)).toEqual(oldOrientation);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(1);
      f.pointer('pointerdown');
      const currentStage = f.host.querySelector('.crx-stage');
      expect(currentStage.hasPointerCapture(1)).toBe(true);
      f.instance.destroy();
      expect(currentStage.hasPointerCapture(1)).toBe(false);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      expect(f.resizeObservers.every(observer => observer.disconnected)).toBe(true);
      expect(f.observers.every(observer => observer.disconnected)).toBe(true);
      f.hidden(true); f.hidden(false); f.reduced(true); f.reduced(false);
      f.win.dispatchEvent(new f.win.Event('resize'));
      f.clock.advance(20000);
      expect(f.clock.timers).toBe(0);
      expect(f.clock.frames).toBe(0);
      expect(f.host.childElementCount).toBe(0);
      await f.reopen();
      const reopened = f.orientation();
      f.clock.advance(1016);
      expect(f.orientation().y - reopened.y).toBeCloseTo(20.832, 3);
      expect(f.clock.frames).toBe(1);
      expect(f.clock.timers).toBe(0);
    } finally { f.close(); }
  });
});
