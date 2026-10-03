async(page)=>{
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  if(new URL(page.url()).origin!=='http://127.0.0.1:43121')throw Error('ISOLATED_REVIEW_REQUIRED');
  const results=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://127.0.0.1:43121/__mailreview/superadmin');
    await page.locator('[data-nav-target=section-mails]').click();
    await page.locator('[data-mail-action=account][data-key=INFO]').click();
    await page.locator('[data-mail-action=families]').click();
    await page.locator('[data-family-create]').waitFor();
    await page.setViewportSize({width,height:1000});
    const section=page.locator('#mailWorkspace section').filter({has:page.locator('input[value="Static fixture family"]')});
    assert(await section.locator('[data-version-edit]').count()===5,'Five independent editor links');
    await section.locator('[data-version-edit]').first().click();
    await page.locator('[data-field=textOverride]').waitFor();
    await page.locator('[data-field=subject]').fill('Editor subject '+width);
    await page.locator('[data-field=textOverride]').fill('Independent plain text '+width);
    await page.locator('[data-mail-action=save]').click();
    await page.locator('#mailFeedback').filter({hasText:'guardado'}).waitFor();
    const stored=await page.evaluate(async()=>{const data=await window.CRONOX_API.admin.mailRequest('/INFO/families');const f=data.families.find(f=>f.name==='Static fixture family');return Promise.all(f.versions.map(v=>window.CRONOX_API.admin.mailRequest('/INFO/templates/'+v.id)));});
    assert(stored.find(t=>t.campaignCircle===1).subject==='Editor subject '+width,'Selected circle subject saved');
    assert(stored.find(t=>t.campaignCircle===1).text==='Independent plain text '+width,'Separate plain text saved');
    assert(stored.find(t=>t.campaignCircle===2).subject==='Circle 2','Other circle unchanged');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow in version editor');
    await page.screenshot({path:`test-results/admin-review/family-editor-${width}.png`,fullPage:true});
    results.push({width,versions:5,independentSubjectAndText:true,otherCircleUnchanged:true});
  }
  return results;
}
