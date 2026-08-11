import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(
  path.resolve(__dirname, '../../../cronox-front/assets/customer-analytics.js'),
  'utf8',
);

class StorageMock {
  private readonly values = new Map<string, string>();
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

const createRuntime = () => {
  const listeners = new Map<string, (event: any) => unknown>();
  const localStorage = new StorageMock();
  const cookies = new Map<string, string>();
  let service: { load: () => Promise<void>; disable: () => void } | undefined;
  const location = {
    protocol: 'https:',
    href: 'https://www.cronox.es/index.html',
  };
  const document: Record<string, any> = {
    visibilityState: 'visible',
    addEventListener: jest.fn(),
  };
  Object.defineProperty(document, 'cookie', {
    get: () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    set: (header: string) => {
      const [pair] = header.split(';');
      const [key, value] = pair.split('=');
      if (/Max-Age=0/i.test(header)) cookies.delete(key);
      else cookies.set(key, value);
    },
  });
  const fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/config')
        ? { sessionTimeoutMinutes: 30, heartbeatSeconds: 45 }
        : { status: 'ACTIVE' },
  }));
  const window: Record<string, any> = {
    location,
    localStorage,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    CRONOX_USER: { id: 42 },
    CRONOX_API: {
      API_BASE: '',
      getMe: async () => ({ id: 42 }),
      getCsrfHeaders: async () => ({}),
    },
    CRONOX_COOKIE_CONSENT: {
      getConsent: () => ({ analytics: true, consentVersion: '2' }),
      registerService: (candidate: typeof service) => {
        service = candidate;
      },
    },
    addEventListener: (name: string, listener: (event: any) => unknown) => {
      listeners.set(name, listener);
    },
  };

  vm.runInContext(
    source,
    vm.createContext({
      window,
      document,
      location,
      localStorage,
      fetch,
      URL,
      Math,
      Date,
      JSON,
      Promise,
      encodeURIComponent,
      setTimeout: jest.fn(() => 1),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(() => 2),
      clearInterval: jest.fn(),
    }),
  );

  if (!service) throw new Error('Analytics consent service was not registered');
  return { service, listeners, localStorage, cookies, fetch };
};

describe('customer analytics browser lifecycle', () => {
  it('creates no identifier or request before the consent service is activated', () => {
    const runtime = createRuntime();
    expect(runtime.localStorage.getItem('cronox_analytics_session')).toBeNull();
    expect(runtime.cookies.has('cronox_analytics_session')).toBe(false);
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('creates the first-party session only after activation', async () => {
    const runtime = createRuntime();
    await runtime.service.load();

    expect(
      runtime.localStorage.getItem('cronox_analytics_session'),
    ).not.toBeNull();
    expect(runtime.cookies.has('cronox_analytics_session')).toBe(true);
    expect(runtime.fetch).toHaveBeenCalledWith(
      '/api/analytics/config',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('discards queued activity and removes the session without a final event send on withdrawal', async () => {
    const runtime = createRuntime();
    await runtime.service.load();
    runtime.listeners.get('cronox:productViewed')?.({
      detail: { productId: 9 },
    });
    const eventCallsBefore = runtime.fetch.mock.calls.filter(([url]) =>
      String(url).endsWith('/api/analytics/events'),
    ).length;

    runtime.service.disable();
    await Promise.resolve();

    expect(runtime.localStorage.getItem('cronox_analytics_session')).toBeNull();
    expect(runtime.cookies.has('cronox_analytics_session')).toBe(false);
    expect(
      runtime.fetch.mock.calls.filter(([url]) =>
        String(url).endsWith('/api/analytics/events'),
      ),
    ).toHaveLength(eventCallsBefore);
  });
});
