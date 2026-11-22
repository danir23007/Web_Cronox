import { BadRequestException } from '@nestjs/common';
import * as bwip from 'bwip-js';

export const escapeLabel = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function barcodeSvg(code: string) {
  if (!/^CR[XL]\d{10}$/.test(code))
    throw new BadRequestException('Identificador de etiqueta no válido.');
  const svg = bwip.toSVG({
    bcid: 'code128',
    text: code,
    scale: 1,
    height: 10,
    // 11 modules per side exceed Code 128's 10-module quiet-zone minimum.
    // This trims only surplus whitespace; symbol and 0.3 mm modules are unchanged.
    paddingwidth: 11,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
    includetext: false,
  });
  const width = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]) * 0.3;
  // Measure the first black stroke's edge, not the SVG/quiet-zone boundary.
  const firstBarX =
    Math.min(
      ...[...svg.matchAll(/<path\b[^>]*>/g)]
        .filter(([path]) => /stroke="#000000"/i.test(path))
        .flatMap(([path]) => {
          const stroke = Number(/stroke-width="([^"]+)"/.exec(path)?.[1]);
          const d = /\bd="([^"]+)"/.exec(path)?.[1] ?? '';
          return [...d.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)/g)].map(
            (m) => Number(m[1]) - stroke / 2,
          );
        }),
    ) * 0.3;
  if (!Number.isFinite(firstBarX))
    throw new BadRequestException(
      'No se pudo localizar la primera barra del código.',
    );
  return {
    width,
    firstBarX,
    svg: svg.replace(
      '<svg ',
      `<svg style="width:${width}mm;height:10mm" preserveAspectRatio="none" aria-label="${code}" `,
    ),
  };
}
