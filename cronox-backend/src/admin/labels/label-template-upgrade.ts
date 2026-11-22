import { defaultLabelTemplate } from './label-template';
import { validateLabelTemplate } from './label-composition';
import { LabelTemplateDefinitionDto } from './labels.dto';

// Pure conversion: never mutates the saved record, catalogue, or barcode values.
export function upgradeLabelTemplate(source: LabelTemplateDefinitionDto) {
  if (
    source.schemaVersion === 2 &&
    source.layout.profile !== 'brother-ql700-dk22225'
  )
    return { template: source, changed: false, valid: true, notice: '' };
  const candidate = JSON.parse(
    JSON.stringify(source),
  ) as LabelTemplateDefinitionDto;
  candidate.schemaVersion = 2;
  candidate.layout = {
    ...defaultLabelTemplate().layout,
    margin: Math.max(3, source.layout.margin ?? 3),
    padding: Math.max(1.55, source.layout.padding ?? 1.55),
  };
  try {
    validateLabelTemplate(candidate);
    return {
      template: candidate,
      changed: true,
      valid: true,
      notice:
        'Formato adaptado a 62 × 35 mm horizontal; campos, textos, orden y tipografía conservados. Guarda la adaptación para compartirla.',
    };
  } catch {}
  // Whitespace from the taller layout may not fit. Preserve all content/font
  // settings and trim only incompatible whitespace; never shrink barcode bars.
  candidate.layout.margin = 3;
  candidate.layout.padding = 1.55;
  candidate.elements = candidate.elements.map((e) => ({
    ...e,
    gapAfter: Math.min(e.gapAfter, 0.3),
  }));
  try {
    validateLabelTemplate(candidate);
    return {
      template: candidate,
      changed: true,
      valid: true,
      notice:
        'Formato adaptado a 62 × 35 mm horizontal. Se compactaron separaciones y márgenes; los textos, campos, orden y tipografía se conservan. Guarda la adaptación.',
    };
  } catch (error) {
    return {
      template: candidate,
      changed: true,
      valid: false,
      notice:
        'La plantilla anterior se conserva en la base de datos. El borrador usa 62 × 35 mm y necesita revisión antes de guardarlo o imprimirlo: ' +
        (error instanceof Error ? error.message : 'Composición incompatible.'),
    };
  }
}
