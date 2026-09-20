import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

describe('Pantalla Clave frontend integration', () => {
  const frontend = join(__dirname, '..', '..', '..', 'cronox-front');
  const adminHtml = readFileSync(join(frontend, 'admin.html'), 'utf8');
  const gateHtml = readFileSync(join(frontend, 'key-screen.html'), 'utf8');
  const gateScript = readFileSync(
    join(frontend, 'assets', 'key-screen.js'),
    'utf8',
  );
  const apiScript = readFileSync(join(frontend, 'assets', 'api.js'), 'utf8');
  const rendererScript = readFileSync(
    join(frontend, 'assets', 'key-screen-renderer.js'),
    'utf8',
  );
  const gateStyles = readFileSync(
    join(frontend, 'assets', 'key-screen.css'),
    'utf8',
  );
  const adminScript = readFileSync(
    join(frontend, 'assets', 'admin-key-screen.js'),
    'utf8',
  );
  const mainSource = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
  const gateMiddlewareSource = readFileSync(
    join(
      __dirname,
      '..',
      'common',
      'routing',
      'public-html-gate.middleware.ts',
    ),
    'utf8',
  );

  it('adds the main Admin section with separate save, preview, activate and master controls', () => {
    const document = new JSDOM(adminHtml).window.document;
    expect(
      document.querySelector('[data-nav-target="section-key-screen"]'),
    ).not.toBeNull();
    expect(document.querySelector('#section-key-screen')).not.toBeNull();
    expect(document.querySelector('#keyMaster')).not.toBeNull();
    expect(
      document.querySelector('#keyForm button[type="submit"]')?.textContent,
    ).toContain('Guardar');
    expect(document.querySelector('#keyActivate')).not.toBeNull();
    expect(document.querySelectorAll('button[data-key-device]')).toHaveLength(
      2,
    );
    expect(adminHtml.indexOf('media-framing-geometry.js')).toBeLessThan(
      adminHtml.indexOf('admin-key-screen.js'),
    );
    expect(adminHtml).toContain('assets/key-screen-composition.css?v=2');
    expect(gateHtml).toContain('assets/key-screen-composition.css?v=3');
    expect(
      document.querySelector('#keyPreview.key-composition'),
    ).not.toBeNull();
    expect(document.querySelector('[name="desktopOffsetX"]')).not.toBeNull();
    expect(document.querySelector('[name="mobileOffsetX"]')).not.toBeNull();
    expect(
      document.querySelector('[name="desktopFormOffsetY"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[name="mobilePrivacyOffsetY"]'),
    ).not.toBeNull();
    expect(
      document
        .querySelector('[data-key-controls="mobile"]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
    expect(adminScript).toContain('addEventListener("pointerdown"');
    expect(adminScript).toContain('addEventListener("wheel"');
    expect(adminScript).toContain('{ passive: false }');
  });

  it('renders a passwordless preregistration form, success state and privacy link without storefront content', () => {
    const document = new JSDOM(gateHtml).window.document;
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.querySelector('#keySuccess')).not.toBeNull();
    expect(document.querySelector('#keyPrivacy')?.getAttribute('href')).toBe(
      '/privacidad?source=key-screen',
    );
    expect(gateHtml).not.toContain('product-card');
    expect(gateScript).toContain('el.form.hidden = true');
    expect(gateScript).not.toMatch(/location\.(?:assign|href).*preregister/i);
  });

  it('makes only the canonical prelaunch root indexable with complete social metadata', () => {
    const document = new JSDOM(gateHtml).window.document;
    expect(document.title).toBe('CRONOX — Próximamente');
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute('content'),
    ).toBe('index,follow');
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute('content'),
    ).toBe(
      'CRONOX está preparando algo nuevo. Regístrate para recibir novedades y acceso al lanzamiento.',
    );
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe('https://cronox.es/');
    expect(
      document
        .querySelector('meta[property="og:url"]')
        ?.getAttribute('content'),
    ).toBe('https://cronox.es/');
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content'),
    ).toBe('https://cronox.es/assets/logo_banner.png');
    expect(
      document
        .querySelector('meta[name="twitter:card"]')
        ?.getAttribute('content'),
    ).toBe('summary_large_image');
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute('content'),
    ).toBe('https://cronox.es/assets/logo_banner.png');
  });

  it.each(['https://cronox.es/', 'https://www.cronox.es/'])(
    'keeps Key Screen API requests same-origin at %s',
    (url) => {
      const dom = new JSDOM(gateHtml, { runScripts: 'outside-only', url });
      dom.window.eval(apiScript);
      expect(dom.window.CRONOX_API.API_BASE).toBe(new URL(url).origin);
      expect(gateScript).toContain(
        'fetch(`${base}/api/key-screen/preregister`',
      );
      expect(gateScript).not.toContain('localhost');
      dom.window.close();
    },
  );

  it('shares the media geometry engine and uses full viewport responsive framing', () => {
    expect(gateHtml).toContain('media-framing-geometry.js');
    expect(gateScript).toContain('CRONOX_MEDIA_GEOMETRY?.apply');
    expect(rendererScript).toContain('mobileFocalX');
    expect(gateStyles).toMatch(
      /\.key-gate \.key-composition__media,[\s\S]*\.key-gate \.key-composition__shade\s*\{\s*position:\s*fixed;/,
    );
    expect(gateStyles).toMatch(
      /\.key-gate__unavailable\[hidden\].*\.key-gate__content\[hidden\]/s,
    );
    expect(gateScript).toContain(
      'El formulario se muestra sobre el fondo seguro',
    );
  });

  it('delegates the gate before static HTML while explicitly excluding Admin and APIs', () => {
    expect(mainSource).toContain(
      "import { createPublicHtmlGateMiddleware } from './common/routing/public-html-gate.middleware'",
    );
    expect(mainSource).toContain('createPublicHtmlGateMiddleware({');
    expect(mainSource.indexOf('createPublicHtmlGateMiddleware({')).toBeLessThan(
      mainSource.indexOf('app.useGlobalPipes'),
    );
    expect(gateMiddlewareSource).toContain("pathname.startsWith('/api')");
    expect(gateMiddlewareSource).toContain("'/admin.html'");
    expect(gateMiddlewareSource).toContain(
      "res.sendFile(join(frontendRoot, 'key-screen.html'))",
    );
    expect(gateMiddlewareSource).not.toContain(
      "res.redirect(307, '/key-screen.html')",
    );
    expect(gateMiddlewareSource).toContain(
      "res.setHeader('Cache-Control', 'no-store, max-age=0')",
    );
    expect(gateMiddlewareSource).toContain(
      "res.setHeader('X-Robots-Tag', 'noindex, follow')",
    );
  });

  it('hydrates the persisted active configuration and removes the fallback from the rendered stack', async () => {
    const dom = new JSDOM(gateHtml, {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/key-screen.html',
    });
    const { window } = dom;
    const style = window.document.createElement('style');
    style.textContent = gateStyles;
    window.document.head.appendChild(style);
    const mobileMediaQuery = {
      matches: true,
      addEventListener: jest.fn(),
    };
    Object.defineProperty(window, 'matchMedia', {
      value: () => mobileMediaQuery,
    });
    Object.defineProperty(window, 'CRONOX_API', {
      value: { API_BASE: '', getCsrfHeaders: jest.fn() },
    });
    const applyGeometry = jest.fn();
    Object.defineProperty(window, 'CRONOX_MEDIA_GEOMETRY', {
      value: { apply: applyGeometry },
    });
    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 844,
      configurable: true,
    });
    Object.defineProperty(window, 'fetch', {
      value: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          enabled: true,
          screen: {
            mode: 'PREREGISTRATION',
            title: 'PRÓXIMAMENTE',
            subtitle: '',
            placeholder: 'Correo electrónico',
            buttonText: 'NOTIFICARME',
            successTitle: 'YA FORMAS PARTE.',
            successMessage: 'Si el correo es válido, ya formas parte.',
            privacyLabel: 'Política de privacidad',
            privacyUrl: '/privacy-policy.html',
            textColor: '#ffffff',
            inputStyle: 'LIGHT',
            buttonStyle: 'DARK',
            horizontalAlign: 'CENTER',
            verticalAlign: 'CENTER',
            offsetX: 0,
            offsetY: 0,
            desktopHorizontalAlign: 'LEFT',
            desktopVerticalAlign: 'TOP',
            desktopOffsetX: 30,
            desktopOffsetY: 40,
            mobileHorizontalAlign: 'RIGHT',
            mobileVerticalAlign: 'BOTTOM',
            mobileOffsetX: -15,
            mobileOffsetY: -25,
            desktopFormOffsetX: 11,
            desktopFormOffsetY: 22,
            desktopPrivacyOffsetX: 33,
            desktopPrivacyOffsetY: 44,
            mobileFormOffsetX: -11,
            mobileFormOffsetY: -22,
            mobilePrivacyOffsetX: -33,
            mobilePrivacyOffsetY: -44,
            overlayStrength: 26,
            desktopFocalX: 51,
            desktopFocalY: 52,
            desktopZoom: 1.05,
            desktopFit: 'COVER',
            mobileFocalX: 50,
            mobileFocalY: 50,
            mobileZoom: 1,
            mobileFit: 'COVER',
            media: {
              source: 'https://storage.example.test/prelaunch.png',
              mediaType: 'image',
            },
          },
        }),
      }),
    });

    window.eval(rendererScript);
    window.eval(gateScript);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fallback =
      window.document.querySelector<HTMLElement>('#keyUnavailable')!;
    expect(fallback.hidden).toBe(true);
    expect(window.getComputedStyle(fallback).display).toBe('none');
    expect(
      window.document.querySelector<HTMLElement>('#keyContent')!.hidden,
    ).toBe(true);
    expect(window.document.querySelector('#keyTitle')?.textContent).toBe(
      'PRÓXIMAMENTE',
    );
    expect(window.document.querySelector('#keySubmit')?.textContent).toBe(
      'NOTIFICARME',
    );
    expect(window.document.documentElement.dataset.keyScreenState).toBe(
      'loading',
    );
    window.document
      .querySelector<HTMLImageElement>('#keyMediaFrame img')!
      .dispatchEvent(new window.Event('load'));
    expect(
      window.document.querySelector<HTMLElement>('#keyContent')!.hidden,
    ).toBe(false);
    expect(window.document.documentElement.dataset.keyScreenState).toBe(
      'ready',
    );
    expect(applyGeometry).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        focalX: 50,
        focalY: 50,
        zoom: 1,
        fit: 'COVER',
      }),
    );
    expect(
      window.document.querySelector<HTMLElement>('#keyContent')!.dataset
        .horizontal,
    ).toBe('end');
    expect(
      window.document
        .querySelector<HTMLElement>('#keyContent')!
        .style.getPropertyValue('--key-offset-x'),
    ).toBe('-15px');
    expect(
      window.document
        .querySelector<HTMLElement>('#keyRegister')!
        .style.getPropertyValue('--key-form-offset-y'),
    ).toBe('-22px');
    expect(
      window.document
        .querySelector<HTMLElement>('#keyPrivacy')!
        .style.getPropertyValue('--key-privacy-offset-y'),
    ).toBe('-44px');

    Object.defineProperty(window, 'innerWidth', {
      value: 1200,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 1080,
      configurable: true,
    });
    window.dispatchEvent(new window.Event('resize'));
    expect(applyGeometry).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ focalX: 51, focalY: 52, zoom: 1.05 }),
    );
    expect(
      window.document.querySelector<HTMLElement>('#keyContent')!.dataset
        .horizontal,
    ).toBe('start');
    expect(
      window.document
        .querySelector<HTMLElement>('#keyContent')!
        .style.getPropertyValue('--key-offset-x'),
    ).toBe('18.75px');
    expect(
      window.document
        .querySelector<HTMLElement>('#keyRegister')!
        .style.getPropertyValue('--key-form-offset-y'),
    ).toBe('22px');
  });
});
