async (page) => {
  const origin = 'http://127.0.0.1:43121';
  if (new URL(page.url()).origin !== origin) throw Error('LOCAL_REVIEW_REQUIRED');
  const assert = (ok, label) => { if (!ok) throw Error(label); };
  const results = [];
  for (const theme of ['light', 'dark']) for (const mobile of [false, true]) {
    const context = await page.context().browser().newContext({ viewport: { width: mobile ? 390 : 1440, height: 900 }, hasTouch: mobile, isMobile: mobile });
    try {
      await context.route('**/*', route => {
        const request = route.request();
        if (new URL(request.url()).origin !== origin || request.method() !== 'GET') return route.abort();
        return route.continue();
      });
      const target = await context.newPage();
      await target.goto(origin + '/__mailreview/superadmin');
      await target.locator('[data-drafts]').waitFor();
      await target.evaluate(theme => { document.documentElement.dataset.adminTheme = theme; }, theme);
      const group = id => target.locator('.sidebar-group[aria-controls=' + id + ']');
      const visible = () => target.evaluate(() => [...document.querySelectorAll('.sidebar-group-zone > .sidebar-children')].filter(p => !p.hidden).map(p => p.id));
      const expectGroup = async id => assert(JSON.stringify(await visible()) === JSON.stringify(id ? [id] : []), 'Visible group: ' + id);
      const checkBounds = async () => assert(await target.evaluate(() => {
        const sidebar = document.querySelector('#adminSidebar').getBoundingClientRect();
        return [...document.querySelectorAll('.sidebar-children')].filter(p => !p.hidden && p.getClientRects().length).every(p => {
          const rect = p.getBoundingClientRect(); const button = document.querySelector('[aria-controls=' + p.id + ']');
          return rect.left >= sidebar.left && rect.right <= sidebar.right && rect.top >= button.getBoundingClientRect().bottom - 1 && getComputedStyle(p).position === 'static';
        });
      }), 'All panels inline within sidebar');
      if (mobile) await target.locator('#sidebarToggle').tap();
      await group('navMails').click();
      if (!mobile) await target.mouse.move(600, 100);
      await expectGroup(null);
      const previous = await group('navMultimedia').boundingBox();
      await group('navProducto').click(); await expectGroup('navProducto'); await checkBounds();
      const shifted = await group('navMultimedia').boundingBox();
      assert(shifted.y > previous.y + 100, 'Opening Product shifts following headers vertically');
      await target.evaluate(() => {
        window.sidebarChanges = 0; window.sidebarMaxVisible = 0;
        new MutationObserver(records => {
          window.sidebarChanges += records.filter(r => r.attributeName === 'aria-expanded').length;
          const count = [...document.querySelectorAll('.sidebar-group-zone > .sidebar-children')].filter(p => !p.hidden).length;
          window.sidebarMaxVisible = Math.max(window.sidebarMaxVisible, count);
        }).observe(document.querySelector('#adminSidebar'), { subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });
      });
      if (!mobile) {
        const enter = async (id, steps) => {
          await target.mouse.move(600, 110); // Exit really restores the pinned layout.
          const rect = await group(id).boundingBox();
          await target.mouse.move(600, rect.y + rect.height / 2);
          await target.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps });
          await expectGroup(id); await checkBounds();
          const changes = await target.evaluate(() => window.sidebarChanges);
          await target.waitForTimeout(120);
          await expectGroup(id);
          assert(await target.evaluate(before => window.sidebarChanges === before, changes), 'Stationary pointer has no layout cascade');
        };
        for (const steps of [24, 1]) for (const id of ['navMultimedia', 'navCliente', 'navAdmin', 'navMultimedia']) await enter(id, steps);
        // Traverse headers inside the column too, without resetting hover outside it.
        let rect = await group('navMultimedia').boundingBox();
        await target.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps: 24 });
        for (const steps of [24, 1]) for (const id of ['navCliente', 'navAdmin', 'navMultimedia']) {
          rect = await group(id).boundingBox();
          await target.mouse.move(rect.x + 40, rect.y + rect.height / 2, { steps });
          await expectGroup(id); await checkBounds();
          const changes = await target.evaluate(() => window.sidebarChanges); await target.waitForTimeout(120);
          assert(await target.evaluate(before => window.sidebarChanges === before, changes), 'Direct traversal settles without oscillation');
        }
        // Reach a displaced panel with continuous real movement, without leaving the column.
        const gallery = await target.locator('.sidebar-subgroup').boundingBox();
        await target.mouse.move(gallery.x + 50, gallery.y + gallery.height / 2, { steps: 24 });
        await expectGroup('navMultimedia'); await target.locator('.sidebar-subgroup').click();
        const link = await target.locator('[data-nav-target=section-gallery-carousel]').boundingBox();
        await target.mouse.move(link.x + 45, link.y + link.height / 2, { steps: 24 }); await expectGroup('navMultimedia');
        await target.locator('[data-nav-target=section-gallery-carousel]').click();
        assert(target.url().includes('carousel'), 'Carousel navigates through inline nested links');
        // Navigating pins Multimedia. Temporaries still restore it on leaving.
        await enter('navAdmin', 24); await target.mouse.move(600, 110); await expectGroup('navMultimedia');
        await enter('navCliente', 1); await group('navCliente').click(); await target.mouse.move(600, 110); await expectGroup('navCliente');
        await group('navCliente').click(); await expectGroup(null);
        const changes = await target.evaluate(() => window.sidebarChanges); await target.waitForTimeout(120);
        assert(await target.evaluate(before => window.sidebarChanges === before, changes), 'Unpin does not immediately reopen');
        await enter('navAdmin', 24); await target.mouse.move(600, 110); await expectGroup(null);
      } else {
        await group('navMultimedia').tap(); await expectGroup('navMultimedia');
        await target.locator('.sidebar-subgroup').tap(); await checkBounds();
        await target.locator('[data-nav-target=section-gallery-carousel]').tap();
        assert(target.url().includes('carousel'), 'Touch descendant navigates');
        await target.locator('#sidebarToggle').tap();
      }
      // Keyboard works with the real vertical geometry and native disclosure buttons.
      await group('navAdmin').focus(); await target.keyboard.press('Enter'); await expectGroup('navAdmin');
      await target.keyboard.press('Space'); await expectGroup(null);
      await group('navMultimedia').focus(); await target.keyboard.press('Enter'); await expectGroup('navMultimedia');
      const nested = target.locator('.sidebar-subgroup');
      if (await nested.getAttribute('aria-expanded') === 'true') { await nested.focus(); await target.keyboard.press('Enter'); }
      await nested.focus(); await target.keyboard.press('Enter');
      await target.locator('[data-nav-target=section-gallery-mosaic]').focus(); await target.keyboard.press('Escape');
      assert(await nested.getAttribute('aria-expanded') === 'false', 'Nested Escape closes only Gallery'); await expectGroup('navMultimedia');
      await nested.focus(); await target.keyboard.press('Enter');
      await target.locator('[data-nav-target=section-gallery-mosaic]').focus(); await target.keyboard.press('Enter');
      assert(!target.url().includes('carousel') && await target.locator('#section-gallery').isVisible(), 'Mosaic keyboard navigation');
      if (mobile) await target.locator('#sidebarToggle').tap();
      await checkBounds();
      assert(await target.evaluate(() => [...document.querySelectorAll('.sidebar-group,.sidebar-subgroup')].every(b => b.getAttribute('aria-expanded') === String(!document.getElementById(b.getAttribute('aria-controls')).hidden))), 'ARIA matches each disclosure');
      assert(await target.evaluate(() => window.sidebarMaxVisible <= 1), 'No principal panel overlap');
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#adminSidebar').scrollWidth <= document.querySelector('#adminSidebar').clientWidth), 'No document or sidebar horizontal overflow');
      await target.setViewportSize({ width: mobile ? 390 : 1440, height: 480 });
      const last = target.locator('#logoutBtn'); await last.scrollIntoViewIfNeeded();
      assert(await last.isVisible() && await target.evaluate(() => document.querySelector('#adminSidebar').scrollTop > 0), 'Sidebar scroll remains usable on short viewport');
      await target.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
      await target.locator('#adminSidebar').evaluate(n => { n.scrollTop = 0; });
      await target.screenshot({ path: `output/playwright/sidebar-inline-${theme}-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
      results.push({ theme, mobile, inline: true, realPointer: !mobile, noOscillation: true });
    } finally { await context.close(); }
  }
  return results;
}
