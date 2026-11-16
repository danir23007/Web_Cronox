import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { circlePromotionData, circlePromotionDocument, prepareCirclePromotionDocument, prepareCirclePromotionHtml, CIRCLE_PROMOTION_SUBJECT, CIRCLE_PROMOTION_INTRO, CIRCLE_PROMOTION_ACCREDITATION, circleBenefitFields } from './circle-promotion-design';
import { renderMail } from './mail-renderer';
import { ManagedMailService } from './managed-mail.service';
import { editableDraft } from './mail-editor-content';
import { EmailService } from '../email.service';
import { EmailType } from '../email.types';

function legacyDocument(level:number):any {
 const doc=circlePromotionDocument(level);
 const children=doc.blocks[0].columns![0];
 children.splice(children.findIndex(b=>b.text===CIRCLE_PROMOTION_ACCREDITATION),1);
 children.find(b=>b.text===CIRCLE_PROMOTION_INTRO)!.text='Tu membresía CRONOX ya está actualizada. Tu acreditación {{accreditationColor}} está disponible en tu cuenta.';
 for(const b of children)delete b.background;
 doc.blocks[0].background='#0b0b0b';
 return doc;
}
function check(html:string,level:number,expected:number){
 const d=new JSDOM(html).window.document;
 const bullets=[...d.querySelectorAll('td,p,li')].filter(n=>!n.querySelector('td,p,li,table')&&/^•/.test(n.textContent!.trim()));
 expect(bullets).toHaveLength(expected);
 for(const bullet of bullets)expect(bullet.textContent!.replace('•','').trim()).not.toBe('');
 expect(d.body.style.background).toBe('rgb(0, 0, 0)');
 for(const el of d.querySelectorAll<HTMLElement>('[bgcolor],[style]')){
   if(el.tagName==='A')continue;
   if(el.getAttribute('bgcolor'))expect(el.getAttribute('bgcolor')).toBe('#000000');
   if(el.style.backgroundColor)expect(el.style.backgroundColor).toBe('rgb(0, 0, 0)');
 }
 expect(d.body.textContent).toContain(`Enhorabuena por subir al Círculo ${['','','II','III','IV','V'][level]}. Has dado un paso más dentro de CRONOX.`);
 const text=d.body.textContent!;
 expect(text.indexOf('Enhorabuena')).toBeLessThan(text.indexOf('Tus nuevas ventajas'));
 expect(text.indexOf('Tus nuevas ventajas')).toBeLessThan(text.indexOf('Pásate por tu cuenta'));
 expect(text.match(/Pásate por tu cuenta/g)).toHaveLength(1);
 const button=[...d.querySelectorAll('a')].find(a=>a.textContent==='Ver mi acreditación')!;
 expect(button.getAttribute('href')).toBe('https://example.test/cuenta?login=1#accreditation');
 expect(button.style.backgroundColor).toBe('rgb(255, 255, 255)');
 expect(d.querySelector('img[alt="CRONOX"]')).toBeTruthy();
}
describe('published promotion redesign II–V',()=>{
 it.each([[2,1],[3,2],[4,3],[5,3]])('updates circle %s in published sending payload and admin preview with %s real benefits',async(level,expected)=>{
   const document=legacyDocument(level);
   const snapshot={senderKey:'NOREPLY',purpose:'CIRCLE_PROMOTION',publicationCircle:level,folderId:'folder',subject:CIRCLE_PROMOTION_SUBJECT,preheader:'',document,signatureMode:'none'};
   const saved=JSON.stringify(snapshot);
   const db:any={emailPublication:{findUnique:async()=>({version:{snapshot}})},emailTemplateFolder:{findFirst:async()=>({id:'folder',name:`Círculo ${level}`})}};
   const service=new ManagedMailService(db,{} as any);
   const data=circlePromotionData(level-1,level,'https://example.test');
   const rendered=await service.published('NOREPLY' as any,'CIRCLE_PROMOTION',data);check(rendered!.html,level,expected);
   const preview=await service.preview('NOREPLY' as any,{...snapshot,view:'preview'} as any);check(preview.html,level,expected);
   const edit=await service.preview('NOREPLY' as any,{...snapshot,view:'edit'} as any);
   expect(edit.html.match(/Pásate por tu cuenta/g)).toHaveLength(1);expect(edit.html).toContain('CRONOXEDITSTART');
   const transport:any={sendMail:jest.fn(async()=>({accepted:['member@example.test'],messageId:'memory-only'}))};
   await new EmailService(transport,{recipientCircle:async()=>level,published:async()=>rendered} as any).send({type:EmailType.CIRCLE_PROMOTION,to:'member@example.test',subject:CIRCLE_PROMOTION_SUBJECT,templateData:data});
   expect(transport.sendMail.mock.calls[0][1].html).toBe(rendered!.html);
   expect(JSON.stringify(snapshot)).toBe(saved);
   expect(prepareCirclePromotionDocument(prepareCirclePromotionDocument(document))).toEqual(prepareCirclePromotionDocument(document));
   expect(editableDraft(snapshot).document).toEqual(prepareCirclePromotionDocument(document));
 });
 it('removes the entire row and its padding for missing, empty or whitespace-only benefits',()=>{
   const doc=circlePromotionDocument(2);
   for(const absent of [undefined,null,'',' ','\n\t  ']){
     const data:any={...circlePromotionData(1,2,'https://example.test'),circleBenefit2:absent,circleBenefit3:absent,circleBenefit4:absent,circleBenefit5:absent,circleBenefit6:absent};
     check(renderMail(doc,CIRCLE_PROMOTION_SUBJECT,'','CIRCLE_PROMOTION',data).html,2,1);
   }
   const allEmpty:any={...circlePromotionData(1,2,'https://example.test')};
   circleBenefitFields.forEach(f=>allEmpty[f]=' \t ');
   check(renderMail(doc,CIRCLE_PROMOTION_SUBJECT,'','CIRCLE_PROMOTION',allEmpty).html,2,0);
 });
 it('supports imported email HTML and preserves all real benefits, including circle skips',()=>{
   const source=readFileSync(join(__dirname,'../templates/circle-promotion.hbs'),'utf8');
   expect(prepareCirclePromotionHtml(prepareCirclePromotionHtml(source))).toBe(prepareCirclePromotionHtml(source));
   const data={...circlePromotionData(3,4,'https://example.test'),circleBenefit4:' ',circleBenefit5:'',circleBenefit6:undefined};
   check(renderMail({blocks:[{type:'html',html:source}]},CIRCLE_PROMOTION_SUBJECT,'','CIRCLE_PROMOTION',data).html,4,3);
   const skip=circlePromotionData(2,5,'https://example.test');
   const rendered=renderMail(circlePromotionDocument(5),CIRCLE_PROMOTION_SUBJECT,'','CIRCLE_PROMOTION',skip);
   expect(rendered.text).toContain('Acceso anticipado');expect(rendered.text).toContain('Entradas gratis');
   expect(rendered.text).not.toContain('10 %');
 });
 it('does not change the background or conditional behavior of other purposes',()=>{
   const doc={blocks:[{type:'text',text:'• {{name}}',condition:'name',background:'#333333'}]};
   const rendered=renderMail(doc,'Otro','','ORDER_DELIVERED',{name:''});
   expect(rendered.html).toContain('#333333');expect(rendered.html).toContain('•');
 });
 it('repairs legacy imported table rows without empty bullet cells or invalid paragraph nesting',()=>{
   const source='<div style="background:#111111;"><img src="https://example.test/logo.png" alt="CRONOX"><h2>Ya formas parte del Círculo {{circleRoman}}</h2><table><tr><td>Tu membresía CRONOX ya está actualizada. Tu acreditación {{accreditationColor}} está disponible en tu cuenta.</td></tr><tr><td>Tus nuevas ventajas</td></tr><tr><td>• {{circleBenefit1}}</td></tr><tr><td>• {{circleBenefit2}}</td></tr><tr><td><a href="{{actionUrl}}" style="background:#ffffff;">Ver mi acreditación</a></td></tr></table></div>';
   expect(prepareCirclePromotionHtml(prepareCirclePromotionHtml(source))).toBe(prepareCirclePromotionHtml(source));
   const result=renderMail({blocks:[{type:'html',html:source}]},CIRCLE_PROMOTION_SUBJECT,'','CIRCLE_PROMOTION',{...circlePromotionData(1,2,'https://example.test'),circleBenefit2:' \t '});
   check(result.html,2,1);
   const d=new JSDOM(result.html).window.document;
   expect(d.body.textContent!.indexOf('Tus nuevas ventajas')).toBeLessThan(d.body.textContent!.indexOf('Pásate por tu cuenta'));
 });
});
