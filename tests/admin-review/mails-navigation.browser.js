async (initialPage) => {
  let page;
  const origin = 'http://127.0.0.1:4173';
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  for (const width of [1366,390]) for (const theme of ['light','dark']) {
    const variantContext = await initialPage.context().browser().newContext({hasTouch:width===390,isMobile:width===390,viewport:{width,height:900}});
    page = await variantContext.newPage(); page.on('dialog',dialog=>dialog.accept());
    const boxId = '00000000-0000-4000-8000-000000000001';
    const folders = [{id:'inbox',path:'INBOX',specialUse:'\\Inbox'}, {id:'sent',path:'Provider Outgoing',specialUse:'\\Sent'}, {id:'draft',path:'Provider Work',specialUse:'\\Drafts'}, {id:'custom',path:'Customers',specialUse:null}];
    const rows = Array.from({length:30},(_,i)=>({id:'message-'+i,mailboxId:boxId,folderId:'inbox',sender:'sender@example.test',recipients:'target@example.test',subject:i===0?'Alpha result':'Message '+i,seen:i!==0,bodyState:'LOADED',preview:'Synthetic message',date:'2026-10-04T10:00:00Z'}));
    rows.push({id:'sent-message',mailboxId:boxId,folderId:'sent',sender:'info@cronox.es',subject:'Explicit sent',seen:true,bodyState:'LOADED'});
    rows.push({id:'draft-message',mailboxId:boxId,folderId:'draft',subject:'Explicit IMAP draft',seen:false,bodyState:'LOADED'});
    const drafts = new Map(), requests = [], sends = new Map();
    let saves = 0, enqueues = 0, exportCalls = 0, audienceCalls = 0, serial = 0, audienceFail = false, loseNextSend = false;
    const overview = () => ({superadmin:true,workerEnabled:true,sendEnabled:true,credentialRefs:[],suggestions:[],boxes:[{id:boxId,address:'info@cronox.es',name:'Información',fromName:'CRONOX',active:true,notify:false,canSend:true,folders,unread:rows.filter(r=>r.folderId==='inbox'&&!r.seen).length,status:'CONNECTED'}]});
    const newDraft = (data,id) => ({id,mailboxId:boxId,mode:'campaign',status:'DRAFT',files:[],campaigns:[],sends:[],circles:[],campaignEvent:{},revision:1,...data});
    const count = circles => circles.reduce((sum,c)=>sum+(c===1?2:c===2?1:0),0);
    const hash = data => [data.familyId,(data.circles||[]).join(','),data.revision].join(':');
    await page.route('**/*',async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('.html')) {
        const response = await route.fetch();
        return route.fulfill({response,body:(await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});
      }
      if (url.pathname.includes('favicon')) return route.fulfill({status:204});
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.replace('/api/admin/mailbox',''), method = req.method();
      requests.push({path,method,query:Object.fromEntries(url.searchParams)});
      let data = {};
      if (path==='/overview') data = overview();
      else if (path==='/notices') data = {cursor:new Date().toISOString(),notices:[]};
      else if (path==='/messages') {
        const selected = (url.searchParams.get('folderIds')||'inbox').split(','), state=url.searchParams.get('state'), search=(url.searchParams.get('search')||'').toLowerCase();
        const matched = rows.filter(r=>selected.includes(r.folderId)&&(state!=='read'||r.seen)&&(state!=='unread'||!r.seen)&&`${r.subject} ${r.sender} ${r.recipients}`.toLowerCase().includes(search));
        const current = Number(url.searchParams.get('page')||1);
        data={messages:matched.slice((current-1)*25,current*25),pagination:{page:current,pages:Math.max(1,Math.ceil(matched.length/25)),total:matched.length}};
        if(search==='slow') await new Promise(resolve=>setTimeout(resolve,550));
      } else if (path.startsWith('/messages/') && path.endsWith('/action')) {
        const item = rows.find(r=>r.id===path.split('/')[2]);
        item.seen=req.postDataJSON().operation==='read'; data={ok:true};
      } else if (path.startsWith('/messages/')) {
        const item = rows.find(r=>r.id===path.split('/')[2]);
        data={...item,envelope:{},files:[],body:{text:'Opened body retained',html:'',references:[]}};
      } else if(path.endsWith('/campaign-options')) data={families:[{id:'family',name:'Familia de prueba',eventKind:'GENERAL'}],variants:[]};
      else if(path.endsWith('/campaign-audience')) {
        audienceCalls++;
        if (audienceFail) { audienceFail=false; return route.fulfill({status:503,json:{message:'MAILBOX_OPERATION_FAILED'}}); }
        const circles=(url.searchParams.get('circles')||'').split(',').filter(Boolean).map(Number), total=count(circles);
        const selection={familyId:url.searchParams.get('familyId'),circles,revision:Number(url.searchParams.get('revision'))};
        data={count:total,circles,family:{id:'family',name:'Familia de prueba'},blocked:total?[]:['No hay destinatarios elegibles.'],previewHash:hash(selection),policy:{ready:true,reasons:[]},previews:circles.map(circle=>({circle,count:count([circle]),subject:'Asunto del cliente '+circle,html:'<p>Contenido por círculo '+circle+'</p>'}))};
      } else if(path.endsWith('/campaign-recipients.xlsx')) {
        exportCalls++;
        return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="CRONOX-destinatarios.xlsx"'},body:'Simulated download; real XLSX is checked in isolated Nest integration'});
      } else if(path==='/schedule-preview') {
        if(url.searchParams.get('localDate').startsWith('2020')) return route.fulfill({status:400,json:{message:'MAILBOX_SCHEDULE_IN_PAST'}});
        data={scheduledAt:'2028-05-12T13:00:00.000Z'};
      } else if(path.endsWith('/campaign-draft')) {
        saves++; const input=req.postDataJSON(), id=input.draftId||'draft-'+(++serial);
        const existing=drafts.get(id);
        data=newDraft({...input,revision:existing?existing.revision+1:1},id); drafts.set(id,data);
      } else if(path.endsWith('/campaign') && method==='POST') {
        enqueues++; const input=req.postDataJSON();
        assert(input.previewHash===hash(input),'Current selection/hash sent');
        const id=input.draftId||'draft-'+(++serial), campaignId='campaign-'+serial;
        if(!sends.has(input.requestKey)) {
          const saved=newDraft({...input,status:'SCHEDULED',campaigns:[{id:campaignId,status:'SCHEDULED',scheduledAt:'2028-05-12T13:00:00.000Z'}]},id);
          drafts.set(id,saved); sends.set(input.requestKey,{id:campaignId,draftId:id,status:'SCHEDULED'});
        }
        await new Promise(resolve=>setTimeout(resolve,200)); data=sends.get(input.requestKey);
        if (loseNextSend) { loseNextSend=false; return route.abort('failed'); }
      } else if(path==='/drafts') {
        const view=url.searchParams.get('view');
        data=[...drafts.values()].filter(d=>view==='drafts'?d.status==='DRAFT':view==='outbox'?d.status==='SCHEDULED':d.status==='COMPLETED');
      } else if(path.startsWith('/drafts/')) data=drafts.get(path.split('/')[2]);
      else if(path.startsWith('/campaigns/')) data={id:path.split('/')[2],status:'SCHEDULED',familyName:'Familia de prueba',count:3,scheduledAt:'2028-05-12T13:00:00Z',previews:[],progress:[]};
      else throw Error('Unexpected fixture API '+method+' '+path);
      await route.fulfill({json:data}).catch(()=>{});
    });
    await page.setViewportSize({width,height:900}); await page.goto('about:blank'); await page.goto(origin+'/admin.html#section-inbox');
    await page.evaluate(theme=>{
      document.documentElement.dataset.adminTheme=theme;
      document.querySelector('#adminShell').hidden=false; document.querySelector('#adminAuthCheck').remove();
      document.querySelectorAll('.admin-section').forEach(el=>{el.hidden=el.id!=='section-inbox';});
      window.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({'x-csrf-token':'local-fixture'}), getMe:async()=>({id:1,role:'SUPERADMIN'}), admin:{getDashboard:async()=>({})}};
      const nativeFetch=window.fetch; window.fetch=(url,options)=>nativeFetch(url,{...options,signal:undefined});
      window.setInterval=(fn,ms)=>{if(ms===30000)window.testPulse=fn;return 1;};
    },theme);
    await page.addScriptTag({url:origin+'/assets/admin-shell.js'});
    await page.addScriptTag({url:origin+'/assets/admin-inbox.js'});
    await page.addScriptTag({url:origin+'/assets/admin.js'});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.locator('[data-message="message-0"]').waitFor({state:'attached'});
    const mobile = width === 390;
    const errors=[]; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    assert(await page.locator('#navCliente [data-nav-target=section-mails],#navCliente [data-nav-target=section-inbox]').count()===0,'Mail options removed from Clients');
    assert(JSON.stringify(await page.locator('#navMails [data-nav-target]').evaluateAll(nodes=>nodes.map(n=>n.dataset.navTarget)))===JSON.stringify(['section-mails','section-inbox','section-mail-campaign']),'Mails child order');
    assert(await page.locator('.sidebar-group').evaluateAll(nodes=>{const ids=nodes.map(n=>n.getAttribute('aria-controls'));return ids.indexOf('navMails')===ids.indexOf('navCliente')+1 && ids.indexOf('navAdmin')===ids.indexOf('navMails')+1;}),'Principal Mails order');
    assert(await page.locator('#mailboxWorkspace [data-compose]').count()===0,'No duplicate campaign toolbar button');
      const group = id => page.locator('.sidebar-group[aria-controls=' + id + ']');
      const visible = () => page.evaluate(() => [...document.querySelectorAll('.sidebar-group-zone > .sidebar-children')].filter(p => !p.hidden).map(p => p.id));
      const expectGroup = async id => assert(JSON.stringify(await visible()) === JSON.stringify(id ? [id] : []), 'Visible group: ' + id);
      const checkBounds = async () => assert(await page.evaluate(() => {
        const sidebar = document.querySelector('#adminSidebar').getBoundingClientRect();
        return [...document.querySelectorAll('.sidebar-children')].filter(p => !p.hidden && p.getClientRects().length).every(p => {
          const rect = p.getBoundingClientRect(); const button = document.querySelector('[aria-controls=' + p.id + ']');
          return rect.left >= sidebar.left && rect.right <= sidebar.right && rect.top >= button.getBoundingClientRect().bottom - 1 && getComputedStyle(p).position === 'static';
        });
      }), 'All panels inline within sidebar');
      if (mobile) await page.locator('#sidebarToggle').tap();
      await group('navMails').click();
      if (!mobile) await page.mouse.move(600, 100);
      await expectGroup(null);
      const previous = await group('navMultimedia').boundingBox();
      await group('navProducto').click(); await expectGroup('navProducto'); await checkBounds();
      const shifted = await group('navMultimedia').boundingBox();
      assert(shifted.y > previous.y + 100, 'Opening Product shifts following headers vertically');
      await page.evaluate(() => {
        window.sidebarChanges = 0; window.sidebarMaxVisible = 0;
        new MutationObserver(records => {
          window.sidebarChanges += records.filter(r => r.attributeName === 'aria-expanded').length;
          const count = [...document.querySelectorAll('.sidebar-group-zone > .sidebar-children')].filter(p => !p.hidden).length;
          window.sidebarMaxVisible = Math.max(window.sidebarMaxVisible, count);
        }).observe(document.querySelector('#adminSidebar'), { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });
      });
      if (!mobile) {
        const enter = async (id, steps) => {
          await page.mouse.move(600, 110); // Exit really restores the pinned layout.
          const rect = await group(id).boundingBox();
          await page.mouse.move(600, rect.y + rect.height / 2);
          await page.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps });
          await expectGroup(id); await checkBounds();
          const changes = await page.evaluate(() => window.sidebarChanges);
          await page.waitForTimeout(120);
          await expectGroup(id);
          assert(await page.evaluate(before => window.sidebarChanges === before, changes), 'Stationary pointer has no layout cascade');
        };
        for (const steps of [24, 1]) for (const id of ['navMultimedia', 'navCliente', 'navAdmin', 'navMultimedia']) await enter(id, steps);
        // Traverse headers inside the column too, without resetting hover outside it.
        let rect = await group('navMultimedia').boundingBox();
        await page.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps: 24 });
        for (const steps of [24, 1]) for (const id of ['navCliente', 'navAdmin', 'navMultimedia']) {
          rect = await group(id).boundingBox();
          await page.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps });
          await expectGroup(id); await checkBounds();
          const changes = await page.evaluate(() => window.sidebarChanges); await page.waitForTimeout(120);
          assert(await page.evaluate(before => window.sidebarChanges === before, changes), 'Direct traversal settles without oscillation');
        }
        // Reach a displaced panel with continuous real movement, without leaving the column.
        const gallery = await page.locator('.sidebar-subgroup').boundingBox();
        await page.mouse.move(gallery.x + 50, gallery.y + gallery.height / 2, { steps: 24 });
        await expectGroup('navMultimedia');
        assert(await page.locator('.sidebar-subgroup').getAttribute('aria-expanded') === 'true', 'Gallery opens with actual hover');
        await page.locator('.sidebar-subgroup').click();
        assert(await page.locator('.sidebar-subgroup').getAttribute('aria-expanded')==='true','Hover becomes pinned');
        await page.locator('.sidebar-subgroup').click();
        await page.waitForTimeout(120);
        assert(await page.locator('.sidebar-subgroup').getAttribute('aria-expanded')==='false','Unpin stays closed under stationary pointer');
        await page.mouse.move(600,110);await expectGroup('navProducto');
        for(const steps of [24,1]) {
          await enter('navMultimedia',steps);
          const header=await page.locator('.sidebar-subgroup').boundingBox();
          await page.mouse.move(header.x+50,header.y+header.height/2,{steps});
          assert(await page.locator('.sidebar-subgroup').getAttribute('aria-expanded')==='true','Nested temporary hover');
          await page.mouse.move(600,110,{steps});await expectGroup('navProducto');
          assert(await page.locator('.sidebar-subgroup').getAttribute('aria-expanded')==='false','Nested temporary closes on exit');
        }
        await enter('navMultimedia',24);
        const header=await page.locator('.sidebar-subgroup').boundingBox();
        await page.mouse.move(header.x+50,header.y+header.height/2,{steps:24});
        await page.locator('.sidebar-subgroup').click();
        const link = await page.locator('[data-nav-target=section-gallery-carousel]').boundingBox();
        await page.mouse.move(link.x + 45, link.y + link.height / 2, { steps: 24 }); await expectGroup('navMultimedia');
        await page.locator('[data-nav-target=section-gallery-carousel]').click();
        assert(page.url().includes('carousel'), 'Carousel navigates through inline nested links');
        // Navigating pins Multimedia. Temporaries still restore it on leaving.
        await enter('navAdmin', 24); await page.mouse.move(600, 110); await expectGroup('navMultimedia');
        await enter('navCliente', 1); await group('navCliente').click(); await page.mouse.move(600, 110); await expectGroup('navCliente');
        await group('navCliente').click(); await expectGroup(null);
        const changes = await page.evaluate(() => window.sidebarChanges); await page.waitForTimeout(120);
        assert(await page.evaluate(before => window.sidebarChanges === before, changes), 'Unpin does not immediately reopen');
        await enter('navAdmin', 24); await page.mouse.move(600, 110); await expectGroup(null);
      } else {
        await group('navMultimedia').tap(); await expectGroup('navMultimedia');
        await page.locator('.sidebar-subgroup').tap(); await checkBounds();
        await page.locator('[data-nav-target=section-gallery-carousel]').tap();
        assert(page.url().includes('carousel'), 'Touch descendant navigates');
        await page.locator('#sidebarToggle').tap();
      }
      // Keyboard works with the real vertical geometry and native disclosure buttons.
      await group('navAdmin').focus(); await page.keyboard.press('Enter'); await expectGroup('navAdmin');
      await page.keyboard.press('Space'); await expectGroup(null);
      await group('navMultimedia').focus(); await page.keyboard.press('Enter'); await expectGroup('navMultimedia');
      const nested = page.locator('.sidebar-subgroup');
      if (await nested.getAttribute('aria-expanded') === 'true') { await nested.focus(); await page.keyboard.press('Enter'); }
      await nested.focus(); await page.keyboard.press('Enter');
      await page.locator('[data-nav-target=section-gallery-mosaic]').focus(); await page.keyboard.press('Escape');
      assert(await nested.getAttribute('aria-expanded') === 'false', 'Nested Escape closes only Gallery'); await expectGroup('navMultimedia');
      await nested.focus(); await page.keyboard.press('Enter');
      await page.locator('[data-nav-target=section-gallery-mosaic]').focus(); await page.keyboard.press('Enter');
      assert(!page.url().includes('carousel') && await page.locator('#section-gallery').isVisible(), 'Mosaic keyboard navigation');
      if (mobile) await page.locator('#sidebarToggle').tap();
      await checkBounds();
      assert(await page.evaluate(() => [...document.querySelectorAll('.sidebar-group,.sidebar-subgroup')].every(b => b.getAttribute('aria-expanded') === String(!document.getElementById(b.getAttribute('aria-controls')).hidden))), 'ARIA matches each disclosure');
      assert(await page.evaluate(() => window.sidebarMaxVisible <= 1), 'No principal panel overlap');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#adminSidebar').scrollWidth <= document.querySelector('#adminSidebar').clientWidth), 'No document or sidebar horizontal overflow');
      await page.setViewportSize({ width: mobile ? 390 : 1440, height: 480 });
      const last = page.locator('#logoutBtn'); await last.scrollIntoViewIfNeeded();
      assert(await last.isVisible() && await page.evaluate(() => document.querySelector('#adminSidebar').scrollTop > 0), 'Sidebar scroll remains usable on short viewport');
      await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
      await page.locator('#adminSidebar').evaluate(n => { n.scrollTop = 0; });
      await page.screenshot({ path: `output/playwright/sidebar-inline-${theme}-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });

    if (mobile && !await page.evaluate(()=>document.body.classList.contains('sidebar-open'))) await page.locator('#sidebarToggle').tap();
    await group('navMails').click();
    await page.evaluate(()=>{window.templateLoads=0;window.CRONOX_MAILS={load:()=>{window.templateLoads++;},canLeave:()=>true};});
    await page.locator('[data-nav-target=section-mails]').click();
    assert(await page.locator('#section-mails').isVisible() && await page.evaluate(()=>window.templateLoads===1),'Templates route uses existing module');
    assert(await page.locator('[data-nav-target=section-mails]').getAttribute('aria-current')==='page','Templates active');
    if (mobile) await page.locator('#sidebarToggle').tap();
    await page.locator('[data-nav-target=section-inbox]').click();
    await page.locator('[data-message="message-0"]').waitFor();
    assert(await page.locator('.mail-toolbar h2').textContent()==='Buzones','Mailbox visible title');
    if (mobile) await page.locator('#sidebarToggle').tap();
    await page.locator('[data-nav-target=section-mail-campaign]').click();
    await page.locator('#mailCampaignForm').waitFor();
    assert(await page.locator('[data-nav-target=section-mail-campaign]').getAttribute('aria-current')==='page','Campaign active');
    assert(saves===0&&drafts.size===0,'Direct entry does not save or enqueue');
    await page.locator('[name=campaignName]').fill('Unsaved local review');
    const field=await page.locator('[name=campaignName]').elementHandle();
    await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-mail-campaign'));
    assert(await field.evaluate(n=>n.isConnected),'Repeated entry preserves composer');
    page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());
    await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-inbox'));
    assert(page.url().endsWith('#section-mail-campaign') && await page.locator('[name=campaignName]').inputValue()==='Unsaved local review','Declining unsaved guard preserves route and form');
    page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());
    await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-inbox'));await page.locator('[data-message="message-0"]').waitFor();
    await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-mail-campaign'));await page.locator('#mailCampaignForm').waitFor();
    await page.locator('[data-drafts]').click();await page.locator('[data-campaign-list=history]').waitFor();
    assert(page.url().endsWith('#section-inbox') && await page.locator('[data-nav-target=section-inbox]').getAttribute('aria-current')==='page','Draft/outbox/history belong to Mailboxes');
    await page.locator('[data-campaign-list=outbox]').click();await page.locator('[data-campaign-list=history]').click();
    const listCalls=requests.filter(r=>r.path==='/messages').length;
    await page.goto('about:blank');await page.goto(origin+'/admin.html#section-mail-campaign');
    await page.evaluate(theme=>{
      document.documentElement.dataset.adminTheme=theme;
      document.querySelector('#adminShell').hidden=false; document.querySelector('#adminAuthCheck').remove();
      document.querySelectorAll('.admin-section').forEach(el=>{el.hidden=el.id!=='section-inbox';});
      window.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({'x-csrf-token':'local-fixture'}), getMe:async()=>({id:1,role:'SUPERADMIN'}), admin:{getDashboard:async()=>({})}};
      const nativeFetch=window.fetch; window.fetch=(url,options)=>nativeFetch(url,{...options,signal:undefined});
      window.setInterval=(fn,ms)=>{if(ms===30000)window.testPulse=fn;return 1;};
    },theme);
    await page.addScriptTag({url:origin+'/assets/admin-shell.js'});
    await page.addScriptTag({url:origin+'/assets/admin-inbox.js'});
    await page.addScriptTag({url:origin+'/assets/admin.js'});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.locator('#mailCampaignForm').waitFor();
    assert(requests.filter(r=>r.path==='/messages').length===listCalls,'Deep campaign link does not first load the mailbox list');
    assert(await page.locator('[data-nav-target=section-mail-campaign]').getAttribute('aria-current')==='page','Deep campaign link active');
    for(const destination of ['section-mails','section-inbox','section-mail-campaign']) {
      await page.goto('about:blank');await page.goto(origin+'/admin-user.html?id=1');
      await page.evaluate(theme=>{document.documentElement.dataset.adminTheme=theme;document.querySelector('#adminUserPage').hidden=false;document.documentElement.dataset.adminAuthState='authorized';document.querySelector('#adminAuthCheck').hidden=true;},theme);
      await page.addScriptTag({url:origin+'/assets/admin-shell.js'});await page.addScriptTag({url:origin+'/assets/admin-user-shell.js'});
      if(mobile)await page.locator('#sidebarToggle').tap();
      await page.locator('[aria-controls=navMails]').click();
      await page.locator('[data-nav-target='+destination+']').click();
      await page.waitForURL('**/admin.html#'+destination);
      assert(page.url().endsWith('#'+destination),'User-detail variant links to '+destination);
    }
    assert(errors.length===0,'No console or runtime errors: '+errors.join(';'));
    results.push({width,theme,realPointer:!mobile,touch:mobile,navigation:true,gallery:true,unsavedGuard:true,simulated:true});
    await variantContext.close();
  }
  return results;
}
