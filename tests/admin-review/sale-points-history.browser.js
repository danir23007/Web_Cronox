async (page) => {
  const check=(value,message)=>{if(!value)throw new Error(message);};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(await page.locator('.pos-editor [data-action=cancel]').count())await page.locator('.pos-editor [data-action=cancel]').click();
  await page.goto('http://localhost:3000/admin.html#section-sale-points');await page.reload();
  const points=await(await page.request.get('http://localhost:3000/api/admin/sale-points')).json();
  const point=points.find(p=>p.name.startsWith('TEST opciones stock 1440'));
  check(!!point,'Local multi-product test point');const results=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});
    await page.goto(`http://localhost:3000/admin.html#section-sale-points?point=${point.id}&from=2026-10-01&to=2026-10-31`);
    await page.getByRole('heading',{name:point.name,exact:true}).waitFor();
    const field=page.getByRole('combobox',{name:'Filtrar historial por producto'});
    await field.click();await page.locator('#pos-history-options').waitFor();
    const count=await page.locator('#pos-history-options [role=option]').count();check(count>0&&count<=10,'Top ten suggestions');
    await field.fill('DEDUCT_NOW');check(await page.locator('#pos-history-options [role=option]').count()===1,'Predictive match');
    await page.screenshot({path:`output/playwright/points-history-${width}.png`,fullPage:true});
    await page.locator('#pos-history-options [role=option]').click();
    await page.waitForFunction(()=>new URLSearchParams(location.hash.split('?')[1]).has('productId'));
    await page.getByRole('heading',{name:point.name,exact:true}).waitFor();
    const selected=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('productId');
    let report=await(await page.request.get(`http://localhost:3000/api/admin/sale-points/${point.id}?from=2026-10-01&to=2026-10-31&productId=${selected}`)).json();
    check(report.sales.length===1&&report.sales.every(s=>s.state.lines.some(l=>String(l.productId)===selected)),'Exact selected history');
    check(report.report.products.length===2,'Suggestions and totals independent of history selection');
    await page.reload();await page.getByRole('heading',{name:point.name,exact:true}).waitFor();
    check(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('productId')===selected,'Selection persisted');
    await field.fill('ALREADY_ADJUSTED');await field.press('ArrowDown');await field.press('Enter');
    await page.waitForFunction(previous=>new URLSearchParams(location.hash.split('?')[1]).get('productId')!==previous,selected);
    await page.getByRole('heading',{name:point.name,exact:true}).waitFor();
    await field.fill('no-such-product');check(await page.locator('#pos-history-options [role=option]').count()===0,'No matches');
    await field.press('Escape');check(await page.locator('#pos-history-options').isHidden(),'Escape closes suggestions');
    await field.fill('');await field.press('Enter');
    await page.waitForFunction(()=>!new URLSearchParams(location.hash.split('?')[1]).has('productId'));
    await page.getByRole('heading',{name:point.name,exact:true}).waitFor();
    results.push({width,topSuggestions:count,mouseSelection:true,keyboardSelection:true,persistence:true,clear:true});
  }
  check(errors.length===0,'Page errors: '+errors.join('; '));return {passed:true,results,errors};
}
