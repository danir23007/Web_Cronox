import { circlePromotionData, circlePromotionDocument, CIRCLE_PROMOTION_SUBJECT } from './circle-promotion-design';
import { renderMail } from './mail-renderer';

describe('circle promotion email', () => {
  it.each([
    [2, 'II', 'negra', 'sorteo mensual'],
    [3, 'III', 'gris', 'Acceso anticipado'],
    [4, 'IV', 'blanca', '10 % de descuento permanente'],
    [5, 'V', 'roja', '25 % de descuento permanente'],
  ])('renders the member link and newly unlocked benefits for circle %s', (level, roman, color, benefit) => {
    const data = circlePromotionData(level - 1, level, 'https://example.test');
    const result = renderMail(circlePromotionDocument(level), CIRCLE_PROMOTION_SUBJECT, '', 'CIRCLE_PROMOTION', data, undefined, true);
    expect(result.subject).toBe(`CRONOX · Ya formas parte del Círculo ${roman}`);
    expect(result.html).toContain(`acreditación ${color}`);
    expect(result.html).toContain('href="https://example.test/cuenta?login=1#accreditation"');
    expect(result.text).toContain(benefit);
    expect(result.html).not.toContain('{{');
    if (level > 3) expect(result.text).not.toContain('Acceso anticipado');
  });

  it('includes all newly unlocked advantages when someone skips a circle', () => {
    const data = circlePromotionData(2, 5, 'https://example.test');
    const result = renderMail(circlePromotionDocument(5), CIRCLE_PROMOTION_SUBJECT, '', 'CIRCLE_PROMOTION', data);
    expect(result.text).toContain('Acceso anticipado');
    expect(result.text).toContain('Entradas gratis');
    expect(result.text).not.toContain('10 %');
  });
});
