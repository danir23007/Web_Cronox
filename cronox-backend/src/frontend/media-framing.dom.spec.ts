/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const adminHtml = readFrontend('admin.html');
const indexHtml = readFrontend('index.html');
const adminScript = readFrontend('assets/admin-media.js');
const adminStyles = readFrontend('assets/admin-media.css');
const geometryScript = readFrontend('assets/media-framing-geometry.js');
const publicScript = readFrontend('assets/media-framing.js');
const publicStyles = readFrontend('assets/media-framing.css');
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const baseline = { focalX: 50, focalY: 50, zoom: 1, fit: 'COVER' };
const initialFrame = { focalX: 15, focalY: 30, zoom: 1.5, fit: 'COVER' };
const heroViewport = (fontSize: number, x = 50, y = 50) => ({
  x,
  y,
  align: 'CENTER',
  color: '#ffffff',
  fontSize,
  fontWeight: 800,
  letterSpacing: 1.5,
  uppercase: false,
  maxWidth: 90,
});
const initialPlacement = {
  key: 'home.hero.video',
  label: 'V\u00eddeo principal de portada',
  route: 'Portada (/)',
  publicUrl: '/',
  category: 'Portada',
  mediaType: 'video',
  authority: 'static',
  source: '/assets/VIDEO_LOGO_CRONOX.mp4',
  poster: '/assets/logo_banner.png',
  sourceFilename: 'VIDEO_LOGO_CRONOX.mp4',
  frame: {
    desktop: 'Viewport actual',
    tablet: '768 \u00d7 1024',
    mobile: '390 \u00d7 844',
  },
  preview: {
    kind: 'viewport',
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  },
  defaults: baseline,
  status: 'CUSTOM',
  framing: { desktop: initialFrame, tablet: null, mobile: null },
  heroText: {
    enabled: true,
    content: 'CRONOX VIEWPORT',
    desktop: heroViewport(42, 10, 20),
    tablet: heroViewport(36, 50, 90),
    mobile: heroViewport(28, 85, 55),
  },
  revision: 3,
};

const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  json: jest.fn().mockResolvedValue(payload),
});

const defineVideoDimensions = (dom: JSDOM) => {
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 1920,
  });
  Object.defineProperty(dom.window.HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 1080,
  });
};

