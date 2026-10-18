export enum EmailSenderKey {
  SUPPORT = 'SUPPORT',
  ORDERS = 'ORDERS',
  NOREPLY = 'NOREPLY',
  INFO = 'INFO',
}

export enum EmailTemplate {
  ORDER_LOGISTICS = 'ORDER_LOGISTICS',
  PASSWORD_SETUP = 'PASSWORD_SETUP',
  ORDER_TRACKING = 'ORDER_TRACKING',
  EMAIL_CHANGE = 'EMAIL_CHANGE',
  NEWSLETTER_ACCESS = 'NEWSLETTER_ACCESS',
  RESTOCK = 'RESTOCK',
  TEST = 'TEST',
  ORDER_CONFIRMATION = 'ORDER_CONFIRMATION',
  ORDER_SHIPPED = 'ORDER_SHIPPED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  SUPPORT_TICKET_RECEIVED = 'SUPPORT_TICKET_RECEIVED',
  GENERIC = 'GENERIC',
  PRE_REGISTRATION_CONFIRMATION = 'PRE_REGISTRATION_CONFIRMATION',
}

export enum EmailType {
  ORDER_OUT_FOR_DELIVERY = 'ORDER_OUT_FOR_DELIVERY',
  ORDER_INCIDENT = 'ORDER_INCIDENT',
  ORDER_RETURNED = 'ORDER_RETURNED',
  ORDER_TRACKING = 'ORDER_TRACKING',
  RESTOCK = 'RESTOCK',
  TEST = 'TEST',
  ORDER_CONFIRMATION = 'ORDER_CONFIRMATION',
  ORDER_SHIPPED = 'ORDER_SHIPPED',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  SUPPORT_TICKET_RECEIVED = 'SUPPORT_TICKET_RECEIVED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  NEWSLETTER_CONFIRMATION = 'NEWSLETTER_CONFIRMATION',
  PRE_REGISTRATION_CONFIRMATION = 'PRE_REGISTRATION_CONFIRMATION',
  GENERIC = 'GENERIC',
}

export interface EmailSendOptions {
  // Internal absolute deadline; tracking SMTP must finish before releasing Order lock.
  deliveryDeadline?: number;
  purpose?: 'PASSWORD_SETUP_NEW_ACCOUNT' | 'PASSWORD_SETUP_EXISTING_ACCOUNT' | 'INITIAL_PASSWORD_SETUP' | 'FIRST_ORDER_DISCOUNT' | 'NEWSLETTER_WELCOME' | 'NEWSLETTER_ACCESS' | 'LAUNCH';
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
  queued?: boolean;
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
  [EmailType.ORDER_OUT_FOR_DELIVERY]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_INCIDENT]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_RETURNED]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_TRACKING]: EmailSenderKey.ORDERS,
  [EmailType.RESTOCK]: EmailSenderKey.NOREPLY,
  [EmailType.TEST]: EmailSenderKey.NOREPLY,
  [EmailType.ORDER_CONFIRMATION]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_SHIPPED]: EmailSenderKey.ORDERS,
  [EmailType.ORDER_DELIVERED]: EmailSenderKey.ORDERS,
  [EmailType.SUPPORT_TICKET_RECEIVED]: EmailSenderKey.SUPPORT,
  [EmailType.PASSWORD_RESET]: EmailSenderKey.NOREPLY,
  [EmailType.NEWSLETTER_CONFIRMATION]: EmailSenderKey.INFO,
  [EmailType.PRE_REGISTRATION_CONFIRMATION]: EmailSenderKey.INFO,
  [EmailType.GENERIC]: EmailSenderKey.INFO,
};

export const EMAIL_TYPE_TO_TEMPLATE: Record<EmailType, EmailTemplate> = {
  [EmailType.ORDER_OUT_FOR_DELIVERY]: EmailTemplate.ORDER_LOGISTICS,
  [EmailType.ORDER_INCIDENT]: EmailTemplate.ORDER_LOGISTICS,
  [EmailType.ORDER_RETURNED]: EmailTemplate.ORDER_LOGISTICS,
  [EmailType.ORDER_TRACKING]: EmailTemplate.ORDER_TRACKING,
  [EmailType.RESTOCK]: EmailTemplate.RESTOCK,
  [EmailType.TEST]: EmailTemplate.TEST,
  [EmailType.ORDER_CONFIRMATION]: EmailTemplate.ORDER_CONFIRMATION,
  [EmailType.ORDER_SHIPPED]: EmailTemplate.ORDER_SHIPPED,
  [EmailType.ORDER_DELIVERED]: EmailTemplate.ORDER_DELIVERED,
  [EmailType.SUPPORT_TICKET_RECEIVED]: EmailTemplate.SUPPORT_TICKET_RECEIVED,
  [EmailType.PASSWORD_RESET]: EmailTemplate.GENERIC,
  [EmailType.NEWSLETTER_CONFIRMATION]: EmailTemplate.GENERIC,
  [EmailType.PRE_REGISTRATION_CONFIRMATION]:
    EmailTemplate.PRE_REGISTRATION_CONFIRMATION,
  [EmailType.GENERIC]: EmailTemplate.GENERIC,
};

export const EMAIL_TEMPLATE_FILE: Record<EmailTemplate, string> = {
  [EmailTemplate.ORDER_LOGISTICS]: 'order-logistics.hbs',
  [EmailTemplate.PASSWORD_SETUP]: 'password-setup.hbs',
  [EmailTemplate.ORDER_TRACKING]: 'order-tracking.hbs',
  [EmailTemplate.EMAIL_CHANGE]: 'email-change.hbs',
  [EmailTemplate.NEWSLETTER_ACCESS]: 'newsletter-access.hbs',
  [EmailTemplate.RESTOCK]: 'restock.hbs',
  [EmailTemplate.TEST]: 'test.hbs',
  [EmailTemplate.ORDER_CONFIRMATION]: 'order-confirmation.hbs',
  [EmailTemplate.ORDER_SHIPPED]: 'order-shipped.hbs',
  [EmailTemplate.ORDER_DELIVERED]: 'order-delivered.hbs',
  [EmailTemplate.SUPPORT_TICKET_RECEIVED]: 'support-ticket-received.hbs',
  [EmailTemplate.GENERIC]: 'generic.hbs',
  [EmailTemplate.PRE_REGISTRATION_CONFIRMATION]:
    'pre-registration-confirmation.hbs',
};
