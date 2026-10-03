import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import sanitizeHtml from 'sanitize-html';

export const PROVIDERS = {
  hostinger: { imap: 'imap.hostinger.com', smtp: 'smtp.hostinger.com' },
  titan: { imap: 'imap.titan.email', smtp: 'smtp.titan.email' },
};
export const limit = (name: string, fallback: number, maximum: number) =>
  Math.max(1, Math.min(maximum, Number(process.env[name]) || fallback));
export const maxMessageBytes = () =>
  limit('MAILBOX_MAX_MESSAGE_BYTES', 25 * 1024 * 1024, 100 * 1024 * 1024);
export const maxAttachmentBytes = () =>
  limit('MAILBOX_MAX_ATTACHMENT_BYTES', 10 * 1024 * 1024, 25 * 1024 * 1024);
export const maxRecipients = () => limit('MAILBOX_MAX_RECIPIENTS', 20, 100);
export function keyring() {
  try {
    const id = process.env.MAILBOX_ENCRYPTION_KEY_ID || '';
    const keys = JSON.parse(process.env.MAILBOX_ENCRYPTION_KEYS || '{}');
    const key = Buffer.from(keys[id] || '', 'base64');
    if (!/^[\w-]{1,40}$/.test(id) || key.length !== 32) throw Error();
    return { id, key, keys };
  } catch {
    throw new ServiceUnavailableException('MAILBOX_ENCRYPTION_NOT_CONFIGURED');
  }
}
export function encrypt(value: string, aad: string) {
  const { id, key } = keyring(),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  return [
    id,
    iv.toString('base64'),
    Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString(
      'base64',
    ),
    cipher.getAuthTag().toString('base64'),
  ].join('.');
}
export function decrypt(value: string, aad: string) {
  try {
    const [id, iv, data, tag] = value.split('.'),
      keys = keyring().keys,
      key = Buffer.from(keys[id] || '', 'base64');
    if (key.length !== 32) throw Error();
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64'),
    );
    cipher.setAAD(Buffer.from(aad));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(data, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException('MAILBOX_KEY_UNAVAILABLE');
  }
}
export function credential(
  ref: string | null,
  stored: string | null,
  aad: string,
) {
  if (ref) {
    if (
      !/^(?:SMTP_[A-Z0-9_]+_PASS|MAILBOX_[A-Z0-9_]+_(?:PASS|PASSWORD))$/.test(
        ref,
      )
    )
      throw new BadRequestException('CREDENTIAL_REFERENCE_NOT_ALLOWED');
    const value = process.env[ref];
    if (!value)
      throw new ServiceUnavailableException('MAILBOX_CREDENTIAL_MISSING');
    return value;
  }
  if (stored) return decrypt(stored, aad);
  throw new ServiceUnavailableException('MAILBOX_CREDENTIAL_MISSING');
}
export function publicAddress(address: string) {
  try {
    const ip = ipaddr.process(address);
    return ip.range() === 'unicast';
  } catch {
    return false;
  }
}
export async function resolvePublic(host: string, resolver = lookup) {
  const results = await resolver(host, { all: true, verbatim: true });
  if (!results.length || results.some((r) => !publicAddress(r.address)))
    throw new BadRequestException('MAILBOX_UNSAFE_DNS');
  return results[0];
}
export function serverConfig(config: {
  provider: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}) {
  const known = PROVIDERS[config.provider];
  if (
    !known ||
    config.imapHost !== known.imap ||
    config.smtpHost !== known.smtp ||
    config.imapPort !== 993 ||
    ![465, 587].includes(config.smtpPort)
  )
    throw new BadRequestException('MAILBOX_SERVER_NOT_ALLOWED');
}
export function safeFilename(name: string) {
  return (
    String(require('libmime').decodeWords(String(name || 'attachment')))
      .replace(/[\x00-\x1f\x7f/\\:"<>|?*]/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 180) || 'attachment'
  );
}
export function header(value: string, max = 500) {
  if (
    typeof value !== 'string' ||
    /[\r\n\x00]/.test(value) ||
    value.length > max
  )
    throw new BadRequestException('INVALID_MAIL_HEADER');
  return value.trim();
}
export function addresses(value: string, allowEmpty = true): string[] {
  if (
    typeof value !== 'string' ||
    value.length > 15000 ||
    /[\r\n\x00]/.test(value)
  )
    throw new BadRequestException('INVALID_RECIPIENT');
  const entries = value
    .split(/[;,]/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (!allowEmpty && !entries.length)
    throw new BadRequestException('RECIPIENT_REQUIRED');
  const bareAddress = (address: string) => {
    const parts = address.split('@');
    if (parts.length !== 2 || address.length > 254) return false;
    const [local, domain] = parts;
    return (
      local.length <= 64 &&
      /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) &&
      !local.startsWith('.') &&
      !local.endsWith('.') &&
      !local.includes('..') &&
      domain.includes('.') &&
      domain
        .split('.')
        .every((label) =>
          /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
        )
    );
  };
  if (entries.some((v) => !bareAddress(v)))
    throw new BadRequestException('INVALID_RECIPIENT');
  return [...new Set(entries.map((v) => v.toLowerCase()))];
}
// A reply is deliberately independent of campaign recipients and original To/CC.
export function replyChoices(envelope: any): string[] {
  const valid = (items: any) => [
    ...new Set<string>(
      (Array.isArray(items) ? items : []).flatMap((x) => {
        try {
          const values = addresses(x?.address || '', false);
          return values.length === 1 ? values : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
  const replyTo = valid(envelope?.replyTo);
  return replyTo.length ? replyTo : valid(envelope?.from);
}
export function replyRecipients(
  envelope: any,
  _ownAddress: string,
  all = false,
  chosen?: string,
) {
  if (all)
    throw new BadRequestException('MAILBOX_REPLY_SINGLE_RECIPIENT_REQUIRED');
  const choices = replyChoices(envelope);
  const selection =
    chosen === undefined
      ? choices.length === 1
        ? choices[0]
        : undefined
      : addresses(chosen, false)[0];
  if (
    !selection ||
    (chosen !== undefined && addresses(chosen, false).length !== 1) ||
    !choices.includes(selection)
  )
    throw new BadRequestException(
      choices.length > 1
        ? 'MAILBOX_REPLY_CHOOSE_ONE'
        : 'MAILBOX_REPLY_ADDRESS_UNAVAILABLE',
    );
  return { to: selection, cc: '', bcc: '' };
}
export function safeHtml(html: string, remote = false) {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'div',
      'span',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'a',
      ...(remote ? ['img'] : []),
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attrs) => ({
        tagName: tag,
        attribs: {
          href: attrs.href || '',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      img: (tag, attrs) => ({
        tagName: tag,
        attribs: /^https:\/\//i.test(attrs.src || '')
          ? { src: attrs.src, alt: attrs.alt || '' }
          : { src: '', alt: 'Imagen bloqueada' },
      }),
    },
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: false,
  });
}
export function messageDocument(html: string, remote = false) {
  const csp = `default-src 'none'; img-src ${remote ? 'https:' : "'none'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>body{font:16px/1.5 system-ui;overflow-wrap:anywhere;margin:16px}table{max-width:100%}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body>${safeHtml(html, remote)}</body></html>`;
}
export function safeError(error: any) {
  const code = String(error?.code || ''),
    response = error?.getResponse?.(),
    message = typeof response === 'string' ? response : response?.message;
  if (
    typeof message === 'string' &&
    /^(MAILBOX_|CREDENTIAL_)[A-Z0-9_]+$/.test(message)
  )
    return message;
  return ['EAUTH', 'AUTHENTICATIONFAILED'].includes(code)
    ? 'AUTHENTICATION_FAILED'
    : code === 'MAILBOX_BUSY'
      ? 'BUSY'
      : code === 'LIMIT_EXCEEDED'
        ? 'CONTENT_TOO_LARGE'
        : 'CONNECTION_FAILED';
}
