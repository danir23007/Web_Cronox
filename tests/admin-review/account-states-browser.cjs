async (page) => {
  // UI verification uses fictional API fixtures, never a production account/session.
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.addInitScript(()=>{ window.__CRONOX_API_BASE__=location.origin; });
  const fixture={id:2,identityUid:'00000000-0000-4000-8000-000000000002',memberCode:'CRX-000002',
    name:'Cliente local',firstName:'Cliente',lastName:'Local',email:'fixture@example.test',role:'USER',circle:1,
    accountState:'ACTIVE',createdAt:'2026-10-14T00:00:00.000Z',updatedAt:'2026-10-14T00:00:00.000Z',
    ordersCount:0,revenueCents:0,distinctProducts:0};
  const inactive={...fixture,id:3,identityUid:'00000000-0000-4000-8000-000000000003',memberCode:'CRX-000003',name:'Cliente inactivo',accountState:'INACTIVE'};
  const checks=[];
  await page.unrouteAll();
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1') return route.abort();
    if(!url.pathname.startsWith('/api/')) return route.continue();
    let body={};
    if(['/api/me','/api/auth/me'].includes(url.pathname)) body={id:99,role:'SUPERADMIN',name:'Admin local',email:'admin@example.test'};
    else if(url.pathname==='/api/auth/csrf') body={csrfToken:'local-fixture'};
    else if(url.pathname==='/api/admin/users') {
      const data=[inactive,fixture].filter(u=>!url.searchParams.get('accountState')||u.accountState===url.searchParams.get('accountState'));
      body={data,meta:{page:1,pageSize:100,total:data.length,totalPages:1,sort:'id',order:'desc'}};
    } else if(url.pathname==='/api/admin/users/edit-options') body={roles:['USER','FRIEND','ADMIN','SUPERADMIN'],accountStates:['ACTIVE','INACTIVE'],circles:[1,2,3,4,5]};
    else if(url.pathname==='/api/admin/users/2') {
      if(route.request().method()==='PATCH') { Object.assign(fixture,route.request().postDataJSON(),{updatedAt:'2026-10-14T00:01:00.000Z'}); body=fixture; }
      else body={user:fixture,stats:{ordersCount:0,totalSpent:0}};
    } else if(/audit-logs|orders|requests|notes|analytics/.test(url.pathname)) body={items:[],data:[],meta:{page:1,total:0,totalPages:1}};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const check=(ok,msg)=>{if(!ok) throw new Error(msg);};
  for(const [width,height,label] of [[1440,1000,'desktop'],[390,844,'mobile']]) {
    await page.setViewportSize({width,height});
    await page.goto('about:blank');
    await page.goto('http://127.0.0.1:3012/admin.html#usuarios');
    await page.locator('#usersBody tr').filter({hasText:'Cliente local'}).waitFor();
    const list=await page.locator('#usersBody').innerText();
    check(list.includes('Activo')&&list.includes('Inactivo'),'Canonical state labels missing');
    await page.locator('#usersAccountState').selectOption('INACTIVE');
    await page.waitForFunction(()=>document.querySelector('#usersBody')?.textContent.includes('Cliente inactivo')&&!document.querySelector('#usersBody')?.textContent.includes('Cliente local'));
    await page.reload();
    await page.locator('#usersBody tr').filter({hasText:'Cliente inactivo'}).waitFor();
    check(await page.locator('#usersAccountState').inputValue()==='INACTIVE','Filter lost on reload');
    await page.locator('#usersAccountState').selectOption('');
    await page.locator('#usersBody tr').filter({hasText:'Cliente local'}).waitFor();
    await page.locator('#usersAccountState').scrollIntoViewIfNeeded();
    if(label==='mobile') {
      await page.screenshot({path:'output/playwright/account-states-filters-mobile.png'});
      await page.locator('#usersBody .account-state-badge').first().scrollIntoViewIfNeeded();
    }
    await page.screenshot({path:`output/playwright/account-states-list-${label}.png`});
    await page.goto('http://127.0.0.1:3012/admin-user.html?id=2&uid='+fixture.identityUid);
    await page.locator('#profileList').getByText('Activo',{exact:true}).waitFor();
    await page.locator('#editUser').click();
    const options=await page.locator('#editUserStatus option').allTextContents();
    check(JSON.stringify(options)===JSON.stringify(['Activo','Inactivo']),'Edit options incorrect');
    await page.locator('#editUserStatus').focus(); await page.keyboard.press('ArrowDown');
    check(await page.locator('#editUserStatus').inputValue()==='INACTIVE','Keyboard selection failed');
    await page.locator('#editUserStatus').selectOption('ACTIVE');
    await page.locator('#saveUserEdit').click();
    await page.locator('#userEditForm').waitFor({state:'hidden'});
    await page.reload();
    await page.locator('#profileList').getByText('Activo',{exact:true}).waitFor();
    await page.locator('#profileList').scrollIntoViewIfNeeded();
    await page.screenshot({path:`output/playwright/account-states-detail-${label}.png`});
    check(!(await page.locator('body').innerText()).match(/Prerregistrado|Pendiente de contraseña/),'Legacy label visible');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    check(!overflow,'Unexpected page overflow');
    checks.push({label,list:true,filterReload:true,detailReload:true,keyboard:true,canonicalOptions:options});
  }
  check(errors.length===0,errors.join('; '));
  return {kind:'browser with simulated API, real local assets',checks,errors};
}
