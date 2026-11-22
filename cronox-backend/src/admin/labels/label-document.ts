import PDFDocument = require('pdfkit');
import SVGtoPDF = require('svg-to-pdfkit');
import { LabelLayoutDto, LabelTemplateDefinitionDto } from './labels.dto';
import { asLabelTemplate } from './label-template';
import { layoutGeometry } from './label-layout';
import { labelSvg } from './label-composition';
export { labelSvg, validateLabelTemplate } from './label-composition';
export { barcodeSvg, escapeLabel } from './barcode';

export const BROTHER_PROFILE = 'brother-ql700-continuous62';
export const MM_TO_PT = 72 / 25.4;
export type LabelContent = {
  code: string;
  name: string;
  size: string;
  quantity: number;
  color?: string;
  automatic?: boolean;
};

export function labelPages(
  lines: LabelContent[],
  input: LabelLayoutDto | LabelTemplateDefinitionDto,
) {
  const template = asLabelTemplate(input),
    layout = template.layout;
  const geometry = layoutGeometry(layout);
  const labels = lines.flatMap((line) => {
    const svg = labelSvg(line, template);
    return Array.from({ length: line.quantity }, () => svg);
  });
  const pages: string[] = [],
    perPage = geometry.columns * geometry.rows;
  for (let i = 0; i < labels.length; i += perPage) {
    const placements = labels
      .slice(i, i + perPage)
      .map((svg, j) => {
        const left = geometry.brother
          ? 0
          : layout.margin +
            (j % geometry.columns) * (layout.width + layout.gap);
        const top = geometry.brother
          ? 0
          : layout.margin +
            Math.floor(j / geometry.columns) * (layout.height + layout.gap);
        return `<g class="label" transform="translate(${left} ${top})">${svg.replace(/width="[^"]*"/, 'width="' + layout.width + '"').replace(/height="[^"]*"/, 'height="' + layout.height + '"')}</g>`;
      })
      .join('');
    pages.push(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.pageWidth}mm" height="${layout.pageHeight}mm" viewBox="0 0 ${layout.pageWidth} ${layout.pageHeight}"><rect width="100%" height="100%" fill="white"/>${placements}</svg>`,
    );
  }
  return pages;
}
export function labelDocument(
  lines: LabelContent[],
  input: LabelLayoutDto | LabelTemplateDefinitionDto,
) {
  const template = asLabelTemplate(input),
    layout = template.layout;
  const pages = labelPages(lines, template);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas CRONOX</title><style>@page{size:${layout.pageWidth}mm ${layout.pageHeight}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#ddd}.sheet{width:${layout.pageWidth}mm;height:${layout.pageHeight}mm;margin:0 auto 5mm;break-after:page;overflow:hidden;background:white}.sheet:last-child{break-after:auto}.sheet>svg{display:block;width:100%;height:100%}@media print{html,body{background:white}.sheet{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>${pages.map((svg) => `<section class="sheet">${svg}</section>`).join('')}</body></html>`;
}
export async function labelPdf(
  lines: LabelContent[],
  input: LabelLayoutDto | LabelTemplateDefinitionDto,
): Promise<Buffer> {
  const template = asLabelTemplate(input),
    layout = template.layout;
  const pages = labelPages(lines, template);
  const doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      info: { Title: 'Etiquetas CRONOX' },
      compress: true,
    }),
    chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const svg of pages) {
    const width = layout.pageWidth * MM_TO_PT,
      height = layout.pageHeight * MM_TO_PT;
    doc.addPage({ size: [width, height], margin: 0 });
    SVGtoPDF(doc, svg, 0, 0, {
      width,
      height,
      fontCallback: (_family, bold) => (bold ? 'Helvetica-Bold' : 'Helvetica'),
      warningCallback: (warning) => {
        throw new Error('No se pudo generar el PDF: ' + warning);
      },
    });
  }
  doc.end();
  return result;
}
