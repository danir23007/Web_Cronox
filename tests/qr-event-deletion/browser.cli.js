// Real administrator HTML/CSS/JS with an isolated stateful API. No stored event
// or user is modified; real database/permission races have a separate SQL test.
async page => {
  const origin='http://127.0.0.1:4173',results=[];
  const check=(value,message)=>{if(!value)throw Error(message);};
  for(const old of page.context().browser().contexts())if(old!==page.context())await old.close();
  for(const scenario of ['desktop','mobile','admin','last-page']){
    const width=scenario==='desktop'?1366:scenario==='last-page'?320:390;
    const context=await page.context().browser().newContext({viewport:{width,height:900}});
    let groups=Array.from({length:scenario==='last-page'?26:2},(_,i)=>({id:`00000000-0000-4000-a000-${String(i+1).padStart(12,'0')}`,
      name:`Prueba ${i+1} — Evento de escaneo con nombre suficientemente largo para comprobar el ajuste en móvil`,description:'Descripción conservada del evento de prueba.',total:i===0?0:3}));
    let writes=0,fail=scenario==='desktop';const queries=[];
    await context.addInitScript(()=>{window.__CRONOX_API_BASE__=location.origin;});
    const actor={id:99,identityUid:'11111111-1111-4111-a111-111111111111',memberCode:'CRX-000099',role:scenario==='admin'?'ADMIN':'SUPERADMIN',name:'Administrador de prueba',email:'admin@example.test'};
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname;
      const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/me')return reply(200,actor);
      if(path==='/api/auth/csrf')return reply(200,{csrfToken:'qr-delete-isolated-fixture'});
      if(path==='/api/admin/qr-events'){
        const pageNumber=Number(url.searchParams.get('page')||1),limit=Number(url.searchParams.get('limit')||25);queries.push(url.search);
        return reply(200,{canDelete:actor.role==='SUPERADMIN',items:groups.slice((pageNumber-1)*limit,pageNumber*limit),page:pageNumber,limit,total:groups.length,pages:Math.max(1,Math.ceil(groups.length/limit))});
      }
      if(path.startsWith('/api/admin/qr-events/')){
        const id=path.split('/')[4],group=groups.find(g=>g.id===id);
        if(req.method()==='DELETE'){
          writes++;check(req.postDataJSON().confirmed===true,'Missing explicit confirmation');
          check(!!req.headers()['x-csrf-token'],'Missing CSRF header');
          if(fail){fail=false;return reply(500,{message:'Internal server error'});}
          await new Promise(resolve=>setTimeout(resolve,350));groups=groups.filter(g=>g.id!==id);
          return reply(200,{id,deleted:true,alreadyDeleted:!group});
        }
        if(!group)return reply(404,{code:'GROUP_UNAVAILABLE'});
        return reply(200,{group,items:[],total:0,page:1,limit:25,pages:1});
      }
      return reply(200,{items:[],data:[],total:0});
    });
    const tab=await context.newPage();await tab.goto(origin+'/admin.html#section-qr-events');
    await tab.locator('#qrEventsList article').first().waitFor();
    const initial=await tab.locator('#qrEventsList article').first().evaluate(card=>{
      const heading=card.querySelector('h3').getBoundingClientRect(),button=card.querySelector('.qr-events-delete')?.getBoundingClientRect();
      return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overlap:button?heading.right>button.left-8:false};
    });
    check(initial.scrollWidth<=initial.width,'Mobile horizontal overflow');check(!initial.overlap,'Delete overlaps title');
    check(await tab.locator('#qrEventsList').getByRole('button',{name:/Abrir grupo/}).count()>0,'Missing open group');
    if(scenario==='admin'){
      check(await tab.locator('#qrEventsList .qr-events-delete').count()===0,'ADMIN can see delete');
      await tab.screenshot({path:'output/playwright/qr-event-delete-admin.png',fullPage:true});results.push({scenario,deleteHidden:true});await context.close();continue;
    }
    if(scenario==='last-page'){
      await tab.locator('#qrEventsSearch').fill('Prueba');await tab.locator('#qrEventsSearch').press('Enter');
      await tab.locator('#qrEventsNext').click();await tab.waitForFunction(()=>document.querySelector('#qrEventsPage').textContent.includes('Página 2'));
    }
    const targetId=await tab.locator('#qrEventsList article').first().getAttribute('data-group-id');
    const target=groups.find(g=>g.id===targetId);
    await tab.locator('#qrEventsList .qr-events-delete').first().click();
    check((await tab.locator('#qrEventsDeleteDescription').textContent()).includes(target.name),'Wrong dialog event');
    check((await tab.locator('#qrEventsDeleteCount').textContent()).includes(String(target.total)),'Wrong participants');
    await tab.locator('#qrEventsDeleteCancel').click();check(writes===0,'Cancellation sent DELETE');
    await tab.locator('#qrEventsList .qr-events-delete').first().click();
    if(scenario==='desktop'){
      await tab.locator('#qrEventsDeleteConfirm').click();await tab.locator('#qrEventsDeleteError').waitFor({state:'visible'});
      check(await tab.locator(`[data-group-id="${targetId}"]`).count()===1,'Failure removed card');
    }
    const rect=await tab.locator('#qrEventsDeleteDialog').boundingBox();check(rect.x>=19&&rect.x+rect.width<=width-19,'Dialog outside viewport');
    const color=await tab.locator('#qrEventsDeleteConfirm').evaluate(el=>getComputedStyle(el).backgroundColor);check(['rgb(165, 28, 50)','rgb(134, 22, 41)'].includes(color),'Missing destructive style');
    await tab.screenshot({path:`output/playwright/qr-event-delete-confirm-${scenario}.png`,fullPage:true});
    await tab.locator('#qrEventsDeleteConfirm').click();check(await tab.locator('#qrEventsDeleteConfirm').isDisabled(),'Confirmation not disabled');
    await tab.waitForFunction(()=>!document.querySelector('#qrEventsDeleteDialog').open);
    await tab.waitForFunction(()=>document.querySelector('#qrEventsMessage').textContent.includes('eliminado correctamente'));
    check(await tab.locator(`[data-group-id="${targetId}"]`).count()===0,'Confirmed card retained');
    check(writes===(scenario==='desktop'?2:1),'Double request');
    if(scenario==='last-page'){
      check((await tab.locator('#qrEventsPage').textContent()).includes('Página 1 de 1'),'Empty page not clamped');
      check((await tab.locator('#qrEventsPage').textContent()).includes('25 grupos'),'Wrong total');
      check(await tab.locator('#qrEventsSearch').inputValue()==='Prueba','Search reset');
    }
    if(scenario==='desktop'){
      const stale=await context.newPage();await stale.goto(origin+'/admin.html#section-qr-events?group='+targetId);
      await stale.waitForFunction(()=>document.querySelector('#qrEventsParticipantMessage').textContent.includes('eliminado'));
      check(await stale.locator('#qrEventsCameraOpen').isDisabled(),'Deleted group camera enabled');
      await stale.locator('#qrEventsBack').click();await stale.waitForFunction(()=>!document.querySelector('#qrEventsOverview').hidden);
      await stale.close();
    }
    await tab.screenshot({path:`output/playwright/qr-event-delete-result-${scenario}.png`,fullPage:true});
    results.push({scenario,width,canceledRequests:0,confirmedRequests:scenario==='desktop'?2:1,errorRetry:scenario==='desktop',noOverlap:true,queries:scenario==='last-page'?queries:undefined});
    await context.close();
  }
  return {passed:true,scenarios:results};
}