const makeAdminDom = () => {
  const dom = new JSDOM(adminHtml, {
    url: 'https://admin.example.test/admin.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  let placement = structuredClone(initialPlacement);
  const writes: Array<{ url: string; method: string; body: any }> = [];
  const fetchMock = jest.fn(async (url: string, options: any = {}) => {
    const method = options.method || 'GET';
    const decoded = decodeURIComponent(url);
    if (method === 'GET' && decoded.endsWith('/api/admin/media/placements')) {
      return jsonResponse({ placements: [placement] });
    }
    if (method === 'GET' && decoded.endsWith('/api/admin/media/library')) {
      const activeAssetId = (placement as any).activeAssetId || null;
      return jsonResponse({
        folders: [
          {
            key: 'portadas',
            label: 'PORTADAS',
            placementKeys: ['home.hero.video'],
            photos: [
              {
                id: 'asset-photo',
                source: 'https://storage.example.test/portada.jpg',
                poster: null,
                originalFilename: 'portada-anterior.jpg',
                mediaType: 'image',
                fileSize: 2048,
                builtin: false,
                activeFor: activeAssetId ? ['home.hero.video'] : [],
              },
            ],
            videos: [
              {
                id: 'builtin:home.hero.video',
                source: '/assets/VIDEO_LOGO_CRONOX.mp4',
                poster: '/assets/logo_banner.png',
                originalFilename: 'VIDEO_LOGO_CRONOX.mp4',
                mediaType: 'video',
                builtin: true,
                activeFor: activeAssetId ? [] : ['home.hero.video'],
              },
            ],
          },
        ],
      });
    }
    if (method === 'GET' && decoded.includes('/api/admin/media/placements/')) {
      return jsonResponse({ placement });
    }
    if (method === 'PATCH' && decoded.endsWith('/asset')) {
      const body = JSON.parse(options.body || '{}');
      writes.push({ url: decoded, method, body });
      placement = {
        ...placement,
        activeAssetId: body.assetId,
        mediaType: body.assetId ? 'image' : 'video',
        source: body.assetId
          ? 'https://storage.example.test/portada.jpg'
          : '/assets/VIDEO_LOGO_CRONOX.mp4',
        sourceFilename: body.assetId
          ? 'portada-anterior.jpg'
          : 'VIDEO_LOGO_CRONOX.mp4',
        poster: body.assetId ? null : '/assets/logo_banner.png',
        revision: placement.revision + 1,
      };
      return jsonResponse({ placement });
    }
    if (method === 'PATCH' || method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      writes.push({ url: decoded, method, body });
      const framing =
        method === 'POST'
          ? { desktop: baseline, tablet: null, mobile: null }
          : {
              desktop: body.desktop,
              tablet: body.tablet ?? null,
              mobile: body.mobile ?? null,
            };
      placement = {
        ...placement,
        framing,
        heroText: body.heroText || placement.heroText,
        revision: placement.revision + 1,
        status: method === 'POST' ? 'DEFAULT' : 'RESPONSIVE_CUSTOM',
      };
      return jsonResponse({ placement });
    }
    return jsonResponse({ message: 'Not found' }, 404);
  });

  Object.defineProperty(dom.window, 'innerWidth', {
    value: 1440,
    writable: true,
  });
  Object.defineProperty(dom.window, 'innerHeight', {
    value: 900,
    writable: true,
  });
  Object.defineProperty(dom.window, 'fetch', { value: fetchMock });
  Object.defineProperty(dom.window, 'confirm', {
    value: jest.fn().mockReturnValue(true),
  });
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: jest.fn(),
  });
  Object.defineProperty(dom.window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: jest.fn().mockResolvedValue(undefined),
  });
  defineVideoDimensions(dom);
  const stage = dom.window.document.getElementById('mediaPreviewStage')!;
  stage.getBoundingClientRect = () => ({ width: 720, height: 540 }) as DOMRect;
  const preview = dom.window.document.getElementById('mediaPreviewFrame')!;
  preview.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 720, height: 450 }) as DOMRect;
  (preview as any).setPointerCapture = jest.fn();
  (preview as any).releasePointerCapture = jest.fn();
  (preview as any).hasPointerCapture = jest.fn().mockReturnValue(true);
  const heroText = dom.window.document.getElementById('mediaHeroTextPreview')!;
  heroText.getBoundingClientRect = () =>
    ({
      left: Number.parseFloat(heroText.style.left) || 0,
      top: Number.parseFloat(heroText.style.top) || 0,
      width: 180,
      height: 40,
    }) as DOMRect;
  (heroText as any).setPointerCapture = jest.fn();
  (heroText as any).releasePointerCapture = jest.fn();
  (heroText as any).hasPointerCapture = jest.fn().mockReturnValue(true);
  (dom.window as any).CRONOX_API = {
    API_BASE: '',
    getCsrfHeaders: jest
      .fn()
      .mockResolvedValue({ 'X-CSRF-Token': 'csrf-token' }),
  };
  dom.window.eval(geometryScript);
  dom.window.eval(adminScript);
  return { dom, fetchMock, writes, getPlacement: () => placement };
};

const openHeroEditor = async (dom: JSDOM) => {
  const document = dom.window.document;
  (
    document.querySelector(
      '[data-nav-target="section-media"]',
    ) as HTMLButtonElement
  ).click();
  await flushAsync();
  await flushAsync();
  (
    document.querySelector(
      '[data-media-placement="home.hero.video"] button',
    ) as HTMLButtonElement
  ).click();
  await flushAsync();
  await flushAsync();
};

const pointerEvent = (
  dom: JSDOM,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
) => {
  const event = new dom.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
};

