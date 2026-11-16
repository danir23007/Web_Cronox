import { applyOrderHistoricalCosts } from './order-historical-cost';
import { FinanceOrder, calculateFinance } from './financial-calculations';
import { AdminFinanceService } from './admin-finance.service';
import { FinanceQuery } from './admin-finance.controller';
import { mapOrderAmounts } from '../map/admin-map.service';
import { freezeOrderLots, freezeCheckoutLots } from '../../inventory-lots/lot-financial';

const at = new Date('2026-11-16T19:53:00Z');
function fixture(cost: number | null = 1375) {
  const part = { lotId:'original',sliceId:'opening-M',quantity:1,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN' };
  const order: FinanceOrder = { id:901,status:'PAID',currency:'EUR',providerRef:null,source:'IN_PERSON_ADMIN',paidAt:null,purchasedAt:at,createdAt:at,voidedAt:null,total:'30.00',shippingCost:0,discountCents:0,disputeLostCents:0,stockMovements:[],items:[{id:902,productId:903,variantId:904,title:'Original (M)',quantity:1,lineTotal:'30.00',financialSnapshot:{unitCostCents:null,productName:'Original',imageUrl:null,lotCosts:[part]}}] };
  const lot: any = {id:'original',number:1,openingBalance:true,createdAt:new Date('2026-11-04'),receivedAt:null,costQuality:'UNKNOWN',profile:{unitCostCents:cost},history:[{id:'dated-evidence',createdAt:new Date('2026-11-04T03:15:00Z'),before:{profile:{unitCostCents:cost}},after:{profile:{unitCostCents:cost}}}],slices:[{id:'opening-M',variantId:904,received:9,available:6,productionCents:null,freightCents:null,otherCents:null}]};
  const db: any = { inventoryLot:{findMany:jest.fn(async()=>[lot])} };
  return {order,lot,part,db};
}
const report = (order: FinanceOrder) => calculateFinance([order],[],'2026-10-18','2026-11-16','days');

describe('orders with empty opening allocation costs',()=>{
  it('recovers the dated original edition cost in Finance and Map without changing history; repeated reads agree',async()=>{
    const f=fixture(),before=JSON.stringify(f.order);
    expect(report(f.order).totals).toMatchObject({revenueCents:3000,costCents:null,profitCents:null,unitsSold:1});
    const projected=await applyOrderHistoricalCosts(f.db,f.order);
    expect(report(projected).totals).toMatchObject({revenueCents:3000,costCents:1375,profitCents:1625,unitsSold:1,unitsReturned:0});
    expect(mapOrderAmounts(projected,[],'2026-10-18','2026-11-16')).toMatchObject({amount:{orders:1,units:1,revenueCents:3000,costCents:1375,profitCents:1625}});
    expect(await applyOrderHistoricalCosts(f.db,projected)).toEqual(projected);
    expect(JSON.stringify(f.order)).toBe(before);
    expect(projected.items[0].financialSnapshot?.lotCosts?.[0]).toMatchObject({lotId:'original',sliceId:'opening-M',costSource:'DATED_EDITION_DEFAULT',evidenceIds:['dated-evidence']});
  });
  it('uses the shared projection through the archived Finance service',async()=>{
    const f=fixture();
    Object.assign(f.db,{pointSale:{findMany:async()=>[]},pointEntry:{findMany:async()=>[]},salePoint:{findMany:async()=>[]},financeArchive:{findMany:async({where,select}:any)=>select?[{currency:'EUR'}]:where.orderId.gt===0?[{orderId:901,snapshot:f.order}]:[]},financeEventArchive:{findMany:async()=>[]},financeStockArchive:{findMany:async()=>[]}});
    const service=new AdminFinanceService({$transaction:(work:any)=>work(f.db)} as any);
    const r=await service.getReport(Object.assign(new FinanceQuery(),{from:'2026-10-18',to:'2026-11-16'}));
    expect(r.totals).toMatchObject({revenueCents:3000,costCents:1375,profitCents:1625,unitsSold:1});expect(r.salesCount).toBe(1);expect(r.warnings).toEqual([]);
  });
  it('keeps the original dated cost after a different edition is active and the original profile is changed',async()=>{
    const f=fixture();f.lot.profile.unitCostCents=9900;
    f.lot.history.push({id:'later-edit',createdAt:new Date('2026-11-17'),before:{profile:{unitCostCents:1375}},after:{profile:{unitCostCents:9900}}});
    f.db.inventoryLot.findMany.mockResolvedValue([f.lot,{...f.lot,id:'active-other',profile:{unitCostCents:7000}}]);
    expect(report(await applyOrderHistoricalCosts(f.db,f.order)).totals.costCents).toBe(1375);
    expect(f.db.inventoryLot.findMany).toHaveBeenCalledWith({where:{id:{in:['original']}},include:{history:true,slices:true}});
  });
  it('leaves a genuinely unknown cost unavailable with the operation, variant and edition identified',async()=>{
    const f=fixture(null),r=report(await applyOrderHistoricalCosts(f.db,f.order));
    expect(r.totals).toMatchObject({revenueCents:3000,costCents:null,profitCents:null,unitsSold:1});
    expect(r.warnings.join(' ')).toMatch(/Pedido #901.*línea #902.*producto #903.*variante #904.*original/);
  });
  it('does not replace incomplete or estimated receipts, missing quantities, or known frozen costs',async()=>{
    const f=fixture();f.part.productionCents=1200 as any;
    expect(report(await applyOrderHistoricalCosts(f.db,f.order)).totals.costCents).toBeNull();
    f.part.productionCents=null;f.part.quality='ESTIMATED';
    expect(report(await applyOrderHistoricalCosts(f.db,f.order)).totals.costCents).toBeNull();
    f.part.quality='UNKNOWN';f.part.quantity=2;
    expect(report(await applyOrderHistoricalCosts(f.db,f.order)).totals.costCents).toBeNull();
    Object.assign(f.part,{quantity:1,quality:'CONFIRMED',productionCents:777,freightCents:0,otherCents:0});
    expect(report(await applyOrderHistoricalCosts(f.db,f.order)).totals.costCents).toBe(777);
  });
  it('reverses the recovered original cost on a documented restock, once',async()=>{
    const f=fixture();f.order.voidedAt=new Date('2026-11-16T21:00:00Z');f.order.stockMovements=[{variantId:904,delta:1,reason:'manual_sale_void',createdAt:f.order.voidedAt}];
    const r=report(await applyOrderHistoricalCosts(f.db,f.order));
    expect(r.totals).toEqual({revenueCents:0,costCents:0,profitCents:0,unitsSold:1,unitsReturned:1});
  });
  it.each(['order','checkout'])('freezes accredited cost on a new %s before an empty allocation can erase it',async kind=>{
    const f=fixture();Object.assign(f.db,{$queryRaw:jest.fn().mockResolvedValueOnce([{managed:true}]).mockResolvedValueOnce([f.part]),orderItem:{findMany:async()=>f.order.items},checkoutSnapshotItem:{findMany:async()=>f.order.items},orderItemFinancial:{update:jest.fn()},checkoutItemFinancial:{update:jest.fn()}});
    if(kind==='order')await freezeOrderLots(f.db,901,false,[],at);else await freezeCheckoutLots(f.db,'checkout');
    const update=kind==='order'?f.db.orderItemFinancial.update:f.db.checkoutItemFinancial.update;
    expect(update.mock.calls[0][0].data.lotCosts[0]).toMatchObject({productionCents:1375,freightCents:0,otherCents:0,quality:'CONFIRMED',lotId:'original',sliceId:'opening-M'});
  });
});
