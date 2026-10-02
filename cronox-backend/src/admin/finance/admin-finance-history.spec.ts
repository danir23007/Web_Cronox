import { AdminFinanceService } from './admin-finance.service';
import { FinanceQuery } from './admin-finance.controller';

describe('Archived finance reports', () => {
  it('reads more than one keyset batch and reconciles all aggregates without live entities', async () => {
    const archives = Array.from({length:401},(_,index) => ({ orderId:index+1, providerRef:null, snapshot:{
      historicalQualified:true, id:index+1, status:'CANCELLED', currency:'EUR', source:'ONLINE', providerRef:null,
      paidAt:'2026-03-29T12:00:00Z', purchasedAt:null, createdAt:'2026-03-29T12:00:00Z', voidedAt:null,
      total:'1.00', shippingCost:0, discountCents:0, disputeLostCents:0,
      items:[{id:index+1,productId:700,variantId:null,title:'Original',quantity:1,lineTotal:'1.00',
        financialSnapshot:{unitCostCents:50,productName:'Original',imageUrl:null}}],
    } }));
    const findMany = jest.fn(({where,select}) => select ? [{currency:'EUR'}] : archives.filter(row => row.orderId > where.orderId.gt).slice(0,200));
    const tx = {
      financeArchive:{findMany}, financeEventArchive:{findMany:jest.fn().mockResolvedValue([])},
      financeStockArchive:{findMany:jest.fn().mockResolvedValue([])},
    };
    const db = {$transaction:(work: (client: unknown) => unknown) => work(tx)};
    const query = Object.assign(new FinanceQuery(),{from:'2026-03-28',to:'2026-03-30'});
    const result = await new AdminFinanceService(db as never).getReport(query);
    expect(findMany.mock.calls.filter(([args]) => !args.select)).toHaveLength(4);
    expect(result.totals).toEqual({revenueCents:40100,costCents:20050,profitCents:20050,unitsSold:401,unitsReturned:0});
    expect(result.products[0]).toMatchObject({...result.totals,productId:700,name:'Original'});
    expect(result.buckets.map(bucket => bucket.revenueCents)).toEqual([0,40100,0]);
    expect(result.recentOrders).toHaveLength(5);
    expect(result.topProducts).toEqual(result.products);
  });
});
