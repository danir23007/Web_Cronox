import type { LabelContent } from './label-document';

const colors: Record<string, string> = {
  black: 'BLACK',
  negro: 'BLACK',
  negra: 'BLACK',
  grey: 'GREY',
  gray: 'GREY',
  gris: 'GREY',
  white: 'WHITE',
  blanco: 'WHITE',
  blanca: 'WHITE',
  red: 'RED',
  rojo: 'RED',
  roja: 'RED',
  blue: 'BLUE',
  azul: 'BLUE',
  green: 'GREEN',
  verde: 'GREEN',
  navy: 'NAVY',
  beige: 'BEIGE',
  brown: 'BROWN',
  marrón: 'BROWN',
  marron: 'BROWN',
  pink: 'PINK',
  rosa: 'PINK',
  purple: 'PURPLE',
  morado: 'PURPLE',
  yellow: 'YELLOW',
  amarillo: 'YELLOW',
  orange: 'ORANGE',
  naranja: 'ORANGE',
};
const normalize = (value: string) => {
  const key = value.normalize('NFC').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(colors, key) ? colors[key] : null;
};
export function labelPresentation(
  product: { name: string; color?: string | null; colour?: string | null },
  variant?: { color?: string | null; colour?: string | null },
) {
  const suffix = /^(.*?)\s+-\s+([^\n]+?)\s*$/.exec(product.name.trim());
  const suffixColor = suffix ? normalize(suffix[2]) : null;
  const structured =
    variant?.color || variant?.colour || product.color || product.colour;
  const color = structured ? normalize(structured) : suffixColor;
  const base = (suffixColor ? suffix![1] : product.name).trim();
  const modelName = /^CORE\s+TEE$/i.test(base) ? 'Core-tee' : base;
  return {
    modelName,
    color,
    colorSource: color ? (structured ? 'structured' : 'name-suffix') : null,
    warning: null,
  };
}
export function automaticLabelContent(
  product: { name: string; color?: string | null; colour?: string | null },
  variant: { size: string; color?: string | null; colour?: string | null },
  code: string,
  quantity: number,
): LabelContent {
  const presentation = labelPresentation(product, variant);
  return {
    name: presentation.modelName.toUpperCase(),
    color: presentation.color ?? '-',
    size: variant.size.replace('US_', 'US '),
    code,
    quantity,
    automatic: true,
  };
}
