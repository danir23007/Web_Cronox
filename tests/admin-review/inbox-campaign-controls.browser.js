async (initialPage) => {
  let page = initialPage, touchContext;
  const origin = 'http://127.0.0.1:4173';
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  page.removeAllListeners('dialog'); page.on('dialog', dialog => dialog.accept());
  for (const width of [1366,390]) for (const theme of ['light','dark']) {
    if (width === 390 && !touchContext) {
      touchContext = await initialPage.context().browser().newContext({hasTouch:true,isMobile:true,viewport:{width:390,height:900}});
      page = await touchContext.newPage(); page.on('dialog', dialog => dialog.accept());
    }
    await page.unrouteAll({behavior:'wait'});
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
    await page.setViewportSize({width,height:900}); await page.goto(origin+'/admin.html');
    await page.evaluate(theme=>{
      document.documentElement.dataset.adminTheme=theme;
      document.querySelector('#adminShell').hidden=false; document.querySelector('#adminAuthCheck').remove();
      document.querySelectorAll('.admin-section').forEach(el=>{el.hidden=el.id!=='section-inbox';});
      window.CRONOX_API={API_BASE:'',getCsrfHeaders:async()=>({'x-csrf-token':'local-fixture'})};
      const nativeFetch=window.fetch; window.fetch=(url,options)=>nativeFetch(url,{...options,signal:undefined});
      window.setInterval=fn=>{window.testPulse=fn;return 1;};
    },theme);
    await page.addScriptTag({url:origin+'/assets/admin-shell.js'});
    await page.addScriptTag({url:origin+'/assets/admin-inbox.js'});
    await page.evaluate(()=>{document.documentElement.dataset.adminAuthState='authorized';});
    await page.locator('[data-message="message-0"]').waitFor({state:'attached'});
    const folderBlock=page.locator('.mail-folder-filter');
    assert(!await folderBlock.evaluate(el=>el.open),'Folders closed initially');
    assert(await folderBlock.evaluate(el=>Math.abs(el.getBoundingClientRect().height-el.querySelector('summary').getBoundingClientRect().height)<1),'Folded block occupies only its header');
    assert(await page.locator('.mail-filters button').count()===0,'Search button removed');
    const calls=requests.filter(r=>r.path==='/messages').length;
    await folderBlock.locator('summary')[width === 390 ? 'tap' : 'click']();
    assert(await page.locator('[data-folder-id="inbox"]').isChecked(),'Inbox selected');
    assert(!await page.locator('[data-folder-id="draft"]').isChecked(),'Draft not selected');
    assert(!await page.locator('[data-folder-id="sent"]').isChecked(),'Sent not selected');
    await folderBlock.locator('summary').click();
    assert(requests.filter(r=>r.path==='/messages').length===calls,'Folding does not query or change filters');
    await folderBlock.locator('summary').focus(); await page.keyboard.press('Space');
    assert(await folderBlock.evaluate(el=>el.open),'Keyboard opens folder block');
    await page.locator('[data-folder-id="sent"]').check(); await page.locator('[data-folder-id="inbox"]').uncheck();
    await page.locator('[data-message="sent-message"]').waitFor();
    assert(await page.locator('[data-message]').count()===1,'Explicit Sent only');
    await page.locator('[data-folder-id="sent"]').uncheck(); await page.locator('[data-folder-id="inbox"]').check();
    await folderBlock.locator('summary').click();
    await page.locator('[data-state]').selectOption('read');
    await page.waitForFunction(()=>document.querySelector('[data-pagination]').textContent.includes('29 mensajes'));
    await page.locator('[data-next]').click();
    await page.waitForFunction(()=>document.querySelector('[data-pagination]').textContent.includes('2 / 2'));
    await page.locator('[data-state]').selectOption('unread');
    await page.waitForFunction(()=>document.querySelectorAll('[data-message]').length===1);
    await page.locator('[data-message="message-0"]').click();
    await page.locator('[data-read-state]').filter({hasText:'confirmado'}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('[data-message]').length===0);
    assert((await page.locator('[data-messages]').innerText()).includes('No hay correos no leídos'),'No read fallback');
    assert((await page.locator('.mail-reader iframe').getAttribute('srcdoc')).includes('Opened body retained'),'Reader retained when removed by filter');
    assert(await page.locator('[data-box]').last().innerText().then(s=>s.includes('0 no leídos')),'Unread count updated');
    await page.locator('[data-unread]').click();
    await page.locator('[data-message="message-0"]').waitFor({state:'attached'});
    assert((await page.locator('.mail-reader iframe').getAttribute('srcdoc')).includes('Opened body retained'),'Unread action retains reader');
    await page.locator('.mail-reader [data-back]').click();
    rows[0].seen=true; await page.evaluate(()=>window.testPulse());
    await page.waitForFunction(()=>document.querySelectorAll('[data-message]').length===0);
    await page.locator('[data-state]').selectOption('all');
    await page.locator('[data-search]').fill('slow'); await page.waitForTimeout(280);
    await page.locator('[data-search]').fill('Alpha');
    await page.locator('[data-message="message-0"]').waitFor({state:'attached'}); await page.waitForTimeout(400);
    assert(await page.locator('[data-message]').count()===1,'Old ignored-abort response discarded');
    await page.locator('[data-search]').fill('');
    await page.waitForFunction(()=>document.querySelector('[data-pagination]').textContent.includes('30 mensajes'));
    assert(requests.filter(r=>r.path==='/messages').at(-1).query.page==='1','Filter resets pagination');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`output/playwright/inbox-controls-${width}-${theme}.png`,fullPage:true});

    await page.locator('[data-compose]').click(); await page.locator('#mailCampaignForm').waitFor();
    assert(saves===0&&drafts.size===0,'Opening campaign is not a saved draft');
    assert(await page.locator('[data-review]').count()===0,'Independent review removed');
    await page.locator('[name="campaignName"]').fill('Revisión interna CRONOX');
    await page.locator('[name="familyId"]').selectOption('family');
    await page.locator('[data-circle][value="3"]').check();
    await page.locator('[data-audience-count]').filter({hasText:'0 destinatarios'}).waitFor();
    assert(await page.locator('[data-send]').isDisabled(),'Real zero audience blocks sending');
    await page.locator('[data-circle][value="3"]').uncheck();
    await page.locator('[data-circle][value="1"]').check(); await page.locator('[data-circle][value="2"]').check();
    await page.locator('[data-audience-count]').filter({hasText:'3 destinatarios'}).waitFor();
    audienceFail=true;
    await page.locator('[data-circle][value="3"]').check();
    await page.locator('[data-audience-count]').filter({hasText:'No se ha podido'}).waitFor();
    assert(await page.locator('[data-send]').isDisabled(),'Audience error differs from zero and blocks sending');
    await page.getByRole('button',{name:'Reintentar cálculo',exact:true}).click();
    await page.locator('[data-audience-count]').filter({hasText:'3 destinatarios'}).waitFor();
    assert(saves===0&&drafts.size===0,'Name/family/circles/count do not save');
    assert(await page.locator('[data-schedule-send]').isDisabled(),'Scheduling requires date');
    assert(!await page.locator('[data-send]').isDisabled(),'Immediate send does not need date');
    const download=page.waitForEvent('download'); await page.locator('[data-export-recipients]').click(); await download;
    assert(exportCalls===1&&saves===0&&enqueues===0,'Export is query only');
    await page.locator('[data-audience-count]').filter({hasText:'3 destinatarios'}).waitFor();
    await page.locator('[data-send]').evaluate(button=>{button.click();button.click();});
    await page.getByRole('dialog').waitFor();
    assert(await page.getByRole('dialog').count()===1,'Double activation opens one confirmation');
    assert((await page.getByRole('dialog').innerText()).includes('¿Seguro que quieres enviar esta campaña ahora?'),'Required modal');
    assert((await page.getByRole('dialog').innerText()).includes('Revisión interna CRONOX'),'Modal name');
    assert(enqueues===0&&saves===0,'No enqueue before confirmation');
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    await page.locator('[data-send]:not([disabled])').waitFor();
    assert(enqueues===0&&saves===0,'Cancel is read-only');
    await page.locator('[data-save]').click();
    await page.locator('[data-save-state]').filter({hasText:'Borrador guardado'}).waitFor();
    assert(saves===1&&drafts.size===1,'Explicit save only');
    await page.locator('[data-schedule]').fill('2020-01-01T12:00');
    await page.locator('[data-date-state]').filter({hasText:'futura'}).waitFor();
    assert(await page.locator('[data-schedule-send]').isDisabled(),'Past rejected');
    await page.locator('[data-schedule]').fill('2028-05-12T15:00');
    await page.locator('[data-schedule-send]:not([disabled])').waitFor();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`output/playwright/campaign-controls-${width}-${theme}.png`,fullPage:true});
    await page.locator('[data-schedule-send]').click(); await page.getByRole('dialog').waitFor();
    await page.screenshot({path:`output/playwright/campaign-confirm-${width}-${theme}.png`});
    await page.getByRole('button',{name:'Confirmar envío',exact:true}).click();
    await page.locator('h3').filter({hasText:'Salida de campaña'}).waitFor();
    assert(enqueues===1&&drafts.size===1,'Saved draft becomes one outbox item');
    await page.locator('[data-drafts]').click(); await page.locator('[data-campaign-list="outbox"]').click();
    await page.locator('[data-draft]').waitFor();
    assert((await page.locator('[data-draft]').innerText()).includes('Revisión interna CRONOX'),'Outbox name visible');
    await page.locator('[data-campaign-list="drafts"]').click();
    await page.getByText('No hay borradores para mostrar.',{exact:true}).waitFor();
    await page.locator('[data-compose]').click(); await page.locator('[name="campaignName"]').fill('Borrador incompleto');
    await page.locator('[data-save]').click(); await page.locator('[data-save-state]').filter({hasText:'Borrador guardado'}).waitFor();
    await page.locator('[data-drafts]').click(); await page.locator('[data-draft]').filter({hasText:'Borrador incompleto'}).waitFor();
    await page.locator('[data-draft]').click(); await page.locator('[name="campaignName"]').waitFor();
    assert(await page.locator('[name="campaignName"]').inputValue()==='Borrador incompleto','Draft name preserved on edit');
    assert(await page.locator('[data-send]').isDisabled(),'Incomplete is not sendable');
    await page.locator('[name="familyId"]').selectOption('family');
    await page.locator('[data-circle][value="1"]').check();
    await page.locator('[data-send]:not([disabled])').waitFor();
    loseNextSend=true;
    await page.locator('[data-send]').click();
    await page.getByRole('button',{name:'Confirmar envío',exact:true}).click();
    await page.locator('[data-send]:not([disabled])').waitFor();
    await page.locator('[name="campaignName"]').fill('Nuevo nombre tras respuesta perdida');
    await page.locator('[data-send]').click();
    await page.getByRole('button',{name:'Confirmar envío',exact:true}).click();
    await page.locator('h3').filter({hasText:'Salida de campaña'}).waitFor();
    assert(sends.size===2&&drafts.size===2,'Retry after lost response and edit does not create another campaign');
    assert(await page.locator('[name="campaignName"]').inputValue()==='Borrador incompleto','Recovery retains originally confirmed name');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    results.push({width,theme,touch:width===390,saves,enqueues,exportCalls,audienceCalls,result:'PASS'});
  }
  if (touchContext) await touchContext.close();
  return results;
}
