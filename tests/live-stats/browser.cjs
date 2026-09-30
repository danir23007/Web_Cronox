// Real local browser checks; no payment, email or production requests.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
(async () => {
  const env = loadLocalEnvironment();
  if (new URL(env.DATABASE_URL).hostname !== '127.0.0.1' || env.EMAIL_ENABLED !== 'false') throw Error('Local isolated environment required');
  const db = new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
  const browser = await chromium.launch();
  const visitor = await browser.newContext();
  mkdirSync('test-results/live-stats', { recursive:true });
  try {
    const publicPage = await visitor.newPage();
    publicPage.on('pageerror',e=>console.log('Public page error:',e.message));
    publicPage.on('response',r=>{if(/live-presence|live-stats|auth\/csrf/.test(r.url()))console.log(new URL(r.url()).pathname,r.status());});
    await publicPage.goto('http://localhost:3000/tienda');
    await publicPage.evaluate(()=>window.CRONOX_COOKIE_CONSENT.save({analytics:true,preferences:false,marketing:false}));
    await expect.poll(async()=> (await visitor.cookies()).some(c=>c.name==='cronox_live_visitor')).toBe(true);
    const cookie = (await visitor.cookies()).find(c=>c.name==='cronox_live_visitor').value;
    const another = await visitor.newPage();
    const secondSignal=another.waitForResponse(r=>r.url().endsWith('/api/live-stats/presence') && r.status()===204);
    await another.goto('http://localhost:3000/');
    await secondSignal;
    await expect.poll(async()=> (await visitor.cookies()).find(c=>c.name==='cronox_live_visitor').value).toBe(cookie);
    const hash = createHash('sha256').update(JSON.parse(Buffer.from(cookie.split('.')[1],'base64url')).vid).digest('hex');
    await expect.poll(()=>db.livePresence.count({where:{visitorHash:hash}})).toBe(1);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.install();
    await page.goto('http://localhost:3000/admin.html');
    await page.locator('#adminLoginEmail').fill(env.LOCAL_ADMIN_EMAIL);
    await page.locator('#adminLoginPassword').fill(env.LOCAL_ADMIN_PASSWORD);
    await page.locator('#adminLoginSubmit').click();
    await page.waitForURL('**/admin.html');
    await expect(page.locator('.sidebar-live')).toHaveAttribute('data-activity','active');
    await page.locator('#adminSidebar [data-nav-target="section-live-stats"]').click();
    const section=page.locator('#section-live-stats');
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-state','ready');
    await expect(section.locator('.live-stat strong').first()).toHaveText('1');
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.adminTheme=theme;localStorage.setItem('cronox.admin.theme',theme);},theme);
      for (const width of [320,390,768,1366]) {
        await page.setViewportSize({width,height:900});
        // Let the existing drawer's responsive transition settle before capture.
        await page.waitForTimeout(350);
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({path:`test-results/live-stats/live-stats-${theme}-${width}.png`,fullPage:true});
      }
    }
    const before=await section.locator('.live-stat strong').first().textContent();
    await page.setViewportSize({width:390,height:700});
    await page.locator('#sidebarToggle').click();
    await expect(page.locator('#adminSidebar [data-nav-target="section-live-stats"]')).toBeVisible();
    await page.locator('#adminSidebar [data-nav-target="section-live-stats"]').click();
    await expect(page.locator('body')).not.toHaveClass(/sidebar-open/);
    await page.route('**/api/admin/live-stats',route=>route.abort());
    await section.locator('[data-live-refresh]').click();
    await expect(section).toHaveAttribute('data-state','error');
    await expect(page.locator('.sidebar-live')).toHaveAttribute('data-activity','unavailable');
    await expect(section.locator('.live-stat strong').first()).toHaveText(before);
    await page.screenshot({path:'test-results/live-stats/live-stats-error.png',fullPage:true});
    await page.unroute('**/api/admin/live-stats');
    await section.locator('[data-live-refresh]').click();
    await expect(section).toHaveAttribute('data-state','ready');
    let requests=0;
    page.on('request',r=>{if(r.url().endsWith('/api/admin/live-stats'))requests++;});
    await page.evaluate(()=>{location.hash='section-dashboard';});
    await expect(section).toBeHidden();
    await page.clock.fastForward(16000);
    await expect.poll(()=>requests).toBe(1);
    expect(requests).toBe(1);
    await page.clock.resume();
    await page.goto('http://localhost:3000/admin-user.html?id=1');
    await expect(page.locator('.sidebar-live')).toHaveAttribute('data-activity','active');
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.adminTheme=t,theme);
      await page.setViewportSize({width:390,height:400});
      await page.locator('#sidebarToggle').click();
      const link=page.locator('#adminSidebar [data-nav-target="section-live-stats"]');
      await link.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({path:`test-results/live-stats/live-stats-menu-${theme}-mobile.png`});
      await expect(link).toBeInViewport();
      await page.locator('#adminSidebar #logoutBtn').scrollIntoViewIfNeeded();
      await expect(page.locator('#adminSidebar #logoutBtn')).toBeInViewport();
      await page.screenshot({path:`test-results/live-stats/live-stats-menu-${theme}-mobile-bottom.png`});
      await page.keyboard.press('Escape');
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.locator('.live-activity-dot').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
    await publicPage.close(); await another.close();
    await db.livePresence.updateMany({where:{visitorHash:hash},data:{seenAt:new Date(Date.now()-121000)}});
    await page.reload();
    await expect(page.locator('.sidebar-live')).toHaveAttribute('data-activity','empty');
    expect(await page.locator('.live-activity-dot').evaluate(el=>getComputedStyle(el).visibility)).toBe('hidden');
    console.log('PASS: real admin login, two public tabs share one visitor, live data, error retention/retry, one shared poll continues off-section, no overflow at 320/390/768/1366 in both themes.');
  } finally {
    const cookie=(await visitor.cookies()).find(c=>c.name==='cronox_live_visitor');
    await browser.close();
    if(cookie) {
      const vid=JSON.parse(Buffer.from(cookie.value.split('.')[1],'base64url')).vid;
      await db.livePresence.deleteMany({where:{visitorHash:createHash('sha256').update(vid).digest('hex')}});
    }
    await db.$disconnect();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
