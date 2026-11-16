import type { MailBlock } from './mail-renderer';
import { noreplyLogoBlock } from './mail-logo-header';

export const CIRCLE_PROMOTION_SUBJECT = 'CRONOX · Ya formas parte del Círculo {{circleRoman}}';
export const CIRCLE_PROMOTION_PREHEADER = 'Tu nueva acreditación y tus ventajas ya están disponibles.';

const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
const accreditation = ['', 'negra', 'negra', 'gris', 'blanca', 'roja'];
const earlyAccess = 'Acceso anticipado a los drops.';
const exclusive = 'Acceso a piezas especiales y exclusivas.';
const gallery = 'Posibilidad de aparecer en la galería de CRONOX.';
const benefits: Record<number, string[]> = {
  1: [],
  2: ['Participación en el sorteo mensual de dos códigos de descuento acumulables.'],
  3: [earlyAccess, exclusive],
  4: [earlyAccess, exclusive, '10 % de descuento permanente.', 'Acceso a entradas para eventos privados.', gallery],
  5: [earlyAccess, exclusive, '25 % de descuento permanente.', 'Entradas gratis a eventos privados.',
    'Posibilidad de recibir piezas especiales o regalos.', gallery],
};
export const circleBenefitFields = ['circleBenefit1', 'circleBenefit2', 'circleBenefit3', 'circleBenefit4', 'circleBenefit5', 'circleBenefit6'];

export function circlePromotionData(previous: number, destination: number, frontendUrl: string) {
  const unlocked = benefits[destination].filter(benefit => !benefits[previous]?.includes(benefit));
  return {
    circleLevel: destination,
    circleRoman: roman[destination],
    accreditationColor: accreditation[destination],
    actionLabel: 'Ver mi acreditación',
    actionUrl: new URL('/cuenta?login=1#accreditation', frontendUrl).href,
    ...Object.fromEntries(circleBenefitFields.map((field, index) => [field, unlocked[index] || ''])),
  };
}

export function circlePromotionDocument(circle: number) {
  const accent = ({ 2: '#eeeeee', 3: '#bcbcbc', 4: '#ffffff', 5: '#ff5959' } as Record<number, string>)[circle] || '#eeeeee';
  const copy: MailBlock[] = [
    noreplyLogoBlock('#0b0b0b'),
    { type: 'heading', text: 'Ya formas parte del Círculo {{circleRoman}}', size: 30, weight: 700, color: accent, padding: 8 },
    { type: 'text', text: 'Tu membresía CRONOX ya está actualizada. Tu acreditación {{accreditationColor}} está disponible en tu cuenta.', padding: 8 },
    { type: 'heading', text: 'Tus nuevas ventajas', size: 19, weight: 700, padding: 8 },
    ...circleBenefitFields.map((field): MailBlock => ({
      type: 'text', text: '• {{' + field + '}}', condition: field, padding: 5,
    })),
    { type: 'button', text: '{{actionLabel}}', url: '{{actionUrl}}', padding: 12,
      buttonBackground: '#ffffff', buttonColor: '#111111' },
  ];
  return { schemaVersion: 2 as const, sourceKind: 'cronox-first-party' as const, blocks: [{ type: 'section', padding: 24, background: '#0b0b0b', columns: [copy] }] };
}
