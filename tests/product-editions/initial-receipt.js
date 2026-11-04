check((await state()).orders.length===0,'Use a fresh isolated review for the full sequence');
const me=await page.request.get(f.origin+'/api/me');
if(me.status()!==200){await page.goto(f.origin+'/admin-login.html');await page.locator('#adminLoginEmail').fill(f.users.admin.email);await page.locator('#adminLoginPassword').fill(f.password);await page.locator('#adminLoginSubmit').click();await page.waitForURL('**/admin.html**');}
await openEditor();await page.getByText('Lote activado',{exact:true}).waitFor();
await page.locator('#productCost').fill('25');await page.locator('[data-variant-size="M"]').fill('1');await page.locator('[name=editionReceivedAt]').fill('2026-11-03');await page.locator('[name=editionOther]').fill('0');
await page.locator('#productSubmitBtn').click();await page.getByText('Cambios guardados en el lote 1.',{exact:true}).waitFor();await page.locator('#productCancelBtn').click();
const saved=await state();check(saved.lots[0].costQuality==='CONFIRMED','Known initial receipt was not confirmed');check(saved.product.variants.find(v=>v.size==='M').stockQty===1,'Initial receipt not persisted');
return {passed:true,productId:f.productId,costQuality:saved.lots[0].costQuality};
