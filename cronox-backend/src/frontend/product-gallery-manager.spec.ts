/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('product image gallery manager integration', () => {
  it('selects each thumbnail and keeps framing independent while reordering', () => {
    const html = read('admin.html');
    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'http://localhost/admin.html',
    });
    const app = dom.window as any;
    app.CRONOX_SECURITY = { productImageUrl: (value: string) => value };
    app.confirm = jest.fn().mockReturnValue(true);
    app.eval(read('assets/media-framing-geometry.js'));
    app.eval(read('assets/admin-product-gallery.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    app.CRONOX_PRODUCT_GALLERY.load({
      id: 8,
      updatedAt: '2026-09-17T10:00:00.000Z',
      images: [
        {
          id: 1,
          url: 'https://storage.example.test/a.png',
          sortOrder: 0,
          isPrimary: true,
          isActive: true,
          galleryPositionX: 15,
          galleryPositionY: 25,
          galleryZoom: 1,
          galleryFit: 'CONTAIN',
        },
        {
          id: 2,
          url: 'https://storage.example.test/b.png',
          sortOrder: 1,
          isPrimary: false,
          isActive: true,
          galleryPositionX: 75,
          galleryPositionY: 85,
          galleryZoom: 1.5,
          galleryFit: 'COVER',
        },
      ],
    });

    const thumbs = dom.window.document.querySelectorAll<HTMLButtonElement>(
      '.product-gallery-thumb',
    );
    expect(thumbs).toHaveLength(2);
    thumbs[1].click();
    const x = dom.window.document.getElementById(
      'productGalleryPositionX',
    ) as HTMLInputElement;
    expect(x.value).toBe('75');
    x.value = '33';
    x.dispatchEvent(new dom.window.Event('input'));
    (
      dom.window.document.getElementById(
        'productGalleryPrimary',
      ) as HTMLButtonElement
    ).click();

    const serialized = app.CRONOX_PRODUCT_GALLERY.serialize();
    expect(serialized[0]).toMatchObject({
      id: 2,
      sortOrder: 0,
      isPrimary: true,
      galleryPositionX: 33,
      galleryPositionY: 85,
    });
    expect(serialized[1]).toMatchObject({
      id: 1,
      sortOrder: 1,
      isPrimary: false,
      galleryPositionX: 15,
      galleryPositionY: 25,
    });

    (
      dom.window.document.getElementById(
        'productGalleryArchive',
      ) as HTMLButtonElement
    ).click();
    expect(app.CRONOX_PRODUCT_GALLERY.serialize()[0]).toMatchObject({
      id: 1,
      sortOrder: 0,
      isPrimary: true,
      isActive: true,
    });
    const restore = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>(
        '#productGalleryHistoryGrid button',
      ),
    ).find((button) => button.textContent?.includes('Añadir de nuevo'))!;
    restore.click();
    expect(app.CRONOX_PRODUCT_GALLERY.serialize()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          sortOrder: 0,
          isPrimary: true,
          isActive: true,
        }),
        expect.objectContaining({
          id: 2,
          sortOrder: 1,
          isPrimary: false,
          isActive: true,
        }),
      ]),
    );
    dom.window.close();
  });

  it('exposes every accessible gallery action and keeps card framing separate', () => {
    const html = read('admin.html');
    expect(html).toContain('Galería del producto');
    expect(html).toContain('Texto alternativo (SEO)');
    expect(html).toContain('Mover a la izquierda');
    expect(html).toContain('Mover a la derecha');
    expect(html).toContain('Quitar de la galería');
    expect(html).toContain('Ver historial de imágenes');
    expect(read('assets/admin-product-gallery.js')).toContain(
      'Eliminar definitivamente',
    );
    expect(html).toContain('id="productCardFramingEditor"');
    expect(html).toContain('assets/admin-product-gallery.js?v=1');
  });

  it('implements deterministic primary replacement, restore and duplicate prevention', () => {
    const script = read('assets/admin-product-gallery.js');
    expect(script).toContain('ordered.length <= 1');
    expect(script).toContain('const replacement = active()[0]');
    expect(script).toContain('image.isActive = true');
    expect(script).toContain('!existing.has(image.url)');
    expect(script).toContain('cronox:primary-image-changed');
  });

  it('maps public image metadata and renders saved order, alt and framing', () => {
    const api = read('src/admin/api.ts');
    const productPage = read('assets/product-page.js');
    expect(api).toContain('galleryImages');
    expect(api).toContain('galleryPositionX');
    expect(productPage).toContain(
      'p?.galleryImages?.length ? p.galleryImages : p?.images',
    );
    expect(productPage).toContain('const alt = item.alt ||');
    expect(productPage).toContain('image.style.objectPosition');
    expect(productPage).toContain(
      'image.style.transform = `scale(${item.galleryZoom})`',
    );
    expect(productPage).toContain('if (pMediaPrev) pMediaPrev.hidden = single');
  });

  it('ships a forward-only migration with legacy repair and database constraints', () => {
    const sql = readFileSync(
      path.resolve(
        root,
        '../cronox-backend/prisma/migrations/20260917120000_product_image_gallery_manager/migration.sql',
      ),
      'utf8',
    );
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('ProductImage_one_active_primary_per_product');
    expect(sql).toContain('ProductImage_galleryZoom_check');
    expect(sql).toContain('"isActive" BOOLEAN NOT NULL DEFAULT true');
  });
});
