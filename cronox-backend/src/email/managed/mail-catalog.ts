import {
  EMAIL_TYPE_TO_SENDER,
  EMAIL_TYPE_TO_TEMPLATE,
  EmailType,
} from '../email.types';

// Distinct purposes preserve the existing sender/transport types.
export const MAIL_PURPOSES = [
  { key: 'LAUNCH', name: 'Lanzamiento de la tienda', type: EmailType.GENERIC,
    subject: 'CRONOX · La espera ha terminado', required: ['message', 'actionUrl'] },
  { key: 'RESTOCK', name: 'Aviso de reposición de talla', type: EmailType.RESTOCK,
    subject: 'Tu talla ha vuelto: {{product}} · {{size}}', required: ['product', 'size', 'actionUrl'] },
  {
    key: 'NEWSLETTER_WELCOME', name: 'Bienvenida a la newsletter y descuento',
    type: EmailType.GENERIC, subject: 'CRONOX · Te damos la bienvenida',
    required: ['message'],
  },
  {
    key: 'PRE_REGISTRATION_CONFIRMATION',
    name: 'Confirmación de prerregistro',
    type: EmailType.PRE_REGISTRATION_CONFIRMATION,
    subject: 'CRONOX · Prerregistro confirmado',
    required: ['email', 'preRegistrationDate'],
  },
  {
    key: 'TEST',
    name: 'Correo de prueba',
    type: EmailType.TEST,
    subject: '[CRONOX] Test email (TEST)',
    required: ['message'],
  },
  {
    key: 'ORDER_CONFIRMATION',
    name: 'Confirmación de pedido',
    type: EmailType.ORDER_CONFIRMATION,
    subject: 'CRONOX · Confirmación de pedido',
    required: ['orderId', 'orderUrl', 'items', 'totalFormatted'],
  },
  {
    key: 'ORDER_SHIPPED',
    name: 'Pedido enviado',
    type: EmailType.ORDER_SHIPPED,
    subject: 'CRONOX · Pedido #{{orderId}} enviado',
    required: ['orderId'],
  },
  {
    key: 'ORDER_DELIVERED',
    name: 'Pedido entregado',
    type: EmailType.ORDER_DELIVERED,
    subject: 'CRONOX · Pedido #{{orderId}} entregado',
    required: ['orderId'],
  },
  {
    key: 'SUPPORT_TICKET_RECEIVED',
    name: 'Ticket de soporte recibido',
    type: EmailType.SUPPORT_TICKET_RECEIVED,
    subject: '{{subject}}',
    required: ['supportCaseId', 'customerEmail'],
  },
  {
    key: 'PASSWORD_RESET',
    name: 'Restablecimiento de contraseña',
    type: EmailType.PASSWORD_RESET,
    subject: 'CRONOX · Restablece tu contraseña',
    required: ['actionUrl'],
  },
  {
    key: 'INITIAL_PASSWORD_SETUP',
    name: 'Configuración inicial de cuenta',
    type: EmailType.PASSWORD_RESET,
    subject: 'CRONOX · Tu cuenta ha sido creada',
    required: ['actionUrl'],
  },
  {
    key: 'NEWSLETTER_CONFIRMATION',
    name: 'Confirmación de newsletter',
    type: EmailType.NEWSLETTER_CONFIRMATION,
    subject: 'CRONOX newsletter confirmation',
    required: ['actionUrl'],
  },
  {
    key: 'FIRST_ORDER_DISCOUNT',
    name: 'Descuento de bienvenida',
    type: EmailType.GENERIC,
    subject: 'CRONOX · Tu descuento de bienvenida',
    required: ['message'],
  },
  {
    key: 'GENERIC',
    name: 'Correo genérico',
    type: EmailType.GENERIC,
    subject: '{{subject}}',
    required: ['message'],
  },
].map((p) => ({
  ...p,
  senderKey: EMAIL_TYPE_TO_SENDER[p.type],
  template: EMAIL_TYPE_TO_TEMPLATE[p.type],
}));

