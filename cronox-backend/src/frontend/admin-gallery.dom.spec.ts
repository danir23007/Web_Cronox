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
  description: null,
  products: [],
  createdAt: '2026-08-14T10:00:00.000Z',
};

const repositoryProducts = [
  {
    id: 1,
    slug: 'grey-core-tee',
    name: 'GREY-CORE TEE',
    price: 3495,
    currency: 'EUR',
    imageUrl: 'https://storage.example.test/products/grey.png',
    available: true,
  },
  {
    id: 2,
    slug: 'archive-tee',
    name: 'ARCHIVE TEE',
    price: 2995,
    currency: 'EUR',
    imageUrl: 'https://storage.example.test/products/archive.png',
    available: false,
  },
];

const secondAsset = {
  ...oldAsset,
  id: 'asset-second',
  imageUrl: 'https://storage.example.test/gallery/second.webp',
  originalFilename: 'second.webp',
  mimeType: 'image/webp',
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

const galleryContent = (slot: any) => ({
  asset: slot.asset,
  altText: slot.altText,
  instagramUrl: slot.instagramUrl,
  focalX: slot.focalX,
  focalY: slot.focalY,
  zoom: slot.zoom,
});

const emptyGalleryContent = () => ({
  asset: null,
  altText: '',
  instagramUrl: null,
  focalX: 50,
  focalY: 50,
  zoom: 1,
});

const assignSlot = (
  slots: any[],
  key: string,
  asset: any,
  metadata: Record<string, unknown> = {},
) => {
  Object.assign(
    slots.find((slot) => slot.key === key),
    {
      asset,
      altText: `Texto alternativo ${asset.id}`,
      instagramUrl: `https://www.instagram.com/p/${asset.id}/`,
      focalX: 25,
      focalY: 75,
      zoom: 1.5,
    },
    metadata,
  );
};

const clickEdit = (document: Document, key: string) => {
  (
    document.querySelector(
      `[data-gallery-slot="${key}"] .gallery-admin-slot__edit`,
    ) as HTMLButtonElement
  ).click();
};

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

class GalleryDataTransfer {
  effectAllowed = 'uninitialized';
  dropEffect = 'none';
  private readonly values = new Map<string, string>();
  readonly setData = jest.fn((type: string, value: string) => {
    this.values.set(type, value);
  });
  readonly getData = jest.fn((type: string) => this.values.get(type) || '');
  readonly clearData = jest.fn((type?: string) => {
    if (type) this.values.delete(type);
    else this.values.clear();
  });
  readonly setDragImage = jest.fn();
  get types() {
    return Array.from(this.values.keys());
  }
}

const dragEvent = (
  dom: JSDOM,
  type: string,
  dataTransfer: GalleryDataTransfer,
  options: {
    clientX?: number;
    clientY?: number;
    relatedTarget?: EventTarget | null;
  } = {},
) => {
  const event = new dom.window.Event(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: options.clientX ?? 0 },
    clientY: { value: options.clientY ?? 0 },
    relatedTarget: { value: options.relatedTarget ?? null },
  });
  return event;
};

