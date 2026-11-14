import { parseDocument } from 'htmlparser2';
import type { MailBlock } from './mail-renderer';
import { orderProductImageHtml } from './order-product-image';

export const ORDER_LOGO_LIGHT = 'https://cronox.es/assets/mail/order-confirmation/logo-light.png';
export const ORDER_LOGO_DARK = 'https://cronox.es/assets/mail/order-confirmation/logo-dark.png';
export const ORDER_TAX_LABEL = 'Impuestos (ya incluidos)';
export const orderCircle = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1;
export const orderPublicationKey = (circle: number) => `ORDER_CONFIRMATION:CIRCLE_${orderCircle(circle)}`;
export const orderRingsUrl = (circle: number, theme = 'light') => `https://cronox.es/assets/mail/order-confirmation/rings-${orderCircle(circle)}-${theme === 'dark' ? 'dark' : 'light'}.png?v=${orderCircle(circle) === 5 ? 4 : orderCircle(circle) === 4 ? 3 : 2}`;
export const ORDER_CONFIRMATION_CSS = `
.order-logo-dark{display:none!important;max-height:0!important;overflow:hidden!important;mso-hide:all;}
.order-header-cell{padding:0;}.order-actions{border-collapse:collapse!important;width:auto!important;max-width:100%!important;}.order-actions td{padding:0;vertical-align:middle!important;}.order-actions a{box-sizing:border-box;white-space:nowrap;min-height:44px;}
.order-circle-canvas .order-confirmation{background-color:transparent!important;}
.order-circle-canvas table{border-collapse:collapse;}
.order-surface td,.order-surface div{overflow-wrap:anywhere;}
@media(max-width:480px){.order-header-cell{display:table-cell!important;vertical-align:top!important;}.order-header-cell img{max-width:140px!important;height:auto!important;}.order-summary-lead{display:none!important;}.order-summary-values{width:100%!important;}.order-actions a{font-size:11px!important;padding:15px 8px!important;}.order-actions .order-action-or{padding:0 7px!important;}}
@media(prefers-color-scheme:dark){
 .order-confirmation{background-color:#111111!important;}
 .order-circle-canvas{background-color:#1b1b1b!important;}
 .order-surface,.order-surface td{color:#eeeeee!important;}
 .order-surface div,.order-surface h1,.order-surface h2,.order-surface p{color:#eeeeee!important;}
 .order-logo-light{display:none!important;max-height:0!important;overflow:hidden!important;}
 .order-logo-dark{display:block!important;max-height:none!important;overflow:visible!important;}
 .order-tax-row td,.order-tax-row div,.order-tax-row strong{color:#b8b8b8!important;font-weight:400!important;}
 ${[1, 2, 3, 4, 5].map(n => `.order-circle-${n}{background-image:url("${orderRingsUrl(n, 'dark')}")!important;}`).join('')}
}`;

export function orderLogoHtml() {
  // The default PNG contains its own light canvas, so forced dark clients that
  // ignore the media query retain a legible logo. No SVG/WebP or CSS filter.
  return `<img class="order-logo-light" src="${ORDER_LOGO_LIGHT}" alt="CRONOX" width="140" style="display:block;width:140px;max-width:100%;height:auto;border:0;"><img class="order-logo-dark" src="${ORDER_LOGO_DARK}" alt="CRONOX" width="140" style="display:none;max-height:0;overflow:hidden;mso-hide:all;width:140px;max-width:100%;height:auto;border:0;">`;
}

/** Fixed presentation generated after sanitizing user content. Removing only
 * the first-party neutral surface paint lets a single watermark span sections;
 * custom colours, images, copy and links remain intact. */
