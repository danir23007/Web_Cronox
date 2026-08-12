import {
  normalizeAddressCountryForRead,
  normalizeCountry,
  SPAIN_COUNTRY_NAME,
  toCountryDisplayName,
  toIsoCountryCode,
} from './country';

describe('country normalization', () => {
  it.each(['ES', 'es', 'España', 'Espana', 'Spain', '  españa  '])(
    'normalizes the supported Spain alias %s',
    (value) => {
      expect(normalizeCountry(value)).toBe(SPAIN_COUNTRY_NAME);
      expect(toCountryDisplayName(value)).toBe(SPAIN_COUNTRY_NAME);
    },
  );

  it('rejects unsupported arbitrary countries', () => {
    expect(normalizeCountry('France')).toBeNull();
    expect(toIsoCountryCode('France')).toBeNull();
  });

  it('maps the CRONOX value to ISO only for provider boundaries', () => {
    expect(toIsoCountryCode('España')).toBe('ES');
    expect(toIsoCountryCode('ES')).toBe('ES');
  });

  it('normalizes legacy address reads without mutating the source', () => {
    const legacy = { city: 'Madrid', country: 'ES' };
    expect(normalizeAddressCountryForRead(legacy)).toEqual({
      city: 'Madrid',
      country: 'España',
    });
    expect(legacy.country).toBe('ES');
  });
});
