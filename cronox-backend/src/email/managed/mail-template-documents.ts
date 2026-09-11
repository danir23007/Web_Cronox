import type { MailBlock, MailDocument } from './mail-renderer';

type VisualDocument = MailDocument & {
  schemaVersion: 2;
  sourceKind: 'cronox-first-party';
  legacySource?: unknown;
};

const dark = {
  color: '#eeeeee',
  background: '#0b0b0b',
  align: 'left',
};
const light = {
  color: '#4b4b4b',
  background: '#f7f7f5',
  align: 'left',
};
const text = (value: string, options: Partial<MailBlock> = {}): MailBlock => ({
  type: 'text',
  text: value,
  padding: 10,
  size: 14,
  weight: 400,
  lineHeight: 1.6,
  ...dark,
  ...options,
});
const heading = (
  value: string,
  options: Partial<MailBlock> = {},
): MailBlock => ({
  ...text(value, options),
  type: 'heading',
  size: options.size ?? 26,
  weight: options.weight ?? 700,
  lineHeight: options.lineHeight ?? 1.2,
});
const button = (
  value: string,
  url: string,
  options: Partial<MailBlock> = {},
): MailBlock => ({
  type: 'button',
  text: value,
  url,
  padding: 14,
  size: 13,
  weight: 700,
  lineHeight: 1.2,
  color: '#eeeeee',
  background: '#0b0b0b',
  buttonColor: '#111111',
  buttonBackground: '#ffffff',
  align: 'left',
  borderRadius: 2,
  ...options,
});
const section = (
  blocks: MailBlock[],
  options: Partial<MailBlock> = {},
): MailBlock => ({
  type: 'section',
  columns: [blocks],
  padding: 24,
  ...dark,
  ...options,
});
const dynamic = (
  type: string,
  labels: Record<string, string>,
  options: Partial<MailBlock> = {},
): MailBlock => ({
  type,
  labels,
  padding: 12,
  size: 14,
  weight: 400,
  lineHeight: 1.5,
  ...light,
  ...options,
});

function confirmation(): MailBlock[] {
  return [
    section(
      [
        {
          type: 'columns',
          padding: 0,
          background: '#f7f7f5',
          color: '#111111',
          columns: [
            [heading('CRONOX', { ...light, size: 34, padding: 4 })],
            [
              text('Pedido n.º\n{{orderId}}', {
                ...light,
                align: 'right',
                size: 12,
                padding: 4,
              }),
            ],
          ],
        },
        heading('Gracias por visitar Cronox', {
          ...light,
          size: 17,
          weight: 400,
        }),
        text(
          '¡Agradecemos que formes parte de esto! Tu paquete se está preparando y te llegará muy pronto. ☽',
          { ...light, color: '#6e6e6e' },
        ),
        text('Te avisaremos cuando esté en camino. ✧', {
          ...light,
          color: '#6e6e6e',
        }),
        button('Ver tu pedido', '{{orderUrl}}', {
          ...light,
          buttonColor: '#ffffff',
          buttonBackground: '#060606',
        }),
        button('o visita nuestra tienda', '{{storeUrl}}', {
          ...light,
          buttonColor: '#111111',
          buttonBackground: '#ffffff',
          weight: 600,
        }),
      ],
      { ...light, padding: 26 },
    ),
    { type: 'spacer', size: 18, padding: 0, ...light },
    section(
      [
        heading('Resumen del pedido', {
          ...light,
          size: 17,
          weight: 400,
        }),
        dynamic('orderItems', {
          empty: 'No hay artículos en la vista previa.',
        }),
        dynamic('orderTotals', {
          subtotal: 'Total parcial',
          discount: 'Descuento',
          shipping: 'Envío',
          taxes: 'Impuestos',
          total: 'Total',
          savings: 'Ahorraste',
        }),
      ],
      { ...light, padding: 26 },
    ),
    { type: 'spacer', size: 18, padding: 0, ...light },
    section(
      [
        heading('Información del cliente', {
          ...light,
          size: 18,
          weight: 600,
        }),
        dynamic('customerDetails', {
          contact: 'Contacto',
          shippingAddress: 'Dirección de envío',
          shippingMethod: 'Método de envío',
        }),
      ],
      { ...light, padding: 26 },
    ),
  ];
}

function shipped(): MailBlock[] {
  return [
    section([
      {
        type: 'columns',
        padding: 0,
        ...dark,
        columns: [
          [heading('CRONOX', { size: 34, padding: 4 })],
          [
            text('Pedido n.º\n#{{orderId}}', {
              align: 'right',
              size: 12,
              padding: 4,
            }),
          ],
        ],
      },
      heading('Buenas noticias. Tu pedido está en camino.', { size: 30 }),
      text(
        'Nuestro equipo ya ha preparado tu envío y ha salido correctamente.',
      ),
      dynamic(
        'trackingDetails',
        {
          carrier: 'Transportista',
          tracking: 'Número de seguimiento',
          status: 'Estado actual',
        },
        { ...dark },
      ),
      text(
        'Puedes revisar los artículos incluidos en este envío y acceder al pedido desde los enlaces de abajo.',
        { color: '#b5b5b5' },
      ),
      button('Ver pedido', '{{orderUrl}}', { condition: 'orderUrl' }),
      button('Visitar la tienda', '{{storeUrl}}', {
        background: '#0b0b0b',
        color: '#eeeeee',
        condition: 'storeUrl',
      }),
      heading('Artículos en este envío', { size: 20 }),
      dynamic('orderItems', { empty: 'No hay artículos.' }, { ...dark }),
      text('Te avisaremos de nuevo en cuanto el envío conste como entregado.', {
        color: '#d0d0d0',
      }),
      { type: 'divider', padding: 12, ...dark },
      text(
        'Este es un correo automático de CRONOX. Si has recibido este mensaje, es porque tu pedido ha avanzado en el proceso logístico.',
        { size: 12, color: '#8a8a8a' },
      ),
    ]),
  ];
}

