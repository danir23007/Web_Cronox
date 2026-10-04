async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const origin = 'http://127.0.0.1:43121';
  const browser = page.context().browser();
  const checks = [];
  for (const theme of ['light', 'dark']) for (const mode of ['desktop', 'mobile']) {
    const context = await browser.newContext({ viewport: { width: mode === 'desktop' ? 1440 : 390, height: 900 }, hasTouch: mode === 'mobile', isMobile: mode === 'mobile' });
    try {
      const target = await context.newPage();
      await target.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        // Only the selected synthetic draft can be changed in this browser review.
        if (route.request().method() !== 'GET' && !url.pathname.match(/\/drafts\/[^/]+$/) && !url.pathname.endsWith('/csrf')) return route.abort();
        return route.continue();
      });
      await target.goto(origin + '/__mailreview/superadmin');
      await target.waitForSelector('[data-drafts]');
      await target.evaluate(t => document.documentElement.dataset.adminTheme = t, theme);
      await target.locator('[data-drafts]').click();
      const row = target.locator('.mail-draft-row').filter({ hasText: 'Browser delete ' + theme + ' ' + mode });
      await row.waitFor();
      const trash = row.locator('[data-delete-draft]');
      const activate = async locator => mode === 'mobile' ? locator.tap() : locator.click();
      await trash.focus(); await trash.press('Enter');
      const dialog = target.locator('dialog.mail-campaign-confirm');
      assert(await dialog.isVisible(), 'Keyboard opens deletion confirmation');
      assert(await dialog.locator('[data-cancel]').evaluate(e => e === document.activeElement), 'Cancel receives focus');
      await target.screenshot({ path: `output/playwright/mailbox-delete-${theme}-${mode}.png` });
      await activate(dialog.locator('[data-cancel]')); assert(await row.isVisible(), 'Cancel preserves draft');
      // Server/API failure must preserve the current list and enabled action.
      await target.route('**/api/admin/mailbox/drafts/*', async route => {
        if (route.request().method() === 'DELETE') return route.fulfill({ status: 409, json: { message: 'MAILBOX_DRAFT_CHANGED_OR_QUEUED' } });
        return route.fallback();
      });
      await activate(trash); await activate(dialog.locator('[data-confirm]'));
      await target.waitForFunction(() => document.querySelector('[data-feedback]').textContent.trim().length > 0);
      assert(await row.isVisible(), 'Failed delete retains list'); assert(await trash.isEnabled(), 'Failed delete re-enables action');
      await target.unroute('**/api/admin/mailbox/drafts/*');
      await activate(trash); await activate(dialog.locator('[data-confirm]'));
      await row.waitFor({ state: 'detached' });
      await target.locator('[data-campaign-list="history"]').click();
      await target.locator('[data-history-campaign]').filter({ hasText: 'Immutable historical fixture' }).click();
      await target.waitForSelector('[data-effectiveness]');
      assert((await target.locator('[data-effectiveness]').innerText()).includes('50 %'), 'History reports 50 percent');
      assert((await target.locator('[data-effectiveness]').innerText()).includes('50 de 100'), 'Accepted denominator and unique numerator');
      assert((await target.locator('.mail-editor').innerText()).includes('1 rebotes confirmados'), 'Confirmed bounce separate');
      await target.locator('.mail-editor details summary').first().click();
      assert(await target.locator('[data-history-version]').count() === 1, 'One shared version');
      assert(await target.locator('.mail-history-recipient').count() === 103, 'Individual accepted/failed/uncertain/excluded outcomes');
      assert(await target.locator('[data-history-version]').getAttribute('sandbox') === '', 'History does not activate campaign links');
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'History has no horizontal overflow');
      await target.screenshot({ path: `output/playwright/mailbox-history-${theme}-${mode}.png` });
      checks.push({ theme, mode, deletion: 'PASS', history: 'PASS' });
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ checks, result: 'PASS', provider: 'isolated fixtures only' }));
}
