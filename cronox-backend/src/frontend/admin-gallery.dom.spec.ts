/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');
const adminHtml = readFrontend('admin.html');
const adminGalleryScript = readFrontend('assets/admin-gallery.js');
const adminGalleryStyles = readFrontend('assets/admin-gallery.css');

const definitions = [
  ['featured', 'grey'],
  ['slot-01', 'white'],
  ['slot-02', 'red'],
  ['slot-03', 'grey'],
  ['slot-04', 'white'],
  ['slot-05', 'grey'],
  ['slot-06', 'white'],
  ['slot-07', 'red'],
  ['slot-08', 'grey'],
  ['slot-09', 'red'],
  ['slot-10', 'grey'],
  ['slot-11', 'white'],
  ['slot-12', 'red'],
];

const oldAsset = {
  id: 'asset-old',
  imageUrl: 'https://storage.example.test/gallery/old.png',
  originalFilename: 'old.png',
  mimeType: 'image/png',
  fileSize: 128,
  width: 800,
  height: 800,
  createdAt: '2026-08-14T10:00:00.000Z',
};

const makeSlots = () =>
  definitions.map(([key, placeholderColor], displayOrder) => ({
    key,
    displayOrder,
    featured: displayOrder === 0,
    placeholderColor,
    focalX: 50,
    focalY: 50,
    zoom: 1,
    altText: '',
    instagramUrl: null,
    asset: null,
  }));

const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
});

const makeDom = (assets: any[] = [oldAsset]) => {
  const slots = makeSlots();
  const fetchMock = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url.endsWith('/api/admin/gallery/slots') &&
        (!init?.method || init.method === 'GET')
      ) {
        return jsonResponse({ slots });
      }
      if (url.endsWith('/api/admin/gallery/assets')) {
        return jsonResponse({ assets });
      }
      if (
        url.includes('/api/admin/gallery/slots/') &&
        init?.method === 'PATCH'
      ) {
        const key = decodeURIComponent(url.split('/').pop() || '');
        const body = JSON.parse(String(init.body || '{}'));
        const definition = slots.find((slot) => slot.key === key)!;
        const selected =
          assets.find((asset) => asset.id === body.assetId) || null;
        Object.assign(definition, body, { asset: selected });
        return jsonResponse({ slot: definition });
      }
      return jsonResponse({ message: 'Not found' }, 404);
    },
  );
  const dom = new JSDOM(adminHtml, {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/admin.html',
  });
  dom.window.fetch = fetchMock as unknown as typeof fetch;
  (dom.window as any).CRONOX_API = {
    API_BASE: 'http://localhost:3000',
    getCsrfHeaders: jest
      .fn()
      .mockResolvedValue({ 'X-CSRF-Token': 'csrf-gallery' }),
  };
  dom.window.eval(adminGalleryScript);
  return { dom, fetchMock, slots, assets };
};

