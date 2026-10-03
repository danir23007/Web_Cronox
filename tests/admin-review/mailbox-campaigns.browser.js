async (page) => {
  if(new URL(page.url()).origin!=='http://127.0.0.1:43121')throw Error('ISOLATED_MAILBOX_REVIEW_REQUIRED');
  const assert=(ok,message)=>{if(!ok)throw Error(message);},results=[];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto('http://127.0.0.1:43121/__mailreview/superadmin');
    await page.locator('[data-compose]').waitFor();
    assert(await page.locator('[data-compose]').textContent()==='Nueva campaña','New campaign label');
    await page.locator('[data-box]').filter({hasText:'Soporte'}).first().click();
    await page.locator('[data-compose]').click();
    await page.locator('#mailCampaignForm').waitFor();
    assert((await page.locator('.mail-editor').textContent()).includes('info@cronox.es'),'Fixed Info sender from any selected mailbox');
    assert(await page.locator('#mailCampaignForm [name=to],#mailCampaignForm [name=cc],#mailCampaignForm [name=bcc],#mailCampaignForm [name=subject],#mailCampaignForm [name=text],#mailCampaignForm [name=html],#mailCampaignForm [name=mailboxId],#mailCampaignForm [name=templateId],#mailCampaignForm textarea').count()===0,'No drafting, recipients or sender selector');
    const family=await page.locator('[name=familyId] option').filter({hasText:'Static fixture family'}).getAttribute('value');
    assert(await page.locator('[name=familyId] option').filter({hasText:'Static fixture family'}).count()===1,'One option per stable family');
    assert(!(await page.locator('[name=familyId]').textContent()).includes('Sin plantilla'),'No template-free option');
    await page.locator('[name=familyId]').selectOption(family);
    await page.locator('[data-circle][value="1"]').check();
    await page.locator('[data-circle][value="2"]').check();
    await page.locator('[data-review]').click();
    await page.getByRole('heading',{name:'Resumen antes de confirmar'}).waitFor();
    assert((await page.locator('[data-campaign-review]').textContent()).includes('Circle 1'),'Circle 1 readonly subject');
    assert((await page.locator('[data-campaign-review]').textContent()).includes('Circle 2'),'Circle 2 readonly subject');
    assert((await page.locator('[data-preview-circle="1"]').getAttribute('srcdoc')).includes('Synthetic body circle 1'),'Circle 1 own body');
    assert((await page.locator('[data-preview-circle="2"]').getAttribute('srcdoc')).includes('Synthetic body circle 2'),'Circle 2 own body');
    assert(await page.locator('[data-send]').isDisabled(),'Provider gate remains off; no delivery');
    await page.locator('[data-circle][value="3"]').check();
    assert(await page.locator('[data-campaign-review]').textContent()==='','Changed selection invalidates old review');
    await page.locator('[data-save]').click();
    await page.locator('[data-save-state]').filter({hasText:'Guardado'}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
    await page.screenshot({path:`test-results/admin-review/campaign-families-${width}.png`,fullPage:true});
    await page.locator('.mail-editor [data-back]').click();
    assert(await page.locator('.mail-editor').isHidden(),'Back navigation');
    results.push({width,infoOnly:true,familyOnce:true,noEditor:true,distinctPreviews:true,staleReviewCleared:true,noSend:true});
  }
  return results;
}