const makeDom = (assets: any[] = [oldAsset]) => {
  const slots = makeSlots();
  const server = {
    failNextReorder: false,
    failNextSave: false,
    reorderCalls: 0,
    saveCalls: 0,
  };
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
        return jsonResponse({
          assets,
          page: 1,
          total: assets.length,
          totalPages: 1,
        });
      }
      if (url.includes('/api/admin/gallery/assets?')) {
        const parsed = new URL(url);
        const page = Number(parsed.searchParams.get('page')) || 1;
        const limit = Number(parsed.searchParams.get('limit')) || 24;
        return jsonResponse({
          assets: assets.slice((page - 1) * limit, page * limit),
          page,
          limit,
          total: assets.length,
          totalPages: Math.max(1, Math.ceil(assets.length / limit)),
        });
      }
      if (url.includes('/api/admin/gallery/assets/')) {
        const id = decodeURIComponent(url.split('/').pop() || '');
        const asset = assets.find((item) => item.id === id);
        return asset
          ? jsonResponse({ asset })
          : jsonResponse({ message: 'Foto no encontrada' }, 404);
      }
      if (url.includes('/api/admin/gallery/products?')) {
        const search =
          new URL(url).searchParams.get('search')?.toLowerCase() || '';
        const products = repositoryProducts.filter((product) =>
          `${product.name} ${product.slug}`.toLowerCase().includes(search),
        );
        return jsonResponse({
          products,
          page: 1,
          limit: 20,
          total: products.length,
          totalPages: 1,
        });
      }
      if (
        url.endsWith('/api/admin/gallery/slots/reorder') &&
        init?.method === 'PATCH'
      ) {
        server.reorderCalls += 1;
        if (server.failNextReorder) {
          server.failNextReorder = false;
          return jsonResponse({ message: 'No se pudo guardar el orden' }, 500);
        }
        const { sourceKey, targetKey } = JSON.parse(String(init.body || '{}'));
        const source = slots.find((slot) => slot.key === sourceKey);
        const target = slots.find((slot) => slot.key === targetKey);
        if (!source?.asset || !target || sourceKey === targetKey) {
          return jsonResponse({ message: 'Movimiento no v\u00e1lido' }, 400);
        }
        const sourceContent = galleryContent(source);
        const targetContent = target.asset
          ? galleryContent(target)
          : emptyGalleryContent();
        const operation = target.asset ? 'swap' : 'move';
        Object.assign(source, targetContent);
        Object.assign(target, sourceContent);
        return jsonResponse({ operation, sourceKey, targetKey, slots });
      }
      if (
        url.includes('/api/admin/gallery/slots/') &&
        init?.method === 'PATCH'
      ) {
        server.saveCalls += 1;
        if (server.failNextSave) {
          server.failNextSave = false;
          return jsonResponse({ message: 'Fallo atomico simulado' }, 500);
        }
        const key = decodeURIComponent(url.split('/').pop() || '');
        const body = JSON.parse(String(init.body || '{}'));
        const definition = slots.find((slot) => slot.key === key)!;
        const selected =
          assets.find((asset) => asset.id === body.assetId) || null;
        if (selected) {
          selected.description = String(body.description || '').trim() || null;
          selected.products = (body.productIds || [])
            .map((id: number) =>
              repositoryProducts.find((product) => product.id === id),
            )
            .filter(Boolean);
        }
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
  return { dom, fetchMock, slots, assets, server };
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
    expect(document.getElementById('galleryMoveModal')).toBeNull();
    expect(document.getElementById('galleryMoveDestination')).toBeNull();
    expect(adminHtml).toContain('assets/admin-gallery.css?v=4');
    expect(adminHtml).toContain('assets/admin-gallery.js?v=4');
    expect(document.getElementById('galleryProductsTitle')?.textContent).toBe(
      'Productos de la imagen',
    );
    expect(
      document.getElementById('galleryDescriptionTitle')?.textContent,
    ).toBe('Texto de la imagen');
    expect(
      document.getElementById('galleryDescription')?.getAttribute('maxlength'),
    ).toBe('2000');
    expect(document.getElementById('galleryLibraryModal')).not.toBeNull();
    expect(document.getElementById('section-gallery')?.textContent).not.toMatch(
      /MOVER|ARRASTRAR|Mover foto/,
    );
    expect(adminGalleryScript).not.toMatch(/MOVER|ARRASTRAR|Mover foto/);
    expect(adminGalleryStyles).not.toMatch(/MOVER|ARRASTRAR|Mover foto/);
    expect(adminGalleryScript).toContain(
      'const MAX_FILE_SIZE = 25 * 1024 * 1024',
    );
    expect(adminGalleryScript).toContain('/api/admin/gallery/slots/reorder');
    expect(adminGalleryStyles).toContain('cursor: grab');
    expect(adminGalleryStyles).toContain('cursor: grabbing');
    expect(adminGalleryStyles).toContain(
      '@media (prefers-reduced-motion: reduce)',
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
    expect(
      buttons[0]
        .querySelector('.gallery-admin-slot__edit')
        ?.getAttribute('aria-label'),
    ).toContain('Editar foto destacada');

    clickEdit(document, 'featured');
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
    clickEdit(document, 'featured');
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

    clickEdit(document, 'slot-01');
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

  it('swaps occupied tiles through native drag and keeps all metadata with each photo', async () => {
    const { dom, fetchMock, slots, assets, server } = makeDom([
      oldAsset,
      secondAsset,
    ]);
    assignSlot(slots, 'featured', oldAsset, {
      altText: 'Retrato destacado',
      instagramUrl: 'https://www.instagram.com/p/retrato/',
      focalX: 11,
      focalY: 22,
      zoom: 1.25,
    });
    assignSlot(slots, 'slot-05', secondAsset, {
      altText: 'Retrato cinco',
      instagramUrl: 'https://www.instagram.com/p/cinco/',
      focalX: 77,
      focalY: 88,
      zoom: 2.25,
    });
    const assetSnapshot = JSON.stringify(assets);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;
    const source = document.querySelector<HTMLElement>(
      '[data-gallery-slot="featured"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-05"]',
    )!;
    const dataTransfer = new GalleryDataTransfer();
    const dragStart = dragEvent(dom, 'dragstart', dataTransfer, {
      clientX: 120,
      clientY: 90,
    });
    const dragOver = dragEvent(dom, 'dragover', dataTransfer);
    const drop = dragEvent(dom, 'drop', dataTransfer);

    expect(source.getAttribute('draggable')).toBe('true');
    expect(source.querySelector('img')?.getAttribute('draggable')).toBe(
      'false',
    );
    source.dispatchEvent(dragStart);
    expect(source.classList.contains('is-dragging')).toBe(true);
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'featured');
    expect(dataTransfer.getData('text/plain')).toBe('featured');
    expect(dataTransfer.setDragImage).toHaveBeenCalled();
    target.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('move');
    expect(target.classList.contains('is-drop-target')).toBe(true);
    target.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    source.dispatchEvent(dragEvent(dom, 'dragend', dataTransfer));
    await flushAsync();

    expect(server.reorderCalls).toBe(1);
    const reorderCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/admin/gallery/slots/reorder'),
    );
    expect(JSON.parse(String(reorderCall?.[1]?.body))).toEqual({
      sourceKey: 'featured',
      targetKey: 'slot-05',
    });
    expect(gallery.state.slots[0]).toMatchObject({
      key: 'featured',
      featured: true,
      displayOrder: 0,
      placeholderColor: 'grey',
      asset: { id: 'asset-second' },
      altText: 'Retrato cinco',
      instagramUrl: 'https://www.instagram.com/p/cinco/',
      focalX: 77,
      focalY: 88,
      zoom: 2.25,
    });
    expect(gallery.state.slots[5]).toMatchObject({
      key: 'slot-05',
      featured: false,
      displayOrder: 5,
      asset: { id: 'asset-old' },
      altText: 'Retrato destacado',
      instagramUrl: 'https://www.instagram.com/p/retrato/',
      focalX: 11,
      focalY: 22,
      zoom: 1.25,
    });
    expect(
      document.querySelector(
        '[data-gallery-slot="featured"].gallery-admin-slot--featured',
      ),
    ).not.toBeNull();
    expect(document.getElementById('galleryAdminStatus')?.textContent).toBe(
      'Posiciones Destacada y 05 intercambiadas.',
    );
    expect(JSON.stringify(assets)).toBe(assetSnapshot);
    dom.window.close();
  });

  it('moves an occupied tile to an empty position through the delegated native sequence', async () => {
    const { dom, slots, server } = makeDom();
    assignSlot(slots, 'slot-01', oldAsset, {
      altText: 'Foto que se mueve',
      focalX: 33,
      focalY: 44,
      zoom: 1.8,
    });
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;

    expect(
      document
        .querySelector('[data-gallery-slot="slot-01"]')
        ?.getAttribute('draggable'),
    ).toBe('true');
    expect(
      document
        .querySelector('[data-gallery-slot="slot-02"]')
        ?.getAttribute('draggable'),
    ).toBe('false');
    const source = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-01"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-02"]',
    )!;
    const dataTransfer = new GalleryDataTransfer();
    source.dispatchEvent(dragEvent(dom, 'dragstart', dataTransfer));
    const dragOver = dragEvent(dom, 'dragover', dataTransfer);
    target.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);
    target.dispatchEvent(dragEvent(dom, 'drop', dataTransfer));
    source.dispatchEvent(dragEvent(dom, 'dragend', dataTransfer));
    await flushAsync();

    expect(server.reorderCalls).toBe(1);
    expect(gallery.state.slots[1]).toMatchObject({
      key: 'slot-01',
      asset: null,
      altText: '',
      instagramUrl: '',
      focalX: 50,
      focalY: 50,
      zoom: 1,
    });
    expect(gallery.state.slots[2]).toMatchObject({
      key: 'slot-02',
      asset: { id: 'asset-old' },
      altText: 'Foto que se mueve',
      focalX: 33,
      focalY: 44,
      zoom: 1.8,
    });
    expect(
      document
        .querySelector('[data-gallery-slot="slot-01"]')
        ?.getAttribute('draggable'),
    ).toBe('false');
    expect(document.getElementById('galleryAdminStatus')?.textContent).toBe(
      'Foto movida a la posici\u00f3n 02.',
    );
    dom.window.close();
  });

  it('rejects empty sources and cancels same-slot, outside-grid, and click-only gestures', async () => {
    const { dom, slots, server } = makeDom();
    assignSlot(slots, 'slot-01', oldAsset);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;
    const source = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-01"]',
    )!;
    const empty = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-02"]',
    )!;

    const emptyTransfer = new GalleryDataTransfer();
    const emptyStart = dragEvent(dom, 'dragstart', emptyTransfer);
    empty.dispatchEvent(emptyStart);
    expect(emptyStart.defaultPrevented).toBe(true);
    expect(emptyTransfer.setData).not.toHaveBeenCalled();

    const sameTransfer = new GalleryDataTransfer();
    source.dispatchEvent(dragEvent(dom, 'dragstart', sameTransfer));
    const sameOver = dragEvent(dom, 'dragover', sameTransfer);
    source.dispatchEvent(sameOver);
    expect(sameOver.defaultPrevented).toBe(false);
    source.dispatchEvent(dragEvent(dom, 'drop', sameTransfer));
    source.dispatchEvent(dragEvent(dom, 'dragend', sameTransfer));

    const outsideTransfer = new GalleryDataTransfer();
    source.dispatchEvent(dragEvent(dom, 'dragstart', outsideTransfer));
    expect(source.classList.contains('is-dragging')).toBe(true);
    source.dispatchEvent(dragEvent(dom, 'dragend', outsideTransfer));
    expect(source.classList.contains('is-dragging')).toBe(false);
    source.click();

    expect(server.reorderCalls).toBe(0);
    expect(gallery.state.slots[1].asset.id).toBe('asset-old');
    expect(
      document.querySelectorAll('.is-drop-target, .is-dragging'),
    ).toHaveLength(0);
    dom.window.close();
  });

  it('keeps pencil editing isolated from native dragging', async () => {
    const { dom, slots, server } = makeDom();
    assignSlot(slots, 'slot-01', oldAsset);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;
    const pencil = document.querySelector<HTMLButtonElement>(
      '[data-gallery-slot="slot-01"] .gallery-admin-slot__edit',
    )!;
    const pencilTransfer = new GalleryDataTransfer();
    const pencilDrag = dragEvent(dom, 'dragstart', pencilTransfer);

    pencil.dispatchEvent(pencilDrag);
    expect(pencilDrag.defaultPrevented).toBe(true);
    expect(pencilTransfer.setData).not.toHaveBeenCalled();
    expect(server.reorderCalls).toBe(0);
    pencil.click();
    expect(
      document.getElementById('galleryEditorModal')?.classList.contains('show'),
    ).toBe(true);
    (
      document.getElementById('galleryEditorCancel') as HTMLButtonElement
    ).click();
    expect(server.reorderCalls).toBe(0);
    dom.window.close();
  });

  it('keeps native dragging functional after the gallery replaces every slot during rerender', async () => {
    const { dom, slots, server } = makeDom();
    assignSlot(slots, 'slot-03', oldAsset);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const document = dom.window.document;
    const beforeRerender = document.querySelector(
      '[data-gallery-slot="slot-03"]',
    );

    await gallery.load(true);
    const source = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-03"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-05"]',
    )!;
    expect(source).not.toBe(beforeRerender);

    const dataTransfer = new GalleryDataTransfer();
    source.dispatchEvent(dragEvent(dom, 'dragstart', dataTransfer));
    target.dispatchEvent(dragEvent(dom, 'dragover', dataTransfer));
    target.dispatchEvent(dragEvent(dom, 'drop', dataTransfer));
    source.dispatchEvent(dragEvent(dom, 'dragend', dataTransfer));
    await flushAsync();

    expect(server.reorderCalls).toBe(1);
    expect(gallery.state.slots[5].asset.id).toBe('asset-old');
    dom.window.close();
  });

  it('restores the exact previous UI state when reorder persistence fails', async () => {
    const { dom, slots, assets, server } = makeDom([oldAsset, secondAsset]);
    assignSlot(slots, 'slot-07', oldAsset, {
      altText: 'Estado original siete',
      focalX: 13,
      focalY: 27,
      zoom: 1.3,
    });
    assignSlot(slots, 'slot-08', secondAsset, {
      altText: 'Estado original ocho',
      focalX: 73,
      focalY: 87,
      zoom: 2.3,
    });
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    const previousSlots = JSON.stringify(gallery.state.slots);
    const previousAssets = JSON.stringify(assets);
    server.failNextReorder = true;
    const document = dom.window.document;
    const source = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-07"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '[data-gallery-slot="slot-08"]',
    )!;
    const dataTransfer = new GalleryDataTransfer();
    source.dispatchEvent(dragEvent(dom, 'dragstart', dataTransfer));
    target.dispatchEvent(dragEvent(dom, 'dragover', dataTransfer));
    target.dispatchEvent(dragEvent(dom, 'drop', dataTransfer));
    source.dispatchEvent(dragEvent(dom, 'dragend', dataTransfer));
    await flushAsync();

    expect(JSON.stringify(gallery.state.slots)).toBe(previousSlots);
    expect(JSON.stringify(assets)).toBe(previousAssets);
    expect(
      dom.window.document.querySelector<HTMLImageElement>(
        '[data-gallery-slot="slot-07"] img',
      )?.src,
    ).toBe(oldAsset.imageUrl);
    expect(
      dom.window.document.getElementById('galleryAdminStatus')?.textContent,
    ).toContain('La disposici\u00f3n anterior se ha restaurado.');
    expect(
      document.querySelectorAll('.is-drop-target, .is-dragging'),
    ).toHaveLength(0);
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
    clickEdit(document, 'featured');
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
    clickEdit(document, 'featured');
    expect(
      document.querySelector('[data-gallery-asset="asset-new"]'),
    ).not.toBeNull();
    dom.window.close();
  });

  it('renders exactly three recent photos plus a capped and accurately labelled +N cell', async () => {
    const manyAssets = Array.from({ length: 150 }, (_, index) => ({
      ...oldAsset,
      id: `asset-${String(index).padStart(3, '0')}`,
      imageUrl: `https://storage.example.test/gallery/${index}.png`,
      originalFilename: `${index}.png`,
    }));
    const { dom } = makeDom(manyAssets);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    clickEdit(dom.window.document, 'featured');

    const compact = dom.window.document.getElementById('galleryAssetLibrary')!;
    expect(compact.children).toHaveLength(4);
    expect(compact.querySelectorAll('[data-gallery-asset]')).toHaveLength(3);
    const more = compact.querySelector<HTMLButtonElement>(
      '[data-gallery-library-more]',
    )!;
    expect(more.textContent).toBe('+99');
    expect(more.getAttribute('aria-label')).toContain('147');
    expect(more.disabled).toBe(false);
    dom.window.close();
  });

  it('keeps the fourth compact cell as disabled +0 when there are no extra photos', async () => {
    const { dom } = makeDom([oldAsset]);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    clickEdit(dom.window.document, 'featured');

    const compact = dom.window.document.getElementById('galleryAssetLibrary')!;
    const more = compact.querySelector<HTMLButtonElement>(
      '[data-gallery-library-more]',
    )!;
    expect(compact.children).toHaveLength(4);
    expect(more.textContent).toBe('+0');
    expect(more.disabled).toBe(true);
    dom.window.close();
  });

  it('opens the complete library and loads an old asset products plus text', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => ({
      ...oldAsset,
      id: `asset-${index}`,
      imageUrl: `https://storage.example.test/gallery/${index}.png`,
      originalFilename: `${index}.png`,
      description: index === 4 ? 'Texto guardado en la foto antigua' : null,
      products:
        index === 4 ? [repositoryProducts[1], repositoryProducts[0]] : [],
    }));
    const { dom } = makeDom(assets);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    clickEdit(dom.window.document, 'slot-01');
    (
      dom.window.document.querySelector(
        '[data-gallery-library-more]',
      ) as HTMLButtonElement
    ).click();
    await flushAsync();

    const modal = dom.window.document.getElementById('galleryLibraryModal')!;
    expect(modal.classList.contains('show')).toBe(true);
    expect(
      modal.querySelectorAll('#galleryLibraryGrid [data-gallery-asset]'),
    ).toHaveLength(5);
    (
      modal.querySelector('[data-gallery-asset="asset-4"]') as HTMLButtonElement
    ).click();
    await flushAsync();

    expect(modal.classList.contains('show')).toBe(false);
    expect(
      (
        dom.window.document.getElementById(
          'galleryDescription',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe('Texto guardado en la foto antigua');
    expect(gallery.state.selectedProductIds).toEqual([2, 1]);
    expect(
      dom.window.document.querySelectorAll('.gallery-selected-product'),
    ).toHaveLength(2);
    dom.window.close();
  });

  it('searches active and archived products while retaining selection and text count', async () => {
    const { dom, slots } = makeDom([oldAsset]);
    assignSlot(slots, 'slot-01', oldAsset);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    clickEdit(dom.window.document, 'slot-01');
    await flushAsync();

    const document = dom.window.document;
    expect(document.querySelectorAll('[data-gallery-product]')).toHaveLength(2);
    expect(
      document.getElementById('galleryProductRepository')?.textContent,
    ).toContain('ARCHIVADO');
    (
      document.querySelector('[data-gallery-product="1"]') as HTMLButtonElement
    ).click();
    const search = document.getElementById(
      'galleryProductSearch',
    ) as HTMLInputElement;
    search.value = 'archive';
    search.dispatchEvent(new dom.window.Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 280));
    await flushAsync();

    expect(document.querySelectorAll('[data-gallery-product]')).toHaveLength(1);
    expect(gallery.state.selectedProductIds).toEqual([1]);
    expect(
      document.querySelector('.gallery-selected-product')?.textContent,
    ).toContain('GREY-CORE TEE');
    const description = document.getElementById(
      'galleryDescription',
    ) as HTMLTextAreaElement;
    description.value = 'L\u00ednea uno\nL\u00ednea dos';
    description.dispatchEvent(new dom.window.Event('input'));
    expect(
      document.getElementById('galleryDescriptionCounter')?.textContent,
    ).toBe('19/2000');
    dom.window.close();
  });

  it('saves ordered product IDs with text and preserves the unsaved form after atomic failure', async () => {
    const { dom, slots, fetchMock, server } = makeDom([oldAsset]);
    assignSlot(slots, 'slot-01', oldAsset);
    const gallery = (dom.window as any).CRONOX_ADMIN_GALLERY;
    await gallery.load();
    clickEdit(dom.window.document, 'slot-01');
    await flushAsync();
    const document = dom.window.document;
    (
      document.querySelector('[data-gallery-product="2"]') as HTMLButtonElement
    ).click();
    (
      document.querySelector('[data-gallery-product="1"]') as HTMLButtonElement
    ).click();
    const description = document.getElementById(
      'galleryDescription',
    ) as HTMLTextAreaElement;
    description.value = 'Texto que debe sobrevivir al fallo';
    description.dispatchEvent(new dom.window.Event('input'));
    server.failNextSave = true;
    (document.getElementById('galleryEditorSave') as HTMLButtonElement).click();
    await flushAsync();

    expect(server.saveCalls).toBe(1);
    expect(
      document.getElementById('galleryEditorModal')?.classList.contains('show'),
    ).toBe(true);
    expect(description.value).toBe('Texto que debe sobrevivir al fallo');
    expect(gallery.state.selectedProductIds).toEqual([2, 1]);

    (document.getElementById('galleryEditorSave') as HTMLButtonElement).click();
    await flushAsync();
    const saveCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).includes('/api/admin/gallery/slots/slot-01') &&
        init?.method === 'PATCH',
    );
    const successfulBody = JSON.parse(String(saveCalls[1]?.[1]?.body));
    expect(successfulBody).toMatchObject({
      description: 'Texto que debe sobrevivir al fallo',
      productIds: [2, 1],
    });
    expect(
      document.getElementById('galleryEditorModal')?.classList.contains('show'),
    ).toBe(false);
    dom.window.close();
  });
});
