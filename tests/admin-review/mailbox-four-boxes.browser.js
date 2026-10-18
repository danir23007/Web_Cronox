async (page) => {
  const origin = 'http://127.0.0.1:43121';
  if (new URL(page.url()).origin !== origin) throw Error('ISOLATED_REVIEW_REQUIRED');
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  await page.goto(origin + '/__mailreview/superadmin');
  const boxes = await page.evaluate(async () => (await fetch('/api/admin/mailbox/overview').then(r => r.json())).boxes
    .filter(box => /^reading-(info|no-reply|orders|support)@example\.test$/.test(box.address)));
  assert(boxes.length === 4, 'Four isolated receiving mailboxes exist');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + '/__mailreview/superadmin');
    await page.locator('[data-message]').first().waitFor();
    for (const box of boxes) {
      await page.locator(`[data-box="${box.id}"]`).click();
      await page.waitForFunction(name => {
        const rows = [...document.querySelectorAll('[data-message]')];
        return rows.length === 2 && rows.every(row => row.textContent.includes(name));
      }, box.name);
      const ids = await page.locator('[data-message]').evaluateAll(nodes => nodes.map(node => node.dataset.message));
      assert(ids.length === 2, 'Old and new received messages are both listed');
      for (const id of ids) {
        await page.locator(`[data-message="${id}"]`).click();
        const frame = page.frameLocator('.mail-reader iframe');
        await frame.locator('body').filter({ hasText: 'Café, conexión, ñ y €' }).waitFor();
        const title = await page.locator('.mail-reader h3').innerText();
        assert(title.startsWith('Antiguo:') || title.startsWith('Nuevo:'), 'Fixture subject appears');
        assert(await page.locator('.mail-reader iframe').getAttribute('sandbox') === 'allow-popups allow-popups-to-escape-sandbox', 'MIME stays isolated without script execution');
        assert(await frame.locator('script').count() === 0, 'Unsafe HTML was removed');
        assert(await page.evaluate(() => !window.fixtureEscaped), 'Email cannot access its parent');
        const attachment = page.locator('.mail-reader [data-file]');
        assert(await attachment.count() === 1, 'One attachment remains after cached repeat');
        const fileId = await attachment.getAttribute('data-file');
        const file = await page.evaluate(async id => {
          const response = await fetch('/api/admin/mailbox/files/' + id);
          return { status: response.status, text: await response.text() };
        }, fileId);
        assert(file.status === 200 && file.text === '%PDF-four-boxes-synthetic', 'Actual backend decrypts the fixture attachment');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Reading does not overflow horizontally');
        results.push({ width, mailbox: box.address, age: title.startsWith('Antiguo:') ? 'old' : 'new', rendered: true, charset: true, attachment: true });
        await page.locator('.mail-reader [data-back]').click();
      }
    }
    await page.screenshot({ path: `output/playwright/mail-local/four-mailboxes-${width}.png`, fullPage: true });
  }
  await page.goto(origin + '/__mailreview/unassigned');
  const forbidden = await page.evaluate(async id => (await fetch('/api/admin/mailbox/messages?mailboxId=' + id)).status, boxes[0].id);
  assert(forbidden === 403, 'An unassigned administrator cannot read another mailbox');
  await page.goto(origin + '/__mailreview/superadmin');
  return { results, unassignedMailboxStatus: forbidden, routeMocks: false, provider: 'isolated simulated IMAP', realExternalMailOrPushSent: false };
}