function delivered(): MailBlock[] {
  return [
    section([
      {
        type: 'columns',
        padding: 0,
        ...dark,
        columns: [
          [heading('CRONOX', { size: 34, padding: 4 })],
          [
            text('Pedido n.º\n#{{orderId}}', {
              align: 'right',
              size: 12,
              padding: 4,
            }),
          ],
        ],
      },
      heading('Tu pedido ha sido entregado.', { size: 30 }),
      text('Tu pedido #{{orderId}} ya figura como entregado correctamente.', {
        size: 15,
        color: '#d7d7d7',
      }),
      dynamic('statusDetails', { status: 'Estado actual' }, { ...dark }),
      text('Esperamos que todo haya llegado en perfectas condiciones.', {
        color: '#b5b5b5',
      }),
      text('Gracias por formar parte de CRONOX.', { color: '#d0d0d0' }),
      { type: 'divider', padding: 12, ...dark },
      text(
        'Este es un correo automático de CRONOX. Si has recibido este mensaje, es porque tu pedido ha sido marcado como entregado.',
        { size: 12, color: '#8a8a8a' },
      ),
    ]),
  ];
}

function generic(): MailBlock[] {
  return [
    section([
      heading('{{title}}', { size: 22 }),
      text('{{message}}', { color: '#c7c7cf' }),
      button('{{actionLabel}}', '{{actionUrl}}', {
        condition: 'actionUrl',
      }),
      text('CRONOX', { size: 12, color: '#6f6f7c' }),
    ]),
  ];
}

function preRegistration(): MailBlock[] {
  return [
    section([
      heading('{{title}}', { size: 28 }),
      text('{{message}}', { color: '#c7c7cf' }),
      text('Correo: {{email}}', { color: '#9a9aa5' }),
      text('Fecha de prerregistro: {{preRegistrationDate}}', {
        size: 12,
        color: '#6f6f7c',
      }),
      text('CRONOX', { size: 12, color: '#6f6f7c' }),
    ]),
  ];
}

function support(): MailBlock[] {
  return [
    section([
      heading('{{title}}', { size: 22 }),
      text('Hemos recibido tu solicitud de soporte.', {
        color: '#c7c7cf',
      }),
      text('Case ID: {{supportCaseId}}'),
      text('Email cliente: {{customerEmail}}'),
      text('{{message}}', { color: '#9a9aa5' }),
      text('CRONOX Support', { size: 12, color: '#6f6f7c' }),
    ]),
  ];
}

function testMail(): MailBlock[] {
  return [
    section([
      heading('{{title}}', { size: 22 }),
      text('{{message}}', { color: '#c7c7cf' }),
      text('Destinatario: {{customerEmail}}', { color: '#9a9aa5' }),
      text('CRONOX · SMTP Test', { size: 12, color: '#6f6f7c' }),
    ]),
  ];
}

export function structuredDocumentForPurpose(
  purpose: string | null | undefined,
  legacySource?: unknown,
): VisualDocument | null {
  let blocks: MailBlock[];
  switch (purpose) {
    case 'ORDER_CONFIRMATION':
      blocks = confirmation();
      break;
    case 'ORDER_SHIPPED':
      blocks = shipped();
      break;
    case 'ORDER_DELIVERED':
      blocks = delivered();
      break;
    case 'SUPPORT_TICKET_RECEIVED':
      blocks = support();
      break;
    case 'TEST':
      blocks = testMail();
      break;
    case 'PASSWORD_RESET':
    case 'INITIAL_PASSWORD_SETUP':
    case 'NEWSLETTER_CONFIRMATION':
    case 'FIRST_ORDER_DISCOUNT':
    case 'GENERIC':
      blocks = generic();
      break;
    case 'PRE_REGISTRATION_CONFIRMATION':
      blocks = preRegistration();
      break;
    default:
      return null;
  }
  return {
    schemaVersion: 2,
    sourceKind: 'cronox-first-party',
    ...(legacySource ? { legacySource } : {}),
    blocks,
  };
}

export function adaptFirstPartyDocument(
  purpose: string | null | undefined,
  document: unknown,
) {
  const value = document as {
    sourceKind?: string;
    blocks?: Array<{ type?: string }>;
  };
  if (value?.sourceKind === 'cronox-first-party') return document;
  if (value?.blocks?.length === 1 && value.blocks[0]?.type === 'html')
    return structuredDocumentForPurpose(purpose, document) || document;
  return document;
}
