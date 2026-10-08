import path from 'node:path';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const modulePath = path.resolve(__dirname, '../../../cronox-front/assets/newsletter-visit.js');

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe('Newsletter session display guard', () => {
  const api = require(modulePath);
  let session: MemoryStorage;
  beforeEach(() => { jest.useFakeTimers(); session = new MemoryStorage(); });
  afterEach(() => jest.useRealTimers());
  const create = () => api.create({ sessionStorage: session, setTimeout, clearTimeout });

  it('records the first display immediately and blocks reloads without consent or dismissal', () => {
    const visit = create();
    const open = jest.fn(() => visit.markShown());
    expect(visit.schedule(open)).toBe(true);
    jest.advanceTimersByTime(5499);
    expect(open).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(session.getItem(api.SESSION_KEY)).toBe('true');
    expect(create().eligible()).toBe(false);
    expect(create().schedule(open)).toBe(false);
    visit.dismiss();
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(create().eligible()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('allows a new independent session regardless of an old local cooldown', () => {
    create().markShown();
    const fresh = api.create({ sessionStorage: new MemoryStorage(), localStorage: { getItem: () => String(Date.now()) } });
    expect(fresh.eligible()).toBe(true);
  });

  it('deduplicates scheduling, cancels on display and rechecks storage at the timer boundary', () => {
    const first = create();
    const open = jest.fn();
    expect(first.schedule(open)).toBe(true);
    expect(first.schedule(open)).toBe(false);
    create().markShown();
    jest.advanceTimersByTime(5500);
    expect(open).not.toHaveBeenCalled();
    expect(first.hasPending()).toBe(false);
    session = new MemoryStorage();
    const other = create();
    other.schedule(open);
    other.markShown();
    expect(other.hasPending()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps one shared controller and pending timer when the shared script is initialized again', () => {
    const dom = new JSDOM('', { url: 'https://example.test', runScripts: 'outside-only' });
    const win = dom.window as any;
    try {
      win.setTimeout = jest.fn(setTimeout);
      win.clearTimeout = clearTimeout;
      const source = readFileSync(modulePath, 'utf8');
      win.eval(source);
      const first = win.CRONOX_NEWSLETTER_VISIT.create();
      const open = jest.fn(() => first.markShown());
      first.schedule(open);
      win.eval(source);
      const second = win.CRONOX_NEWSLETTER_VISIT.create();
      expect(second).toBe(first);
      expect(second.schedule(open)).toBe(false);
      expect(win.setTimeout).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(5500);
      expect(open).toHaveBeenCalledTimes(1);
      expect(first.hasPending()).toBe(false);
    } finally { dom.window.close(); }
  });

  it('retains an in-memory fallback if browser storage throws', () => {
    const visit = api.create({ sessionStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
    expect(visit.eligible()).toBe(true);
    expect(() => visit.markShown()).not.toThrow();
    expect(visit.eligible()).toBe(false);
  });
});
