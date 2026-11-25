async (page) => {
  if (new URL(page.url()).origin !== 'http://localhost:3000') throw new Error('Local review only');
  await page.goto('http://localhost:3000/admin.html#section-key-screen');
  await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset')?.disabled);
  const form = page.locator('#bfAdminForm');
  const enabled = await form.locator('[name="enabled"]').isChecked();
  const text = 'BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00';
  await form.locator('[name="bannerText"]').fill(text);
  await form.locator('[name="startsAt"]').fill('2026-11-26T21:00');
  await form.locator('[name="endsAt"]').fill('2026-11-28T00:00');
  const response = page.waitForResponse(response => response.url() === 'http://localhost:3000/api/admin/black-friday' && response.request().method() === 'PATCH');
  await form.locator('[type="submit"]').click();
  if (!(await response).ok()) throw new Error('Local configuration save failed');
  await page.waitForFunction(() => document.querySelector('#bfAdminMessage').textContent.startsWith('Campaña guardada'));
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset')?.disabled);
  if (await form.locator('[name="bannerText"]').inputValue() !== text || await form.locator('[name="startsAt"]').inputValue() !== '2026-11-26T21:00') throw new Error('Saved values lost on reload');
  if (await form.locator('[name="enabled"]').isChecked() !== enabled) throw new Error('Activation flag changed');
  return { saved: 'local Spanish banner, start 26/11/2026 21:00 Europe/Madrid, end 28/11/2026 00:00 Europe/Madrid', enabled };
}
