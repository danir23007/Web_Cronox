async (page) => {
  const origin = 'http://localhost:3000';
  if (new URL(page.url()).origin !== origin) throw new Error('Local review only');
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.goto(`${origin}/admin.html#section-key-screen`);
  await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset')?.disabled);
  const read = path => page.evaluate(async path => {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Read ${response.status}`);
    return response.json();
  }, path);
  const original = await read('/api/admin/black-friday');
  const gateBefore = (await read('/api/admin/key-screens')).settings;
  const stableGate = settings => JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([name]) => name !== 'serverTime')));
  const form = page.locator('#bfAdminForm');
  const enabled = form.locator('[name="enabled"]');
  const save = async () => {
    const responsePromise = page.waitForResponse(response => response.url() === `${origin}/api/admin/black-friday` && response.request().method() === 'PATCH');
    await form.locator('[type="submit"]').click();
    const response = await responsePromise;
    check(response.ok(), `Save failed: ${response.status()}`);
    await page.waitForFunction(() => document.querySelector('#bfAdminMessage').textContent.startsWith('Campaña guardada'));
    check(!await page.evaluate(() => window.CRONOX_ADMIN_SHELL.hasDirty()), 'Saved campaign remains marked as unsaved');
  };
  let visitor;
  try {
    const revision = (await read('/api/admin/black-friday')).revision;
    const start = await form.locator('[name="startsAt"]').inputValue();
    await form.locator('[name="endsAt"]').fill(start);
    await form.locator('[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#bfAdminMessage').textContent.includes('posterior'));
    check((await read('/api/admin/black-friday')).revision === revision, 'Invalid dates were written');
    const end = await page.evaluate(value => window.CRONOX_MADRID_TIME.utcToMadridLocal(value), original.endsAt);
    await form.locator('[name="endsAt"]').fill(end);
    const draft = `${original.bannerText} · REVISIÓN LOCAL`;
    await form.locator('[name="bannerText"]').fill(draft);
    await enabled.uncheck();
    await save();
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset')?.disabled);
    check(!await enabled.isChecked(), 'Disabled state not persisted');
    check(await form.locator('[name="bannerText"]').inputValue() === draft, 'Settings not retained after reload');
    check((await read('/api/black-friday')).enabled === false, 'Disabled public state is active');
    await enabled.check();
    await save();
    visitor = await page.context().newPage();
    await visitor.goto(`${origin}/`);
    await visitor.locator('.bf-hero').waitFor({ state: 'visible' });
    await enabled.uncheck();
    await save();
    await visitor.locator('.bf-hero').waitFor({ state: 'detached' });
    check(await visitor.locator('html').evaluate(el => !el.classList.contains('bf-active') && !el.style.getPropertyValue('--bf-offset')), 'Disabled campaign left layout overrides');
    check((await visitor.locator('.topbar').boundingBox()).y === 0, 'Header not restored');
    await enabled.check();
    await save();
    await visitor.locator('.bf-hero').waitFor({ state: 'visible' });
    check((await read('/api/admin/black-friday')).bannerText === draft, 'Reactivation erased settings');
    check(stableGate(gateBefore) === stableGate((await read('/api/admin/key-screens')).settings), 'Campaign changed preregistration or launch settings');
  } finally {
    // Restore the existing local configuration, including its activation flag.
    await page.evaluate(async original => {
      const response = await fetch('/api/admin/black-friday', { cache: 'no-store' });
      const current = await response.json();
      const fields = ['title', 'bannerText', 'startsAt', 'endsAt', 'eventText', 'textColor', 'backgroundColor'];
      const body = { enabled: original.enabled, revision: current.revision };
      for (const key of fields) body[key] = original[key];
      const result = await fetch('/api/admin/black-friday', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...await window.CRONOX_API.getCsrfHeaders() }, body: JSON.stringify(body) });
      if (!result.ok) throw new Error('Could not restore existing local configuration');
    }, original);
    await page.locator('#bfReload').click();
    await page.waitForFunction(enabled => document.querySelector('#bfAdminForm [name="enabled"]').checked === enabled, original.enabled);
    if (visitor) await visitor.close();
  }
  return { passed: ['invalid dates rejected without writing', 'save/reload', 'disable/reactivate retains configuration', 'manual disable updates another local tab', 'original header restored', 'preregistration and launch unchanged'], finalState: 'original local settings and activation flag restored' };
}
