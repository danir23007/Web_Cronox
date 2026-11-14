import { containedOrderImage } from './order-product-image';
import { renderMail } from './mail-renderer';
import { prepareOrderConfirmationHtml } from './order-confirmation-design';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { mailPreviewData } from './welcome-design';
import { OrderConfirmationEmailMapper } from '../order-confirmation-email.mapper';
import { Decimal } from '@prisma/client/runtime/library';

describe('proportional order product images without object-fit', () => {
  it.each([[600, 1200, 35, 70], [1200, 600, 70, 35], [900, 900, 70, 70], [3916, 5221, 53, 70]])(
    'contains the original %s × %s photo inside the compact frame', (width, height, imageWidth, imageHeight) => {
      expect(containedOrderImage(width, height)).toEqual({ imageWidth, imageHeight });
    });
  it('preserves intrinsic aspect for legacy photos with no metadata instead of forcing a square', () => {
    expect(containedOrderImage()).toEqual({});
    expect(containedOrderImage(-1, 100)).toEqual({});
    const html = renderMail({ blocks: [{ type: 'html', html: '<img src="{{imageUrl}}" alt="{{name}}" width="70" height="70">' }] }, 'Pedido', '', 'ORDER_CONFIRMATION', { imageUrl: 'https://example.test/photo.png', name: 'Producto' }).html;
    expect(html).toContain('order-product-frame');
    expect(html.match(/<img[^>]*src="https:\/\/example.test\/photo.png"[^>]*>/)![0]).not.toMatch(/\b(?:width|height)="/);
    expect(html).not.toContain('object-fit');
  });
  it.each(['blocks', 'html'])('renders actual proportional HTML attributes for every orientation (%s)', format => {
    for (const [width, height] of [[600, 1200], [1200, 600], [900, 900]]) {
      const dimensions = containedOrderImage(width, height);
      const data = { ...mailPreviewData('ORDER_CONFIRMATION'), items: [{ name: 'Prenda completa', quantity: 1, imageUrl: 'https://example.test/original.png', ...dimensions, lineTotalFormatted: '35,00 €' }] };
      const document = format === 'blocks' ? structuredDocumentForPurpose('ORDER_CONFIRMATION')! : { blocks: [{ type: 'html', html: '{{#each items}}<img src="{{imageUrl}}" alt="{{name}}" width="70" style="width:70px;height:70px;object-fit:cover">{{/each}}' }] };
      const html = renderMail(document, 'Pedido', '', 'ORDER_CONFIRMATION', data).html;
      expect(html).toContain(`width="${dimensions.imageWidth}" height="${dimensions.imageHeight}"`);
      expect(html).toContain('align="center" valign="middle"');
      expect(html).not.toContain('object-fit'); expect(html).not.toContain('{{');
    }
  });
  it('keeps the imported photo transformation idempotent', () => {
    const html = prepareOrderConfirmationHtml('<img src="{{imageUrl}}" alt="{{name}}" width="70" height="70">');
    expect(prepareOrderConfirmationHtml(html)).toBe(html);
  });
  it('keeps the purchased product photo and real size for each variant', () => {
    const order: any = { id: 1042, userId: 1, user: { circleLevel: 4 }, subtotal: new Decimal(70), taxAmount: new Decimal(12), total: new Decimal(70), shippingCost: 0, discountCents: 0,
      items: [{ productId: 1, title: 'SCARRED TEE black', quantity: 1, unitPrice: new Decimal(35), lineTotal: new Decimal(35), variant: { size: 'L' }, product: { name: 'SCARRED TEE black', images: [{ url: 'https://example.test/black.png', isPrimary: true, width: 600, height: 1200 }] } },
        { productId: 2, title: 'SCARRED TEE red', quantity: 1, unitPrice: new Decimal(35), lineTotal: new Decimal(35), variant: { size: 'S' }, product: { name: 'SCARRED TEE red', images: [{ url: 'https://example.test/red.png', isPrimary: true, width: 1200, height: 600 }] } }] };
    const data = new OrderConfirmationEmailMapper().map(order);
    expect(data.items[0]).toMatchObject({ imageUrl: 'https://example.test/black.png', variantName: 'L', imageWidth: 35, imageHeight: 70 });
    expect(data.items[1]).toMatchObject({ imageUrl: 'https://example.test/red.png', variantName: 'S', imageWidth: 70, imageHeight: 35 });
  });
});
