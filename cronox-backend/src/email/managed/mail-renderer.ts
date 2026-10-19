import { requireWelcomeCode } from './welcome-code';
import { BadRequestException } from '@nestjs/common';
import Handlebars from 'handlebars';
import sanitizeHtml from 'sanitize-html';
import { parseDocument } from 'htmlparser2';
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
// Explicit imported-email format. It uses the same sanitizer and expression
// validation as visual blocks; it is not a trusted/unsanitized source marker.
export type MailDocument = {
  blocks: MailBlock[];
  format?: 'html-email';
  schemaVersion?: number;
  page?: { width: number; background: string; colorScheme?: 'light-only'; canvas?: 'body' };
};
export const MAIL_RESPONSIVE_CSS = '@media(max-width:480px){.welcome-backdrop{background-size:560px 100%!important}.mail-column{display:block!important;width:100%!important}.welcome-title{font-size:40px!important;line-height:43px!important;letter-spacing:-0.5px!important}.welcome-copy{font-size:17px!important;line-height:23px!important}.welcome-footer{font-size:9px!important;letter-spacing:0.3px!important}.welcome-instagram{width:9px!important;height:9px!important}.welcome-code{font-size:18px!important;letter-spacing:1px!important}}';
// A closed document preference, never arbitrary imported head markup/CSS.
// Ask supporting email clients to preserve the approved light design in dark UI.
const LIGHT_ONLY_HEAD = '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">';
// Gmail's meta opt-out preserves the palette. The surrounding canvas always
// uses the document background, including when the client prefers dark mode.
const LIGHT_ONLY_CSS = ':root{color-scheme:light dark;}';
// Keep the light canvas painted and remove client body spacing. These resets
// belong to the explicit imported light document, not every managed email.
const lightPageCss = (background: string) => LIGHT_ONLY_CSS +
  `html,body,.mail-html-page{margin:0!important;padding:0!important;width:100%!important;background-color:${background}!important;}`;
const lightPageAttributes = (background: string) =>
  ` class="mail-html-page" bgcolor="${background}" leftmargin="0" topmargin="0" marginwidth="0" marginheight="0"`;
const lightPageStyle = (background: string, foreground: string) =>
  `margin:0!important;padding:0!important;width:100%;background-color:${background};color:${foreground};`;
// Optional body-painted canvas: restore the original welcome's background
// propagation (transparent html -> body background), independently of Gmail's
// palette opt-out. No custom dark palette is used, so no :root scheme override.
// Kept separate from lightPage* to leave other imported/visual documents alone.
const bodyCanvasStyle = (background: string) =>
  `margin:0;background:${background};color:#080808;`;
