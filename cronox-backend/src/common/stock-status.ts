// Shared by Nest and the browser API bundle. No browser or database dependencies.
export const LOW_STOCK_MAX = 14;
// Administrative per-size state; product totals and storefront semantics stay unchanged.
export const VARIANT_LOW_STOCK_MAX = 4;
// Storefront warnings require complete availability data. Inactive variants
// are excluded; an explicitly unavailable variant contributes no purchasable stock.
export function purchasableStock(variants: unknown): number | null {
  if (!Array.isArray(variants)) return null;
  if (variants.some(variant => !variant || typeof variant !== 'object')) return null;
  const active = variants.filter(variant => variant.isActive !== false);
  if (!active.every(variant =>
    typeof (variant.stockQty ?? variant.stock) === 'number' &&
    Number.isSafeInteger(variant.stockQty ?? variant.stock),
  )) return null;
  return availableStock(active);
}

export function productStockStatus(variants: unknown, threshold: unknown) {
  const total = purchasableStock(variants);
  if (total === null) return 'unknown';
  if (total === 0) return 'out_of_stock';
  return typeof threshold === 'number' && Number.isSafeInteger(threshold) &&
    threshold > 0 && total <= threshold ? 'low' : 'in_stock';
}

export function hasLastUnits(variants: unknown, threshold: unknown): boolean {
  return productStockStatus(variants, threshold) === 'low';
}

// Count actual product sizes, not variant rows or the apparel size catalogue.
// A size with any purchasable variant is not sold out; unknown stock stays unknown.
export function soldOutSizeCount(variants: unknown): number {
  if (!Array.isArray(variants)) return 0;
  const sizes = new Map<string, Array<Record<string, unknown>>>();
  for (const variant of variants) {
    if (!variant || typeof variant !== 'object' || variant.isActive === false) continue;
    const size = String(variant.sizeKey ?? variant.sizeCode ?? variant.size ?? '')
      .trim().toUpperCase().replace(/\s+/g, '_');
    if (!size) continue;
    const group = sizes.get(size) ?? [];
    group.push(variant);
    sizes.set(size, group);
  }
  return [...sizes.values()].filter(group => purchasableStock(group) === 0).length;
}
export function classifyVariantStock(stock: number) {
  if (!Number.isSafeInteger(stock) || stock <= 0) return 'out_of_stock';
  return stock <= VARIANT_LOW_STOCK_MAX ? 'low' : 'in_stock';
}
export function classifyStock(total: number) {
  if (!Number.isSafeInteger(total) || total <= 0) return 'out_of_stock';
  return total <= LOW_STOCK_MAX ? 'low' : 'in_stock';
}

export function availableStock(variants: unknown): number {
  if (!Array.isArray(variants)) return 0;
  return (variants as Array<Record<string, unknown> | null>).reduce<number>(
    (total: number, variant: Record<string, unknown> | null) => {
      if (
        !variant ||
        variant.isActive === false ||
        variant.isAvailable === false
      )
        return total;
      const stock = variant.stockQty ?? variant.stock;
      return typeof stock === 'number' &&
        Number.isSafeInteger(stock) &&
        stock > 0
        ? total + stock
        : total;
    },
    0,
  );
}
