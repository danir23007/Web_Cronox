import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('partial physical-sale costs in the financial graph',()=>{
 it('labels the calculable amount as partial and draws a gap for wholly unknown profit',()=>{
  const dom=new JSDOM('<div id="chart"></div>',{runScripts:'outside-only'});
  try{
   dom.window.eval(readFileSync(join(__dirname,'../../../cronox-front/assets/admin-finance.js'),'utf8'));
   const api=(dom.window as any).CRONOX_FINANCE,money=(n:number|null)=>n===null?'No disponible':String(n);
   const known={date:'2026-11-10',revenueCents:41000,costCents:null,profitCents:null,knownCostCents:1375,knownProfitCents:625,knownCostUnits:1,pendingCostUnits:8};
   const unknown={...known,date:'2026-11-11',knownCostCents:0,knownProfitCents:0,knownCostUnits:0,pendingCostUnits:9};
   expect(api.costMoney(known,'profitCents',money)).toContain('625 · parcial (8 unidades');
   expect(api.costMoney(unknown,'profitCents',money)).toBe('Pendiente (9 unidades con coste pendiente)');
   api.drawChart(dom.window.document.getElementById('chart'),{buckets:[known,unknown]},money);
   const paths=dom.window.document.querySelectorAll('path[stroke="#3e72ed"]');
   expect(paths[0].getAttribute('d')).toBe(' ');
   expect(paths[1].getAttribute('stroke-dasharray')).toBe('5 4');
   expect(dom.window.document.querySelectorAll('circle')).toHaveLength(1);
  }finally{dom.window.close();}
 });
});