describe('Multimedia Web admin manager', () => {
  it('uses the corrected visible name, hero viewport UI, and shared engine', () => {
    const dom = new JSDOM(adminHtml);
    const document = dom.window.document;
    expect(
      document.querySelector('[data-nav-target="section-media"]')?.textContent,
    ).toContain('Multimedia Web');
    expect(document.getElementById('title-media')?.textContent).toBe(
      'Multimedia Web',
    );
    expect(document.getElementById('mediaPreviewDimensions')).not.toBeNull();
    expect(document.getElementById('mediaHeroTextPreview')).not.toBeNull();
    expect(document.getElementById('mediaHeroTextControls')).not.toBeNull();
    expect(
      document.getElementById('mediaHeroChrome')?.textContent,
    ).not.toContain('NOS REGIT NOX');
    expect(adminHtml.indexOf('media-framing-geometry.js')).toBeLessThan(
      adminHtml.indexOf('admin-media.js'),
    );
    expect(adminStyles).toContain('touch-action: none');
    expect(adminStyles).toContain('prefers-reduced-motion');
  });

  it('loads lazily, renders only the hero, and reports reduced counts', async () => {
    const { dom, fetchMock } = makeAdminDom();
    const document = dom.window.document;
    expect(fetchMock).not.toHaveBeenCalled();
    (
      document.querySelector(
        '[data-nav-target="section-media"]',
      ) as HTMLButtonElement
    ).click();
    await flushAsync();
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.media-card')).toHaveLength(1);
    expect(document.querySelector('.media-card')?.textContent).toContain(
      'V\u00eddeo principal de portada',
    );
    expect(document.getElementById('mediaAdminStatus')?.textContent).toBe(
      '1 ubicaci\u00f3n web visible de 1.',
    );
    expect(
      document.querySelector('[data-media-folder="portadas"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('.media-asset video')?.getAttribute('poster'),
    ).toContain('logo_banner.png');
    const type = document.getElementById(
      'mediaTypeFilter',
    ) as HTMLSelectElement;
    type.value = 'image';
    type.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(document.querySelectorAll('.media-card')).toHaveLength(0);
    expect(
      document.querySelector('#mediaPlacementGrid .empty-state')?.textContent,
    ).toContain('No hay multimedia web');
  });

  it('changes the real transform for horizontal, vertical, and zoom inputs', async () => {
    const { dom } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const video = document.getElementById('mediaPreviewVideo') as HTMLElement;
    const focalX = document.getElementById('mediaFocalX') as HTMLInputElement;
    const focalY = document.getElementById('mediaFocalY') as HTMLInputElement;
    const zoom = document.getElementById('mediaZoom') as HTMLInputElement;

    expect(document.getElementById('mediaPreviewDimensions')?.textContent).toBe(
      'Escritorio \u00b7 1440 \u00d7 900 px',
    );
    const initialTransform = video.style.transform;
    focalX.value = '96';
    focalX.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const horizontalTransform = video.style.transform;
    expect(horizontalTransform).not.toBe(initialTransform);
    expect(document.getElementById('mediaFocalXValue')?.textContent).toBe(
      '96%',
    );

    focalY.value = '96';
    focalY.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const verticalTransform = video.style.transform;
    expect(verticalTransform).not.toBe(horizontalTransform);
    expect(document.getElementById('mediaFocalYValue')?.textContent).toBe(
      '96%',
    );

    const widthBeforeZoom = video.style.width;
    zoom.value = '2';
    zoom.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(video.style.width).not.toBe(widthBeforeZoom);
    expect(document.getElementById('mediaZoomValue')?.textContent).toBe(
      '2.00\u00d7',
    );
  });

  it('keeps unsaved desktop, tablet and mobile text settings independent', async () => {
    const { dom, writes } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const x = document.getElementById('mediaHeroTextX') as HTMLInputElement;
    const align = document.getElementById(
      'mediaHeroTextAlign',
    ) as HTMLSelectElement;
    const select = (device: string) =>
      (
        document.querySelector(
          `[data-hero-text-device="${device}"]`,
        ) as HTMLButtonElement
      ).click();

    x.value = '12';
    x.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    align.value = 'LEFT';
    align.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    select('tablet');
    expect(x.value).toBe('50');
    expect(align.value).toBe('CENTER');
    x.value = '64';
    x.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    select('mobile');
    expect(x.value).toBe('85');
    x.value = '91';
    x.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    select('desktop');
    expect(x.value).toBe('12');
    expect(align.value).toBe('LEFT');
    expect(document.getElementById('mediaEditorDirty')?.hidden).toBe(false);

    (document.getElementById('mediaEditorSave') as HTMLButtonElement).click();
    await flushAsync();
    expect(writes.at(-1)?.body.heroText).toMatchObject({
      desktop: { x: 12, align: 'LEFT' },
      tablet: { x: 64, align: 'CENTER' },
      mobile: { x: 91 },
    });
  });

  it('moves only hero text with pointer and keyboard without changing media framing', async () => {
    const { dom } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const text = document.getElementById('mediaHeroTextPreview') as HTMLElement;
    const x = document.getElementById('mediaHeroTextX') as HTMLInputElement;
    const y = document.getElementById('mediaHeroTextY') as HTMLInputElement;
    const frameBefore = structuredClone(
      (dom.window as any).CRONOX_ADMIN_MEDIA.state.draft,
    );

    text.dispatchEvent(pointerEvent(dom, 'pointerdown', 7, 80, 80));
    text.dispatchEvent(pointerEvent(dom, 'pointermove', 7, 620, 400));
    text.dispatchEvent(pointerEvent(dom, 'pointerup', 7, 620, 400));
    expect(Number(x.value)).toBeGreaterThan(70);
    expect(Number(y.value)).toBeGreaterThan(70);

    const beforeKeyboard = Number(x.value);
    text.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(Number(x.value)).toBe(beforeKeyboard - 5);
    expect((dom.window as any).CRONOX_ADMIN_MEDIA.state.draft).toEqual(
      frameBefore,
    );
  });

  it('keeps viewport text fixed when media crop, zoom and fit change', async () => {
    const { dom } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const text = document.getElementById('mediaHeroTextPreview') as HTMLElement;
    const before = { left: text.style.left, top: text.style.top };
    const zoom = document.getElementById('mediaZoom') as HTMLInputElement;
    const fit = document.getElementById('mediaFit') as HTMLSelectElement;
    zoom.value = '2.4';
    zoom.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    fit.value = 'CONTAIN';
    fit.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect({ left: text.style.left, top: text.style.top }).toEqual(before);
  });

  it('shows the PORTADAS/Fotos/Vídeos archive and reuses an old photo', async () => {
    const { dom, writes } = makeAdminDom();
    const document = dom.window.document;
    (
      document.querySelector(
        '[data-nav-target="section-media"]',
      ) as HTMLButtonElement
    ).click();
    await flushAsync();
    await flushAsync();

    expect(
      document.querySelector('[data-media-folder="portadas"]')?.textContent,
    ).toContain('Fotos (1)');
    expect(
      document.querySelector('[data-media-folder="portadas"]')?.textContent,
    ).toContain('Vídeos (1)');
    const oldPhoto = document.querySelector(
      '[data-media-asset="asset-photo"] .btn',
    ) as HTMLButtonElement;
    expect(oldPhoto.textContent).toBe('Usar en portada');
    oldPhoto.click();
    await flushAsync();
    await flushAsync();

    expect(writes[0]).toMatchObject({
      method: 'PATCH',
      body: { assetId: 'asset-photo', expectedRevision: 3 },
    });
    expect(writes[0].url).toContain('/placements/home.hero.video/asset');
    expect(document.querySelector('.media-card img')).not.toBeNull();
    expect(document.querySelector('.media-card')?.textContent).toContain(
      'portada-anterior.jpg',
    );
  });

  it('keeps device drafts, inheritance, realistic dimensions, and axis state synchronized', async () => {
    const { dom } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const focalX = document.getElementById('mediaFocalX') as HTMLInputElement;
    (
      document.querySelector(
        '[data-media-device="mobile"]',
      ) as HTMLButtonElement
    ).click();
    expect(document.getElementById('mediaPreviewDimensions')?.textContent).toBe(
      'M\u00f3vil \u00b7 390 \u00d7 844 px',
    );
    const inherit = document.getElementById(
      'mediaInheritGeneral',
    ) as HTMLInputElement;
    expect(inherit.checked).toBe(true);
    expect(focalX.disabled).toBe(true);
    inherit.checked = false;
    inherit.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(focalX.disabled).toBe(false);
    focalX.value = '70';
    focalX.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    (
      document.querySelector(
        '[data-media-device="tablet"]',
      ) as HTMLButtonElement
    ).click();
    expect(document.getElementById('mediaPreviewDimensions')?.textContent).toBe(
      'Tablet \u00b7 768 \u00d7 1024 px',
    );
    (
      document.querySelector(
        '[data-media-device="mobile"]',
      ) as HTMLButtonElement
    ).click();
    expect(focalX.value).toBe('70');
  });

  it('maps pointer dragging to the same focal values and captures the pointer', async () => {
    const { dom } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    const preview = document.getElementById('mediaPreviewFrame') as HTMLElement;
    const focalX = document.getElementById('mediaFocalX') as HTMLInputElement;
    const focalY = document.getElementById('mediaFocalY') as HTMLInputElement;
    const beforeX = Number(focalX.value);
    const beforeY = Number(focalY.value);

    preview.dispatchEvent(pointerEvent(dom, 'pointerdown', 7, 300, 200));
    preview.dispatchEvent(pointerEvent(dom, 'pointermove', 7, 340, 240));
    expect((preview as any).setPointerCapture).toHaveBeenCalledWith(7);
    expect(Number(focalX.value)).not.toBe(beforeX);
    expect(Number(focalY.value)).not.toBe(beforeY);
    expect(
      (dom.window as any).CRONOX_ADMIN_MEDIA.state.draft.desktop.focalX,
    ).toBe(Number(focalX.value));
  });

  it('cancels without writing, then saves and reopens identical framing', async () => {
    const { dom, writes, getPlacement } = makeAdminDom();
    const document = dom.window.document;
    await openHeroEditor(dom);
    (document.getElementById('mediaEditorCancel') as HTMLButtonElement).click();
    expect(writes).toHaveLength(0);

    await openHeroEditor(dom);
    const zoom = document.getElementById('mediaZoom') as HTMLInputElement;
    zoom.value = '1.8';
    zoom.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    (document.getElementById('mediaEditorSave') as HTMLButtonElement).click();
    await flushAsync();
    await flushAsync();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: 'PATCH',
      body: { expectedRevision: 3 },
    });
    expect(writes[0].body.desktop.zoom).toBe(1.8);
    expect(getPlacement().framing.desktop.zoom).toBe(1.8);

    await openHeroEditor(dom);
    expect(
      (document.getElementById('mediaZoom') as HTMLInputElement).value,
    ).toBe('1.8');
  });

  it('reset all restores the verified cover/center/no-zoom baseline', async () => {
    const { dom, writes } = makeAdminDom();
    await openHeroEditor(dom);
    const document = dom.window.document;
    (document.getElementById('mediaResetAll') as HTMLButtonElement).click();
    expect(
      (document.getElementById('mediaFocalX') as HTMLInputElement).value,
    ).toBe('50');
    expect(
      (document.getElementById('mediaFocalY') as HTMLInputElement).value,
    ).toBe('50');
    expect(
      (document.getElementById('mediaZoom') as HTMLInputElement).value,
    ).toBe('1');
    expect(
      (document.getElementById('mediaFit') as HTMLSelectElement).value,
    ).toBe('COVER');
    (document.getElementById('mediaEditorSave') as HTMLButtonElement).click();
    await flushAsync();
    await flushAsync();
    expect(writes[0]).toMatchObject({ method: 'POST' });
  });
});