const bodyCanvasAttributes = (background: string) =>
  ` class="mail-html-page mail-body-canvas" bgcolor="${background}"`;
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
    allowedClasses: { '*': ['mail-column', 'welcome-title', 'welcome-copy', 'welcome-footer', 'welcome-instagram', 'welcome-code', 'welcome-backdrop'] },
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
        padding: [/^(0|[\d.]+(px|%))(\s+(0|[\d.]+(px|%))){0,3}$/],
        margin: [/^(0|[\d.]+(px|%))(\s+(0|[\d.]+(px|%)|auto)){0,3}$/],
        'padding-top': [/^\d+px$/],
        'padding-bottom': [/^\d+px$/],
        'letter-spacing': [/^-?[\d.]+px$/],
        width: [/^[\d.]+(px|%)$/],
        'max-width': [/^[\d.]+(px|%)$/],
        height: [/^(auto|[\d.]+(px|%))$/],
        display: [/^(block|inline-block|none)$/],
        'border-collapse': [/^(collapse|separate)$/],
        border: [/^\d+px solid #[\da-f]{3,8}$/i, /^0$/],
        'border-radius': [/^\d+px$/],
        'white-space': [/^nowrap$/],
        'overflow-wrap': [/^anywhere$/],
        'word-break': [/^break-(word|all)$/],
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

// Keep the same responsive email shell when editing the effective HTML in Correo.
// Only the existing body sanitizer accepts user markup; head CSS is fixed code.
export function effectiveMailHtml(html: string, placeholders = false) {
  const parsed = parseDocument(html);
  const root = parsed.children.find(node => node.type === 'tag' && node.name === 'html');
  const head = root && 'children' in root ? root.children.find(node => node.type === 'tag' && node.name === 'head') : undefined;
  const lightOnly = !!(head && 'children' in head && head.children.some(node =>
    node.type === 'tag' && node.name === 'meta' && node.attribs.name === 'color-scheme' && node.attribs.content === 'light only'));
  const body = root && 'children' in root ? root.children.find(node => node.type === 'tag' && node.name === 'body') : undefined;
  const bodyCanvas = lightOnly && !!(body && 'attribs' in body &&
    /(?:^|\s)mail-body-canvas(?:\s|$)/.test(body.attribs.class || ''));
  // Read only a validated color from our shell; never copy source CSS/attrs.
  const background = color(body && 'attribs' in body ? body.attribs.bgcolor : undefined, '#111111');
  return `<!doctype html><html lang="es"${lightOnly && !bodyCanvas ? ` style="margin:0;padding:0;background-color:${background};"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${lightOnly ? LIGHT_ONLY_HEAD : ''}<style>${lightOnly && !bodyCanvas ? lightPageCss(background) : ''}${MAIL_RESPONSIVE_CSS}</style></head><body${bodyCanvas ? bodyCanvasAttributes(background) : lightOnly ? lightPageAttributes(background) : ''} style="${bodyCanvas ? bodyCanvasStyle(background) : lightOnly ? lightPageStyle(background, '#080808') : 'margin:0;background:#111111;color:#eeeeee;'}">${cleanMailHtml(html, placeholders)}</body></html>`;
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
  if (purpose === 'NEWSLETTER_WELCOME' && data !== undefined) requireWelcomeCode(data.discountCode);
  if (purpose === 'NEWSLETTER_ACCESS' && /\{\{\s*(?:initialPassword|passwordMessage)\s*\}\}/.test(subject + preheader)) {
    throw new BadRequestException('La contraseña solo puede aparecer en el cuerpo del correo.');
  }
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
  const doc = document as MailDocument;
  const imported = doc.format === 'html-email';
  if (doc.format !== undefined && !imported)
    throw new BadRequestException('Formato de documento no válido.');
  if (doc.page?.colorScheme !== undefined && (!imported || doc.page.colorScheme !== 'light-only'))
    throw new BadRequestException('Esquema de color del correo no válido.');
  if (doc.page?.canvas !== undefined && (!imported || doc.page.canvas !== 'body' || doc.page.colorScheme !== 'light-only'))
    throw new BadRequestException('Fondo exterior del correo no válido.');
  if (imported && (doc.schemaVersion !== 3 || doc.blocks?.length !== 1 ||
      doc.blocks[0]?.type !== 'html' || typeof doc.blocks[0]?.html !== 'string' ||
      !doc.page || !Number.isInteger(doc.page.width) || doc.page.width < 320 || doc.page.width > 640 ||
      !/^#[\da-f]{6}$/i.test(doc.page.background)))
    throw new BadRequestException('Documento HTML de correo no válido.');
  if (imported && signature)
    throw new BadRequestException('Este diseño ya incluye su pie. Selecciona «Sin firma».');
  let body = imported ? cleanMailHtml(doc.blocks[0].html!, true) : renderBlocks(document);
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
  const pageBackground = imported ? doc.page!.background : '#111111';
  const content = imported
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${pageBackground}" style="width:100%;margin:0;border:0;border-collapse:collapse;background-color:${pageBackground};"><tr><td align="center" bgcolor="${pageBackground}" style="padding:0;border:0;"><table role="presentation" align="center" width="${doc.page!.width}" cellpadding="0" cellspacing="0" border="0" bgcolor="${pageBackground}" style="width:100%;max-width:${doc.page!.width}px;border:0;border-collapse:collapse;background-color:${pageBackground};"><tr><td bgcolor="${pageBackground}" style="padding:0;border:0;">${body}</td></tr></table></td></tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" style="width:100%;max-width:640px;border-collapse:collapse;">${body}</table></td></tr></table>`;
  const lightOnly = imported && doc.page!.colorScheme === 'light-only';
  const bodyCanvas = lightOnly && doc.page!.canvas === 'body';
  const html = `<!doctype html><html lang="es"${lightOnly && !bodyCanvas ? ` style="margin:0;padding:0;background-color:${pageBackground};"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${lightOnly ? LIGHT_ONLY_HEAD : ''}<style>${lightOnly && !bodyCanvas ? lightPageCss(pageBackground) : ''}${MAIL_RESPONSIVE_CSS}</style></head><body${bodyCanvas ? bodyCanvasAttributes(pageBackground) : lightOnly ? lightPageAttributes(pageBackground) : ''} style="${bodyCanvas ? bodyCanvasStyle(pageBackground) : lightOnly ? lightPageStyle(pageBackground, '#080808') : `margin:0;background:${pageBackground};color:${imported ? '#080808' : '#eeeeee'};`}">${imported && !header ? '' : `<div style="display:none;max-height:0;overflow:hidden;">${header}</div>`}${content}</body></html>`;
  if (purpose === 'NEWSLETTER_WELCOME' && Buffer.byteLength(html, 'utf8') >= 80 * 1024)
    throw new BadRequestException('WELCOME_HTML_SIZE_LIMIT: el HTML final debe ser inferior a 80 KB.');
  let text = sanitizeHtml(
    (imported ? body.replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/gi, '$1') : body)
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<\/(td|p|div|h[1-4]|tr)>|<br\s*\/?\s*>/gi, '\n'),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  if (imported) {
    const parsed = parseDocument(text);
    const plain = (nodes: typeof parsed.children): string => nodes.map(node =>
      node.type === 'text' ? node.data : 'children' in node ? plain(node.children) : '',
    ).join('');
    text = plain(parsed.children);
  }
  return {
    html,
    text,
    subject: compile(subject)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 200),
  };
}
