import { loadEmailConfig } from '../email/email.config';
import { EmailSenderKey } from '../email/email.types';
import { mailboxFolderKind } from './mailbox-folder-kind';

export function mailboxSenderKey(box: { address: string }) {
  const accounts = loadEmailConfig().accounts;
  const defaults = {
    NOREPLY: 'no-reply@cronox.es',
    ORDERS: 'orders@cronox.es',
    INFO: 'info@cronox.es',
    SUPPORT: 'support@cronox.es',
  };
  const address = box.address.trim().toLowerCase();
  const matches = Object.values(EmailSenderKey).filter(
    (key) =>
      (accounts[key].user || defaults[key]).trim().toLowerCase() === address,
  );
  // Ambiguous configuration must never select a destructive policy.
  return matches.length === 1 ? matches[0] : null;
}
export const sentCutoff = (now = new Date()) =>
  new Date(now.getTime() - 30 * 86400000);
export function skipSentImport(
  box: { address: string },
  folder: { specialUse?: string | null; path?: string },
) {
  return (
    mailboxFolderKind(folder) === '\\Sent' &&
    ['NOREPLY', 'ORDERS', 'INFO'].includes(mailboxSenderKey(box) || '')
  );
}
export const appendSent = (box: { address: string; sentCopy: string }) =>
  !['NOREPLY', 'ORDERS', 'INFO'].includes(mailboxSenderKey(box) || '') &&
  box.sentCopy !== 'provider';
