// INE: https://www.ine.es/daco/daco42/codmun/cod_ccaa_provincia.htm
export const REGIONS = [
  'Andalucía',
  'Aragón',
  'Principado de Asturias',
  'Illes Balears',
  'Canarias',
  'Cantabria',
  'Castilla y León',
  'Castilla-La Mancha',
  'Cataluña',
  'Comunitat Valenciana',
  'Extremadura',
  'Galicia',
  'Comunidad de Madrid',
  'Región de Murcia',
  'Comunidad Foral de Navarra',
  'País Vasco',
  'La Rioja',
  'Ceuta',
  'Melilla',
].map((name, index) => ({ id: String(index + 1).padStart(2, '0'), name }));
const rows: [string, string, number][] = [
  ['Araba/Álava', 'Álava|Araba|Alava/Araba', 16],
  ['Albacete', '', 8],
  ['Alicante/Alacant', 'Alicante|Alacant', 10],
  ['Almería', '', 1],
  ['Ávila', '', 7],
  ['Badajoz', '', 11],
  ['Illes Balears', 'Baleares|Islas Baleares|Balears|Balears, Illes', 4],
  ['Barcelona', '', 9],
  ['Burgos', '', 7],
  ['Cáceres', '', 11],
  ['Cádiz', '', 1],
  ['Castellón/Castelló', 'Castellón|Castelló', 10],
  ['Ciudad Real', '', 8],
  ['Córdoba', '', 1],
  ['A Coruña', 'La Coruña|Coruña|Coruña, A', 12],
  ['Cuenca', '', 8],
  ['Girona', 'Gerona', 9],
  ['Granada', '', 1],
  ['Guadalajara', '', 8],
  ['Gipuzkoa', 'Guipúzcoa|Guipuzcoa/Gipuzkoa', 16],
  ['Huelva', '', 1],
  ['Huesca', '', 2],
  ['Jaén', '', 1],
  ['León', '', 7],
  ['Lleida', 'Lérida', 9],
  ['La Rioja', 'Rioja|Rioja, La', 17],
  ['Lugo', '', 12],
  ['Madrid', 'Comunidad de Madrid', 13],
  ['Málaga', '', 1],
  ['Murcia', 'Región de Murcia', 14],
  ['Navarra', 'Nafarroa|Comunidad Foral de Navarra', 15],
  ['Ourense', 'Orense', 12],
  ['Asturias', 'Principado de Asturias', 3],
  ['Palencia', '', 7],
  ['Las Palmas', 'Palmas, Las', 5],
  ['Pontevedra', '', 12],
  ['Salamanca', '', 7],
  ['Santa Cruz de Tenerife', 'S.C. de Tenerife|Tenerife', 5],
  ['Cantabria', '', 6],
  ['Segovia', '', 7],
  ['Sevilla', '', 1],
  ['Soria', '', 7],
  ['Tarragona', '', 9],
  ['Teruel', '', 2],
  ['Toledo', '', 8],
  ['Valencia/València', 'Valencia|València', 10],
  ['Valladolid', '', 7],
  ['Bizkaia', 'Vizcaya|Vizcaya/Bizkaia', 16],
  ['Zamora', '', 7],
  ['Zaragoza', '', 2],
  ['Ceuta', '', 18],
  ['Melilla', '', 19],
];
export const PROVINCES = rows.map(([name, aliases, region], index) => ({
  id: String(index + 1).padStart(2, '0'),
  name,
  aliases: [name, ...aliases.split('|')].filter(Boolean),
  regionId: String(region).padStart(2, '0'),
}));
const fold = (value: unknown) =>
  typeof value === 'string'
    ? value
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : '';
const names = new Map(
  PROVINCES.flatMap((p) => p.aliases.map((alias) => [fold(alias), p] as const)),
);
// ICU's country names are local data; this performs no network lookup. Unknown
// free text is not evidence of a foreign country (e.g. "N/A" or "desconocido").
const countryNames = new Map<string, string>();
const countryLabels = ['es', 'en', 'fr', 'de', 'pt', 'it'].map(
  (locale) =>
    new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }),
);
for (let a = 65; a <= 90; a++)
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (
      ['EU', 'EZ', 'UN', 'ZZ', 'XA', 'XB'].includes(code) ||
      !countryLabels[0].of(code)
    )
      continue;
    countryNames.set(code.toLowerCase(), code);
    for (const label of countryLabels) {
      const name = label.of(code);
      if (name) countryNames.set(fold(name), code);
    }
  }
for (const alias of [
  'es',
  'esp',
  'espana',
  'spain',
  'espanya',
  'reinodeespana',
])
  countryNames.set(alias, 'ES');
countryNames.set('uk', 'GB');
export type Location = {
  group: 'identified' | 'unknownSpain' | 'foreign' | 'unresolved';
  provinceId?: string;
  regionId?: string;
  reason?: string;
};
export function classifyShipping(value: unknown): Location {
  const a =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  if (
    [a.country, a.countryCode].some(
      (c) =>
        c != null &&
        (typeof c !== 'string' ||
          /^(n[/.]a[.]?|unknown|desconocido|-)$/i.test(c.trim())),
    )
  )
    return { group: 'unresolved', reason: 'País no reconocido' };
  const countries = [a.country, a.countryCode].map(fold).filter(Boolean);
  const normalizedCountries = countries.map((country) =>
    countryNames.get(country),
  );
  const spanish = normalizedCountries.includes('ES');
  const foreign = normalizedCountries.some((c) => c && c !== 'ES');
  const provinces = [a.state, a.province].map(fold).filter(Boolean);
  const recognized = provinces.map((p) => names.get(p));
  // Postal codes remain strings. Numeric legacy values are not padded or guessed.
  const zips = [a.zip, a.postalCode, a.postal_code]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => (typeof v === 'string' ? v.trim() : 'invalid'));
  const valid = zips.filter(
    (z) => /^(0[1-9]|[1-4][0-9]|5[0-2])\d{3}$/.test(z) && z.slice(2) !== '000',
  );
  const postal = valid.length
    ? PROVINCES.find((p) => p.id === valid[0].slice(0, 2))
    : undefined;
  const province = recognized.find(Boolean);
  const conflict =
    new Set(zips).size > 1 ||
    (recognized.some((p) => !p) && provinces.length > 0 && !!postal) ||
    recognized.some((p) => p && p.id !== (postal ?? province)?.id);
  const uncertain = (reason: string): Location => ({
    group: spanish && !foreign ? 'unknownSpain' : 'unresolved',
    reason,
  });
  if (normalizedCountries.some((c) => !c))
    return { group: 'unresolved', reason: 'País no reconocido' };
  if (new Set(normalizedCountries).size > 1)
    return { group: 'unresolved', reason: 'Países contradictorios' };
  if (foreign)
    return {
      group: 'foreign',
      ...(province
        ? {
            reason:
              'País extranjero con provincia española: no se asigna a España',
          }
        : {}),
    };
  if (conflict)
    return uncertain('Código postal y provincia contradictorios o ambiguos');
  if (!spanish && !(postal && province && postal.id === province.id))
    return uncertain('País ausente; no hay evidencia inequívoca de España');
  const resolved = postal ?? province;
  if (!resolved) return uncertain('Sin código postal o provincia reconocibles');
  return {
    group: 'identified',
    provinceId: resolved.id,
    regionId: resolved.regionId,
  };
}
