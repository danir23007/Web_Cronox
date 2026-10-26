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
  window.TextEncoder = TextEncoder;
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
    logout: jest.fn().mockResolvedValue(undefined),
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
  it('does not move focus away from a field completed before the opening timer', async () => {
    const { dom, window, auth } = setup();
    try {
      auth.resolve(null);
      await flush();
      await window.CRONOX_openAuthModal('register');
      const password = window.document.querySelector('#authRegisterPassword');
      password.focus();
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(window.document.activeElement).toBe(password);
      window.CRONOX_closeAuthModal();
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(window.document.activeElement).not.toBe(window.document.querySelector('#authRegisterEmail'));
    } finally { dom.window.close(); }
  });
  it('keeps newsletter copy consistent with required registration and preserves privacy links', () => {
    for (const file of ['index.html', 'sobre-cronox.html', 'auth-modal.html', 'assets/newsletter-renderer.js', 'assets/app.js']) {
      expect(read(file)).not.toMatch(/cuenta.{0,60}opcional|(?:si quieres|si lo deseas).{0,60}cuenta/i);
    }
    for (const file of ['index.html', 'sobre-cronox.html']) {
      const dom = new JSDOM(read(file));
      const legal = dom.window.document.querySelector('.footer-newsletter-legal');
      expect(legal?.textContent?.trim().replace(/\s+/g, ' ')).toBe('Al suscribirte aceptas los Términos y la Política de privacidad de CRONOX.');
      expect(legal?.querySelector('a[href="/privacidad"]')).not.toBeNull();
      dom.window.close();
    }
  });

  it.each([false, true])('reuses an authenticated account (already subscribed=%s), waits for persistence and blocks duplicate submissions', async subscribed => {
    const context = setup();
    try {
      await flush(); context.auth.resolve({ id: 7, email: 'member@example.test', role: 'USER', newsletterSubscribed: subscribed }); await flush();
      const win = context.window, pending = deferred<any>(), original = win.fetch;
      win.CRONOX_API.register = jest.fn(); win.CRONOX_API.login = jest.fn();
      const complete = jest.fn().mockReturnValue(pending.promise);
      win.fetch = jest.fn((url: string, init: any) => String(url).endsWith('/complete-registration') ? complete(init) : original(url, init));
      const footer = win.document.querySelector('.footer-newsletter-form');
      footer.querySelector('input').value = 'MEMBER@example.test';
      footer.dispatchEvent(new win.Event('submit', { cancelable: true }));
      footer.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(complete).toHaveBeenCalledTimes(1);
      expect(JSON.parse(complete.mock.calls[0][0].body)).toEqual({ email: 'member@example.test' });
      expect(win.document.querySelector('.newsletter-modal-title').textContent).not.toBe('Suscripción completada');
      expect(win.document.getElementById('authOverlay').classList).not.toContain('is-open');
      pending.resolve({ ok: true, json: async () => ({ status: 'subscribed' }) }); await flush();
      expect(win.CRONOX_API.register).not.toHaveBeenCalled();
      expect(win.CRONOX_API.login).not.toHaveBeenCalled();
      expect(win.CRONOX_USER.id).toBe(7);
      expect(win.CRONOX_USER.newsletterSubscribed).toBe(true);
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Suscripción completada');
      expect(win.fetch.mock.calls.some(([url]: [string]) => String(url).endsWith('/start-registration'))).toBe(false);
    } finally { context.dom.window.close(); }
  });

  it('blocks a different email for an authenticated account without switching identity or creating consent', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve({ id: 7, email: 'member@example.test', role: 'USER' }); await flush();
      const win = context.window, footer = win.document.querySelector('.footer-newsletter-form');
      footer.querySelector('input').value = 'other@example.test';
      footer.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.document.querySelector('.newsletter-modal-feedback').textContent).toContain('correo de tu cuenta actual');
      expect(win.fetch.mock.calls.some(([url]: [string]) => /\/(start-registration|complete-registration|subscribe)$/.test(url))).toBe(false);
      expect(win.CRONOX_USER.id).toBe(7);
      expect(win.document.getElementById('authOverlay').classList).not.toContain('is-open');
    } finally { context.dom.window.close(); }
  });

  it('retains authenticated consent input for retry after persistence failure and does not reopen a dismissed popup', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve({ id: 7, email: 'member@example.test', role: 'USER', newsletterSubscribed: false }); await flush();
      const win = context.window, original = win.fetch, pending = deferred<any>();
      win.console.error = jest.fn();
      const complete = jest.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }).mockImplementationOnce(() => pending.promise);
      win.fetch = jest.fn((url: string, init: any) => String(url).endsWith('/complete-registration') ? complete(init) : original(url, init));
      const footer = win.document.querySelector('.footer-newsletter-form');
      footer.querySelector('input').value = 'member@example.test';
      footer.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_USER.newsletterSubscribed).toBe(false);
      expect(win.document.querySelector('.newsletter-modal-feedback--error')).not.toBeNull();
      expect(win.document.querySelector('.newsletter-modal-input').value).toBe('member@example.test');
      win.document.querySelector('.newsletter-modal-form').dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      win.document.querySelector('.newsletter-modal-close').click();
      pending.resolve({ ok: true, json: async () => ({ status: 'subscribed' }) }); await flush();
      expect(complete).toHaveBeenCalledTimes(2);
      expect(win.CRONOX_USER.newsletterSubscribed).toBe(true);
      expect(win.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
    } finally { context.dom.window.close(); }
  });

  it('keeps registration open and anonymous while mailbox verification is required', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const win = context.window;
      win.TextEncoder = TextEncoder;
      win.CRONOX_API.register = jest.fn().mockResolvedValue({ verificationRequired: true, message: 'Comprueba tu correo para verificar la cuenta.' });
      await win.CRONOX_openAuthModal('register');
      for (const [id, value] of Object.entries({ authRegisterFirstName: 'Persona', authRegisterLastName: 'Ficticia', authRegisterEmail: 'member@example.test', authRegisterPassword: 'ValidPassword1' })) win.document.getElementById(id).value = value;
      win.document.getElementById('authRegisterForm').dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(win.CRONOX_API.register).toHaveBeenCalledTimes(1);
      expect(win.CRONOX_AUTH_STATE).toBe('anonymous');
      expect(win.CRONOX_USER).toBeFalsy();
      expect(win.document.getElementById('authOverlay').classList.contains('is-open')).toBe(true);
      expect(win.document.getElementById('authMessage').textContent).toContain('Comprueba tu correo');
    } finally { context.dom.window.close(); }
  });
  it.each(['unavailable', 'failed'])('preserves identity and private state after %s logout', async kind => {
    const context = setup();
    try {
      await flush(); context.auth.resolve({ id: 7 }); await flush();
      const win = context.window;
      win.alert = jest.fn();
      win.sessionStorage.setItem('account-private-cache', 'retained');
      if (kind === 'unavailable') delete win.CRONOX_API.logout;
      else win.CRONOX_API.logout.mockRejectedValue(new Error('temporary outage'));
      await win.CRONOX_logout();
      expect(win.CRONOX_USER.id).toBe(7);
      expect(win.sessionStorage.getItem('account-private-cache')).toBe('retained');
      expect(win.alert).toHaveBeenCalledWith(expect.stringContaining('Inténtalo de nuevo'));
    } finally { context.dom.window.close(); }
  });
  it('preserves the consumed automatic appearance across logout and the next page controller', async () => {
    const context = setup();
    context.window.console.error = jest.fn();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const win = context.window;
      win.sessionStorage.setItem('cronoxNewsletterShown', 'true');
      win.sessionStorage.setItem('account-private-cache', 'old');
      await win.CRONOX_logout();
      expect(win.sessionStorage.getItem('cronoxNewsletterShown')).toBe('true');
      expect(win.sessionStorage.getItem('account-private-cache')).toBeNull();
      delete win.CRONOX_NEWSLETTER_VISIT;
      win.eval(read('assets/newsletter-visit.js'));
      expect(win.CRONOX_NEWSLETTER_VISIT.create().eligible()).toBe(false);
    } finally { context.dom.window.close(); }
  });
  it('opens required registration and suppresses repeated automatic prompts without claiming completion', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const win = context.window;
      const original = win.fetch;
      win.fetch = jest.fn((url: string) => String(url).includes('/api/newsletter/start-registration')
        ? Promise.resolve({ status: 200, ok: true, json: async () => ({ status: 'registration_required' }) }) : original(url));
      const footer = win.document.querySelector('.footer-newsletter-form');
      footer.querySelector('input').value = 'controlled@example.test';
      footer.dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(context.visit.markShown).toHaveBeenCalledTimes(1);
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Completa tu suscripción');
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

  it('shows persistence failure truthfully, allows retry and prevents duplicate in-flight submissions', async () => {
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
        ok: true, status: 200, json: async () => ({ status: 'registration_required' }),
      });
      win.CRONOX_API.getCsrfHeaders = jest.fn().mockResolvedValue({ 'x-csrf-token': 'fixture-only' });
      win.fetch = jest.fn((input: string, init: any) => String(input).includes('/api/newsletter/start-registration') ? subscribe(init) : originalFetch(input, init));
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
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Completa tu suscripción');
      expect(win.document.querySelector('.newsletter-modal-result-copy').textContent).toContain('Completa tu cuenta');
      expect(win.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
      expect(win.document.getElementById('authOverlay').classList).toContain('is-open');
      expect(win.document.getElementById('authRegisterEmail').hidden).toBe(true);
      expect(win.document.getElementById('authRegisterFirstName').hidden).toBe(false);
    } finally { context.dom.window.close(); }
  });

  it.each([202, 200, 429, 400])('does not accept an unexpected HTTP %s payload as evidence of email delivery', async status => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush(); context.openScheduled();
      const win = context.window;
      const original = win.fetch;
      win.fetch = jest.fn((url: string) => String(url).includes('/api/newsletter/start-registration')
        ? Promise.resolve({ status, ok: status < 300, json: async () => ({}) }) : original(url));
      win.document.querySelector('.newsletter-modal-input').value = 'controlled@example.test';
      win.document.querySelector('.newsletter-modal-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(win.fetch).toHaveBeenCalledWith('/api/newsletter/start-registration', expect.any(Object));
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

  it('recovers a failed initial read online without presenting a login form or losing a valid identity', async () => {
    const context = setup();
    context.window.console.warn = jest.fn();
    try {
      await flush(); context.auth.reject(new Error('temporary outage')); await flush();
      const win = context.window;
      expect(win.document.getElementById('profileBtn').dataset.authState).toBe('unknown');
      win.CRONOX_API.getMe.mockResolvedValue({ id: 7, role: 'USER' });
      win.dispatchEvent(new win.Event('online')); await flush();
      expect(win.CRONOX_AUTH_STATE).toBe('authenticated');
      expect(win.document.getElementById('profileBtn').dataset.authState).toBe('logged');
      win.CRONOX_API.getMe.mockRejectedValue(new Error('another outage'));
      await win.CRONOX_refreshAuthState();
      expect(win.CRONOX_USER.id).toBe(7);
      expect(win.CRONOX_AUTH_STATE).toBe('authenticated');
      win.dispatchEvent(new win.CustomEvent('cronox:session-ended'));
      expect(win.CRONOX_AUTH_STATE).toBe('anonymous');
    } finally { context.dom.window.close(); }
  });

  it('does not reopen a login form when the initial session lookup is still unresolved', async () => {
    const context = setup();
    try {
      await flush();
      context.window.document.getElementById('profileBtn').click();
      await flush();
      expect(context.window.document.getElementById('authOverlay').classList.contains('is-open')).toBe(false);
      context.auth.resolve({ id: 7, role: 'USER' }); await flush();
      expect(context.window.CRONOX_USER.id).toBe(7);
      expect(context.window.document.getElementById('authOverlay').classList.contains('is-open')).toBe(false);
    } finally { context.dom.window.close(); }
  });

  it('discards an anonymous response started before another tab logged in', async () => {
    const context = setup();
    try {
      await flush();
      const win = context.window;
      win.CRONOX_API.getMe.mockResolvedValue({ id: 7, role: 'USER' });
      win.dispatchEvent(new win.CustomEvent('cronox:session-check'));
      context.auth.resolve(null); await flush();
      expect(win.CRONOX_AUTH_STATE).toBe('authenticated');
      expect(win.CRONOX_USER.id).toBe(7);
    } finally { context.dom.window.close(); }
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


describe('newsletter continuation reuses normal registration', () => {
  it('does not reopen registration when subscription finishes after the user closes the popup', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush(); context.openScheduled();
      const win = context.window, original = win.fetch, accepted = deferred<any>();
      win.fetch = jest.fn((url: string, init: any) => String(url).includes('/api/newsletter/start-registration') ? accepted.promise : original(url, init));
      win.document.querySelector('.newsletter-modal-input').value = 'closed@example.test';
      win.document.querySelector('.newsletter-modal-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      win.document.querySelector('.newsletter-modal-close').click();
      accepted.resolve({ status: 200, ok: true, json: async () => ({ status: 'registration_required' }) });
      await flush();
      expect(win.document.getElementById('authOverlay').classList).not.toContain('is-open');
      expect(win.document.querySelector('.newsletter-modal-overlay').classList).not.toContain('newsletter-modal-overlay--visible');
      expect(win.CRONOX_AUTH_STATE).toBe('anonymous');
    } finally { context.dom.window.close(); }
  });

  const subscribe = async (context: ReturnType<typeof setup>, confirmation = 'subscribed', footer = false) => {
    await flush(); context.auth.resolve(null); await flush();
    const win = context.window, original = win.fetch;
    win.fetch = jest.fn((url: string, init: any) => String(url).includes('/api/newsletter/start-registration')
      ? Promise.resolve({ status: 200, ok: true, json: async () => ({ status: confirmation === 'existing_account' ? 'authentication_required' : 'registration_required' }) }) : original(url, init));
    if (footer) {
      const form = win.document.querySelector('.footer-newsletter-form');
      form.querySelector('input').value = 'member@example.test';
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
    } else {
      context.openScheduled();
      win.document.querySelector('.newsletter-modal-input').value = 'member@example.test';
      win.document.querySelector('.newsletter-modal-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
    }
    await flush();
  };

  it.each([false, true])('passes the accepted email invisibly from footer=%s, ignores double submit and creates a normal session', async footer => {
    const context = setup();
    try {
      await subscribe(context, 'subscribed', footer);
      const win = context.window, pending = deferred<any>();
      win.CRONOX_API.register = jest.fn(() => pending.promise);
      const form = win.document.getElementById('authRegisterForm');
      expect(form.classList).toContain('is-active');
      for (const id of ['authRegisterEmail', 'authRegisterLastName']) {
        expect(win.document.getElementById(id).hidden).toBe(true);
        expect(win.document.getElementById(id).disabled).toBe(true);
      }
      win.document.getElementById('authRegisterFirstName').value = 'Persona';
      win.document.getElementById('authRegisterPassword').value = 'ValidPassword1!';
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      await flush();
      expect(win.CRONOX_API.register).toHaveBeenCalledTimes(1);
      expect(win.CRONOX_API.register).toHaveBeenCalledWith({ firstName: 'Persona', email: 'member@example.test', password: 'ValidPassword1!', registrationSource: 'newsletter' });
      pending.resolve({ id: 1, email: 'member@example.test', role: 'USER', newsletterSubscribed: true });
      await flush();
      expect(win.CRONOX_AUTH_STATE).toBe('authenticated');
      expect(win.document.getElementById('authOverlay').classList).not.toContain('is-open');
    } finally { context.dom.window.close(); }
  });

  it('offers only normal login/recovery for an existing account without calling registration or authenticating', async () => {
    const context = setup();
    try {
      await subscribe(context, 'existing_account');
      const win = context.window;
      win.CRONOX_API.register = jest.fn();
      expect(win.document.getElementById('authLoginForm').classList).toContain('is-active');
      expect(win.document.getElementById('authLoginEmail').value).toBe('member@example.test');
      expect(win.document.querySelector('[data-auth-switch="register"]').hidden).toBe(true);
      expect(win.document.querySelector('[data-auth-forgot]')).not.toBeNull();
      expect(win.CRONOX_API.register).not.toHaveBeenCalled();
      expect(win.CRONOX_AUTH_STATE).toBe('anonymous');
    } finally { context.dom.window.close(); }
  });

  it('closing never submits consent or creates an account and restores ordinary registration fields', async () => {
    const context = setup();
    try {
      await subscribe(context);
      const win = context.window;
      win.CRONOX_API.register = jest.fn();
      win.document.getElementById('authCloseBtn').click();
      expect(win.CRONOX_API.register).not.toHaveBeenCalled();
      expect(win.fetch.mock.calls.filter(([url]: [string]) => url.includes('/start-registration'))).toHaveLength(1);
      expect(win.fetch.mock.calls.some(([url]: [string]) => /\/(subscribe|complete-registration)$/.test(url))).toBe(false);
      await win.CRONOX_openAuthModal('register');
      for (const id of ['authRegisterEmail', 'authRegisterLastName']) {
        expect(win.document.getElementById(id).hidden).toBe(false);
        expect(win.document.getElementById(id).disabled).toBe(false);
      }
    } finally { context.dom.window.close(); }
  });

  it('requires authenticated subscription persistence before showing completion, retains login for retry and ignores double click', async () => {
    const context = setup();
    try {
      await subscribe(context, 'existing_account');
      const win = context.window, original = win.fetch, pending = deferred<any>();
      win.console.error = jest.fn();
      win.CRONOX_API.login = jest.fn().mockResolvedValue({ id: 7, role: 'USER', email: 'member@example.test' });
      const complete = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, json: async () => ({ status: 'subscribed' }) });
      win.fetch = jest.fn((url: string, init: any) => String(url).endsWith('/complete-registration') ? complete(init) : original(url, init));
      const form = win.document.getElementById('authLoginForm');
      win.document.getElementById('authLoginPassword').value = 'ValidPassword1';
      form.dispatchEvent(new win.Event('submit', { cancelable: true }));
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.login).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(1);
      pending.resolve({ ok: false, status: 503, json: async () => ({}) }); await flush();
      expect(win.document.getElementById('authOverlay').classList).toContain('is-open');
      expect(win.document.getElementById('authLoginEmail').value).toBe('member@example.test');
      expect(win.document.getElementById('authMessage').textContent).toContain('no hemos podido guardar');
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(complete).toHaveBeenCalledTimes(2);
      expect(win.document.querySelector('.newsletter-modal-title').textContent).toBe('Suscripción completada');
      expect(win.CRONOX_USER.newsletterSubscribed).toBe(true);
    } finally { context.dom.window.close(); }
  });

  it('does not subscribe a different login address or a closed login flow', async () => {
    const context = setup();
    try {
      await subscribe(context, 'existing_account');
      const win = context.window, pending = deferred<any>();
      win.CRONOX_API.login = jest.fn(() => pending.promise);
      const form = win.document.getElementById('authLoginForm');
      win.document.getElementById('authLoginEmail').value = 'other@example.test';
      win.document.getElementById('authLoginPassword').value = 'ValidPassword1';
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.login).not.toHaveBeenCalled();
      win.document.getElementById('authLoginEmail').value = 'member@example.test';
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      win.CRONOX_closeAuthModal();
      pending.resolve({ id: 7, role: 'USER', email: 'member@example.test' }); await flush();
      expect(win.fetch.mock.calls.some(([url]: [string]) => url.endsWith('/complete-registration'))).toBe(false);
      expect(win.document.getElementById('authOverlay').classList).not.toContain('is-open');
    } finally { context.dom.window.close(); }
  });

  it('restores tab-local recovery intent only as an explicit login action; checkout access remains separate', async () => {
    const context = setup();
    try {
      await flush(); context.auth.resolve(null); await flush();
      const win = context.window;
      win.sessionStorage.setItem('cronoxNewsletterRecovery', JSON.stringify({ email: 'member@example.test', createdAt: Date.now() }));
      await win.CRONOX_openAuthModal('login');
      expect(win.document.getElementById('authLoginEmail').value).toBe('member@example.test');
      expect(win.document.getElementById('authContextNotice').textContent).toContain('completar la suscripción');
      expect(win.sessionStorage.getItem('cronoxNewsletterRecovery')).toBeNull();
      expect(win.fetch.mock.calls.some(([url]: [string]) => url.endsWith('/complete-registration'))).toBe(false);
      win.CRONOX_closeAuthModal();
      await win.CRONOX_openAuthModal('login', { newsletterEmail: 'purchase@example.test', accountExists: true });
      win.CRONOX_API.login = jest.fn().mockResolvedValue({ id: 8, role: 'USER', email: 'purchase@example.test' });
      win.document.getElementById('authLoginPassword').value = 'ValidPassword1';
      win.document.getElementById('authLoginForm').dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.login).toHaveBeenCalledTimes(1);
      expect(win.fetch.mock.calls.some(([url]: [string]) => url.endsWith('/complete-registration'))).toBe(false);
    } finally { context.dom.window.close(); }
  });

  it('validates names/passwords and retains all inputs after connection errors for retry', async () => {
    const context = setup();
    try {
      await subscribe(context);
      const win = context.window;
      win.console.error = jest.fn();
      win.CRONOX_API.register = jest.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue({ id: 2 });
      const form = win.document.getElementById('authRegisterForm'), name = win.document.getElementById('authRegisterFirstName'), password = win.document.getElementById('authRegisterPassword');
      name.value = '123'; password.value = 'ValidPassword1';
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.register).not.toHaveBeenCalled();
      name.value = 'Persona'; password.value = 'short';
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.register).not.toHaveBeenCalled();
      password.value = 'ValidPassword1';
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.document.getElementById('authMessage').textContent).toContain('conexión');
      expect(name.value).toBe('Persona'); expect(password.value).toBe('ValidPassword1');
      expect(win.document.getElementById('authRegisterEmail').value).toBe('member@example.test');
      expect(form.querySelector('button[type="submit"]').disabled).toBe(false);
      form.dispatchEvent(new win.Event('submit', { cancelable: true })); await flush();
      expect(win.CRONOX_API.register).toHaveBeenCalledTimes(2);
    } finally { context.dom.window.close(); }
  });
});
