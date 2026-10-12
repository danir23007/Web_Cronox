import { AdminPointsService } from './admin-points.service';
import { calculatePoints, lineDelta, pointDate, PointLine } from './point-calculations';

describe('Editing the original sale date', () => {
  function fixture() {
    const line: PointLine = { id:'line',productId:1,variantId:1,name:'Test',size:'M',quantity:2,unitPriceCents:2550,unitCostCents:1500,commissionBp:0,commissionCents:0,returned:0 };
    const sale = { id:'sale',pointId:'point',soldAt:pointDate('2026-10-12T12:00'),revision:1,state:{lines:[line]} };
    const entries:any[] = [{ id:'original',saleId:'sale',kind:'SALE',occurredAt:sale.soldAt,lines:[lineDelta(line)],expenseCents:0 }];
    const tx:any = { $executeRaw:jest.fn(),$queryRaw:jest.fn(),salePoint:{findUnique:async()=>({id:'point',archived:false})},
      pointSale:{findUnique:async()=>({...sale}),update:jest.fn(async({data})=>{sale.soldAt=data.soldAt;sale.revision++;return sale;})},
      pointEntry:{findUnique:async({where})=>entries.find(e=>e.requestKey===where.requestKey),findMany:async()=>[...entries].sort((a,b)=>a.occurredAt-b.occurredAt),
        update:jest.fn(async({where,data})=>Object.assign(entries.find(e=>e.id===where.id),data)),create:jest.fn(async({data})=>{const e={...data,id:'change',expenseCents:0};entries.push(e);return e;})},
      auditLog:{create:jest.fn()},stockMovement:{create:jest.fn()},productVariant:{update:jest.fn()} };
    const prisma:any={$transaction:async(fn)=>fn(tx)};return {service:new AdminPointsService(prisma),tx,sale,entries};
  }
  it('moves the original amount to an earlier period, preserves stock/state and deduplicates retries', async()=>{
    const f=fixture(),state=JSON.stringify(f.sale.state),dto={occurredAt:'2026-09-20T12:00',revision:1,reason:'Fecha incorrecta'};
    await f.service.changeSaleDate('point','sale',1,'date-edit-key-123456',dto);
    await f.service.changeSaleDate('point','sale',1,'date-edit-key-123456',dto);
    expect(f.sale.soldAt).toEqual(pointDate(dto.occurredAt));expect(JSON.stringify(f.sale.state)).toBe(state);
    expect(f.tx.pointSale.update).toHaveBeenCalledTimes(1);expect(f.tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(f.tx.stockMovement.create).not.toHaveBeenCalled();expect(f.tx.productVariant.update).not.toHaveBeenCalled();
    expect(f.tx.pointEntry.update).not.toHaveBeenCalled();
    expect(calculatePoints(f.entries,'2026-09-20','2026-09-20').totals).toMatchObject({revenueCents:5100,costCents:3000,profitCents:2100,salesCount:1});
    expect(calculatePoints(f.entries,'2026-10-12','2026-10-12').totals.revenueCents).toBe(0);
    expect(f.entries[1].before.soldAt).toBe(pointDate('2026-10-12T12:00').toISOString());
    await f.service.changeSaleDate('point','sale',1,'date-edit-key-654321',{...dto,occurredAt:'2026-09-22T12:00',revision:2});
    expect(calculatePoints(f.entries,'2026-09-20','2026-09-20').totals).toMatchObject({revenueCents:0,salesCount:0});
    expect(calculatePoints(f.entries,'2026-09-22','2026-10-12').totals).toMatchObject({revenueCents:5100,profitCents:2100,salesCount:1});
  });
  it('allows dates in both directions but cannot move a sale after an existing financial movement',async()=>{
    const f=fixture();f.entries.push({id:'refund',kind:'RETURN',occurredAt:pointDate('2026-10-13T12:00'),lines:[{unitsReturned:1}]});
    await expect(f.service.changeSaleDate('point','sale',1,'date-edit-key-123456',{occurredAt:'2026-10-14T12:00',revision:1,reason:'Fecha'})).rejects.toThrow('posterior');
    expect(f.tx.pointSale.update).not.toHaveBeenCalled();
    await f.service.changeSaleDate('point','sale',1,'date-edit-key-654321',{occurredAt:'2026-10-13T10:00',revision:1,reason:'Fecha'});
    expect(f.entries[1].occurredAt).toEqual(pointDate('2026-10-13T12:00'));
  });
  it('rejects stale revisions and sales belonging to a different point',async()=>{
    const f=fixture(),dto={occurredAt:'2026-10-01T12:00',revision:2,reason:'Fecha'};
    await expect(f.service.changeSaleDate('point','sale',1,'date-edit-key-123456',dto)).rejects.toThrow('revisión');
    await expect(f.service.changeSaleDate('other','sale',1,'date-edit-key-123456',dto)).rejects.toThrow('encontrada');
  });
});
