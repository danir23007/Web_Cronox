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
    getCsrfHeaders: jest.fn().mockResolvedValue({ 'x-csrf-token': 'fixture-only' }),
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
  it('shows SMTP failure truthfully, allows retry and prevents duplicate in-flight submissions', async () => {
    const context = setup();
    try {
      await flush();
      context.auth.resolve(null);
      await flush();
      context.openScheduled();
      const win = context.window;
      const originalFetch = win.fetch;
      const pending = deferred<any>();
      const subscribe = jest.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({
        ok: true, status: 202, json: async () => ({ status: 'accepted' }),
      });
      win.CRONOX_API.getCsrfHeaders = jest.fn().mockResolvedValue({ 'x-csrf-token': 'fixture-only' });
      win.fetch = jest.fn((input: string, init: any) => String(input).includes('/api/newsletter/subscribe') ? subscribe(init) : originalFetch(input, init));
      const input = win.document.querySelector('.newsletter-modal-input');
      const form = win.document.querySelector('.newsletter-modal-form');
      const feedback = win.document.querySelector('.newsletter-modal-feedback');
      input.value = 'controlled@example.test';
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(subscribe.mock.calls[0][0].headers['x-csrf-token']).toBe('fixture-only');
      pending.resolve({ ok: false, status: 503, json: async () => ({ code: 'NEWSLETTER_UNAVAILABLE' }) });
      await flush();
      expect(feedback.textContent).toContain('No hemos podido completar');
      expect(feedback.classList).toContain('newsletter-modal-feedback--error');
      expect(context.visit.dismiss).not.toHaveBeenCalled();
      expect(input.disabled).toBe(false);
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(subscribe).toHaveBeenCalledTimes(2);
      expect(feedback.textContent).toContain('Tu suscripción está activa');
      expect(feedback.textContent).not.toContain('para confirmar');
      expect(feedback.classList).toContain('newsletter-modal-feedback--success');
      expect(win.document.querySelector('.newsletter-modal-overlay').classList).toContain('newsletter-modal-overlay--visible');
    } finally { context.dom.window.close(); }
  });

  it.each([202, 200, 429, 400])('does not accept an unexpected HTTP %s payload as evidence of email delivery', async status => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush(); context.openScheduled();
      const win = context.window;
      const original = win.fetch;
      win.fetch = jest.fn((url: string) => String(url).includes('/api/newsletter/subscribe')
        ? Promise.resolve({ status, ok: status < 300, json: async () => ({}) }) : original(url));
      win.document.querySelector('.newsletter-modal-input').value = 'controlled@example.test';
      win.document.querySelector('.newsletter-modal-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(win.fetch).toHaveBeenCalledWith('/api/newsletter/subscribe', expect.any(Object));
      expect(win.document.querySelector('.newsletter-modal-feedback').classList).toContain('newsletter-modal-feedback--error');
      expect(context.visit.dismiss).not.toHaveBeenCalled();
    } finally { context.dom.window.close(); }
  });

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
