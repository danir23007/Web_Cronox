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
  it('keeps voluntary subscription working and suppresses automatic prompts after success', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const win = context.window;
      const original = win.fetch;
      win.fetch = jest.fn((url: string) => String(url).includes('/api/newsletter/subscribe')
        ? Promise.resolve({ status: 202, ok: true, json: async () => ({ status: 'accepted', confirmation: 'welcome' }) }) : original(url));
      const footer = win.document.querySelector('.footer-newsletter-form');
      footer.querySelector('input').value = 'controlled@example.test';
      footer.dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(context.visit.markShown).toHaveBeenCalledTimes(1);
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Bienvenido a Cronox');
      win.document.querySelector('.newsletter-modal-done').click();
      context.openScheduled();
      expect(win.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
    } finally { context.dom.window.close(); }
  });

  it('rechecks the session guard when retrying behind another modal', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const blocker = context.window.document.createElement('div');
      blocker.id = 'authOverlay'; blocker.className = 'is-open';
      context.window.document.body.append(blocker);
      context.openScheduled();
      context.visit.eligible.mockReturnValue(false);
      blocker.remove();
      await new Promise(resolve => setTimeout(resolve, 550));
      expect(context.visit.markShown).not.toHaveBeenCalled();
      expect(context.window.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
      expect(context.visit.cancel).toHaveBeenCalled();
    } finally { context.dom.window.close(); }
  });

  it.each([true, false])('blocks subscribed=%s authenticated visitors', async subscribed => {
    const context = setup();
    try {
      await flush();
      context.auth.resolve({ id: 1, role: 'USER', newsletterSubscribed: subscribed });
      await flush();
      expect(context.visit.schedule).not.toHaveBeenCalled();
      expect(context.window.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
    } finally { context.dom.window.close(); }
  });

  it('rejects a stale timer callback after login before its deadline', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      context.window.CRONOX_AUTH_STATE = 'authenticated';
      context.window.CRONOX_USER = { role: 'USER' };
      context.window.dispatchEvent(new context.window.CustomEvent('cronox:userChanged', { detail: context.window.CRONOX_USER }));
      context.openScheduled();
      expect(context.visit.cancel).toHaveBeenCalled();
      expect(context.visit.markShown).not.toHaveBeenCalled();
      expect(context.window.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
    } finally { context.dom.window.close(); }
  });

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
        ok: true, status: 202, json: async () => ({ status: 'accepted', httpStatus: 202 }),
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
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Bienvenido a Cronox');
      expect(win.document.querySelector('.newsletter-modal-result-copy').textContent).toBe('Has activado tu cuenta. Consulta tu correo para conocer las novedades de Cronox y poder disfrutar del código de 10% en tu próxima compra.');
      expect(win.document.querySelector('.newsletter-modal-result-mark')).toBeNull();
      expect(form.hidden).toBe(true);
      expect(win.document.querySelector('.newsletter-modal-result').hidden).toBe(false);
      expect(win.document.activeElement).toBe(win.document.querySelector('.newsletter-modal-title'));
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
