import { readFileSync } from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('Admin Excel export UI contracts', () => {
  const admin = readFrontend('assets/admin.js');
  const api = readFrontend('src/admin/api.ts');

  it('offers filtered and complete exports for every data module, excluding visual editors', () => {
    for (const section of [
      'section-activity',
      'section-users',
      'section-23',
      'section-34',
      'section-orders',
      'section-inventory',
      'section-products',
      'section-codes',
    ]) {
      expect(admin).toContain(`'${section}':`);
    }
    for (const excluded of [
      'section-gallery',
      'section-media',
      'section-mails',
      'section-key-screen',
    ]) {
      expect(admin).not.toContain(`'${excluded}': 'excel`);
      expect(
        admin.slice(
          admin.indexOf('const EXCEL_EXPORT_SECTIONS'),
          admin.indexOf('const excelExportsInFlight'),
        ),
      ).not.toContain(excluded);
    }
    expect(admin).toContain('Descargar resultados filtrados');
    expect(admin).toContain('Descargar todos');
  });

  it('shows exports only to SUPERADMIN and prevents duplicate clicks while loading', () => {
    expect(admin).toContain("if (currentAdminRole !== 'SUPERADMIN') return;");
    expect(admin).toContain('excelExportsInFlight.has(key)');
    expect(admin).toContain("button.setAttribute('aria-busy', 'true')");
    expect(admin).toContain("button.textContent = 'Preparando Excel…'");
    expect(admin).toContain('excelExportsInFlight.delete(key)');
    expect(admin).toContain(
      'showToast(error?.message || classification.userMessage',
    );
  });

  it('passes current filters or an explicit all scope and downloads only allowlisted modules', () => {
    expect(admin).toContain(
      "scope === 'all' ? {} : excelFiltersFor(module, sectionId)",
    );
    expect(admin).toContain('downloadExcel(module, { scope, ...filters })');
    expect(api).toContain('adminApi.downloadExcel = async');
    expect(api).toContain('if (!allowedModules.has(module))');
    expect(api).toContain("credentials: 'include'");
    expect(api).toContain("cache: 'no-store'");
    expect(api).toContain('await response.blob()');
  });
});
