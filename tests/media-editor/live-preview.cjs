// Real local API/database. Temporary presentation edits are restored in finally.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {loadLocalEnvironment}=require('../../cronox-backend/scripts/start-local.cjs');
const origin='http://localhost:3000',out='output/playwright/media-editor-release';
fs.mkdirSync(out,{recursive:true});
const assert=(v,m)=>{if(!v)throw Error(m)};
const measure=()=>{
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
 return {viewport:[innerWidth,innerHeight],hero:box(document.querySelector('#hero')),image:box(document.querySelector('#hero img')),topbar:box(document.querySelector('.topbar')),logo:box(document.querySelector('.topbar__logo-img')),title:box(document.querySelector('#store>.store-heading')),grid:box(document.querySelector('#productsGrid')),text:document.querySelector('.hero-overlay-text')?.textContent||'',textStyle:document.querySelector('.hero-overlay-text')?.style.cssText||''};
};
(async()=>{
 const config=loadLocalEnvironment(),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1700,height:1100},deviceScaleFactor:1,reducedMotion:'reduce'});
 await context.addInitScript(()=>sessionStorage.setItem('cronoxNewsletterShown','true'));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let original,changed=false;
 const api=async(p,method='GET',body)=>page.evaluate(async({p,method,body})=>{
  const headers=method==='GET'?{}:await window.CRONOX_API.getCsrfHeaders();
  const r=await fetch(p,{method,credentials:'include',headers:{...headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error(`API ${r.status}`);return r.json();
 },{p,method,body});
 const open=async()=>{await page.evaluate(()=>window.CRONOX_ADMIN_MEDIA.load(true));await page.evaluate(()=>window.CRONOX_ADMIN_MEDIA.openEditor('home.hero.video'));await page.waitForFunction(()=>window.CRONOX_ADMIN_MEDIA.state.previewReady&&window.CRONOX_ADMIN_MEDIA.state.geometry?.valid);};
 const frame=()=>page.locator('#mediaStorefrontPreview').contentFrame();
 const settle=async f=>{await f.locator('#hero[data-media-geometry="ready"]').waitFor();await f.locator('#productsGrid .product-card').first().waitFor();await f.locator('body').evaluate(async()=>{await document.fonts.ready;await document.querySelector('#hero img').decode();scrollTo(0,0)});await page.waitForTimeout(250);};
 const captureNative=async(label,width,height)=>{
  const el=page.locator('#mediaStorefrontPreview');
  const saved=await el.evaluate(e=>{const saved=e.style.cssText;e.style.cssText+=`;position:fixed!important;left:0!important;top:0!important;width:${e.clientWidth}px!important;height:${e.clientHeight}px!important;transform:none!important;z-index:2147483647!important`;let p=e.parentElement;while(p){p.dataset.previewOldStyle=p.style.cssText;p.style.setProperty('overflow','visible','important');p.style.setProperty('transform','none','important');p=p.parentElement}return saved;});
  await page.screenshot({path:`${out}/${label}.png`,clip:{x:0,y:0,width,height}});
  await el.evaluate((e,saved)=>{e.style.cssText=saved;let p=e.parentElement;while(p){p.style.cssText=p.dataset.previewOldStyle||'';delete p.dataset.previewOldStyle;p=p.parentElement}},saved);
 };
 try{
  await page.goto(origin+'/admin.html#section-media');
  await page.locator('#adminLoginEmail').fill(config.LOCAL_ADMIN_EMAIL);await page.locator('#adminLoginPassword').fill(config.LOCAL_ADMIN_PASSWORD);await page.locator('#adminLoginSubmit').click();
  await page.waitForFunction(()=>window.CRONOX_ADMIN_MEDIA);
  original=(await api('/api/admin/media/placements/home.hero.video')).placement;
  await open();
  const results=[];
  for(const [device,width,height]of [['desktop',1440,900],['tablet',768,1024],['mobile',390,844]]){
   await page.locator(`[data-media-device="${device}"]`).click();await settle(frame());
   const preview=await frame().locator('body').evaluate(measure);
   assert(preview.viewport[0]===width&&preview.viewport[1]===height,`${device} real viewport`);
   const publicContext=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',isMobile:width<=1023,hasTouch:width<=1023,storageState:await context.storageState()});
   await publicContext.addInitScript(()=>sessionStorage.setItem('cronoxNewsletterShown','true'));
   const publicTab=await publicContext.newPage();
   await publicTab.goto(origin+'/');const reject=publicTab.getByRole('button',{name:'RECHAZAR',exact:true});if(await reject.isVisible())await reject.click();
   await settle(publicTab);const actual=await publicTab.evaluate(measure);
   assert(JSON.stringify(preview)===JSON.stringify(actual),`${device}: public and editor geometry match: ${JSON.stringify({preview,actual})}`);
   await publicTab.screenshot({path:`${out}/local-web-${device}.png`});
   await captureNative(`local-editor-${device}`,width,height);
   const scroll=device==='desktop'?180:100;
   await frame().locator('body').evaluate((_body,y)=>scrollTo(0,y),scroll);
   await publicTab.evaluate(y=>scrollTo(0,y),scroll);await page.waitForTimeout(400);
   const scrolledPreview=await frame().locator('body').evaluate(measure),scrolledPublic=await publicTab.evaluate(measure);
   assert(JSON.stringify(scrolledPreview)===JSON.stringify(scrolledPublic),`${device}: scrolled topbar and content match ${JSON.stringify({scrolledPreview,scrolledPublic})}`);
   await publicTab.screenshot({path:`${out}/local-web-${device}-scroll.png`});
   await captureNative(`local-editor-${device}-scroll`,width,height);
   await page.screenshot({path:`${out}/local-panel-${device}.png`});
   results.push({device,preview,actual});await publicContext.close();
  }
  const revision=original.revision;
  await page.locator('#mediaEditorSave').click();
  assert((await api('/api/admin/media/placements/home.hero.video')).placement.revision===revision,'no-op save does not write');
  await open();await page.locator('[data-media-device="mobile"]').click();await settle(frame());
  await page.locator('#mediaFocalY').fill('25');await page.locator('#mediaFocalY').dispatchEvent('input');
  await page.locator('#mediaZoom').fill('1.2');await page.locator('#mediaZoom').dispatchEvent('input');
  await page.locator('#mediaFit').selectOption('CONTAIN');
  await page.locator('#mediaHeroTextEnabled').check();await page.locator('#mediaHeroTextContent').fill('PRUEBA LOCAL CRONOX');
  await page.locator('#mediaHeroTextContent').dispatchEvent('input');
  await page.waitForTimeout(350);const pending=await frame().locator('body').evaluate(measure);
  assert(pending.text==='PRUEBA LOCAL CRONOX','text appears immediately');
  await page.locator('#mediaEditorSave').click();await page.waitForFunction(()=>!window.CRONOX_ADMIN_MEDIA.state.placement);changed=true;
  const saved=(await api('/api/admin/media/placements/home.hero.video')).placement;
  assert(saved.framingVersion===2&&saved.framing.mobile.focalY===25&&saved.framing.mobile.zoom===1.2,'saved version and mobile controls');
  assert(JSON.stringify(saved.framing.desktop)===JSON.stringify(original.framing.desktop),'desktop independent');
  const savedContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,storageState:await context.storageState()});
  await savedContext.addInitScript(()=>sessionStorage.setItem('cronoxNewsletterShown','true'));
  const tab=await savedContext.newPage();await tab.goto(origin+'/');await settle(tab);
  assert(JSON.stringify(await tab.evaluate(measure))===JSON.stringify(pending),'saved public page matches pending preview');await tab.reload();await settle(tab);assert((await tab.evaluate(measure)).text===pending.text,'saved state survives reload');await savedContext.close();
  await open();await page.locator('[data-media-device="mobile"]').click();await settle(frame());await page.locator('#mediaInheritGeneral').check();await page.waitForTimeout(200);
  assert(await page.locator('#mediaZoom').isDisabled(),'inherited controls disabled');await page.locator('#mediaInheritGeneral').uncheck();await page.waitForTimeout(150);
  page.once('dialog',d=>d.accept());await page.locator('#mediaEditorCancel').click();assert((await api('/api/admin/media/placements/home.hero.video')).placement.revision===saved.revision,'cancel does not persist');
  fs.writeFileSync(`${out}/local-comparison.json`,JSON.stringify({results,errors,checks:['viewports','no-op','pending controls','save/reload','inheritance','cancel']},null,2));assert(errors.length===0,errors.join('\n'));console.log('PASS live iframe/public parity, pending controls, save/reload, independent devices, inheritance, no-op and cancel');
 }finally{
  if(original&&changed){const current=(await api('/api/admin/media/placements/home.hero.video')).placement;await api('/api/admin/media/placements/home.hero.video','PATCH',{...original.framing,mobile:original.framing.mobile?{...original.framing.mobile,focalY:original.framingVersion===2?original.framing.mobile.focalY:50}:null,heroText:original.heroText,framingVersion:2,expectedRevision:current.revision});}
  await browser.close();
 }
})().catch(e=>{console.error(e);process.exit(1)});
