const stale=await session('stale'),reserved=await session('reserved');
if(!(await state()).snapshots.some(s=>s.userId===f.users.reserved.id&&s.paymentStartedAt&&!s.orderId)){
await addFromProduct(stale);await stale.goto(f.origin+'/cesta');await stale.locator('.cart-item').waitFor();
await addFromProduct(reserved);await checkout(reserved);await reserved.evaluate(()=>sessionStorage.fixtureHold='true');await reserved.locator('#pay-button').click();await reserved.waitForFunction(()=>typeof window.__releaseFixturePayment==='function');
}
const protectedState=await state(),held=protectedState.snapshots.find(s=>s.userId===f.users.reserved.id&&s.paymentStartedAt&&!s.orderId);check(held.paymentStartedAt,'Payment not protected');check(held.items[0].financialSnapshot.lotCosts[0].lotId===protectedState.lots.find(l=>l.number===2).id,'Protected allocation wrong');
if((await state()).product.activeLotId!==(await state()).lots.find(l=>l.number===1).id){await openEditor();await page.getByRole('tab',{name:'1',exact:true}).click();await page.getByRole('button',{name:'Activar lote 1',exact:true}).click();await page.getByText('Lote activado',{exact:true}).waitFor();await page.locator('#productCancelBtn').click();}
await stale.goto(f.origin+'/cesta');await stale.getByText('Aceptar tirada y precio actuales',{exact:true}).waitFor();
await stale.screenshot({path:'output/playwright/editions-integrated/stale-cart.png',fullPage:true});
await stale.goto(f.origin+'/checkout');await stale.getByText(/Ha cambiado la tirada o el precio/).first().waitFor();
const publicPage=await stale.context().newPage();await publicPage.goto(f.origin+'/producto/'+f.slug);await publicPage.locator('#pPrice').filter({hasText:'90'}).waitFor();check(await publicPage.locator('#pAdd').isDisabled(),'Inactive stock offered for web sale');
const switched=await state();check(switched.lots.find(l=>l.number===2).slices.reduce((n,s)=>n+s.available,0)===1,'Expected inactive stock still present');check(switched.product.variants.find(v=>v.size==='M').stockQty===0,'Inactive inventory counted publicly');
await reserved.evaluate(()=>window.__releaseFixturePayment());await reserved.waitForURL('**/checkout/exito**');
const paid=await state(),original=paid.orders.find(o=>o.userId===f.users.reserved.id);check(original&&Number(original.items[0].unitPrice)===110,'Protected payment repriced');check(original.items[0].financialSnapshot.lotCosts[0].lotId===held.items[0].financialSnapshot.lotCosts[0].lotId,'Protected payment changed edition');
await openEditor();await page.getByRole('tab',{name:'2',exact:true}).click();await page.getByRole('button',{name:'Activar lote 2',exact:true}).click();await page.getByText('Lote activado',{exact:true}).waitFor();await page.locator('#productCancelBtn').click();
const beforeReturn=await state(),first=beforeReturn.orders[0];
const refunded=await page.request.post(f.origin+'/__review/stripe/refund',{data:{id:first.providerRef}});check(refunded.ok(),await refunded.text());
const again=await page.request.post(f.origin+'/__review/stripe/refund',{data:{id:first.providerRef}});check(again.ok(),'Repeated refund failed');
const after=await state();check(after.lots.find(l=>l.number===1).slices.reduce((n,s)=>n+s.available,0)===1,'Original lot not restored exactly once');check(after.product.variants.find(v=>v.size==='M').stockQty===1,'Inactive return changed public stock');
return {passed:true,staleCartReview:true,onlyActiveWebStock:true,protectedOrderId:original.id,protectedPrice:original.items[0].unitPrice,returnToInactiveLot:true,duplicateReturnSafe:true};
