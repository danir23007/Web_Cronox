export const SPAIN_COUNTRY_NAME = 'España' as const;
export const SPAIN_ISO_COUNTRY_CODE = 'ES' as const;
export const SUPPORTED_COUNTRY_NAMES = [SPAIN_COUNTRY_NAME] as const;
export const UNSUPPORTED_COUNTRY_MESSAGE =
  'Solo se admite España como país o región.';

const foldCountryValue = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES');
};

/**
 * Converts supported application and legacy values to CRONOX's canonical
 * human-readable country name. Unknown countries fail closed with `null`.
 */
export const normalizeCountry = (value: unknown): string | null => {
  const folded = foldCountryValue(value);
  return folded === 'es' || folded === 'espana' || folded === 'spain'
    ? SPAIN_COUNTRY_NAME
    : null;
};

export const toCountryDisplayName = normalizeCountry;

/** Converts CRONOX's country value to ISO only at an external boundary. */
export const toIsoCountryCode = (value: unknown): string | null =>
  normalizeCountry(value) === SPAIN_COUNTRY_NAME
    ? SPAIN_ISO_COUNTRY_CODE
    : null;

export const normalizeAddressCountryForRead = <
  T extends Record<string, unknown>,
>(address: T): T => {
  const country = normalizeCountry(address.country);
  return country ? ({ ...address, country } as T) : address;
};
