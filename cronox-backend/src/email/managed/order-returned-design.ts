import { parseDocument } from 'htmlparser2';
import type { MailBlock } from './mail-renderer';

export const RETURNED_SUBJECT = 'CRONOX · Correos ha devuelto tu paquete del pedido #{{orderId}}';
export const RETURNED_TITLE = 'Correos ha devuelto tu paquete';
export function hasReturnedTrackingLink(html: string, url: string) {
  let found = false;
  const visit = (node:any) => { if(node.name==='a' && node.attribs?.href===url)found=true;node.children?.forEach(visit); };
  visit(parseDocument(html));
  return found;
}
export const RETURNED_BODY_HTML = `<div class="order-returned-content"><p style="margin:0 0 16px;">Correos nos ha informado de que el paquete de tu pedido <strong>#{{orderId}}</strong> ha sido devuelto al remitente.</p>{{#if returnReason}}<p style="margin:0 0 16px;"><strong>Motivo indicado por Correos:</strong> {{returnReason}}</p>{{/if}}<p style="margin:0 0 20px;">Si sigues esperando tu pedido, contacta con nosotros e indica el número de pedido. Revisaremos el envío y te indicaremos qué opciones tienes.</p><p style="margin:0 0 18px;"><a href="mailto:support@cronox.es" style="display:inline-block;padding:14px 20px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;line-height:18px;text-decoration:none;border-radius:2px;">Contactar con CRONOX</a></p>{{#if trackingNumber}}<p style="margin:0 0 8px;">Número de seguimiento: <strong>{{trackingNumber}}</strong></p>{{/if}}{{#if trackingUrl}}<p style="margin:0;"><a href="{{trackingUrl}}" style="text-decoration:underline;">Ver seguimiento en Correos</a></p>{{/if}}</div>`;

export function prepareOrderReturnedHtml(source: string) {
  if (source.includes('order-returned-content')) return source;
  const tree = parseDocument(source,{withStartIndices:true,withEndIndices:true});
  let heading:any;
  const plain=(n:any):string=>n.type==='text'?n.data:(n.children||[]).map(plain).join('');
  const visit=(n:any)=>{if(!heading&&['h1','h2'].includes(n.name)&&plain(n).trim()!=='CRONOX')heading=n;n.children?.forEach(visit);};
  visit(tree);
  if(!heading)return source;
  let container=heading.parent;
  while(container && !['td','body'].includes(container.name))container=container.parent;
  if(!container)return source;
  const openEnd=source.indexOf('>',heading.startIndex)+1;
  const closeHeading=source.lastIndexOf('</',heading.endIndex);
  const closeContainer=source.lastIndexOf('</',container.endIndex);
  return source.slice(0,openEnd)+RETURNED_TITLE+source.slice(closeHeading,heading.endIndex+1)+RETURNED_BODY_HTML+source.slice(closeContainer);
}

/** Preserve all outer surfaces, the header/logo and the existing title style.
 * Project both drafts and immutable published designs without changing status. */
export function prepareOrderReturnedDocument<T>(document:T):T {
  if(!document||typeof document!=='object')return document;
  const result=structuredClone(document);
  let done=false;
  const walk=(blocks:MailBlock[])=>{
    if(blocks.some(b=>b.html?.includes('order-returned-content'))) {done=true;return;}
    for(let i=0;i<blocks.length&&!done;i++){
      const b=blocks[i];
      if(b.type==='html'&&typeof b.html==='string'){
        const html=prepareOrderReturnedHtml(b.html);done=html!==b.html;b.html=html;
      }else if(b.type==='heading'&&b.text?.trim()!=='CRONOX'){
        b.text=RETURNED_TITLE;
        const body=blocks.slice(i+1).find(n=>n.type==='text')||b;
        blocks.splice(i+1,blocks.length-i-1,{type:'html',html:RETURNED_BODY_HTML,background:body.background,color:body.color,padding:body.padding??10,size:body.size??14,lineHeight:body.lineHeight??1.6});
        done=true;
      }else b.columns?.forEach(walk);
    }
  };
  walk((result as any).blocks||[]);
  return result;
}