describe('CRONOX admin gallery', () => {
  it('adds the module, editor labels, and exact responsive 13-slot composition', () => {
    const document = new JSDOM(adminHtml).window.document;

    expect(
      document.querySelector('[data-nav-target="section-gallery"]')
        ?.textContent,
    ).toContain('Galería');
    expect(document.getElementById('section-gallery')).not.toBeNull();
    expect(document.getElementById('galleryUploadTitle')?.textContent).toBe(
      'Subir nueva foto',
    );
    expect(document.getElementById('galleryLibraryTitle')?.textContent).toBe(
      'Fotos antiguas',
    );
    expect(
      document.getElementById('galleryUploadInput')?.getAttribute('accept'),
    ).toBe('image/jpeg,image/png,image/webp');
    expect(
      document.getElementById('galleryUploadTitle')?.parentElement?.textContent,
    ).toContain('25 MB');
    expect(document.getElementById('galleryUploadProgress')).not.toBeNull();
    expect(adminGalleryScript).toContain(
      'const MAX_FILE_SIZE = 25 * 1024 * 1024',
    );
    expect(adminGalleryStyles).toMatch(
      /grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/,
    );
    expect(adminGalleryStyles).toMatch(
      /\.gallery-admin-slot--featured\s*\{[^}]*grid-column:\s*span 2;[^}]*grid-row:\s*span 3;/,
    );
    expect(adminGalleryStyles).toContain('@media (pointer: coarse)');
    expect(adminGalleryStyles).toMatch(
      /\.gallery-admin-slot:hover::after[\s\S]*opacity:\s*1/,
    );
    expect(adminGalleryStyles).toMatch(
      /@media[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/,
    );
  });

  it('loads exactly 13 editable slots and cancel leaves the slot unchanged', async () => {
    const { dom, fetchMock } = makeDom();
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();

    const document = dom.window.document;
    const buttons = document.querySelectorAll('[data-gallery-slot]');
    expect(buttons).toHaveLength(13);
    expect(
      document.querySelectorAll('.gallery-admin-slot--featured'),
    ).toHaveLength(1);
    expect(document.querySelectorAll('.gallery-admin-slot__edit')).toHaveLength(
      13,
    );
    expect(buttons[0].getAttribute('aria-label')).toContain(
      'Editar foto destacada',
    );

    (buttons[0] as HTMLButtonElement).click();
    expect(
      document.getElementById('galleryEditorModal')?.classList.contains('show'),
    ).toBe(true);
    (document.getElementById('galleryFocalX') as HTMLInputElement).value = '12';
    document
      .getElementById('galleryFocalX')
      ?.dispatchEvent(new dom.window.Event('input'));
    (
      document.getElementById('galleryEditorCancel') as HTMLButtonElement
    ).click();
    (
      document.querySelector(
        '[data-gallery-slot="featured"]',
      ) as HTMLButtonElement
    ).click();
    expect(
      (document.getElementById('galleryFocalX') as HTMLInputElement).value,
    ).toBe('50');
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
    ).toHaveLength(0);
    dom.window.close();
  });

  it('selects a reusable old photo and saves metadata and focal values', async () => {
    const { dom, fetchMock } = makeDom();
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;

    (
      document.querySelector(
        '[data-gallery-slot="slot-01"]',
      ) as HTMLButtonElement
    ).click();
    (
      document.querySelector(
        '[data-gallery-asset="asset-old"]',
      ) as HTMLButtonElement
    ).click();
    const alt = document.getElementById('galleryAltText') as HTMLInputElement;
    const focalX = document.getElementById('galleryFocalX') as HTMLInputElement;
    const zoom = document.getElementById('galleryZoom') as HTMLInputElement;
    alt.value = 'Cliente con camiseta CRONOX';
    alt.dispatchEvent(new dom.window.Event('input'));
    focalX.value = '35';
    focalX.dispatchEvent(new dom.window.Event('input'));
    zoom.value = '1.75';
    zoom.dispatchEvent(new dom.window.Event('input'));
    (document.getElementById('galleryEditorSave') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      assetId: 'asset-old',
      altText: 'Cliente con camiseta CRONOX',
      focalX: 35,
      zoom: 1.75,
    });
    const savedTile = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-01"]',
    );
    expect(savedTile?.querySelector('img')?.src).toBe(oldAsset.imageUrl);
    expect(savedTile?.style.getPropertyValue('--focal-x')).toBe('35%');
    expect(
      document.getElementById('galleryEditorModal')?.classList.contains('show'),
    ).toBe(false);
    dom.window.close();
  });

  it('shows upload progress, prevents duplicate uploads, and keeps uploads in Fotos antiguas', async () => {
    const { dom } = makeDom([]);
    const instances: FakeRequest[] = [];
    class FakeRequest {
      status = 0;
      responseText = '';
      withCredentials = false;
      listeners: Record<string, () => void> = {};
      uploadListeners: Record<string, (event: any) => void> = {};
      upload = {
        addEventListener: (name: string, callback: (event: any) => void) => {
          this.uploadListeners[name] = callback;
        },
      };
      constructor() {
        instances.push(this);
      }
      open() {}
      setRequestHeader() {}
      addEventListener(name: string, callback: () => void) {
        this.listeners[name] = callback;
      }
      send() {}
    }
    (dom.window as any).XMLHttpRequest = FakeRequest;
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;
    (
      document.querySelector(
        '[data-gallery-slot="featured"]',
      ) as HTMLButtonElement
    ).click();
    const input = document.getElementById(
      'galleryUploadInput',
    ) as HTMLInputElement;
    const oversizedFile = new dom.window.File(['png'], 'too-large.png', {
      type: 'image/png',
    });
    Object.defineProperty(oversizedFile, 'size', {
      configurable: true,
      value: 25 * 1024 * 1024 + 1,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [oversizedFile],
    });
    input.dispatchEvent(new dom.window.Event('change'));
    await Promise.resolve();
    expect(instances).toHaveLength(0);
    expect(
      document.getElementById('galleryEditorMessage')?.textContent,
    ).toContain('25 MB');

    const file = new dom.window.File(['png'], 'new.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: 25 * 1024 * 1024,
    });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file],
    });
    input.dispatchEvent(new dom.window.Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(instances).toHaveLength(1);
    const progress = document.getElementById(
      'galleryUploadProgress',
    ) as HTMLProgressElement;
    instances[0].uploadListeners.progress({
      lengthComputable: true,
      loaded: 4,
      total: 8,
    });
    expect(progress.hidden).toBe(false);
    expect(progress.value).toBe(50);
    input.dispatchEvent(new dom.window.Event('change'));
    expect(instances).toHaveLength(1);

    instances[0].status = 201;
    instances[0].responseText = JSON.stringify({
      asset: { ...oldAsset, id: 'asset-new', originalFilename: 'new.png' },
    });
    instances[0].listeners.load();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelectorAll('[data-gallery-asset]')).toHaveLength(1);
    expect(
      document
        .querySelector('[data-gallery-asset="asset-new"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(gallery.state.assets).toHaveLength(1);
    (
      document.getElementById('galleryEditorCancel') as HTMLButtonElement
    ).click();
    (
      document.querySelector(
        '[data-gallery-slot="featured"]',
      ) as HTMLButtonElement
    ).click();
    expect(
      document.querySelector('[data-gallery-asset="asset-new"]'),
    ).not.toBeNull();
    dom.window.close();
  });
});
