import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const source=(file:string)=>readFileSync(join(__dirname,'../../../cronox-front/assets',file),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

describe('live stats browser scheduling',()=>{
  const visitor = (state='anonymous', role?:string) => {
    jest.useFakeTimers();
    const dom=new JSDOM('',{url:'http://localhost/tienda?token=never-send',runScripts:'outside-only'}),w=dom.window as any;
    let hidden=false;
    Object.defineProperty(w.document,'hidden',{get:()=>hidden});
    Object.defineProperty(w.navigator,'locks',{configurable:true,value:{request:async(_:string,fn:any)=>fn()}});
    const fetch=jest.fn().mockResolvedValue({ok:true});
    Object.assign(w,{Date,fetch,CRONOX_AUTH_STATE:state,CRONOX_USER:role?{id:7,role}:null,CRONOX_API:{getCsrfHeaders:async()=>({'x-csrf-token':'local'})}});
    return {w,fetch,start:()=>w.eval(source('live-presence.js')),hide:(value:boolean)=>{hidden=value;w.document.dispatchEvent(new w.Event('visibilitychange'));},close:()=>{w.dispatchEvent(new w.Event('pagehide'));dom.window.close();jest.clearAllTimers();jest.useRealTimers();}};
  };
  it('starts without consent, coalesces events and resumes after visibility changes',async()=>{
    const v=visitor();try {
      v.start();await jest.advanceTimersByTimeAsync(0);expect(v.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(v.fetch.mock.calls[0][1].body)).toEqual({section:'store',enabled:true});
      v.start();for(let i=0;i<8;i++)v.w.dispatchEvent(new v.w.Event('hashchange'));
      await jest.advanceTimersByTimeAsync(5100);expect(v.fetch).toHaveBeenCalledTimes(2);
      v.hide(true);await jest.advanceTimersByTimeAsync(60000);expect(v.fetch).toHaveBeenCalledTimes(2);
      v.hide(false);await jest.advanceTimersByTimeAsync(0);expect(v.fetch).toHaveBeenCalledTimes(3);
    }finally{v.close();}
  });
  it.each(['anonymous','ADMIN','SUPERADMIN'])('waits for unknown authentication and then resolves %s',async role=>{
    const v=visitor('unknown');let resolve:any;
    v.w.CRONOX_AUTH_READY=new Promise(r=>resolve=r);
    try {
      v.start();await jest.advanceTimersByTimeAsync(0);expect(v.fetch).not.toHaveBeenCalled();
      v.w.CRONOX_AUTH_STATE=role==='anonymous'?'anonymous':'authenticated';v.w.CRONOX_USER=role==='anonymous'?null:{id:7,role};resolve();
      await jest.advanceTimersByTimeAsync(0);expect(v.fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(v.fetch.mock.calls[0][1].body).enabled).toBe(role==='anonymous');
    }finally{v.close();}
  });
  it('checks identity again after CSRF awaits and never posts a stale guest signal',async()=>{
    const v=visitor();let resolve:any;
    v.w.CRONOX_API.getCsrfHeaders=()=>new Promise(r=>resolve=r);
    try {
      v.start();await jest.advanceTimersByTimeAsync(0);
      v.w.CRONOX_AUTH_STATE='authenticated';v.w.CRONOX_USER={id:7,role:'ADMIN'};
      v.w.dispatchEvent(new v.w.Event('cronox:userChanged'));resolve({'x-csrf-token':'local'});
      await jest.advanceTimersByTimeAsync(0);expect(v.fetch).not.toHaveBeenCalled();
      v.w.CRONOX_API.getCsrfHeaders=async()=>({'x-csrf-token':'local'});resolve({'x-csrf-token':'local'});
      await jest.advanceTimersByTimeAsync(5000);
      expect(v.fetch.mock.calls.every((call:any)=>JSON.parse(call[1].body).enabled===false)).toBe(true);
    }finally{v.close();}
  });
  it('retries HTTP failures and unresolved authentication without navigation',async()=>{
    const v=visitor('unknown');
    v.w.CRONOX_refreshAuthState=jest.fn(async()=>{});
    try {
      v.start();await jest.advanceTimersByTimeAsync(0);expect(v.fetch).not.toHaveBeenCalled();
      v.w.CRONOX_AUTH_STATE='anonymous';v.fetch.mockResolvedValueOnce({ok:false,status:503});
      await jest.advanceTimersByTimeAsync(5000);expect(v.fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(5000);expect(v.fetch).toHaveBeenCalledTimes(2);
    }finally{v.close();}
  });
  it('does not remain permanently pending if the initial auth promise stalls',async()=>{
    const v=visitor('unknown');v.w.CRONOX_AUTH_READY=new Promise(()=>{});
    try {
      v.start();await jest.advanceTimersByTimeAsync(10000);expect(v.fetch).not.toHaveBeenCalled();
      v.w.CRONOX_AUTH_STATE='anonymous';await jest.advanceTimersByTimeAsync(5000);
      expect(v.fetch).toHaveBeenCalledTimes(1);
    }finally{v.close();}
  });
  it('retries a failed leased heartbeat on browsers without Web Locks',async()=>{
    const v=visitor();Object.defineProperty(v.w.navigator,'locks',{value:undefined});
    try {
      v.fetch.mockResolvedValueOnce({ok:false,status:503});v.start();
      await jest.advanceTimersByTimeAsync(60);expect(v.fetch).toHaveBeenCalledTimes(1);
      expect(v.w.localStorage.getItem('cronox_live_lease')).toBeNull();
      await jest.advanceTimersByTimeAsync(5060);expect(v.fetch).toHaveBeenCalledTimes(2);
    }finally{v.close();}
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
