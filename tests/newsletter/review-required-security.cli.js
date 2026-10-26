async page => {
  const origin = 'http://127.0.0.1:43128', stamp = Date.now().toString(36), results = [];
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const fixture = async (label, kind = 'new') => {
    const context = await page.context().browser().newContext();
    const email = `${label}-${stamp}@newsletter.test`;
    check((await context.request.post(origin + '/__review/seed', { data: { email, kind } })).ok(), 'Seed failed');
    const csrf = (await (await context.request.get(origin + '/api/auth/csrf')).json()).csrfToken;
    const post = (path, data, headers = {}) => context.request.post(origin + '/api/' + path, { data, headers: { origin, 'x-csrf-token': csrf, ...headers } });
    const state = async () => (await context.request.get(origin + '/__review/state?email=' + email)).json();
    const dto = { email, firstName: 'Persona', password: 'FixturePassword1!', registrationSource: 'newsletter' };
    return { context, email, post, state, dto };
  };
  const invalid = await fixture('validation');
  try {
    check((await invalid.post('newsletter/complete-registration', { email: invalid.email })).status() === 401, 'Anonymous subscription accepted');
    check((await invalid.post('newsletter/start-registration', { email: 'bad' })).status() === 400, 'Invalid email accepted');
    check((await invalid.post('newsletter/start-registration', { email: invalid.email }, { 'x-csrf-token': '' })).status() === 403, 'Missing CSRF accepted');
    check((await invalid.post('newsletter/start-registration', { email: invalid.email }, { origin: 'https://foreign.test' })).status() === 403, 'Foreign origin accepted');
    check((await invalid.post('auth/register', { ...invalid.dto, firstName: '123' })).status() === 400, 'Invalid name accepted');
    check((await invalid.post('auth/register', { ...invalid.dto, password: 'short' })).status() === 400, 'Invalid password accepted');
    const state = await invalid.state();
    check(!state.users && !state.subscriptions && !state.codes && !state.welcomes, 'Invalid requests mutated persistence');
    results.push({ scenario: 'http-validation-csrf-anonymous-ownership', passed: true });
  } finally { await invalid.context.close(); }
  const race = await fixture('concurrent');
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, () => race.post('auth/register', race.dto)));
    check(responses.filter(r => r.status() === 201).length === 1 && responses.filter(r => r.status() === 409).length === 3, 'Concurrent signup not serialized');
    const saved = await race.state();
    check(saved.users === 1 && saved.subscriptions === 1 && saved.codes === 1 && saved.welcomes === 1 && saved.linked && saved.subscribed, 'Concurrent signup duplicates');
    check((await race.post('auth/register', { ...race.dto, firstName: 'Otro', password: 'Replacement1!' })).status() === 409, 'Retry changed credentials');
    check((await race.post('auth/login', { email: race.email, password: race.dto.password })).ok(), 'Original credentials lost');
    check(JSON.stringify(await race.state()) === JSON.stringify(saved), 'Retry changed saved account/consent');
    results.push({ scenario: 'four-concurrent-registrations-and-response-retry', passed: true });
  } finally { await race.context.close(); }
  const existing = await fixture('existing-proof', 'existing');
  try {
    const before = await existing.state();
    check((await existing.post('auth/register', existing.dto)).status() === 409, 'Existing account replaced');
    check(JSON.stringify(await existing.state()) === JSON.stringify(before), 'Existing account modified without proof');
    check((await existing.post('auth/login', { email: existing.email, password: 'FixturePassword1!' })).ok(), 'Login failed');
    check((await existing.post('newsletter/complete-registration', { email: 'different@newsletter.test' })).status() === 403, 'Authenticated user subscribed a different address');
    const responses = await Promise.all(Array.from({ length: 4 }, () => existing.post('newsletter/complete-registration', { email: existing.email })));
    check(responses.every(r => r.ok()), 'Concurrent authenticated consent failed');
    const saved = await existing.state();
    check(saved.subscriptions === 1 && saved.subscribed && saved.linked && saved.codes === before.codes && saved.welcomes === before.welcomes && saved.accessMessages === before.accessMessages && saved.firstName === before.firstName, 'Authenticated consent duplicates or changes account');
    results.push({ scenario: 'matching-authentication-and-four-concurrent-opt-ins', passed: true });
  } finally { await existing.context.close(); }
  const historical = await fixture('historical-rollback', 'subscribed');
  try {
    const before = await historical.state();
    await historical.context.request.post(origin + '/__review/fault', { data: { email: historical.email, stage: 'NewsletterMailJob' } });
    check((await historical.post('auth/register', historical.dto)).status() === 500, 'Controlled outbox failure not reached');
    check(JSON.stringify(before) === JSON.stringify(await historical.state()), 'Rollback changed historical subscription');
    await historical.context.request.post(origin + '/__review/fault', { data: { email: historical.email, stage: null } });
    check((await historical.post('auth/register', historical.dto)).status() === 201, 'Historical retry failed');
    const saved = await historical.state();
    check(saved.subscriptionId === before.subscriptionId && saved.consentAt === before.consentAt && saved.users === 1 && saved.welcomes === 1 && saved.codes === 1, 'Historical retry duplicates');
    results.push({ scenario: 'rollback-preserves-historical-consent-and-retry', passed: true });
  } finally { await historical.context.close(); }
  const recover = await fixture('recovery-return', 'existing');
  try {
    await recover.context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
    const tab = await recover.context.newPage();
    await tab.goto(origin);
    await tab.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
    await tab.locator('.footer-newsletter-form input').fill(recover.email);
    await tab.locator('.footer-newsletter-form button').click();
    await tab.locator('#authLoginForm [data-auth-forgot]').click();
    await tab.waitForURL('**/recuperar-contrasena');
    check(await tab.evaluate(() => Boolean(sessionStorage.getItem('cronoxNewsletterRecovery'))), 'Recovery intent lost');
    await tab.locator('#backToLogin').click();
    await tab.waitForURL(origin + '/');
    // The recovery page's return-to-login link should restore the intent.
    if (!(await tab.locator('#authOverlay').isVisible())) await tab.locator('#profileBtn').click();
    await tab.locator('#authLoginForm').waitFor({ state: 'visible' });
    check(await tab.locator('#authLoginEmail').inputValue() === recover.email, 'Recovery lost newsletter address');
    check((await tab.locator('#authContextNotice').textContent()).includes('completar la suscripción'), 'Recovery changed to ordinary login');
    check((await recover.state()).subscriptions === 0, 'Recovery alone subscribed account');
    await tab.locator('#authLoginPassword').fill('FixturePassword1!');
    await tab.locator('#authLoginForm button[type=submit]').click();
    await tab.getByText('Suscripción completada', { exact: true }).waitFor();
    results.push({ scenario: 'recovery-navigation-keeps-intent-without-consent-until-login', passed: true });
  } finally { await recover.context.close(); }
  for (const width of [390, 1366]) {
    const signedIn = await fixture('signed-in-' + width, 'existing');
    try {
      const before = await signedIn.state();
      check((await signedIn.post('auth/login', { email: signedIn.email, password: 'FixturePassword1!' })).ok(), 'Fixture login failed');
      const tab = await signedIn.context.newPage(); await tab.setViewportSize({ width, height: 900 });
      const writes = [];
      tab.on('request', request => {
        if (request.method() === 'POST' && /\/api\/(newsletter|auth\/(login|register))/.test(request.url())) writes.push(new URL(request.url()).pathname);
      });
      await tab.goto(origin);
      await tab.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
      await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
      check(!(await tab.locator('.footer-newsletter-legal').innerText()).includes('opcional'), 'Optional footer copy remains');
      check(await tab.locator('.footer-newsletter-legal a[href="/privacidad"]').count() === 1, 'Privacy link missing');
      await tab.locator('.footer-newsletter-form input').fill('different@newsletter.test');
      await tab.locator('.footer-newsletter-form button').click();
      await tab.getByText('Utiliza el correo de tu cuenta actual para suscribirte a la newsletter.', { exact: true }).waitFor();
      check(writes.length === 0 && JSON.stringify(before) === JSON.stringify(await signedIn.state()), 'Different address mutated account or consent');
      await tab.locator('.newsletter-modal-input').fill(signedIn.email);
      await tab.locator('.newsletter-modal-button').click();
      await tab.getByText('Suscripción completada', { exact: true }).waitFor();
      check(await tab.locator('#authOverlay').isHidden(), 'Authenticated user asked to register or sign in');
      check(writes.join(',') === '/api/newsletter/complete-registration', 'Authenticated flow called registration or login');
      const saved = await signedIn.state();
      check(saved.users === 1 && saved.subscriptions === 1 && saved.linked && saved.newsletterSubscribed && saved.firstName === 'Original', 'Current account was not reused');
      check(saved.codes === before.codes && saved.welcomes === before.welcomes, 'Authenticated opt-in duplicated a welcome or code');
      await tab.screenshot({ path: `output/playwright/newsletter-required/signed-in-${width}-completed.png` });
      await tab.reload();
      await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
      check(JSON.stringify(saved) === JSON.stringify(await signedIn.state()), 'Reload changed saved consent');
      results.push({ scenario: 'signed-in-current-account-and-different-address-' + width, passed: true });
    } finally { await signedIn.context.close(); }
    const regular = await fixture('ordinary-' + width);
    try {
      await regular.context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
      const tab = await regular.context.newPage(); await tab.setViewportSize({ width, height: 900 });
      await tab.goto(origin);
      await tab.getByRole('button', { name: 'RECHAZAR', exact: true }).click();
      await tab.locator('#profileBtn').click();
      await tab.locator('[data-auth-switch=register]').click();
      check(await tab.locator('#authRegisterEmail').isVisible(), 'Normal email hidden');
      check(await tab.locator('#authRegisterLastName').isVisible(), 'Normal surname hidden');
      await tab.locator('#authRegisterFirstName').fill('Persona');
      await tab.locator('#authRegisterLastName').fill('Prueba');
      await tab.locator('#authRegisterEmail').fill(regular.email);
      await tab.locator('#authRegisterPassword').fill('FixturePassword1!');
      await tab.locator('#authRegisterForm button[type=submit]').click();
      await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
      const saved = await regular.state();
      check(saved.users === 1 && saved.subscriptions === 0 && !saved.newsletterSubscribed && saved.welcomes === 1 && saved.codes === 1, 'Normal registration enrolled newsletter');
      results.push({ scenario: 'ordinary-registration-' + width, passed: true });
    } finally { await regular.context.close(); }
  }
  return { results, externalEmail: false, realDatabase: true };
}
