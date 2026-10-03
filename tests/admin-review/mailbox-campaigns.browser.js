async (page) => {
  if(new URL(page.url()).origin !== 'http://127.0.0.1:43121') throw Error('ISOLATED_MAILBOX_REVIEW_REQUIRED');
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const results=[];
  await page.context().route('https://example.test/**',route=>route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#5279a8"/></svg>'}));
  for(const width of [1440,390]) {
    await page.evaluate(async()=>{window.confirm=()=>true;await window.CRONOX_INBOX?.load();});
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:43121/__mailreview/superadmin');
    await page.locator('[data-boxes] [data-box]').first().waitFor();
    await page.locator('[data-messages] .mail-message').first().waitFor();
    const rows=await page.locator('[data-box]:not([data-box=""])').evaluateAll(buttons=>buttons.map(b=>{
      const name=b.querySelector('strong'),address=b.querySelector('.mail-address'),count=b.querySelector('.mail-unread');
      return {name:!!name,address:!!address,count:!!count,separate:address.getBoundingClientRect().bottom<=count.getBoundingClientRect().top+1,
        color:getComputedStyle(count).color,unread:count.classList.contains('has-unread')};
    }));
    assert(rows.every(r=>r.name&&r.address&&r.count&&r.separate),'Three separate mailbox lines');
    assert(rows.some(r=>r.unread),'Unread fixture');
    assert(rows.filter(r=>r.unread).every(r=>{const rgb=r.color.match(/\d+/g).map(Number);return rgb[0]>rgb[1]&&rgb[0]>rgb[2];}),'Whole unread line red');
    await page.locator('[data-folders-all]').click();
    const selected=await page.locator('[data-folder-id]:checked').count();assert(selected>1,'Multiple real folders');
    await page.locator('[data-folders-clear]').click();
    await page.getByText('No hay carpetas seleccionadas.',{exact:false}).waitFor();
    await page.locator('[data-folder-id]').first().check();
    await page.locator('[data-folder-id]').nth(1).check();
    await page.locator('[data-drafts]').click();
    await page.locator('.mail-editor [data-back]').click();
    assert(await page.locator('[data-folder-id]:checked').count()===2,'Folder choice survives list update');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'List no horizontal overflow');
    await page.screenshot({path:`test-results/admin-review/mailbox-list-${width}.png`,fullPage:true});

    await page.locator('[data-box]').filter({hasText:'Soporte'}).first().click();
    await page.locator('[data-compose]').click();
    await page.locator('[name=templateId]').waitFor();
    assert(await page.locator('[data-circle]').count()===5,'All circles available');
    assert(await page.locator('.mail-editor [name=to],.mail-editor [name=cc],.mail-editor [name=bcc]').count()===0,'Campaign cannot enter manual recipients');
    const options=await page.locator('[name=templateId] option').allTextContents();assert(options.some(v=>v.includes('Static fixture')),'Existing catalog loaded');
    const staticValue=await page.locator('[name=templateId] option').filter({hasText:'Static fixture'}).getAttribute('value');
    await page.locator('[name=templateId]').selectOption(staticValue);
    await page.locator('[data-save-state]').filter({hasText:'Guardado'}).waitFor();
    assert(await page.locator('[name=subject]').inputValue()==='Fixture subject','Template subject');
    assert((await page.locator('[name=html]').inputValue()).includes('https://example.test/image.png'),'Template image design');
    await page.locator('[data-circle]').first().check();
    await page.locator('[data-circle]').nth(1).check();
    await page.locator('[data-recipient-preview]').click();
    await page.locator('[data-recipient-summary]').filter({hasText:'destinatarios válidos y únicos'}).waitFor();
    assert((await page.locator('[data-recipient-summary]').innerText()).includes('Campañas desactivadas'),'Actual provider gate visible');
    await page.locator('[data-edit-design]').click();
    await page.frameLocator('[data-design-editor]').locator('body[contenteditable=true]').waitFor();
    await page.frameLocator('[data-design-editor]').locator('body').press('Control+End');
    await page.frameLocator('[data-design-editor]').locator('body').press('Enter');
    await page.frameLocator('[data-design-editor]').locator('body').press('E');
    await page.locator('[data-save]').press('Enter');
    await page.locator('[data-save-state]').filter({hasText:'Guardado'}).waitFor();
    assert((await page.locator('[name=html]').inputValue()).includes('https://example.test/image.png'),'Editing preserves original template image');
    await page.locator('[data-preview]').click();
    assert(await page.locator('[data-compose-preview]').getAttribute('sandbox')==='','Preview sandbox');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Composer no horizontal overflow');
    await page.screenshot({path:`test-results/admin-review/mailbox-compose-${width}.png`,fullPage:true});

    // Refuse overwriting edits; selected source is never modified.
    await page.locator('[name=subject]').fill('Edited fixture');
    await page.evaluate(()=>{window.confirm=()=>false;});
    await page.locator('[name=templateId]').selectOption(staticValue);
    assert(await page.locator('[name=subject]').inputValue()==='Edited fixture','Overwrite warning preserves edits');
    await page.evaluate(()=>{window.confirm=()=>true;});
    await page.locator('[data-save]').press('Enter');
    await page.locator('[data-save-state]').filter({hasText:'Guardado'}).waitFor();
    const variablesValue=await page.locator('[name=templateId] option').filter({hasText:'Variables fixture'}).getAttribute('value');
    await page.locator('[name=templateId]').selectOption(variablesValue);
    await page.locator('dialog.mail-variable-dialog').waitFor();
    await page.locator('[data-variable=subject]').fill('Resolved in browser');
    await page.locator('[data-variable=message]').fill('Resolved body in browser');
    await page.locator('dialog [value=apply]').click();
    await page.waitForFunction(()=>document.querySelector('[name=subject]')?.value==='Resolved in browser');
    await page.locator('[data-save-state]').filter({hasText:'Guardado'}).waitFor();
    assert(await page.locator('[name=subject]').inputValue()==='Resolved in browser','Template variable form compiles effective content');
    await page.locator('[data-settings]').press('Enter');
    const advanced=page.locator('.mail-settings details.mail-advanced');
    assert(await advanced.getAttribute('open')===null,'Advanced maintenance collapsed');
    assert(await advanced.locator('[name=imapHost]').isVisible()===false,'Technical fields hidden');
    const original=await page.locator('.mail-settings form').evaluate(f=>Object.fromEntries(['imapHost','imapPort','smtpHost','smtpPort','imapSecretRef','smtpSecretRef','sentCopy'].map(k=>[k,f.elements[k].value])));
    await Promise.all([page.waitForResponse(r=>r.url().includes('/api/admin/mailbox/boxes/') && r.request().method()==='PATCH' && r.status()===200),page.locator('.mail-settings [type=submit]').press('Enter')]);
    await page.locator('.mail-settings form').waitFor();
    const after=await page.locator('.mail-settings form').evaluate(f=>Object.fromEntries(['imapHost','imapPort','smtpHost','smtpPort','imapSecretRef','smtpSecretRef','sentCopy'].map(k=>[k,f.elements[k].value])));
    assert(JSON.stringify(original)===JSON.stringify(after),'Saving collapsed settings preserves technical values');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings no horizontal overflow');
    await page.screenshot({path:`test-results/admin-review/mailbox-settings-${width}.png`,fullPage:true});
    await page.locator('[data-devices]').click();
    await page.locator('[data-device-boxes]').waitFor();
    assert(await page.locator('[data-device-boxes]').count()===1,'Push mailbox preferences retained');
    assert(await page.locator('#pushWorkspace details').getAttribute('open')===null,'Push installation help folded');
    results.push({width,mailboxLines:true,multiFolder:true,emptySelection:true,persistedFolders:true,templates:true,circles:true,providerBlocked:true,settingsPreserved:true,noOverflow:true});
  }
  console.log(JSON.stringify(results));
}
