async (page) => {
  const check=(v,m)=>{if(!v)throw new Error(m);};const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(await page.locator('.pos-editor [data-action=cancel]').count())await page.locator('.pos-editor [data-action=cancel]').click();
  await page.goto('http://localhost:3000/admin.html#section-sale-points');await page.reload();
  const results=[];
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.getByRole('button',{name:'Crear punto de venta',exact:true}).click();
    const name='TEST opciones stock '+width+' '+Date.now();await page.getByLabel('Nombre / edición').fill(name);await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();
    check(await page.evaluate(()=>window.CRONOX_API.API_BASE)==='http://localhost:3000','Nonlocal API');
    const id=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('point');
    for(const mode of ['DEDUCT_NOW','ALREADY_ADJUSTED']) {
      const options=await(await page.request.get('http://localhost:3000/api/admin/sale-points/options')).json();
      const variant=options.find(v=>v.name.startsWith('TEST stock '+mode+' '));check(!!variant,'Synthetic local variant required');
      const initial=variant.stock;
      await page.getByRole('button',{name:'Registrar venta',exact:true}).click();
      await page.getByLabel('Producto y talla').selectOption(String(variant.id));await page.getByLabel('Cantidad',{exact:true}).fill('2');await page.getByLabel('Precio pagado por unidad (€)').fill('25.50');
      await page.locator('.pos-editor [name=stockHandling]').selectOption(mode);
      await page.locator('[data-preview]').getByRole('columnheader',{name:'Beneficio',exact:true}).waitFor();
      const dimensions=await page.getByRole('button',{name:'Quitar línea',exact:true}).evaluate(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,cursor:getComputedStyle(b).cursor}));
      check(dimensions.width<180 && dimensions.height<=46,'Proportional remove-line button');
      await page.screenshot({path:`output/playwright/points-stock-${width}-${mode}.png`,fullPage:true});
      await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.pos-editor').waitFor({state:'detached'});
      let after=(await(await page.request.get('http://localhost:3000/api/admin/sale-points/options')).json()).find(v=>v.id===variant.id);
      check(after.stock===initial-(mode==='DEDUCT_NOW'?2:0),'Saved stock mode');
      let detail=await(await page.request.get(`http://localhost:3000/api/admin/sale-points/${id}?from=2026-10-01&to=2026-10-31`)).json();
      const sale=detail.sales.find(s=>s.state.lines.some(l=>l.variantId===variant.id));check(sale.state.stockHandling===mode,'Frozen recorded stock choice');
      await page.locator(`[data-action=correct][data-sale="${sale.id}"]`).click();await page.getByLabel('Cantidad',{exact:true}).fill('3');await page.getByLabel('Motivo de la corrección').fill('TEST diferencia ya ajustada');await page.locator('.pos-editor [name=stockHandling]').selectOption('ALREADY_ADJUSTED');
      await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.pos-editor').waitFor({state:'detached'});
      const corrected=(await(await page.request.get('http://localhost:3000/api/admin/sale-points/options')).json()).find(v=>v.id===variant.id);check(corrected.stock===after.stock,'Correction does not deduct again');
      results.push({width,mode,stockBefore:initial,stockAfter:corrected.stock,removeButton:dimensions});
    }
    const detail=await(await page.request.get(`http://localhost:3000/api/admin/sale-points/${id}?from=2026-10-01&to=2026-10-31`)).json();check(detail.report.totals.profitCents===6300,'Both modes contribute to finance');
    await page.reload();await page.getByRole('heading',{name,exact:true}).waitFor();
    check((await page.locator('.pos-metrics').innerText()).includes('63,00'),'Persisted profit');
    await page.getByRole('button',{name:'Todos los puntos',exact:true}).click();await page.getByRole('heading',{name:'Puntos de venta',exact:true}).waitFor();
  }
  check(errors.length===0,'Page errors: '+errors.join('; '));return {passed:true,results,errors};
}
