// Decimal(12,2) limit shared by order and order-item amounts.
export const MAX_MANUAL_CENTS = 999_999_999_999;

export function parseManualPrice(value: string): number {
  if (value !== value.trim() || !/^\d+(?:[.,]\d{1,2})?$/.test(value)) throw new Error('Indica un precio válido, con hasta dos decimales.');
  const [whole, fraction = ''] = value.split(/[.,]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_MANUAL_CENTS) throw new Error('El importe es demasiado alto.');
  return cents;
}

export function manualPriceText(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
