import { parseDocument } from 'htmlparser2';
import type { MailBlock } from './mail-renderer';
import { orderProductImageHtml } from './order-product-image';

export const DELIVERED_ITEMS_HTML = `{{#if items}}<div class="order-delivered-items" style="padding:20px 0 0;"><h2 style="margin:0;padding:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:26px;">Artículos de tu pedido</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">{{#each items}}<tr>{{#if imageUrl}}<td width="84" valign="middle" style="padding:10px 14px 10px 0;">${orderProductImageHtml()}</td>{{/if}}<td valign="middle" style="padding:10px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;"><strong>{{name}}</strong>{{#if variantName}}<br>{{variantName}}{{/if}}<br>Cantidad: {{quantity}}</td></tr>{{/each}}</table></div>{{/if}}`;

export function prepareOrderDeliveredHtml(source: string) {
  if (source.includes('order-delivered-items') || /\{\{\s*#each\s+items\s*\}\}/.test(source)) return source;
  // Existing imported layouts put the status in a div with later tracking
  // fields. Insert immediately after its condition without rewriting the div.
  const status = /\{\{\s*#if\s+statusLabel\s*\}\}[\s\S]*?\{\{\s*\/if\s*\}\}/.exec(source);
  if (status) {
    let at = status.index + status[0].length;
    const tree = parseDocument(source, { withStartIndices:true, withEndIndices:true });
    const visit = (node: any) => {
      if (node.name === 'p' && node.startIndex <= status.index && node.endIndex >= at) at = node.endIndex + 1;
      else node.children?.forEach(visit);
    };
    visit(tree);
    return source.slice(0, at) + DELIVERED_ITEMS_HTML + source.slice(at);
  }
  // Literal-status custom layouts are kept byte-for-byte apart from insertion.
  const tree = parseDocument(source, { withStartIndices:true, withEndIndices:true });
  let at: number | undefined;
  const plain = (n: any): string => n.type === 'text' ? n.data : (n.children || []).map(plain).join('');
  const visit = (n: any) => {
    n.children?.forEach(visit);
    if (at === undefined && ['p','div'].includes(n.name) && /Estado actual\s*:\s*Pedido entregado/i.test(plain(n))) at = n.endIndex + 1;
  };
  visit(tree);
  return at === undefined ? source : source.slice(0,at) + DELIVERED_ITEMS_HTML + source.slice(at);
}

/** Render-time projection also covers existing immutable published snapshots.
 * It does not publish drafts, overwrite snapshots or replace a circle's design. */
export function prepareOrderDeliveredDocument<T>(document: T): T {
  if (!document || typeof document !== 'object') return document;
  const result = structuredClone(document);
  const encoded = JSON.stringify(result);
  if (encoded.includes('order-delivered-items') || /\{\{\s*#each\s+items\s*\}\}|"type":"orderItems"/.test(encoded)) return result;
  let inserted = false;
  const walk = (blocks: MailBlock[]) => {
    for (let i=0;i<blocks.length;i++) {
      const block = blocks[i];
      if (!inserted && typeof block.html === 'string') {
        const updated = prepareOrderDeliveredHtml(block.html);
        inserted = updated !== block.html;
        block.html = updated;
      }
      if (!inserted && (block.type === 'statusDetails' || (block.type === 'text' && /Estado actual/.test(block.text || '')))) {
        blocks.splice(i+1,0,{type:'html',html:DELIVERED_ITEMS_HTML,padding:0,background:block.background,color:block.color});
        inserted = true;
      }
      block.columns?.forEach(walk);
    }
  };
  walk((result as any).blocks || []);
  return result;
}
