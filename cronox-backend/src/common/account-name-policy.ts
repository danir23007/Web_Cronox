import { BadRequestException } from '@nestjs/common';

export const ACCOUNT_FIRST_NAME_MAX = 25;
export const ACCOUNT_LAST_NAME_MAX = 30;

// Existing values may be retained unchanged. Never repair/truncate historical
// names as a side effect of reading an account or changing another field.
export function validateAccountName(
  value: string | null | undefined,
  field: 'firstName' | 'lastName',
  existing?: string | null,
): void {
  if (value == null || value === existing) return;
  const maximum =
    field === 'firstName' ? ACCOUNT_FIRST_NAME_MAX : ACCOUNT_LAST_NAME_MAX;
  if (Array.from(value.trim()).length > maximum)
    throw new BadRequestException(
      `El ${field === 'firstName' ? 'nombre' : 'apellido'} admite como máximo ${maximum} caracteres.`,
    );
}
