import fs from 'node:fs';
import path from 'node:path';

describe('storefront country normalization', () => {
  const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
  const read = (relativePath: string) =>
    fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
  const country = jest.requireActual<{
    SPAIN: string;
    normalizeCountry: (value: unknown) => string | null;
    toIsoCountryCode: (value: unknown) => string | null;
  }>(path.join(frontendRoot, 'assets/country.js'));

  it('uses the shared human-readable Spain adapter while preserving locale codes', () => {
    expect(country.normalizeCountry('ES')).toBe('España');
    expect(country.normalizeCountry('Spain')).toBe('España');
    expect(country.toIsoCountryCode('España')).toBe('ES');
    expect(read('src/admin/api.ts')).toContain("new Intl.NumberFormat('es-ES'");
    expect(read('index.html')).toContain('lang="es"');
  });

  it('uses a controlled España selector in every editable address form', () => {
    const checkout = read('checkout.html');
    const profile = read('profile.html');
    expect(checkout.match(/<select name="country"/g)).toHaveLength(2);
    expect(checkout).not.toMatch(/<input name="country"/);
    expect(checkout.match(/<option value="España">España<\/option>/g)).toHaveLength(2);
    expect(profile).toContain('<select id="addrCountry" name="country"');
    expect(profile).not.toMatch(/<input id="addrCountry"/);
    expect(profile).toContain('<option value="España">España</option>');
  });

  it('submits and displays the canonical country in guest, alternative and edit flows', () => {
    const checkout = read('assets/checkout.js');
    const lifecycle = read('assets/checkout-lifecycle.js');
    const profile = read('assets/profile.js');
    expect(checkout).toContain("const SPAIN = Country.SPAIN || 'España'");
    expect(checkout).toContain('country: normalizeCountry(read(shippingFields.country)) || SPAIN');
    expect(checkout).toContain("input.name === 'country' ? SPAIN : ''");
    expect(checkout).toContain("country: normalizeCountry(readField('country')) || SPAIN");
    expect(checkout).toContain(
      'normalizeCountry(shippingFields.country?.value) || SPAIN',
    );
    expect(checkout).toContain(
      'normalizeCountry(address.country) || cleanText(address.country)',
    );
    expect(checkout).not.toContain('cleanText(address.country).toUpperCase()');
    expect(lifecycle).toContain("|| countryApi?.SPAIN || 'España'");
    expect(profile).toContain("Country.SPAIN || 'España'");
  });

  it('ships the shared adapter before checkout, profile and admin consumers', () => {
    for (const page of ['checkout.html', 'profile.html', 'admin-user.html']) {
      const html = read(page);
      expect(html.indexOf('assets/country.js')).toBeGreaterThan(-1);
      expect(html.indexOf('assets/country.js')).toBeLessThan(
        html.indexOf('assets/api.js'),
      );
    }
  });

  it('contains a data-only migration for address and address-snapshot country keys', () => {
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20260812190000_canonical_spanish_country/migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('UPDATE "Address"');
    expect(migration).toContain('UPDATE "CheckoutSnapshot"');
    expect(migration).toContain('UPDATE "Order"');
    expect(migration).toContain("'{country}'");
    expect(migration).not.toContain('ALTER TABLE');
  });
});
