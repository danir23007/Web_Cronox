import { applyPointCostRevisions, pointSaleCostState } from './point-cost-revisions';
import { lineDelta, PointLine } from './point-calculations';

describe('historical point cost read projection',()=>{
  function fixture(cost:number|null=1375) {
    const part={lotId:'original',sliceId:'opening',quantity:1,productionCents:null,freightCents:null,otherCents:null,quality:'UNKNOWN' as const};
    const line:PointLine={id:'line',productId:1,variantId:1,name:'Historic',size:'M',quantity:1,unitPriceCents:4000,unitCostCents:cost,commissionBp:5000,commissionCents:2000,returned:0,lotId:'original',lotCosts:[part]};
    const state={lines:[line],note:'',paymentMethod:'CASH'};
    const entry:any={id:'entry',saleId:'sale',kind:'SALE',occurredAt:new Date('2026-11-06'),after:state,lines:[lineDelta(line)],sale:{id:'sale',entries:[]}};
    const lot:any={id:'original',number:1,productId:1,openingBalance:true,createdAt:new Date('2026-11-04'),receivedAt:null,profile:{unitCostCents:cost},history:[],slices:[{id:'opening',variantId:1,received:1,productionCents:null,freightCents:null,otherCents:null}],costQuality:'UNKNOWN'};
    const db:any={$queryRaw:jest.fn(async()=>[]),pointEntry:{findMany:jest.fn(async()=>[entry])},inventoryPointCostRevision:{findFirst:jest.fn(async()=>null)},inventoryLot:{findMany:jest.fn(async()=>[lot])},inventoryLotAllocation:{findMany:jest.fn(async()=>[])}};
    return {db,entry,line,lot,state};
  }
  it('resolves saved 1375 cents despite empty allocations, without changing storage; sale detail agrees',async()=>{
    const f=fixture(),before=JSON.stringify(f.entry);
    expect(f.entry.lines[0].costCents).toBeNull(); // Published lineDelta loses the saved scalar.
    const read=await applyPointCostRevisions(f.db,[f.entry]);
    expect(read[0].lines[0]).toMatchObject({revenueCents:4000,costCents:1375,commissionCents:2000});
    expect(await applyPointCostRevisions(f.db,[f.entry])).toEqual(read);
    expect(JSON.stringify(f.entry)).toBe(before);
    expect((await pointSaleCostState(f.db,'sale',f.state)).lines[0].lotCosts?.[0]).toMatchObject({productionCents:1375,quality:'CONFIRMED'});
  });
  it('matches legacy ledger lines without lineId back to the original saved line',async()=>{
    const f=fixture();delete f.entry.lines[0].lineId;
    expect((await pointSaleCostState(f.db,'sale',f.state)).lines[0].lotCosts?.[0]).toMatchObject({productionCents:1375,quality:'CONFIRMED'});
  });
  it.each([0,null])('distinguishes saved cost %s from an unknown cost',async cost=>{
    const f=fixture(cost),read=await applyPointCostRevisions(f.db,[f.entry]);
    expect(read[0].lines[0].costCents).toBe(cost);
  });
  it('preserves receipt valuation and refuses incomplete receipts',async()=>{
    const f=fixture();Object.assign(f.lot.slices[0],{productionCents:1200,freightCents:100,otherCents:50});f.lot.costQuality='CONFIRMED';
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBe(1350);
    f.lot.slices[0].otherCents=null;
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBeNull();
  });
  it('never substitutes another active edition or a contradictory current cost',async()=>{
    const f=fixture();f.lot.profile.unitCostCents=2200;
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBeNull();
  });
  it('preserves explicit revisions and already known ledger costs',async()=>{
    const f=fixture();f.db.$queryRaw.mockResolvedValue([{entryId:'entry',lineIndex:0,after:{...f.entry.lines[0],costCents:999}}]);
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBe(999);
    f.db.$queryRaw.mockResolvedValue([]);f.entry.lines[0].costCents=700;
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBe(700);
  });
  it('keeps legacy ambiguous corrections pending, but preserves resolved originals after a new frozen return',async()=>{
    const f=fixture();f.entry.sale.entries=[{kind:'RETURN',after:{},lines:[{costCents:null}]}];
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBeNull();
    f.entry.sale.entries[0].lines[0].costCents=-1375;
    expect((await applyPointCostRevisions(f.db,[f.entry]))[0].lines[0].costCents).toBe(1375);
  });
});
