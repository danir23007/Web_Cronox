import { adjustedPointParts, pricePointParts } from './point-lot-costs';
import { frozenCost, FrozenLotCost } from '../../inventory-lots/lot-costs';
const part=(overrides:Partial<FrozenLotCost>={}):FrozenLotCost=>({lotId:'one',sliceId:'slice',quantity:1,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN',...overrides});
const lot=(cost:number|null)=>({id:'one',profile:{unitCostCents:cost},costQuality:'UNKNOWN',slices:[] as any[]});
describe('physical sale costs of the chosen edition',()=>{
 it('uses inclusive edition defaults only for blank units, including deliberate zero',()=>{
  expect(frozenCost(pricePointParts([part()],lot(1375)))).toBe(1375);
  expect(frozenCost(pricePointParts([part()],lot(0)))).toBe(0);
  expect(frozenCost(pricePointParts([part()],lot(null)))).toBeNull();
  expect(frozenCost(pricePointParts([part({lotId:'another'})],lot(1375)))).toBeNull();
 });
 it('respects receipt costs and keeps an incomplete receipt pending',()=>{
  expect(frozenCost(pricePointParts([part({productionCents:1200,freightCents:100,otherCents:75})],lot(2200)))).toBe(1375);
  expect(frozenCost(pricePointParts([part({productionCents:1200,freightCents:0})],lot(2200)))).toBeNull();
 });
 it('values already-adjusted zero stock from a uniform receipt without claiming inventory',()=>{
  const value=lot(2200);value.slices=[{id:'receipt',variantId:1,received:3,available:0,productionCents:1200,freightCents:100,otherCents:75}];
  const result=adjustedPointParts(value,1,2,'line');expect(frozenCost(result)).toBe(2750);expect(result[0].sliceId).toBe('historical:line');
  value.slices.push({...value.slices[0],id:'other',productionCents:2000});
  expect(frozenCost(adjustedPointParts(value,1,1,'line'))).toBeNull();
 });
});
