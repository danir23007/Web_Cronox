import { randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveWebPrice, webOfferLots } from '../../products/web-offer';
import { containedOrderImage } from './order-product-image';

export function usesPreviewProduct(document: unknown, purpose?: string | null) {
  return purpose === 'RESTOCK' || /"type":"(?:orderItems|orderTotals)"|\{\{\s*(?:#each\s+items|product(?:Name|Image|Slug)?|imageUrl|items\b|unitPriceFormatted|lineTotalFormatted)\b/.test(JSON.stringify(document));
}

/** Called only by the authenticated preview endpoint. IDs are held by the
 * editor session, never persisted in a draft or consulted by automatic sends. */
export async function previewCatalogProduct(db: Pick<PrismaService, 'product'>, productId?: number, variantId?: number) {
  const products = await db.product.findMany({
    where: { isActive: true, currency: 'EUR', variants: { some: { isActive: true, stockQty: { gt: 0 } } } },
    include: {
      images: { where: { isActive: true, archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] },
      variants: { where: { isActive: true, stockQty: { gt: 0 } } },
      inventoryLots: webOfferLots,
    },
    orderBy: { id: 'asc' },
  });
  const imageFor = (p: typeof products[number]) => [...p.images.map(image => image.url), p.imageUrl].find(value => {
    try { const url = new URL(value || ''); return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { return false; }
  });
  const valid = products.filter(p => p.variants.length && imageFor(p));
  if (!valid.length) return { data: {}, selection: undefined, warnings: ['No hay un producto activo con imagen y talla disponible en el catálogo local para Preview.'] };
  const product = valid.find(p => p.id === productId) || valid[randomInt(valid.length)];
  const variant = product.variants.find(v => v.id === variantId) || product.variants[randomInt(product.variants.length)];
  const price = resolveWebPrice(product, variant).effectivePrice;
  const quantity = Math.min(2, variant.stockQty), subtotal = price * quantity, discount = Math.round(subtotal * .1), shipping = 490;
  const total = subtotal - discount + shipping, tax = Math.round(total * 21 / 121);
  const money = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const image = imageFor(product)!;
  const item = { name: product.name, variantName: variant.size, quantity, imageUrl: image,
    ...containedOrderImage(product.images.find(entry => entry.url === image)?.width, product.images.find(entry => entry.url === image)?.height),
    unitPriceFormatted: money(price), lineTotalFormatted: money(subtotal) };
  return {
    selection: { productId: product.id, variantId: variant.id },
    warnings: productId && (productId !== product.id || (variantId && variantId !== variant.id))
      ? ['El producto o la talla anterior ya no está disponible. Preview ha elegido otro producto válido.'] : [],
    data: { ...item, product: product.name, productName: product.name, productSlug: product.slug,
      size: variant.size, productImage: image, items: [item], subtotalFormatted: money(subtotal),
      discountFormatted: `-${money(discount)}`, savingsFormatted: money(discount), shippingFormatted: money(shipping),
      taxesFormatted: money(tax), totalFormatted: money(total) },
  };
}
