// Run with playwright-cli run-code --filename tests/newsletter/review-auth.cli.js
async (page) => {
  const browser = page.context().browser();
  const origin = 'http://localhost:3000';
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const report = [];
  const setup = async ({ subscribed = false, authenticated = false, hold = false } = {}) => {
    const context = await browser.newContext();
    let logged = authenticated;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const user = { id: 123, role: 'USER', email: 'fixture@example.test', newsletterSubscribed: subscribed };
    const errors = [];
    await context.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    await context.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      if (p === '/api/me') {
        if (hold) await pending;
        return route.fulfill({ status: logged ? 200 : 401, json: logged ? user : {} });
      }
      if (p === '/api/auth/login') { logged = true; return route.fulfill({ json: { user } }); }
      if (p === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'local-review' } });
      if (p === '/api/auth/refresh') return route.fulfill({ status: 401, json: {} });
      if (p === '/api/favorites') return route.fulfill({ json: [] });
      if (p === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
      if (p === '/api/newsletter/config') return route.fulfill({ json: {} });
      if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: {} });
      return route.continue();
    });
    const tab = await context.newPage();
    tab.on('pageerror', error => errors.push(error.message));
    await tab.goto(origin);
    const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    return { context, tab, release, errors };
  };
  const state = tab => tab.evaluate(() => ({ auth: CRONOX_AUTH_STATE, marker: sessionStorage.getItem('cronoxNewsletterShown'), pending: CRONOX_NEWSLETTER_VISIT.create().hasPending(), visible: !!document.querySelector('.newsletter-modal-overlay--visible') }));
  for (const subscribed of [true, false]) {
    const c = await setup({ subscribed, authenticated: true, hold: true });
    try {
      await c.tab.waitForTimeout(6500);
      const unknown = await state(c.tab);
      check(unknown.auth === 'unknown' && !unknown.pending && !unknown.visible, 'Unresolved authentication must not schedule');
      c.release();
      await c.tab.waitForFunction(() => CRONOX_AUTH_STATE === 'authenticated');
      await c.tab.waitForTimeout(6500);
      const restored = await state(c.tab);
      check(!restored.visible && !restored.pending && restored.marker === null, 'Valid session must never auto-open');
      await c.tab.reload();
      await c.tab.waitForTimeout(6500);
      const reloaded = await state(c.tab);
      check(reloaded.auth === 'authenticated' && !reloaded.visible && !reloaded.pending, 'Valid session reload must never auto-open');
      check(c.errors.length === 0, 'Unexpected JavaScript errors');
      await c.tab.screenshot({ path: 'output/playwright/newsletter-session/authenticated-' + subscribed + '.png' });
      report.push({ subscribed, unknown, restored, reloaded, errors: c.errors });
    } finally { await c.context.close(); }
  }
  const login = await setup();
  try {
    await login.tab.waitForFunction(() => CRONOX_AUTH_STATE === 'anonymous' && CRONOX_NEWSLETTER_VISIT.create().hasPending());
    await login.tab.getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
    await login.tab.locator('#authLoginEmail').fill('fixture@example.test');
    await login.tab.locator('#authLoginPassword').fill('local-fixture-only');
    await login.tab.locator('#authLoginForm').getByRole('button', { name: 'ACCEDER', exact: true }).click();
    await login.tab.waitForFunction(() => CRONOX_AUTH_STATE === 'authenticated');
    const afterLogin = await state(login.tab);
    check(!afterLogin.pending && afterLogin.marker === null, 'Login must cancel timer before deadline');
    await login.tab.waitForTimeout(6500);
    check(!(await state(login.tab)).visible, 'Cancelled timer must not show after login');
    check(login.errors.length === 0, 'Unexpected login JavaScript errors');
    report.push({ loginBeforeDeadline: afterLogin, afterDeadline: await state(login.tab), errors: login.errors });
  } finally { await login.context.close(); }
  const fresh = await setup();
  try {
    await fresh.tab.waitForFunction(() => !!document.querySelector('.newsletter-modal-overlay--visible'));
    const newSession = await state(fresh.tab);
    check(newSession.marker === 'true' && !newSession.pending, 'Independent new session must show again and consume marker');
    await fresh.tab.screenshot({ path: 'output/playwright/newsletter-session/new-session.png' });
    await fresh.tab.evaluate(async () => {
      const user = await CRONOX_API.login({ email: 'fixture@example.test', password: 'local-fixture-only' });
      window.CRONOX_USER = user;
      window.CRONOX_AUTH_STATE = 'authenticated';
      window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user }));
      window.dispatchEvent(new CustomEvent('cronox:authResolved', { detail: { state: 'authenticated', user } }));
    });
    const afterAuthentication = await state(fresh.tab);
    check(!afterAuthentication.visible && !afterAuthentication.pending, 'Authentication must close an already open automatic popup');
    check(fresh.errors.length === 0, 'Unexpected new session JavaScript errors');
    report.push({ newSession, afterAuthentication, errors: fresh.errors });
  } finally { await fresh.context.close(); }
  return report;
}
