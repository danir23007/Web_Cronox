// Embedded by prepare-product-editions-browser.cjs into a Playwright CLI cell.
const check=(value,message)=>{if(!value)throw Error(message);};
const state=async()=>await(await page.request.get(f.origin+'/__review/state')).json();
const providerScript=`window.Stripe=()=>({elements:()=>{const handlers={};return{create:type=>{const h={};return{on:(name,fn)=>{h[name]=fn;},mount:selector=>{const host=typeof selector==='string'?document.querySelector(selector):selector;if(type==='payment'){host.innerHTML='<label>Tarjeta simulada<input aria-label="Tarjeta simulada" placeholder="4242 4242 4242 4242"></label>';host.querySelector('input').addEventListener('input',()=>h.change?.({complete:true,value:{type:'card'}}));}setTimeout(()=>h.ready?.(type==='expressCheckout'?{availablePaymentMethods:{}}:{}),20);},unmount(){},destroy(){}};},submit:async()=>({}),update:()=>setTimeout(()=>handlers['update-end']?.(),5),on:(n,fn)=>handlers[n]=fn,off:()=>{}};},retrievePaymentIntent:async secret=>await(await fetch('/__review/stripe?id='+secret)).json(),confirmPayment:async args=>{if(sessionStorage.fixtureHold==='true')await new Promise(resolve=>window.__releaseFixturePayment=resolve);const r=await fetch('/__review/stripe/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:args.clientSecret})});const result=await r.json();if(!r.ok)return{error:{message:result.error}};location.assign(args.confirmParams.return_url);return{};}});`;
async function session(role){
  const browser=page.context().browser();
  for(const context of browser.contexts())for(const existing of context.pages())if(await existing.evaluate(()=>window.name).catch(()=>null)==='edition-'+role)return existing;
  const context=await browser.newContext({viewport:{width:1366,height:950}});const p=await context.newPage();
  await p.addInitScript(name=>window.name=name,'edition-'+role);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='js.stripe.com')return route.fulfill({contentType:'application/javascript',body:providerScript});if(url.origin!==f.origin&&url.protocol!=='data:'&&url.protocol!=='blob:')return route.abort();return route.continue();});
  await p.goto(f.origin+'/?login=1');await p.locator('#authLoginEmail').fill(f.users[role].email);await p.locator('#authLoginPassword').fill(f.password);await p.locator('#authLoginForm button[type=submit]').click();
  await p.locator('#authOverlay').waitFor({state:'hidden'});return p;
}
async function addFromProduct(p){
  await p.goto(f.origin+'/producto/'+f.slug);await p.locator('#pSizeGroup button').filter({hasText:/^M$/}).click();await p.locator('#pAdd').click();
  await p.waitForResponse(r=>r.url().includes('/api/cart')&&r.request().method()==='POST').catch(()=>null);
}
async function checkout(p){
  if(new URL(p.url()).pathname!=='/checkout')await p.goto(f.origin+'/checkout');await p.locator('#shipping-form').waitFor({state:'visible'});
  for(const [key,value] of Object.entries({firstName:'Prueba',lastName:'Lotes',address:'Calle Prueba 10',zip:'28001',city:'Madrid',state:'Madrid',phone:'600123456'}))await p.locator('#shipping-form [name='+key+']').fill(value);
  await p.locator('[aria-label="Tarjeta simulada"]').fill('4242 4242 4242 4242');await p.locator('#pay-button').waitFor({state:'visible'});
  await p.waitForFunction(()=>!document.getElementById('pay-button').disabled);return p;
}
async function pay(p){await p.locator('#pay-button').click();await p.waitForURL('**/checkout/exito**');await p.getByText(/pedido.*confirmado|gracias|pago.*recibido/i).first().waitFor().catch(()=>null);}
async function openEditor(){if(await page.locator('#productModal.show').count())return;await page.goto(f.origin+'/admin.html#section-products');await page.locator('[data-edit-product="'+f.productId+'"]').click();await page.locator('#productPrice').waitFor();}
