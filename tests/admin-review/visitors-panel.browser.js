// Browser regression for the isolated review-visitors.cjs fixture only.
async page => {
  if (new URL(page.url()).origin !== "http://127.0.0.1:43123") throw Error("ISOLATED_REVIEW_PAGE_REQUIRED");
  await page.goto('http://127.0.0.1:43123/admin.html');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#dashboardVisitors').scrollIntoViewIfNeeded();
  await page.locator('.visitor-day[data-day="2026-09-07"]').click();
  await page.locator('.visitor-results').getByText('2 con sesión · 0 sin sesión', {exact:true}).waitFor();
  const desktop = {help:await page.locator('#dashboardVisitors .finance-notice').first().innerText(),detail:await page.locator('.visitor-results').innerText(),chart:await page.locator('.visitor-day[data-day="2026-09-07"]').getAttribute('aria-label'),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
  await page.screenshot({path:'test-results/admin-review/visitors-desktop.png'});
  await page.locator('[data-category]').selectOption('anonymous');
  await page.locator('.visitor-results').getByText('No hay visitas para estos filtros.',{exact:true}).waitFor();
  const anonymous = await page.locator('.visitor-results').innerText();
  await page.locator('[data-category]').selectOption('authenticated');
  await page.locator('#dashboardVisitors [data-search]').fill('Synthetic FRIEND');
  await page.locator('.visitor-results').getByText('1 registros · Página 1 de 1',{exact:true}).waitFor();
  const search = await page.locator('.visitor-results').innerText();
  await page.setViewportSize({width:390,height:844});
  await page.locator('.visitor-detail').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/admin-review/visitors-mobile.png'});
  return {desktop,anonymous,search,mobile:{overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),table:await page.locator('.visitor-results').innerText()}};
}
