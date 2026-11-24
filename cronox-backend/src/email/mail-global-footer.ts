import { parseDocument } from 'htmlparser2';
import Handlebars from 'handlebars';
import { MAIL_LOGO_BLACK, MAIL_LOGO_WHITE } from './managed/mail-logo-header';

export const COMMERCIAL_MAIL_PURPOSES = new Set(['CART_ABANDONED', 'CIRCLE_PROMOTION', 'NEWSLETTER_WELCOME', 'RESTOCK',
  'LAUNCH', 'CAMPAIGN', 'NEWSLETTER_CONFIRMATION', 'FIRST_ORDER_DISCOUNT', 'PRE_REGISTRATION_CONFIRMATION']);
export const FOOTER_TEXT_START = '\n\nCRONOX · Contacto y preferencias\n';
export const GLOBAL_FOOTER_CSS = '@media(prefers-color-scheme:dark){.cronox-global-footer,.cronox-global-footer td{background-color:#151519!important;color:#eeeeee!important}.cronox-global-footer a{color:#eeeeee!important}.cronox-footer-light{display:none!important;max-height:0!important;overflow:hidden!important}.cronox-footer-dark{display:block!important;max-height:none!important;overflow:visible!important}.cronox-footer-rule{border-color:#505057!important}}';
type Socials = { instagramUrl?: string; tiktokUrl?: string; youtubeUrl?: string };
type Context = { purpose?: string | null; preferenceUrl: string; socials?: Socials; now?: Date; assetOrigin?: string };
const escape = (value: unknown) => Handlebars.escapeExpression(String(value ?? ''));
const plain = (node: any): string => node.type === 'text' ? node.data : (node.children || []).map(plain).join('');
const classes = (node: any) => (node.attribs?.class || '').split(/\s+/);

export function footerSocials(config: Socials = {}) {
  const hosts = { instagramUrl: ['instagram.com', 'www.instagram.com'], tiktokUrl: ['tiktok.com', 'www.tiktok.com'], youtubeUrl: ['youtube.com', 'www.youtube.com'] };
  return Object.entries(hosts).map(([key, allowed]) => {
    const social = { name: key === 'instagramUrl' ? 'Instagram' : key === 'tiktokUrl' ? 'TikTok' : 'YouTube', icon: key.replace('Url', ''), url: undefined as string | undefined };
    const value = config[key as keyof Socials] || (key === 'instagramUrl' ? 'https://www.instagram.com/cronox.es/' : '');
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.username || url.password ||
          !url.pathname.replace(/\//g, '') || /tu_cuenta|example|placeholder|ejemplo|your[_-]?/i.test(url.pathname)) return social;
      return { ...social, url: url.href };
    } catch { return social; }
  });
}

/** Offset edits preserve the rest of the original document byte for byte.
 * Unknown signatures, quoted replies and message-specific support copy stay. */
