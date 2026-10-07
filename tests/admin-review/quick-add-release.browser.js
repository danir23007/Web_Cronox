// Read-only production review: never clicks purchase or subscription controls.
async page => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const origin = 'https://cronox.es';
  const results = [], missing = new Set(['all-available', 'mixed', 'out', 'low']);
  const writes = [];
  const observe = request => {
    if (/\/api\/(?:waitlist|admin\/products|cart\/items)/.test(request.url()) && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  };
  page.on('request', observe);
  try {
    for (const [surface, width, height] of [['desktop', 1365, 900], ['mobile', 390, 844], ['narrow', 320, 700]]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + '/?qa-release=' + Date.now() + '#store');
      await page.waitForFunction(() => document.querySelectorAll('#productsGrid .product-card').length > 0);
      await page.waitForFunction(() => !document.getElementById('preloader') || getComputedStyle(document.getElementById('preloader')).opacity === '0');
      const cookies = page.getByRole('button', { name: /^rechazar$/i });
      if (await cookies.isVisible()) await cookies.click();
      const samples = await page.evaluate(() => {
        const picks = {};
        for (const product of window.CRONOX_PRODUCTS) {
          if (!Array.from(document.querySelectorAll('#productsGrid .product-card')).some(card => card.dataset.slug === product.slug)) continue;
          const state = window.CRONOX_STOCK.productStockStatus(product.variants, product.lastUnitsThreshold);
          if (state === 'unknown') continue;
          const kind = state === 'out_of_stock' ? 'out' : window.CRONOX_STOCK.soldOutSizeCount(product.variants) ? 'mixed' : 'all-available';
          picks[kind] ||= { slug: product.slug, state };
          if (state === 'low') picks.low ||= { slug: product.slug, state, kind };
        }
        return picks;
      });
      for (const [sample, product] of Object.entries(samples)) {
        missing.delete(sample);
        const kind = product.kind || sample;
        const card = page.locator('#productsGrid .product-card[data-slug="' + product.slug + '"]');
        const badge = card.locator('.product-last-units');
        if (product.state === 'low' || kind === 'out') {
          const style = await badge.evaluate(el => {
            const css = getComputedStyle(el);
            return { font: css.fontSize, color: css.color, background: css.backgroundColor, border: css.borderWidth, dot: !!el.querySelector('.product-last-units__dot'), parent: el.parentElement.className };
          });
          assert(style.font === '11px' && style.background === 'rgba(0, 0, 0, 0)' && style.border === '0px', surface + ' card styling');
          assert(style.color === (kind === 'out' ? 'rgb(255, 100, 100)' : 'rgb(217, 162, 27)') && style.dot === (kind !== 'out'), surface + ' card color/dot');
        }
        assert(await card.locator('.product-price .stock-status, .price .stock-status').count() === 0, 'Duplicate card warning');
        await card.locator('.fav-add').click();
        await page.waitForFunction(() => document.getElementById('quickAdd').getAttribute('aria-hidden') === 'false');
        const add = page.locator('#qaAdd'), notify = page.locator('#qaNotify'), date = page.locator('#qaDelivery');
        assert(await add.isVisible() === (kind !== 'out'), surface + ' add visibility');
        assert(await notify.isVisible() === (kind !== 'all-available'), surface + ' notify visibility');
        assert(await add.isDisabled() === (kind === 'out') && await notify.isDisabled() === (kind !== 'out'), surface + ' initial actions');
        const warning = page.locator('#qaPrice').locator('..').locator('.stock-status');
        if (await warning.count()) {
          const css = await warning.evaluate(el => ({ font: getComputedStyle(el).fontSize, color: getComputedStyle(el).color, dot: !!el.querySelector('.product-last-units__dot') }));
          assert(css.font === '12px', 'Quick Add font');
          assert(css.color === (kind === 'out' ? 'rgb(255, 100, 100)' : 'rgb(217, 162, 27)'), 'Quick Add color');
          assert(css.dot === (kind !== 'out'), 'Quick Add dot');
        }
        let geometry = null;
        if (kind === 'out') assert(await date.evaluate(el => el.hidden && el.getBoundingClientRect().height === 0), 'Exhausted delivery visible');
        else {
          geometry = await date.evaluate(el => {
            const date = el.getBoundingClientRect(), link = document.getElementById('qaLink').getBoundingClientRect();
            return { difference: Math.abs(date.y + date.height / 2 - link.y - link.height / 2), overlap: date.left < link.right, footer: el.parentElement.className };
          });
          assert(geometry.difference < 1 && !geometry.overlap && geometry.footer === 'qa-footer', surface + ' footer alignment');
        }
        await page.screenshot({ path: 'output/playwright/release-stock-' + surface + '-' + sample + '.png' });
        if (kind === 'mixed') {
          await page.locator('#qaSizes .is-unavailable').first().click();
          assert(await add.isDisabled() && await notify.isEnabled(), 'Exhausted selection actions');
          await page.locator('#qaSizes .qa-size-btn:not(.is-unavailable)').first().click();
          assert(await add.isEnabled() && await notify.isDisabled(), 'Available selection actions');
        }
        results.push({ surface, sample, slug: product.slug, geometry });
        await page.locator('.qa-close').click();
      }
      if (samples.out) {
        await page.goto(origin + '/producto/' + samples.out.slug);
        await page.waitForFunction(() => document.getElementById('pName')?.textContent && document.getElementById('pAdd').disabled);
        assert(await page.locator('[data-product-delivery]').evaluate(el => el.hidden && el.getBoundingClientRect().height === 0), 'PDP exhausted delivery');
      }
    }
    assert(!writes.length, 'Unexpected production write');
    return { results, unavailableOnline: [...missing], writes: writes.length };
  } finally { page.off('request', observe); }
}
