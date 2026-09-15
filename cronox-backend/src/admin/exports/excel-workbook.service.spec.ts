import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import {
  ExcelWorkbookService,
  sanitizeExcelText,
} from './excel-workbook.service';

describe('ExcelWorkbookService', () => {
  const service = new ExcelWorkbookService();

  it.each(['=1+1', ' +SUM(A1:A2)', '\t-2', '@cmd'])(
    'neutralizes formula-like text: %s',
    (value) => expect(sanitizeExcelText(value)).toBe(`'${value}`),
  );

  it.each([
    ['nombre', '=CMD()'],
    ['email', '+attacker@example.test'],
    ['dirección', '-1 malicious street'],
    ['producto', '@SUM(A1)'],
    ['nota', '  =HYPERLINK("bad")'],
    ['metadato de auditoría', '\t+1'],
  ])(
    'neutralizes malicious %s values through the shared sanitizer',
    (_field, value) => {
      expect(sanitizeExcelText(value)).toBe(`'${value}`);
    },
  );

  it('does not alter ordinary text or typed numeric values', () => {
    expect(sanitizeExcelText('CRONOX + FRIENDS')).toBe('CRONOX + FRIENDS');
    expect(sanitizeExcelText('600123123')).toBe('600123123');
  });

  it('creates a real XLSX with frozen headers, filters and typed cells', async () => {
    const generatedAt = new Date('2026-09-15T12:30:00.000Z');
    const buffer = await service.build(
      'CRONOX · Prueba',
      [
        {
          name: 'Datos',
          columns: [
            { header: 'Texto', key: 'text' },
            { header: 'Importe', key: 'amount', numberFormat: '#,##0.00' },
            { header: 'Fecha', key: 'date', numberFormat: 'yyyy-mm-dd hh:mm' },
          ],
          rows: [
            { text: '=HYPERLINK("bad")', amount: 12.5, date: generatedAt },
          ],
        },
      ],
      true,
      generatedAt,
    );

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Datos')!;
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });
    expect(sheet.getCell('A3').value).toBe('Texto');
    expect(sheet.getCell('A4').value).toBe('\'=HYPERLINK("bad")');
    expect(sheet.getCell('B4').value).toBe(12.5);
    expect(sheet.getCell('C4').value).toBeInstanceOf(Date);
    expect(sheet.getTables()).toHaveLength(1);
    expect(sheet.getCell('A2').value).toContain('Zona horaria: UTC');
  });

  it('supports an empty result set without inventing rows', async () => {
    const buffer = await service.build(
      'Vacío',
      [{ name: 'Vacío', columns: [{ header: 'ID', key: 'id' }], rows: [] }],
      false,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('Vacío')?.getCell('A3').value).toBe('ID');
    expect(workbook.getWorksheet('Vacío')?.rowCount).toBe(3);
  });

  it('uses in-memory buffers and never creates temporary or permanent files', () => {
    const implementation = readFileSync(
      __filename.replace(/\.spec\.ts$/, '.ts'),
      'utf8',
    );
    expect(implementation).not.toMatch(/writeFile|createWriteStream|tmpdir/);
    expect(implementation).toContain('workbook.xlsx.writeBuffer()');
  });
});
