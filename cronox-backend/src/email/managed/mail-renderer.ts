import { BadRequestException } from '@nestjs/common';
import Handlebars from 'handlebars';
import sanitizeHtml from 'sanitize-html';
import { MAIL_PURPOSES, variablesFor } from './mail-catalog';

export type MailBlock = {
  type: string;
  text?: string;
  html?: string;
  url?: string;
  condition?: string;
  src?: string;
  alt?: string;
  align?: string;
  color?: string;
  background?: string;
  buttonBackground?: string;
  buttonColor?: string;
  borderColor?: string;
  borderWidth?: number;
  padding?: number;
  size?: number;
  weight?: number;
  lineHeight?: number;
  width?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  backgroundImage?: string;
  backgroundPosition?: string;
  backgroundSize?: string;
  borderRadius?: number;
  labels?: Record<string, string>;
  columns?: MailBlock[][];
};
export type MailDocument = { blocks: MailBlock[] };
const escape = (s: unknown) =>
  Handlebars.escapeExpression(
    typeof s === 'string' || typeof s === 'number' ? String(s) : '',
  );
const dimension = (v: unknown, fallback: number, max = 640) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(max, v))
    : fallback;
const color = (v: unknown, fallback: string) =>
  typeof v === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(v)
    ? v
    : fallback;

