import type { MailBlock, MailDocument } from './mail-renderer';
import { MAIL_LOGO_WHITE } from './mail-logo-header';

export const CART_COPY = {
  name: 'Cesta abandonada',
  subject: '¿Te quedaste con las ganas?',
  preheader: 'Tu selección sigue en la cesta. Tú decides cómo termina.',
  title: 'Si acabó en tu cesta, por algo sería.',
  message: 'Lo dejaste en la cesta y seguiste a lo tuyo. Ahora puedes volver justo donde lo dejaste.',
  selection: 'Tu selección',
  action: 'VOLVER A MI CESTA',
  note: 'Las prendas no están reservadas. El precio y la disponibilidad se actualizarán al volver a tu cesta.',
};

/** New defaults and explicit persisted-template update use the same document.
 * Keep the existing circle's header, surface and classification outside it. */
export function cartAbandonedDocument(existing?: MailDocument): MailDocument & { schemaVersion: 2; sourceKind: 'cronox-first-party' } {
  const section = existing?.blocks.find(block => block.type === 'section');
  const background = section?.background || '#0b0b0b';
  const base = { background, color: '#eeeeee', padding: 10, align: 'left', lineHeight: 1.6 };
  const header = section?.columns?.[0]?.find(block => ['image', 'logo'].includes(block.type) && block.alt === 'CRONOX');
  const blocks: MailBlock[] = [
    header ? structuredClone(header) : { type: 'image', src: MAIL_LOGO_WHITE, alt: 'CRONOX', width: 148, padding: 10, background },
    { ...base, type: 'heading', text: CART_COPY.title, size: 26, weight: 700, lineHeight: 1.2 },
    { ...base, type: 'text', text: CART_COPY.message, size: 14 },
    { ...base, type: 'html', paddingBottom: 2, html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="28" valign="middle"><img src="https://cronox.es/assets/mail/global-footer/basket-dark.png" width="18" height="18" alt="Cesta" style="display:block;border:0;"></td><td valign="middle" style="font-size:17px;font-weight:700;color:#eeeeee;">${CART_COPY.selection}</td></tr></table>` },
    { ...base, type: 'orderItems', size: 14, paddingTop: 0, labels: { empty: 'No hay prendas disponibles.' } },
    { ...base, type: 'button', text: CART_COPY.action, url: '{{actionUrl}}', size: 13, weight: 700, padding: 14, buttonColor: '#111111', buttonBackground: '#ffffff', borderRadius: 2 },
    { ...base, type: 'text', text: CART_COPY.note, size: 11, color: '#b7b7bb', paddingBottom: 0 },
  ];
  return { schemaVersion: 2, sourceKind: 'cronox-first-party', blocks: [{ ...section, ...base, type: 'section', padding: section?.padding ?? 24, paddingBottom: 0, columns: [blocks] }] };
}

/** The original photo is centered in a small frame, with real aspect dimensions
 * carried in HTML attributes. Missing metadata never forces a square photo. */
export function cartItemsHtml() {
  return `{{#each items}}<table class="cart-mail-product" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border-top:1px solid #38383c;background:transparent;color:#eeeeee;"><tr><td width="80" valign="middle" style="padding:12px 10px 12px 0;"><table role="presentation" width="70" height="70" cellpadding="0" cellspacing="0" border="0"><tr><td width="70" height="70" align="center" valign="middle" style="padding:0;font-size:0;line-height:0;">{{#if imageUrl}}{{#if imageWidth}}<img src="{{imageUrl}}" alt="{{name}}" width="{{imageWidth}}" height="{{imageHeight}}" style="display:inline-block;width:{{imageWidth}}px;height:{{imageHeight}}px;border:0;">{{else}}<img src="{{imageUrl}}" alt="{{name}}" style="display:inline-block;width:auto;height:auto;max-width:70px;max-height:70px;border:0;">{{/if}}{{/if}}</td></tr></table></td><td valign="middle" style="padding:12px 8px 12px 0;color:#eeeeee;"><strong>{{name}}</strong><br><span style="font-size:12px;color:#b7b7bb;">Talla {{variantName}} · Cantidad {{quantity}}</span></td><td align="right" valign="middle" style="padding:12px 0;color:#eeeeee;white-space:nowrap;font-size:13px;"><strong>{{lineTotalFormatted}}</strong></td></tr></table>{{else}}<p>No hay prendas disponibles.</p>{{/each}}`;
}
