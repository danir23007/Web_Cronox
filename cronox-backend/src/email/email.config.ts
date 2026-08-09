import { EmailConfig, EmailSenderKey } from './email.types';

const REQUIRED_ENV_VARS = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_SUPPORT_USER',
  'SMTP_SUPPORT_PASS',
  'SMTP_ORDERS_USER',
  'SMTP_ORDERS_PASS',
  'SMTP_NOREPLY_USER',
  'SMTP_NOREPLY_PASS',
  'SMTP_INFO_USER',
  'SMTP_INFO_PASS',
  'EMAIL_DEFAULT_FROM_NAME',
  'EMAIL_SUPPORT_FROM_NAME',
  'EMAIL_ORDERS_FROM_NAME',
  'EMAIL_NOREPLY_FROM_NAME',
  'EMAIL_INFO_FROM_NAME',
] as const;

function readEnv(name: (typeof REQUIRED_ENV_VARS)[number]): string {
  return process.env[name]?.trim() ?? '';
}

function parseBool(name: string, value: string, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }

  if (value.toLowerCase() === 'false') {
    return false;
  }

  throw new Error(`[EmailConfig] ${name} debe ser true o false.`);
}

function parsePort(value: string): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : 0;
}

export function loadEmailConfig(): EmailConfig {
  const enabled = parseBool(
    'EMAIL_ENABLED',
    process.env.EMAIL_ENABLED?.trim() ?? '',
    process.env.NODE_ENV === 'production',
  );
  const missing = REQUIRED_ENV_VARS.filter((name) => !readEnv(name));

  if (enabled && missing.length > 0) {
    throw new Error(
      `[EmailConfig] Faltan variables de entorno obligatorias para email: ${missing.join(', ')}`,
    );
  }

  const smtpHost = readEnv('SMTP_HOST');
  const smtpPort = parsePort(readEnv('SMTP_PORT'));
  const smtpSecure = parseBool('SMTP_SECURE', readEnv('SMTP_SECURE'), true);
  const defaultFromName = readEnv('EMAIL_DEFAULT_FROM_NAME') || 'CRONOX';

  if (enabled && !smtpPort) {
    throw new Error('[EmailConfig] SMTP_PORT debe ser un entero positivo.');
  }

  return {
    enabled,
    smtpHost,
    smtpPort: smtpPort || 465,
    smtpSecure,
    defaultFromName,
    accounts: {
      [EmailSenderKey.SUPPORT]: {
        user: readEnv('SMTP_SUPPORT_USER'),
        pass: readEnv('SMTP_SUPPORT_PASS'),
        fromName: readEnv('EMAIL_SUPPORT_FROM_NAME') || defaultFromName,
      },
      [EmailSenderKey.ORDERS]: {
        user: readEnv('SMTP_ORDERS_USER'),
        pass: readEnv('SMTP_ORDERS_PASS'),
        fromName: readEnv('EMAIL_ORDERS_FROM_NAME') || defaultFromName,
      },
      [EmailSenderKey.NOREPLY]: {
        user: readEnv('SMTP_NOREPLY_USER'),
        pass: readEnv('SMTP_NOREPLY_PASS'),
        fromName: readEnv('EMAIL_NOREPLY_FROM_NAME') || defaultFromName,
      },
      [EmailSenderKey.INFO]: {
        user: readEnv('SMTP_INFO_USER'),
        pass: readEnv('SMTP_INFO_PASS'),
        fromName: readEnv('EMAIL_INFO_FROM_NAME') || defaultFromName,
      },
    },
  };
}
