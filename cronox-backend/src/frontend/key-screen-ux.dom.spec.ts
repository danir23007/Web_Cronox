import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('Pantalla Clave focused UX contracts', () => {
  const gateHtml = readFrontend('key-screen.html');
  const gateScript = readFrontend('assets/key-screen.js');
  const rendererScript = readFrontend('assets/key-screen-renderer.js');
  const gateStyles = readFrontend('assets/key-screen.css');
  const compositionStyles = readFrontend('assets/key-screen-composition.css');
  const privacyHtml = readFrontend('privacy-policy.html');
  const infoShellScript = readFrontend('assets/info-shell.js');
  const gateMiddlewareSource = readFileSync(
    path.resolve(__dirname, '../common/routing/public-html-gate.middleware.ts'),
    'utf8',
  );
  const publicPagesSource = readFileSync(
    path.resolve(__dirname, '../common/routing/public-pages.ts'),
    'utf8',
  );

  const screen = (mediaType: 'image' | 'video' = 'image') => ({
    title: 'PRÓXIMAMENTE',
    subtitle: 'Nueva colección',
    placeholder: 'Correo electrónico',
    buttonText: 'NOTIFICARME',
    successTitle: 'YA FORMAS PARTE.',
    successMessage: 'Registro completado.',
    privacyLabel: 'Política de privacidad',
    privacyUrl: '/privacy-policy.html',
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
      source: `https://storage.example.test/key-screen.${mediaType === 'video' ? 'mp4' : 'png'}`,
      mediaType,
    },
  });

  const runtime = (
    fetchImpl: jest.Mock,
    prepareWindow?: (window: JSDOM['window']) => void,
  ) => {
    const dom = new JSDOM(gateHtml, {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/key-screen.html',
    });
    const { window } = dom;
    Object.defineProperty(window, 'matchMedia', {
      value: (query: string) => ({
        matches: query.includes('max-width') ? false : false,
        addEventListener: jest.fn(),
      }),
    });
    Object.defineProperty(window, 'CRONOX_API', {
      value: { API_BASE: '', getCsrfHeaders: jest.fn() },
    });
    Object.defineProperty(window, 'CRONOX_MEDIA_GEOMETRY', {
      value: { apply: jest.fn() },
    });
    Object.defineProperty(window, 'fetch', { value: fetchImpl });
    prepareWindow?.(window);
    window.eval(rendererScript);
    window.eval(gateScript);
    return dom;
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes the original animated CRONOX logo the first fullscreen state', () => {
    const document = new JSDOM(gateHtml).window.document;
    const loaderImage = document.querySelector<HTMLImageElement>(
      '#keyLoader .key-gate__loader-logo',
    );

    expect(loaderImage?.getAttribute('src')).toBe('assets/CRONOX-GIF.gif');
    expect(loaderImage?.getAttribute('alt')).toBe('');
    expect(document.querySelector('#keyContent')?.hasAttribute('hidden')).toBe(
      true,
    );
    expect(
      document.querySelector('#keyUnavailable')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(document.querySelector('#keyGate')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(gateStyles).toMatch(/height:\s*100dvh/);
    expect(gateStyles).toMatch(/width:\s*160px/);
    expect(gateStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('keeps the public composition visible with dynamic viewport and safe-area fallbacks', () => {
    expect(gateStyles).toMatch(/min-height:\s*100dvh/);
    expect(gateStyles).toMatch(/overflow-y:\s*auto/);
    expect(gateStyles).toMatch(/env\(safe-area-inset-top\)/);
    expect(gateStyles).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(gateStyles).not.toMatch(/html, body[^}]*overflow:\s*hidden/s);
    expect(compositionStyles).toContain('--key-fit-shift-y');
    expect(gateScript).toContain('window.visualViewport');
    expect(gateScript).toMatch(
      /el\.content\.dataset\.fitOverflow\s*=\s*["']true["']/,
    );
    expect(gateScript).toContain('new ResizeObserver(fitComposition)');
  });

  it('keeps configured content hidden until an image is ready', async () => {
    const dom = runtime(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true, screen: screen('image') }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { document } = dom.window;

    expect(document.querySelector<HTMLElement>('#keyContent')!.hidden).toBe(
      true,
    );
    expect(document.querySelector<HTMLElement>('#keyLoader')!.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('#keyUnavailable')!.hidden).toBe(
      true,
    );
    document
      .querySelector<HTMLImageElement>('#keyMediaFrame img')!
      .dispatchEvent(new dom.window.Event('load'));
    expect(document.querySelector<HTMLElement>('#keyContent')!.hidden).toBe(
      false,
    );
    expect(document.querySelector('#keyLoader')?.classList).toContain(
      'is-leaving',
    );
    expect(document.documentElement.dataset.keyScreenState).toBe('ready');
    expect(document.querySelector('#keyPrivacy')?.getAttribute('href')).toBe(
      '/privacidad?source=key-screen',
    );
    dom.window.close();
  });

  it('reveals the usable configured form instead of emergency copy when media fails', async () => {
    const dom = runtime(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true, screen: screen('image') }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { document } = dom.window;
    document
      .querySelector<HTMLImageElement>('#keyMediaFrame img')!
      .dispatchEvent(new dom.window.Event('error'));

    expect(document.querySelector<HTMLElement>('#keyContent')!.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('#keyUnavailable')!.hidden).toBe(
      true,
    );
    expect(document.documentElement.dataset.keyScreenMediaState).toBe('error');
    expect(document.documentElement.dataset.keyScreenState).toBe('ready');
    dom.window.close();
  });

  it('waits for the first usable video frame, without requiring a full download', async () => {
    const load = jest.fn();
    const play = jest.fn().mockResolvedValue(undefined);
    const dom = runtime(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ enabled: true, screen: screen('video') }),
      }),
      (window) => {
        window.HTMLMediaElement.prototype.load = load;
        window.HTMLMediaElement.prototype.play = play;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const video = dom.window.document.querySelector<HTMLVideoElement>(
      '#keyMediaFrame video',
    )!;

    expect(video.preload).toBe('auto');
    expect(
      dom.window.document.querySelector<HTMLElement>('#keyContent')!.hidden,
    ).toBe(true);
    video.dispatchEvent(new dom.window.Event('loadeddata'));
    expect(
      dom.window.document.querySelector<HTMLElement>('#keyContent')!.hidden,
    ).toBe(false);
    expect(load).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    dom.window.close();
  });

  it('shows emergency fallback only after a genuine configuration failure', async () => {
    const dom = runtime(jest.fn().mockRejectedValue(new Error('offline')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { document } = dom.window;

    expect(document.querySelector<HTMLElement>('#keyUnavailable')!.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('#keyContent')!.hidden).toBe(
      true,
    );
    expect(document.documentElement.dataset.keyScreenState).toBe('unavailable');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('fallback seguro'),
      expect.any(Error),
    );
    dom.window.close();
  });

  it('shows the existing-account message without entering the success state', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ enabled: true, screen: screen('image') }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Este usuario ya está registrado.' }),
      });
    const dom = runtime(fetch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { document } = dom.window;
    document
      .querySelector<HTMLImageElement>('#keyMediaFrame img')!
      .dispatchEvent(new dom.window.Event('load'));
    const email = document.querySelector<HTMLInputElement>('#keyEmail')!;
    email.value = 'owner@example.com';
    document
      .querySelector<HTMLFormElement>('#keyRegister')!
      .dispatchEvent(
        new dom.window.Event('submit', { bubbles: true, cancelable: true }),
      );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('#keyFormMessage')?.textContent).toBe(
      'Este usuario ya está registrado.',
    );
    expect(document.querySelector<HTMLElement>('#keyRegister')!.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLElement>('#keySuccess')!.hidden).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLButtonElement>('#keySubmit')!.disabled,
    ).toBe(false);
    dom.window.close();
  });

  it('suppresses every storefront control only in explicit key-screen privacy context', () => {
    const contextual = new JSDOM(privacyHtml, {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/privacidad?source=key-screen',
    });
    contextual.window.eval(infoShellScript);
    const contextualDocument = contextual.window.document;

    expect(contextualDocument.documentElement.dataset.privacyContext).toBe(
      'key-screen',
    );
    expect(contextualDocument.querySelector('.container h1')).not.toBeNull();
    expect(
      contextualDocument.querySelectorAll('.container h2').length,
    ).toBeGreaterThan(5);
    expect(contextualDocument.querySelector('#topbar')).toBeNull();
    expect(contextualDocument.querySelector('#btnMenu')).toBeNull();
    expect(contextualDocument.querySelector('#btnSearch')).toBeNull();
    expect(contextualDocument.querySelector('#profileBtn')).toBeNull();
    expect(contextualDocument.querySelector('.topbar__fav')).toBeNull();
    expect(contextualDocument.querySelector('#cart-icon-btn')).toBeNull();
    expect(
      Array.from(
        contextualDocument.querySelectorAll<HTMLAnchorElement>('body a'),
      ).map((link) => link.getAttribute('href')),
    ).toEqual(['/']);
    expect(
      contextualDocument
        .querySelector('.key-screen-return')
        ?.getAttribute('href'),
    ).toBe('/');
    expect(
      contextual.window.getComputedStyle(
        contextualDocument.querySelector('.key-screen-return')!,
      ).display,
    ).toBe('inline-flex');
    expect(gateMiddlewareSource).toContain(
      'UNGATED_PUBLIC_PATHS.has(pathname)',
    );
    expect(publicPagesSource).toMatch(
      /export const UNGATED_PUBLIC_PATHS = new Set\(\[[\s\S]*'\/privacidad'[\s\S]*'\/privacy-policy\.html'/,
    );

    const normal = new JSDOM(privacyHtml, {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/privacidad',
    });
    normal.window.eval(infoShellScript);
    expect(normal.window.document.documentElement.dataset.privacyContext).toBe(
      undefined,
    );
    expect(normal.window.document.querySelector('#topbar')).not.toBeNull();
    expect(normal.window.document.querySelector('#btnMenu')).not.toBeNull();
    expect(
      normal.window.document.querySelector('#cart-icon-btn'),
    ).not.toBeNull();
    expect(
      normal.window.getComputedStyle(
        normal.window.document.querySelector('.key-screen-return')!,
      ).display,
    ).toBe('none');
  });
});
