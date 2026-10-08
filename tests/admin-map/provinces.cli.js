async (page) => {
  const browser=page.context().browser(), origin='http://127.0.0.1:43127', out='output/playwright/admin-map';
  const checks=[], geometry=[], errors=[], contexts=[];
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  const poll=async(fn,msg)=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100);}throw Error(msg);};
  try {
    for (const mobile of [false,true]) {
      const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},isMobile:mobile,hasTouch:mobile});contexts.push(c);
      const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
      await c.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)&&r.request().method()==='GET'?r.continue():r.abort());
      await p.goto(origin+'/admin.html#section-map');
      await poll(async()=>await p.locator('.map-regions-table tbody tr').count()===19,'Initial communities');
      check(await p.locator('[name="division"]').inputValue()==='communities','Default division');
      check(await p.locator('#navCliente [data-nav-target="section-map"]').count()===0,'Map nested in Clients');
      check(await p.locator('nav > .sidebar-destination[data-nav-target="section-map"]').count()===1,'Main map menu');
      const theme=p.getByRole('switch',{name:'Modo oscuro'});if(await theme.getAttribute('aria-checked')!=='true')await theme.click();
      for (const division of ['communities','provinces']) {
        const before={from:await p.locator('[name="from"]').inputValue(),to:await p.locator('[name="to"]').inputValue(),metric:await p.locator('[name="metric"]').inputValue()};
        await p.locator('[name="division"]').selectOption(division);
        check(await p.locator('[name="from"]').inputValue()===before.from&&await p.locator('[name="to"]').inputValue()===before.to&&await p.locator('[name="metric"]').inputValue()===before.metric,'Division lost filters');
        const count=division==='provinces'?52:19, prefix=(mobile?'mobile':'desktop')+'-'+division;
        await poll(async()=>await p.locator('.map-regions-table tbody tr').count()===count,'Division table');
        await poll(async()=>await p.locator('.map-graphic [data-region]').count()===count,'Division geography');
        const g=await p.locator('.map-graphic svg').evaluate(svg=>({width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,visible:[...svg.querySelectorAll('[data-region]')].filter(g=>g.getBoundingClientRect().width>0&&g.getBoundingClientRect().height>0).length}));
        check(g.width>250&&g.height>180&&g.visible===count,'Visible geography');geometry.push({prefix,...g});
        check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal document overflow');
        const id=division==='provinces'?'28':'13', target=p.locator('.map-graphic [data-region="'+id+'"]');
        if(!mobile)await target.hover();
        await target.focus();await p.keyboard.press('Enter');
        await poll(async()=>await p.locator('.map-detail [data-order]').count()===25,'Paid paginated detail');
        check((await p.locator('.map-tooltip').innerText()).includes('Madrid'),'Tooltip');
        await p.locator('.map-detail [data-page="1"]').click();
        await poll(async()=> (await p.locator('.map-pagination').innerText()).includes('Página 2'),'Pagination');
        await p.locator('.map-detail [data-order]').first().click();await p.locator('#orderDetailModal').waitFor({state:'visible'});await p.locator('#orderDetailClose').click();
        await p.locator('[name="metric"]').selectOption('revenueCents');
        check((await p.locator('.map-legend').innerText()).includes('€'),'Revenue legend');
        if(division==='provinces') {
          for(const [pid,name] of [['07','Illes Balears'],['35','Las Palmas'],['38','Santa Cruz de Tenerife'],['51','Ceuta'],['52','Melilla'],['26','La Rioja']]) {
            const unit=p.locator('.map-graphic [data-region="'+pid+'"]');
            if(mobile&&['51','52'].includes(pid))await unit.tap();else {await unit.focus();await p.keyboard.press('Enter');}
            await poll(async()=> (await p.locator('.map-detail h2').innerText().catch(()=>''))===name,'Province selection '+name);
            check((await p.locator('.map-tooltip').innerText()).includes(name),'Province tooltip '+name);
          }
          if(mobile) {
            await p.locator('[data-zoom="1"]').tap();await p.locator('[data-zoom="1"]').tap();
            await p.locator('.map-graphic [data-region="26"]').tap();
            await poll(async()=> (await p.locator('.map-detail h2').innerText())==='La Rioja','Small province touch after zoom');
            await p.locator('[data-zoom="0"]').tap();
          }
          await p.locator('.map-exceptions-list [data-select="communityOnly:01"]').click();
          await poll(async()=> (await p.locator('.map-detail').innerText()).includes('provincia sin identificar'),'Community-only detail');
          await p.locator('.map-regions-table [data-select="28"]').focus();await p.keyboard.press('Enter');
          await poll(async()=> (await p.locator('.map-detail h2').innerText())==='Madrid','Keyboard equivalent table');
          if(mobile){await p.locator('.map-regions-table [data-select="28"]').tap();await poll(async()=> (await p.locator('.map-detail h2').innerText())==='Madrid','Touch equivalent table');}
        }
        await p.evaluate(()=>scrollTo(0,0));
        await p.screenshot({path:out+'/'+prefix+'-sales.png'});
        if(mobile)await p.locator('.map-cartography').screenshot({path:out+'/'+prefix+'-sales-map.png'});
        await p.locator('[data-zoom="1"]').click();
        check(await p.locator('.map-graphic').evaluate(el=>el.getBoundingClientRect().width>el.parentElement.clientWidth),'Map zoom');
        await p.locator('[data-zoom="0"]').click();
        await p.locator('[name="from"]').fill('2000-01-01');await p.locator('[name="to"]').fill('2000-01-02');await p.getByRole('button',{name:'Aplicar fechas',exact:true}).click();
        await poll(async()=> (await p.locator('.map-status').innerText()).includes('No hay pedidos'),'Confirmed zero sales');
        check(await p.locator('.map-graphic [data-region]').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).fill==='rgb(68, 68, 77)')),'Neutral gray map');
        await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:out+'/'+prefix+'-empty.png'});
        if(mobile)await p.locator('.map-cartography').screenshot({path:out+'/'+prefix+'-empty-map.png'});
        await p.route('**/api/admin/map?**',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Local simulated failure"}'}));
        await p.getByRole('button',{name:'Aplicar fechas',exact:true}).click();
        await p.locator('[data-retry]').waitFor({state:'visible'});
        check(await p.locator('.map-graphic [data-region]').count()===count,'Cartography after error');
        check(!(await p.locator('.map-legend').innerText()).includes('0'),'Error represented as zero');
        await p.locator('.map-cartography').screenshot({path:out+'/'+prefix+'-error-map.png'});
        await p.unroute('**/api/admin/map?**');await p.locator('[data-retry]').click();
        await poll(async()=> (await p.locator('.map-status').innerText()).includes('No hay pedidos'),'Retry recovery');
        await p.locator('[name="preset"]').selectOption('month');
        await poll(async()=>await p.locator('.map-status').innerText()==='','Reset fixture period');
        checks.push(prefix+': geography, cursor/focus/touch, table, paginated orders/modal, metrics, zoom, empty, error/retry');
      }
    }
    check(errors.length===0,'Page errors '+errors.join(';'));
    return {scope:'Chromium + isolated in-memory server using real financial/geographic service; no production or database writes',checks,geometry,errors};
  } finally {for(const c of contexts)await c.close();}
}
