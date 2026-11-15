import { parseDocument } from 'htmlparser2';
import Handlebars from 'handlebars';
import type { MailBlock } from './mail-renderer';
import { orderProductImageHtml } from './order-product-image';

// The full painted anchor border stays clickable in Outlook, which may ignore
// anchor padding. Fits at 320px without media queries or flexbox.
export function shippedActionsHtml(primary: MailBlock, secondary: MailBlock) {
  const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[a-f\d]{3}(?:[a-f\d]{3})?$/i.test(v) ? v : fallback;
  const bg = color(primary.buttonBackground, '#ffffff'), fg = color(primary.buttonColor, '#000000');
  const style = `display:inline-block;white-space:nowrap;background:${bg};color:${fg};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;line-height:18px;border-top:13px solid ${bg};border-bottom:13px solid ${bg};border-left:8px solid ${bg};border-right:8px solid ${bg};border-radius:2px;`;
  const cell = (b: MailBlock, condition: string) => `{{#if ${b.condition || condition}}}<td valign="middle" style="padding:0;"><a href="${Handlebars.escapeExpression(b.url || '')}" style="${style}">${Handlebars.escapeExpression(b.text || '')}</a></td>{{/if}}`;
  return `<table class="order-shipped-actions" role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cell(primary, 'orderUrl')}{{#if ${primary.condition || 'orderUrl'}}}{{#if ${secondary.condition || 'storeUrl'}}}<td class="order-action-or" valign="middle" style="padding:0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;">o</td>{{/if}}{{/if}}${cell(secondary, 'storeUrl')}</tr></table>`;
}

/** Replace only the existing action table and dynamic product photo. Preserve
 * surrounding copy, branding, links and conditional expressions. */
export function prepareOrderShippedHtml(source: string) {
  const edits: { start: number; end: number; text: string }[] = [];
  const tree = parseDocument(source, { withStartIndices: true, withEndIndices: true });
  const replace = (n: any, text: string) => edits.push({ start:n.startIndex, end:n.endIndex + 1, text });
  const visit = (node: any) => {
    if (node.name === 'table' && /\border-product-frame\b/.test(node.attribs?.class || '')) return;
    if (node.name === 'img' && node.attribs?.src === '{{imageUrl}}') { replace(node, orderProductImageHtml()); return; }
    if (node.name === 'table' && !/\border-shipped-actions\b/.test(node.attribs?.class || '')) {
      const anchors: any[] = []; let nested = false;
      const find = (n: any) => { if (n !== node && n.name === 'table') nested = true; if (n.name === 'a') anchors.push(n); n.children?.forEach(find); };
      find(node);
      const primary = anchors.find(a => a.attribs.href === '{{orderUrl}}'), secondary = anchors.find(a => a.attribs.href === '{{storeUrl}}');
      if (!nested && primary && secondary && anchors.every(a => ['{{orderUrl}}', '{{storeUrl}}', '{{trackingUrl}}'].includes(a.attribs.href))) {
        const text = (n: any): string => n.type === 'text' ? n.data : (n.children || []).map(text).join('');
        const style = primary.attribs.style || '';
        const bg = style.match(/(?:^|;)\s*background(?:-color)?:\s*(#[a-f\d]+)/i)?.[1];
        const fg = style.match(/(?:^|;)\s*color:\s*(#[a-f\d]+)/i)?.[1];
        const tracking = anchors.find(a => a.attribs.href === '{{trackingUrl}}');
        replace(node, shippedActionsHtml({ type:'button', url:'{{orderUrl}}', text:text(primary).trim(), buttonBackground:bg, buttonColor:fg }, { type:'button', url:'{{storeUrl}}', text:text(secondary).trim() }) +
          (tracking ? `{{#if trackingUrl}}<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 0 0;">${source.slice(tracking.startIndex, tracking.endIndex + 1)}</td></tr></table>{{/if}}` : ''));
        return;
      }
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export function prepareOrderShippedDocument<T>(document: T): T {
  if (!document || typeof document !== 'object') return document;
  const result = structuredClone(document);
  const walk = (blocks: MailBlock[]) => {
    const primary = blocks.find(b => b.type === 'button' && b.url === '{{orderUrl}}'), secondary = blocks.find(b => b.type === 'button' && b.url === '{{storeUrl}}');
    if (primary && secondary) {
      const index = Math.min(blocks.indexOf(primary), blocks.indexOf(secondary));
      blocks.splice(blocks.indexOf(primary), 1); blocks.splice(blocks.indexOf(secondary), 1);
      blocks.splice(index, 0, { type:'html', html:shippedActionsHtml(primary, secondary), background:primary.background, color:primary.color, padding:12 });
    }
    for (const block of blocks) {
      if (typeof block.html === 'string') block.html = prepareOrderShippedHtml(block.html);
      block.columns?.forEach(walk);
    }
  };
  walk((result as any).blocks || []);
  return result;
}
