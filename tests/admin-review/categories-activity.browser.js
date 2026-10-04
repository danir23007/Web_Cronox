async initialPage => {
 const origin='http://127.0.0.1:4173',results=[];
 const assert=(ok,label)=>{if(!ok)throw Error(label);};
 for(const mobile of [false,true])for(const theme of ['light','dark']){
  const context=await initialPage.context().browser().newContext({hasTouch:mobile,isMobile:mobile,viewport:{width:mobile?390:1440,height:900}});
  try{
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin)return route.fulfill({status:200,contentType:'text/plain',body:''});
    if(url.pathname.includes('favicon'))return route.fulfill({status:204});
    if(url.pathname==='/api/favorites'&&request.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.pathname.endsWith('.html')){const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')});}
    if(url.pathname.startsWith('/api/'))throw Error('Unexpected network API '+url.pathname);
    return route.continue();
   });
   async function admin(route,role='SUPERADMIN'){
    await page.goto('about:blank');await page.goto(origin+'/admin.html#'+route);
    await page.evaluate(({role,theme})=>{
     document.documentElement.dataset.adminTheme=theme;
     window.reviewCategories=JSON.parse(sessionStorage.getItem('reviewCategories')||'null')||[{id:1,name:'Novedades',slug:'novedades',group:'NEW',isActive:true},{id:2,name:'Camisetas',slug:'camisetas',group:'GARMENT',isActive:true},{id:4,name:'Chaquetas',slug:'chaquetas',group:'GARMENT',isActive:true},{id:9,name:'Anterior',slug:'ambiguous',group:'UNCLASSIFIED',isActive:true},{id:10,name:'D#01',slug:'d#01',group:'DROP',showInStoreFilters:false,isActive:true}];
     window.reviewProducts=JSON.parse(sessionStorage.getItem('reviewProducts')||'null')||[{id:1,name:'Producto local',slug:'local',price:2500,isActive:true,categories:[1,2,4,9,10].map(categoryId=>({categoryId})),variants:[],images:[]}];
     window.reviewActivity=[{id:1,actionType:'MATCH',createdAt:new Date().toISOString()},{id:2,actionType:'OTHER',createdAt:new Date().toISOString()}];window.clearCalls=0;window.savedIds=null;
     const pageData=items=>({items,meta:{page:1,pageSize:25,total:items.length,totalPages:1,pageCount:1}});
     window.CRONOX_API={API_BASE:'',getMe:async()=>({id:1,role}),admin:{
      getDashboard:async()=>({}),listAllAdminCategories:async()=>structuredClone(window.reviewCategories),listAdminProducts:async()=>pageData(structuredClone(window.reviewProducts)),getAdminProduct:async()=>structuredClone(window.reviewProducts[0]),
      getAuditLogs:async query=>({items:window.reviewActivity.filter(row=>!query.q||row.actionType.includes(query.q)),page:1,pageSize:100,totalItems:window.reviewActivity.length,totalPages:1}),
      clearActivity:async()=>{window.clearCalls++;await new Promise(r=>setTimeout(r,60));const deleted=window.reviewActivity.length;window.reviewActivity=[];return{deleted};},
      createAdminCategory:async data=>{if(window.reviewCategories.some(c=>c.name.toLowerCase()===data.name.toLowerCase()))throw Error('Categoría duplicada');const category={id:50+window.reviewCategories.filter(c=>c.id>=50).length,...data,slug:data.name.toLowerCase().replace(/ /g,'-'),isActive:true};window.reviewCategories.push(category);sessionStorage.setItem('reviewCategories',JSON.stringify(window.reviewCategories));return category;},
      updateAdminCategory:async(id,data)=>{Object.assign(window.reviewCategories.find(c=>c.id===id),data);sessionStorage.setItem('reviewCategories',JSON.stringify(window.reviewCategories));return{};},
      updateProductCategories:async(id,ids)=>{window.savedIds=ids;window.reviewProducts[0].categories=ids.map(categoryId=>({categoryId}));sessionStorage.setItem('reviewProducts',JSON.stringify(window.reviewProducts));return structuredClone(window.reviewProducts[0]);},
      updateAdminProduct:async(id,data)=>{window.individualIds=data.categoryIds;return{};},
     }};
     window.setInterval=()=>0;
    },{role,theme});
    for(const script of ['category-controls','admin-shell','admin-bulk','admin'])await page.addScriptTag({url:origin+'/assets/'+script+'.js'});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
   }
   await admin('section-activity');await page.locator('#clearActivityBtn').waitFor();
   let confirmation='';page.on('dialog',dialog=>{confirmation=dialog.message();return dialog.dismiss();});
   await page.locator('#clearActivityBtn').click();assert(await page.evaluate(()=>window.clearCalls===0&&window.reviewActivity.length===2),'Cancel preserves all activity');assert(confirmation.includes('todo el historial')&&confirmation.includes('filtros'),'Confirmation describes unfiltered scope');
   page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());
   await page.locator('#activitySearch').fill('MATCH');await page.locator('#clearActivityBtn').click();
   await page.evaluate(()=>document.querySelector('#clearActivityBtn').dispatchEvent(new MouseEvent('click',{bubbles:true})));
   await page.locator('#activityMessage').filter({hasText:'Historial borrado'}).waitFor();assert(await page.evaluate(()=>window.clearCalls===1&&window.reviewActivity.length===0),'One clear removes every filtered/unfiltered row');
   assert((await page.locator('#activityPageInfo').textContent()).includes('0'),'Activity counter refreshed');
   await admin('section-activity','ADMIN');await page.waitForFunction(()=>document.documentElement.dataset.adminAuthState==='authorized');
   assert(await page.locator('#clearActivityBtn').evaluate(button=>button.hidden),'ADMIN has no clear button');await page.evaluate(()=>document.querySelector('#clearActivityBtn').dispatchEvent(new MouseEvent('click',{bubbles:true})));assert(await page.evaluate(()=>window.clearCalls===0),'ADMIN handler refuses direct UI events');
   await admin('section-product-categories');await page.locator('[data-category-product-id="1"]').waitFor();
   const card=page.locator('[data-category-product-id="1"]');assert(await card.locator('.category-control-column:not(.category-control-legacy)').count()===3,'Three classification columns');
   const garmentSummary=card.locator('details').first().locator('summary');if(mobile)await garmentSummary.tap();else{await garmentSummary.focus();await page.keyboard.press('Enter');}await card.locator('input[value="4"]').uncheck();
   page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.dismiss());await page.locator('#section-product-categories [data-back-target]').click();assert(page.url().endsWith('#section-product-categories'),'Unsaved categories prevent navigation when cancelled');page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());
   await page.locator('#createCategoryBtn').click();await page.locator('#createCategoryForm [name=name]').fill('Cancelada');await page.locator('#cancelCategoryBtn').click();assert(await page.evaluate(()=>!window.reviewCategories.some(c=>c.name==='Cancelada')),'Cancel creates nothing');
   await page.locator('#createCategoryBtn').focus();await page.keyboard.press('Enter');await page.locator('#createCategoryForm [name=name]').fill('Drop 02');await page.locator('#createCategoryForm [name=group]').selectOption('DROP');assert(await page.locator('#createCategoryForm [name=showInStoreFilters]').isChecked(),'Visibility initially enabled');await page.locator('#createCategoryForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#categoryEditorDialog').open);
   assert(!await card.locator('input[value="4"]').isChecked(),'Creation preserves pending assignment');assert(await card.locator('input[value="9"]').count()===0,'Unknown associations have no fourth column');assert(await card.locator('input[value="10"]').isChecked(),'D#01 remains selected in Drop');
   await page.locator('#createCategoryBtn').click();await page.locator('#createCategoryForm [name=name]').fill('Sudaderas');await page.locator('#createCategoryForm [name=group]').selectOption('GARMENT');await page.locator('#createCategoryForm [name=showInStoreFilters]').uncheck();await page.locator('#createCategoryForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#categoryEditorDialog').open);assert(await card.locator('input[value="51"]').count()===1,'Hidden category available in admin');
   await page.locator('.category-management summary').click();await page.locator('[data-edit-category="51"]').click();assert(!await page.locator('#createCategoryForm [name=showInStoreFilters]').isChecked(),'Edit loads stored visibility');await page.locator('#createCategoryForm [name=showInStoreFilters]').check();await page.locator('#createCategoryForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#categoryEditorDialog').open);
   await card.locator('details').nth(1).evaluate(node=>{node.open=true;});await card.locator('input[value="50"]').check();await card.locator('[data-save-product-categories]').click();await page.waitForFunction(()=>window.savedIds?.includes(50));
   assert(JSON.stringify(await page.evaluate(()=>window.savedIds.sort((a,b)=>a-b)))==='[1,2,9,10,50]','Multiple groups and legacy ID saved');
   await admin('section-product-categories');await page.locator('[data-category-product-id="1"]').waitFor();await page.locator('.category-management summary').click();await page.locator('[data-edit-category="51"]').click();assert(await page.locator('#createCategoryForm [name=showInStoreFilters]').isChecked(),'Visibility persists across reload');await page.locator('#cancelCategoryBtn').click();assert(!(await page.locator('#section-product-categories').textContent()).includes('Sin clasificar (asociaciones conservadas)'),'No legacy block');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin categories have no horizontal overflow');
   await page.screenshot({path:`output/playwright/category-admin-${theme}-${mobile?'mobile':'desktop'}.png`,fullPage:true});
   await page.locator('#section-product-categories [data-back-target]').click();assert(page.url().endsWith('#section-dashboard'),'Categories back goes Home');assert(await page.locator('#section-dashboard [data-back-target]').count()===0,'Home has no Back');
   await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-products'));await page.locator('#productsBody [data-edit-product]').waitFor();await page.locator('#productsBody [data-edit-product]').first().click();await page.locator('#productCreationCategoryField > details > summary').click();await page.locator('#productCreationCategoryOptions .category-control-columns').waitFor();assert(await page.locator('#productCreationCategoryOptions input[value="10"]').isChecked(),'Individual editor keeps D#01');await page.locator('#productCreationCategoryOptions .category-control-column').first().locator('input').uncheck();await page.locator('#productSubmitBtn').click();await page.waitForFunction(()=>Array.isArray(window.individualIds));assert(JSON.stringify(await page.evaluate(()=>window.individualIds.sort((a,b)=>a-b)))==='[2,9,10,50]','Individual save keeps unknown associations');
   await page.locator('#section-products .bulk-mode-toggle').click();await page.locator('#productsBody [data-bulk-id="1"]').check();await page.locator('#section-products').getByRole('button',{name:'Editar seleccionados',exact:true}).click();await page.locator('[data-bulk-field=categoryMode]').selectOption('replace');assert(await page.locator('.bulk-categories .category-control-column:not(.category-control-legacy)').count()===3,'Bulk uses same taxonomy');await page.locator('.admin-bulk-dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
   await page.locator('#section-products [data-back-target]').click();assert(page.url().endsWith('#section-dashboard'),'Products back goes Home');
   await page.evaluate(()=>window.CRONOX_ADMIN_NAV.navigate('section-product-categories'));await page.locator('[data-category-product-id="1"]').waitFor();if(!await page.locator('.category-management').evaluate(node=>node.open))await page.locator('.category-management summary').click();await page.locator('[data-edit-category="9"]').click();await page.locator('#createCategoryForm [name=group]').selectOption('GARMENT');await page.locator('#createCategoryForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#categoryEditorDialog').open);assert(await page.locator('[data-category-product-id="1"] input[value="9"]').isChecked(),'Explicit classification exposes preserved association');assert(await page.evaluate(()=>window.reviewCategories.find(c=>c.id===9).slug==='ambiguous'),'Classification preserves slug');
   // The administrator profile reads its assigned code and never generates one.
   await page.goto('about:blank');await page.goto(origin+'/admin-user.html?id=1');
   await page.evaluate(({theme})=>{
    document.documentElement.dataset.adminTheme=theme;
    window.reviewWelcome='ORIGINAL';window.profileReads=0;
    window.CRONOX_ADMIN_AUTH={isAdmin:user=>user.role==='SUPERADMIN'};
    window.CRONOX_API={getMe:async()=>({id:99,role:'SUPERADMIN'}),admin:{
     getUserDetail:async()=>{window.profileReads++;return{user:{id:1,email:'local@example.test',role:'USER',welcomeCode:window.reviewWelcome},stats:{}};},
     getUserAuditLogs:async()=>({items:[]}),listAdminNotes:async()=>({items:[]}),getUserOrders:async()=>({items:[]}),getUserRequests:async()=>({items:[]}),
    }};
   },{theme});
   await page.addScriptTag({url:origin+'/assets/admin-user.js'});await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
   await page.getByText('ORIGINAL',{exact:true}).waitFor();assert(await page.getByText('ORIGINAL',{exact:true}).evaluate(node=>!node.closest('input,select,textarea')),'Welcome code is read only');
   await page.evaluate(()=>{window.reviewWelcome=null;document.querySelector('#refreshAll')?.click();});
   await page.getByText('Sin c\u00f3digo asignado',{exact:true}).waitFor();
   // Public filters use the same persisted categories; API responses are simulated.
   await page.goto('about:blank');await page.goto(origin+'/index.html');
   await page.evaluate(()=>{window.hideDrop=false;window.CRONOX_API={getAllCategories:async()=>[{id:2,name:'Camisetas',slug:'camisetas',group:'GARMENT'},{id:50,name:'Drop 02',slug:'drop-02',group:'DROP',showInStoreFilters:!window.hideDrop},{id:10,name:'D#01',slug:'d#01',group:'DROP',showInStoreFilters:false}],getProducts:async()=>[{id:1,name:'Visible',slug:'visible',price:2500,categories:['camisetas','drop-02'],isActive:true},{id:2,name:'Otro',slug:'other',price:2500,categories:['camisetas'],isActive:true},{id:3,name:'Inactivo',slug:'inactive',price:2500,categories:['camisetas','drop-02'],isActive:false}]};});
   await page.addScriptTag({url:origin+'/assets/app.js'});await page.addScriptTag({url:origin+'/assets/products.js'});await page.evaluate(()=>window.CRONOX_STORE_CATEGORIES.ready);assert(await page.locator('#filtersPanel').evaluate(node=>node.hidden),'Panel remains closed initially');assert(await page.locator('#publicCategoryFilters').count()===0,'No catalog selector block');assert(!(await page.locator('body').textContent()).includes('Otras categor'),'No Other category selector');await page.locator('#btnMenu').click();await page.locator('[data-public-category-group=GARMENT]').check();await page.locator('[data-public-category-group=DROP]').check();
   await page.waitForFunction(()=>document.querySelector('#productsGrid')?.textContent.includes('Visible'));assert(!(await page.locator('#productsGrid').textContent()).includes('Otro')&&!(await page.locator('#productsGrid').textContent()).includes('Inactivo'),'Public groups combine without inactive products');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
   await page.screenshot({path:`output/playwright/category-public-${theme}-${mobile?'mobile':'desktop'}.png`,fullPage:true});
   await page.evaluate(async()=>{window.hideDrop=true;await window.CRONOX_STORE_CATEGORIES.refresh();});assert(await page.locator('[data-public-category-group=DROP]').count()===0,'Hidden category removed from public panel');assert((await page.locator('#productsGrid').textContent()).includes('Otro'),'Removed category is not an invisible filter');await page.locator('#filtersPanel .filters-close').click();await page.waitForFunction(()=>document.querySelector('#filtersPanel').hidden);assert(await page.locator('#btnMenu').getAttribute('aria-expanded')==='false','Closed panel ARIA');
   await page.evaluate(async()=>{const next=new URL(location.href);next.searchParams.set('categorySlug','drop-02');history.replaceState(null,'',next);await window.CRONOX_STORE_CATEGORIES.refresh();});assert(!page.url().includes('categorySlug='),'Hidden route filter cleared');
   await page.goto('about:blank');await page.goto(origin+'/index.html?categorySlug=drop-02');await page.evaluate(()=>{
    window.hideDrop=false;const rows=[{id:1,name:'Visible',price:2500,categories:['drop-02'],isActive:true},{id:2,name:'Otro',price:2500,categories:['camisetas'],isActive:true}];
    window.CRONOX_API={getAllCategories:async()=>[{id:2,name:'Camisetas',slug:'camisetas',group:'GARMENT'},{id:50,name:'Drop 02',slug:'drop-02',group:'DROP',showInStoreFilters:!window.hideDrop}],getProducts:async()=>rows,getCategoryProducts:async()=>({category:{name:'Drop 02',slug:'drop-02'},products:[rows[0]],meta:{pageCount:1}})};
   });await page.addScriptTag({url:origin+'/assets/app.js'});await page.addScriptTag({url:origin+'/assets/products.js'});await page.evaluate(()=>window.CRONOX_catalogReady);await page.evaluate(()=>window.CRONOX_STORE_CATEGORIES.ready);assert(!(await page.locator('#productsGrid').textContent()).includes('Otro'),'Deep category initially filters catalog');await page.evaluate(async()=>{window.hideDrop=true;await window.CRONOX_STORE_CATEGORIES.refresh();});await page.waitForFunction(()=>document.querySelector('#productsGrid').textContent.includes('Otro'));assert(!page.url().includes('categorySlug='),'Hidden deep selection reloads full catalog');assert(await page.locator('#filtersPanel').evaluate(node=>node.hidden),'Refresh never opens panel');
   assert(errors.length===0,'No console/runtime errors: '+errors.join(';'));results.push({mobile,theme,activity:true,categories:true,bulk:true,profile:true,back:true,publicFilters:true,simulated:true});
  }finally{await context.close();}
 }
 return results;
}
