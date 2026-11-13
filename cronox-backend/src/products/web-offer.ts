import { BadRequestException } from '@nestjs/common';

export type WebOffer = {
  id?: string;
  archived?: boolean;
  webOfferPriceCents?: number | null;
  webOfferPreviousCents?: number | null;
  webOfferStartsAt?: Date | string | null;
  webOfferEndsAt?: Date | string | null;
  webOfferDisabledAt?: Date | string | null;
  webOfferConfirmedAt?: Date | string | null;
};
export type PricedProduct = {
  price: number;
  activeLotId?: string | null;
  isActive?: boolean;
  variants?: Array<{ price?: number | null; isActive?: boolean }>;
  inventoryLots?: WebOffer[];
};
export const webOfferLots = {
  where: { webOfferPriceCents: { not: null } },
  select: {
    id: true,
    archived: true,
    webOfferPriceCents: true,
    webOfferPreviousCents: true,
    webOfferStartsAt: true,
    webOfferEndsAt: true,
    webOfferDisabledAt: true,
    webOfferConfirmedAt: true,
  },
} as const;

export function webOfferStatus(offer: WebOffer, now = new Date()) {
  if (offer.webOfferPriceCents == null || offer.webOfferDisabledAt)
    return 'DISABLED';
  if (now.getTime() < new Date(offer.webOfferStartsAt!).getTime())
    return 'SCHEDULED';
  if (now.getTime() >= new Date(offer.webOfferEndsAt!).getTime())
    return 'ENDED';
  return 'ACTIVE';
}

// One resolver for public views, accepted cart prices and reservation checks.
// Ordinary prices are never overwritten in storage.
export function resolveWebPrice(
  product: PricedProduct,
  variant?: { price?: number | null; isActive?: boolean },
  now = new Date(),
) {
  const regularPrice = variant?.price ?? product.price;
  const regularPrices = variant
    ? [regularPrice]
    : (product.variants
        ?.filter((size) => size.isActive !== false)
        .map((size) => size.price ?? product.price) ?? [regularPrice]);
  const offer = product.inventoryLots?.find(
    (lot) => lot.id === product.activeLotId,
  );
  const boundary =
    offer && !offer.webOfferDisabledAt && product.isActive !== false
      ? [offer.webOfferStartsAt, offer.webOfferEndsAt]
          .filter(Boolean)
          .map((date) => new Date(date!).getTime())
          .find((time) => time > now.getTime())
      : undefined;
  const active =
    product.isActive !== false &&
    variant?.isActive !== false &&
    offer &&
    !offer.archived &&
    webOfferStatus(offer, now) === 'ACTIVE' &&
    !!offer.webOfferConfirmedAt &&
    offer.webOfferPriceCents! > 0 &&
    regularPrices.length > 0 &&
    regularPrices.every((price) => offer.webOfferPriceCents! < price) &&
    offer.webOfferPriceCents! < offer.webOfferPreviousCents!;
  return {
    effectivePrice: active ? offer.webOfferPriceCents! : regularPrice,
    previousPrice: active ? offer.webOfferPreviousCents! : null,
    priceRefreshAfterMs: boundary == null ? null : boundary - now.getTime(),
  };
}

export function validateWebOffer(
  offer: WebOffer,
  profile: {
    price: number;
    variants: Array<{
      size: string;
      price?: number | null;
      isActive?: boolean;
    }>;
  },
) {
  if (offer.webOfferPriceCents == null) return;
  if (
    !Number.isSafeInteger(offer.webOfferPriceCents) ||
    offer.webOfferPriceCents <= 0 ||
    !Number.isSafeInteger(offer.webOfferPreviousCents) ||
    offer.webOfferPreviousCents! <= offer.webOfferPriceCents
  ) {
    throw new BadRequestException(
      'El precio de oferta debe ser positivo e inferior al precio anterior.',
    );
  }
  const start = new Date(offer.webOfferStartsAt!).getTime(),
    end = new Date(offer.webOfferEndsAt!).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new BadRequestException(
      'El fin de Oferta web debe ser posterior al inicio.',
    );
  if (!offer.webOfferConfirmedAt)
    throw new BadRequestException(
      'Confirma el menor precio aplicado durante los 30 días anteriores al inicio para todas las tallas activas.',
    );
  const active = profile.variants.filter(
    (variant) => variant.isActive !== false,
  );
  if (!active.length)
    throw new BadRequestException(
      'Oferta web requiere al menos una talla activa.',
    );
  const invalid = active.filter(
    (variant) => offer.webOfferPriceCents! >= (variant.price ?? profile.price),
  );
  if (invalid.length)
    throw new BadRequestException(
      'La oferta no rebaja el precio habitual de las tallas: ' +
        invalid.map((v) => v.size).join(', ') +
        '.',
    );
  if (
    new Set(active.map((variant) => variant.price ?? profile.price)).size > 1
  ) {
    throw new BadRequestException(
      'Las tallas activas tienen precios habituales distintos: ' +
        active
          .map(
            (v) =>
              `${v.size} (${((v.price ?? profile.price) / 100).toFixed(2)} €)`,
          )
          .join(', ') +
        '. Esta versión requiere una referencia anterior común verificable. Revisa las tallas antes de configurar Oferta web.',
    );
  }
}
