import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MailDocument } from './mail-renderer';
import { SAMPLE_DATA } from './mail-catalog';
import { editorCopy, NEWSLETTER_ACCESS_COPY } from './mail-editor-content';

export const WELCOME_SUBJECT = 'CRONOX · Te damos la bienvenida';
export const WELCOME_MESSAGE = 'Aquí empieza tu recorrido dentro de los círculos de CRONOX.';
export { EXAMPLE_WELCOME_CODE } from './welcome-code';
import { requireWelcomeCode } from './welcome-code';

export function welcomeData(code?: string) {
  return { title: 'Bienvenido a CRONOX', message: WELCOME_MESSAGE, discountCode: requireWelcomeCode(code) };
}

export function mailPreviewData(purpose?: string | null) {
  const image = 'https://cronox.es/assets/mail/welcome/fondo-cortinas-email.jpg';
  const data: Record<string, unknown> = {
    ...SAMPLE_DATA,
    ...editorCopy(purpose),
    title: editorCopy(purpose).title || MAIL_PREVIEW_TITLES[purpose || ''] || 'Novedades de CRONOX',
    message: editorCopy(purpose).message || 'Hola, Lucía. Estas son las novedades de CRONOX para tu círculo.',
    customerFullName: 'Lucía Martín', customerEmail: 'lucia.martin@example.test', email: 'lucia.martin@example.test',
    orderId: 'CRX-1042', supportCaseId: 'SOP-1042',
    discountCode: 'VISTA-PREVIA-NO-VALIDO', initialPassword: 'Ejemplo-No-Valido-1042', accountEligible: true,
    product: 'Camiseta CRONOX', productName: 'Camiseta CRONOX', productSlug: 'camiseta-ejemplo',
    size: 'M', imageUrl: image, productImage: image,
    name: 'Camiseta CRONOX', variantName: 'M', quantity: 2, unitPriceFormatted: '34,95 €', lineTotalFormatted: '69,90 €',
    orderUrl: 'https://example.test/pedidos/CRX-1042', storeUrl: 'https://example.test/tienda',
    actionUrl: 'https://example.test/vista-previa/accion', recoveryUrl: 'https://example.test/vista-previa/recuperacion',
    trackingUrl: 'https://example.test/vista-previa/seguimiento/CRX1042PRUEBA', trackingNumber: 'CRX1042PRUEBA',
    shippingAddress: { ...(SAMPLE_DATA.shippingAddress as object), fullName: 'Lucía Martín' },
    items: (SAMPLE_DATA.items as any[]).map(item => ({ ...item, imageUrl: image })),
  };
  if (purpose?.startsWith('ORDER_') && editorCopy(purpose).title) data.statusLabel = editorCopy(purpose).title;
  if (purpose === 'NEWSLETTER_ACCESS') {
    data.message = NEWSLETTER_ACCESS_COPY.eligible;
    data.passwordMessage = `Tu contraseña es: "${data.initialPassword}". Introdúcela sin las comillas.`;
  }
  if (purpose === 'SUPPORT_TICKET_RECEIVED') data.message = 'Hola, necesito ayuda para consultar mi pedido CRX-1042. Gracias, Lucía.';
  return data;
}

const MAIL_PREVIEW_TITLES: Record<string, string> = {
  ORDER_CONFIRMATION: 'Confirmación de pedido', ORDER_TRACKING: 'Seguimiento del pedido',
  RESTOCK: 'Tu talla ha vuelto', SUPPORT_TICKET_RECEIVED: 'Solicitud de soporte recibida',
  INITIAL_PASSWORD_SETUP: 'Tu cuenta ha sido creada',
};

export function welcomeDocument(approved = true): MailDocument {
  const file = approved ? 'newsletter-welcome-approved.hbs' : 'newsletter-welcome-fallback.hbs';
  let html: string;
  try { html = readFileSync(join(__dirname, '../templates', file), 'utf8'); }
  catch { html = readFileSync(join(process.cwd(), 'src/email/templates', file), 'utf8'); }
  return {
    schemaVersion: 3, format: 'html-email',
    page: { width: 600, background: '#aaa9a6', colorScheme: 'light-only', ...(approved ? { canvas: 'body' as const } : {}) },
    blocks: [{ type: 'html', html, padding: 0, background: '#aaa9a6' }],
  };
}
