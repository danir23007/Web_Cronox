async (page) => {
  const origin = 'http://localhost:3000';
  if (new URL(page.url()).origin !== origin) throw new Error('Local review only');
  const settings = await page.evaluate(async () => (await fetch('/api/admin/black-friday', { cache: 'no-store' })).json());
  const context = await page.context().browser().newContext();
  const visitor = await context.newPage();
  await visitor.route(`${origin}/api/black-friday`, route => route.fulfill({ json: { ...settings, enabled: true, serverTime: new Date(Date.parse(settings.startsAt) - 90061000).toISOString() } }));
  const results = [];
  try {
    for (const width of [1440, 1920, 390, 320]) {
      await visitor.setViewportSize({ width, height: 900 });
      await visitor.goto(`${origin}/`);
      await visitor.locator('.bf-hero').waitFor({ state: 'visible' });
      const reject = visitor.getByRole('button', { name: 'RECHAZAR', exact: true });
      if (await reject.isVisible()) await reject.click();
      await visitor.evaluate(() => document.fonts.ready);
      await visitor.evaluate(() => scrollTo(0, 240));
      await visitor.locator('.bf-banner').waitFor({ state: 'visible' });
      await visitor.waitForFunction(() => Math.abs(document.querySelector('.topbar').getBoundingClientRect().top - document.querySelector('.bf-banner').getBoundingClientRect().height) < 0.5);
      const geometry = await visitor.locator('.bf-banner').evaluate(banner => {
        const message = banner.querySelector('.bf-message'), track = banner.querySelector('.bf-track'), clock = banner.querySelector('.bf-clock');
        const m = message.getBoundingClientRect(), b = banner.getBoundingClientRect(), c = clock.getBoundingClientRect();
        const runs = [...track.children].map(el => el.getBoundingClientRect().width);
        const animated = track.getAnimations()[0];
        if (!animated) throw new Error('Marquee has no animation');
        animated.pause();
        const duration = animated.effect.getComputedTiming().duration;
        const position = time => {
          animated.currentTime = time;
          return Math.min(...[...track.querySelectorAll('.bf-run > span')].map(el => el.getBoundingClientRect().left).filter(left => left >= m.left - 1));
        };
        const before = position(duration - 0.1), after = position(duration + 0.1);
        animated.currentTime = duration / 4;
        return {
          visibleRatio: m.width / b.width, left: m.left - b.left, gap: c.left - m.right,
          runs, visibleWidth: m.width, loopDelta: Math.abs(after - before),
          accessibleCopies: track.querySelectorAll('.bf-text').length,
          hiddenCopies: [...track.querySelectorAll('.bf-copy')].every(el => Boolean(el.closest('[aria-hidden="true"]'))),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          clockFont: getComputedStyle(clock.querySelector('b')).fontSize,
        };
      });
      if (geometry.left !== 0 || geometry.gap < 10 || geometry.runs.length !== 2 || geometry.runs.some(run => run + 1 < geometry.visibleWidth) || Math.abs(geometry.runs[0] - geometry.runs[1]) > 0.5) throw new Error(`Marquee geometry ${width}: ${JSON.stringify(geometry)}`);
      if (width >= 1440 && geometry.visibleRatio < 0.78) throw new Error('Desktop marquee does not fill the available strip');
      if (geometry.loopDelta > 1 || geometry.accessibleCopies !== 1 || !geometry.hiddenCopies || geometry.overflow > 1) throw new Error('Marquee loop/accessibility/overflow regression');
      if (geometry.clockFont !== (width <= 600 ? '16px' : '18px')) throw new Error('Compact counter size changed');
      await visitor.screenshot({ path: `output/black-friday/marquee-expanded-${width}.png` });
      results.push({ width, ...geometry });
    }
    await visitor.emulateMedia({ reducedMotion: 'reduce' });
    if (await visitor.locator('.bf-banner .bf-track').evaluate(el => getComputedStyle(el).animationName) !== 'none') throw new Error('Reduced motion still animates');
    return { passed: 'full-width available strip, identical repeated runs, seamless loop, fixed counter size, accessible copies and reduced motion', geometry: results };
  } finally { await context.close(); }
}
