/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('Pantalla Clave automatic expiration', () => {
  const madridTimeScript = readFrontend('assets/key-screen-time.js');
  const adminHtml = readFrontend('admin.html');
  const adminScript = readFrontend('assets/admin-key-screen.js');
  const gateHtml = readFrontend('key-screen.html');
  const gateScript = readFrontend('assets/key-screen.js');
  const rendererScript = readFrontend('assets/key-screen-renderer.js');
  const controllerSource = readFileSync(
    path.resolve(__dirname, '../key-screen/key-screen.controller.ts'),
    'utf8',
  );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('converts valid Madrid winter and summer times to unambiguous UTC instants', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(madridTimeScript);
    const time = (dom.window as any).CRONOX_MADRID_TIME;

    expect(time.madridLocalToUtc('2026-01-15T12:00')).toBe(
      '2026-01-15T11:00:00.000Z',
    );
    expect(time.madridLocalToUtc('2026-07-15T12:00')).toBe(
      '2026-07-15T10:00:00.000Z',
    );
    expect(time.utcToMadridLocal('2026-01-15T11:00:00.000Z')).toBe(
      '2026-01-15T12:00',
    );
    expect(time.utcToMadridLocal('2026-07-15T10:00:00.000Z')).toBe(
      '2026-07-15T12:00',
    );
    dom.window.close();
  });

  it('rejects nonexistent and ambiguous Madrid wall-clock times at DST changes', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(madridTimeScript);
    const time = (dom.window as any).CRONOX_MADRID_TIME;

    expect(() => time.madridLocalToUtc('2026-03-29T02:30')).toThrow(
      'NONEXISTENT_MADRID_LOCAL_TIME',
    );
    expect(() => time.madridLocalToUtc('2026-10-25T02:30')).toThrow(
      'AMBIGUOUS_MADRID_LOCAL_TIME',
    );
    expect(() => time.madridLocalToUtc('invalid')).toThrow(
      'INVALID_MADRID_LOCAL_TIME',
    );
    dom.window.close();
  });

  it('reloads a persisted UTC expiration in Madrid time and saves summer time as UTC', async () => {
    const dom = new JSDOM(adminHtml, {
      runScripts: 'outside-only',
      url: 'https://cronox.es/admin.html',
    });
    const { window } = dom;
    const settings = (expiresAt: string | null) => ({
      id: 'global',
      enabled: true,
      activeScreenId: null,
      expiresAt,
      effectiveEnabled: true,
      serverTime: '2026-01-15T11:00:00.000Z',
    });
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          settings: settings('2026-01-15T12:00:00.000Z'),
          screens: [],
          assets: [],
          preregisteredCount: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...settings('2026-07-15T10:00:00.000Z'),
          serverTime: '2026-07-15T09:00:00.000Z',
        }),
      });
    Object.defineProperty(window, 'fetch', { value: fetch });
    Object.defineProperty(window, 'CRONOX_API', {
      value: { API_BASE: '', getCsrfHeaders: jest.fn(async () => ({})) },
    });
    Object.defineProperty(window, 'CRONOX_KEY_SCREEN_RENDERER', {
      value: { VIEWPORTS: { desktop: { width: 1200, height: 800 } } },
    });
    Object.defineProperty(window, 'CRONOX_MEDIA_GEOMETRY', { value: {} });
    window.eval(madridTimeScript);
    window.eval(adminScript);

    await (window as any).CRONOX_KEY_SCREEN.load();
    const input = window.document.querySelector<HTMLInputElement>(
      '#keyExpirationInput',
    )!;
    expect(input.value).toBe('2026-01-15T13:00');
    expect(
      window.document.querySelector('#keyExpirationStatus')?.textContent,
    ).toContain('La pantalla clave se desactivará en');

    input.value = '2026-07-15T12:00';
    window.document
      .querySelector<HTMLButtonElement>('#keyExpirationSave')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/admin/key-screens/expiration',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ expiresAt: '2026-07-15T10:00:00.000Z' }),
      }),
    );
    expect(input.value).toBe('2026-07-15T12:00');
    dom.window.close();
  });

  it('automatically unlocks an already-open gate after server-confirmed expiration', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const now = Date.now();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          serverTime: new Date(now).toISOString(),
          expiresAt: new Date(now + 30).toISOString(),
          screen: publicScreen(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: false,
          serverTime: new Date(now + 30).toISOString(),
          expiresAt: new Date(now + 30).toISOString(),
        }),
      });
    const navigate = jest.fn();
    const dom = gateRuntime(fetch, navigate);

    await new Promise((resolve) => setTimeout(resolve, 140));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/');
    dom.window.close();
  });

  it('keeps the gate closed when a recheck fails and exposes a bounded retry path', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          serverTime: '2026-01-15T11:00:00.000Z',
          expiresAt: '2027-01-15T11:00:00.000Z',
          screen: publicScreen(),
        }),
      })
      .mockRejectedValueOnce(new Error('offline'));
    const navigate = jest.fn();
    const dom = gateRuntime(fetch, navigate);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await (dom.window as any).CRONOX_KEY_SCREEN_EXPIRATION.refresh();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
    expect(gateScript).toContain('Math.min(60_000, retryDelayMs * 2)');
    dom.window.close();
  });

  it('rechecks and unlocks when a throttled tab regains focus', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          serverTime: '2026-01-15T11:00:00.000Z',
          expiresAt: '2027-01-15T11:00:00.000Z',
          screen: publicScreen(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: false,
          serverTime: '2027-01-15T11:00:00.000Z',
          expiresAt: '2027-01-15T11:00:00.000Z',
        }),
      });
    const navigate = jest.fn();
    const dom = gateRuntime(fetch, navigate);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const later = dom.window.performance.now() + 6_000;
    jest.spyOn(dom.window.performance, 'now').mockReturnValue(later);

    dom.window.dispatchEvent(new dom.window.Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(gateScript).toContain(
      'document.addEventListener("visibilitychange", refreshIfStale)',
    );
    dom.window.close();
  });

  it('keeps the expiration mutation under the existing SUPERADMIN guards', () => {
    expect(controllerSource).toContain(
      '@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)',
    );
    expect(controllerSource).toContain('@Roles(Role.SUPERADMIN)');
    expect(controllerSource).toContain("@Patch('expiration')");
    const document = new JSDOM(adminHtml).window.document;
    expect(
      document
        .querySelector<HTMLInputElement>('#keyExpirationInput')
        ?.getAttribute('type'),
    ).toBe('datetime-local');
    expect(adminHtml).toContain('Horario de Madrid (Europe/Madrid)');
    expect(adminHtml).toContain('assets/key-screen-time.js?v=1');
  });

  function gateRuntime(fetch: jest.Mock, navigate: jest.Mock) {
    const dom = new JSDOM(gateHtml, {
      runScripts: 'outside-only',
      url: 'https://cronox.es/key-screen.html',
    });
    const { window } = dom;
    Object.defineProperty(window, 'matchMedia', {
      value: () => ({ matches: true, addEventListener: jest.fn() }),
    });
    Object.defineProperty(window, 'fetch', { value: fetch });
    Object.defineProperty(window, 'CRONOX_API', {
      value: { API_BASE: '', getCsrfHeaders: jest.fn(async () => ({})) },
    });
    Object.defineProperty(window, 'CRONOX_MEDIA_GEOMETRY', {
      value: { apply: jest.fn() },
    });
    Object.defineProperty(window, 'CRONOX_KEY_SCREEN_NAVIGATE', {
      value: navigate,
    });
    window.eval(rendererScript);
    window.eval(gateScript);
    return dom;
  }

  function publicScreen() {
    return {
      title: 'PRÓXIMAMENTE',
      subtitle: '',
      placeholder: 'Correo electrónico',
      buttonText: 'NOTIFICARME',
      successTitle: 'LISTO',
      successMessage: 'Gracias',
      privacyLabel: 'Privacidad',
      privacyUrl: '/privacidad',
      textColor: '#ffffff',
      inputStyle: 'LIGHT',
      buttonStyle: 'DARK',
      horizontalAlign: 'CENTER',
      verticalAlign: 'CENTER',
      offsetX: 0,
      offsetY: 0,
      overlayStrength: 25,
      desktopFocalX: 50,
      desktopFocalY: 50,
      desktopZoom: 1,
      desktopFit: 'COVER',
      mobileFocalX: 50,
      mobileFocalY: 50,
      mobileZoom: 1,
      mobileFit: 'COVER',
      media: {
        source: 'https://storage.example.test/key-screen.png',
        mediaType: 'image',
      },
    };
  }
});
