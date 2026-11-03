import { BadRequestException } from '@nestjs/common';

/** A calendar day is stored at UTC midnight; never parse a local midnight or
 * format it through the server/browser's local timezone. */
export function receiptDate(value: string | null | undefined): Date | null | undefined {
  if (value == null) return value;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('La fecha debe tener formato AAAA-MM-DD.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('La fecha de recepción no es válida.');
  return date;
}

export const receiptDay = (value: Date | null | undefined): string | null => value?.toISOString().slice(0, 10) ?? null;
