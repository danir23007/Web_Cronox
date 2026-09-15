import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export const EXCEL_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ExcelCellValue = string | number | boolean | Date | null;

export type ExcelColumn = {
  header: string;
  key: string;
  width?: number;
  numberFormat?: string;
};

export type ExcelSheetDefinition = {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, ExcelCellValue>[];
};

export const sanitizeExcelText = (value: string): string =>
  /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;

@Injectable()
export class ExcelWorkbookService {
  async build(
    title: string,
    sheets: ExcelSheetDefinition[],
    filtersApplied: boolean,
    generatedAt = new Date(),
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CRONOX Admin';
    workbook.created = generatedAt;
    workbook.modified = generatedAt;
    workbook.title = title;

    for (const definition of sheets) {
      const sheet = workbook.addWorksheet(definition.name, {
        views: [{ state: 'frozen', ySplit: 3 }],
        properties: { defaultRowHeight: 18 },
      });
      sheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
      sheet.getCell('A1').value = title;
      sheet.getCell('A1').font = {
        bold: true,
        size: 14,
        color: { argb: 'FF111111' },
      };
      sheet.getCell('A2').value =
        `Generado: ${generatedAt.toISOString()} · Zona horaria: UTC · Filtros: ${filtersApplied ? 'aplicados' : 'ninguno (todos)'}`;
      sheet.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

      const rows = definition.rows.map((row) =>
        definition.columns.map((column) => {
          const value = row[column.key];
          return typeof value === 'string' ? sanitizeExcelText(value) : value;
        }),
      );
      sheet.addTable({
        name: this.tableName(definition.name),
        ref: 'A3',
        headerRow: true,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: definition.columns.map((column) => ({ name: column.header })),
        rows,
      });

      definition.columns.forEach((column, index) => {
        const worksheetColumn = sheet.getColumn(index + 1);
        worksheetColumn.width = Math.min(50, Math.max(10, column.width ?? 18));
        if (column.numberFormat) worksheetColumn.numFmt = column.numberFormat;
      });
      sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(3).height = 22;
    }

    const bytes = await workbook.xlsx.writeBuffer();
    return Buffer.from(bytes);
  }

  timestampedFilename(moduleName: string, now = new Date()): string {
    const stamp = now
      .toISOString()
      .slice(0, 16)
      .replace('T', '_')
      .replace(':', '');
    return `cronox_${moduleName.replace(/[^a-z0-9_-]/gi, '_')}_${stamp}.xlsx`;
  }

  private tableName(sheetName: string): string {
    const normalized = sheetName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return `Tabla${normalized.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 255);
  }
}
