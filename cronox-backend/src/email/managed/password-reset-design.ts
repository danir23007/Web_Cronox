import type { MailBlock, MailDocument } from './mail-renderer';
import { MAIL_LOGO_WHITE, noreplyLogoBlock } from './mail-logo-header';

export const PASSWORD_RESET_COPY = {
  subject: 'CRONOX · Restablece tu contraseña',
  preheader: 'Usa el enlace para elegir una nueva contraseña para tu cuenta.',
  title: 'Restablece tu contraseña',
  message: 'Hemos recibido una solicitud para restablecer la contraseña de tu cuenta de CRONOX. Pulsa el botón de abajo para elegir una nueva contraseña.',
  actionLabel: 'Restablecer contraseña',
  validity: 'Este enlace es de un solo uso y caduca en una hora.',
  notice: 'Si no solicitaste este cambio, ignora este correo. Tu contraseña seguirá siendo la misma.',
};

// Existing, public email-compatible raster export of the official long logo.
export const PASSWORD_RESET_LOGO = MAIL_LOGO_WHITE;
export const PASSWORD_RESET_TEXT = [
  'CRONOX', PASSWORD_RESET_COPY.title, '', PASSWORD_RESET_COPY.preheader, '',
  PASSWORD_RESET_COPY.message, '', `${PASSWORD_RESET_COPY.actionLabel}: {{actionUrl}}`, '',
  PASSWORD_RESET_COPY.validity, '', PASSWORD_RESET_COPY.notice,
].join('\n');

/** Editable fixed Spanish copy; only the secure destination remains variable.
 * Explicit dark surfaces and a white PNG retain contrast in either UI theme. */
export function passwordResetDocument(): MailDocument & { schemaVersion: 2; sourceKind: 'cronox-first-party' } {
  const background = '#151519';
  const paragraph = (text: string, extra: Partial<MailBlock> = {}): MailBlock => ({
    type: 'text', text, background, color: '#eeeeee', size: 16, lineHeight: 1.6,
    padding: 0, paddingBottom: 18, ...extra,
  });
  return {
    schemaVersion: 2, sourceKind: 'cronox-first-party',
    blocks: [
      { type: 'spacer', size: 16, padding: 0, background: '#111111' },
      { type: 'section', background, color: '#eeeeee', padding: 28, borderWidth: 1, borderColor: '#34343c', borderRadius: 12, columns: [[
        noreplyLogoBlock(background),
        { ...paragraph(PASSWORD_RESET_COPY.title), type: 'heading', size: 20, weight: 700, lineHeight: 1.2, paddingBottom: 18 },
        paragraph(PASSWORD_RESET_COPY.message),
        { type: 'button', text: PASSWORD_RESET_COPY.actionLabel, url: '{{actionUrl}}', background, color: '#ffffff', buttonBackground: '#ffffff', buttonColor: '#111111', size: 16, weight: 700, lineHeight: 1.4, borderRadius: 6, padding: 16, paddingLeft: 0, paddingRight: 0, paddingTop: 4, paddingBottom: 12 },
        paragraph(PASSWORD_RESET_COPY.validity, { size: 13, color: '#c7c7cf', paddingBottom: 24 }),
        { type: 'section', background: '#202026', color: '#dedee4', borderWidth: 1, borderColor: '#44444f', borderRadius: 8, padding: 14,
          columns: [[paragraph(PASSWORD_RESET_COPY.notice, { size: 14, background: '#202026', color: '#dedee4', paddingBottom: 0 })]],
        },
      ]] },
      { type: 'spacer', size: 16, padding: 0, background: '#111111' },
    ],
  };
}
