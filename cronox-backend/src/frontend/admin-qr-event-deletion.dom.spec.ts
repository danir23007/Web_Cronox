import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const front=join(__dirname,'../../../cronox-front');
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
const ok=(data:any)=>({ok:true,json:async()=>data});
function setup(canDelete=true,count=1){
  const dom=new JSDOM(readFileSync(join(front,'admin.html'),'utf8'),{runScripts:'outside-only',url:'https://cronox.test/admin.html#section-qr-events'});
  const w=dom.window as any,el=(suffix:string)=>w.document.getElementById('qrEvents'+suffix);
  w.document.getElementById('section-qr-events').hidden=false;
  el('Video').pause=jest.fn();
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  w.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({'X-CSRF-Token':'csrf'})};
  let groups=Array.from({length:count},(_,i)=>({id:String(i+1),name:'Prueba <img id="unsafe-group"> '+(i+1),description:'Descripción',total:i+2}));
  const deletes:any[]=[];
  w.fetch=jest.fn(async(url:string,options:any)=>{
    if(options.method==='DELETE'){deletes.push([url,options]);groups=groups.filter(g=>g.id!==url.split('/').pop());return ok({id:url.split('/').pop(),deleted:true});}
    const query=new URL(url,'https://cronox.test').searchParams,page=Number(query.get('page')||1),limit=25;
    return ok({canDelete,items:groups.slice((page-1)*limit,page*limit),total:groups.length,pages:Math.max(1,Math.ceil(groups.length/limit)),page,limit});
  });
  w.eval(readFileSync(join(front,'assets/admin-qr-events.js'),'utf8'));
  const open=()=>el('List').querySelector('.qr-events-delete').click();
  return {w,el,deletes,open,remove:(id:string)=>{groups=groups.filter(g=>g.id!==id);},close:()=>{w.CRONOX_QR_EVENTS.leave();dom.window.close();}};
}
describe('QR event destructive confirmation',()=>{
  it('keeps open/name/count visible to ADMIN but exposes no delete button',async()=>{
    const t=setup(false);try{await t.w.CRONOX_QR_EVENTS.load();expect(t.el('List').querySelector('.qr-events-delete')).toBeNull();expect(t.el('List').textContent).toContain('Abrir grupo');}finally{t.close();}
  });
  it('identifies the event and participants as text; cancellation performs no write',async()=>{
    const t=setup();try{await t.w.CRONOX_QR_EVENTS.load();t.open();expect(t.el('DeleteDescription').textContent).toContain('Prueba <img');expect(t.el('DeleteCount').textContent).toBe('2 participantes');expect(t.w.document.getElementById('unsafe-group')).toBeNull();t.el('DeleteCancel').click();expect(t.el('DeleteDialog').open).toBe(false);expect(t.deletes).toHaveLength(0);}finally{t.close();}
  });
  it('keeps the card on server failure and supports retry, busy disabling and duplicate click suppression',async()=>{
    const t=setup();try{
      await t.w.CRONOX_QR_EVENTS.load();t.open();t.w.fetch.mockImplementationOnce(async()=>({ok:false,status:500,json:async()=>({})}));
      t.el('DeleteConfirm').click();await flush();expect(t.el('List').children.length).toBe(1);expect(t.el('DeleteError').hidden).toBe(false);
      let resolve:any;const pending=new Promise(done=>{resolve=done;});t.w.fetch.mockImplementationOnce(()=>pending);
      t.el('DeleteConfirm').click();t.el('DeleteConfirm').click();await flush();
      expect(t.el('DeleteConfirm').disabled).toBe(true);expect(t.el('DeleteCancel').disabled).toBe(true);
      const cancel=new t.w.Event('cancel',{cancelable:true});t.el('DeleteDialog').dispatchEvent(cancel);expect(cancel.defaultPrevented).toBe(true);
      expect(t.w.fetch.mock.calls.filter(([,o]:any[])=>o.method==='DELETE')).toHaveLength(2); // failed first request plus one retry
      t.remove('1');resolve(ok({id:'1',deleted:true}));await flush();expect(t.el('DeleteDialog').open).toBe(false);expect(t.el('Message').dataset.state).toBe('success');expect(t.el('List').children.length).toBe(0);
    }finally{t.close();}
  });
  it('removes a confirmed last-page card, clamps pagination and preserves search and CSRF',async()=>{
    const t=setup(true,26);try{
      await t.w.CRONOX_QR_EVENTS.load();t.el('Search').value='Prueba';t.el('Filters').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await flush();
      t.el('Next').click();await flush();expect(t.el('Page').textContent).toContain('Página 2');t.open();t.el('DeleteConfirm').click();await flush();
      expect(t.el('Page').textContent).toContain('Página 1 de 1');expect(t.el('Page').textContent).toContain('25 grupos');expect(t.el('Search').value).toBe('Prueba');
      expect(t.deletes).toHaveLength(1);expect(JSON.parse(t.deletes[0][1].body)).toEqual({confirmed:true});expect(t.deletes[0][1].headers['X-CSRF-Token']).toBe('csrf');
      expect(t.w.fetch.mock.calls.at(-1)[0]).toContain('q=Prueba');expect(t.el('Message').textContent).toContain('eliminado correctamente');
    }finally{t.close();}
  });
  it('never removes a card without an explicit server success',async()=>{
    const t=setup();try{await t.w.CRONOX_QR_EVENTS.load();t.open();t.w.fetch.mockImplementationOnce(async()=>ok({id:'1',deleted:false}));t.el('DeleteConfirm').click();await flush();expect(t.el('List').children.length).toBe(1);expect(t.el('DeleteError').hidden).toBe(false);}finally{t.close();}
  });
  it('ignores a destructive response arriving after leaving the module',async()=>{
    const t=setup();try{await t.w.CRONOX_QR_EVENTS.load();t.open();let resolve:any;t.w.fetch.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));t.el('DeleteConfirm').click();await flush();t.w.CRONOX_QR_EVENTS.leave();resolve(ok({id:'1',deleted:true}));await flush();expect(t.el('DeleteDialog').open).toBe(false);expect(t.el('List').children.length).toBe(0);}finally{t.close();}
  });
});
