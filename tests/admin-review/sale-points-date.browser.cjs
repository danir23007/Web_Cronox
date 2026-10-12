async (page) => {
  await page.addInitScript(()=>{window.__CRONOX_API_BASE__=location.origin;});
  const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
  const check=(v,m)=>{if(!v)throw Error(m);};
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.goto('http://localhost:3000/admin.html#section-sale-points');
    await page.getByRole('button',{name:'Crear punto de venta',exact:true}).click();
    const name=`TEST local fecha ${width} ${Date.now()}`;await page.getByLabel('Nombre / edición').fill(name);
    await page.getByLabel('Comisión predeterminada (%)').fill('0');await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await page.getByRole('heading',{name,exact:true}).waitFor();const id=new URLSearchParams(page.url().split('?').at(-1)).get('point');
    await page.getByRole('button',{name:'Registrar venta',exact:true}).click();
    const variant=await page.getByLabel('Producto y talla').locator('option').evaluateAll(nodes=>nodes.find(n=>n.textContent.includes('Prenda TEST local puntos 2026-10-12'))?.value);
    check(variant,'Missing synthetic local product');await page.getByLabel('Producto y talla').selectOption(variant);
    await page.getByLabel('Cantidad',{exact:true}).fill('2');await page.getByLabel('Precio pagado por unidad (€)').fill('25.50');
    await page.getByLabel('Stock de esta operación').selectOption('ALREADY_ADJUSTED');await page.getByLabel('Fecha de venta · Madrid').fill('2026-10-12T10:00');
    await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.pos-editor').waitFor({state:'detached'});
    const read=()=>page.request.get(`http://localhost:3000/api/admin/sale-points/${id}?from=2026-10-01&to=2026-10-31`).then(r=>r.json());
    const before=await read();const sale=before.sales[0];check(sale,'Sale missing');
    for(const date of ['2026-10-05T10:00','2026-10-07T10:00']){
      await page.getByRole('button',{name:'Editar fecha',exact:true}).click();await page.getByLabel('Fecha de venta · Madrid').fill(date);
      await page.getByLabel('Motivo del cambio de fecha').fill('TEST local fecha corregida');
      await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.pos-editor').waitFor({state:'detached'});
      const after=await read();check(JSON.stringify(after.sales[0].state)===JSON.stringify(sale.state),'Financial state changed');
      check(after.sales[0].soldAt===date+':00.000+02:00'||new Date(after.sales[0].soldAt).toISOString()===date.slice(0,11)+'08:00:00.000Z','Madrid date did not persist');
      check(after.report.totals.revenueCents===5100&&after.report.totals.profitCents===2100&&after.report.totals.salesCount===1,'Totals or sale count changed');
    }
    await page.reload();await page.getByRole('button',{name:'Editar fecha',exact:true}).waitFor();
    await page.getByRole('button',{name:'Editar fecha',exact:true}).click();check(await page.getByLabel('Fecha de venta · Madrid').inputValue()==='2026-10-07T10:00','Reload date differs');
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    const reports={};for(const day of ['2026-10-07','2026-10-12'])reports[day]=await page.request.get(`http://localhost:3000/api/admin/finance?from=${day}&to=${day}&source=points&pointId=${id}`).then(r=>r.json());
    check(reports['2026-10-07'].totals.profitCents===2100&&reports['2026-10-07'].salesCount===1&&reports['2026-10-12'].totals.revenueCents===0&&reports['2026-10-12'].salesCount===0,'General finances did not move dates');
    check(reports['2026-10-07'].buckets.reduce((s,b)=>s+b.profitCents,0)===2100,'Chart differs');
    await page.getByRole('button',{name:'Devolver',exact:true}).click();
    await page.getByLabel('Fecha de devolución · Madrid').fill('2026-10-08T10:00');
    await page.getByLabel('Motivo',{exact:true}).fill('TEST local devolución tras editar fecha');
    await page.getByLabel('Cantidad a devolver').fill('1');await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await page.locator('.pos-editor').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Editar fecha',exact:true}).click();await page.getByLabel('Fecha de venta · Madrid').fill('2026-10-09T10:00');
    await page.getByLabel('Motivo del cambio de fecha').fill('TEST local validación de devolución');
    await page.getByRole('button',{name:'Guardar',exact:true}).click();await page.locator('.pos-editor').getByText('La fecha de venta no puede ser posterior',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    const returned=await read();check(returned.sales[0].state.lines[0].quantity===1&&returned.sales[0].soldAt==='2026-10-07T08:00:00.000Z','Refund/date boundary failed');
    await page.screenshot({path:`output/playwright/sale-date-${width}.png`,fullPage:true});results.push({width,pointId:id,profitBeforeReturnCents:2100,date:'2026-10-07',reload:true,subsequentReturn:true,dateAfterReturnRejected:true});
  }
  check(!errors.length,errors.join('; '));return {passed:true,errors,results};
}
