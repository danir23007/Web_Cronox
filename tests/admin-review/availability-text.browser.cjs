// Browser-only stock/cart fixtures; no database or cart mutation requests.
async page => {
  await page.addInitScript(()=>{window.__CRONOX_API_BASE__=location.origin;});
  const raw=await page.request.get('http://localhost:3000/api/products?limit=100').then(r=>r.json());
  const lowId=raw.items[0].id,outId=raw.items[1].id,lowSlug=raw.items[0].slug,outSlug=raw.items[1].slug;
  const mock=p=>({...p,lastUnitsThreshold:5,variants:p.variants.map((v,i)=>({...v,stockQty:p.id===lowId?(i===0?2:0):p.id===outId?0:v.stockQty}))});
  await page.route('**/api/products**',async route=>{
    const response=await route.fetch(),data=await response.json();
    const body=Array.isArray(data.items)?{...data,items:data.items.map(mock)}:mock(data);
    await route.fulfill({response,json:body});
  });
  await page.route('**/api/cart',route=>route.fulfill({json:{items:[{id:999999,variantId:999999,qty:1,product:{id:999999,name:'Cesta simulada',slug:'visual-only'},priceCents:2000}],subtotalCents:2000,itemsCount:1}}));
  const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addLocatorHandler(page.locator('.newsletter-modal-overlay--visible'),async overlay=>{await overlay.getByRole('button',{name:/cerrar/i}).click();});
  const check=(v,m)=>{if(!v)throw Error(m);};
  const verify=async selector=>{
    const labels=await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color,children:n.children.length,before:getComputedStyle(n,'::before').content,after:getComputedStyle(n,'::after').content})));
    check(labels.length>0,'Missing availability label: '+selector);
    for(const l of labels){check(!/[·•●]/.test(l.text)&&l.children===0,'Dot still present');check(['none','normal',''].includes(l.before)&&['none','normal',''].includes(l.after),'Generated decoration present');}
    return labels;
  };
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.goto('http://localhost:3000/tienda');
    await page.locator('#productsGrid .product-last-units').first().waitFor();
    const reject=page.getByRole('button',{name:'RECHAZAR',exact:true});if(await reject.isVisible())await reject.click();
    results.push({width,cards:await verify('#productsGrid .product-last-units')});
    await page.screenshot({path:`output/playwright/availability-cards-${width}.png`,fullPage:true});
    const card=page.locator(`#productsGrid .product-card[href*="${lowSlug}"]`);
    await card.locator('.fav-add').click();await page.locator('#quickAdd .stock-status').waitFor();
    results.push({width,quickAdd:await verify('#quickAdd .stock-status')});await page.screenshot({path:`output/playwright/availability-quick-${width}.png`,animations:'disabled'});
    await page.locator('#quickAdd .qa-close').click();
    await page.locator('#cart-icon-btn').click();await page.locator('.cart-upsell__last-units').first().waitFor();
    results.push({width,recommendations:await verify('.cart-upsell__last-units')});await page.screenshot({path:`output/playwright/availability-cart-${width}.png`,animations:'disabled'});
    await page.locator('#cart-close-btn').click();
    for(const [slug,status] of [[lowSlug,'low'],[outSlug,'out']]){
      await page.goto('http://localhost:3000/producto/'+slug);await page.locator('.stock-status').waitFor();
      results.push({width,product:status,labels:await verify('.stock-status')});
      await page.screenshot({path:`output/playwright/availability-product-${status}-${width}.png`,fullPage:true});
    }
  }
  check(!errors.length,errors.join('; '));return {passed:true,errors,results,mocks:'Browser stock and cart responses only; no stock/order/payment writes'};
}