const makePublicDom = (
  fetchImpl: jest.Mock,
  viewport = { width: 1440, height: 900 },
  cached?: unknown,
) => {
  const dom = new JSDOM(
    '<!doctype html><html><body><section class="hero-video-section"><video class="hero-video" data-media-placement="home.hero.video"></video></section></body></html>',
    { url: 'https://store.example.test/', runScripts: 'outside-only' },
  );
  Object.defineProperty(dom.window, 'innerWidth', { value: viewport.width });
  Object.defineProperty(dom.window, 'innerHeight', { value: viewport.height });
  Object.defineProperty(dom.window, 'matchMedia', {
    value: jest.fn((query: string) => {
      const maximum = Number(query.match(/max-width:\s*(\d+)px/)?.[1]);
      return {
        media: query,
        matches: Number.isFinite(maximum) && viewport.width <= maximum,
        addEventListener: jest.fn(),
        addListener: jest.fn(),
      };
    }),
  });
  Object.defineProperty(dom.window, 'fetch', { value: fetchImpl });
  defineVideoDimensions(dom);
  const section = dom.window.document.querySelector('section')!;
  section.getBoundingClientRect = () =>
    ({ width: viewport.width, height: viewport.height }) as DOMRect;
  (dom.window as any).CRONOX_API = { API_BASE: '' };
  if (cached) {
    dom.window.localStorage.setItem(
      'cronox.mediaFraming.web.v4',
      JSON.stringify(cached),
    );
  }
  dom.window.eval(geometryScript);
  dom.window.eval(publicScript);
  return { dom };
};

