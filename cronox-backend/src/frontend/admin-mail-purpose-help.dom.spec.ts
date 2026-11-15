import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_PURPOSES } from '../email/managed/mail-catalog';
import { MAIL_PURPOSE_HELP } from '../email/managed/mail-purpose-help';

async function workspace(format='html-email'){
 const dom=new JSDOM('<div id="mailFeedback"></div><div id="mailWorkspace"></div>',{url:'http://localhost/admin.html',runScripts:'outside-only'}),win=dom.window as any;
 const row:any={id:'saved',senderKey:'NOREPLY',folderId:'f1',name:'Nombre cambiado',subject:'Asunto cambiado',purpose:'NEWSLETTER_ACCESS',preheader:'',revision:1,signatureMode:'none',document:{format,blocks:[{type:'html',html:'<p>Contenido propio {{message}}</p>'}]}};
 const api=jest.fn(async(path:string,method='GET',body?:any):Promise<any>=>{
  if(!path)return[{key:'NOREPLY',label:'No-reply',counts:{folders:1,templates:1,drafts:1,published:0}}];
  if(path.endsWith('/initialize'))return{};
  if(path.endsWith('/folders'))return[{id:'f1',name:'Círculo 1',_count:{templates:1},counts:{drafts:1,published:0}}];
  if(path.endsWith('/signatures'))return[];
  if(path==='/catalog')return MAIL_PURPOSES.map(p=>({...p,usage:MAIL_PURPOSE_HELP[p.key],variables:[]}));
  if(path.includes('/templates?'))return{items:[row],total:1,page:1,limit:30};
  if(path.endsWith('/preview'))return{html:'<html><head></head><body>Correo independiente</body></html>',subject:body.subject,text:'Correo independiente',warnings:[]};
  if(method!=='GET')throw Error('UNEXPECTED_WRITE');return JSON.parse(JSON.stringify(row));
 });
 Object.assign(win,{CRONOX_API:{admin:{mailRequest:api}},confirm:()=>true});
 for(const file of['admin-mail-document.js','admin-mails.js'])win.eval(readFileSync(join(__dirname,'../../../cronox-front/assets',file),'utf8'));
 const tick=async()=>{await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0))};
 const click=async(selector:string)=>{win.document.querySelector(selector).click();await tick()};
 const field=async(name:string,value:string)=>{const el=win.document.querySelector(`[data-field="${name}"]`);el.value=value;el.dispatchEvent(new win.Event('input',{bubbles:true}));await tick()};
 await win.CRONOX_MAILS.load();await click('[data-mail-action="account"]');await click('[data-mail-action="circle"]');
 return{dom,win,row,api,click,field,tick};
}
describe('purpose information in Edit and Preview',()=>{
 it.each(['html-email','blocks'])('uses the selected purpose, preserves edits across tabs and stays outside the email (%s)',async format=>{
  const t=await workspace(format),original=JSON.stringify(t.row);await t.click('[data-mail-action="edit"]');
  const info=()=>t.win.document.querySelector('[data-mail-purpose-help]');
  expect(info().textContent).toContain(MAIL_PURPOSE_HELP.NEWSLETTER_ACCESS.trigger);
  expect([...info().querySelectorAll('dt')].map((el:any)=>el.textContent)).toEqual(['Para qué sirve','Tipo de envío','Cuándo se envía']);
  const panel=t.win.document.querySelector('.mail-document-workbench');expect(panel.children[0].className).toBe('mail-document-toolbar');expect(panel.children[1]).toBe(info());
  await t.field('subject','Asunto pendiente {{title}}');await t.field('name','Otro nombre');
  await t.click('[data-mail-action="view-preview"]');expect(info().textContent).toContain(MAIL_PURPOSE_HELP.NEWSLETTER_ACCESS.trigger);
  expect(t.win.document.querySelector('.mail-document-note').textContent).toContain('Datos ficticios');
  expect(t.win.document.querySelector('iframe').srcdoc).not.toContain('Para qué sirve');
  await t.click('[data-mail-action="view-edit"]');expect(t.win.document.querySelector('[data-field="subject"]').value).toBe('Asunto pendiente {{title}}');
  await t.field('purpose','PASSWORD_SETUP_EXISTING_ACCOUNT');expect(info().textContent).toContain(MAIL_PURPOSE_HELP.PASSWORD_SETUP_EXISTING_ACCOUNT.trigger);
  expect(t.win.document.querySelector('[data-preview-scenario]')).toBeNull();
  await t.field('purpose','NEWSLETTER_ACCESS');expect(t.win.document.querySelector('[data-preview-scenario]')).not.toBeNull();
  expect(JSON.stringify(t.row)).toBe(original);
  expect(t.api.mock.calls.filter(c=>c[1]!=='GET').every(c=>c[0].endsWith('/initialize')||c[0].endsWith('/preview'))).toBe(true);
  for(const call of t.api.mock.calls.filter(c=>c[0].endsWith('/preview')))expect(JSON.stringify(call[2])).not.toContain('mail-purpose-info');
  t.dom.window.close();
 });
 it('updates immediately on a new unsaved template and explains an unverified legacy purpose',async()=>{
  const t=await workspace();await t.click('[data-mail-action="new"]');
  expect(t.win.document.querySelector('[data-mail-purpose-help]').textContent).toContain('Selecciona una finalidad para ver cuándo se utiliza esta plantilla');
  for(const purpose of MAIL_PURPOSES.filter(p=>p.senderKey==='NOREPLY')){await t.field('purpose',purpose.key);expect(t.win.document.querySelector('[data-mail-purpose-help]').textContent).toContain(MAIL_PURPOSE_HELP[purpose.key].description)}
  const select=t.win.document.querySelector('[data-field="purpose"]');select.insertAdjacentHTML('beforeend','<option value="UNKNOWN_LEGACY">Personalizada</option>');await t.field('purpose','UNKNOWN_LEGACY');
  expect(t.win.document.querySelector('[data-mail-purpose-help]').textContent).toContain('no se ha podido verificar');
  t.dom.window.close();
 });
});