export const SAMPLE_DATA: Record<string, unknown> = {
  product: 'Camiseta de ejemplo', size: 'M', imageUrl: 'https://example.com/camiseta.png',
  subject: 'Correo de ejemplo CRONOX',
  title: 'Hola, Alex',
  message:
    'Mensaje de prueba con datos ficticios. Código de ejemplo: ABC234.',
  discountCode: 'ABC234',
  customerEmail: 'alex@example.com',
  email: 'alex@example.com',
  preRegistrationDate: '2026-09-10T12:00:00.000Z',
  customerFullName: 'Alex García',
  customerPhone: '+34 600 000 000',
  orderId: 'PRUEBA-001',
  orderUrl: 'https://example.com/pedido',
  storeUrl: 'https://example.com',
  actionUrl: 'https://example.com/confirmar',
  actionLabel: 'Continuar',
  supportCaseId: 'SOP-PRUEBA',
  statusLabel: 'En camino',
  shippingCarrier: 'Transportista de ejemplo',
  trackingNumber: 'PRUEBA123',
  subtotalFormatted: '69,90 €',
  discountFormatted: '5,00 €',
  shippingFormatted: '4,90 €',
  taxesFormatted: '12,13 €',
  totalFormatted: '69,80 €',
  savingsFormatted: '5,00 €',
  shippingMethod: 'Envío estándar',
  shippingAddress: {
    fullName: 'Alex García',
    phone: '+34 600 000 000',
    line1: 'Calle Ejemplo 12',
    line2: '2 B',
    city: 'Madrid',
    state: 'Madrid',
    postalCode: '28001',
    country: 'España',
  },
  items: [
    {
      name: 'Camiseta CRONOX',
      variantName: 'M',
      quantity: 2,
      imageUrl: 'https://example.com/camiseta.png',
      unitPriceFormatted: '34,95 €',
      lineTotalFormatted: '69,90 €',
    },
  ],
};
export const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  product: 'Nombre del producto', size: 'Talla solicitada', discountCode: 'Código de bienvenida',
  subject: 'Asunto del correo',
  title: 'Título del mensaje',
  message: 'Contenido del mensaje',
  customerEmail: 'Correo del cliente',
  email: 'Correo prerregistrado',
  preRegistrationDate: 'Fecha del prerregistro',
  customerFullName: 'Nombre completo del cliente',
  customerPhone: 'Teléfono del cliente',
  orderId: 'Número de pedido',
  orderUrl: 'Enlace al pedido',
  storeUrl: 'Enlace a la tienda',
  actionUrl: 'Enlace de la acción principal',
  actionLabel: 'Texto del botón principal',
  supportCaseId: 'Número del ticket de soporte',
  statusLabel: 'Estado del pedido',
  shippingCarrier: 'Empresa de transporte',
  trackingNumber: 'Número de seguimiento',
  subtotalFormatted: 'Subtotal con moneda',
  discountFormatted: 'Descuento con moneda',
  shippingFormatted: 'Gastos de envío con moneda',
  taxesFormatted: 'Impuestos con moneda',
  totalFormatted: 'Total con moneda',
  savingsFormatted: 'Ahorro con moneda',
  shippingMethod: 'Método de envío',
  'shippingAddress.fullName': 'Envío: nombre del destinatario',
  'shippingAddress.phone': 'Envío: teléfono',
  'shippingAddress.line1': 'Envío: dirección',
  'shippingAddress.line2': 'Envío: complemento de dirección',
  'shippingAddress.city': 'Envío: localidad',
  'shippingAddress.state': 'Envío: provincia',
  'shippingAddress.postalCode': 'Envío: código postal',
  'shippingAddress.country': 'Envío: país',
  items: 'Lista de artículos (usar con el bloque each)',
  name: 'Artículo: nombre (dentro del bucle)',
  variantName: 'Artículo: variante (dentro del bucle)',
  quantity: 'Artículo: cantidad (dentro del bucle)',
  imageUrl: 'Artículo: imagen (dentro del bucle)',
  unitPriceFormatted: 'Artículo: precio unitario (dentro del bucle)',
  lineTotalFormatted: 'Artículo: importe total (dentro del bucle)',
};

export function variablesFor(purpose?: string | null) {
  const base = ['subject', 'title', 'message'];
  const order = [
    'orderId',
    'orderUrl',
    'storeUrl',
    'items',
    'name',
    'variantName',
    'quantity',
    'imageUrl',
    'unitPriceFormatted',
    'lineTotalFormatted',
  ];
  switch (MAIL_PURPOSES.find((x) => x.key === purpose)?.type) {
    case EmailType.RESTOCK:
      return [...base, 'product', 'size', 'imageUrl', 'actionUrl'];
    case EmailType.ORDER_CONFIRMATION:
      return [
        ...base,
        ...order,
        'customerEmail',
        'customerFullName',
        'customerPhone',
        'subtotalFormatted',
        'discountFormatted',
        'shippingFormatted',
        'taxesFormatted',
        'totalFormatted',
        'savingsFormatted',
        'shippingMethod',
        ...Object.keys(SAMPLE_DATA.shippingAddress as object).map(
          (k) => `shippingAddress.${k}`,
        ),
      ];
    case EmailType.ORDER_SHIPPED:
      return [
        ...base,
        ...order,
        'shippingCarrier',
        'trackingNumber',
        'statusLabel',
      ];
    case EmailType.ORDER_DELIVERED:
      return [...base, 'orderId', 'statusLabel'];
    case EmailType.SUPPORT_TICKET_RECEIVED:
      return [...base, 'supportCaseId', 'customerEmail'];
    case EmailType.TEST:
      return [...base, 'customerEmail'];
    default:
      return purpose === 'PRE_REGISTRATION_CONFIRMATION'
        ? [...base, 'email', 'preRegistrationDate']
        : [...base, 'actionUrl', 'actionLabel', ...(purpose === 'NEWSLETTER_WELCOME' ? ['discountCode'] : [])];
  }
}
