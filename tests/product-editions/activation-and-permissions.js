const route='/api/admin/products/'+f.productId+'/lots/editions';
const editions=await(await page.request.get(f.origin+route)).json();check(editions.lots.length===2,'Unexpected editions');
const concurrent=await page.evaluate(async({route,lots})=>{
  const headers={'Content-Type':'application/json',...(await window.CRONOX_API.getCsrfHeaders())};
  return Promise.all(lots.map(async lot=>{const r=await fetch(route+'/'+lot.id+'/activate',{method:'POST',credentials:'include',headers,body:JSON.stringify({revision:lot.revision})});return{status:r.status,body:await r.json(),target:lot.id};}));
},{route,lots:editions.lots});
check(concurrent.every(r=>r.status===201&&r.body.product.activeLotId===r.target),'Concurrent activations not atomic');
const current=await state();check(current.lots.some(l=>l.id===current.product.activeLotId),'No valid single active pointer');
const expected=current.lots.find(l=>l.id===current.product.activeLotId).slices.filter(s=>s.variantId===current.product.variants.find(v=>v.size==='M').id).reduce((n,s)=>n+s.available,0);check(current.product.variants.find(v=>v.size==='M').stockQty===expected,'Mixed activation projection');
const anonymous=await page.context().browser().newContext(),anon=await anonymous.request.get(f.origin+route);check(anon.status()===401,'Anonymous lot access allowed');
const buyer=await session('buyer'),userResult=await buyer.request.get(f.origin+route);check(userResult.status()===403,'Buyer accessed private lots');
const limited=await session('limited'),limitedResult=await limited.request.get(f.origin+route);check(limitedResult.status()===200,'Existing ADMIN permissions changed');
const lot2=editions.lots.find(l=>l.number===2),noCsrf=await page.request.post(f.origin+route+'/'+lot2.id+'/activate',{data:{revision:lot2.revision}});check(noCsrf.status()===403,'Missing CSRF accepted');
const final=await page.evaluate(async({route,lot})=>{const r=await fetch(route+'/'+lot.id+'/activate',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',...(await window.CRONOX_API.getCsrfHeaders())},body:JSON.stringify({revision:lot.revision})});return{status:r.status,body:await r.json()};},{route,lot:lot2});check(final.status===201&&final.body.product.activeLotId===lot2.id,'Final activation failed');
await anonymous.close();
return {passed:true,concurrentStatuses:concurrent.map(r=>r.status),exclusive:true,anonymous:anon.status(),buyer:userResult.status(),limitedAdmin:limitedResult.status(),missingCsrf:noCsrf.status(),superadmin:final.status};
