// Run with playwright-cli run-code --filename tests/newsletter/review-session.cli.js
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = 'http://localhost:3000';
  const context = await page.context().browser().newContext();
  page = await context.newPage();
  const reports = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.clearCookies();
  await context.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    window.__newsletterOpenCount = 0;
    window.__newsletterTimerScheduled = 0;
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 5500) window.__newsletterTimerScheduled++;
      return schedule(callback, delay, ...args);
    };
    document.addEventListener('DOMContentLoaded', () => {
      const overlay = document.querySelector('.newsletter-modal-overlay');
      if (!overlay) return;
      let visible = false;
      new MutationObserver(() => {
        const next = overlay.classList.contains('newsletter-modal-overlay--visible');
        if (next && !visible) window.__newsletterOpenCount++;
        visible = next;
      }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });
  });
  await context.route('**/api/**', route => {
    const p = new URL(route.request().url()).pathname;
    if (['/api/me', '/api/auth/refresh', '/api/favorites'].includes(p)) return route.fulfill({ status: 401, json: {} });
    if (p === '/api/cart') return route.fulfill({ json: { items: [], itemsCount: 0 } });
    if (p === '/api/newsletter/config') return route.fulfill({ json: {} });
    if (p === '/api/auth/csrf') return route.fulfill({ json: { csrfToken: 'local-review' } });
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: {} });
    return route.continue();
  });
  await page.goto(origin);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('cronoxNewsletterDismissedAt'); });
  await page.reload();
  const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
  if (await reject.isVisible()) await reject.click();
  await page.waitForFunction(() => CRONOX_NEWSLETTER_VISIT.create().hasPending());
  await page.addScriptTag({ url: origin + '/assets/newsletter-visit.js?v=2' });
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('cronox:authResolved', { detail: { state: 'anonymous' } }));
  });
  await page.waitForFunction(() => document.querySelector('.newsletter-modal-overlay')?.classList.contains('newsletter-modal-overlay--visible'), null, { timeout: 16000 });
  const first = await page.evaluate(() => ({ marker: sessionStorage.getItem('cronoxNewsletterShown'), pending: CRONOX_NEWSLETTER_VISIT.create().hasPending(), count: window.__newsletterOpenCount, consent: CRONOX_COOKIE_CONSENT.hasConsent('preferences'), scheduledTimers: window.__newsletterTimerScheduled }));
  check(first.marker === 'true' && !first.pending && first.count === 1 && !first.consent, 'First anonymous display must consume session immediately without consent');
  check(first.scheduledTimers === 1, 'Repeated events and script initialization must not create duplicate timers');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/newsletter-session/first-anonymous.png' });
  await page.getByRole('button', { name: 'Cerrar newsletter', exact: true }).click();
  await page.waitForTimeout(6500);
  check(await page.evaluate(() => window.__newsletterOpenCount === 1), 'Close must not re-open');
  for (const url of ['/producto/scarred-tee-red', '/producto/scarred-tee-black', '/faqs.html', '/']) {
    await page.goto(origin + url);
    await page.waitForTimeout(6500);
    const state = await page.evaluate(() => ({ marker: sessionStorage.getItem('cronoxNewsletterShown'), visible: !!document.querySelector('.newsletter-modal-overlay--visible'), count: window.__newsletterOpenCount, pending: window.CRONOX_NEWSLETTER_VISIT?.create().hasPending() || false }));
    check(state.marker === 'true' && !state.visible && state.count === 0 && !state.pending, 'Navigation must not re-open: ' + url);
    reports.push({ url, ...state });
  }
  await page.reload();
  await page.waitForTimeout(6500);
  check(await page.evaluate(() => !document.querySelector('.newsletter-modal-overlay--visible') && !CRONOX_NEWSLETTER_VISIT.create().hasPending()), 'Reload must not re-open');
  await page.goBack();
  await page.waitForTimeout(6500);
  check(await page.evaluate(() => sessionStorage.getItem('cronoxNewsletterShown') === 'true' && !document.querySelector('.newsletter-modal-overlay--visible')), 'Back must retain consumed session');
  await page.goto(origin);
  await page.addScriptTag({ url: origin + '/assets/newsletter-visit.js?v=2' });
  const duplicate = await page.evaluate(() => ({ eligible: CRONOX_NEWSLETTER_VISIT.create().eligible(), pending: CRONOX_NEWSLETTER_VISIT.create().hasPending() }));
  check(!duplicate.eligible && !duplicate.pending, 'Script reinitialization must retain guard');
  await page.locator('.footer-newsletter-form input').fill('');
  await page.locator('.footer-newsletter-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  check(await page.locator('.newsletter-modal-overlay').evaluate(el => el.classList.contains('newsletter-modal-overlay--visible')), 'Voluntary opening must still work');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'output/playwright/newsletter-session/manual-after-limit.png' });
  check(errors.length === 0, 'Unexpected anonymous JavaScript errors');
  await context.close();
  return { first, reports, reload: 'PASS', back: 'PASS', duplicate, manual: 'PASS', errors };
}
