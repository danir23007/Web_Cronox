import MailComposer from 'nodemailer/lib/mail-composer';
import type { SendMailOptions } from 'nodemailer';
import { maxMessageBytes } from '../mailbox/mailbox-security';

// Shared by the SMTP factory and the isolated operator's MIME inspection.
// The bytes inspected here are the bytes delivered, with remote/file reads off.
export async function compileMailMessage(from: string, options: SendMailOptions) {
  const compiled = new MailComposer({ ...options, from, disableFileAccess: true, disableUrlAccess: true }).compile();
  const raw = await new Promise<Buffer>((resolve, reject) => compiled.build((error, content) => error ? reject(error) : resolve(content)));
  if (raw.length > maxMessageBytes()) throw Error('EMAIL_MESSAGE_LIMIT');
  return { raw, envelope: compiled.getEnvelope(), messageId: compiled.messageId() };
}

export function rawMessageId(raw: unknown) {
  if (!Buffer.isBuffer(raw)) return undefined;
  const end = raw.indexOf('\r\n\r\n');
  if (end < 0) return undefined;
  const headers = raw.subarray(0, end).toString('utf8').replace(/\r\n[ \t]+/g, ' ');
  return /^Message-ID:\s*(<[^<>\s]+@[^<>\s]+>)\s*$/im.exec(headers)?.[1];
}