export function cleanMailHtml(html: string, placeholders = false) {
  return sanitizeHtml(html, {
    allowedTags: [
      'table',
      'tbody',
      'thead',
      'tfoot',
      'tr',
      'td',
      'th',
      'div',
      'p',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'a',
      'img',
      'br',
      'hr',
      'b',
      'strong',
      'i',
      'em',
      'u',
      'ul',
      'ol',
      'li',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'role', 'class'],
      a: ['href', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['cellpadding', 'cellspacing', 'border', 'width', 'role'],
      td: ['colspan', 'rowspan', 'background', 'bgcolor'],
    },
    allowedClasses: { '*': ['mail-column'] },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        color: [/^#[\da-f]{3,8}$/i],
        'background-color': [/^#[\da-f]{3,8}$/i],
        background: [/^#[\da-f]{3,8}$/i],
        'background-image': [/^url\("https:\/\/[^"\s]+"\)$/i],
        'background-position': [/^(left|center|right) (top|center|bottom)$/],
        'background-size': [/^(cover|contain|auto)$/],
        'background-repeat': [/^(no-repeat|repeat)$/],
        'font-family': [/^[\w\s,'-]+$/],
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-size': [/^\d+(\.\d+)?px$/],
        'line-height': [/^\d+(\.\d+)?(px|%)?$/],
        'text-align': [/^(left|center|right)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
        'text-transform': [/^(uppercase|lowercase|none)$/],
        padding: [/^[\d.]+(px|%)(\s+[\d.]+(px|%)){0,3}$/],
        margin: [/^[\d.]+(px|%)(\s+([\d.]+(px|%)|auto)){0,3}$/],
        'padding-top': [/^\d+px$/],
        'padding-bottom': [/^\d+px$/],
        'letter-spacing': [/^[\d.]+px$/],
        width: [/^[\d.]+(px|%)$/],
        'max-width': [/^[\d.]+(px|%)$/],
        height: [/^[\d.]+(px|%)$/],
        display: [/^(block|inline-block|none)$/],
        'border-collapse': [/^(collapse|separate)$/],
        border: [/^\d+px solid #[\da-f]{3,8}$/i],
        'border-radius': [/^\d+px$/],
        'white-space': [/^nowrap$/],
      },
    },
    transformTags: {
      '*': (tagName, attribs) => {
        for (const name of ['href', 'src', 'background']) {
          const value = attribs[name];
          if (!value) continue;
          const variable =
            placeholders && /^\{\{[A-Za-z][\w.]*\}\}$/.test(value);
          if (!variable && !/^(https?:\/\/|mailto:|tel:)/i.test(value))
            delete attribs[name];
          if (
            ['src', 'background'].includes(name) &&
            !variable &&
            !/^https:\/\//i.test(value)
          )
            delete attribs[name];
        }
        return { tagName, attribs };
      },
    },
  });
}

function validateExpressions(source: string, purpose?: string | null) {
  if (/\{\{\{|\}\}\}|\{\{[>&!]/.test(source))
    throw new BadRequestException(
      'Solo se permiten variables escapadas y bloques if/each.',
    );
  const allowed = new Set(variablesFor(purpose));
  for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const token = match[1].trim();
    if (['else', '/if', '/each'].includes(token)) continue;
    const path = token.replace(/^#(?:if|each)\s+/, '');
    if (!allowed.has(path) || (token.startsWith('#each') && path !== 'items'))
      throw new BadRequestException(
        `Variable o expresión no permitida: ${token.slice(0, 80)}`,
      );
  }
  try {
    Handlebars.precompile(source);
  } catch {
    throw new BadRequestException('Sintaxis Handlebars no válida.');
  }
}

export function renderMail(
  document: unknown,
  subject: string,
  preheader = '',
  purpose?: string | null,
  data?: Record<string, unknown>,
  signature?: unknown,
  publishing = false,
) {
  if (!document || JSON.stringify(document).length > 200000)
    throw new BadRequestException('Documento demasiado grande o vacío.');
  let count = 0;
  const renderBlocks = (doc: unknown, depth = 0): string => {
    if (
      !doc ||
      typeof doc !== 'object' ||
      !Array.isArray((doc as MailDocument).blocks) ||
      depth > 4
    )
      throw new BadRequestException('Documento visual no válido.');
    return (doc as MailDocument).blocks
      .map((b) => {
        if (!b || typeof b !== 'object' || ++count > 100)
          throw new BadRequestException('Máximo 100 bloques.');
        for (const key of ['text', 'html', 'url', 'condition', 'src', 'alt'])
          if (
            b[key as keyof MailBlock] != null &&
            typeof b[key as keyof MailBlock] !== 'string'
          )
            throw new BadRequestException('Propiedad de bloque no válida.');
        if (b.labels != null) {
          if (
            typeof b.labels !== 'object' ||
            Array.isArray(b.labels) ||
            Object.keys(b.labels).length > 20 ||
            Object.entries(b.labels).some(
              ([key, value]) =>
                !/^[A-Za-z][\w-]{0,39}$/.test(key) ||
                typeof value !== 'string' ||
                value.length > 120,
            )
          )
            throw new BadRequestException(
              'Etiquetas del bloque dinámico no válidas.',
            );
        }
        const fallbackBackground = color(b.background, '#111111');
        const safeBackgroundImage =
          typeof b.backgroundImage === 'string' &&
          /^https:\/\/[^\s"'<>]+$/i.test(b.backgroundImage)
            ? b.backgroundImage
            : '';
        const backgroundPosition = [
          'left top',
          'left center',
          'left bottom',
          'center top',
          'center center',
          'center bottom',
          'right top',
          'right center',
          'right bottom',
        ].includes(b.backgroundPosition || '')
          ? b.backgroundPosition
          : 'center center';
        const backgroundSize = ['cover', 'contain', 'auto'].includes(
          b.backgroundSize || '',
        )
          ? b.backgroundSize
          : 'cover';
        const padding = [
          dimension(b.paddingTop, dimension(b.padding, 12, 80), 80),
          dimension(b.paddingRight, dimension(b.padding, 12, 80), 80),
          dimension(b.paddingBottom, dimension(b.padding, 12, 80), 80),
          dimension(b.paddingLeft, dimension(b.padding, 12, 80), 80),
        ];
        const borderWidth = dimension(b.borderWidth, 0, 8);
        const style = `padding:${padding.map((v) => `${v}px`).join(' ')};text-align:${['left', 'center', 'right'].includes(b.align || '') ? b.align : 'left'};color:${color(b.color, '#eeeeee')};background-color:${fallbackBackground};${borderWidth ? `border:${borderWidth}px solid ${color(b.borderColor, '#dddddd')};border-radius:${dimension(b.borderRadius, 0, 30)}px;` : ''}${safeBackgroundImage ? `background-image:url(&quot;${escape(safeBackgroundImage)}&quot;);background-position:${backgroundPosition};background-size:${backgroundSize};background-repeat:no-repeat;` : ''}font-family:Arial,Helvetica,sans-serif;font-size:${dimension(b.size, 16, 60)}px;font-weight:${[400, 600, 700, 800].includes(b.weight || 0) ? b.weight : 400};line-height:${dimension(b.lineHeight, 1.5, 3)};`;
        let content = '';
        const label = (key: string, fallback: string) =>
          escape(b.labels?.[key] || fallback);
        const imageMargin =
          b.align === 'center'
            ? '0px auto'
            : b.align === 'right'
              ? '0px 0px 0px auto'
              : '0px';
        const img = `<img src="${escape(b.src)}" alt="${escape(b.alt)}" width="${dimension(b.width, 560)}" style="display:block;width:100%;max-width:${dimension(b.width, 560)}px;margin:${imageMargin};" />`;
        switch (b.type) {
          case 'heading':
            content = `<h2 style="margin:0;">${escape(b.text)}</h2>`;
            break;
          case 'text':
            content = escape(b.text).replace(/\n/g, '<br>');
            break;
          case 'rich':
          case 'html':
            content = cleanMailHtml(b.html || '', true);
            break;
          case 'image':
          case 'logo':
            content = b.url
              ? `<a href="${escape(b.url)}" title="${escape(b.alt)}">${img}</a>`
              : img;
            break;
          case 'video':
            content = `<a href="${escape(b.url)}" title="${escape(b.alt || 'Ver vídeo')}">${img}<span>▶ Ver vídeo</span></a>`;
            break;
          case 'button':
          case 'social': {
            const link = `<a href="${escape(b.url)}" style="display:inline-block;padding:${dimension(b.padding, 12, 40)}px ${dimension(b.padding, 18, 60)}px;background:${color(b.buttonBackground, '#ffffff')};color:${color(b.buttonColor, '#111111')};font-size:${dimension(b.size, 14, 40)}px;font-weight:${[400, 600, 700, 800].includes(b.weight || 0) ? b.weight : 700};line-height:${dimension(b.lineHeight, 1.2, 3)};border-radius:${dimension(b.borderRadius, 2, 30)}px;text-decoration:none;">${escape(b.text)}</a>`;
            content = b.condition
              ? `{{#if ${b.condition}}}${link}{{/if}}`
              : link;
            break;
          }
          case 'orderItems':
            content = `{{#each items}}<table role="presentation" width="100%"><tr><td width="84" valign="top" style="padding:10px 14px 10px 0;">{{#if imageUrl}}<img src="{{imageUrl}}" alt="{{name}}" width="70" height="70" style="display:block;width:70px;height:70px;border:1px solid #ddddda;border-radius:8px;" />{{/if}}</td><td valign="middle" style="padding:10px 8px;"><strong>{{name}}{{#if quantity}} × {{quantity}}{{/if}}</strong>{{#if variantName}}<br><span style="font-size:12px;color:#929292;">{{variantName}}</span>{{/if}}</td><td valign="middle" align="right" style="padding:10px 0;white-space:nowrap;"><strong>{{lineTotalFormatted}}</strong></td></tr></table>{{else}}<p>${label('empty', 'No hay artículos.')}</p>{{/each}}`;
            break;
          case 'orderTotals':
            content = `<table role="presentation" width="100%"><tr><td>${label('subtotal', 'Total parcial')}</td><td align="right"><strong>{{subtotalFormatted}}</strong></td></tr>{{#if savingsFormatted}}<tr><td>${label('discount', 'Descuento')}</td><td align="right"><strong>{{discountFormatted}}</strong></td></tr>{{/if}}<tr><td>${label('shipping', 'Envío')}</td><td align="right"><strong>{{shippingFormatted}}</strong></td></tr><tr><td>${label('taxes', 'Impuestos')}</td><td align="right"><strong>{{taxesFormatted}}</strong></td></tr><tr><td style="padding-top:12px;border-top:1px solid #ddddda;">${label('total', 'Total')}</td><td align="right" style="padding-top:12px;border-top:1px solid #ddddda;font-size:18px;"><strong>{{totalFormatted}}</strong></td></tr>{{#if savingsFormatted}}<tr><td></td><td align="right" style="font-size:12px;">${label('savings', 'Ahorraste')} {{savingsFormatted}}</td></tr>{{/if}}</table>`;
            break;
          case 'customerDetails':
            content = `<table role="presentation" width="100%"><tr><td class="mail-column" width="50%" valign="top"><strong>${label('contact', 'Contacto')}</strong>{{#if customerFullName}}<br>{{customerFullName}}{{/if}}{{#if customerEmail}}<br>{{customerEmail}}{{/if}}{{#if customerPhone}}<br>{{customerPhone}}{{/if}}</td><td class="mail-column" width="50%" valign="top"><strong>${label('shippingAddress', 'Dirección de envío')}</strong>{{#if shippingAddress.fullName}}<br>{{shippingAddress.fullName}}{{/if}}{{#if shippingAddress.line1}}<br>{{shippingAddress.line1}}{{/if}}{{#if shippingAddress.line2}}<br>{{shippingAddress.line2}}{{/if}}{{#if shippingAddress.postalCode}}<br>{{shippingAddress.postalCode}}{{/if}}{{#if shippingAddress.city}}, {{shippingAddress.city}}{{/if}}{{#if shippingAddress.state}}<br>{{shippingAddress.state}}{{/if}}{{#if shippingAddress.country}}<br>{{shippingAddress.country}}{{/if}}</td></tr><tr><td colspan="2" style="padding-top:18px;"><strong>${label('shippingMethod', 'Método de envío')}</strong><br>{{shippingMethod}}</td></tr></table>`;
            break;
          case 'trackingDetails':
            content = `<table role="presentation" width="100%">{{#if shippingCarrier}}<tr><td>${label('carrier', 'Transportista')}</td><td align="right"><strong>{{shippingCarrier}}</strong></td></tr>{{/if}}{{#if trackingNumber}}<tr><td>${label('tracking', 'Número de seguimiento')}</td><td align="right"><strong>{{trackingNumber}}</strong></td></tr>{{/if}}{{#if statusLabel}}<tr><td>${label('status', 'Estado actual')}</td><td align="right"><strong>{{statusLabel}}</strong></td></tr>{{/if}}</table>`;
            break;
          case 'statusDetails':
            content = `{{#if statusLabel}}<p>${label('status', 'Estado actual')}: <strong>{{statusLabel}}</strong></p>{{/if}}`;
            break;
          case 'divider':
            content = '<hr>';
            break;
          case 'spacer':
            content = `<div style="height:${dimension(b.size, 24, 100)}px;">&nbsp;</div>`;
            break;
          case 'columns':
          case 'section':
            if (
              !Array.isArray(b.columns) ||
              b.columns.length < 1 ||
              b.columns.length > 3
            )
              throw new BadRequestException(
                'Una sección admite de una a tres columnas.',
              );
            content = `<table role="presentation" width="100%"><tr>${b.columns.map((c) => `<td class="mail-column" valign="top" width="${Math.floor(100 / b.columns!.length)}%"><table role="presentation" width="100%">${renderBlocks({ blocks: c }, depth + 1)}</table></td>`).join('')}</tr></table>`;
            break;
          case 'signature':
            content = signature
              ? `<table role="presentation" width="100%">${renderBlocks(signature, depth + 1)}</table>`
              : '';
            break;
          default:
            throw new BadRequestException('Tipo de bloque no permitido.');
        }
        return `<tr><td${safeBackgroundImage ? ` background="${escape(safeBackgroundImage)}"` : ''} bgcolor="${fallbackBackground}" style="${style}">${content}</td></tr>`;
      })
      .join('');
  };
  let body = renderBlocks(document);
  if (
    signature &&
    !(document as MailDocument).blocks.some((b) => b.type === 'signature')
  )
    body += renderBlocks(signature);
  const source = subject + '\n' + preheader + '\n' + body;
  validateExpressions(source, purpose);
  if (publishing)
    for (const variable of MAIL_PURPOSES.find((p) => p.key === purpose)
      ?.required || []) {
      if (
        !source.includes(`{{${variable}}}`) &&
        !source.includes(`{{#each ${variable}}}`)
      )
        throw new BadRequestException(
          `Falta la variable obligatoria ${variable}.`,
        );
      if (data && (data[variable] == null || data[variable] === ''))
        throw new BadRequestException('Faltan datos obligatorios del correo.');
    }
  const compile = (s: string) =>
    data
      ? Handlebars.compile(s)(data, {
          allowProtoMethodsByDefault: false,
          allowProtoPropertiesByDefault: false,
        })
      : s;
  body = cleanMailHtml(compile(body), !data);
  const header = compile(escape(preheader));
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:480px){.mail-column{display:block!important;width:100%!important}}</style></head><body style="margin:0;background:#111111;color:#eeeeee;"><div style="display:none;max-height:0;overflow:hidden;">${header}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:640px;border-collapse:collapse;">${body}</table></td></tr></table></body></html>`;
  const text = sanitizeHtml(
    body
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<\/(td|p|div|h[1-4]|tr)>|<br\s*\/?\s*>/gi, '\n'),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  return {
    html,
    text,
    subject: compile(subject)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 200),
  };
}
