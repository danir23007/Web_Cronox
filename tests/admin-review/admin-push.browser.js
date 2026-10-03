async(page)=>{
  if(new URL(page.url()).origin!=='http://127.0.0.1:43121')throw Error('ISOLATED_PUSH_REVIEW_REQUIRED');
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:43121/__mailreview/superadmin');
    await page.evaluate(()=>location.hash='#section-push');
    const root=page.locator('#pushWorkspace');
    await root.locator('[data-preference-form]').waitFor();
    await root.locator('[data-push-device]').selectOption({label:await root.locator('[data-push-device] option').filter({hasText:'iPhone sintético'}).innerText()});
    assert(await root.locator('[name=mailEnabled]').isChecked(),'Existing mail preserved');
    for(const k of ['paidOrders','visits','waitlist'])assert(!await root.locator(`[name=${k}]`).isChecked(),'New type defaults off');
    assert(await root.locator('details').getAttribute('open')===null,'Maintenance folded');
    const d=await root.locator('[data-push-device]').inputValue();
    const boxValues=await root.locator('[data-push-box]:checked').evaluateAll(x=>x.map(i=>i.value));
    await root.locator('[name=visits]').check();await root.locator('[name=waitlist]').check();await root.locator('[name=paidOrders]').check();
    await root.locator('[type=submit]').press('Enter');await root.locator('[data-push-result]').filter({hasText:'Preferencias guardadas'}).waitFor();
    await page.evaluate(()=>window.CRONOX_PUSH.load());
    assert(await root.locator('[data-push-device]').inputValue()===d,'Explicit remote device selection retained');
    for(const k of ['paidOrders','visits','waitlist'])assert(await root.locator(`[name=${k}]`).isChecked(),'Server persistence '+k);
    assert(JSON.stringify(await root.locator('[data-push-box]:checked').evaluateAll(x=>x.map(i=>i.value)))===JSON.stringify(boxValues),'Mail box prefs unchanged');
    // Simulated failed PATCH must retain dirty input and never claim success.
    await page.route('**/api/admin/mailbox/push/devices/*',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:'{"message":"SYNTHETIC_SAVE_FAILURE"}'}):route.continue());
    await root.locator('[name=visits]').uncheck();await root.locator('[type=submit]').press('Enter');
    await root.locator('[data-push-result]').filter({hasText:'No se pudo guardar'}).waitFor();
    assert(!await root.locator('[name=visits]').isChecked(),'Failed save retains edited state');
    await page.unroute('**/api/admin/mailbox/push/devices/*');await page.evaluate(()=>window.CRONOX_PUSH.load());
    assert(await root.locator('[name=visits]').isChecked(),'Failed save did not change server');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Responsive no overflow');
    await page.screenshot({path:`test-results/admin-review/push-${width}.png`,fullPage:true});
    for(const k of ['paidOrders','visits','waitlist'])await root.locator(`[name=${k}]`).uncheck();
    await root.locator('[type=submit]').press('Enter');await root.locator('[data-push-result]').filter({hasText:'Preferencias guardadas'}).waitFor();
  }
}
