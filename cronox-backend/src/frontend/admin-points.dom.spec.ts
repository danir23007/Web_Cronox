import { readFileSync } from 'fs';
import { resolve } from 'path';
import { JSDOM } from 'jsdom';

describe('Sale point navigation', () => {
  it('suggests the top ten, predicts without accents and applies an exact product ID with mouse or keyboard', async () => {
    const dom=new JSDOM('<div id="salePointsRoot"></div>',{url:'http://localhost/admin.html#section-sale-points?point=test',runScripts:'outside-only'});
    try {
      const win=dom.window as any,navigate=jest.fn();
      win.HTMLElement.prototype.scrollIntoView=jest.fn();
      win.CRONOX_ADMIN_NAV={navigate};win.CRONOX_FINANCE={DatePicker:class {},drawChart:jest.fn()};
      const amounts={revenueCents:100,costCents:0,profitCents:100,commissionCents:0,fixedExpenseCents:0,unitsSold:1,unitsReturned:0,salesCount:1};
      const products=Array.from({length:12},(_,i)=>({...amounts,productId:i+1,name:i>=10?'Camiséta azul':`Producto ${i+1}`,unitsSold:i+1}));
      const detail={point:{id:'test',name:'Test',archived:false},report:{totals:amounts,products,variants:[],buckets:[],netUnits:1,cronoxCents:100,averageTicketCents:100},sales:[],entries:[]};
      win.fetch=jest.fn(async(path:string)=>({ok:true,json:async()=>path.includes('/options')?[]:detail}));
      win.eval(readFileSync(resolve(__dirname,'../../../cronox-front/assets/admin-points.js'),'utf8'));await win.CRONOX_POINTS.load();
      const field=win.document.querySelector('[data-history-search]');field.focus();
      expect(win.document.querySelectorAll('[role=option]')).toHaveLength(10);
      expect(win.document.querySelector('[role=option]').textContent).toContain('#12');
      field.value='camiseta az';field.dispatchEvent(new win.Event('input'));
      expect(win.document.querySelectorAll('[role=option]')).toHaveLength(2);
      win.document.querySelector('[role=option]').click();
      expect(new URLSearchParams(navigate.mock.calls.at(-1)[0].split('?')[1]).get('productId')).toBe('12');
      field.value='zzzz';field.dispatchEvent(new win.Event('input'));
      expect(win.document.querySelectorAll('[role=option]')).toHaveLength(0);
      field.value='';field.dispatchEvent(new win.Event('input'));field.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowUp'}));
      field.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
      expect(new URLSearchParams(navigate.mock.calls.at(-1)[0].split('?')[1]).get('productId')).toBe('3');
      field.value='';field.dispatchEvent(new win.Event('input'));field.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Enter'}));
      expect(new URLSearchParams(navigate.mock.calls.at(-1)[0].split('?')[1]).has('productId')).toBe(false);
    } finally {dom.window.close();}
  });
  it('keeps point-name search separate from product history search', async () => {
    const dom = new JSDOM('<div id="salePointsRoot"></div>', { url: 'http://localhost/admin.html#section-sale-points', runScripts: 'outside-only' });
    try {
      const navigate = jest.fn();
      const win = dom.window as any;
      win.CRONOX_ADMIN_NAV = { navigate };
      win.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'test-point', name: 'Madrid 2027', city: 'Madrid', venue: '', archived: false, totals: { revenueCents: 50000, costCents: 15000, profitCents: 15000, fixedExpenseCents: 20000, commissionCents: 0, unitsSold: 10, unitsReturned: 0 } }] });
      win.eval(readFileSync(resolve(__dirname, '../../../cronox-front/assets/admin-points.js'), 'utf8'));
      await win.CRONOX_POINTS.load();
      const field = win.document.querySelector('[data-point-search]');
      field.value = 'Madrid'; field.dispatchEvent(new win.Event('input'));
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(win.fetch.mock.calls.at(-1)[0]).toContain('search=Madrid');
      win.document.querySelector('[data-open]').click();
      const params = new URLSearchParams(navigate.mock.calls[0][0].split('?')[1]);
      expect(params.get('point')).toBe('test-point');
      expect(params.get('search')).toBe('');
    } finally { dom.window.close(); }
  });
});
