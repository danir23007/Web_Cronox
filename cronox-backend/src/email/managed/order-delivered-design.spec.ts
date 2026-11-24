import { removeKnownMailFooters } from '../mail-global-footer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { prepareOrderDeliveredDocument, prepareOrderDeliveredHtml } from './order-delivered-design';
import { renderMail } from './mail-renderer';
import { editableDraft } from './mail-editor-content';
import { structuredDocumentForPurpose } from './mail-template-documents';
import { mapDeliveredOrderItems } from '../order-delivered-email.mapper';
import { ManagedMailService } from './managed-mail.service';
import { EmailService } from '../email.service';
import { EmailType } from '../email.types';

const legacy = readFileSync(join(__dirname,'../templates/order-delivered.hbs'),'utf8');
const items=mapDeliveredOrderItems([
  {title:'Vertical <edición>',quantity:2,variant:{size:'M'},product:{images:[{url:'https://example.test/tall.png',width:600,height:1200}]}},
  {title:'Horizontal',quantity:1,variant:{size:'L'},product:{images:[{url:'https://example.test/wide.png',width:1200,height:600}]}},
  {title:'Sin foto',quantity:3,product:{images:[]}},
] as any);
describe('ORDER_DELIVERED existing circle designs',()=>{
 it('includes purchased lines in the actual fallback sending payload with an in-memory transport',async()=>{
   const messages:any[]=[];
   const transport:any={sendMail:jest.fn(async(_sender,message)=>{messages.push(message);return {accepted:[message.to],messageId:'memory-only'};})};
   const email=new EmailService(transport);
   await email.send({type:EmailType.ORDER_DELIVERED,to:'simulated@example.test',subject:'Entregado #42',templateData:{orderId:'42',statusLabel:'Pedido entregado',items}});
   expect(messages).toHaveLength(1);checkHtml(messages[0].html);
 });
 it.each([1,2,3,4,5])('renders the existing active circle %s snapshot without publishing or mutating it',async circle=>{
   const document={blocks:[{type:'html',padding:0,html:legacy.replace('#0b0b0b', ['#101010','#202020','#303030','#404040','#b1001a'][circle-1])}]};
   const snapshot={id:'template-'+circle,senderKey:'ORDERS',purpose:'ORDER_DELIVERED',publicationCircle:circle,subject:'Entregado #{{orderId}}',preheader:'',signatureMode:'none',document};
   const stored=JSON.stringify(snapshot);
   const db:any={emailPublication:{findUnique:jest.fn(async({where})=>where.senderKey_purpose.purpose===`ORDER_DELIVERED:CIRCLE_${circle}`?{version:{snapshot}}:null)}};
   const service=new ManagedMailService(db,{} as any);
   const data={orderId:'42',circleLevel:circle,statusLabel:'Pedido entregado',items};
   const result=await service.published('ORDERS' as any,'ORDER_DELIVERED',data);
   expect(result).toBeTruthy();
   checkHtml(result!.html);
   expect(result!.html).toContain(['#101010','#202020','#303030','#404040','#b1001a'][circle-1]);
   expect(JSON.stringify(snapshot)).toBe(stored);
   expect(renderMail(editableDraft(snapshot).document,snapshot.subject,'','ORDER_DELIVERED',data).html).toBe(removeKnownMailFooters(result!.html));
   expect(new JSDOM(result!.html).window.document.querySelectorAll('.cronox-global-footer')).toHaveLength(1);
 });
 function checkHtml(html:string){
   const d=new JSDOM(html).window.document,block=d.querySelector('.order-delivered-items')!;
   expect(block).toBeTruthy(); expect(block.querySelector('h2')!.textContent).toBe('Artículos de tu pedido');
   const rows=[...block.querySelector('table')!.children].flatMap(n=>n.tagName==='TBODY'?[...n.children]:[n]);
   expect(rows).toHaveLength(3);
   expect(rows[0].textContent).toContain('Vertical <edición>'); expect(rows[0].textContent).toContain('Cantidad: 2');
   expect(rows[1].textContent).toContain('L'); expect(rows[2].textContent).toContain('Cantidad: 3');
   expect(rows[2].querySelector('img')).toBeNull();
   expect(block.querySelectorAll('img')).toHaveLength(2);
   expect(html).toContain('width="35" height="70"');expect(html).toContain('width="70" height="35"');
   expect(html).not.toContain('object-fit');expect(html).not.toContain('{{');
   expect(html.indexOf('Estado actual')).toBeLessThan(html.indexOf('Artículos de tu pedido'));
   expect(html.indexOf('Artículos de tu pedido')).toBeLessThan(html.indexOf('Esperamos que todo'));
 }
 it('supports visual block documents, keeps existing custom item blocks, and omits an empty list',()=>{
   const doc=structuredDocumentForPurpose('ORDER_DELIVERED')!;
   const html=renderMail(doc,'Pedido','','ORDER_DELIVERED',{orderId:'42',statusLabel:'Pedido entregado',items}).html;
   // The block layout uses the same inserted component as imported designs.
   expect(new JSDOM(html).window.document.querySelectorAll('.order-delivered-items img')).toHaveLength(2);
   expect(prepareOrderDeliveredDocument(prepareOrderDeliveredDocument(doc))).toEqual(prepareOrderDeliveredDocument(doc));
   expect(renderMail(doc,'Pedido','','ORDER_DELIVERED',{items:[]}).html).not.toContain('Artículos de tu pedido');
   const custom={blocks:[{type:'html',html:'{{#each items}}<p>{{name}}</p>{{/each}}'}]};
   expect(prepareOrderDeliveredDocument(custom)).toEqual(custom);
 });
 it('preserves source copy and styles and handles paragraphs or a literal status idempotently',()=>{
   for(const source of [legacy,'<p>{{#if statusLabel}}Estado actual: {{statusLabel}}{{/if}}</p>','<div>Estado actual: Pedido entregado</div>']){
     const prepared=prepareOrderDeliveredHtml(source);
     expect(prepared).toContain('Artículos de tu pedido');
     expect(prepareOrderDeliveredHtml(prepared)).toBe(prepared);
     expect(prepared.replace(/\{\{#if items\}\}[\s\S]*\{\{\/each\}\}<\/table><\/div>\{\{\/if\}\}/,'')).toBe(source);
   }
   expect(renderMail({blocks:[{type:'html',html:legacy}]},'Otro','','ORDER_SHIPPED').html).not.toContain('Artículos de tu pedido');
 });
});