export function removeKnownMailFooters(source: string) {
  const tree = parseDocument(source, { withStartIndices: true, withEndIndices: true });
  const removals: Array<{ start: number; end: number }> = [];
  let removedGlobal = false;
  const visit = (node: any, quoted = false) => {
    quoted ||= node.name === 'blockquote';
    const quotedGlobal = classes(node).includes('cronox-global-footer') || node.attribs?.['data-cronox-global-footer'] === 'v1';
    if ((!quoted || quotedGlobal) && (node.type === 'tag' || node.name === 'style')) {
      const text = plain(node).replace(/\s+/g, ' ').trim();
      const own = classes(node).includes('cronox-global-footer') || node.attribs?.['data-cronox-global-footer'] === 'v1' ||
        node.name === 'style' && node.attribs?.['data-cronox-footer-style'] === 'v1';
      const welcomeRow = node.name === 'tr' && /welcome-footer/.test(source.slice(node.startIndex, node.endIndex + 1)) &&
        /support@cronox\.es/.test(text) && /instagram\.com\/cronox\.es/.test(source.slice(node.startIndex, node.endIndex + 1)) && text.length < 100;
      const simpleBrand = node.name === 'p' && /^(?:CRONOX\s*·\s*cronox\.es|©\s*\d{4}\s*CRONOX\.?(?: Todos los derechos reservados\.?)?)$/.test(text);
      const terminalBrand = ['tr', 'p'].includes(node.name) && text === 'CRONOX' &&
        !source.slice(node.endIndex + 1).replace(/<[^>]*>/g, '').trim();
      const legacyContacts = node.name === 'p' && text === 'cronox.es · support@cronox.es' &&
        /instagram\.com\/cronox\.es/.test(source.slice(node.startIndex, node.endIndex + 1));
      const unsubscribe = ['p', 'tr'].includes(node.name) &&
        /^(?:Recibes esta comunicación por tu suscripción a CRONOX\.\s*)?(?:Darme de baja|Dejar de recibir comunicaciones comerciales)$/.test(text) &&
        /href=["'][^"']*(?:mailbox-unsubscribe\/|__CRONOX_UNSUBSCRIBE_URL__|\{\{unsubscribeUrl\}\})/.test(source.slice(node.startIndex, node.endIndex + 1));
      if (own || welcomeRow || simpleBrand || terminalBrand || legacyContacts || unsubscribe) {
        if (own) removedGlobal = true;
        removals.push({ start: node.startIndex, end: node.endIndex + 1 }); return;
      }
    }
    node.children?.forEach((child: any) => visit(child, quoted));
  };
  visit(tree);
  const cleaned = removals.sort((a, b) => b.start - a.start).reduce((html, item) => html.slice(0, item.start) + html.slice(item.end), source);
  return removedGlobal ? removeKnownMailFooters(cleaned) : cleaned;
}

function surface(html: string) {
  const tree = parseDocument(html); let background = '#111111'; let found = false; let lockedLight = false;
  const color = (node: any) => /(?:^|;)\s*background(?:-color)?:\s*(#[\da-f]{6}|#[\da-f]{3})(?:;|$)/i.exec(node.attribs?.style || '')?.[1] || node.attribs?.bgcolor;
  const visit = (node: any) => {
    if (node.name === 'meta' && node.attribs?.name === 'color-scheme' && node.attribs.content === 'light only') lockedLight = true;
    const value = color(node);
    if (value && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value) && (!found || classes(node).some(c => ['order-circle-canvas', 'welcome-backdrop'].includes(c)))) {
      background = value; found = true;
    }
    node.children?.forEach(visit);
  }; visit(tree);
  if (background.length === 4) background = '#' + [...background.slice(1)].map(c => c + c).join('');
  const luminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
  const bg = luminance(background);
  const contrast = (foreground: string) => (Math.max(bg, luminance(foreground)) + .05) / (Math.min(bg, luminance(foreground)) + .05);
  const light = contrast('#000000') >= contrast('#ffffff');
  const preferred = light ? '#303035' : '#e6e6eb';
  return { background, light, lockedLight, color: contrast(preferred) >= 4.5 ? preferred : light ? '#000000' : '#ffffff' };
}

function htmlBodyText(html: string) {
  const visit = (node: any): string => {
    if (['head', 'style', 'script'].includes(node.name)) return '';
    if (node.type === 'text') return node.data;
    if (node.name === 'img') return node.attribs?.alt || '';
    if (node.name === 'br') return '\n';
    const text = (node.children || []).map(visit).join('');
    const link = node.name === 'a' && node.attribs?.href ? ` (${node.attribs.href})` : '';
    return text + link + (['p', 'div', 'tr', 'h1', 'h2', 'h3'].includes(node.name) ? '\n' : '');
  };
  return visit(parseDocument(html)).replace(/\n\s*\n/g, '\n\n').trim();
}

export function composeGlobalMailFooter(html: string, text: string, context: Context) {
  html = removeKnownMailFooters(html || `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div style="white-space:pre-wrap">${escape(text).replace(/\n/g, '<br>')}</div></body></html>`);
  if (!text) text = htmlBodyText(html);
  const { background, light, color, lockedLight } = surface(html), border = light ? '#757579' : '#505057';
  const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Madrid' }).format(context.now || new Date()));
  const label = 'actualiza tus preferencias';
  const social = footerSocials(context.socials);
  const icon = (name: string, file: string, dark: boolean) => `<img${light ? ` class="cronox-footer-${dark ? 'dark' : 'light'}"` : ''} src="${escape(new URL(`/assets/mail/global-footer/${file}-${dark ? 'dark' : 'light'}.png`, context.assetOrigin || 'https://cronox.es').href)}" width="20" height="20" alt="${name}" style="${dark && light ? 'display:none;max-height:0;overflow:hidden;mso-hide:all;' : 'display:block;'}width:20px;height:20px;padding:6px 12px;border:0;">`;
  const logo = (dark: boolean) => `<img${light ? ` class="cronox-footer-${dark ? 'dark' : 'light'}"` : ''} src="${dark ? MAIL_LOGO_WHITE : MAIL_LOGO_BLACK}" alt="CRONOX" width="120" style="${dark && light ? 'display:none;max-height:0;overflow:hidden;mso-hide:all;' : 'display:block;'}width:120px;max-width:100%;height:auto;border:0;margin:0 auto;">`;
  const footer = `<table class="cronox-global-footer" data-cronox-global-footer="v1" role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${background}" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;background-color:${background};color:${color};"><tr><td align="center" bgcolor="${background}" style="padding:12px 20px 4px;font-family:Arial,Helvetica,sans-serif;">${light ? logo(false) + logo(true) : logo(true)}</td></tr>
<tr><td align="center" bgcolor="${background}" style="padding:0 20px 5px;"><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:collapse;"><tr>${social.map(s => { const images = light ? icon(s.name, s.icon, false) + icon(s.name, s.icon, true) : icon(s.name, s.icon, true); return `<td align="center" style="padding:0 2px;">${s.url ? `<a href="${escape(s.url)}" title="${s.name} de CRONOX" aria-label="${s.name} de CRONOX" style="display:inline-block;width:44px;height:32px;text-decoration:none;">${images}</a>` : `<span style="display:inline-block;width:44px;height:32px;cursor:default;">${images}</span>`}</td>`; }).join('')}</tr></table></td></tr>
<tr><td align="center" bgcolor="${background}" style="padding:0 24px 8px;"><table role="presentation" align="center" width="80" cellpadding="0" cellspacing="0" border="0"><tr><td class="cronox-footer-rule" style="border-top:1px solid ${border};font-size:1px;line-height:1px;">&#8203;</td></tr></table></td></tr>
<tr><td align="center" bgcolor="${background}" style="padding:0 24px 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${color};">Si tienes cualquier problema o duda, escríbenos a<br><a href="mailto:support@cronox.es" style="color:${color};text-decoration:underline;">support@cronox.es</a></td></tr>
<tr><td align="center" bgcolor="${background}" style="padding:0 20px 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${color};">© ${year} CRONOX. Todos los derechos reservados</td></tr>
<tr><td align="center" bgcolor="${background}" style="padding:0 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${color};"><a href="${escape(context.preferenceUrl)}" style="color:${color};text-decoration:underline;">${label}</a></td></tr></table>`;
  const css = `<style data-cronox-footer-style="v1">${light && !lockedLight ? GLOBAL_FOOTER_CSS : ''}</style>`;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, css + '</head>') : css + html;
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, footer + '</body>') : html + footer;
  // Reserved generated suffix only; never strip an unknown human signature.
  const previous = text.lastIndexOf(FOOTER_TEXT_START);
  if (previous >= 0 && /© \d{4} CRONOX\. Todos los derechos reservados/.test(text.slice(previous))) text = text.slice(0, previous);
  text = text.replace(/\n*Recibes esta comunicación por tu suscripción a CRONOX\. Darme de baja: [^\s]+\s*$/, '');
  text = text.replace(/\n+(?:CRONOX(?: · cronox\.es)?|© \d{4} CRONOX\.?(?: Todos los derechos reservados\.?)?)\s*$/, '');
  return { html, text: text.trimEnd() + FOOTER_TEXT_START + social.map(s => `${s.name}${s.url ? ': ' + s.url : ''}\n`).join('') +
    `Si tienes cualquier problema o duda, escríbenos a support@cronox.es (mailto:support@cronox.es).\n© ${year} CRONOX. Todos los derechos reservados\n${label}: ${context.preferenceUrl}` };
}
