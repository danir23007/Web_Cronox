// Local-only, reproducible Chromium benchmark; writes exclusively disposable fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
const sharp = require('../../cronox-backend/node_modules/sharp');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');

(async () => {
  const label = process.argv[2] || 'after';
  assert(/^[a-z0-9-]+$/.test(label));
  const env = loadLocalEnvironment(), target = new URL(env.DATABASE_URL);
  assert.equal(target.host, '127.0.0.1:5433'); assert.equal(target.pathname, '/cronox_dev');
  assert.equal(env.EMAIL_ENABLED, 'false'); assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const output = path.resolve('output/playwright/products-performance'); fs.mkdirSync(output, { recursive: true });
  const assetDir = fs.mkdtempSync(path.resolve('cronox-front/assets/perf-fixture-'));
  const assetUrl = 'http://127.0.0.1:3000/assets/' + path.basename(assetDir);
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } }, log: [{ emit: 'event', level: 'query' }] });
  let queries = [];
  db.$on('query', e => queries.push({ duration: e.duration, operation: e.query.trim().split(/\s+/)[0] }));
  const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage(), cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const tag = 'perf-' + randomUUID(), password = randomUUID(), ids = [];
  let actor, category;
  const results = { label, conditions: { viewport: '1365x900', products: 51, activeImages: 6, archivedImages: 3, network: 'loopback, no throttling', cpu: 'native' }, stages: [] };
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(30000);
    window.__perf = { loads: 0, long: [] };
    document.addEventListener('load', e => { if (e.target.id === 'productGalleryPreviewImage') window.__perf.loads++; }, true);
    new PerformanceObserver(list => window.__perf.long.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  async function stage(name, action, settle = 800) {
    const before = await metrics(); const mark = await page.evaluate(() => ({ at: performance.now(), origin: performance.timeOrigin, loads: window.__perf.loads }));
    const start = performance.now(); await action(); const readyMs = performance.now() - start;
    await page.waitForTimeout(settle);
    const after = await metrics();
    const data = await page.evaluate(mark => {
      const navigated = mark.origin !== performance.timeOrigin;
      if (navigated) { mark.at=0; mark.loads=0; }
      const resources = performance.getEntriesByType('resource').filter(r => r.startTime >= mark.at);
      const long = window.__perf.long.filter(r => r.start >= mark.at);
      return { navigated, previewLoadEvents: window.__perf.loads - mark.loads, requests: resources.length,
        transferBytes: resources.reduce((s,r) => s + r.transferSize, 0), decodedBytes: resources.reduce((s,r) => s + r.decodedBodySize, 0),
        images: resources.filter(r => r.initiatorType === 'img').map(r => ({ path: new URL(r.name).pathname, bytes: r.decodedBodySize, ms: Math.round(r.duration) })),
        api: resources.filter(r => r.name.includes('/api/')).map(r => ({ path: new URL(r.name).pathname, bytes: r.decodedBodySize, ms: Math.round(r.duration) })),
        longTasks: long.length, longTaskMs: long.reduce((s,r) => s + r.duration, 0), maxLongTaskMs: Math.max(0,...long.map(r=>r.duration)) };
    }, mark);
    results.stages.push({ name, readyMs: Math.round(readyMs), windowMs: Math.round(performance.now()-start),
      taskMs: Math.round((after.TaskDuration-(data.navigated ? 0 : before.TaskDuration))*1000), scriptMs: Math.round((after.ScriptDuration-(data.navigated ? 0 : before.ScriptDuration))*1000),
      nodes: after.Nodes, listeners: after.JSEventListeners, heapBytes: after.JSHeapUsedSize, ...data });
  }
  try {
    assert.equal((await context.request.get('http://127.0.0.1:3000/api/ready')).status(), 200);
    const raw = Buffer.alloc(1024 * 1365 * 3); let seed = 17;
    for (let i=0; i<raw.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; raw[i] = seed >>> 24; }
    const source = sharp(raw, { raw: { width: 1024, height: 1365, channels: 3 } });
    await source.clone().jpeg({ quality: 82 }).toFile(path.join(assetDir, 'original.jpg'));
    await source.clone().resize(180).webp({ quality: 75 }).toFile(path.join(assetDir, 'small.webp'));
    await source.clone().resize(720).webp({ quality: 80 }).toFile(path.join(assetDir, 'quick.webp'));
    results.imageSizes = Object.fromEntries(['original.jpg','small.webp','quick.webp'].map(n=>[n,fs.statSync(path.join(assetDir,n)).size]));
    actor = await db.user.create({ data: { name: 'Performance QA', email: tag+'@example.test', password: await bcrypt.hash(password,10), role:'SUPERADMIN', accountState:'ACTIVE' } });
    category = await db.category.create({ data: { name:tag, slug:tag, group:'GARMENT' } });
    for (let p=0;p<51;p++) {
      const image = i => assetUrl+'/original.jpg?p='+p+'&i='+i;
      const product = await db.product.create({ data: { name:tag+' '+p, slug:tag+'-'+p, searchText:tag, price:4200, imageUrl:image(0),
        description:'Local performance fixture', collection:'QA', privateCost:{ create:{unitCostCents:1200}},
        categories:{create:{categoryId:category.id}}, variants:{create:['S','M','L'].map(size=>({size,sku:tag+'-'+p+'-'+size,stockQty:5}))},
        images:{create:Array.from({length:9},(_,i)=>({url:image(i),width:1024,height:1365,isPrimary:i===0,isActive:i<6,sortOrder:i,
          variants:{small:{url:assetUrl+'/small.webp?p='+p+'&i='+i,width:180,height:240},quick:{url:assetUrl+'/quick.webp?p='+p+'&i='+i,width:720,height:960}}}))} } }); ids.push(product.id);
    }
    await page.goto('http://127.0.0.1:3000/admin.html');
    await page.locator('#adminLoginEmail').fill(actor.email); await page.locator('#adminLoginPassword').fill(password);
    await page.locator('#adminLoginSubmit').click(); await expect(page.locator('#adminLoginSubmit')).toBeHidden();
    await stage('list-first', async()=>{
      await page.goto('http://127.0.0.1:3000/admin.html#section-products');
      await expect(page.locator('#productsBody [data-edit-product]').first()).toBeVisible();
    });
    if (label !== 'before') {
      const startupApi = results.stages.find(s => s.name === 'list-first').api;
      assert(startupApi.some(r => r.path === '/api/admin/dashboard/pending-counts'));
      assert(!startupApi.some(r => r.path === '/api/admin/dashboard'), 'Products must not load the full hidden dashboard');
    }
    await stage('scroll', async()=>{ for(let i=0;i<6;i++){await page.mouse.wheel(0,650);await page.waitForTimeout(100);} });
    const edit = async id => { await page.locator('[data-edit-product="'+id+'"]').click(); await expect(page.locator('#productModal')).toHaveClass(/show/); };
    const close = async()=> { await page.locator('#productCancelBtn').click(); await expect(page.locator('#productModal')).not.toHaveClass(/show/); };
    await page.evaluate(()=>window.scrollTo(0,0));
    const first = Number(await page.locator('[data-edit-product]').first().getAttribute('data-edit-product'));
    assert(ids.includes(first), 'Newest row must be a disposable fixture');
    await stage('editor-first',()=>edit(first),1200);
    await stage('editor-idle',async()=>{},1200);
    await stage('fields-images',async()=>{
      await page.locator('#productName').fill(tag+' edited');
      await page.locator('#productGalleryAlt').fill('Local QA image');
      await page.locator('#productGalleryThumbnails button').nth(1).click();
      await page.locator('#productGalleryPositionX').fill('60');
      await page.locator('#productPrice').fill('43'); await page.locator('#productCost').fill('13');
    });
    await stage('save',async()=>{ await page.locator('#productSubmitBtn').click(); await expect(page.locator('#productModal')).not.toHaveClass(/show/); await expect(page.locator('[data-edit-product="'+first+'"]').first()).toBeVisible(); });
    const saved = await db.product.findUnique({ where:{id:first},include:{privateCost:true,images:true,variants:true,categories:true} });
    assert.equal(saved.price,4300); assert.equal(saved.privateCost.unitCostCents,1300); assert.equal(saved.images.length,9); assert.equal(saved.categories[0].categoryId,category.id);
    for(let i=0;i<3;i++) { await stage('reopen-'+i,()=>edit(ids[ids.length-1-i]),600); await close(); }
    await stage('closed-idle',async()=>{},1200);
    await stage('list-warm',async()=>{ await page.reload();await expect(page.locator('#productsBody [data-edit-product]').first()).toBeVisible(); });
    await cdp.send('HeapProfiler.collectGarbage'); results.retained = await metrics();
    await page.screenshot({path:path.join(output,label+'.png')});
    // Query count is measured directly against the same local fixtures. Never log SQL parameters.
    const { ProductService } = require('../../cronox-backend/dist/products/product.service');
    const service = new ProductService(db); results.database = [];
    for (const [name, operation] of [
      ['full-list-50', () => service.listAdminProducts({ q:tag, pageSize:50 })],
      ['summary-list-50', () => service.listAdminProducts({ q:tag, pageSize:50, view:'summary' })],
      ['summary-list-1', () => service.listAdminProducts({ q:tag, pageSize:1, view:'summary' })],
      ['detail', () => service.getAdminProduct(first)],
      ['stock-sort', () => service.listAdminProducts({ q:tag, sortBy:'stock', view:'summary' })],
    ]) {
      queries=[];const start=performance.now(); const data=await operation();
      if(name==='summary-list-50' && label !== 'before') {
        assert.equal(data.items.length,50);assert.equal(data.items[0].images.length,1);
        assert.equal(data.items[0].description,undefined);assert(data.items[0].variants.length>=3);
        assert.equal(data.items[0].categories[0].categoryId,category.id);
      }
      if(name==='full-list-50') assert.equal(data.items[0].images.length,6);
      results.database.push({ name, wallMs:Math.round(performance.now()-start), queries:queries.length,
        sqlMs:queries.reduce((s,q)=>s+q.duration,0), responseBytes:Buffer.byteLength(JSON.stringify(data)) });
    }
    if (label !== 'before') {
      // Late A must not overwrite B or a draft typed after B has opened.
      const a=ids.at(-3), b=ids.at(-4);
      const slow = async route => { const response=await route.fetch(); await new Promise(r=>setTimeout(r,450)); await route.fulfill({response}); };
      await page.route('**/api/admin/products/'+a,slow);
      await page.locator('[data-edit-product="'+a+'"]').click(); await edit(b);
      await page.locator('#productName').fill(tag+' draft B'); await page.waitForTimeout(550);
      await expect(page.locator('#productName')).toHaveValue(tag+' draft B');
      await close(); await page.unroute('**/api/admin/products/'+a,slow);
      await page.route('**/api/admin/products/'+a,slow);
      await page.locator('[data-edit-product="'+a+'"]').click();
      await page.evaluate(()=>{location.hash='#section-users';});
      await expect(page.locator('#section-users')).toBeVisible();
      await page.evaluate(()=>{location.hash='#section-products';});
      await expect(page.locator('#section-products')).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.locator('#productModal')).not.toHaveClass(/show/);
      await page.unroute('**/api/admin/products/'+a,slow);
      // Exercise persisted image order, archive/restore, stock, private cost and activation.
      await edit(first);
      await page.locator('#productGalleryThumbnails button').nth(1).click();
      await page.locator('#productGalleryPrimary').click();
      await page.locator('#productGalleryHistory summary').click();
      await page.locator('#productGalleryHistoryGrid').getByRole('button',{name:'Añadir de nuevo a la galería'}).first().click();
      await page.locator('[data-variant-size="M"]').fill('7');
      await page.locator('#productIsActive').uncheck();
      await page.locator('#productSubmitBtn').click(); await expect(page.locator('#productModal')).not.toHaveClass(/show/);
      const edited=await db.product.findUnique({where:{id:first},include:{images:true,variants:true,privateCost:true,categories:true}});
      assert.equal(edited.isActive,false);assert.equal(edited.variants.find(v=>v.size==='M').stockQty,7);
      assert.equal(edited.images.filter(i=>i.isActive).length,7);assert.equal(edited.images.find(i=>i.isPrimary).sortOrder,0);
      assert.equal(edited.price,4300);assert.equal(edited.privateCost.unitCostCents,1300);assert.equal(edited.categories[0].categoryId,category.id);
      // Filter and page navigation operate on the summary DTO; bulk still selects real IDs.
      await page.locator('#section-products details.filters-panel').evaluate(el=>{el.open=true;});
      await page.locator('#productSearch').fill(tag); await page.locator('#productSearch').press('Enter');
      await expect(page.locator('#productsPageInfo')).toContainText('51');
      await page.locator('#productsNext').click(); await expect(page.locator('#productsBody [data-edit-product]')).toHaveCount(1);
      await page.locator('#productsPrev').click(); await expect(page.locator('#productsBody [data-edit-product]')).toHaveCount(50);
      const section=page.locator('#section-products'); await section.getByRole('button',{name:'Bulk Edit',exact:true}).click();
      await section.locator('[data-bulk-id="'+first+'"]').check();
      await section.getByRole('button',{name:'Editar seleccionados',exact:true}).click();
      const dialog=page.locator('.admin-bulk-dialog'); await expect(dialog.locator('[data-bulk-field="isActive"]')).toBeEnabled();
      await dialog.locator('[data-bulk-field="isActive"]').selectOption('true'); await dialog.getByRole('button',{name:'Aplicar cambios',exact:true}).click();
      await dialog.getByRole('button',{name:'Confirmar cambios a 1 productos',exact:true}).click(); await expect(dialog).toContainText('Completado: 1 modificados');
      await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
      assert.equal((await db.product.findUnique({where:{id:first}})).isActive,true);
      results.cycleRetained=[];
      for(let i=0;i<5;i++){await edit(ids.at(-1-i));await close();await cdp.send('HeapProfiler.collectGarbage');const m=await metrics();results.cycleRetained.push({nodes:m.Nodes,listeners:m.JSEventListeners,heapBytes:m.JSHeapUsedSize});}
      results.functional={lateResponses:true,navigationDuringLoad:true,draftPreserved:true,imageOrderAndRestore:true,stock:true,priceAndPrivateCost:true,categories:true,activation:true,pagination:true,bulk:true};
    }
    fs.writeFileSync(path.join(output,label+'.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({label,imageSizes:results.imageSizes,stages:results.stages.map(({images,api,...s})=>({...s,images:images.length,api}))}));
  } catch(error) {
    console.error(await page.locator('#productFormMessage').textContent().catch(()=>''));
    fs.writeFileSync(path.join(output,label+'-partial.json'),JSON.stringify(results,null,2));
    throw error;
  } finally {
    if(ids.length){ await db.stockMovement.deleteMany({where:{variant:{productId:{in:ids}}}}); await db.productImage.deleteMany({where:{productId:{in:ids}}}); await db.productVariant.deleteMany({where:{productId:{in:ids}}}); await db.product.deleteMany({where:{id:{in:ids}}}); }
    if(category)await db.category.delete({where:{id:category.id}});
    if(actor){await db.auditLog.deleteMany({where:{actorId:actor.id}});await db.adminBulkOperation.deleteMany({where:{actorId:actor.id}});await db.user.delete({where:{id:actor.id}});}
    await context.close(); await browser.close(); await db.$disconnect();
    // Directory was created by this process under the known frontend assets root.
    assert(path.dirname(assetDir)===path.resolve('cronox-front/assets')); fs.rmSync(assetDir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
