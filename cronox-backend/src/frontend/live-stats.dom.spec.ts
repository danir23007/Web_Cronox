import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const source=(file:string)=>readFileSync(join(__dirname,'../../../cronox-front/assets',file),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('live stats browser scheduling',()=>{
  it('starts only after consent, pauses hidden tabs, coalesces events and removes consented presence',async()=>{
    const dom=new JSDOM('',{url:'http://localhost/tienda?token=never-send',runScripts:'outside-only'});
    const w=dom.window; let registration:any, hidden=false, callback:any;
    Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    Object.defineProperty(w.navigator,'locks',{value:{request:async(_:string,fn:any)=>fn()}});
    w.setTimeout=((fn:any)=>{callback=fn;return 1;}) as any;w.clearTimeout=jest.fn();
    const fetch=jest.fn().mockResolvedValue({ok:true});
    Object.assign(w,{fetch,CRONOX_API:{getCsrfHeaders:async()=>({'x-csrf-token':'local'})},CRONOX_COOKIE_CONSENT:{registerService:(s:any)=>registration=s}});
    w.eval(source('live-presence.js'));expect(fetch).not.toHaveBeenCalled();
    registration.load();await callback();await flush();expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({section:'store',enabled:true});
    hidden=true;w.document.dispatchEvent(new w.Event('visibilitychange'));await callback();expect(fetch).toHaveBeenCalledTimes(1);
    hidden=false;w.document.dispatchEvent(new w.Event('visibilitychange'));await callback();await flush();expect(fetch).toHaveBeenCalledTimes(2);
    registration.disable();await flush();expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).enabled).toBe(false);
    dom.window.close();
  });
  it('excludes administrative pages',()=>{
    const dom=new JSDOM('',{url:'http://localhost/admin-user.html?id=1',runScripts:'outside-only'});
    const registerService=jest.fn();Object.assign(dom.window,{CRONOX_COOKIE_CONSENT:{registerService}});
    dom.window.eval(source('live-presence.js'));expect(registerService).not.toHaveBeenCalled();dom.window.close();
  });
  it('shares background navigation updates, preserves errors and pauses hidden tabs',async()=>{
    const dom=new JSDOM('<div class="sidebar-live"><button></button><span class="live-activity-description"></span></div><section id="section-live-stats" hidden><p data-live-status></p><p data-live-updated></p><button data-live-refresh></button><div data-live-cards></div><ul data-live-locations></ul><ul data-live-products></ul></section>',{url:'http://localhost/admin.html',runScripts:'outside-only'});
    const w=dom.window,root=w.document.querySelector('section')!;
    let hidden=false;
    Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    const timers=new Map<number,any>();let key=0;
    w.setTimeout=((fn:any)=>{timers.set(++key,fn);return key;}) as any;
    w.clearTimeout=((id:number)=>{timers.delete(id);}) as any;
    const data={at:new Date().toISOString(),visitors:{total:3,signedIn:1,guests:2},carts:{visitors:2,units:3,products:1},checkouts:1,payments:0,purchases:0,locations:[],products:[]};
    const fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>data});Object.assign(w,{fetch});
    w.eval(source('admin-live-stats.js'));await flush();expect(fetch).toHaveBeenCalledTimes(1);
    expect(w.document.querySelector('.sidebar-live')!.getAttribute('data-activity')).toBe('active');
    root.hidden=false;await flush();expect(fetch).toHaveBeenCalledTimes(1);
    w.eval(source('admin-live-stats.js'));expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.live-stat strong')!.textContent).toBe('3');
    fetch.mockRejectedValueOnce(new Error('offline'));(root.querySelector('button') as HTMLButtonElement).click();await flush();
    expect(root.dataset.state).toBe('error');expect(w.document.querySelector('.sidebar-live')!.getAttribute('data-activity')).toBe('unavailable');expect(root.querySelector('.live-stat strong')!.textContent).toBe('3');
    (root.querySelector('button') as HTMLButtonElement).click();await flush();expect(root.dataset.state).toBe('ready');
    hidden=true;w.document.dispatchEvent(new w.Event('visibilitychange'));expect(timers.size).toBe(0);
    hidden=false;w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();expect(root.dataset.state).toBe('ready');
    fetch.mockResolvedValueOnce({ok:true,json:async()=>({...data,visitors:{total:0,signedIn:0,guests:0},carts:{visitors:0,units:0,products:0},checkouts:0,payments:0,purchases:0})});
    (root.querySelector('button') as HTMLButtonElement).click();await flush();expect(root.dataset.state).toBe('empty');expect(w.document.querySelector('.sidebar-live')!.getAttribute('data-activity')).toBe('empty');
    expect(root.querySelector('.live-stat strong')!.textContent).toBe('0');
    root.hidden=true;await flush();expect(timers.size).toBe(1);
    w.dispatchEvent(new w.Event('pagehide'));expect(timers.size).toBe(0);dom.window.close();
  });
});
