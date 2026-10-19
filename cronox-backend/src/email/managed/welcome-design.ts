import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MailDocument } from './mail-renderer';
import { SAMPLE_DATA } from './mail-catalog';

export const WELCOME_SUBJECT = 'CRONOX · Te damos la bienvenida';
export const WELCOME_MESSAGE = 'Aquí empieza tu recorrido dentro de los círculos de CRONOX.';
export { EXAMPLE_WELCOME_CODE } from './welcome-code';
import { requireWelcomeCode } from './welcome-code';

export function welcomeData(code?: string) {
  return { title: 'Bienvenido a CRONOX', message: WELCOME_MESSAGE, discountCode: requireWelcomeCode(code) };
}

export function mailPreviewData(purpose?: string | null) {
  return purpose === 'NEWSLETTER_WELCOME'
    ? { ...SAMPLE_DATA, ...welcomeData('VISTA-PREVIA-NO-VALIDO') }
    : SAMPLE_DATA;
}

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
