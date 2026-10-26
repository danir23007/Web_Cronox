async page => {
  // Run with the disposable review-newsletter-registration.cjs server only.
  const origin = 'http://127.0.0.1:43128';
  const options = new URL(page.url()).searchParams;
  const [viewport, source] = (options.get('review') || '1366-footer').split('-');
  const width = Number(viewport);
  const entry = source;
  const report = [], stamp = Date.now().toString(36);
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const setup = async (scenario, kind = 'new') => {
    const context = await page.context().browser().newContext({
      viewport: { width, height: width < 500 ? 844 : 900 },
      isMobile: width < 500, hasTouch: width < 500,
    });
    const email = `${entry}-${width}-${scenario}-${stamp}@newsletter.test`;
    const seeded = await context.request.post(origin + '/__review/seed', { data: { email, kind } });
    check(seeded.ok(), 'Fixture creation failed');
    if (entry === 'footer') await context.addInitScript(() => sessionStorage.setItem('cronoxNewsletterShown', 'true'));
    const tab = await context.newPage(), requests = [], errors = [];
    tab.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && /^\/api\/(newsletter|auth\/register)/.test(path)) requests.push(path);
    });
    tab.on('pageerror', error => errors.push(error.name));
    await tab.goto(origin);
    const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
    const state = async () => (await context.request.get(origin + '/__review/state?email=' + email)).json();
    const begin = async () => {
      if (entry === 'footer') {
        await tab.locator('.footer-newsletter-form input').fill(email);
        await tab.locator('.footer-newsletter-form button').click();
      } else {
        await tab.locator('.newsletter-modal-overlay--visible').waitFor({ timeout: 15000 });
        await tab.locator('.newsletter-modal-input').fill(email);
        await tab.locator('.newsletter-modal-button').click();
      }
      await tab.locator('#authOverlay.is-open').waitFor();
      check((await state()).users === (kind === 'existing' || kind === 'guest' ? 1 : 0), 'Start created an account');
      check(!requests.includes('/api/newsletter/subscribe'), 'Newsletter entry invoked checkout consent');
    };
    const fill = async () => {
      await tab.locator('#authRegisterFirstName').fill('Persona');
      await tab.locator('#authRegisterPassword').fill('FixturePassword1!');
    };
    const submit = () => tab.locator('#authRegisterForm button[type=submit]').click();
    const done = async () => {
      await tab.getByText('Suscripción completada', { exact: true }).waitFor();
      check(await tab.evaluate(() => window.CRONOX_AUTH_STATE === 'authenticated'), 'Missing normal session');
      const saved = await state();
      check(saved.users === 1 && saved.subscriptions === 1 && saved.subscribed && saved.linked && saved.hasPassword && saved.newsletterSubscribed, 'Account and consent not persisted together');
      check(saved.welcomes === 1 && saved.codes === 1 && saved.accessMessages === 0, 'Duplicated welcome, code or access message');
      check(!saved.verified, 'Newsletter entry incorrectly proved mailbox ownership');
      check(errors.length === 0, 'Unexpected page error');
      return saved;
    };
    return { context, tab, email, requests, errors, state, begin, fill, submit, done };
  };
  for (const kind of ['new', 'subscribed', 'existing']) {
    const c = await setup('abandon-' + kind, kind);
    try {
      const before = await c.state();
      await c.begin();
      check(JSON.stringify(before) === JSON.stringify(await c.state()), 'First step changed existing data');
      check(!(await c.tab.locator('#authContextNotice').textContent()).includes('opcional'), 'Optional account copy remains');
      await c.tab.locator('#authCloseBtn').click();
      await c.tab.reload();
      check(JSON.stringify(before) === JSON.stringify(await c.state()), 'Abandon changed persisted data');
      check(c.requests.length === 1, 'Abandon sent a mutation');
      report.push({ scenario: 'abandon-' + kind, passed: true });
    } finally { await c.context.close(); }
  }
  for (const kind of ['new', 'subscribed']) {
    const c = await setup('complete-' + kind, kind);
    try {
      const before = await c.state();
      await c.begin();
      check(await c.tab.locator('#authRegisterEmail').isHidden(), 'Email field is visible');
      check(await c.tab.locator('#authRegisterLastName').isHidden(), 'Unexpected surname requirement');
      await c.fill();
      await c.tab.screenshot({ path: `output/playwright/newsletter-required/${entry}-${width}-${kind}-register.png` });
      await c.submit();
      const saved = await c.done();
      if (kind === 'subscribed') check(saved.subscriptionId === before.subscriptionId && saved.consentAt === before.consentAt, 'Historical consent replaced');
      await c.tab.reload();
      await c.tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
      check(JSON.stringify(saved) === JSON.stringify(await c.state()), 'Reload changed persisted registration');
      report.push({ scenario: 'complete-' + kind, persisted: saved });
    } finally { await c.context.close(); }
  }
  const invalid = await setup('invalid-retry');
  try {
    await invalid.begin();
    await invalid.fill();
    await invalid.tab.locator('#authRegisterFirstName').fill('123');
    await invalid.submit();
    await invalid.tab.getByText('El nombre y el apellido solo pueden contener letras y espacios.', { exact: true }).waitFor();
    await invalid.tab.locator('#authRegisterFirstName').fill('Persona');
    await invalid.tab.locator('#authRegisterPassword').fill('short');
    await invalid.submit();
    await invalid.tab.locator('#authMessage[data-state=error]').waitFor();
    check(invalid.requests.filter(p => p.endsWith('/auth/register')).length === 0, 'Invalid form sent registration');
    await invalid.fill();
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await invalid.tab.route('**/api/auth/register', async route => {
      await held;
      await route.abort('failed');
    }, { times: 1 });
    await invalid.submit();
    await invalid.tab.locator('#authRegisterForm').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    check(await invalid.tab.locator('#authRegisterForm button[type=submit]').isDisabled(), 'No in-flight protection');
    release();
    await invalid.tab.getByText(/Revisa tu conexión/).waitFor();
    const empty = await invalid.state();
    check(empty.users === 0 && empty.subscriptions === 0 && empty.welcomes === 0 && empty.codes === 0, 'Network failure created partial data');
    check(await invalid.tab.locator('#authRegisterFirstName').inputValue() === 'Persona', 'Name lost on error');
    check(await invalid.tab.locator('#authRegisterPassword').inputValue() === 'FixturePassword1!', 'Password lost on error');
    await invalid.submit(); await invalid.done();
    check(invalid.requests.filter(p => p.endsWith('/auth/register')).length === 2, 'Double click caused duplicate registration');
    report.push({ scenario: 'invalid-connection-double-click-retry', passed: true });
  } finally { await invalid.context.close(); }
  for (const stage of ['NewsletterSubscription', 'NewsletterMailJob']) {
    const c = await setup('rollback-' + stage.toLowerCase());
    try {
      await c.begin(); await c.fill();
      await c.context.request.post(origin + '/__review/fault', { data: { email: c.email, stage } });
      const failure = c.tab.waitForResponse(response => response.url().endsWith('/api/auth/register') && response.status() === 500);
      await c.submit(); await failure;
      await c.tab.locator('#authMessage[data-state=error]').waitFor();
      const state = await c.state();
      check(state.users === 0 && state.subscriptions === 0 && state.welcomes === 0 && state.codes === 0, 'Database failure left partial records');
      check(await c.tab.locator('#authRegisterFirstName').inputValue() === 'Persona', 'Retry lost name');
      await c.context.request.post(origin + '/__review/fault', { data: { email: c.email, stage: null } });
      await c.submit(); await c.done();
      report.push({ scenario: 'rollback-' + stage + '-retry', passed: true });
    } finally { await c.context.close(); }
  }
  const existing = await setup('existing-login', 'existing');
  try {
    const before = await existing.state();
    await existing.begin();
    check(await existing.tab.locator('#authLoginForm').isVisible(), 'Existing account can edit registration');
    check(await existing.tab.locator('[data-auth-switch=register]').isHidden(), 'Existing account can overwrite credentials');
    await existing.tab.locator('#authLoginPassword').fill('WrongPassword1!');
    await existing.tab.locator('#authLoginForm button[type=submit]').click();
    await existing.tab.locator('#authMessage[data-state=error]').waitFor();
    check(JSON.stringify(before) === JSON.stringify(await existing.state()), 'Wrong password changed consent');
    await existing.tab.locator('#authLoginPassword').fill('FixturePassword1!');
    await existing.tab.locator('#authLoginForm button[type=submit]').click();
    const saved = await existing.done();
    check(saved.firstName === 'Original', 'Existing name changed');
    check(saved.codes === before.codes && saved.welcomes === before.welcomes, 'Existing account welcome duplicated');
    report.push({ scenario: 'existing-authenticated-opt-in', persisted: saved });
  } finally { await existing.context.close(); }
  return { viewport: width, entry, scenarios: report, emailTransport: 'in-memory', realDatabase: true };
}
