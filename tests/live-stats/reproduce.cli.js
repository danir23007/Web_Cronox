async (page) => {
  const browser=page.context().browser(), helper='http://127.0.0.1:43131';
  const admin=await browser.newContext({storageState:await(await page.request.get(helper+'/admin-state')).json()});
  const visitor=await browser.newContext(); const panel=await admin.newPage(), publicPage=await visitor.newPage(); let signals=0;
  publicPage.on('request',req=>{if(req.url().includes('/api/live-stats/presence')) signals++;});
  const read=async()=>{const r=await admin.request.get('http://localhost:3000/api/admin/live-stats');if(!r.ok())throw Error('Snapshot failed');return(await r.json()).visitors;};
  try {
    await panel.goto('http://localhost:3000/admin.html#section-live-stats');
    await publicPage.goto('http://localhost:3000/tienda'); await publicPage.waitForTimeout(6000);
    const noChoice={signals,visitors:await read()};
    await publicPage.evaluate(()=>window.CRONOX_COOKIE_CONSENT.rejectAll());await publicPage.waitForTimeout(600);
    const rejected={signals,visitors:await read()};
    await publicPage.evaluate(()=>window.CRONOX_COOKIE_CONSENT.acceptAll());await publicPage.waitForTimeout(6000);
    const accepted={signals,visitors:await read()};
    await panel.locator('[data-live-refresh]').click();await panel.waitForTimeout(600);
    await panel.screenshot({path:'output/playwright/live-stats/before-desktop.png'});
    const token=(await visitor.cookies()).find(c=>c.name==='cronox_live_visitor')?.value;
    if(token) await page.request.get(helper+'/track?token='+encodeURIComponent(token));
    return {scope:'local real browser and backend only',noChoice,rejected,accepted};
  }finally{await visitor.close();await admin.close();await page.request.get(helper+'/cleanup');}
}
