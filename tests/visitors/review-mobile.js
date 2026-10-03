async page => {
  await page.setViewportSize({width:390,height:844});
  await page.locator('.visitor-day[data-day="2026-09-07"]').click();
  await page.locator('.visitor-results').getByText('2 con sesión · 0 sin sesión', {exact:true}).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Administración"]').getBoundingClientRect().right <= 0);
  await page.locator('.visitor-detail').scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/visitors/mobile.png'});
  const result = {overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),table:await page.locator('.visitor-results').innerText()};
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#dashboardVisitors').screenshot({path:'output/visitors/desktop.png'});
  return result;
}
