async (page) => {
  if(new URL(page.url()).origin!=='http://127.0.0.1:43121') throw Error('ISOLATED_REVIEW_REQUIRED');
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const results=[];
  const context=page.context();
  let mode='body', slow=false, requests=0;
  const overview=await page.evaluate(()=>fetch('/api/admin/mailbox/overview').then(r=>r.json()));
  const boxId=overview.boxes.find(b=>b.address==='support@example.test').id;
  const messageIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
  const drafts=[];
  await context.route('**/api/admin/mailbox/drafts',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    const input=route.request().postDataJSON(); drafts.push(input);
    return route.fulfill({status:201,json:{id:'33333333-3333-4333-8333-333333333333',mailboxId:boxId,mode:input.mode==='reply'?'reply':'individual',singleReply:input.mode==='reply',to:input.mode==='reply'?input.replyRecipient:'',cc:'',bcc:'',subject:'Fixture draft',text:'Quoted fixture',html:'',revision:1,status:'DRAFT',files:[],sends:[],campaigns:[]}});
  });
  await context.route('**/api/admin/mailbox/messages*',async route=>{
    if(new URL(route.request().url()).pathname!=='/api/admin/mailbox/messages')return route.continue();
    await route.fulfill({json:{messages:messageIds.map((id,index)=>({id,mailboxId:boxId,subject:index?'Second selected':'First delayed',sender:'fixture@example.test',seen:false,bodyState:'LOADED',preview:''})),pagination:{total:2,pages:1}}});
  });
  await context.route('**/api/admin/mailbox/messages/**',async route=>{
    const url=new URL(route.request().url());
    const id=url.pathname.split('/')[5];
    if(!messageIds?.includes(id))return route.continue();
    if(url.pathname.endsWith('/action')) {
      requests++;
      return route.fulfill({status:503,json:{message:'MAILBOX_OPERATION_FAILED'}});
    }
    if(url.pathname.endsWith('/status'))return route.fulfill({json:{seen:false}});
    const isFirst=id===messageIds[0], state=mode;
    if(isFirst && slow) await new Promise(resolve=>setTimeout(resolve,700));
    if(state==='failed'||state==='gone')return route.fulfill({status:state==='gone'?404:503,json:{message:state==='gone'?'MAILBOX_MESSAGE_UNAVAILABLE':'MAILBOX_CONTENT_DOWNLOAD_FAILED'}}).catch(()=>{});
    return route.fulfill({json:{id,mailboxId:boxId,subject:isFirst?'First delayed':'Second selected',seen:false,envelope:{from:[{address:'from@example.test'}],replyTo:[{address:'one@example.test'},{address:'two@example.test'}]},replyChoices:['one@example.test','two@example.test'],files:[],body:{text:isFirst?'First body':'Second body',html:''}}}).catch(()=>{});
  });
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    mode='body'; slow=false;
    await page.goto('http://127.0.0.1:43121/__mailreview/superadmin');
    await page.locator('[data-message]').first().waitFor();
    const labels=await page.locator('[data-folders] label').allTextContents();
    for(const label of ['Bandeja de entrada','Enviados','Borradores','Papelera','Correo no deseado'])assert(labels.some(text=>text.includes(label)),label);
    assert(labels.some(text=>text.includes(' · Bandeja de entrada')),'Combined labels include mailbox');
    await page.locator(`[data-box="${boxId}"]`).click();
    assert((await page.locator('[data-folders] label').allTextContents()).some(text=>text.trim()==='Bandeja de entrada'),'Single mailbox label');
    assert(await page.locator('[data-folder-id]').count()===5,'Checkbox filters preserved');
    assert(!(await page.locator('[data-messages]').innerText()).includes('Contenido pendiente'),'Loaded empty preview is not pending');
    await page.locator('[data-message]').first().click();
    await page.locator('[data-read-state]').filter({hasText:'No se ha confirmado'}).waitFor();
    assert((await page.frameLocator('.mail-reader iframe').locator('body').innerText()).includes('First body'),'Body remains after STORE error');
    assert(await page.locator('[data-reply="replyAll"],[data-restore]').count()===0,'Removed actions');
    assert(await page.locator('[data-reply="reply"],[data-reply="forward"],[data-unread],[data-trash]').count()===4,'Four message actions');
    assert(await page.locator('[data-reply-choice] option').count()===3,'Choose only one Reply-To');
    await page.locator('[data-reply="reply"]').click();
    assert((await page.locator('[data-feedback]').innerText()).includes('única dirección'),'Reply choice is required');
    assert(await page.locator('[data-retry-read]').count()===1,'Read mutation retry is separate from body');
    await page.locator('.mail-reader iframe').scrollIntoViewIfNeeded();
    await page.screenshot({path:`test-results/admin-review/mailbox-reader-${width}.png`,fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Reader has no horizontal overflow');

    await page.locator('[data-reply-choice]').selectOption('two@example.test');
    await page.locator('[data-reply="reply"]').click();
    await page.locator('.mail-editor [name=to]').waitFor();
    assert(await page.locator('.mail-editor [name=to]').inputValue()==='two@example.test','Reply composer has the chosen single address');
    assert(await page.locator('.mail-editor [name=cc],.mail-editor [name=bcc],[data-circle]').count()===0,'Reply composer is independent of circles and CC/BCC');
    assert(drafts.at(-1).mailboxId===boxId && drafts.at(-1).replyRecipient==='two@example.test','Original receiving mailbox');
    await page.locator('.mail-editor [data-back]').click();
    await page.locator('[data-message]').first().click();
    await page.locator('[data-reply="forward"]').click();
    await page.locator('.mail-editor [name=to]').waitFor();
    assert(await page.locator('.mail-editor [name=to]').inputValue()==='','Forward requires an explicit recipient');
    assert(await page.locator('.mail-editor [data-send]').isDisabled(),'Isolated fixture cannot send');
    await page.locator('.mail-editor [data-back]').click();
    await page.locator('[data-message]').first().click();
    await page.locator('.mail-reader iframe').waitFor();

    await page.locator('.mail-reader [data-back]').click();
    slow=true;
    await page.locator('[data-message]').first().click();
    await page.locator('.mail-reader [aria-busy="true"]').waitFor();
    // Simulate a rapid switch even on the mobile reader where the list is hidden.
    if(width===390) await page.locator('.mail-reader [data-back]').click();
    await page.locator(`[data-message="${messageIds[1]}"]`).click();
    await page.locator('.mail-reader h3').filter({hasText:'Second selected'}).waitFor();
    await page.waitForTimeout(900);
    assert((await page.locator('.mail-reader h3').innerText())==='Second selected','Stale body cannot replace current message');
    assert((await page.frameLocator('.mail-reader iframe').locator('body').innerText()).includes('Second body'),'Current body preserved');
    await page.locator('.mail-reader [data-back]').click();
    await page.locator('[data-message]').first().click();
    if(width===390) await page.locator('.mail-reader [data-back]').click();
    await page.locator('[data-box=""]').click();
    await page.waitForTimeout(900);
    assert(await page.locator('#mailboxWorkspace').getAttribute('data-view')==='list','Changing mailbox cancels previous reader');
    assert(!(await page.locator('[data-feedback]').innerText()),'Old read errors cleared');

    slow=false; mode='failed';
    await page.locator('[data-message]').first().click();
    await page.locator('[data-retry-body]').waitFor();
    assert((await page.locator('.mail-reader').innerText()).includes('Ha fallado la descarga'),'Download failure is explicit');
    mode='body';
    await page.locator('[data-retry-body]').click();
    await page.locator('.mail-reader iframe').waitFor();
    await page.locator('.mail-reader [data-back]').click(); mode='gone';
    await page.locator('[data-message]').first().click();
    await page.locator('.mail-reader .mail-error').filter({hasText:'ya no está disponible'}).waitFor();
    assert(await page.locator('[data-retry-body]').count()===0,'Missing provider message is distinct from download failure');
    results.push({width,translations:true,contentStates:true,rapidSwitches:true,actions:true});
  }
  await context.unroute('**/api/admin/mailbox/messages*');
  await context.unroute('**/api/admin/mailbox/messages/**');
  await context.unroute('**/api/admin/mailbox/drafts');
  assert(requests>0,'STORE failures are simulated, not real operations');
  return {results,simulatedActions:requests,realMailOrPushSent:false};
}
