import { calculatePoints, lineDelta, PointLine, LedgerEntry } from './point-calculations';
const make=(id:string,cost:number|null,quantity=1):PointLine=>({id,variantId:1,productId:1,name:'SCARRED TEE - red',size:'L',quantity,unitPriceCents:4000,unitCostCents:cost,commissionBp:5000,commissionCents:quantity*2000,returned:0});
const entry=(lines:ReturnType<typeof lineDelta>[],kind='SALE',expenseCents=0)=>({kind,expenseCents,occurredAt:new Date('2026-11-10T12:00:00Z'),lines});
const report=(entries:LedgerEntry[])=>calculatePoints(entries,'2026-11-10','2026-11-10');
describe('known and pending point costs',()=>{
 it('keeps the 40/13.75/20 control and reconciles it with buckets and products',()=>{
  const r=report([entry([lineDelta(make('known',1375))])]);
  for(const value of [r.totals,r.buckets[0],r.products[0],r.variants[0]])expect(value).toMatchObject({revenueCents:4000,costCents:1375,profitCents:625,pendingCostUnits:0});
 });
 it('preserves partial evidence and charges fixed expenses once, without pricing unknown units as zero',()=>{
  const r=report([entry([lineDelta(make('known',1375)),lineDelta(make('unknown',null,8))]),entry([],'EXPENSE',100)]);
  expect(r.totals).toMatchObject({costCents:null,profitCents:null,knownCostCents:1375,knownProfitCents:525,pendingCostUnits:8});
  expect(r.products[0].knownProfitCents).toBe(625);expect(r.buckets[0].knownProfitCents).toBe(525);
 });
 it('cancels unknown corrections by line identity without masking other pending sales',()=>{
  const a=make('a',null),b=make('b',null);
  expect(report([entry([lineDelta(a),lineDelta(a,-1)])]).totals).toMatchObject({costCents:0,profitCents:0,pendingCostUnits:0});
  expect(report([entry([lineDelta(a),lineDelta(b,-1)])]).totals.pendingCostUnits).toBe(2);
 });
 it('counts explicit zero as a known cost',()=>{
  expect(report([entry([lineDelta(make('zero',0)),lineDelta(make('pending',null))])]).totals).toMatchObject({knownCostUnits:1,knownCostCents:0,knownProfitCents:2000,pendingCostUnits:1});
 });
 it('matches old immutable entries without line IDs to current compensating entries',()=>{
  const line=make('legacy',null);line.lotCosts=[{lotId:'lot',sliceId:'historical:legacy',quantity:1,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN'}];
  const original=lineDelta(line);delete original.lineId;
  const r=report([{...entry([original]),saleId:'same-sale'},{...entry([lineDelta(line,-1)],'CORRECTION'),saleId:'same-sale'}]);
  expect(r.totals).toMatchObject({costCents:0,profitCents:0,pendingCostUnits:0});
 });
});
