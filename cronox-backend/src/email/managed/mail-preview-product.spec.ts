import { previewCatalogProduct, usesPreviewProduct } from './mail-preview-product';

const product = (id: number) => ({ id, name: `Producto ${id}`, slug: `producto-${id}`, price: 4000, isActive: true,
  images: [{ url: `https://example.test/${id}.png` }], variants: [{ id: id * 10, size: 'L', price: 3500, isActive: true, stockQty: 4 }],
  activeLotId: 'offer', inventoryLots: [{ id: 'offer', webOfferPriceCents: 3000, webOfferPreviousCents: 4000,
    webOfferStartsAt: new Date(Date.now() - 10000), webOfferEndsAt: new Date(Date.now() + 100000), webOfferConfirmedAt: new Date() }] });
describe('preview-only catalogue selection', () => {
  it('keeps an existing selection and uses its own image, variant and effective sale price with coherent totals', async () => {
    const db: any = { product: { findMany: jest.fn().mockResolvedValue([product(1), product(2)]) } };
    for (let i = 0; i < 3; i++) {
      const result = await previewCatalogProduct(db, 2, 20);
      expect(result.selection).toEqual({ productId: 2, variantId: 20 });
      expect(result.data).toMatchObject({ product: 'Producto 2', imageUrl: 'https://example.test/2.png', size: 'L',
        unitPriceFormatted: '30,00 €', subtotalFormatted: '60,00 €', discountFormatted: '-6,00 €',
        shippingFormatted: '4,90 €', totalFormatted: '58,90 €', taxesFormatted: '10,22 €' });
    }
  });
  it('warns when no valid catalogue product exists or an old selection disappears', async () => {
    const db: any = { product: { findMany: jest.fn().mockResolvedValue([]) } };
    expect((await previewCatalogProduct(db)).warnings).toHaveLength(1);
    db.product.findMany.mockResolvedValue([product(1)]);
    const result = await previewCatalogProduct(db, 99, 999);
    expect(result.selection).toEqual({ productId: 1, variantId: 10 });
    expect(result.warnings).toHaveLength(1);
  });
  it('recognizes product loops, dynamic blocks and product-only campaigns', () => {
    for (const document of [{ blocks: [{ type: 'orderItems' }] }, { blocks: [{ type: 'html', html: '{{#each items}}{{name}}{{/each}}' }] },
      { blocks: [{ type: 'image', src: '{{productImage}}' }] }, { blocks: [{ type: 'text', text: '{{productName}}' }] }]) expect(usesPreviewProduct(document)).toBe(true);
    expect(usesPreviewProduct({ blocks: [{ type: 'text', text: 'Sin productos' }] })).toBe(false);
  });
});
