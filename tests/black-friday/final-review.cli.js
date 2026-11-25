async (page) => {
  if (new URL(page.url()).origin !== 'http://localhost:3000') throw new Error('Local review only');
  await page.goto('http://localhost:3000/admin.html#section-key-screen');
  await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset')?.disabled);
  const state = await page.evaluate(async () => {
    const saved = await (await fetch('/api/admin/black-friday', { cache: 'no-store' })).json();
    const publicState = await (await fetch('/api/black-friday', { cache: 'no-store' })).json();
    return { enabled: saved.enabled, title: saved.title, bannerText: saved.bannerText, startsAt: saved.startsAt, endsAt: saved.endsAt, eventText: saved.eventText, textColor: saved.textColor, backgroundColor: saved.backgroundColor, publicEnabled: publicState.enabled };
  });
  if (typeof state.enabled !== 'boolean') throw new Error('Invalid saved activation flag');
  if (state.startsAt !== '2026-11-26T20:00:00.000Z' || state.endsAt !== '2026-11-27T23:00:00.000Z') throw new Error('Requested dates were not saved');
  if (state.bannerText !== 'BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00') throw new Error('Requested Spanish marquee was not saved');
  if (await page.locator('.bf-banner,.bf-hero').count()) throw new Error('Campaign added to admin');
  return { verified: 'requested local settings saved, activation flag retained, no campaign on admin', settings: state };
}
