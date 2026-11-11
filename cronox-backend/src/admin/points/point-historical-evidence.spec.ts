import { historicalEdition, historicalEditionCost } from './point-historical-evidence';
const at=new Date('2026-10-25');
const edition=(id='one',cost:number|null=1375)=>({id,number:1,openingBalance:true,createdAt:new Date('2026-11-04'),receivedAt:null,profile:{unitCostCents:cost},history:[] as any[]});
describe('historical physical-sale evidence',()=>{
 it('identifies an opening edition before migration and excludes a future receipt',()=>{
  const one=edition(),two={...edition('two'),openingBalance:false,receivedAt:new Date('2026-12-01')};
  expect(historicalEdition([one,two],at)).toBe(one);
  expect(historicalEdition([one,edition('other')],at)).toBeNull();
  expect(historicalEdition([one,two],at,'one')).toBe(one);
  expect(historicalEdition([one,two],at,'missing')).toBeNull();
 });
 it('recovers stable edition cost, including zero, without inventing empty costs',()=>{
  expect(historicalEditionCost(edition(),at,1375)?.cost).toBe(1375);
  expect(historicalEditionCost(edition('one',0),at,0)?.cost).toBe(0);
  expect(historicalEditionCost(edition('one',null),at,null)).toBeNull();
  expect(historicalEditionCost(edition(),at,2620)).toBeNull();
 });
 it('refuses a current cost when later history proves a different prior value',()=>{
  const lot=edition();lot.history=[{id:'changed',createdAt:new Date('2026-11-01'),before:{profile:{unitCostCents:1200}},after:{profile:{unitCostCents:1375}}}];
  expect(historicalEditionCost(lot,at,null)).toBeNull();
  lot.history.unshift({id:'dated',createdAt:new Date('2026-10-01'),before:null,after:{profile:{unitCostCents:1200}}});
  expect(historicalEditionCost(lot,at,null)).toMatchObject({cost:1200,source:'DATED_EDITION_DEFAULT'});
 });
});
