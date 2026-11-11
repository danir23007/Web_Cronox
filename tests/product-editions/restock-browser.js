await page.context().clearCookies();await page.goto(f.origin+'/');
const consent=page.getByRole('button',{name:'Rechazar',exact:true});if(await consent.isVisible())await consent.click();
const card=()=>page.locator('.product-card[data-slug="'+f.slug+'"]');
await card().locator('.product-restock button').waitFor();
check(await card().locator('a button').count()===0,'Interactive elements nested in a link');
check(await card().locator('.product-name').evaluate(el=>getComputedStyle(el).textDecorationLine)==='none','Sold out name still crossed');
check(await card().locator('.product-price').evaluate(el=>getComputedStyle(el).textDecorationLine)==='none','Sold out price still crossed');
check(await page.locator('.product-card[data-slug="'+f.extraProducts.available.slug+'"] .product-restock').count()===0,'Available product dimmed');
check(await page.locator('.product-card[data-slug="'+f.extraProducts.partial.slug+'"] .product-restock').count()===0,'Partial product dimmed');
check(await page.locator('.product-card[data-slug="'+f.extraProducts.partial.slug+'"] .product-last-units').count()===1,'Last units missing');
await card().locator('.product-photo-link').click({position:{x:15,y:15}});await page.waitForURL('**/producto/'+f.slug);await page.getByRole('heading',{name:'PRUEBA LOTES INTEGRADA',exact:true}).waitFor();await page.locator('#pAdd').waitFor({state:'hidden'});
check(await page.locator('#pAdd').isHidden(),'Fully exhausted purchase CTA remained');
await page.goBack();await card().locator('.product-restock button').waitFor();
const read=async()=>await(await page.request.post(f.origin+'/__review/restock',{data:{op:'state'}})).json();
check((await read()).requests.length===0,'Visit created a request');
const notify=card().locator('.product-restock button');await notify.focus();await page.keyboard.press('Enter');
await page.getByRole('dialog',{name:'PRUEBA LOTES INTEGRADA'}).waitFor();
check((await read()).requests.length===0,'Opening created a request');
await page.getByRole('button',{name:'Avisarme de la talla M',exact:true}).click();
await page.locator('#authLoginEmail').fill(f.users.buyer.email);await page.locator('#authLoginPassword').fill(f.password);await page.locator('#authLoginForm button[type=submit]').click();
await page.getByText('Te avisaremos cuando vuelva la talla M',{exact:true}).waitFor();
let saved=await read();check(saved.requests.length===1&&saved.requests[0].userId===f.users.buyer.id&&saved.requests[0].variant.size==='M','Guest auth continuation did not save real subscription');
await page.getByRole('button',{name:'Avisarme de la talla M',exact:true}).click();await page.getByText('Ya tienes un aviso para esta talla',{exact:true}).waitFor();
await page.getByRole('button',{name:'Avisarme de la talla L',exact:true}).dblclick();await page.getByText('Te avisaremos cuando vuelva la talla L',{exact:true}).waitFor();
check((await read()).requests.length===2,'Duplicate click created multiple requests');
await page.keyboard.press('Escape');await page.waitForFunction(slug=>document.querySelector('.product-card[data-slug="'+slug+'"] .product-restock button')===document.activeElement,f.slug);
await page.reload();await card().locator('.product-restock button').click();await page.getByText('Ya tienes avisos para: M, L. Puedes seleccionar otra talla.',{exact:true}).waitFor();await page.keyboard.press('Escape');
// Server error and a real retry, without navigating or replacing the selection.
const ring=page.locator('.product-card[data-slug="'+f.extraProducts.ring.slug+'"]');await ring.locator('.product-restock button').click();
check(await page.locator('[data-restock-size]').allTextContents().then(x=>x.join(',')==='US 8,US 9'),'Ring sizes/order incorrect');
await page.request.post(f.origin+'/__review/restock',{data:{op:'fault',enabled:true}});
await page.getByRole('button',{name:'Avisarme de la talla US 8',exact:true}).click();await page.getByRole('button',{name:'Reintentar',exact:true}).waitFor();
check(await page.locator('[data-restock-size=US_8]').getAttribute('aria-pressed')==='true','Error lost size selection');check((await read()).requests.length===2,'Failed insert created subscription');
await page.request.post(f.origin+'/__review/restock',{data:{op:'fault',enabled:false}});await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.getByText('Te avisaremos cuando vuelva la talla US 8',{exact:true}).waitFor();
await page.keyboard.press('Escape');
// Public page uses the same immediate registration action with the chosen size.
await page.goto(f.origin+'/producto/'+f.extraProducts.partial.slug);await page.locator('#pSizeGroup [data-size=M]').click();await page.locator('#productWaitlist button').click();await page.getByText('Te avisaremos cuando vuelva la talla M',{exact:true}).waitFor();await page.keyboard.press('Escape');
await page.locator('#pSizeGroup [data-size=L]').click();check(await page.locator('#pAdd').isEnabled(),'Partial stock no longer purchasable');
// Concurrent calls use the same real endpoint and CSRF, and yield a single row.
const concurrent=await page.evaluate(async()=>{const p=await window.CRONOX_API.getProductBySlug(new URL(location.href).pathname.split('/').pop());const id=p.variants.find(v=>v.size==='M').id;const headers=await window.CRONOX_API.getCsrfHeaders();return Promise.all([1,2].map(async()=>{const r=await fetch(window.CRONOX_API.API_BASE+'/api/waitlist/'+id,{method:'POST',credentials:'include',headers});return {status:r.status,data:await r.json()};}));});
check(concurrent.every(r=>r.status===201&&r.data.existing),'Concurrent retries not idempotent');check((await read()).requests.length===4,'Concurrent retries duplicated subscription');
const firstRace=await page.evaluate(async slug=>{const p=await window.CRONOX_API.getProductBySlug(slug);const id=p.variants.find(v=>(v.sizeCode||v.size)==='US_9').id;const headers=await window.CRONOX_API.getCsrfHeaders();return Promise.all([1,2].map(async()=>{const r=await fetch(window.CRONOX_API.API_BASE+'/api/waitlist/'+id,{method:'POST',credentials:'include',headers});return {status:r.status,data:await r.json()};}));},f.extraProducts.ring.slug);
check(firstRace.every(r=>r.status===201)&&firstRace.filter(r=>!r.data.existing).length===1,'Concurrent first join was not unique');check((await read()).requests.length===5,'Concurrent initial join duplicated subscription');
await page.goto(f.origin+'/');await card().locator('.product-restock button').waitFor();
for(const width of [320,390,430,1366]){
 await page.setViewportSize({width,height:950});await card().scrollIntoViewIfNeeded();
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);
 await page.screenshot({path:'output/playwright/restock-flow/cards-'+width+'.png'});
 await card().locator('.product-restock button').click();await page.locator('.restock-dialog[open]').waitFor();
 check(await page.locator('.restock-dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth&&el.getBoundingClientRect().left>=0),'Dialog clipped at '+width);
 await page.screenshot({path:'output/playwright/restock-flow/selector-'+width+'.png'});await page.keyboard.press('Escape');
}
return {passed:true,guestAccountContinuation:true,immediateSelection:true,repeatedAndOtherSize:true,databaseErrorRetry:true,concurrentIdempotence:true,pdpPartialPurchase:true,persistedRequests:(await read()).requests.length,widths:[320,390,430,1366]};
