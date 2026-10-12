import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('browser sliding-session transport', () => {
  const windows = new Set<JSDOM>();
  let fakeClock = false;
  const createDom = (...args: ConstructorParameters<typeof JSDOM>) => {
    const dom = new JSDOM(...args);
    windows.add(dom);
    return dom;
  };
  afterEach(() => {
    try {
      // Cleanup also runs when a fetch/assertion fails. Closing JSDOM cancels
      // the transport's window timers before restoring Node's timer APIs.
      for (const dom of windows) dom.window.close();
      if (fakeClock) expect(jest.getTimerCount()).toBe(0);
    } finally {
      windows.clear();
      if (fakeClock) {
        jest.clearAllTimers();
        jest.useRealTimers();
        fakeClock = false;
      }
    }
  });
  const source = readFileSync(
    path.join(frontendRoot, 'src/admin/session.ts'),
    'utf8',
  );
  const bundle = readFileSync(path.join(frontendRoot, 'assets/api.js'), 'utf8');

  it.each(['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN'])(
    'renews visible visits only for %s client policy',
    async (role) => {
      const dom = createDom('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: 'https://cronox.test/profile.html',
      });
      const calls: string[] = [];
      const rawFetch = jest.fn(async (input: RequestInfo | URL) => {
        const route = new URL(String(input), dom.window.location.href).pathname;
        calls.push(route);
        return new Response(
          JSON.stringify(
            route.endsWith('/csrf')
              ? { csrfToken: 'csrf' }
              : { user: { role } },
          ),
          { status: 200 },
        );
      });
      Object.assign(dom.window, {
        fetch: rawFetch,
        Response,
        Request,
        Headers,
        URL,
        BroadcastChannel: undefined,
      });
      dom.window.eval(bundle);
      await dom.window.fetch('/api/me');
      await dom.window.fetch('/api/me');
      expect(calls.filter((c) => c === '/api/auth/visit')).toHaveLength(
        ['USER', 'FRIEND'].includes(role) ? 1 : 0,
      );
      Object.defineProperty(dom.window.document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      dom.window.document.dispatchEvent(
        new dom.window.Event('visibilitychange'),
      );
      await dom.window.fetch('/api/me');
      expect(calls.filter((c) => c === '/api/auth/visit')).toHaveLength(
        ['USER', 'FRIEND'].includes(role) ? 1 : 0,
      );
    },
  );

  it.each([409, 429, 503])(
    'retains authentication when visit fails and refresh returns %s',
    async (status) => {
      const dom = createDom('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: 'https://cronox.test/profile.html',
      });
      const ended = jest.fn();
      dom.window.addEventListener('cronox:session-ended', ended);
      let failure = false;
      const refreshes = jest.fn();
      Object.assign(dom.window, {
        Response,
        Request,
        Headers,
        URL,
        BroadcastChannel: undefined,
        fetch: async (input: RequestInfo | URL) => {
          const route = new URL(String(input), dom.window.location.href)
            .pathname;
          if (route.endsWith('/visit')) throw new Error('network unavailable');
          if (route.endsWith('/refresh')) {
            refreshes();
            return new Response('{}', { status });
          }
          if (route.endsWith('/csrf'))
            return new Response('{"csrfToken":"csrf"}');
          if (route === '/api/me' && !failure)
            return new Response('{"user":{"role":"USER"}}');
          return new Response('{}', { status: 401 });
        },
      });
      dom.window.eval(bundle);
      expect((await dom.window.fetch('/api/me')).ok).toBe(true);
      failure = true;
      await expect(dom.window.fetch('/api/orders')).rejects.toThrow('renovar');
      expect(refreshes).toHaveBeenCalledTimes(1);
      failure = false;
      expect((await dom.window.fetch('/api/me')).ok).toBe(true);
      expect(ended).not.toHaveBeenCalled();
    },
  );

  it.each(['anonymous', 'dependency failure'])(
    'does not amplify %s into refresh attempts or logout',
    async (scenario) => {
      const dom = createDom('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: 'https://cronox.test/tienda',
      });
      const calls: string[] = [];
      const ended = jest.fn();
      dom.window.addEventListener('cronox:session-ended', ended);
      const rawFetch = jest.fn(async (input) => {
        const route = new URL(String(input), dom.window.location.href).pathname;
        calls.push(route);
        return new Response(
          JSON.stringify(
            scenario === 'anonymous' ? { code: 'AUTH_REQUIRED' } : {},
          ),
          {
            status:
              scenario === 'dependency failure' && route === '/api/me'
                ? 503
                : 401,
          },
        );
      });
      Object.assign(dom.window, {
        fetch: rawFetch,
        Response,
        Request,
        Headers,
        URL,
        BroadcastChannel: undefined,
      });
      dom.window.eval(bundle);
      if (scenario === 'anonymous')
        expect((await dom.window.fetch('/api/me')).status).toBe(401);
      else await expect(dom.window.fetch('/api/orders')).rejects.toThrow();
      expect(calls).not.toContain('/api/auth/refresh');
      expect(calls).toHaveLength(scenario === 'anonymous' ? 1 : 2);
      expect(ended).not.toHaveBeenCalled();
    },
  );

  it('ships the exact idle message, genuine-event gate and multi-tab channels', () => {
    expect(source).toContain('Tu sesión se ha cerrado por inactividad.');
    expect(source).toContain('event.isTrusted');
    expect(source).toMatch(/document\.visibilityState !== ["']visible["']/);
    expect(source).toMatch(/new BroadcastChannel\(["']cronox\.session["']\)/);
    expect(source).toMatch(/window\.addEventListener\(["']storage["']/);
    expect(source).toContain('navigator.locks?.request');
    for (const eventName of [
      'pointerdown',
      'keydown',
      'touchstart',
      'scroll',
    ]) {
      expect(source).toContain(eventName);
    }
    expect(source).not.toContain('"pointermove"');
    expect(source).not.toContain('Date.now() + IDLE');
    expect(source).not.toMatch(/setInterval\([^)]*activity/i);
    expect(bundle).toContain('cronox.session');
  });

  it('coalesces simultaneous access failures into one refresh and retries each request once', async () => {
    const dom = createDom('<!doctype html><body></body>', {
      runScripts: 'outside-only',
      url: 'https://cronox.test/profile.html',
    });
    const calls: string[] = [];
    const attempts = new Map<string, number>();
    const rawFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        dom.window.location.href,
      );
      calls.push(url.pathname);
      if (url.pathname === '/api/auth/csrf') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-test' }), {
          status: 200,
        });
      }
      if (url.pathname === '/api/auth/refresh') {
        return new Response(JSON.stringify({ user: { id: 7 } }), {
          status: 200,
          headers: {
            'X-Session-Idle-Expires': String(Date.now() + 90 * 60_000),
          },
        });
      }
      if (url.pathname === '/api/me')
        return new Response('{}', { status: 401 });
      const count = attempts.get(url.pathname) ?? 0;
      attempts.set(url.pathname, count + 1);
      return new Response('{}', { status: count === 0 ? 401 : 200 });
    });
    Object.assign(dom.window, {
      fetch: rawFetch,
      Response,
      Request,
      Headers,
      URL,
      BroadcastChannel: undefined,
    });
    dom.window.eval(bundle);

    const [one, two] = await Promise.all([
      dom.window.fetch('/api/orders'),
      dom.window.fetch('/api/favorites'),
    ]);

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(calls.filter((entry) => entry === '/api/auth/refresh')).toHaveLength(
      1,
    );
    expect(calls.filter((entry) => entry === '/api/orders')).toHaveLength(2);
    expect(calls.filter((entry) => entry === '/api/favorites')).toHaveLength(2);
  });

  it('does not report activity from a hidden tab or a background timer', async () => {
    const dom = createDom('<!doctype html><body></body>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url: 'https://cronox.test/profile.html',
    });
    // JSDOM's lifecycle and Node Response streams use these real task queues.
    // Only the application clock/timeouts should be simulated.
    fakeClock = true;
    jest
      .useFakeTimers({
        doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
      })
      .setSystemTime(Date.parse('2026-09-17T08:00:00Z'));
    // outside-only creates a separate Date realm. Without sharing the clock,
    // the header is in simulated September while the browser sees wall time:
    // it immediately reschedules expiry reads throughout the timer advance.
    dom.window.Date = Date;
    const calls: string[] = [];
    const rawFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        dom.window.location.href,
      );
      calls.push(url.pathname);
      return new Response(JSON.stringify({ user: { id: 7, role: 'ADMIN' } }), {
        status: 200,
        headers: {
          'X-Session-Idle-Expires': String(Date.now() + 90 * 60_000),
        },
      });
    });
    Object.assign(dom.window, {
      fetch: rawFetch,
      Response,
      Request,
      Headers,
      URL,
      BroadcastChannel: undefined,
    });
    const listeners = jest.spyOn(dom.window, 'addEventListener');
    dom.window.eval(bundle);
    const login = await dom.window.fetch('/api/auth/login', { method: 'POST' });
    // Consume the caller's branch too, just as api.login does. Drain the
    // zero-delay stream cleanup before counting only application timers.
    await login.json();
    await jest.advanceTimersByTimeAsync(0);
    expect(dom.window.Date.now()).toBe(Date.now());
    expect(jest.getTimerCount()).toBe(1); // the legitimate 90-minute idle check
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
    const pointerHandler = listeners.mock.calls.find(
      ([name]) => name === 'pointerdown',
    )?.[1];
    expect(typeof pointerHandler).toBe('function');
    if (typeof pointerHandler === 'function') {
      // Exercise the hidden-tab guard independently of the synthetic-event
      // guard: JSDOM dispatchEvent cannot produce trusted browser input.
      const trustedInput = new Proxy(new dom.window.Event('pointerdown'), {
        get: (target, key) =>
          key === 'isTrusted' ? true : Reflect.get(target, key, target),
      });
      pointerHandler.call(dom.window, trustedInput);
    }
    await jest.advanceTimersByTimeAsync(30 * 60_000);
    expect(calls).toEqual(['/api/auth/login']);
    expect(jest.getTimerCount()).toBe(1);
  });

  it.each(['USER', 'FRIEND'])(
    'does not renew a hidden %s session on reads or background timers',
    async (role) => {
      const dom = createDom('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: 'https://cronox.test/profile.html',
      });
      fakeClock = true;
      jest
        .useFakeTimers({
          doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
        })
        .setSystemTime(Date.parse('2026-09-17T08:00:00Z'));
      dom.window.Date = Date;
      const calls: string[] = [];
      Object.assign(dom.window, {
        Response,
        Request,
        Headers,
        URL,
        BroadcastChannel: undefined,
        fetch: async (input: RequestInfo | URL) => {
          calls.push(new URL(String(input), dom.window.location.href).pathname);
          return new Response(JSON.stringify({ user: { id: 7, role } }));
        },
      });
      dom.window.eval(bundle);
      await dom.window.fetch('/api/me');
      dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
      dom.window.document.dispatchEvent(
        new dom.window.Event('visibilitychange'),
      );
      await jest.advanceTimersByTimeAsync(30 * 60_000);
      await dom.window.fetch('/api/me');
      expect(calls).toEqual(['/api/me', '/api/me']);
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
