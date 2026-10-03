// Browser regression for the isolated review-visitors.cjs fixture only.
async page => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const result = {};
  for (const size of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(size);
    await page.goto('http://127.0.0.1:43123/admin.html');
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
    await page.locator('#dashboardVisitors .visitor-day').first().waitFor();
    assert(await page.locator('#adminBreadcrumb').innerText()==='Home','Home breadcrumb');
    assert(await page.locator('#section-dashboard [data-back-target]').count()===0,'Home must have no back button in DOM');
    const layout=await page.evaluate(()=>{
      const nav=document.querySelector('#adminSidebar nav'),home=nav.firstElementChild;
      const section=document.querySelector('#section-dashboard'),heading=document.querySelector('#dashboardFinance .finance-heading');
      return {first:home.textContent.trim(),topLevel:!home.closest('.sidebar-children'),active:home.getAttribute('aria-current'),headingOffset:heading.getBoundingClientRect().top-section.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert(layout.first==='Home' && layout.topLevel && layout.active==='page','Home must be first top-level active entry');
    assert(layout.headingOffset>=0 && layout.headingOffset<10,'Home header must have no leftover back-button gap');
    assert(!layout.overflow,'page must not overflow');
    if(size.width<800) {
      await page.getByRole('button',{name:'Abrir menú',exact:true}).click();
      await page.getByRole('button',{name:'Home',exact:true}).click();
      await page.waitForFunction(()=>!document.body.classList.contains('sidebar-open'));
    }
    await page.locator('#dashboardFinance').getByRole('button',{name:'Meses',exact:true}).click();
    assert(await page.locator('#dashboardFinance').getByRole('button',{name:'Meses',exact:true}).getAttribute('aria-pressed')==='true','finance grouping still works');
    await page.locator('#dashboardVisitors .visitor-day[data-day="2026-09-07"]').click();
    await page.locator('.visitor-results').getByText('2 con sesión · 0 sin sesión',{exact:true}).waitFor();
    await page.locator('#dashboardVisitors [data-category]').selectOption('anonymous');
    await page.locator('.visitor-results').getByText('No hay visitas para estos filtros.',{exact:true}).waitFor();
    await page.locator('#section-dashboard').screenshot({path:`test-results/admin-review/home-${size.width}.png`});
    // Direct links and existing back handler are exercised without changing destinations.
    await page.goto('http://127.0.0.1:43123/admin.html#section-products');
    await page.locator('#section-products').waitFor({state:'visible'});
    const back=page.locator('#section-products [data-back-target]').first();
    await back.waitFor({state:'visible'});
    await back.click();
    await page.locator('#section-products-menu').waitFor({state:'visible'});
    await page.goto('http://127.0.0.1:43123/admin.html#section-dashboard');
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
    await page.goto('http://127.0.0.1:43123/admin.html#section-activity');
    await page.locator('#section-activity').waitFor({state:'visible'});
    await page.locator('#section-activity [data-back-target]').first().click();
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
    result[size.width]={...layout,defaultHome:true,oldLinkCompatible:true,productsBack:true,activityBack:true,financeGrouping:true,visitorDetailAndFilter:true};
  }
  // ADMIN keeps its existing access to Home and users.
  const admin=await page.context().browser().newContext(),adminPage=await admin.newPage();
  await adminPage.goto('http://127.0.0.1:43123/__visitorreview/ADMIN');
  await adminPage.getByRole('heading',{name:'Home',exact:true}).waitFor();
  await adminPage.goto('http://127.0.0.1:43123/admin.html#section-users');
  await adminPage.locator('#section-users').waitFor({state:'visible'});
  assert(await adminPage.locator('#adminSidebar [data-nav-target="section-users"]').isVisible(),'ADMIN users access remains available');
  result.adminPermissionsPreserved=true;
  await admin.close();
  const guest=await page.context().browser().newContext(),guestPage=await guest.newPage();
  await guestPage.route('**/admin-login.html?**',route=>route.fulfill({contentType:'text/html',body:'<title>Isolated denied destination</title>'}));
  await guestPage.goto('http://127.0.0.1:43123/admin.html');
  assert(!await guestPage.locator('#adminShell').isVisible(),'unauthenticated shell remains protected');
  await guestPage.waitForURL('**/admin-login.html?**');
  result.unauthenticatedAccessBlocked=true;
  await guest.close();
  const customer=await page.context().browser().newContext(),customerPage=await customer.newPage();
  await customerPage.route('**/admin-login.html?**',route=>route.fulfill({contentType:'text/html',body:'<title>Isolated denied destination</title>'}));
  await customerPage.goto('http://127.0.0.1:43123/__visitorreview/USER');
  await customerPage.waitForURL('**/admin-login.html?**');
  assert(!await customerPage.locator('#adminShell').isVisible(),'USER must not gain panel access');
  result.customerAccessBlocked=true;
  await customer.close();
  return result;
}
