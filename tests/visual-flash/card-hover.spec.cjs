const { test, expect } = require('@playwright/test');

async function setup(page) {
  await page.route('**/hover-*.svg', async route => {
    const second = route.request().url().includes('second');
    if (second) await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${second ? 300 : 600}" height="${second ? 700 : 400}"><rect width="100%" height="100%" fill="${second ? '#987654' : '#567890'}"/></svg>` });
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const products = [1, 2, 3].map(id => ({ id, slug: `hover-${id}`, name: `Hover ${id}`, price: 3500,
      images: [{ url: '/hover-first.svg' }, ...(id === 1 ? [] : [{ url: '/hover-second.svg' }, { url: '/hover-third.svg' }])],
      variants: [{ id: id * 100, size: 'M', stock: 5, isActive: true }] }));
    return route.fulfill({ json: path === '/api/products' ? { items: products, meta: { total: 3 } } : path === '/api/cart' ? { items: [], itemsCount: 0, subtotal: 0 } : [] });
  });
  await page.goto('/tienda#store');
  await expect(page.locator('.product-card')).toHaveCount(3);
  await page.locator('.product-card').first().scrollIntoViewIfNeeded();
}

// Freeze a real mouse-triggered CSS transition at sub-frame offsets. Unlike a
// settled screenshot, this exercises fractional transforms deterministically.
async function inspectBoundary(page, card, time, testInfo, label) {
  await card.evaluate((element, time) => {
    for (const animation of element.getAnimations()) {
      animation.pause(); animation.currentTime = time;
    }
  }, time);
  const box = await card.boundingBox();
  const shot = await page.screenshot({ path: time === 16 ? testInfo.outputPath(`${label}-16ms.png`) : undefined });
  const result = await page.evaluate(async ({ data, box }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const scale = image.width / innerWidth;
    let max = 0;
    for (let y = Math.ceil((box.y + box.height - 6) * scale); y < Math.floor((box.y + box.height) * scale); y++) {
      for (let x = Math.ceil((box.x + 8) * scale); x < Math.floor((box.x + box.width - 8) * scale); x++) {
        const p = ctx.getImageData(x, y, 1, 1).data; max = Math.max(max, p[0], p[1], p[2]);
      }
    }
    return max;
  }, { data: shot.toString('base64'), box });
  if (result > 8 || time === 8) await testInfo.attach(`${label}-${time}ms`, { body: shot, contentType: 'image/png' });
  expect.soft(result, `${label} footer boundary at ${time}ms`).toBeLessThanOrEqual(8);
}

for (const width of [1366, 1537]) {
  test(`card footer stays black throughout first and repeated hover at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    for (const index of [0, 1, 2]) {
      const card = page.locator('.product-card').nth(index);
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.mouse.move(0, 0);
        await card.evaluate(el => el.getAnimations().forEach(a => a.finish()));
        const box = await card.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 30);
        if (index === 1 && cycle === 0) {
          // The first image must remain visible while the requested second loads.
          await expect(card.locator('.product-img').first()).toHaveClass(/active/);
        }
        for (const time of [1, 8, 16, 32, 80, 179]) await inspectBoundary(page, card, time, testInfo, `card-${index}-cycle-${cycle}`);
        await card.evaluate(el => el.getAnimations().forEach(a => a.finish()));
        await expect(card.locator('.product-images')).toHaveAttribute('data-active-index', index === 0 ? '0' : '1');
        if (index > 0) {
          await card.locator('.product-arrow.next').click();
          await expect(card.locator('.product-images')).toHaveAttribute('data-active-index', '2');
        }
        await page.mouse.move(0, 0);
        await expect(card.locator('.product-images')).toHaveAttribute('data-active-index', '0');
      }
    }
  });
}

test('mobile touch swipe keeps independent galleries and white image backing', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies real touch input');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  const card = page.locator('.product-card').nth(1);
  const before = await card.boundingBox();
  const media = card.locator('.product-media');
  expect(await media.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  expect(await card.locator('.product-card__info').evaluate(el => el.getBoundingClientRect().height)).toBe(88);
  const box = await media.boundingBox();
  expect(Math.abs(box.width / box.height - .75)).toBeLessThan(.01);
  const cdp = await context.newCDPSession(page);
  const x = box.x + box.width * .8, y = box.y + box.height * .4;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 70, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(card.locator('.product-images')).toHaveAttribute('data-active-index', '1');
  await expect(card.locator('.product-img').nth(1)).toHaveClass(/active/);
  await expect(card.locator('.product-gallery-dots')).toBeVisible();
  await expect(page.locator('.product-card').first().locator('.product-images')).toHaveAttribute('data-active-index', '0');
  expect((await card.boundingBox()).height).toBe(before.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('reduced motion retains the existing non-animated image switch', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  const card = page.locator('.product-card').nth(1);
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await expect(card.locator('.product-img').nth(1)).toHaveClass(/active/);
  expect(await card.locator('.product-img').nth(1).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
});
