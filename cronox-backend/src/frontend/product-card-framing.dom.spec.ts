/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

const geometryScript = readFrontend('assets/media-framing-geometry.js');
const cardFramingScript = readFrontend('assets/product-card-framing.js');
const productsScript = readFrontend('assets/products.js');

const loadWindow = () => {
  const dom = new JSDOM('<!doctype html><div id="mount"></div>', {
    runScripts: 'outside-only',
    url: 'http://localhost:3000/',
  });
  const app = dom.window as any;
  app.CRONOX_API = { getFallbackProducts: () => [] };
  app.CRONOX_SECURITY = {
    productImageUrl: (value: string, fallback: string) => value || fallback,
  };
  app.eval(geometryScript);
  app.eval(cardFramingScript);
  app.eval(productsScript);
  return { dom, app };
};

describe('product-card framing integration', () => {
  it.each([
    ['vertical', 800, 1400],
    ['horizontal', 1600, 900],
    ['square', 1000, 1000],
  ])(
    'uses predictable contained geometry for a %s image',
    (_label, width, height) => {
      const { dom, app } = loadWindow();
      const result = app.CRONOX_MEDIA_GEOMETRY.calculate({
        frameWidth: 300,
        frameHeight: 400,
        mediaWidth: width,
        mediaHeight: height,
        ...app.CRONOX_PRODUCT_CARD_FRAMING.resolve({
          cardImagePositionX: 25,
          cardImagePositionY: 80,
          cardImageZoom: 1,
        }),
      });
      expect(result.valid).toBe(true);
      expect(result.renderedWidth).toBeLessThanOrEqual(300.001);
      expect(result.renderedHeight).toBeLessThanOrEqual(400.001);
      dom.window.close();
    },
  );

  it('supports zoom out, clamps extremes, and preserves safe defaults', () => {
    const { dom, app } = loadWindow();
    expect(app.CRONOX_PRODUCT_CARD_FRAMING.resolve({})).toMatchObject({
      focalX: 50,
      focalY: 50,
      zoom: 1,
    });
    expect(
      app.CRONOX_PRODUCT_CARD_FRAMING.resolve({
        cardImagePositionX: -20,
        cardImagePositionY: 500,
        cardImageZoom: 0.1,
      }),
    ).toMatchObject({ focalX: 0, focalY: 100, zoom: 0.5 });
    expect(
      app.CRONOX_PRODUCT_CARD_FRAMING.resolve({ cardImageZoom: 20 }).zoom,
    ).toBe(3);
    dom.window.close();
  });

  it.each([
    [0, 0],
    [100, 0],
    [0, 100],
    [100, 100],
  ])('keeps the image clipped at focal corner %s/%s', (focalX, focalY) => {
    const { dom, app } = loadWindow();
    const result = app.CRONOX_MEDIA_GEOMETRY.calculate({
      frameWidth: 300,
      frameHeight: 400,
      mediaWidth: 1000,
      mediaHeight: 1000,
      fit: 'CONTAIN',
      minZoom: 0.5,
      maxZoom: 3,
      zoom: 2,
      focalX,
      focalY,
    });
    expect(result.translateX).toBeGreaterThanOrEqual(
      300 - result.renderedWidth,
    );
    expect(result.translateX).toBeLessThanOrEqual(0);
    expect(result.translateY).toBeGreaterThanOrEqual(
      400 - result.renderedHeight,
    );
    expect(result.translateY).toBeLessThanOrEqual(0);
    dom.window.close();
  });

  it.each([180, 320, 768])(
    'preserves normalized focal values at a %spx card width',
    (frameWidth) => {
      const { dom, app } = loadWindow();
      const result = app.CRONOX_MEDIA_GEOMETRY.calculate({
        frameWidth,
        frameHeight: (frameWidth * 4) / 3,
        mediaWidth: 900,
        mediaHeight: 1600,
        ...app.CRONOX_PRODUCT_CARD_FRAMING.resolve({
          cardImagePositionX: 22,
          cardImagePositionY: 78,
          cardImageZoom: 1.3,
        }),
      });
      expect(result.focalX).toBe(22);
      expect(result.focalY).toBe(78);
      expect(result.valid).toBe(true);
      dom.window.close();
    },
  );

  it('builds one isolated frame/footer card and frames only its primary image', async () => {
    const { dom, app } = loadWindow();
    await app.CRONOX_catalogReady;
    const card = app.CRONOX_createProductCard({
      id: 8,
      slug: 'framed-product',
      name: 'FRAMED PRODUCT',
      price: 40,
      images: ['/primary.jpg', '/gallery.jpg'],
      cardImagePositionX: 12,
      cardImagePositionY: 87,
      cardImageZoom: 1.4,
    });
    dom.window.document.getElementById('mount')?.appendChild(card);
    const media = card.querySelector('.product-media')!;
    const info = card.querySelector('.product-card__info')!;
    const images = card.querySelectorAll<HTMLImageElement>('.product-img');
    expect(media.nextElementSibling).toBe(info);
    expect(info.contains(card.querySelector('.product-name'))).toBe(true);
    expect(info.contains(card.querySelector('.product-price'))).toBe(true);
    expect(images[0].dataset.cardPrimaryImage).toBe('true');
    expect(images[1].dataset.cardPrimaryImage).toBeUndefined();
    dom.window.close();
  });

  it('keeps the same shared engine in admin and every full-card public entry point', () => {
    const admin = readFrontend('admin.html');
    const pages = [
      'index.html',
      'favorites.html',
      'profile.html',
      'producto.html',
    ];
    expect(admin).toContain('id="productCardFramingFrame"');
    expect(admin).toContain('product-card-framing.js?v=1');
    for (const page of pages) {
      const html = readFrontend(page);
      const geometryScriptIndex = html.search(
        /media-framing-geometry\.js\?v=\d+/,
      );
      expect(geometryScriptIndex).toBeGreaterThan(-1);
      expect(html.indexOf('product-card-framing.js?v=1')).toBeGreaterThan(-1);
      expect(geometryScriptIndex).toBeLessThan(
        html.indexOf('product-card-framing.js?v=1'),
      );
      expect(html.indexOf('product-card-framing.js?v=1')).toBeLessThan(
        html.indexOf('products.js?v=55'),
      );
    }
  });

  it('locks responsive rows to a clipped frame followed by a fixed-height footer', () => {
    const css = readFrontend('assets/store.css');
    expect(css).toMatch(
      /\.product-media\{[^}]*position:relative[^}]*aspect-ratio:3\/4[^}]*overflow:hidden/s,
    );
    expect(css).toMatch(
      /\.product-card__info\{[^}]*height:88px[^}]*background:#000[^}]*overflow:hidden/s,
    );
    expect(css).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(css).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(css).toContain('grid-template-columns:repeat(2,minmax(0,1fr))');
  });
});
