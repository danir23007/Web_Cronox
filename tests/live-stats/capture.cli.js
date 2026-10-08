async (page)=>{
  const browser=page.context().browser(),helper='http://127.0.0.1:43131',origin='http://localhost:3000';
  const admin=await browser.newContext({storageState:await(await page.request.get(helper+'/admin-state')).json()}),visitor=await browser.newContext();
  const panel=await admin.newPage(),publicPage=await visitor.newPage();let token;
  try{
    await panel.goto(origin+'/admin.html#section-live-stats');await publicPage.goto(origin+'/tienda');
    for(let i=0;i<150;i++){if(await panel.locator('.live-stat strong').first().textContent()==='1')break;await page.waitForTimeout(150);}
    if(await panel.locator('.live-stat strong').first().textContent()!=='1')throw Error('Real guest absent from final captures');
    if(!await panel.locator('.live-help').filter({hasText:'cualquier elección'}).isVisible())throw Error('Old consent wording');
    token=(await visitor.cookies()).find(c=>c.name==='cronox_live_visitor').value;
    await page.request.get(helper+'/track?token='+encodeURIComponent(token));
    await panel.setViewportSize({width:1440,height:1000});await panel.screenshot({path:'output/playwright/live-stats/after-desktop.png',fullPage:true});
    await panel.setViewportSize({width:390,height:844});await panel.waitForTimeout(350);await panel.screenshot({path:'output/playwright/live-stats/after-mobile.png',fullPage:true});
    await panel.locator('#sidebarToggle').click();await panel.locator('.sidebar-live').scrollIntoViewIfNeeded();await panel.waitForTimeout(350);await panel.screenshot({path:'output/playwright/live-stats/menu-mobile.png'});
    await publicPage.setViewportSize({width:390,height:844});await publicPage.screenshot({path:'output/playwright/live-stats/visitor-mobile.png'});
    return{visitors:'1 real local anonymous visitor',desktop:1440,mobile:390,menu:await panel.locator('.sidebar-live').getAttribute('data-activity')};
  }finally{await visitor.close();if(token)await page.request.get(helper+'/expire?token='+encodeURIComponent(token));await admin.close();await page.request.get(helper+'/cleanup');}
}
