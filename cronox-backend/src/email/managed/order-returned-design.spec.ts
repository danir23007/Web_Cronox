import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { RETURNED_SUBJECT, RETURNED_TITLE, prepareOrderReturnedDocument, prepareOrderReturnedHtml } from './order-returned-design';
import { renderMail } from './mail-renderer';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { editableDraft } from './mail-editor-content';
import { mailPreviewData } from './welcome-design';
import { ManagedMailService } from './managed-mail.service';
import { EmailService } from '../email.service';
import { EmailType } from '../email.types';

const html=readFileSync(join(__dirname,'../templates/order-logistics.hbs'),'utf8');
const data={...mailPreviewData('ORDER_RETURNED'),orderId:'42',trackingNumber:'PQ123456789ES',trackingUrl:'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=PQ123456789ES',shippingCarrier:'Correos',statusLabel:'Devolución al remitente'};
function check(result:{html:string;subject:string;text?:string},reason?:string|null){
 const d=new JSDOM(result.html).window.document;
 expect(result.subject).toBe('CRONOX · Correos ha devuelto tu paquete del pedido #42');
 expect(d.querySelector('h1,h2')!.textContent).toBe(RETURNED_TITLE);
 const content=d.querySelector('.order-returned-content')!;
 expect(content.textContent).toContain('Correos nos ha informado de que el paquete de tu pedido #42 ha sido devuelto al remitente.');
 expect(content.querySelector('p strong')!.textContent).toBe('#42');
 const contact=content.querySelector('a[href="mailto:support@cronox.es"]')!;
 expect(contact.textContent).toBe('Contactar con CRONOX');
 const tracking=content.querySelector(`a[href="${data.trackingUrl}"]`)!;
 expect(tracking.textContent).toBe('Ver seguimiento en Correos');
 expect(tracking.getAttribute('style')).not.toContain('background');
 expect([...content.querySelectorAll('p')].findIndex(p=>p.contains(contact))).toBeLessThan([...content.querySelectorAll('p')].findIndex(p=>p.textContent!.includes(data.trackingNumber)));
 if(reason){expect(content.querySelectorAll('p')[1].textContent).toBe('Motivo indicado por Correos: '+reason);if(result.text!==undefined)expect(result.text).toContain(reason);}
 else {expect(content.textContent).not.toContain('Motivo indicado por Correos:');if(result.text!==undefined)expect(result.text).not.toContain('Motivo indicado por Correos:');}
 expect(result.html).not.toContain('{{');
}
describe('ORDER_RETURNED content in existing five-circle designs',()=>{
 it.each([1,2,3,4,5])('uses the approved copy in circle %s drafts, published HTML and actual transport payload without publishing',async circle=>{
   const background=['#111111','#222222','#333333','#444444','#b1001a'][circle-1];
   const doc=structuredDocumentForPurpose('ORDER_RETURNED')!;
   doc.blocks[0].background=background;
   const template={senderKey:'ORDERS',purpose:'ORDER_RETURNED',publicationCircle:circle,subject:'Old subject',preheader:'',signatureMode:'none',textOverride:'Old text',document:doc};
   const saved=JSON.stringify(template);
   const db:any={emailPublication:{findUnique:async()=>({version:{snapshot:template}})}};
   const service=new ManagedMailService(db,{} as any);
   for(const reason of ['No retirado en plazo',null,'Devuelto al remitente','SR123ABC','']){
     const sample={...data,circleLevel:circle,returnReason:reason};
     const published=await service.published('ORDERS' as any,'ORDER_RETURNED',sample);
     check(published!,reason==='No retirado en plazo'?reason:null);
     expect(published!.html).toContain(background);expect(published!.html).toContain('alt="CRONOX"');
     const draft=editableDraft(template);
     expect(draft.subject).toBe(RETURNED_SUBJECT);
     const preview=renderMail(draft.document,draft.subject,'','ORDER_RETURNED',sample);
     check(preview,reason==='No retirado en plazo'?reason:null);
     const transport:any={sendMail:jest.fn(async()=>({accepted:['buyer@example.test'],messageId:'memory-only'}))};
     const email=new EmailService(transport,{recipientCircle:async()=>circle,published:async()=>published} as any);
     await email.send({type:EmailType.ORDER_RETURNED,to:'buyer@example.test',subject:'Old',deliveryDeadline:Date.now()+20000,templateData:sample});
     const message=transport.sendMail.mock.calls[0][1];
     expect(message.html).toBe(published!.html);check(message,reason==='No retirado en plazo'?reason:null);
   }
   expect(JSON.stringify(template)).toBe(saved);
 });
 it('preserves imported header, logo, background and title styles and stays idempotent',()=>{
   const source=html.replace('CRONOX</p>','<img src="https://example.test/logo.png" alt="Logo">CRONOX</p>');
   const transformed=prepareOrderReturnedHtml(source);
   expect(transformed.slice(0,transformed.indexOf('<h1'))).toBe(source.slice(0,source.indexOf('<h1')));
   expect(transformed).toContain('<h1 style="font-size:26px">'+RETURNED_TITLE+'</h1>');
   expect(prepareOrderReturnedHtml(transformed)).toBe(transformed);
   const doc={blocks:[{type:'html',html:source}]};
   expect(prepareOrderReturnedDocument(prepareOrderReturnedDocument(doc))).toEqual(prepareOrderReturnedDocument(doc));
   check(renderMail(doc,'Old','','ORDER_RETURNED',{...data,returnReason:'Dirección incorrecta'}),'Dirección incorrecta');
   expect(renderMail(doc,'Old','','ORDER_INCIDENT',data).html).not.toContain('order-returned-content');
 });
 it('uses the same conditional reason and both links in the real fallback, in memory only',async()=>{
   for(const returnReason of ['Rehusado',undefined]){
     const transport:any={sendMail:jest.fn(async()=>({accepted:['buyer@example.test'],messageId:'memory-only'}))};
     await new EmailService(transport).send({type:EmailType.ORDER_RETURNED,to:'buyer@example.test',subject:'Old',templateData:{...data,returnReason}});
     check(transport.sendMail.mock.calls[0][1],returnReason);
   }
 });
});
