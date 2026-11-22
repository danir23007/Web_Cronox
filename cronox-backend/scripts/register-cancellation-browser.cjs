'use strict';
// Runs against the synthetic application/database owned by the confirmation test.
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
module.exports = async function cancellationChecks(page, customer, out) {
  const root = page.locator('#section-register');
  const act = (name) => root.locator('[data-act="' + name + '"]');
  const modal = root.locator('[data-cancel-dialog]');
  const initial = async () => {
    await expect(act('purchase')).toBeVisible();
    await expect(act('reset')).toBeHidden();
    assert.equal(await root.locator('#register-work h3').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  };
  await initial();
  const originalCamera = await page.evaluate(() => {
    window.__originalRegisterCamera = window.CRONOX_REGISTER_CAMERA;
    window.__cameraActive = false;
    window.CRONOX_REGISTER_CAMERA = {
      start() { window.__cameraActive = true; },
      stop() { window.__cameraActive = false; },
    };
    return true;
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 980 });
    for (const [action, label] of [['purchase','compra'],['refund','devolución'],['exchange','cambio']]) {
      await act(action).click();
      await expect(act('reset')).toHaveText('Cancelar ' + label);
      const before = await root.locator('#register-work').innerHTML();
      for (const close of ['keep', 'Escape', 'close']) {
        await act('reset').click();
        await expect(modal).toBeVisible();
        await expect(modal.locator('h3')).toHaveText('¿Cancelar ' + label + '?');
        if (close === 'Escape') await page.keyboard.press('Escape');
        else if (close === 'keep') await modal.getByRole('button', {name:'Seguir',exact:true}).click();
        else await modal.getByRole('button', {name:'Cerrar',exact:true}).click();
        await expect(modal).not.toBeVisible();
        await expect(act('reset')).toBeFocused();
        assert.equal(await root.locator('#register-work').innerHTML(), before);
      }
      await act('reset').click();
      if (width === 390 && action === 'exchange') await modal.screenshot({path:require('node:path').join(out, 'cancel-mobile.png')});
      await modal.locator('[data-cancel-confirm]').click();
      await initial();
      assert.equal(await page.evaluate(() => window.__cameraActive), false);
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => ({tag:document.activeElement.tagName, outline:getComputedStyle(document.activeElement).outlineStyle}));
      assert.equal(focus.tag, 'BUTTON');
      assert.equal(focus.outline, 'solid');
    }
  }
  // A late identification response must not reopen history after cancellation.
  for (const action of ['purchase','refund','exchange']) {
    await act(action).click();
    if (action === 'purchase') {
      await act('no-event').click();
      await act('credential').click();
    }
    let release, entered;
    const gate = new Promise(resolve => release = resolve);
    const started = new Promise(resolve => entered = resolve);
    await page.route('**/api/admin/register/customer', async route => {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({response}).catch(() => {});
    });
    await root.locator('[name=code]').fill(customer.email);
    await root.locator('[name=code]').press('Enter');
    await started;
    await act('reset').click();
    await modal.locator('[data-cancel-confirm]').click();
    release();
    await page.unroute('**/api/admin/register/customer');
    await initial();
    await page.waitForTimeout(100);
    await initial();
  }
  await page.evaluate(() => { window.CRONOX_REGISTER_CAMERA = window.__originalRegisterCamera; });
  assert.ok(originalCamera);
  await page.setViewportSize({width:1440,height:980});
};
