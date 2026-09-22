/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const setup = () => {
  const dom = new JSDOM(read('index.html'), {
    runScripts: 'outside-only',
    url: 'https://example.test/',
  });
  const window = dom.window as any;
  const auth = deferred<any>();
  let scheduled: (() => void) | null = null;
  const visit = {
    eligible: jest.fn(() => true),
    markShown: jest.fn(),
    dismiss: jest.fn(),
    schedule: jest.fn((callback: () => void) => {
      scheduled = callback;
      return true;
    }),
    cancel: jest.fn(),
    hasPending: jest.fn(() => Boolean(scheduled)),
    wasShown: jest.fn(() => false),
  };
  window.requestAnimationFrame = (callback: () => void) => callback();
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    addListener() {},
  });
  window.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.CRONOX_NEWSLETTER_VISIT = { create: () => visit };
  window.CRONOX_MEDIA_GEOMETRY = { apply: jest.fn() };
  window.CRONOX_COOKIE_CONSENT = { hasConsent: () => false };
  window.CRONOX_API = {
    API_BASE: '',
    getMe: jest.fn(() => auth.promise),
    getCart: jest.fn().mockResolvedValue({ items: [], itemsCount: 0 }),
  };
  window.fetch = jest.fn(async (input: string) => {
    const url = String(input);
    if (url.includes('auth-modal.html')) {
      return { ok: true, text: async () => read('auth-modal.html') };
    }
    if (url.includes('/api/newsletter/config')) {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/api/me')) return { ok: false, status: 401 };
    return { ok: true, json: async () => [] };
  });
  window.eval(read('assets/newsletter-renderer.js'));
  window.eval(read('assets/app.js'));
  return {
    dom,
    window,
    auth,
    visit,
    openScheduled: () => scheduled?.(),
  };
};

describe('public newsletter authoritative authentication gate', () => {
  it.each(['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN'])(
    'never schedules or shows for a restored %s session',
    async (role) => {
      const context = setup();
      try {
        await flush();
        expect(context.window.CRONOX_AUTH_STATE).toBe('unknown');
        expect(context.visit.schedule).not.toHaveBeenCalled();
        context.auth.resolve({ id: 1, email: 'member@example.test', role });
        await flush();
        expect(context.window.CRONOX_AUTH_STATE).toBe('authenticated');
        expect(context.visit.schedule).not.toHaveBeenCalled();
        expect(
          context.window.document.querySelector('.newsletter-modal-overlay')
            .classList,
        ).not.toContain('newsletter-modal-overlay--visible');
      } finally {
        context.dom.window.close();
      }
    },
  );

  it('keeps the popup hidden while recovery fails instead of assuming anonymity', async () => {
    const context = setup();
    context.window.console.warn = jest.fn();
    try {
      await flush();
      context.auth.reject(new Error('network'));
      await flush();
      expect(context.window.CRONOX_AUTH_STATE).toBe('unknown');
      expect(context.visit.schedule).not.toHaveBeenCalled();
    } finally {
      context.dom.window.close();
    }
  });

  it('preserves the anonymous schedule and opens only after confirmed anonymity', async () => {
    const context = setup();
    try {
      await flush();
      expect(context.visit.schedule).not.toHaveBeenCalled();
      context.auth.resolve(null);
      await flush();
      expect(context.window.CRONOX_AUTH_STATE).toBe('anonymous');
      expect(context.visit.schedule).toHaveBeenCalledTimes(1);
      context.openScheduled();
      expect(
        context.window.document.querySelector('.newsletter-modal-overlay')
          .classList,
      ).toContain('newsletter-modal-overlay--visible');
    } finally {
      context.dom.window.close();
    }
  });

  it('cancels a pending timer and closes an open popup on authentication', async () => {
    const context = setup();
    try {
      await flush();
      context.auth.resolve(null);
      await flush();
      context.openScheduled();
      const overlay = context.window.document.querySelector(
        '.newsletter-modal-overlay',
      );
      expect(overlay.classList).toContain('newsletter-modal-overlay--visible');
      context.window.CRONOX_AUTH_STATE = 'authenticated';
      context.window.CRONOX_USER = { role: 'USER' };
      context.window.dispatchEvent(
        new context.window.CustomEvent('cronox:userChanged', {
          detail: context.window.CRONOX_USER,
        }),
      );
      expect(context.visit.cancel).toHaveBeenCalled();
      expect(overlay.classList).not.toContain(
        'newsletter-modal-overlay--visible',
      );
      expect(overlay.getAttribute('aria-hidden')).toBe('true');
    } finally {
      context.dom.window.close();
    }
  });
});
