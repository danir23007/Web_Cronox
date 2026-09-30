const {chromium,expect}=require('@playwright/test');
const {mkdirSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const {loadLocalEnvironment}=require('../cronox-backend/scripts/start-local.cjs');
const {PrismaClient}=require('../cronox-backend/node_modules/@prisma/client');
const ExcelJS=require('../cronox-backend/node_modules/exceljs');
(async()=>{
 const env=loadLocalEnvironment();if(new URL(env.DATABASE_URL).hostname!=='127.0.0.1')throw Error('Local only');
 const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}}),tag='nav-qa-'+randomUUID();
 const browser=await chromium.launch(),page=await browser.newPage({acceptDownloads:true});
 mkdirSync('test-results/admin-navigation',{recursive:true});
 try {
  await db.product.createMany({data:Array.from({length:55},(_,i)=>({name:tag+' '+i,slug:tag+'-'+i,price:100}))});
  await page.goto('http://localhost:3000/admin.html');await page.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);await page.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);await page.locator('#adminLoginSubmit').click();await page.waitForURL('**/admin.html');
  await page.goto('http://localhost:3000/admin.html#section-product-categories');
  const category=page.locator('#navProducto [data-nav-target=section-product-categories]');
  await expect(category).toHaveAttribute('aria-current','page');await expect(page.locator('[aria-controls=navProducto]')).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#navProducto button').allTextContents()).toEqual(['Productos','Categorías','Stock','Waitlist','Códigos']);
  await page.reload();await expect(category).toHaveAttribute('aria-current','page');
  await page.locator('#navProducto [data-nav-target=section-products]').click();await page.goBack();await expect(category).toHaveAttribute('aria-current','page');
  await page.goForward();await expect(page.locator('#section-products')).toBeVisible();
  await expect(page.locator('#section-products [data-nav-target=section-product-categories]')).toHaveCount(0);
  for(const section of ['products','product-categories','waitlist','users','mails','activity','23','34','orders','inventory','codes']){
   await page.evaluate(s=>location.hash='section-'+s,section);await expect(page.locator('#section-'+section)).toBeVisible();
   for(const theme of ['light','dark'])for(const width of [320,390,768,1366]){
    await page.evaluate(t=>document.documentElement.dataset.adminTheme=t,theme);await page.setViewportSize({width,height:width===320?480:900});await page.waitForTimeout(170);
    const current=page.locator('#section-'+section);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const exports=current.locator('.excel-export-actions');
    if(await exports.count()){
     expect(await exports.evaluate(e=>!!e.closest('.admin-heading-actions'))).toBe(true);
     expect(await exports.locator('button').count()).toBe(2);
    }
    const back=current.locator('.admin-view-back').first(),title=current.locator('h2').first();
    const b=await back.boundingBox(),h=await title.boundingBox();expect(Math.abs(h.y-b.y-b.height-16)).toBeLessThan(2);
    if(['products','product-categories','waitlist','users','mails'].includes(section)&&(width===390||width===1366))await page.screenshot({path:`test-results/admin-navigation/nav-${section}-${theme}-${width}.png`});
   }
  }
  await page.setViewportSize({width:1366,height:900});await page.evaluate(()=>location.hash='section-products');
  await page.locator('#section-products details.filters-panel').evaluate(e=>e.open=true);await page.locator('#productSearch').fill(tag);await expect(page.locator('#productsPageInfo')).toContainText('55 resultados');
  await page.locator('#productsBody [data-bulk-id]').first().check();
  for(const scope of ['filtered','all']){
   const download=page.waitForEvent('download');await page.locator(`#section-products [data-export-scope=${scope}]`).click();const file=await download;const path=`test-results/admin-navigation/${scope}.xlsx`;await file.saveAs(path);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(path);
   let matching=0;workbook.eachSheet(sheet=>sheet.eachRow(row=>{if(JSON.stringify(row.values).includes(tag))matching++;}));expect(matching).toBe(55);
  }
  await page.evaluate(()=>location.hash='section-waitlist');await expect(page.locator('#section-waitlist .admin-view-back')).toHaveText('← Atrás');
  const refreshed=page.waitForResponse(r=>r.url().includes('/api/admin/waitlist')&&r.request().method()==='GET');await page.locator('#waitlistRefresh').click();await refreshed;
  await page.goto('http://localhost:3000/admin-user.html?id=1');await expect(page.locator('#navProducto [data-nav-target=section-product-categories]')).toHaveCount(1);
  await page.setViewportSize({width:390,height:480});await page.locator('#sidebarToggle').click();
  await page.locator('[aria-controls=navProducto]').click();await page.locator('#navProducto [data-nav-target=section-product-categories]').click();
  await page.waitForURL('**/admin.html#section-product-categories');await expect(category).toHaveAttribute('aria-current','page');
  await page.locator('#sidebarToggle').click();await page.locator('#navProducto [data-nav-target=section-products]').click();
  await expect(page.locator('#section-products')).toBeVisible();await expect(page.locator('#sidebarToggle')).toHaveAttribute('aria-expanded','false');
  console.log('PASS navigation, history/reload, 11 headers x 4 widths x 2 themes, back spacing, export placement, 55-row filtered/all XLSX independent of bulk selection, refresh, shared user menu.');
 }finally{await browser.close();await db.product.deleteMany({where:{slug:{startsWith:tag}}});await db.$disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
