import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read=(file:string)=>readFileSync(join(__dirname,'../../../cronox-front/assets',file),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const opened:JSDOM[]=[];
afterEach(()=>{opened.splice(0).forEach(dom=>dom.window.close());});
function setup(){
  const dom=new JSDOM('<button id="origin">Avisarme</button>',{url:'http://localhost/',runScripts:'outside-only'});opened.push(dom);
  const w=dom.window as any;
  w.CSS={escape:(s:string)=>s};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.eval(read('api.js'));w.CRONOX_AUTH_READY=Promise.resolve();w.CRONOX_USER={id:1};
  let latest={slug:'fixture',name:'Producto',variants:[{id:11,size:'M',stockQty:0,isActive:true},{id:12,size:'L',stockQty:0,isActive:true}]};
  w.CRONOX_API.getProductBySlug=jest.fn(async()=>latest);w.CRONOX_API.getCsrfHeaders=async()=>({});
  const post=jest.fn(async(_method:string)=>({ok:true,json:async()=>({subscription:{id:'request',status:'WAITING'},existing:false})}));
  w.fetch=jest.fn(async(_url:string,options:any)=>options.method==='GET'?{ok:true,json:async()=>({subscription:null})}:post(options.method));
  w.eval(read('waitlist.js'));
  return {w,document:dom.window.document,post,product:latest,setLatest:(p:typeof latest)=>{latest=p;}};
}
describe('shared immediate restock selector',()=>{
  it('opens read-only and submits once on size selection, retaining confirmed feedback',async()=>{
    const {w,document,post,product}=setup();await w.CRONOX_WAITLIST.open(product);
    expect(post).not.toHaveBeenCalled();
    let finish:any;post.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}) as any);
    const size=document.querySelector<HTMLButtonElement>('[data-restock-size=M]')!;
    size.click();size.click();await tick();
    expect(post).toHaveBeenCalledTimes(1);expect(size.disabled).toBe(true);
    expect(document.querySelector('[data-restock-status]')!.textContent).toBe('Guardando aviso…');
    finish({ok:true,json:async()=>({subscription:{status:'WAITING'},existing:false})});await tick();
    expect(document.querySelector('[data-restock-status]')!.textContent).toBe('Te avisaremos cuando vuelva la talla M');
    expect(size.getAttribute('aria-pressed')).toBe('true');
    document.querySelector<HTMLButtonElement>('[data-restock-size=L]')!.click();await tick();expect(post).toHaveBeenCalledTimes(2);
  });
  it('keeps the size on a server error, retries, and preserves cancellation of a saved request',async()=>{
    const {w,document,post,product}=setup();await w.CRONOX_WAITLIST.open(product);
    post.mockResolvedValueOnce({ok:false,status:500,json:async()=>({message:'internal'})} as any);
    document.querySelector<HTMLButtonElement>('[data-restock-size=M]')!.click();await tick();
    expect(document.querySelector('[data-restock-size=M]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-restock-status]')!.textContent).toContain('No se pudo guardar');
    document.querySelector<HTMLButtonElement>('[data-restock-retry]')!.click();await tick();
    expect(document.querySelector('[data-restock-status]')!.textContent).toContain('Te avisaremos');
    document.querySelector<HTMLButtonElement>('[data-restock-cancel]')!.click();await tick();
    expect(post).toHaveBeenLastCalledWith('DELETE');expect(document.querySelector('[data-restock-status]')!.textContent).toBe('Aviso cancelado.');
  });
  it('remembers guest intent and resumes only after authentication, without asking for email again',async()=>{
    const {w,document,post,product}=setup();w.CRONOX_USER=null;w.CRONOX_openAuthModal=jest.fn(async()=>{});
    await w.CRONOX_WAITLIST.open(product);document.querySelector<HTMLButtonElement>('[data-restock-size=M]')!.click();await tick();
    expect(post).not.toHaveBeenCalled();expect(w.CRONOX_openAuthModal).toHaveBeenCalledWith('login');
    w.CRONOX_USER={id:1};w.dispatchEvent(new w.CustomEvent('cronox:userChanged'));await tick();await tick();
    expect(post).toHaveBeenCalledTimes(1);expect(document.querySelector('[data-restock-status]')!.textContent).toContain('talla M');
    expect(w.sessionStorage.getItem('cronox.restock.intent')).toBeNull();
  });
  it('offers buying after a restock without silently subscribing to another size',async()=>{
    const {w,document,post,product,setLatest}=setup();await w.CRONOX_WAITLIST.open(product);
    setLatest({...product,variants:product.variants.map(v=>({...v,stockQty:v.size==='M'?1:0}))});
    document.querySelector<HTMLButtonElement>('[data-restock-size=M]')!.click();await tick();
    expect(post).not.toHaveBeenCalled();expect(document.querySelector<HTMLAnchorElement>('[data-restock-buy]')!.href).toContain('size=M');
    expect(document.querySelector('[data-restock-status]')!.textContent).toContain('ya está disponible');
  });
  it('refreshes an incompatible size list without remapping the previous selection',async()=>{
    const {w,document,post,product,setLatest}=setup();await w.CRONOX_WAITLIST.open(product);
    setLatest({...product,variants:[{id:22,size:'US_8',stockQty:0,isActive:true}]});
    document.querySelector<HTMLButtonElement>('[data-restock-size=M]')!.click();await tick();
    expect(post).not.toHaveBeenCalled();expect(document.querySelector('[data-restock-size=M]')).toBeNull();
    expect(document.querySelectorAll('[data-restock-size][aria-pressed=true]')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-restock-size=US_8]')!.click();await tick();
    expect(w.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/waitlist/22'),expect.objectContaining({method:'POST'}));
  });
});
