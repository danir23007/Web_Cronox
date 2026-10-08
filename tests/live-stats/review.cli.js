async (page) => {
  const browser=page.context().browser(),helper='http://127.0.0.1:43131',origin='http://localhost:3000';
  const get=async path=>{const r=await page.request.get(helper+path);if(!r.ok())throw Error('QA helper failed: '+path);return r.json();};
  const fixture=await get('/setup'),contexts=[],checks=[];
  const context=async state=>{const c=await browser.newContext(state?{storageState:state}:{});contexts.push(c);return c;};
  const admin=await context(await get('/admin-state')),panel=await admin.newPage();
  const stats=async()=>{const r=await admin.request.get(origin+'/api/admin/live-stats');if(!r.ok())throw Error('Admin snapshot failed');return r.json();};
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const poll=async(fn,message)=>{for(let i=0;i<160;i++){if(await fn())return;await page.waitForTimeout(150);}throw Error(message);};
  const tracked=async c=>{const cookies=await c.cookies(),live=cookies.find(c=>c.name==='cronox_live_visitor')?.value,daily=cookies.find(c=>c.name==='cronox_daily_visitor')?.value;if(live)await get('/track?token='+encodeURIComponent(live)+(daily?'&daily='+encodeURIComponent(daily):''));return live;};
  const expire=async c=>{const token=await tracked(c);if(token)await get('/expire?token='+encodeURIComponent(token));};
  const fresh=async state=>{const c=await context(state),p=await c.newPage();p.on('request',r=>{if(r.url().includes('/api/live-stats/')&&!r.url().startsWith(origin+'/'))throw Error('Non-local presence request');});await p.goto(origin+'/tienda');return {c,p};};
  try {
    check((await stats()).visitors.total===0,'Other active local visitors: stop this isolated review');
    await panel.goto(origin+'/admin.html#section-live-stats');
    await panel.locator('#section-live-stats').waitFor({state:'visible'});
    // A pending session check neither drops the guest permanently nor records it early.
    const anon=await context(),v=await anon.newPage();let release;const gate=new Promise(r=>release=r);let signals=0,maxFlight=0,phase='initial';const flight=new Set(),overlaps=[];
    await v.route('**/api/me',async route=>{await gate;await route.continue();});
    v.on('request',r=>{if(r.url().includes('/api/live-stats/presence')){signals++;flight.add(r);maxFlight=Math.max(maxFlight,flight.size);if(flight.size>1)overlaps.push({phase,requests:[...flight].map(r=>({body:r.postData(),timing:r.timing()}))});}});
    v.on('response',r=>{flight.delete(r.request());});v.on('requestfailed',r=>{flight.delete(r);});
    await v.goto(origin+'/tienda');await v.waitForTimeout(600);check(signals===0,'Unknown auth sent presence');release();
    await poll(async()=>!!(await tracked(anon)),'Anonymous proof not issued');
    await poll(async()=>(await stats()).visitors.total===1,'Guest absent without cookie choice');
    await poll(async()=>await panel.locator('.sidebar-live').getAttribute('data-activity')==='active','Menu did not update automatically');
    check(maxFlight===1,'Overlapping heartbeats');checks.push('pending auth/no choice/automatic panel/red menu');
    const proof=await tracked(anon);
    phase='navigation';
    await v.evaluate(()=>window.CRONOX_COOKIE_CONSENT.rejectAll());await v.waitForTimeout(500);
    check((await stats()).visitors.total===1,'Rejecting analytics removed live guest');
    await v.reload();await poll(async()=>!!await tracked(anon),'Reload lost presence');check(await tracked(anon)===proof,'Reload changed identity');
    await v.goto(origin+'/');await v.goBack();await v.waitForTimeout(700);check(await tracked(anon)===proof,'Navigation/back changed proof');
    const tab=await anon.newPage();await tab.goto(origin+'/tienda');await tab.waitForTimeout(700);check((await stats()).visitors.total===1,'Tabs duplicate guests');
    await tab.close();checks.push('rejected consent/reload/navigation/back/shared tabs');
    // Actual API/session transport and shared authentication publisher.
    phase='sessions';
    const login=async(p,index)=>p.evaluate(async data=>{await window.CRONOX_API.login(data);await window.CRONOX_refreshAuthState();},{email:fixture.users[index].email,password:fixture.password});
    const logout=async p=>p.evaluate(async()=>{await window.CRONOX_API.logout();await window.CRONOX_refreshAuthState();});
    await login(v,0);await poll(async()=>(await stats()).visitors.signedIn===1,'Login did not link presence');check(await tracked(anon)===proof,'Login split browser proof');
    await logout(v);await poll(async()=>(await stats()).visitors.guests===1,'Logout did not restore guest');check(await tracked(anon)===proof,'Logout split browser proof');checks.push('normal login/logout without additional presence');
    await v.evaluate(()=>window.CRONOX_COOKIE_CONSENT.acceptAll());await v.waitForTimeout(1200);await tracked(anon);
    await login(v,0);await v.waitForTimeout(700);await login(v,1);await v.waitForTimeout(700);
    await poll(async()=>(await get('/history')).accounts===2,'Different accounts were collapsed in daily history');
    check((await stats()).visitors.total===1,'Account change inflated simultaneous presence');await logout(v);check(await tracked(anon)===proof,'Account switches lost proof');
    check((await get('/history')).accounts===2,'Logout changed daily accounts');checks.push('accepted consent/two daily accounts/separate simultaneous presence');
    await login(v,0);
    const same=await fresh(await get('/account-state?index=0'));await poll(async()=>!!await tracked(same.c),'Second account context did not signal');
    check((await stats()).visitors.total===1,'Same normal account counted twice across browser proofs');const sameProof=await tracked(same.c);await same.c.close();await get('/expire?token='+encodeURIComponent(sameProof));await stats();
    const roleContexts=[];
    for(const index of [2,3]) {
      const rc=await context(await get('/account-state?index='+index)),rp=await rc.newPage();roleContexts.push(rc);
      let positive=0;rp.on('request',r=>{if(r.url().includes('/api/live-stats/presence')&&JSON.parse(r.postData()||'{}').enabled)positive++;});
      await rp.goto(origin+'/tienda');await rp.waitForTimeout(900);await rp.reload();await rp.waitForTimeout(500);
      check(positive===0,'Admin public page sent enabled presence');check((await stats()).visitors.total===1,'Admin was counted');await rc.close();
    }
    await login(v,2);await poll(async()=>(await stats()).visitors.total===0,'Guest-to-admin presence not removed');check(await tracked(anon)===proof,'Admin exclusion dropped proof');
    await logout(v);await poll(async()=>(await stats()).visitors.total===1,'Admin logout guest absent');check(await tracked(anon)===proof,'Admin logout changed proof');checks.push('ADMIN/SUPERADMIN excluded/reloads/same-account dedup');
    // Fail a real presence request, then recover automatically on the 5s retry.
    phase='recovery';
    let failed=0;await v.route('**/api/live-stats/presence',route=>{failed++;return route.fulfill({status:503,json:{message:'local QA outage'}});});
    await v.evaluate(()=>window.dispatchEvent(new Event('online')));await poll(async()=>failed>0,'Failed heartbeat not attempted');
    await v.unroute('**/api/live-stats/presence');const beforeSignals=signals;await poll(async()=>signals>beforeSignals,'Heartbeat did not retry automatically');
    check((await stats()).visitors.total===1,'Recovery duplicated guest');check(maxFlight===1,'Recovery overlapped heartbeats: '+JSON.stringify(overlaps));
    await panel.route('**/api/admin/live-stats',route=>route.fulfill({status:503,json:{message:'local QA outage'}}));
    await panel.locator('[data-live-refresh]').click();await poll(async()=>await panel.locator('#section-live-stats').getAttribute('data-state')==='error','Panel did not show network error');
    check(await panel.locator('.sidebar-live').getAttribute('data-activity')==='unavailable','Error represented as zero');
    await panel.unroute('**/api/admin/live-stats');await poll(async()=>await panel.locator('#section-live-stats').getAttribute('data-state')==='ready','Panel did not recover automatically');checks.push('heartbeat and panel HTTP failure/automatic recovery/no overlaps');
    await panel.setViewportSize({width:1440,height:1000});await panel.screenshot({path:'output/playwright/live-stats/after-desktop.png',fullPage:true});
    await panel.setViewportSize({width:390,height:844});await panel.waitForTimeout(350);check(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile panel overflow');await panel.screenshot({path:'output/playwright/live-stats/after-mobile.png',fullPage:true});
    await v.setViewportSize({width:390,height:844});await v.reload();await v.waitForTimeout(900);check((await stats()).visitors.total===1,'Mobile visitor absent');await tracked(anon);checks.push('mobile panel and public visitor');
    // Keep the visitor open for a real scheduled heartbeat, then close it and
    // observe real two-minute expiry via the administrator's automatic polling.
    const beforeHeartbeat=signals;await v.waitForTimeout(31000);check(signals>beforeHeartbeat,'30s visible heartbeat missing');
    await anon.close();const closedAt=Date.now();
    for(let i=0;i<150;i++){if((await stats()).visitors.total===0)break;await page.waitForTimeout(1000);}
    check((await stats()).visitors.total===0,'Closed presence did not expire');
    await poll(async()=>await panel.locator('.sidebar-live').getAttribute('data-activity')==='empty','Red dot did not clear automatically');
    await panel.screenshot({path:'output/playwright/live-stats/expired-mobile.png',fullPage:true});
    checks.push('real scheduled heartbeat/real expiry/automatic red-dot removal');
    return {scope:'protected local real backend and Chromium only',checks,signals,maxFlight,expiryObservedMs:Date.now()-closedAt,visitors:(await stats()).visitors};
  }finally{for(const c of contexts)await c.close().catch(()=>{});await get('/cleanup').catch(()=>{});}
}
