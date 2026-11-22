import {
  LabelLayoutDto,
  LabelElementDto,
  LabelTemplateDefinitionDto,
} from './labels.dto';

export function defaultLabelTemplate(
  layout: LabelLayoutDto = new LabelLayoutDto(),
): LabelTemplateDefinitionDto {
  const element = (
    kind: string,
    fontSizePt: number,
    maxLines = 1,
  ): LabelElementDto => ({
    id: kind,
    kind,
    visible: true,
    text: '',
    fontSizePt,
    align: 'center',
    gapAfter: 0.3,
    maxLines,
  });
  return {
    schemaVersion: 2,
    layout: { ...layout },
    elements: [
      element('brand', 8),
      element('name', 6.5, 2),
      element('size', 11),
      element('color', 6),
      element('barcode', 7.5),
      element('identifier', 6),
    ],
  };
}

export function asLabelTemplate(
  input: LabelTemplateDefinitionDto | LabelLayoutDto,
): LabelTemplateDefinitionDto {
  return 'elements' in input ? input : defaultLabelTemplate(input);
}

// Automatic printing is intentionally independent of historical saved designs.
export function automaticLabelTemplate(): LabelTemplateDefinitionDto {
  const template = defaultLabelTemplate();
  const sizes: Record<string, number> = {
    brand: 7,
    name: 6.5,
    color: 6.5,
    size: 6.5,
    barcode: 7.5,
    identifier: 6,
  };
  template.elements = [
    'brand',
    'name',
    'color',
    'size',
    'barcode',
    'identifier',
  ].map((kind) => ({
    id: kind,
    kind,
    visible: true,
    text: '',
    fontSizePt: sizes[kind],
    align: ['barcode', 'identifier'].includes(kind) ? 'center' : 'left',
    gapAfter: kind === 'size' ? 1.8 : 0.1,
    maxLines: 1,
  }));
  return template;
}
