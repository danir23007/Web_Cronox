import { BadRequestException } from '@nestjs/common';
import type { ProductSizeSystem, VariantSize } from '@prisma/client';

export const DEFAULT_PRODUCT_SIZE_SYSTEM = 'APPAREL' as ProductSizeSystem;
export const RING_PRODUCT_SIZE_SYSTEM = 'US_RING' as ProductSizeSystem;
export const PRODUCT_SIZE_SYSTEM_VALUES = Object.freeze({
  APPAREL: DEFAULT_PRODUCT_SIZE_SYSTEM,
  US_RING: RING_PRODUCT_SIZE_SYSTEM,
});

export const PRODUCT_SIZE_SYSTEMS = Object.freeze({
  APPAREL: Object.freeze(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
  US_RING: Object.freeze([
    'US_6',
    'US_7',
    'US_8',
    'US_9',
    'US_10',
    'US_11',
    'US_12',
  ]),
} satisfies Record<ProductSizeSystem, readonly VariantSize[]>);
export const VARIANT_SIZE_VALUES = Object.freeze(
  Object.fromEntries(
    [...PRODUCT_SIZE_SYSTEMS.APPAREL, ...PRODUCT_SIZE_SYSTEMS.US_RING].map(
      (size) => [size, size],
    ),
  ),
);

export const variantSizeLabel = (size: VariantSize | string): string => {
  const value = String(size || '');
  return value.startsWith('US_') ? value.replace('US_', 'US ') : value;
};

export const variantSizeSkuToken = (size: VariantSize | string): string =>
  String(size || '')
    .replace(/^US_/, 'US')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

export const sizeOrder = (size: VariantSize | string): number => {
  const all = [
    ...PRODUCT_SIZE_SYSTEMS.APPAREL,
    ...PRODUCT_SIZE_SYSTEMS.US_RING,
  ];
  const index = all.indexOf(size as VariantSize);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export const assertSizesMatchSystem = (
  sizeSystem: ProductSizeSystem,
  sizes: Array<VariantSize | string>,
): void => {
  const allowed = new Set<string>(PRODUCT_SIZE_SYSTEMS[sizeSystem]);
  const invalid = sizes.find((size) => !allowed.has(String(size)));
  if (invalid) {
    throw new BadRequestException(
      `La talla ${variantSizeLabel(invalid)} no pertenece al sistema ${sizeSystem === RING_PRODUCT_SIZE_SYSTEM ? 'US Ring' : 'Apparel'}.`,
    );
  }
};
