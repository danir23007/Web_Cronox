import { AdminPointsService } from './admin-points.service';
describe('Point product history filtering',()=>{
  it('uses exact selected IDs, normalizes text, excludes unrelated expenses and leaves totals intact',async()=>{
    const make=(id:number,name:string)=>({id:'line'+id,productId:id,variantId:id,name,size:'M',quantity:1,unitPriceCents:100,unitCostCents:0,commissionCents:0,commissionBp:0,returned:0});
    const a=make(1,'Camiséta azul'),b=make(11,'Camiséta azul');
    const sales=[{id:'a',state:{lines:[a]}},{id:'b',state:{lines:[b]}}];
    const delta=(line:typeof a)=>({productId:line.productId,variantId:line.variantId,name:line.name,size:'M',revenueCents:100,costCents:0,commissionCents:0,unitsSold:1,unitsReturned:0});
    const entries=[{saleId:'a',kind:'SALE',occurredAt:new Date('2026-10-12T12:00Z'),lines:[delta(a)],expenseCents:0},{saleId:'b',kind:'SALE',occurredAt:new Date('2026-10-12T12:00Z'),lines:[delta(b)],expenseCents:0},{kind:'EXPENSE',occurredAt:new Date('2026-10-12T12:00Z'),lines:[],expenseCents:50,description:'Camiséta azul'}];
    const tx={salePoint:{findUnique:async()=>({id:'point'})},pointSale:{findMany:async()=>sales},pointEntry:{findMany:async()=>entries}};
    const service=new AdminPointsService({$transaction:async fn=>fn(tx)} as never);
    const exact=await service.detail('point','2026-10-12','2026-10-12','Camiséta azul',1);
    expect(exact.sales.map(s=>s.id)).toEqual(['a']);expect(exact.entries).toHaveLength(1);
    expect(exact.report.totals.profitCents).toBe(150);
    const text=await service.detail('point','2026-10-12','2026-10-12','camiseta az');expect(text.sales).toHaveLength(2);expect(text.entries).toHaveLength(2);
    const absent=await service.detail('point','2026-10-12','2026-10-12','unknown');expect(absent.sales).toHaveLength(0);
    expect((await service.detail('point','2026-10-12','2026-10-12')).entries).toHaveLength(3);
  });
});
