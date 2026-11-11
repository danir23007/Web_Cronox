import { AdminPointsService } from './admin-points.service';
import type { PointLine } from './point-calculations';
describe('unidentified historical edition',()=>{
 const line:PointLine={id:'legacy',variantId:1,productId:1,name:'Original',size:'M',quantity:1,unitPriceCents:4000,unitCostCents:1375,commissionBp:5000,commissionCents:2000,returned:0};
 const tx={productVariant:{findUnique:jest.fn(async()=>({id:1,productId:1,size:'M',isActive:true,product:{isActive:true,currency:'EUR',lotManaged:true,activeLotId:'new-edition',privateCost:{unitCostCents:9900}}}))},inventoryLot:{findFirst:jest.fn()}};
 const service=new AdminPointsService(null as never);
 const snapshot=(quantity=1,lotId?:string)=>(service as any).snapshot(tx,{lines:[{id:'legacy',variantId:1,quantity,unitPriceCents:4000,commissionBp:5000,lotId}]},[line]);
 it('preserves the legacy cost and does not select the current edition on edit',async()=>{
  const [saved]=await snapshot();expect(saved.unitCostCents).toBe(1375);expect(saved.lotId).toBeUndefined();expect(tx.inventoryLot.findFirst).not.toHaveBeenCalled();
 });
 it('requires a separately identified new line instead of silently changing provenance',async()=>{
  await expect(snapshot(2)).rejects.toThrow('nueva línea');await expect(snapshot(1,'new-edition')).rejects.toThrow('Concilia');
 });
});
