import { BadRequestException } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  LabelLayoutDto,
  LabelTemplateDefinitionDto,
  LabelElementDto,
} from './labels.dto';
import { asLabelTemplate } from './label-template';
import { layoutGeometry } from './label-layout';
import { barcodeSvg, escapeLabel } from './barcode';
import type { LabelContent } from './label-document';

const metrics = new PDFDocument({ autoFirstPage: false });
const mandatory = ['brand', 'name', 'size', 'color', 'barcode', 'identifier'];
export function validateLabelDefinition(template: LabelTemplateDefinitionDto) {
  const parsed = plainToInstance(LabelTemplateDefinitionDto, template);
  if (
    validateSync(parsed, { whitelist: true, forbidNonWhitelisted: true }).length
  )
    throw new BadRequestException(
      'La plantilla contiene campos o valores inválidos. Revisa tamaños de letra (6–18 pt), separaciones (0–5 mm) y textos (hasta 160 caracteres).',
    );
  const ids = template.elements.map((e) => e.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-zA-Z0-9_-]{1,60}$/.test(id))
  )
    throw new BadRequestException(
      'Cada elemento debe tener un identificador interno único válido.',
    );
  for (const kind of mandatory)
    if (template.elements.filter((e) => e.kind === kind).length !== 1)
      throw new BadRequestException(
        `La plantilla debe conservar un único elemento «${kind}»; puedes ocultar los campos opcionales.`,
      );
  if (!template.elements.find((e) => e.kind === 'barcode')!.visible)
    throw new BadRequestException(
      'El código de barras es obligatorio y no puede ocultarse.',
    );
  if (template.elements.some((e) => e.kind !== 'custom' && e.text !== ''))
    throw new BadRequestException(
      'Nombre, talla y color se obtienen del catálogo; solo los textos personalizados pueden editarse.',
    );
  if (template.elements.some((e) => e.kind === 'name' && e.maxLines > 2))
    throw new BadRequestException('El nombre admite como máximo dos líneas.');
  layoutGeometry(template.layout);
}

