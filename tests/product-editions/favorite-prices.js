const c=f.favoritePriceFixture,clean=t=>t.replace(/\s/g,''),money=n=>(n/100).toFixed(2).replace('.',',')+'€';
await page.route('**/assets/**',r=>r.continue());
const data=async(body)=>{const r=await page.request[body?'post':'get'](f.origin+'/__review/favorite-prices',body?{data:body}:{});check(r.ok(),'Review operation failed: '+await r.text());return r.json();};
const baseline=await data();check(baseline.product.activeLotId===c.lot2&&baseline.product.price===11000,'Wrong initial active edition');const history=JSON.stringify(baseline.order),favoriteRows=JSON.stringify(baseline.favorites),stock=baseline.product.variants.map(v=>[v.id,v.stockQty]);
const card=slug=>page.locator('.product-card[data-slug="'+slug+'"]');
const dismissConsent=async()=>{const reject=page.locator('[data-consent-action=reject]:visible').first();if(await reject.isVisible())await reject.click();};
const assertCards=async cents=>{
 await card(c.ashen.slug).waitFor();check(clean(await card(c.ashen.slug).locator('.product-price').textContent())===money(cents),'ASHEN price differs');check(clean(await card(c.armored.slug).locator('.product-price').textContent())==='65,00€','ARMORED control differs');
 for(const p of c.controls)check(clean(await card(p.slug).locator('.product-price').textContent())===money(p.priceCents),'Decimal/small control differs: '+p.name);
 if(cents!==9000)check(await card(c.ashen.slug).locator('.product-restock button').count()===1,'Exhausted ASHEN no longer offers Avisarme');
};
const profile=async cents=>{await page.goto(f.origin+'/profile.html');await page.locator('[data-profile-tab=favorites]').click();await assertCards(cents);await dismissConsent();};
const favorites=async cents=>{await page.goto(f.origin+'/favorites.html');await assertCards(cents);await dismissConsent();};
const pdp=async cents=>{await page.goto(f.origin+'/producto/'+c.ashen.slug);await page.waitForFunction(expected=>document.querySelector('#pPrice')?.textContent.replace(/\s/g,'')===expected,money(cents));if(cents!==9000)check(await page.locator('#productWaitlist button').isVisible(),'PDP exhausted flow changed');};
for(const width of [1440,390]){
 await page.setViewportSize({width,height:950});await profile(11000);await page.screenshot({path:'output/playwright/favorite-prices/after-profile-'+width+'.png',fullPage:true});
 await favorites(11000);await page.screenshot({path:'output/playwright/favorite-prices/after-favorites-'+width+'.png',fullPage:true});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Favorites overflow at '+width);await pdp(11000);await page.screenshot({path:'output/playwright/favorite-prices/after-pdp-'+width+'.png'});
}
await page.setViewportSize({width:1440,height:1000});
// Keep the profile page open: a tab re-entry must request the changed price.
await profile(11000);await page.locator('[data-profile-tab=orders]').click();await data({op:'activate',number:1});await page.locator('[data-profile-tab=favorites]').click();await page.waitForFunction(()=>document.querySelector('#profileFavoritesGrid [data-slug="ashen-shell"] .product-price')?.textContent.replace(/\s/g,'')==='90,00€');await assertCards(9000);
await favorites(9000);await pdp(9000);
await data({op:'activate',number:2});await profile(11000);await favorites(11000);await pdp(11000);
// A later change to the active edition must beat an earlier catalogue in memory.
await favorites(11000);await data({op:'price',priceCents:12500});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('#favorites-grid [data-slug="ashen-shell"] .product-price')?.textContent.replace(/\s/g,'')==='125,00€');await assertCards(12500);
await profile(12500);await page.reload();await page.locator('[data-profile-tab=favorites]').click();await assertCards(12500);await pdp(12500);
const changed=await data();check(JSON.stringify(changed.order)===history,'Historical order or its financial snapshot changed');check(JSON.stringify(changed.favorites)===favoriteRows,'Favorite IDs or dates changed');check(JSON.stringify(changed.product.variants.map(v=>[v.id,v.stockQty]))===JSON.stringify(stock),'Price change altered stock');
await data({op:'price',priceCents:11000});await profile(11000);await page.locator('[data-profile-tab=orders]').click();await page.waitForFunction(()=>document.querySelector('#ordersBody')?.textContent.includes('90 EUR'));const paid=await page.evaluate(async id=>(await window.CRONOX_API.getMyOrders()).find(o=>o.id===id),c.orderId);check(paid.total===90,'Historical paid order changed');await page.locator('[data-profile-tab=favorites]').click();await assertCards(11000);
await card(c.ashen.slug).locator('.product-restock button').click();await page.locator('.restock-dialog[open]').waitFor();await page.waitForFunction(()=>document.querySelector('.restock-dialog').getAttribute('aria-busy')==='false');check(await page.locator('.restock-dialog [data-restock-size]').count()===6,'Waitlist sizes changed');await page.keyboard.press('Escape');
await page.locator('#profileFavoritesGrid').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/favorite-prices/final-profile-1440.png'});
return {passed:true,prices:[11000,6500,3495,110,65],widths:[1440,390],activeEdition:2,soldOut:true,switchToHistorical:9000,switchBack:11000,activePriceChange:12500,restored:11000,sameFavorites:true,stockUnchanged:true,historicalOrderAndSnapshotUnchanged:true,historicalPaidPrice:9000,waitlistIntact:true};
