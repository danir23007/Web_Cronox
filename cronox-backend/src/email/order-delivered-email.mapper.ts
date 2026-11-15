import { Prisma } from '@prisma/client';
import { containedOrderImage } from './managed/order-product-image';

// Sizes share their product's photos in the current catalogue. The image saved
// on the purchased line is more specific than today's product primary image.
// Select only its URL, never the private financial values from that snapshot.
export const deliveredOrderItemSelection = {
  select: {
    id: true, title: true, quantity: true,
    variant: { select: { size: true } },
    financialSnapshot: { select: { imageUrl: true } },
    product: { select: { name: true, imageUrl: true, images: {
      where: { isActive: true, archivedAt: null },
      select: { url: true, width: true, height: true },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    } } },
  },
} satisfies Prisma.OrderItemDefaultArgs;
type DeliveredItem = Prisma.OrderItemGetPayload<typeof deliveredOrderItemSelection>;

const imageUrl = (value?: string | null) => {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
};

export function mapDeliveredOrderItems(items: DeliveredItem[]) {
  return items.map(item => {
    const images = item.product?.images || [];
    const url = imageUrl(item.financialSnapshot?.imageUrl) || images.map(image => imageUrl(image.url)).find(Boolean) || imageUrl(item.product?.imageUrl);
    const photo = images.find(image => imageUrl(image.url) === url);
    return {
      name: item.title || item.product?.name || '',
      variantName: item.variant?.size || item.title?.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() || null,
      quantity: item.quantity,
      ...(url ? { imageUrl: url, ...containedOrderImage(photo?.width, photo?.height) } : {}),
    };
  });
}
