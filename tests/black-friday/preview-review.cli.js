async (page) => {
  if (new URL(page.url()).origin !== 'http://localhost:3000') throw new Error('Local review only');
  await page.goto('http://localhost:3000/admin.html#section-key-screen');
  const form = page.locator('#bfAdminForm');
  await form.locator('fieldset').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#bfAdminForm fieldset').disabled);
  await page.locator('#bfPreviewState').selectOption('before');
  await page.locator('#bfPreviewFormat').selectOption('hero');
  await page.locator('#bfPreviewOpen').click();
  const frame = page.frameLocator('#bfPreview');
  await frame.locator('.bf-hero').waitFor({ state: 'visible' });
  for (const device of ['desktop', 'mobile']) {
    await page.locator('#bfPreviewDevice').selectOption(device);
    for (const state of ['before', 'event']) {
      if (state === 'before') await page.locator('#bfPreviewState').selectOption('before');
      await page.locator('#bfPreviewState').selectOption(state);
      for (const format of state === 'event' ? ['compact'] : ['hero', 'compact']) {
        if (state === 'before') await page.locator('#bfPreviewFormat').selectOption(format);
        const selector = format === 'hero' ? '.bf-hero' : '.bf-banner';
        await frame.locator(selector).waitFor({ state: 'visible' });
        await page.waitForFunction(compact => {
          const doc = document.querySelector('#bfPreview').contentDocument;
          const bar = doc.querySelector('.topbar'), banner = doc.querySelector('.bf-banner');
          return bar && banner && Math.abs(bar.getBoundingClientRect().top - (compact ? banner.getBoundingClientRect().height : 0)) < 0.5;
        }, format === 'compact');
        const label = await frame.locator(`${selector} .bf-clock-label`).innerText();
        if (label !== (state === 'event' ? 'TERMINA EN' : 'EMPIEZA EN')) throw new Error(`Wrong state ${device}/${state}/${format}`);
        if (state === 'event' && await frame.locator('.bf-hero,.bf-host').count()) throw new Error('Event preview retained hero campaign');
        const size = await frame.locator('html').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        if (size.scroll > size.width + 1) throw new Error('Preview horizontal overflow');
        await page.locator('#bfPreview').screenshot({ path: `output/black-friday/preview-${device}-${state}-${format}.png` });
      }
    }
  }
  await page.locator('#bfPreviewClose').click();
  if (await page.evaluate(() => window.CRONOX_ADMIN_SHELL.hasDirty())) throw new Error('Preview controls marked configuration as unsaved');
  return { passed: ['desktop/mobile pre-event hero and banner', 'event preview always compact without hero overlay', 'Madrid labels', 'no horizontal overflow', 'preview does not dirty saved settings'] };
}
