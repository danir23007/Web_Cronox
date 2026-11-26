import type { MailBlock, MailDocument } from './mail-renderer';
import { MAIL_LOGO_WHITE } from './mail-logo-header';

export const BLACK_FRIDAY_COPY = {
  name: 'Black Friday · Los números no son casualidad',
  subject: '11, 22, 33, 44… ¿Y el 77?',
  preheader: 'Los números no son casualidad. Tu próxima prenda, tampoco.',
  url: 'https://cronox.es/',
};
export const BLACK_FRIDAY_FAMILY = 'campaign:INFO:BLACK_FRIDAY_NUMBERS_2026';
export const BLACK_FRIDAY_DRAFT = 'campaign-draft:INFO:BLACK_FRIDAY_NUMBERS_2026';

/** Native editor blocks: the empty image is deliberately awaiting the owner. */
export function blackFridayDocument(): MailDocument {
  const base = { background: '#111111', color: '#ffffff', align: 'center', padding: 16 };
  const block = (value: MailBlock): MailBlock => ({ ...base, ...value });
  return { blocks: [
    block({ type: 'image', src: MAIL_LOGO_WHITE, alt: 'CRONOX', width: 148, paddingTop: 30, paddingBottom: 28 }),
    block({ type: 'rich', size: 19, lineHeight: 1.3, paddingBottom: 28,
      html: '<p style="margin:0;font-size:19px;line-height:1.3;color:#ffffff;">Ahora sí, <strong style="font-size:46px;font-weight:800;line-height:1.15;">BLACK FRIDAY</strong> en CRONOX</p>' }),
    block({ type: 'image', src: '', alt: '', width: 560, paddingTop: 0, paddingBottom: 24 }),
    block({ type: 'text', text: '11, 22, 33, 44… ¿77?', size: 30, weight: 800, lineHeight: 1.25, paddingTop: 20 }),
    block({ type: 'text', text: 'Los números no son casualidad.\nTu próxima prenda, tampoco.', size: 19, lineHeight: 1.5, paddingBottom: 28 }),
    block({ type: 'text', text: 'DESCUENTOS DE MÁS DEL 50 %', size: 28, weight: 800, lineHeight: 1.25, paddingTop: 24, paddingBottom: 24 }),
    block({ type: 'button', text: 'DESCUBRIR LOS PRECIOS', url: BLACK_FRIDAY_COPY.url, buttonBackground: '#ffffff', buttonColor: '#000000', size: 15, weight: 800, padding: 18, borderRadius: 0 }),
    block({ type: 'text', text: 'Primer Black Friday, probablemente únicas rebajas del año.', size: 12, lineHeight: 1.5, paddingTop: 8, paddingBottom: 32 }),
  ] };
}
