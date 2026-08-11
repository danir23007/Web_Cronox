import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const consentSource = readFileSync(
  path.join(frontendRoot, 'assets/cookie-consent.js'),
  'utf8',
);

interface ConsentRecord {
  necessary: boolean;
  preferences: boolean;
  analytics: boolean;
  marketing: boolean;
  consentVersion: string;
  timestamp: string;
}

interface ConsentApi {
  getConsent(): ConsentRecord | null;
  hasConsent(category: string): boolean;
  save(selection: Partial<ConsentRecord>): ConsentRecord;
  acceptAll(): ConsentRecord;
  rejectAll(): ConsentRecord;
  registerService(service: {
    id: string;
    category: string;
    load: () => void;
    disable: () => void;
  }): () => boolean;
}

class StorageMock {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const createConsentRuntime = (initialConsent?: Record<string, unknown>) => {
  const cookies = new Map<string, string>();
  if (initialConsent) {
    cookies.set('cronox_cookie_consent', JSON.stringify(initialConsent));
  }

  const documentMock: Record<string, any> = {
    readyState: 'loading',
    addEventListener: jest.fn(),
    querySelectorAll: jest.fn(() => []),
    createElement: jest.fn(),
  };
  Object.defineProperty(documentMock, 'cookie', {
    get: () =>
      [...cookies.entries()]
        .map(
          ([name, value]) =>
            `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
        )
        .join('; '),
    set: (header: string) => {
      const [pair] = header.split(';');
      const separator = pair.indexOf('=');
      const name = decodeURIComponent(pair.slice(0, separator));
      const value = decodeURIComponent(pair.slice(separator + 1));
      if (/Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name);
      else cookies.set(name, value);
    },
  });

  const localStorage = new StorageMock();
  const sessionStorage = new StorageMock();
  const windowMock: {
    location: { protocol: string; hostname: string; pathname: string };
    localStorage: StorageMock;
    sessionStorage: StorageMock;
    dispatchEvent: jest.Mock;
    CRONOX_COOKIE_CONSENT?: ConsentApi;
  } = {
    location: { protocol: 'https:', hostname: 'www.cronox.es', pathname: '/' },
    localStorage,
    sessionStorage,
    dispatchEvent: jest.fn(),
  };
  const context = vm.createContext({
    window: windowMock,
    document: documentMock,
    CustomEvent: class CustomEvent {
      constructor(
        public readonly type: string,
        public readonly options: Record<string, unknown>,
      ) {}
    },
    Date,
    JSON,
    Map,
    Set,
    Promise,
    TypeError,
    encodeURIComponent,
    decodeURIComponent,
  });
  vm.runInContext(consentSource, context);

  const api = windowMock.CRONOX_COOKIE_CONSENT;
  if (!api) throw new Error('Cookie consent API was not initialized');

  return {
    api,
    cookies,
    localStorage,
    sessionStorage,
  };
};

describe('cookie consent frontend', () => {
  it('defaults to no optional consent and stores Reject with versioning', () => {
    const runtime = createConsentRuntime();

    expect(runtime.api.getConsent()).toBeNull();
    expect(runtime.api.hasConsent('necessary')).toBe(true);
    expect(runtime.api.hasConsent('preferences')).toBe(false);

    const record = runtime.api.rejectAll();
    expect(record).toEqual(
      expect.objectContaining({
        necessary: true,
        preferences: false,
        analytics: false,
        marketing: false,
        consentVersion: '2',
      }),
    );
    expect(runtime.cookies.get('cronox_cookie_consent')).toBeDefined();

    const reloadedRuntime = createConsentRuntime(record);
    expect(reloadedRuntime.api.getConsent()).toEqual(
      expect.objectContaining({ preferences: false, consentVersion: '2' }),
    );
  });

  it('accepts only categories that are actually available', () => {
    const runtime = createConsentRuntime();
    const record = runtime.api.acceptAll();

    expect(record.preferences).toBe(true);
    expect(record.analytics).toBe(true);
    expect(record.marketing).toBe(false);
  });

  it('persists a granular analytics-only choice without enabling preferences', () => {
    const runtime = createConsentRuntime();
    const record = runtime.api.save({
      necessary: true,
      preferences: false,
      analytics: true,
    });

    expect(record).toEqual(
      expect.objectContaining({
        necessary: true,
        preferences: false,
        analytics: true,
        marketing: false,
        consentVersion: '2',
      }),
    );
  });

  it('removes preference storage when consent is withdrawn', () => {
    const runtime = createConsentRuntime();
    runtime.api.save({ necessary: true, preferences: true });
    runtime.localStorage.setItem('cronox_circle_request_modal_seen_42', '1');
    runtime.localStorage.setItem('cronox_guest_cart', '[]');
    runtime.sessionStorage.setItem('cronoxNewsletterShown', 'true');

    runtime.api.rejectAll();

    expect(
      runtime.localStorage.getItem('cronox_circle_request_modal_seen_42'),
    ).toBeNull();
    expect(runtime.sessionStorage.getItem('cronoxNewsletterShown')).toBeNull();
    expect(runtime.localStorage.getItem('cronox_guest_cart')).toBe('[]');
  });

  it('removes analytics session storage when analytics consent is withdrawn', () => {
    const runtime = createConsentRuntime();
    runtime.api.save({ necessary: true, analytics: true });
    runtime.localStorage.setItem('cronox_analytics_session', '{"id":"test"}');

    runtime.api.rejectAll();

    expect(runtime.localStorage.getItem('cronox_analytics_session')).toBeNull();
  });

  it('loads and disables an optional service when its category changes', () => {
    const runtime = createConsentRuntime();
    const load = jest.fn();
    const disable = jest.fn();
    runtime.api.registerService({
      id: 'preference-service',
      category: 'preferences',
      load,
      disable,
    });

    expect(load).not.toHaveBeenCalled();
    runtime.api.save({ necessary: true, preferences: true });
    expect(load).toHaveBeenCalledTimes(1);

    runtime.api.rejectAll();
    expect(disable).toHaveBeenCalledTimes(1);
  });

  it('invalidates a decision from a different consent version', () => {
    const runtime = createConsentRuntime({
      necessary: true,
      preferences: true,
      analytics: false,
      marketing: false,
      consentVersion: '0',
      timestamp: new Date().toISOString(),
    });

    expect(runtime.api.getConsent()).toBeNull();
  });

  it('loads the consent interface on every public HTML page', () => {
    const excluded = new Set([
      'admin.html',
      'admin-user.html',
      'auth-modal.html',
    ]);
    const publicPages = readdirSync(frontendRoot).filter(
      (file) => file.endsWith('.html') && !excluded.has(file),
    );

    for (const page of publicPages) {
      const html = readFileSync(path.join(frontendRoot, page), 'utf8');
      expect(html).toContain('assets/cookie-consent.css?v=1');
      expect(html).toContain('assets/cookie-consent.js?v=2');
      expect(html).toContain('assets/customer-analytics.js?v=1');
    }
    expect(consentSource).toContain('if (!current) showBanner();');
  });

  it('keeps Stripe on checkout but does not reload it on the success page', () => {
    const checkout = readFileSync(
      path.join(frontendRoot, 'checkout.html'),
      'utf8',
    );
    const success = readFileSync(
      path.join(frontendRoot, 'checkout-success.html'),
      'utf8',
    );

    expect(checkout).toContain('https://js.stripe.com/v3/');
    expect(success).not.toContain('https://js.stripe.com/v3/');
  });

  it('contains no analytics or advertising script before consent', () => {
    const publicSources = readdirSync(frontendRoot)
      .filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(path.join(frontendRoot, file), 'utf8'))
      .join('\n');

    expect(publicSources).not.toMatch(
      /googletagmanager|google-analytics|gtag\s*\(|fbq\s*\(|connect\.facebook\.net|analytics\.tiktok\.com|hotjar|clarity\.ms/i,
    );
  });

  it('includes keyboard, focus, ARIA, and mobile-layout safeguards', () => {
    const css = readFileSync(
      path.join(frontendRoot, 'assets/cookie-consent.css'),
      'utf8',
    );

    expect(consentSource).toContain('aria-modal="true"');
    expect(consentSource).toContain('const trapFocus');
    expect(consentSource).toContain('event.key === "Escape"');
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('grid-template-columns: 1fr');
    expect(css).toContain(':focus-visible');
  });

  it('documents the audited categories and permanent withdrawal control', () => {
    const policy = readFileSync(
      path.join(frontendRoot, 'cookie-policy.html'),
      'utf8',
    );

    expect(policy).toContain('cronox_cookie_consent');
    expect(policy).toContain('cronox_csrf_token');
    expect(policy).toContain('cartId');
    expect(policy).toContain('__stripe_mid');
    expect(policy).toContain('data-open-cookie-preferences');
    expect(policy).toContain('No utiliza Google Analytics');
    expect(policy).toContain('cronox_analytics_session');
    expect(policy).toContain('cronox.admin.pendingCounts');
  });

  it('fails closed when the Stripe publishable key is not configured', () => {
    const checkout = readFileSync(
      path.join(frontendRoot, 'assets/checkout.js'),
      'utf8',
    );

    expect(checkout).toContain('window.CRONOX_STRIPE_PUBLISHABLE_KEY');
    expect(checkout).toContain('STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED');
    expect(checkout).not.toMatch(/pk_(?:test|live)_[A-Za-z0-9]+/);
  });
});
