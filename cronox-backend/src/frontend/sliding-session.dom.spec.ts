import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('browser sliding-session transport', () => {
  const source = readFileSync(
    path.join(frontendRoot, 'src/admin/session.ts'),
    'utf8',
  );
  const bundle = readFileSync(path.join(frontendRoot, 'assets/api.js'), 'utf8');

  it('ships the exact idle message, genuine-event gate and multi-tab channels', () => {
    expect(source).toContain('Tu sesión se ha cerrado por inactividad.');
    expect(source).toContain('event.isTrusted');
    expect(source).toMatch(/document\.visibilityState !== ["']visible["']/);
    expect(source).toMatch(/new BroadcastChannel\(["']cronox\.session["']\)/);
    expect(source).toMatch(/window\.addEventListener\(["']storage["']/);
    expect(source).toContain('navigator.locks?.request');
    for (const eventName of ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']) {
      expect(source).toContain(eventName);
    }
    expect(source).not.toMatch(/setInterval\([^)]*activity/i);
    expect(bundle).toContain('cronox.session');
  });

  it('coalesces simultaneous access failures into one refresh and retries each request once', async () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
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
    dom.window.close();
  });

  it('does not report activity from a hidden tab or a background timer', async () => {
    jest.useFakeTimers().setSystemTime(Date.parse('2026-09-17T08:00:00Z'));
    const dom = new JSDOM('<!doctype html><body></body>', {
      runScripts: 'outside-only',
      url: 'https://cronox.test/profile.html',
    });
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
      return new Response(JSON.stringify({ user: { id: 7 } }), {
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
    dom.window.eval(bundle);
    await dom.window.fetch('/api/auth/login', { method: 'POST' });
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
    await jest.advanceTimersByTimeAsync(30 * 60_000);

    expect(calls.filter((entry) => entry === '/api/auth/activity')).toHaveLength(0);
    dom.window.close();
    jest.useRealTimers();
  });
});
