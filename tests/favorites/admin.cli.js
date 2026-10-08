async page => {
  const browser=page.context().browser(),contexts=[],errors=[],checks=[],requests=[],out='output/playwright/admin-favorites',origin='http://127.0.0.1:43127';
  const products=Array.from({length:28},(_,i)=>({id:i+1,name:i===0?'Camiseta washed gris':i===1?'Camiseta washed negra':'Producto '+String(i+1).padStart(2,'0'),slug:'producto-'+(i+1),reference:'FAV-'+(i+1),isActive:i!==1,available:i!==1&&i!==2,favorites:i===0?2:i===1?2:i===2?1:0,image:{url:'/assets/products/camiseta_washed_'+(i===1?'negra':'gris')+'.png',variants:null}}));
  const check=(v,msg)=>{if(!v)throw Error(msg);};
  const poll=async(fn,msg)=>{for(let i=0;i<100;i++){if(await fn())return;await page.waitForTimeout(100);}throw Error(msg);};
  try {
    for(const mobile of [false,true]) {
      products[0].favorites=2;
      const c=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1100},isMobile:mobile,hasTouch:mobile});contexts.push(c);
      const p=await c.newPage();p.setDefaultTimeout(10000);p.setDefaultNavigationTimeout(10000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{errors.push('Unexpected dialog: '+d.message());await d.dismiss();});
      let fail=false, summaryFavorites=5;
      await c.route('**/*',async r=>{
        const u=new URL(r.request().url());if(u.origin!==origin)return r.abort();
        if(u.pathname==='/api/me')return r.fulfill({json:{id:1,role:'ADMIN',name:'Revisión local',email:'review@example.test'}});
        if(u.pathname==='/api/admin/favorites') {
          requests.push(u.search);
          if(fail)return r.fulfill({status:503,json:{message:'Local error'}});
          const search=(u.searchParams.get('search')||'').toLowerCase(),current=Number(u.searchParams.get('page')||1),asc=u.searchParams.get('sort')==='asc';
          const all=products.filter(x=>!search||[x.name,x.slug,x.reference].some(s=>s.toLowerCase().includes(search))||String(x.id)===search).sort((a,b)=>(asc?a.favorites-b.favorites:b.favorites-a.favorites)||a.id-b.id);
          return r.fulfill({json:{rows:all.slice((current-1)*25,current*25),total:all.length,summary:{favorites:summaryFavorites,users:3},page:current,pageSize:25}});
        }
        if(u.pathname==='/api/admin/products/1')return r.fulfill({json:{id:1,name:products[0].name,slug:products[0].slug,price:3500,currency:'EUR',isActive:true,images:[],variants:[],categories:[],updatedAt:new Date().toISOString()}});
        if(u.pathname.startsWith('/api/'))return r.fulfill({json:{data:[],items:[],products:[],pending23:0,pending34:0}});
        return r.continue();
      });
      await p.goto(origin+'/admin.html#section-favorites',{waitUntil:'domcontentloaded'});
      await poll(async()=>await p.locator('#favoritesList .waitlist-row').count()===25,'List did not load');
      check(await p.locator('#navProducto [data-nav-target="section-favorites"]').count()===1,'Menu location');
      check((await p.locator('#favoritesSummary').innerText()).includes('5 favoritos actuales'),'Global summary');
      check((await p.locator('#favoritesList').innerText()).includes('Inactivo / archivado'),'Inactive status');
      check((await p.locator('#favoritesList').innerText()).includes('0 usuarios'),'Zero favorites');
      const theme=p.getByRole('switch',{name:'Modo oscuro'});if(await theme.getAttribute('aria-checked')!=='true')await theme.click();
      await p.screenshot({path:out+'/'+(mobile?'mobile':'desktop')+'.png'});
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
      await p.locator('#favoritesNext').click();await poll(async()=>await p.locator('#favoritesList .waitlist-row').count()===3,'Pagination');
      check((await p.locator('#favoritesSummary').innerText()).includes('5 favoritos actuales'),'Summary changed by page');
      await p.locator('#favoritesSort').selectOption('asc');await poll(async()=> (await p.locator('#favoritesList .waitlist-row').first().innerText()).includes('0 usuarios'),'Ascending order');
      await p.locator('#favoritesSearch').fill('FAV-1');await p.locator('#favoritesFilters [type="submit"]').click();
      await poll(async()=> (await p.locator('#favoritesPage').innerText()).includes('11 productos'),'SKU search');
      check((await p.locator('#favoritesSummary').innerText()).includes('5 favoritos actuales'),'Summary changed by filter');
      await p.locator('#favoritesSearch').fill('1');await p.locator('#favoritesFilters [type="submit"]').click();
      await poll(async()=>await p.locator('#favoritesList .waitlist-row').count()===12,'Search update');
      await p.locator('#favoritesSort').selectOption('desc');
      await poll(async()=>await p.locator('[data-favorite-edit="1"]').count()===1,'Editor row');
      await p.locator('[data-favorite-edit="1"]').click();
      await p.locator('#productModal').waitFor({state:'visible'});
      check(await p.locator('#productName').inputValue()===products[0].name,'Actual product editor');
      await p.locator('#productCancelBtn').click();
      fail=true;await p.locator('#favoritesRefresh').click();await poll(async()=> (await p.locator('#favoritesRefresh').innerText())==='Reintentar','Error retry');
      check((await p.locator('#favoritesSummary').innerText()).includes('no disponible'),'Error counted as zero');
      fail=false;summaryFavorites=4;products[0].favorites=1;await p.locator('#favoritesRefresh').click();await poll(async()=> (await p.locator('#favoritesSummary').innerText()).includes('4 favoritos actuales'),'Fresh report');
      checks.push((mobile?'mobile':'desktop')+': Product menu, counts/zeros/inactive, global summaries, paging, search, sort, real product editor, error/retry/current query, no overflow');
    }
    check(!errors.length,'JS/dialog errors '+errors.join(';'));return {checks,errors,requests,scope:'Actual admin UI on localhost, all API responses simulated/intercepted; persisted calculations tested separately in disposable PostgreSQL'};
  }finally{for(const c of contexts)await c.close();}
}
