// Full real HTTP/database/auth flow on the empty isolated NODE_ENV=test profile.
async page => {
  const fixture = __FIXTURE__;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const chosen = fixture.products[0];
  const size = chosen.variants.find(v => v.size === 'S');
  const available = chosen.variants.find(v => v.size === 'L');
  assert(fixture.origin === 'http://127.0.0.1:43129', 'Only the isolated test origin is permitted');
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    sessionStorage.setItem('cronox_newsletter_seen', '1');
  });
  await page.setViewportSize({ width: 1365, height: 900 });
  const writes = [];
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/waitlist/') && ['POST', 'DELETE'].includes(r.method())) writes.push({ url: r.url(), method: r.method() }); });
  // Force a document navigation even when the CLI starts on the same URL:
  // the supported test API-base override must run before the API bundle.
  await page.goto(fixture.origin + '/?qa-alert-test=' + Date.now() + '#store');
  await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length === 2);
  await page.waitForFunction(() => !document.getElementById('preloader'));
  const cookies = page.getByRole('button', { name: /^rechazar$/i });
  if (await cookies.isVisible()) await cookies.click();
  await page.locator('[data-slug="' + chosen.slug + '"] .fav-add').click();
  assert(await page.locator('#qaSizes [data-size="L"]').getAttribute('aria-checked') === 'true', 'Initial available size was not marked');
  assert(await page.locator('#qaNotify').isDisabled(), 'Available size enabled an alert');
  await page.locator('#qaSizes [data-size="S"]').click();
  assert(await page.locator('#qaNotify').isEnabled(), 'Chosen exhausted size cannot open alerts');
  await page.locator('#qaNotify').click();
  await page.waitForURL(url => url.pathname === '/producto/' + chosen.slug && url.hash === '#productWaitlist');
  await page.locator('#restockSize').waitFor();
  assert(await page.locator('#restockSize').inputValue() === String(size.id), 'The explicitly chosen size was lost');
  assert(writes.length === 0, 'An alert was subscribed automatically');
  const guest = await page.evaluate(async id => {
    const r = await fetch('/api/waitlist/' + id, { method: 'POST', headers: await window.CRONOX_API.getCsrfHeaders(), credentials: 'include' });
    return r.status;
  }, size.id);
  assert(guest === 401, 'JWT authentication was not enforced');
  await page.locator('#restockSize').selectOption(String(size.id));
  await page.waitForFunction(() => document.querySelector('#productWaitlist button').textContent === 'Iniciar sesión o registrarme');
  await page.locator('#productWaitlist button').click();
  await page.locator('#authLoginEmail').fill(fixture.actor.email);
  await page.locator('#authLoginPassword').fill(fixture.actor.password);
  await page.locator('#authLoginForm button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#productWaitlist button').textContent === 'Avísame cuando vuelva');
  assert(writes.length === 1, 'Login subscribed without explicit confirmation');
  const csrf = await page.evaluate(async id => {
    const r = await fetch('/api/waitlist/' + id, { method: 'POST', credentials: 'include' });
    return { status: r.status, data: await r.json() };
  }, size.id);
  assert(csrf.status === 403 && csrf.data.message === 'Validacion CSRF requerida', 'CSRF protection was not preserved');
  const eligible = await page.evaluate(async id => {
    const r = await fetch('/api/waitlist/' + id, { method: 'POST', headers: await window.CRONOX_API.getCsrfHeaders(), credentials: 'include' });
    return { status: r.status, data: await r.json() };
  }, available.id);
  assert(eligible.status === 409, 'A purchasable size accepted an alert');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/waitlist/' + size.id && r.request().method() === 'POST');
  await page.locator('#productWaitlist button').click();
  const saved = await response;
  assert(saved.status() === 201, 'Explicit confirmation failed: HTTP ' + saved.status() + ' ' + await saved.text());
  const subscription = (await saved.json()).subscription;
  await page.waitForFunction(() => document.querySelector('#productWaitlist button').textContent === 'Cancelar aviso');
  assert(await page.locator('#restockSize').inputValue() === String(size.id), 'The confirmed size changed');
  assert((await page.locator('.restock-choice').textContent()).includes('Talla S'), 'Wrong size in confirmation');
  const duplicate = await page.evaluate(async id => {
    const r = await fetch('/api/waitlist/' + id, { method: 'POST', headers: await window.CRONOX_API.getCsrfHeaders(), credentials: 'include' });
    return await r.json();
  }, size.id);
  assert(duplicate.existing && duplicate.subscription.id === subscription.id, 'Repeated confirmation duplicated the alert');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#productWaitlist button')?.textContent === 'Cancelar aviso');
  assert(await page.locator('#restockSize').inputValue() === String(size.id), 'Reload changed the chosen size');
  await page.locator('#productWaitlist').screenshot({ path: 'output/playwright/last-units-release/isolated-desktop-subscribed.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#productWaitlist').screenshot({ path: 'output/playwright/last-units-release/isolated-mobile-subscribed.png' });
  const cancel = page.waitForResponse(r => new URL(r.url()).pathname === '/api/waitlist/' + size.id && r.request().method() === 'DELETE');
  await page.locator('#productWaitlist button').click();
  assert((await cancel).status() === 200, 'Cancellation failed');
  await page.waitForFunction(() => document.querySelector('.restock-status').textContent === 'Aviso cancelado.');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#productWaitlist button')?.textContent === 'Avísame cuando vuelva');
  assert(writes.every(r => !r.url.includes('/' + fixture.products[1].variants[1].id)), 'The other product received an alert request');
  return { profile: 'fresh isolated test database; no overridden guards', guest: guest, csrf: csrf.status,
    availableSize: eligible.status, confirm: 201, duplicate: 'same subscription', persistence: 'passed',
    cancel: 200, selectedProduct: chosen.slug, selectedSize: 'S', desktop: 'passed', mobile: 'passed' };
}
