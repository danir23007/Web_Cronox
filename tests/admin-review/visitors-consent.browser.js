// Browser regression for the isolated review-visitors.cjs fixture only.
async page => {
  if (new URL(page.url()).origin !== "http://127.0.0.1:43123") throw Error("ISOLATED_REVIEW_PAGE_REQUIRED");
  const assert = (value, message) => { if (!value) throw Error(message); };
  const admin = await page.context().browser().newContext();
  const panel = await admin.newPage();
  await panel.goto('http://127.0.0.1:43123/__visitorreview/SUPERADMIN');
  const totals = () => panel.evaluate(async () => {
    const day = new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Madrid'});
    return (await (await fetch('/api/admin/visitors/day?day='+day+'&category=all')).json()).totals;
  });
  const baseline = await totals();
  await page.context().clearCookies();
  const other = await page.context().newPage();
  const visits = [page,other].map(tab=>tab.waitForResponse(r=>r.url().endsWith('/api/analytics/visits') && r.status()===202));
  await Promise.all([page.goto('http://127.0.0.1:43123/'),other.goto('http://127.0.0.1:43123/')]);
  await Promise.all(visits);
  const anonymous = await totals();
  assert(anonymous.authenticated===baseline.authenticated && anonymous.anonymous===baseline.anonymous+1,'first concurrent tabs must share one anonymous browser');
  const proof = (await page.context().cookies()).find(c=>c.name==='cronox_daily_visitor');
  assert(proof?.httpOnly,'browser proof must be HttpOnly');
  const login = page.waitForResponse(r=>r.url().endsWith('/api/auth/login'));
  await page.getByRole('button',{name:'Login USER',exact:true}).click();await login;
  const converted = await totals();assert(converted.authenticated===baseline.authenticated && converted.anonymous===baseline.anonymous,'login must reconcile');
  const legacy = await page.context().browser().newContext();
  await legacy.addInitScript(() => Object.defineProperty(navigator,'locks',{value:undefined}));
  await legacy.addCookies((await page.context().cookies()).filter(c=>['jwt','refresh_token'].includes(c.name)));
  const legacyPage = await legacy.newPage();
  const legacyVisit = legacyPage.waitForResponse(r=>r.url().endsWith('/api/analytics/visits') && r.status()===202);
  await legacyPage.goto('http://127.0.0.1:43123/');await legacyVisit;
  assert(!(await legacy.cookies()).some(c=>c.name==='cronox_daily_visitor'),'without Web Locks never issue a new anonymous proof');
  assert((await totals()).authenticated===1,'verified account without Web Locks must deduplicate');
  await legacy.close();
  const guestVisit = page.waitForResponse(r=>r.url().endsWith('/api/analytics/visits') && r.status()===202);
  await page.getByRole('button',{name:'Logout',exact:true}).click();await guestVisit;
  const loggedOut = await totals();assert(loggedOut.authenticated===baseline.authenticated && loggedOut.anonymous===baseline.anonymous,'logout must preserve classification');
  const cleared = page.waitForResponse(r=>r.url().endsWith('/api/analytics/visits/consent-revoked') && r.status()===204);
  await page.getByRole('button',{name:'Withdraw consent',exact:true}).click();await cleared;
  assert(!(await page.context().cookies()).some(c=>c.name==='cronox_daily_visitor'),'consent withdrawal must clear proof');
  let posts=0;
  await page.route('**/api/analytics/visits/session',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Synthetic outage"}'}));
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/api/analytics/visits'))posts++;});
  await page.goto('http://127.0.0.1:43123/');
  await page.waitForResponse(r=>r.url().endsWith('/api/analytics/visits/session') && r.status()===503);
  assert(posts===0,'authentication failure must never POST a guest visit');
  await other.close();await panel.close();await admin.close();
  return {anonymous,converted,loggedOut,httpOnly:proof.httpOnly,proofCleared:true,outageGuestPosts:posts,accountWithoutWebLocks:true};
}
