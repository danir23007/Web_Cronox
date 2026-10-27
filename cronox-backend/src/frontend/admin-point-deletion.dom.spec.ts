import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
const ok=(body:any)=>({ok:true,json:async()=>body});
function setup(canDelete=true,count=1,mode='archive'){
  const dom=new JSDOM('<div id="salePointsRoot"></div>',{runScripts:'outside-only',url:'https://cronox.test/admin.html#section-sale-points'}),w=dom.window as any;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({'X-CSRF-Token':'test'})};
  let points=Array.from({length:count},(_,i)=>({id:String(i+1),name:'Prueba <img id="unsafe-point"> '+(i+1),city:'Bilbao',provinceId:'48',venue:'Recinto',revision:1,canDelete,totals:{unitsSold:2,unitsReturned:1,revenueCents:1000,costCents:200,commissionCents:100,fixedExpenseCents:500,profitCents:200}}));
  const writes:any[]=[];
  w.fetch=jest.fn(async(url:string,options:any={})=>{
    if(url.includes('/territories'))return ok([{id:'48',name:'Bizkaia',regionId:'16'}]);
    if(url.endsWith('/deletion-preview')){const id=url.split('/').at(-2);return ok({point:points.find(p=>p.id===id),mode,operationsCount:mode==='archive'?3:0,salesCount:mode==='archive'?1:0});}
    if(options.method==='DELETE'){writes.push([url,options]);points=points.filter(p=>p.id!==url.split('/').pop());return ok({id:url.split('/').pop(),deleted:true,mode});}
    return ok(points);
  });
  w.eval(readFileSync(join(__dirname,'../../../cronox-front/assets/admin-points.js'),'utf8'));
  const $=(s:string)=>w.document.querySelector(s),open=async()=>{$('[data-delete]').click();await flush();};
  return {w,$,open,writes,remove:(id:string)=>{points=points.filter(p=>p.id!==id);},close:()=>dom.window.close()};
}
describe('Sale point removal confirmation',()=>{
  it('hides destructive actions from ADMIN while keeping point details visible',async()=>{
    const t=setup(false);try{await t.w.CRONOX_POINTS.load();expect(t.$('[data-delete]')).toBeNull();expect(t.$('[data-open]')).not.toBeNull();}finally{t.close();}
  });
  it.each(['archive','delete'])('explains %s scope, safely displays identity and cancellation sends no write',async mode=>{
    const t=setup(true,1,mode);try{await t.w.CRONOX_POINTS.load();await t.open();expect(t.$('dialog').textContent).toContain('Prueba <img');expect(t.$('#unsafe-point')).toBeNull();expect(t.$('dialog').textContent).toContain('Bizkaia');expect(t.$('dialog').textContent).toContain(mode==='archive'?'3 operaciones':'0 operaciones');expect(t.$('dialog').textContent).toContain(mode==='archive'?'No se devolverán prendas':'definitivamente');t.$('[data-removal-cancel]').click();expect(t.$('dialog')).toBeNull();expect(t.writes).toHaveLength(0);}finally{t.close();}
  });
  it('retains the card on error, suppresses duplicate submissions, blocks Escape while busy and broadcasts only confirmed success',async()=>{
    const t=setup();try{await t.w.CRONOX_POINTS.load();await t.open();t.w.fetch.mockImplementationOnce(async()=>({ok:false,status:409,json:async()=>({message:'El historial ha cambiado'})}));t.$('[data-removal-confirm]').click();await flush();expect(t.$('[data-point-card]')).not.toBeNull();expect(t.$('[data-removal-error]').textContent).toContain('historial ha cambiado');expect(t.w.localStorage.getItem('cronox:statistics-revision')).toBeNull();
      let resolve:any;t.w.fetch.mockImplementationOnce(()=>new Promise(done=>resolve=done));const confirm=t.$('[data-removal-confirm]');confirm.click();confirm.click();await flush();expect(confirm.disabled).toBe(true);expect(t.$('[data-removal-cancel]').disabled).toBe(true);const cancel=new t.w.Event('cancel',{cancelable:true});t.$('dialog').dispatchEvent(cancel);expect(cancel.defaultPrevented).toBe(true);expect(t.w.fetch.mock.calls.filter(([,o]:any[])=>o?.method==='DELETE')).toHaveLength(2);
      t.remove('1');resolve(ok({id:'1',deleted:true,mode:'archive'}));await flush();expect(t.$('dialog')).toBeNull();expect(t.$('[data-point-card]')).toBeNull();expect(t.$('[data-delete-notice]').textContent).toContain('historial');expect(t.w.localStorage.getItem('cronox:statistics-revision')).not.toBeNull();
    }finally{t.close();}
  });
  it('clamps an emptied last page, retains search and sends the reviewed mode/revision with CSRF',async()=>{
    const t=setup(true,26,'delete');try{await t.w.CRONOX_POINTS.load();const field=t.$('[data-point-search]');field.value='Prueba';field.dispatchEvent(new t.w.Event('input'));await new Promise(r=>setTimeout(r,400));expect(t.w.document.querySelectorAll('[data-point-card]')).toHaveLength(25);t.$('[data-list-next]').click();expect(t.w.document.querySelectorAll('[data-point-card]')).toHaveLength(1);await t.open();t.$('[data-removal-confirm]').click();await flush();expect(t.w.document.querySelectorAll('[data-point-card]')).toHaveLength(25);expect(t.$('[data-list-next]').disabled).toBe(true);expect(t.$('[data-point-search]').value).toBe('Prueba');expect(JSON.parse(t.writes[0][1].body)).toEqual({confirmed:true,mode:'delete',revision:1});expect(t.writes[0][1].headers['X-CSRF-Token']).toBe('test');expect(t.w.fetch.mock.calls.at(-1)[0]).toContain('search=Prueba');}finally{t.close();}
  });
});
