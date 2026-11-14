import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('mail account state counters', () => {
  it('shows counters on all circles and fetches them again when returning from a template list', async () => {
    const dom=new JSDOM('<div id="mailFeedback"></div><div id="mailWorkspace"></div>',{url:'http://localhost/admin.html',runScripts:'outside-only'}),win=dom.window as any;
    let published=1;
    const api=jest.fn(async(path:string)=>{
      if(!path)return[{key:'SUPPORT',label:'Soporte',counts:{folders:5,templates:2,drafts:2-published,published}}];
      if(path.endsWith('/folders'))return Array.from({length:5},(_,i)=>({id:'f'+i,name:'Círculo '+(i+1),_count:{templates:i?0:2},counts:{drafts:i?0:2-published,published:i?0:published}}));
      if(path.includes('/templates?'))return{items:[],total:0,page:1,limit:30};
      if(path.endsWith('/initialize'))return{};
      return[];
    });
    Object.assign(win,{CRONOX_MAIL_DOCUMENT:{},CRONOX_API:{admin:{mailRequest:api}}});
    win.eval(readFileSync(join(__dirname,'../../../cronox-front/assets/admin-mails.js'),'utf8'));
    const click=async(selector:string)=>{win.document.querySelector(selector).click();await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0))};
    await win.CRONOX_MAILS.load();await click('[data-mail-action="account"]');
    expect(win.document.querySelectorAll('.mail-circle-nav-card .mail-account-counts')).toHaveLength(5);
    expect(win.document.querySelector('.mail-circle-nav-card').textContent).toContain('1 publicada');
    expect(win.document.querySelectorAll('.mail-circle-nav-card')[1].textContent).toContain('0 borradores');
    await click('[data-mail-action="circle"]');published=0;await click('[data-mail-action="circles"]');
    expect(win.document.querySelector('.mail-circle-nav-card').textContent).toContain('2 borradores');
    expect(win.document.querySelector('.mail-circle-nav-card').textContent).toContain('0 publicadas');
    expect(api.mock.calls.filter(call=>call[0]?.endsWith('/folders'))).toHaveLength(2);
    dom.window.close();
  });
  it('renders all four accounts, including empty and singular counts, and reloads counts on return', async () => {
    const dom = new JSDOM('<div id="mailFeedback"></div><div id="mailWorkspace"></div>', {url:'http://localhost/admin.html',runScripts:'outside-only'});
    const win=dom.window as any;
    let counts=[{drafts:30,published:5},{drafts:1,published:1},{drafts:0,published:0},{drafts:3,published:0}];
    const api=jest.fn(async()=>['Soporte','Pedidos','No-reply','Información y novedades'].map((label,i)=>({key:String(i),label,counts:{...counts[i],folders:5,templates:counts[i].drafts+counts[i].published}})));
    Object.assign(win,{CRONOX_MAIL_DOCUMENT:{},CRONOX_API:{admin:{mailRequest:api}}});
    win.eval(readFileSync(join(__dirname,'../../../cronox-front/assets/admin-mails.js'),'utf8'));
    await win.CRONOX_MAILS.load();
    const cards=()=>[...win.document.querySelectorAll('.mail-account-card')];
    expect(cards()).toHaveLength(4);
    expect(cards()[0].querySelector('.is-draft').textContent).toBe('30 borradores');
    expect(cards()[0].querySelector('.is-published').textContent).toBe('5 publicadas');
    expect(cards()[1].textContent).toContain('1 borrador');expect(cards()[1].textContent).toContain('1 publicada');
    expect(cards()[2].textContent).toContain('0 borradores');expect(cards()[2].textContent).toContain('0 publicadas');
    for(const card of cards())expect(card.textContent).toContain('5 círculos');
    // A published card with a later draft stays published; withdrawing it,
    // archiving a draft and restoring it affect the next account response.
    for(const next of [{drafts:29,published:6},{drafts:30,published:5},{drafts:29,published:5},{drafts:30,published:5}]){
      counts=[next,...counts.slice(1)];await win.CRONOX_MAILS.load();
      expect(cards()[0].querySelector('.is-draft').textContent).toBe(`${next.drafts} borradores`);
      expect(cards()[0].querySelector('.is-published').textContent).toBe(`${next.published} publicadas`);
      expect(cards()[0].textContent).toContain(`${next.drafts+next.published} plantillas`);
    }
    expect(api).toHaveBeenCalledTimes(5);expect(api).toHaveBeenLastCalledWith('', 'GET', undefined);
    dom.window.close();
  });
});
