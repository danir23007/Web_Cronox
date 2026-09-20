import path from 'node:path';

const modulePath = path.resolve(
  __dirname,
  '../../../cronox-front/assets/newsletter-visit.js',
);

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

describe('Newsletter visit timing', () => {
  const api = require(modulePath);
  let session: MemoryStorage;
  let local: MemoryStorage;
  let now: number;

  beforeEach(() => {
    jest.useFakeTimers();
    session = new MemoryStorage();
    local = new MemoryStorage();
    now = 1_000_000;
  });
  afterEach(() => jest.useRealTimers());

  const create = () =>
    api.create({
      hasConsent: () => true,
      sessionStorage: session,
      localStorage: local,
      now: () => now,
      setTimeout,
      clearTimeout,
    });

  it('opens at 5500ms only once and never reopens after 40 minutes in the same visit', () => {
    const visit = create();
    const open = jest.fn(() => visit.markShown());
    expect(visit.schedule(open)).toBe(true);
    jest.advanceTimersByTime(5_000);
    expect(open).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(open).toHaveBeenCalledTimes(1);
    now += 40 * 60 * 1000;
    expect(visit.schedule(open)).toBe(false);
    jest.advanceTimersByTime(40 * 60 * 1000);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('deduplicates initialization and honors the 20-minute dismissal boundary', () => {
    const visit = create();
    const open = jest.fn();
    expect(visit.schedule(open)).toBe(true);
    expect(visit.schedule(open)).toBe(false);
    visit.cancel();
    visit.dismiss();

    now += 3 * 60 * 1000;
    expect(create().eligible()).toBe(false);
    now += 16 * 60 * 1000 + 59_000;
    expect(create().eligible()).toBe(false);
    now += 1_000;
    const later = create();
    expect(later.eligible()).toBe(true);
    later.schedule(open);
    jest.advanceTimersByTime(5_499);
    expect(open).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('uses the session marker on refresh and avoids storage without consent', () => {
    const visit = create();
    visit.markShown();
    expect(create().eligible()).toBe(false);
    const privateSession = new MemoryStorage();
    const noConsent = api.create({
      hasConsent: () => false,
      sessionStorage: privateSession,
      localStorage: local,
    });
    noConsent.markShown();
    noConsent.dismiss();
    expect(privateSession.values.size).toBe(0);
  });
});
