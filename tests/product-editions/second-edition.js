if((await state()).lots.length<2){
await openEditor();await page.getByRole('button',{name:'Crear tirada desde la seleccionada'}).click();
await page.getByRole('button',{name:'Activar lote 2',exact:true}).waitFor();
check(await page.locator('#productPrice').inputValue()==='90','Copied price incorrect');check(await page.locator('[data-variant-size="M"]').inputValue()==='0','Copied stock not zero');
await page.locator('#productPrice').fill('110');await page.locator('#productDescription').fill('Composición segunda tirada: tejido nuevo de prueba.');await page.locator('#productCost').fill('35');await page.locator('[data-variant-size="M"]').fill('4');
await page.locator('[name=editionReceivedAt]').fill('2026-11-03');await page.locator('[name=editionOther]').fill('0.04');
await page.locator('#productImages').setInputFiles(f.image2);
await page.getByRole('button',{name:'Establecer como principal',exact:true}).click();await page.locator('#productGalleryAlt').fill('Imagen de prueba de la segunda tirada');
await page.locator('#productSubmitBtn').click();await page.getByText('Cambios guardados en el lote 2.',{exact:true}).waitFor();
}
await page.reload();await page.locator('[data-edit-product="'+f.productId+'"]').click();await page.waitForFunction(()=>document.getElementById('productPrice').value==='90');check(await page.locator('#productPrice').inputValue()==='90','Inactive save published price');
await page.getByRole('tab',{name:'2',exact:true}).click();await page.waitForFunction(()=>document.getElementById('productPrice').value==='110');check(await page.locator('#productPrice').inputValue()==='110','Second price did not persist');check(await page.locator('[data-variant-size="M"]').inputValue()==='4','Second stock did not persist');
const buyer=await session('buyer');await buyer.goto(f.origin+'/producto/'+f.slug);await buyer.waitForFunction(()=>document.getElementById('pDetails').textContent.includes('primera'));check((await buyer.locator('#pPrice').innerText()).includes('90'),'Public still must be first');await buyer.locator('details').filter({has:buyer.locator('#pDetails')}).locator('summary').click();check((await buyer.locator('#pDetails').innerText()).includes('primera'),'Public first composition lost');
await page.getByRole('button',{name:'Activar lote 2',exact:true}).click();await page.getByText('Lote activado',{exact:true}).waitFor();
await buyer.reload();await buyer.locator('#pPrice').filter({hasText:'110'}).waitFor();await buyer.locator('details').filter({has:buyer.locator('#pDetails')}).locator('summary').click();check((await buyer.locator('#pDetails').innerText()).includes('segunda'),'New details missing');
const s=await state();const main=s.product.images.find(i=>i.isPrimary);check(main.url.includes('/__review/uploads/'),'Uploaded primary not projected');
await page.getByRole('tab',{name:'1',exact:true}).click();await page.getByRole('button',{name:'Activar lote 1',exact:true}).waitFor();check(await page.locator('#productPrice').inputValue()==='90','First price changed');
for(const width of [1366,390]){await page.setViewportSize({width,height:950});await page.locator('.edition-header').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/editions-integrated/admin-'+width+'.png'});}
await page.setViewportSize({width:1366,height:950});await page.locator('#productCancelBtn').click();
await addFromProduct(buyer);await checkout(buyer);await pay(buyer);
const after=await state();check(after.orders.length===2,'New order missing');
const old=after.orders[0].items[0],fresh=after.orders[1].items[0],parts=fresh.financialSnapshot.lotCosts;
check(Number(old.unitPrice)===90&&old.financialSnapshot.lotCosts[0].productionCents===2500,'Old snapshots changed');
check(Number(fresh.unitPrice)===110&&parts[0].lotId===after.product.activeLotId,'New snapshot wrong lot/price');check(parts[0].productionCents===3500&&parts[0].freightCents===0&&parts[0].otherCents===1,'New snapshot wrong cost');
return {passed:true,oldOrderId:after.orders[0].id,newOrderId:after.orders[1].id,newCostCents:3501,oldCostCents:2500,primary:main.url};
