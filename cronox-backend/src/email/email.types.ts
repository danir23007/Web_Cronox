export enum EmailSenderKey {
  SUPPORT = 'SUPPORT',
  ORDERS = 'ORDERS',
  NOREPLY = 'NOREPLY',
  INFO = 'INFO',
}

export enum EmailTemplate {
  TEST = 'TEST',
  ORDER_CONFIRMATION = 'ORDER_CONFIRMATION',
  ORDER_SHIPPED = 'ORDER_SHIPPED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  SUPPORT_TICKET_RECEIVED = 'SUPPORT_TICKET_RECEIVED',
  GENERIC = 'GENERIC',
}

export enum EmailType {
  TEST = 'TEST',
  ORDER_CONFIRMATION = 'ORDER_CONFIRMATION',
  ORDER_SHIPPED = 'ORDER_SHIPPED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  SUPPORT_TICKET_RECEIVED = 'SUPPORT_TICKET_RECEIVED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  NEWSLETTER_CONFIRMATION = 'NEWSLETTER_CONFIRMATION',
  GENERIC = 'GENERIC',
}

export interface EmailSendOptions {
  type: EmailType;
  to: string;
  subject: string;
  templateData?: Record<string, unknown>;
}

export type OrderConfirmationEmailTemplateData = {
  orderId: string;
  customerEmail: string;
  customerFullName?: string | null;
  customerPhone?: string | null;
  message: string;
  orderUrl: string;
  storeUrl: string;
  subtotalFormatted: string;
  discountFormatted: string;
  shippingFormatted: string;
  taxesFormatted: string;
  totalFormatted: string;
  savingsFormatted?: string | null;
  shippingMethod?: string | null;
  shippingAddress: {
    fullName?: string | null;
    phone?: string | null;
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  items: Array<{
    name: string;
    variantName?: string | null;
    quantity: number;
    imageUrl?: string | null;
    unitPriceFormatted?: string | null;
    lineTotalFormatted: string;
  }>;
};

export interface EmailSendResult {
  messageId: string;
}

export interface EmailAccountConfig {
  user: string;
  pass: string;
  fromName: string;
}

export interface EmailConfig {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  defaultFromName: string;
  accounts: Record<EmailSenderKey, EmailAccountConfig>;
}

export const EMAIL_TYPE_TO_SENDER: Record<EmailType, EmailSenderKey> = {
  [EmailType.TEST]: EmailSenderKey.NOREPLY,
  [EmailType.ORDER_CONFIRMATION]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_SHIPPED]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_DELIVERED]: EmailSenderKey.ORDERS,
  [EmailType.SUPPORT_TICKET_RECEIVED]: EmailSenderKey.SUPPORT,
  [EmailType.PASSWORD_RESET]: EmailSenderKey.NOREPLY,
  [EmailType.NEWSLETTER_CONFIRMATION]: EmailSenderKey.INFO,
  [EmailType.GENERIC]: EmailSenderKey.INFO,
};

export const EMAIL_TYPE_TO_TEMPLATE: Record<EmailType, EmailTemplate> = {
  [EmailType.TEST]: EmailTemplate.TEST,
  [EmailType.ORDER_CONFIRMATION]: EmailTemplate.ORDER_CONFIRMATION,
  [EmailType.ORDER_SHIPPED]: EmailTemplate.ORDER_SHIPPED,
  [EmailType.ORDER_DELIVERED]: EmailTemplate.ORDER_DELIVERED,
  [EmailType.SUPPORT_TICKET_RECEIVED]: EmailTemplate.SUPPORT_TICKET_RECEIVED,
  [EmailType.PASSWORD_RESET]: EmailTemplate.GENERIC,
  [EmailType.NEWSLETTER_CONFIRMATION]: EmailTemplate.GENERIC,
  [EmailType.GENERIC]: EmailTemplate.GENERIC,
};

export const EMAIL_TEMPLATE_FILE: Record<EmailTemplate, string> = {
  [EmailTemplate.TEST]: 'test.hbs',
  [EmailTemplate.ORDER_CONFIRMATION]: 'order-confirmation.hbs',
  [EmailTemplate.ORDER_SHIPPED]: 'order-shipped.hbs',
  [EmailTemplate.ORDER_DELIVERED]: 'order-delivered.hbs',
  [EmailTemplate.SUPPORT_TICKET_RECEIVED]: 'support-ticket-received.hbs',
  [EmailTemplate.GENERIC]: 'generic.hbs',
};