describe('public hero framing', () => {
  it('renders no hero text by default and uses textContent for enabled plain text', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        version: 3,
        placements: {
          'home.hero.video': {
            desktop: baseline,
            tablet: null,
            mobile: null,
            source: '/assets/VIDEO_LOGO_CRONOX.mp4',
            poster: '/assets/logo_banner.png',
            mediaType: 'video',
            heroText: {
              enabled: true,
              content: '<img src=x onerror=alert(1)>',
              x: 25,
              y: 70,
              mobileX: 80,
              mobileY: 20,
              align: 'LEFT',
              color: '#112233',
              fontSize: 44,
              mobileFontSize: 22,
              fontWeight: 700,
              letterSpacing: 2,
              uppercase: false,
              maxWidth: 60,
            },
          },
        },
      }),
    );
    const { dom } = makePublicDom(fetchMock, { width: 390, height: 844 });
    await flushAsync();
    await flushAsync();
    const text = dom.window.document.querySelector(
      '.hero-overlay-text',
    ) as HTMLElement;
    expect(text.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(text.querySelector('img')).toBeNull();
    expect(text.style.fontSize).toBe('22px');
    expect(text.style.top).toBe('168.8px');

    const offline = makePublicDom(
      jest.fn().mockRejectedValue(new Error('offline')),
    );
    await flushAsync();
    await flushAsync();
    expect(
      offline.dom.window.document.querySelector('.hero-overlay-text'),
    ).toBeNull();
  });

  it.each([
    [1440, 900, 'desktop', '52px', '0px', '0px'],
    [1024, 768, 'desktop', '52px', '0px', '0px'],
    [768, 1024, 'tablet', '38px', '384px', '1024px'],
    [390, 844, 'mobile', '24px', '390px', '422px'],
    [360, 800, 'mobile', '24px', '360px', '400px'],
  ])(
    'selects %s x %s %s hero text from the shared viewport engine',
    async (width, height, _device, fontSize, left, top) => {
      const fetchMock = jest.fn().mockResolvedValue(
        jsonResponse({
          version: 5,
          placements: {
            'home.hero.video': {
              desktop: baseline,
              tablet: baseline,
              mobile: baseline,
              source: '/assets/VIDEO_LOGO_CRONOX.mp4',
              mediaType: 'video',
              heroText: {
                enabled: true,
                content: 'Responsive hero',
                desktop: { ...heroViewport(52, 0, 0), align: 'LEFT' },
                tablet: { ...heroViewport(38, 50, 100), align: 'CENTER' },
                mobile: { ...heroViewport(24, 100, 50), align: 'RIGHT' },
              },
            },
          },
        }),
      );
      const { dom } = makePublicDom(fetchMock, { width, height });
      await flushAsync();
      await flushAsync();
      const text = dom.window.document.querySelector(
        '.hero-overlay-text',
      ) as HTMLElement;
      expect(text.style.fontSize).toBe(fontSize);
      expect(text.style.left).toBe(left);
      expect(text.style.top).toBe(top);
    },
  );

  it('uses the shared engine and applies the mobile override from one request', async () => {
    const mobile = { focalX: 65, focalY: 35, zoom: 1.4, fit: 'COVER' };
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        version: 3,
        placements: {
          'home.hero.video': {
            desktop: baseline,
            tablet: null,
            mobile,
            source: '/assets/VIDEO_LOGO_CRONOX.mp4',
            poster: '/assets/logo_banner.png',
            mediaType: 'video',
          },
        },
      }),
    );
    const { dom } = makePublicDom(fetchMock, { width: 390, height: 844 });
    await flushAsync();
    await flushAsync();
    const video = dom.window.document.querySelector('video') as HTMLElement;
    const engine = (dom.window as any).CRONOX_MEDIA_GEOMETRY;
    const expected = engine.calculate({
      frameWidth: 390,
      frameHeight: 844,
      mediaWidth: 1920,
      mediaHeight: 1080,
      ...mobile,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(video.style.transform).toBe(
      `translate3d(${expected.translateX}px, ${expected.translateY}px, 0)`,
    );
    expect(video.style.width).toBe(`${expected.renderedWidth}px`);
  });

  it('discards stale cache and restores safe defaults when the API fails', async () => {
    const cached = {
      placements: {
        'home.hero.video': {
          desktop: { focalX: 100, focalY: 100, zoom: 3, fit: 'CONTAIN' },
          tablet: null,
          mobile: null,
          source: 'https://storage.example.test/old.mp4',
          poster: null,
          mediaType: 'video',
        },
      },
    };
    const { dom } = makePublicDom(
      jest.fn().mockRejectedValue(new Error('offline')),
      { width: 1440, height: 900 },
      cached,
    );
    await flushAsync();
    await flushAsync();
    const video = dom.window.document.querySelector('video') as HTMLElement;
    const engine = (dom.window as any).CRONOX_MEDIA_GEOMETRY;
    const expected = engine.calculate({
      frameWidth: 1440,
      frameHeight: 900,
      mediaWidth: 1920,
      mediaHeight: 1080,
      ...baseline,
    });
    expect(video.style.transform).toBe(
      `translate3d(${expected.translateX}px, ${expected.translateY}px, 0)`,
    );
    expect(dom.window.document.documentElement.dataset.mediaFramingState).toBe(
      'default',
    );
    expect(
      dom.window.localStorage.getItem('cronox.mediaFraming.web.v4'),
    ).toBeNull();
  });

  it('can replace the public hero video with a reusable photo', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({
        version: 3,
        placements: {
          'home.hero.video': {
            desktop: baseline,
            tablet: null,
            mobile: null,
            source: 'https://storage.example.test/portada.jpg',
            poster: null,
            mediaType: 'image',
          },
        },
      }),
    );
    const { dom } = makePublicDom(fetchMock);
    await flushAsync();
    await flushAsync();

    const hero = dom.window.document.querySelector(
      '[data-media-placement="home.hero.video"]',
    );
    expect(hero?.tagName).toBe('IMG');
    expect(hero?.getAttribute('src')).toBe(
      'https://storage.example.test/portada.jpg',
    );
    expect(hero?.classList.contains('hero-video')).toBe(true);
  });

  it('loads framing assets only on the homepage and leaves Products/Gallery untouched', () => {
    expect(indexHtml).toContain('media-framing-geometry.js?v=5');
    expect(indexHtml).toContain('media-framing.js?v=5');
    expect(indexHtml).toContain('data-media-placement="home.hero.video"');
    expect(publicStyles).toContain(
      '.hero-video[data-media-placement="home.hero.video"]',
    );

    const excludedFiles = [
      'producto.html',
      'favorites.html',
      'profile.html',
      'cart.html',
      'checkout.html',
      'gallery.html',
      'assets/app.js',
      'assets/products.js',
      'assets/product-page.js',
      'assets/favorites.js',
      'assets/profile.js',
      'assets/cart.js',
      'assets/checkout.js',
      'assets/gallery.js',
    ];
    excludedFiles.forEach((file) => {
      const source = readFrontend(file);
      expect(source).not.toContain('data-media-placement');
      expect(source).not.toContain('media-framing.js');
      expect(source).not.toContain('media-framing.css');
    });
  });
});
