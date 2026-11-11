const check=(value,message)=>{if(!value)throw Error(message);};
const c=f.pointCosts;
await page.route('**/assets/**',route=>route.continue());
await page.setViewportSize({width:1440,height:950});
await page.context().clearCookies();await page.goto(f.origin+'/admin-login.html');
await page.locator('#adminLoginEmail').fill(f.users.admin.email);await page.locator('#adminLoginPassword').fill(f.password);await page.locator('#adminLoginSubmit').click();await page.waitForURL('**/admin.html**');
const url=id=>f.origin+'/admin.html#section-sale-points?'+new URLSearchParams({point:id,...c.range});
await page.goto(url(c.reproductionPointId));await page.getByRole('heading',{name:'PRUEBA COSTES · Reproducción 410 €',exact:true}).waitFor();
check(await page.locator('.pos-metrics').textContent().then(t=>t.includes('410,00')&&t.includes('205,00')&&t.includes('12,50')&&t.includes('parcial')&&t.includes('7 unidades con coste pendiente')),'410/205/9 partial control not rendered');
await page.screenshot({path:'output/playwright/point-costs/reproduction-1440.png',fullPage:true});
const read=async()=>await(await page.request.get(f.origin+'/__review/point-costs')).json();
const api=async(path,body)=>page.evaluate(async({path,body})=>{
 const r=await fetch('/api/admin/'+path,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json',...(body?await window.CRONOX_API.getCsrfHeaders():{}),'Idempotency-Key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();return {status:r.status,data};
},{path,body});
const open=async()=>{await page.goto(url(c.pointId));await page.locator('[data-action=sale]').click();await page.locator('.pos-editor form').waitFor();await page.locator('[name=occurredAt]').fill(c.date);};
// Multiple lines, exact edition labels and independent defaults.
await open();let row=page.locator('[data-lines] > fieldset').first();await row.locator('[data-variant]').selectOption(String(c.two.variants.M));
check((await row.locator('[data-lot] option').allTextContents()).join('|')==='1 tirada|2 tirada','Edition labels not exact');check(await row.locator('[data-lot]').inputValue()===c.two.lot2,'Active edition not selected');
await row.locator('[data-lot]').selectOption(c.two.lot1);await row.locator('[data-price]').fill('40');await page.locator('[data-action=add-line]').click();
const second=page.locator('[data-lines] > fieldset').nth(1);await second.locator('[data-variant]').selectOption(String(c.two.variants.L));check(await second.locator('[data-lot]').inputValue()===c.two.lot2,'New line did not default independently');
await row.locator('[data-qty]').fill('2');check(await row.locator('[data-lot]').inputValue()===c.two.lot1,'Manual edition changed while editing quantity');
await row.locator('[data-variant]').selectOption(String(c.fallback.variants.M));check(await row.locator('[data-lot]').inputValue()===c.fallback.lot1,'Changed product retained previous edition');
await page.locator('[data-action=cancel]').click();
const captures=[];
async function sell(product,lot,mode){
 await open();const form=page.locator('.pos-editor form'),row=form.locator('[data-lines] > fieldset').first();
 await form.locator('[name=stockHandling]').selectOption(mode);await row.locator('[data-variant]').selectOption(String(product.variants.M));
 if(lot)await row.locator('[data-lot]').selectOption(lot);await row.locator('[data-price]').fill('40');
 const before=await read();const saved=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/admin/sale-points/'+c.pointId+'/sales');
 await form.getByRole('button',{name:'Guardar',exact:true}).click();const response=await saved;check(response.status()===201,'UI sale failed '+await response.text());
 await page.locator('.pos-editor').waitFor({state:'detached'});const after=await read(),sale=after.sales.find(s=>!before.sales.some(b=>b.id===s.id));
 check(Boolean(sale),'Sale missing from real PostgreSQL');const line=sale.state.lines[0];
 const cost=line.lotCosts?.reduce((n,p)=>p.quality==='CONFIRMED'&&p.productionCents!=null&&p.freightCents!=null&&p.otherCents!=null ? n+p.quantity*(p.productionCents+p.freightCents+p.otherCents) : NaN,0);
 const beforeStock=before.lots.find(l=>l.id===lot)?.slices.filter(s=>s.variantId===product.variants.M).reduce((n,s)=>n+s.available,0);
 const afterStock=after.lots.find(l=>l.id===lot)?.slices.filter(s=>s.variantId===product.variants.M).reduce((n,s)=>n+s.available,0);
 check(afterStock===beforeStock-(mode==='DEDUCT_NOW'?1:0),'Wrong stock movement for chosen edition');
 captures.push({saleId:sale.id,product:product.name,mode,lot,cost:Number.isNaN(cost)?null:cost,profit:Number.isNaN(cost)?null:4000-cost-2000,stockBefore:beforeStock,stockAfter:afterStock});return sale;
}
const reference=await sell(c.two,c.two.lot1,'DEDUCT_NOW');check(captures.at(-1).cost===1375&&captures.at(-1).profit===625,'40/13.75/20 control failed');
await sell(c.two,c.two.lot1,'ALREADY_ADJUSTED');check(captures.at(-1).cost===1375,'Inactive edition adjusted cost failed');
await sell(c.two,c.two.lot2,'DEDUCT_NOW');check(captures.at(-1).cost===2200,'Active edition deduct cost failed');
await sell(c.two,c.two.lot2,'ALREADY_ADJUSTED');check(captures.at(-1).cost===2200,'Active edition adjusted cost failed');
await sell(c.fallback,c.fallback.lot1,'DEDUCT_NOW');check(captures.at(-1).cost===1375,'Edition default missing or freight counted twice');
await sell(c.zero,c.zero.lot1,'ALREADY_ADJUSTED');check(captures.at(-1).cost===0,'Zero treated as unknown');
await sell(c.unknown,c.unknown.lot1,'ALREADY_ADJUSTED');check(captures.at(-1).cost===null,'Unknown treated as zero');
let state=await read();check(state.report.report.totals.knownProfitCents===3475&&state.report.report.totals.knownCostCents===8525&&state.report.report.totals.pendingCostUnits===1&&state.report.report.totals.profitCents===null,'Mixed period values wrong');
const beforeStates=JSON.stringify(state.sales.map(s=>({id:s.id,state:s.state})));
await page.request.post(f.origin+'/__review/point-costs',{data:{op:'change-default'}});await page.request.post(f.origin+'/__review/point-costs',{data:{op:'activate-first'}});
state=await read();check(JSON.stringify(state.sales.map(s=>({id:s.id,state:s.state})))===beforeStates,'Catalog change rewrote saved sales');
await page.goto(url(c.pointId));await page.locator('[data-action=correct][data-sale="'+reference.id+'"]').click();check(await page.locator('.pos-editor [data-lot]').inputValue()===c.two.lot1,'Correction lost saved edition');
await page.locator('[name=occurredAt]').fill('2026-11-12T12:00');await page.locator('[name=reason]').fill('Prueba de conservación y redondeo');await page.locator('[name=stockHandling]').selectOption('ALREADY_ADJUSTED');await page.locator('.pos-editor [data-qty]').fill('2');await page.locator('.pos-editor [data-price]').fill('41');await page.locator('.pos-editor [data-commission]').fill('33.33');
const corrected=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/correct'));await page.locator('.pos-editor button[type=submit]').click();check((await corrected).status()===201,'Correction failed');await page.locator('.pos-editor').waitFor({state:'detached'});
state=await read();const current=state.sales.find(s=>s.id===reference.id),line=current.state.lines[0];check(line.commissionCents===2733,'Commission cent rounding changed');check(line.lotCosts.reduce((n,p)=>n+p.quantity*p.productionCents,0)===2750,'Correction repriced retained receipt');
// A real return restores the selected inactive/active edition only, and the frozen cost.
const returned=await api('sale-points/'+c.pointId+'/sales/'+reference.id+'/returns',{occurredAt:'2026-11-12T13:00',revision:current.revision,reason:'Devolución local',lines:[{id:line.id,quantity:1,restock:true,recoveredCommissionCents:1367}]});check(returned.status===201,'Return failed '+JSON.stringify(returned.data));
state=await read();
const remaining=state.sales.find(s=>s.id===reference.id);
const noRestock=await api('sale-points/'+c.pointId+'/sales/'+reference.id+'/returns',{occurredAt:'2026-11-12T13:30',revision:remaining.revision,reason:'Devolución sin reposición',lines:[{id:line.id,quantity:1,restock:false,recoveredCommissionCents:0}]});check(noRestock.status===201&&noRestock.data.lines[0].costCents===0,'Non-restocked return wrongly reversed cost');
const expense=await api('sale-points/'+c.pointId+'/expenses',{occurredAt:'2026-11-11T13:00',description:'Gasto fijo local',amountCents:500});check(expense.status===201,'Fixed expense failed');
const detail=(await api('sale-points/'+c.pointId+'?'+new URLSearchParams(c.range))).data;
const finance=(await api('finance?'+new URLSearchParams({...c.range,source:'points',pointId:c.pointId,currency:'EUR'}))).data;
for(const field of ['revenueCents','costCents','profitCents','knownCostCents','knownProfitCents','pendingCostUnits'])check(finance.totals[field]===detail.report.totals[field],'Finance and point disagree: '+field);
check(detail.report.buckets.reduce((n,b)=>n+b.knownProfitCents,0)===detail.report.totals.knownProfitCents,'Chart and indicators disagree');
check(detail.report.products.reduce((n,p)=>n+p.knownProfitCents,0)-500===detail.report.totals.knownProfitCents,'Fixed expense counted more than once');
const reversed=await api('sale-points/'+c.pointId+'/expenses',{occurredAt:'2026-11-12T14:00',description:'Anular gasto de prueba',amountCents:0,reversesId:expense.data.id});check(reversed.status===201,'Expense reversal failed');
// Server rejects mismatched edition and shortage while preserving the form.
await open();row=page.locator('[data-lines] > fieldset').first();await row.locator('[data-variant]').selectOption(String(c.two.variants.L));await row.locator('[data-lot]').selectOption(c.two.lot2);await row.locator('[data-qty]').fill('999');await row.locator('[data-price]').fill('40');await page.locator('.pos-editor button[type=submit]').click();await page.locator('[data-error]').filter({hasText:'Stock insuficiente en la tirada elegida'}).waitFor();check(await row.locator('[data-lot]').inputValue()===c.two.lot2,'Shortage silently changed edition');await page.locator('[data-action=cancel]').click();
const invalid=await api('sale-points/'+c.pointId+'/sales',{occurredAt:c.date,stockHandling:'ALREADY_ADJUSTED',lines:[{variantId:c.two.variants.M,lotId:c.zero.lot1,quantity:1,unitPriceCents:4000,commissionBp:5000}]});check(invalid.status===400,'Foreign edition accepted');
// A zero-stock, already-adjusted sale accepts a deliberate zero cost.
const z=captures.find(row=>row.product===c.zero.name);check(z.stockBefore===0&&z.stockAfter===0,'Zero stock adjusted fixture not exercised');
// Cancelling a pending sale cancels its uncertainty as well as its revenue.
const pending=await api('sale-points/'+c.recoveryPointId+'/sales',{occurredAt:c.date,stockHandling:'ALREADY_ADJUSTED',lines:[{variantId:c.unknown.variants.L,lotId:c.unknown.lot1,quantity:1,unitPriceCents:1,commissionBp:5000}]});check(pending.status===201,'Pending sale failed');
let extra=(await api('sale-points/'+c.recoveryPointId+'?'+new URLSearchParams(c.range))).data;const pendingSale=extra.sales.find(s=>s.id===pending.data.saleId);check(pendingSale.state.lines[0].commissionCents===1,'Half-cent commission did not round up');
const cancel=await api('sale-points/'+c.recoveryPointId+'/sales/'+pendingSale.id+'/correct',{occurredAt:'2026-11-12T15:00',revision:pendingSale.revision,reason:'Anulación por cantidad cero',stockHandling:'ALREADY_ADJUSTED',lines:pendingSale.state.lines.map(l=>({id:l.id,variantId:l.variantId,lotId:l.lotId,quantity:0,unitPriceCents:l.unitPriceCents,commissionBp:l.commissionBp}))});check(cancel.status===201,'Pending cancellation failed');
extra=(await api('sale-points/'+c.recoveryPointId+'?'+new URLSearchParams(c.range))).data;check(extra.report.totals.pendingCostUnits===0&&extra.report.totals.profitCents===625,'Cancelled unknown cost poisoned totals');
const adjusted=await api('sale-points/'+c.recoveryPointId+'/sales',{occurredAt:c.date,stockHandling:'ALREADY_ADJUSTED',lines:[{variantId:c.two.variants.L,lotId:c.two.lot1,quantity:1,unitPriceCents:4000,commissionBp:5000}]});check(adjusted.status===201,'Adjusted receipt sale failed');
extra=(await api('sale-points/'+c.recoveryPointId+'?'+new URLSearchParams(c.range))).data;const adjustedSale=extra.sales.find(s=>s.id===adjusted.data.saleId),adjustedLine=adjustedSale.state.lines[0];
const historicReturn=await api('sale-points/'+c.recoveryPointId+'/sales/'+adjustedSale.id+'/returns',{occurredAt:'2026-11-12T15:30',revision:adjustedSale.revision,reason:'Devolución con coste verificable',lines:[{id:adjustedLine.id,quantity:1,restock:true,recoveredCommissionCents:2000}]});check(historicReturn.status===201,'Historical receipt return failed');
const returnedStock=(await read()).lots.find(l=>l.id===c.two.lot1).slices.filter(s=>s.variantId===c.two.variants.L);check(returnedStock.reduce((n,s)=>n+s.available,0)===21&&returnedStock.every(s=>s.available===0||s.productionCents===1375&&s.freightCents===0&&s.otherCents===0),'Restocked historical unit lost frozen cost');
const map=(await api('map?'+new URLSearchParams({...c.range,division:'provinces',region:'28'}))).data;
const allFinance=(await api('finance?'+new URLSearchParams({...c.range,source:'all',currency:'EUR'}))).data;
check(map.total.pendingCostUnits===8,'Map retained uncertainty after cancellation');
for(const field of ['revenueCents','profitCents','knownProfitCents','pendingCostUnits'])check(map.total[field]===allFinance.totals[field],'Map and Finance disagree: '+field);
for(const width of [390,1440]){await page.setViewportSize({width,height:950});await page.goto(url(c.pointId));await page.locator('.pos-metrics').waitFor();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow at '+width);await page.screenshot({path:'output/playwright/point-costs/results-'+width+'.png',fullPage:true});await page.locator('.finance-chart').scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const host=document.querySelector('.finance-chart'),svg=host?.querySelector('svg');return svg && Number(svg.getAttribute('viewBox').split(' ')[2])===host.clientWidth;});await page.locator('.finance-chart').focus();await page.keyboard.press('Home');await page.locator('.finance-tooltip').waitFor({state:'visible'});}
return {passed:true,captures,referenceProfit:625,mixedBeforeAdjustments:{knownCostCents:8525,knownProfitCents:3475,pendingCostUnits:1},finalTotals:(await read()).report.report.totals,labels:['1 tirada','2 tirada'],manualChoicePreserved:true,historicalSnapshotsUnchanged:true,commissionRounding:2733,returnAndExpenseReversal:true,financeMatches:true,mapMatchesFinance:true,mapPendingUnits:map.total.pendingCostUnits,widths:[390,1440]};