export function orderCanvas(content: string, circle: number) {
  content = content.replace(/<(?:td|table)\b[^>]*>/gi, tag => tag
    .replace(/\b(?:background|background-color):\s*#(?:f7f7f5|f3f3f1)(?=[;"\s])/gi, 'background-color:transparent')
    .replace(/\sbgcolor="#(?:f7f7f5|f3f3f1)"/gi, '')
    .replace(/border:1px solid #ebebe7;?/gi, ''));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;border-collapse:collapse;"><tr><td class="order-circle-canvas order-circle-${orderCircle(circle)}" background="${orderRingsUrl(circle)}" bgcolor="#f7f7f5" style="background-color:#f7f7f5;background-image:url('${orderRingsUrl(circle)}');background-repeat:no-repeat;background-size:640px 1400px;background-position:70% center;">${content}</td></tr></table>`;
}

export function mutedTaxColor(background: string) {
  const hex = background.replace('#', ''), full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  const luminance = (value: string) => [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const bg = luminance(full);
  return ['#666666', '#b8b8b8', '#111111', '#eeeeee'].find(candidate => {
    const fg = luminance(candidate.slice(1));
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05) >= 4.5;
  }) || '#000000';
}

/** Target known presentation elements only. Source offsets preserve custom HTML,
 * links, expressions and prose; no wholesale conversion of a saved design. */
export function prepareOrderConfirmationHtml(source: string) {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const tree = parseDocument(source, { withStartIndices: true, withEndIndices: true });
  let logoFound = source.includes('order-logo-light');
  const plain = (node: any): string => node.type === 'text' ? node.data : (node.children || []).map(plain).join('');
  const replace = (node: any, text: string) => edits.push({ start: node.startIndex, end: node.endIndex + 1, text });
  const addClass = (open: string, name: string) => /\bclass="/.test(open)
    ? open.replace(/class="([^"]*)"/, (_all, value: string) => `class="${value.split(/\s+/).includes(name) ? value : value + ' ' + name}"`)
    : open.replace(/^(<\w+)/, `$1 class="${name}"`);
  const visit = (node: any) => {
    if (node.type === 'tag') {
      if (node.name === 'table' && node.attribs?.class?.split(/\s+/).includes('order-product-frame')) {
        const original = source.slice(node.startIndex, node.endIndex + 1);
        if (original.includes('{{imageUrl}}')) {
          const current = orderProductImageHtml();
          if (original !== current) replace(node, current);
          return;
        }
      }
      if (node.name === 'img' && node.attribs?.src === '{{imageUrl}}') {
        let parent = node.parent, framed = false;
        while (parent) { if (parent.attribs?.class?.split(/\s+/).includes('order-product-frame')) framed = true; parent = parent.parent; }
        if (!framed) { replace(node, orderProductImageHtml()); return; }
      }
      if (node.name === 'a' && ['{{orderUrl}}', '{{storeUrl}}'].includes(node.attribs?.href) && node.children?.every((n: any) => n.type === 'text')) {
        const original = source.slice(node.startIndex, node.endIndex + 1);
        const trimmed = original.replace(/>([\s\S]*?)<\/a>$/, (_all, text) => `>${text.trim()}</a>`);
        if (trimmed !== original) { replace(node, trimmed); return; }
      }
      if (!logoFound && node.startIndex < source.indexOf('{{orderId}}') && ['div', 'h1', 'h2'].includes(node.name) && plain(node).trim() === 'CRONOX') {
        replace(node, orderLogoHtml()); logoFound = true; return;
      }
      if (node.name === 'tr' && plain(node).trim().startsWith('Impuestos') && plain(node).includes('{{taxesFormatted}}')) {
        const row = source.slice(node.startIndex, node.endIndex + 1);
        if (/\bImpuestos\s*</.test(row)) {
          replace(node, row.replace('<tr', '<tr class="order-tax-row"').replace(/\bImpuestos\s*(?=<)/, `<span style="white-space:nowrap;">${ORDER_TAX_LABEL}</span>`).replace(/color:#[a-f\d]+/gi, 'color:#666666').replace('font-weight:600', 'font-weight:400')); return;
        }
      }
      if (node.name === 'table' && !node.attribs?.class?.includes('order-actions')) {
        const anchors: any[] = [];
        const find = (n: any) => { if (n.name === 'a') anchors.push(n); n.children?.forEach(find); };
        find(node);
        if (anchors.length === 2 && anchors[0].attribs?.href === '{{orderUrl}}' && anchors[1].attribs?.href === '{{storeUrl}}' &&
            !(node.children || []).some(function nested(n: any): boolean { return n.name === 'table' || (n.children || []).some(nested); })) {
          const button = (a: any, secondary: boolean) => {
            let html = source.slice(a.startIndex, a.endIndex + 1).replace(/>([\s\S]*?)<\/a>$/, (_all, text) => `>${text.trim()}</a>`);
            if (secondary) html = html.replace(/>\s*o visita nuestra tienda\s*</i, '>Visita nuestra tienda<');
            return html.replace(/style="[^"]*"/, `style="display:inline-block;white-space:nowrap;background:${secondary ? '#ffffff' : '#060606'};color:${secondary ? '#111111' : '#ffffff'};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;line-height:16px;padding:15px 16px;border-radius:2px;"`);
          };
          replace(node, `<table class="order-actions" role="presentation" cellpadding="0" cellspacing="0"><tr><td>${button(anchors[0], false)}</td><td class="order-action-or" style="padding:0 14px;font:13px Arial,sans-serif;">o</td><td>${button(anchors[1], true)}</td></tr></table>`);
          return;
        }
      }
      // Only the first-party section spacing is changed; custom values survive.
      let open = source.slice(node.startIndex, source.indexOf('>', node.startIndex) + 1), next = open;
      if (node.name === 'td') {
        if (/background:#f7f7f5/.test(open)) next = addClass(next, 'order-surface');
        next = next.replace('padding:30px 26px 34px 26px', 'padding:30px 26px 6px 26px')
          .replace('padding:30px 26px 24px 26px', 'padding:6px 26px 6px 26px')
          .replace('padding:30px 26px 26px 26px', 'padding:6px 26px 26px 26px')
          .replace('height:18px;line-height:18px;font-size:18px;', 'height:6px;line-height:6px;font-size:6px;');
        if (/width="44%"/.test(open)) next = addClass(next, 'order-summary-lead');
        if (/width="56%"/.test(open)) next = addClass(next, 'order-summary-values');
      }
      if (next !== open) edits.push({ start: node.startIndex, end: node.startIndex + open.length, text: next });
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export function prepareOrderConfirmationDocument<T>(document: T): T {
  const result = JSON.parse(JSON.stringify(document));
  const blocks: MailBlock[] = result?.blocks || [];
  // Sections identified by their original semantic blocks, never by position
  // alone. An administrator's extra content and existing custom logos survive.
  const header = blocks.find(b => b.type === 'section' && b.columns?.[0]?.some(c => c.type === 'columns' && c.columns?.[1]?.some(t => t.text?.includes('{{orderId}}'))));
  const summary = blocks.find(b => b.columns?.some(col => col.some(c => c.type === 'orderTotals')));
  const customer = blocks.find(b => b.columns?.some(col => col.some(c => c.type === 'customerDetails')));
  if (header) {
    const columns = header.columns![0].find(c => c.type === 'columns' && c.columns?.[1]?.some(t => t.text?.includes('{{orderId}}')))!;
    columns.orderHeader = true;
    const left = columns.columns![0];
    if (left.length === 1 && left[0].type === 'heading' && left[0].text?.trim() === 'CRONOX')
      left[0] = { type: 'logo', adaptiveOrderLogo: true, src: ORDER_LOGO_LIGHT, alt: 'CRONOX', width: 140, padding: 0, background: left[0].background, color: left[0].color };
    const children = header.columns![0];
    const title = children.find(b => b.type === 'heading');
    const inset = title?.paddingLeft ?? title?.padding ?? 0;
    if (left[0]?.adaptiveOrderLogo) { left[0].padding = 0; left[0].paddingLeft = inset; left[0].width = 140; }
    const primary = children.find(b => b.type === 'button' && b.url === '{{orderUrl}}');
    const secondary = children.find(b => b.type === 'button' && b.url === '{{storeUrl}}');
    if (primary && secondary) {
      if (/^(?:o )?visita nuestra tienda$/i.test(secondary.text || '')) secondary.text = 'Visita nuestra tienda';
      const index = Math.min(children.indexOf(primary), children.indexOf(secondary));
      children.splice(children.indexOf(primary), 1); children.splice(children.indexOf(secondary), 1);
      children.splice(index, 0, { type: 'columns', orderActions: true, columns: [[primary], [secondary]], padding: 4, paddingLeft: inset, background: header.background, color: header.color });
    }
    for (const block of children) if (block.orderActions) block.paddingLeft = inset;
    for (const block of header.columns![0]) {
      if (block.type === 'button' && ['{{orderUrl}}', '{{storeUrl}}'].includes(block.url || '')) {
        block.padding = Math.max(15, block.padding ?? 14);
        block.paddingTop ??= block.url === '{{orderUrl}}' ? 4 : 0;
        block.paddingBottom ??= 2;
        // Keep at least 44px of vertical touch area while reducing outer gaps.
      }
    }
  }
  for (const section of [header, summary, customer]) if (section) {
    section.orderSurface = true;
    if (section.padding === 26) {
      if (section !== header) section.paddingTop ??= 6;
      if (section !== customer) section.paddingBottom ??= 6;
    }
    const index = blocks.indexOf(section), gap = blocks[index + 1];
    if (section !== customer && gap?.type === 'spacer' && gap.size === 18) { gap.size = 6; gap.orderSurface = true; }
  }
  const walk = (items: MailBlock[]) => items.forEach(block => {
    if (block.type === 'orderTotals' && (!block.labels?.taxes || block.labels.taxes === 'Impuestos'))
      block.labels = { ...block.labels, taxes: ORDER_TAX_LABEL };
    if (typeof block.html === 'string') block.html = prepareOrderConfirmationHtml(block.html);
    block.columns?.forEach(walk);
  });
  walk(blocks);
  return result;
}