function wrapped(
  value: string,
  width: number,
  el: LabelElementDto,
  bold: boolean,
) {
  value = value.normalize('NFC');
  if (
    /[^\u0020-\u007e\u00a0-\u00ff\n\r\t\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/u.test(
      value,
    )
  )
    throw new BadRequestException(
      `El campo «${el.kind}» incluye caracteres que la fuente vectorial de impresión no admite. Sustituye esos caracteres en el texto personalizado u oculta el campo.`,
    );
  metrics
    .font(bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize((el.fontSizePt * 25.4) / 72);
  const paragraphs = value.replace(/\r/g, '').split('\n'),
    lines: string[] = [];
  for (const paragraph of paragraphs) {
    const input = Array.from(paragraph.replace(/\s+/g, ' ').trim());
    if (!input.length) {
      lines.push('');
      continue;
    }
    while (input.length) {
      let text = '';
      while (input.length && metrics.widthOfString(text + input[0]) <= width)
        text += input.shift();
      if (!text)
        throw new BadRequestException(
          `«${el.kind}»: un carácter no cabe. Reduce el tamaño de letra o los márgenes.`,
        );
      if (input.length && text.lastIndexOf(' ') > text.length / 2) {
        const cut = text.lastIndexOf(' ');
        input.unshift(...Array.from(text.slice(cut + 1)));
        text = text.slice(0, cut);
      }
      lines.push(text.trim());
      if (lines.length > el.maxLines) break;
    }
    if (lines.length > el.maxLines) break;
  }
  if (lines.length > el.maxLines) {
    if (el.kind !== 'name')
      throw new BadRequestException(
        `«${el.kind === 'custom' ? el.text : el.kind}» necesita más de ${el.maxLines} líneas. Reduce la letra, amplía las líneas o acorta el texto.`,
      );
    lines.length = el.maxLines;
    let last = lines[lines.length - 1];
    while (metrics.widthOfString(last + '…') > width) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

export function labelSvg(
  line: LabelContent,
  input: LabelLayoutDto | LabelTemplateDefinitionDto,
) {
  const template = asLabelTemplate(input),
    layout = template.layout;
  validateLabelDefinition(template);
  const g = layoutGeometry(layout),
    barcode = barcodeSvg(line.code);
  if (barcode.width > g.logicalWidth + 0.0001)
    throw new BadRequestException(
      `El código necesita ${barcode.width.toFixed(1)} mm con sus zonas de silencio; hay ${g.logicalWidth.toFixed(1)} mm. No se comprimirá: gira el contenido 90° o amplía el alto útil.`,
    );
  const barcodeAlign = template.elements.find(
    (e) => e.kind === 'barcode',
  )!.align;
  const barcodeX =
    barcodeAlign === 'left'
      ? 0
      : barcodeAlign === 'right'
        ? g.logicalWidth - barcode.width
        : (g.logicalWidth - barcode.width) / 2;
  const textInset =
    line.automatic && layout.profile === 'brother-ql700-continuous62'
      ? barcodeX +
        barcode.firstBarX -
        metrics
          .font('Helvetica-Bold')
          .fontSize(
            (template.elements.find((e) => e.kind === 'brand')!.fontSizePt *
              25.4) /
              72,
          )
          .widthOfString('C')
      : 0;
  const labels: Record<string, string> = {
    brand: 'CRONOX',
    name: line.automatic ? line.name.toUpperCase() : line.name,
    size: line.automatic
      ? `SIZE: ${line.size.toUpperCase()}`
      : `Talla: ${line.size}`,
    color: line.color
      ? line.automatic
        ? `COLOUR: ${line.color.toUpperCase()}`
        : line.color
      : '',
    identifier: line.code,
  };
  const visible = template.elements.filter(
    (e) =>
      e.visible &&
      !(line.automatic && e.kind === 'brand') &&
      (e.kind === 'barcode' || e.kind === 'custom'
        ? e.kind === 'barcode' || !!e.text.trim()
        : !!labels[e.kind]),
  );
  // In the 50 mm profile, adjacent name/size fields form a compact row.
  // Reordering them apart restores the usual single-column flow.
  const paired = (i: number) =>
    !line.automatic &&
    ['brother-ql700-dk22223', 'brother-ql700-continuous62'].includes(
      layout.profile,
    ) &&
    visible[i]?.kind === 'name' &&
    visible[i + 1]?.kind === 'size';
  const blocks = visible.map((el, index) => {
    const nameColumn = paired(index),
      sizeColumn = paired(index - 1);
    const inset =
      line.automatic && ['name', 'color', 'size'].includes(el.kind)
        ? textInset
        : 0;
    const width = nameColumn
      ? g.logicalWidth - 16
      : sizeColumn
        ? 15
        : g.logicalWidth - inset;
    const left = sizeColumn ? g.logicalWidth - 15 : inset;
    const header = line.automatic && el.kind === 'name';
    const prefixFont = header
      ? (template.elements.find((e) => e.kind === 'brand')!.fontSizePt * 25.4) /
        72
      : 0;
    const prefixWidth = header
      ? metrics
          .font('Helvetica-Bold')
          .fontSize(prefixFont)
          .widthOfString('CRONOX:') + 0.65
      : 0;
    const bold = el.kind === 'brand' || (!line.automatic && el.kind === 'size');
    const lines =
      el.kind === 'barcode'
        ? []
        : wrapped(
            el.kind === 'custom'
              ? el.text
              : sizeColumn
                ? line.size
                : labels[el.kind],
            width - 0.4 - prefixWidth,
            el,
            bold,
          );
    // Reserve the full Helvetica/Arial ascent and descent, even at zero gap.
    const font = (el.fontSizePt * 25.4) / 72,
      leading = Math.max(font, prefixFont) * 1.4;
    return {
      el,
      header,
      prefixFont,
      bold,
      lines,
      font,
      leading,
      width,
      left,
      height: el.kind === 'barcode' ? 10 : lines.length * leading,
    };
  });
  const rows: Array<{ blocks: typeof blocks; height: number }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const members = paired(i) ? [blocks[i], blocks[++i]] : [blocks[i]];
    rows.push({
      blocks: members,
      height: Math.max(...members.map((b) => b.height)),
    });
  }
  const gaps = rows.map((row, i) =>
    i === rows.length - 1
      ? 0
      : Math.max(
          ...row.blocks.map((b) => b.el.gapAfter),
          row.blocks.some((b) => b.el.kind === 'barcode') ||
            rows[i + 1].blocks.some((b) => b.el.kind === 'barcode')
            ? 0.8
            : 0,
        ),
  );
  const total = rows.reduce((n, row, i) => n + row.height + gaps[i], 0);
  if (total > g.logicalHeight + 0.0001)
    throw new BadRequestException(
      `La composición ocupa ${total.toFixed(1)} mm y solo hay ${g.logicalHeight.toFixed(1)} mm libres en este eje. Reduce tamaños o separación, oculta campos o elimina textos. El código no se reducirá.`,
    );
  // The extra 1 mm before the barcode grows upward: preserve its baseline,
  // the identifier and the bottom clearance of the previous 35 mm design.
  let y =
      (g.logicalHeight - total) / 2 -
      (line.automatic && layout.profile === 'brother-ql700-continuous62'
        ? 0.5
        : 0),
    content = '';
  for (let i = 0; i < rows.length; i++) {
    for (const b of rows[i].blocks) {
      const el = b.el,
        blockY = y + (rows[i].height - b.height) / 2;
      if (el.kind === 'barcode') {
        const x = barcodeX;
        content += barcode.svg
          .replace(/ style="[^"]*"/, '')
          .replace(
            '<svg ',
            `<svg data-element="${el.id}" x="${x}" y="${blockY}" width="${barcode.width}" height="10" `,
          );
      } else {
        const centeredIdentifier = line.automatic && el.kind === 'identifier';
        const x = centeredIdentifier
            ? barcodeX + barcode.width / 2
            : el.align === 'left'
              ? b.left
              : el.align === 'right'
                ? b.left + b.width - 0.2
                : b.left + b.width / 2,
          anchor = centeredIdentifier
            ? 'middle'
            : el.align === 'left'
              ? 'start'
              : el.align === 'right'
                ? 'end'
                : 'middle';
        content +=
          `<g data-element="${el.id}"><title>${escapeLabel((b.header ? 'CRONOX: ' : '') + (el.kind === 'custom' ? el.text : labels[el.kind]))}</title>` +
          b.lines
            .map(
              (t, j) =>
                `<text x="${x}" y="${blockY + Math.max(b.font, b.prefixFont) * 1.08 + j * b.leading}" text-anchor="${anchor}" font-family="Helvetica,Arial,sans-serif" font-size="${b.font}"${b.bold ? ' font-weight="bold"' : ''}>${b.header ? `<tspan font-weight="bold" font-size="${b.prefixFont}">CRONOX:</tspan><tspan dx="0.65" font-weight="normal">${escapeLabel(t)}</tspan>` : escapeLabel(t)}</text>`,
            )
            .join('') +
          '</g>';
      }
    }
    y += rows[i].height + gaps[i];
  }
  const transform =
    layout.orientation === 'rotated'
      ? `translate(${layout.width - g.side} ${g.end}) rotate(90)`
      : `translate(${g.side} ${g.end})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Etiqueta ${line.code}"><rect width="${layout.width}" height="${layout.height}" fill="white"/><g fill="black" transform="${transform}">${content}</g></svg>`;
}

export function validateLabelTemplate(template: LabelTemplateDefinitionDto) {
  validateLabelDefinition(template);
  // Reserve space for two name lines and the longest current size family,
  // including optional color. Actual variants are also composed before printing.
  try {
    labelSvg(
      {
        code: 'CRX2147483647',
        name: 'Nombre de producto con una descripción larga '.repeat(8),
        size: 'US 12',
        color: 'Negro',
        quantity: 1,
      },
      template,
    );
  } catch (error) {
    if (error instanceof BadRequestException)
      throw new BadRequestException(
        'Prueba de plantilla con nombre de dos líneas, talla US 12 y color: ' +
          error.message,
      );
    throw error;
  }
}
