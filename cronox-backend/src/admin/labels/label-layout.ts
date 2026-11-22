import { BadRequestException } from '@nestjs/common';
import { LabelLayoutDto } from './labels.dto';
const BROTHER_PROFILE = 'brother-ql700-continuous62';
export function layoutGeometry(layout: LabelLayoutDto) {
  const {
    width,
    height,
    margin,
    gap,
    padding,
    pageWidth,
    pageHeight,
    profile,
    orientation,
  } = layout;
  if (
    ![width, height, margin, gap, padding, pageWidth, pageHeight].every(
      Number.isFinite,
    )
  ) {
    throw new BadRequestException(
      'Las medidas de la plantilla deben ser números válidos en milímetros.',
    );
  }
  const brother =
    profile === BROTHER_PROFILE || profile === 'brother-ql700-dk22223';
  const rollWidth = profile === BROTHER_PROFILE ? 62 : 50;
  if (
    brother &&
    (width !== rollWidth ||
      pageWidth !== rollWidth ||
      pageHeight !== height ||
      gap !== 0 ||
      orientation !== 'portrait')
  )
    throw new BadRequestException(
      `El perfil Brother exige papel de ${rollWidth} mm de ancho, composición horizontal sin giro, una etiqueta por página y avance igual al corte.`,
    );
  // 62 mm: 696 dots / 58.93 mm printable; reserve 58.9 mm inside the paper.
  // Historical 50 mm: 554 dots / 46.9 mm. Offsets are INSIDE the page,
  // never added to its size or to the feed configured in the Brother driver.
  if (brother && (padding < 1.55 || margin < 3))
    throw new BadRequestException(
      `Brother ${rollWidth} mm: conserva al menos 1,55 mm a cada lado (${rollWidth - 3.1} mm imprimibles) y 3 mm en cada extremo del corte, dentro del papel.`,
    );
  const columns = brother
    ? 1
    : Math.floor((pageWidth - 2 * margin + gap) / (width + gap));
  const rows = brother
    ? 1
    : Math.floor((pageHeight - 2 * margin + gap) / (height + gap));
  const side = padding,
    end = brother ? margin : padding;
  const innerWidth = width - 2 * side,
    innerHeight = height - 2 * end;
  const logicalWidth = orientation === 'rotated' ? innerHeight : innerWidth;
  const logicalHeight = orientation === 'rotated' ? innerWidth : innerHeight;
  if (columns < 1 || rows < 1 || logicalHeight <= 0)
    throw new BadRequestException(
      'El área imprimible queda vacía. Revisa el alto y los márgenes.',
    );
  return {
    brother,
    columns,
    rows,
    side,
    end,
    innerWidth,
    innerHeight,
    logicalWidth,
    logicalHeight,
  };
}
