// Shared by Nest and the browser API bundle. No browser or database dependencies.
export const LOW_STOCK_MAX = 14;
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
