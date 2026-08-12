(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CRONOX_COUNTRY = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SPAIN = 'España';
  const SPAIN_ISO = 'ES';

  const foldCountryValue = (value) => {
    if (typeof value !== 'string') return '';
    return value
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es-ES');
  };

  const normalizeCountry = (value) => {
    const folded = foldCountryValue(value);
    return folded === 'es' || folded === 'espana' || folded === 'spain'
      ? SPAIN
      : null;
  };

  const toCountryDisplayName = normalizeCountry;
  const toIsoCountryCode = (value) =>
    normalizeCountry(value) === SPAIN ? SPAIN_ISO : null;

  return Object.freeze({
    SPAIN,
    SPAIN_ISO,
    supportedCountries: Object.freeze([SPAIN]),
    normalizeCountry,
    toCountryDisplayName,
    toIsoCountryCode,
  });
});
