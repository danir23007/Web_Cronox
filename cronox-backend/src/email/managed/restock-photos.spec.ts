import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { restockPhotos, restockPhotoData, restockQuickSource, prepareRestockDocument } from './restock-photos';
import { renderMail, cleanMailHtml } from './mail-renderer';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { createRestockPhoto, RestockProductImageController } from '../restock-product-image.controller';
import { EmailService } from '../email.service';
import { EmailSenderKey } from '../email.types';

const images = [
  { id: 2, url: 'https://images.example.test/back.png', sortOrder: 1, variants: { quick: { url: 'https://images.example.test/back-quick.png' } } },
  { id: 1, url: 'https://images.example.test/front.png', sortOrder: 9, isPrimary: true },
  { id: 3, url: 'https://images.example.test/detail.png', sortOrder: 2 },
];
const data = { product: 'SCARRED TEE', size: 'M', actionUrl: 'https://example.test/producto/scarred?size=M&notice=example',
  restockPhoto1: 'https://images.example.test/front.png', restockPhoto2: 'https://images.example.test/back.png' };

describe('restock gallery shared by drafts, published emails and fallback', () => {
  it('matches Quick Add order and quick preset with duplicated, inactive and archived images', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    (dom.window as any).CRONOX_SECURITY = { productImageUrl: (url: string) => url || '' };
    dom.window.eval(readFileSync(join(__dirname, '../../../../cronox-front/assets/responsive-images.js'), 'utf8'));
    const product = { images, imageUrl: images[0].url };
    const quick = (dom.window as any).CRONOX_IMAGES;
    expect(restockPhotos(product).map(restockQuickSource)).toEqual(quick.productRecords(product).slice(0, 2).map((p: unknown) => quick.resolve(p, 'quick').src));
    expect(restockPhotos({ images: [...images, images[0], { ...images[0], isPrimary: true, isActive: false },
      { ...images[2], isPrimary: true, archivedAt: new Date() }] }).map(p => p.id)).toEqual([1, 2]);
    expect(restockPhotoData({ images: [] })).toEqual({ restockPhoto1: '', restockPhoto2: '' });
    dom.window.close();
  });

  it.each([0, 1, 2])('renders %i photos directly below title, before product; two fixed columns, one centered, none omitted', count => {
    const document = structuredDocumentForPurpose('RESTOCK')!;
    const snapshot = JSON.stringify(document);
    const result = renderMail(document, '{{product}}', '', 'RESTOCK', {
      ...data, restockPhoto1: count ? data.restockPhoto1 : '', restockPhoto2: count === 2 ? data.restockPhoto2 : '',
    });
    const page = new JSDOM(result.html).window.document;
    const photos = page.querySelector('.restock-photos');
    expect(photos?.querySelectorAll('img').length || 0).toBe(count);
    if (count) {
      expect(page.querySelector('h2')!.compareDocumentPosition(photos!) & 4).toBe(4);
      expect(photos!.closest('tr')!.nextElementSibling!.textContent).toContain('SCARRED TEE · Talla M');
      expect(photos!.querySelectorAll('.mail-column')).toHaveLength(0);
      if (count === 1) expect(photos!.querySelector('td')!.getAttribute('align')).toBe('center');
      if (count === 2) expect([...photos!.querySelectorAll('td')].map(td => td.getAttribute('width'))).toEqual(['50%', '50%']);
    }
    expect(result.html).not.toContain('{{');
    expect(JSON.stringify(document)).toBe(snapshot);
    expect(prepareRestockDocument(prepareRestockDocument(document))).toEqual(document);
  });

  it('adds the same gallery to an imported custom design without replacing its copy or links', () => {
    const document = { schemaVersion: 3, format: 'html-email', page: { width: 600, background: '#090909' },
      blocks: [{ type: 'html', html: '<h1>Mi aviso personalizado</h1><p>{{product}} · Talla {{size}}</p><a href="{{actionUrl}}">Mi botón</a>' }] };
    const result = renderMail(document, 'Mi asunto', '', 'RESTOCK', data);
    expect(result.html).toContain('Mi aviso personalizado'); expect(result.html).toContain('Mi botón');
    expect(new JSDOM(result.html).window.document.querySelectorAll('.restock-photos img')).toHaveLength(2);
    expect(document.blocks[0].html).not.toContain('restockPhoto');
  });

  it.each([[200, 500], [500, 200], [300, 300]])('bakes full uncropped %ix%i photos into a common transparent contain frame', async (width, height) => {
    const original = await sharp({ create: { width, height, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const result = await createRestockPhoto(original);
    const { data: pixels, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([560, 736, 4]);
    let minX = 560, minY = 736, maxX = 0, maxY = 0;
    for (let y = 0; y < 736; y++) for (let x = 0; x < 560; x++) if (pixels[(y * 560 + x) * 4 + 3] > 250) {
      minX = Math.min(x, minX); maxX = Math.max(x, maxX); minY = Math.min(y, minY); maxY = Math.max(y, maxY);
    }
    expect((maxX - minX + 1) / (maxY - minY + 1)).toBeCloseTo(width / height, 2);
    expect(Math.abs(minX - (559 - maxX))).toBeLessThanOrEqual(1);
    expect(Math.abs(minY - (735 - maxY))).toBeLessThanOrEqual(1);
  });

  it('rejects an arbitrary remote image URL before fetching', async () => {
    const controller = new RestockProductImageController({ productImage: { findFirst: async () => images[0] } } as any);
    await expect(controller.image(2, {} as any)).rejects.toThrow();
  });

  it('uses the original of the same photo if its quick preset is unavailable', async () => {
    const previous = process.env.SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co';
    const base = process.env.SUPABASE_URL + '/storage/v1/object/public/product-images/';
    const source = await sharp({ create: { width: 200, height: 300, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const request = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(source as any));
    const send = jest.fn();
    try {
      const controller = new RestockProductImageController({ productImage: { findFirst: async () => ({
        url: base + 'original.png', variants: { quick: { url: base + 'quick.webp' } },
      }) } } as any);
      await controller.image(1, { set: () => ({ send }) } as any);
      expect(request).toHaveBeenNthCalledWith(2, base + 'original.png', expect.objectContaining({ redirect: 'error' }));
      expect((await sharp(send.mock.calls[0][0]).metadata()).width).toBe(560);
    } finally {
      request.mockRestore();
      if (previous === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous;
    }
  });

  it.each([1, 2, 3, 4, 5])('simulates circle %i with published and fallback designs and zero, one or two photos', async circle => {
    for (const count of [0, 1, 2]) for (const active of [false, true]) {
      const args = { ...data, restockPhoto1: count ? data.restockPhoto1 : '', restockPhoto2: count === 2 ? data.restockPhoto2 : '' };
      const published = jest.fn(async (_sender: unknown, _purpose: unknown, values: any) => active
        ? renderMail(structuredDocumentForPurpose('RESTOCK'), 'Mi aviso {{product}}', '', 'RESTOCK', values) : null);
      const sendMail = jest.fn(async () => ({ accepted: ['test@example.test'] }));
      const service = new EmailService({ sendMail } as any, { recipientCircle: async () => circle, published } as any);
      await service.sendRestock('test@example.test', args);
      const html = (sendMail.mock.calls[0] as any)[1].html;
      const page = new JSDOM(html).window.document;
      expect(page.querySelectorAll('.restock-photos img')).toHaveLength(count);
      expect(page.querySelector('a')!.getAttribute('href')).toBe(data.actionUrl);
      expect(html).toContain('Este aviso no reserva la prenda');
      expect(published).toHaveBeenCalledWith(EmailSenderKey.NOREPLY, 'RESTOCK', expect.objectContaining({ circleLevel: circle }));
    }
  });

  it('allows the local image route only in the protected local profile; production stays HTTPS only', () => {
    const prior = process.env.CRONOX_LOCAL_DEV;
    try {
      const html = '<img src="http://localhost:3000/api/email/restock-product-image/1.png?v=1">';
      process.env.CRONOX_LOCAL_DEV = 'false'; expect(cleanMailHtml(html)).not.toContain('src=');
      process.env.CRONOX_LOCAL_DEV = 'true'; expect(cleanMailHtml(html)).toContain('src=');
      expect(cleanMailHtml('<img src="http://remote.test/1.png">')).not.toContain('src=');
    } finally { if (prior === undefined) delete process.env.CRONOX_LOCAL_DEV; else process.env.CRONOX_LOCAL_DEV = prior; }
  });
});
