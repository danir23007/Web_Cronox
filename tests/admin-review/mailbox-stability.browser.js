async (page) => {
  const origin = 'http://127.0.0.1:43121';
  if (new URL(page.url()).origin !== origin) throw Error('LOCAL_REVIEW_REQUIRED');
  const assert = (ok, label) => { if (!ok) throw Error(label); };
  const results = [];
  for (const theme of ['light', 'dark']) for (const mobile of [false, true]) {
    const context = await page.context().browser().newContext({ viewport: { width: mobile ? 390 : 1440, height: 900 }, isMobile: mobile, hasTouch: mobile });
    let messages = Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i, mailboxId: 'fixture', subject: 'Correo ' + i, sender: 'local@example.test', recipients: '', date: new Date(Date.UTC(2026, 9, 4, 10, 0, 40 - i)).toISOString(), seen: false, bodyState: 'LOADED', preview: 'Contenido local' }));
    let listRequests = 0, actions = 0, pendingList = null, delayList = false, failList = false;
    let replyDraft = { id: 'local-draft', mode: 'reply', singleReply: true, mailboxId: 'fixture', status: 'DRAFT', revision: 1, to: 'local@example.test', cc: '', bcc: '', subject: 'Respuesta local', text: '', html: '', files: [], sends: [], campaigns: [] };
    const box = () => ({ id: 'fixture', name: 'Soporte', address: 'support@example.test', active: true, canSend: true, status: 'CONNECTED', lastSyncAt: '2026-10-04T10:00:00Z', unread: messages.filter(m => !m.seen).length, folders: [{ id: 'inbox', path: 'INBOX', specialUse: '\\Inbox' }] });
    try {
      await context.addInitScript(() => {
        window.mailIntervals = 0;
        const interval = window.setInterval.bind(window);
        window.setInterval = (fn, ms, ...args) => { if (ms === 30000 && /pulse/.test(String(fn))) { window.mailIntervals++; window.mailPoll = fn; return 999; } return interval(fn, ms, ...args); };
      });
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/admin/mailbox')) return req.method() === 'GET' ? route.continue() : route.abort();
        const path = url.pathname.replace('/api/admin/mailbox', '');
        if (path === '/overview') return route.fulfill({ json: { boxes: [box(), { ...box(), id: 'info', name: 'Información', address: 'info@cronox.es', unread: 0, folders: [] }], superadmin: true, workerEnabled: true, sendEnabled: true, encryptionConfigured: true, storageConfigured: true } });
        if (path === '/notices') return route.fulfill({ json: { cursor: new Date().toISOString(), notices: [] } });
        if (path === '/messages') {
          listRequests++;
          let rows = messages.filter(m => (!url.searchParams.get('search') || m.subject.toLowerCase().includes(url.searchParams.get('search').toLowerCase())) && (url.searchParams.get('state') !== 'read' || m.seen) && (url.searchParams.get('state') !== 'unread' || !m.seen));
          const number = Number(url.searchParams.get('page') || 1);
          const response = { json: { messages: rows.slice((number - 1) * 25, number * 25), pagination: { total: rows.length, pages: Math.max(1, Math.ceil(rows.length / 25)) } } };
          if (delayList) { delayList = false; pendingList = () => route.fulfill(response).catch(() => {}); return; }
          return failList ? route.fulfill({ status: 503, json: { message: 'CONNECTION_FAILED' } }) : route.fulfill(response);
        }
        if (/^\/messages\/[^/]+\/action$/.test(path)) { actions++; const m = messages.find(m => m.id === path.split('/')[2]); m.seen = req.postDataJSON().operation === 'read'; return route.fulfill({ json: {} }); }
        if (path.endsWith('/status')) return route.fulfill({ json: {} });
        if (path.startsWith('/messages/')) { const m = messages.find(m => m.id === path.split('/')[2]); return route.fulfill({ json: { ...m, files: [], envelope: {}, body: { text: 'Lectura estable', html: '' } } }); }
        if (path === '/families') return route.fulfill({ json: [] });
        if (path.endsWith('/campaign-options')) return route.fulfill({ json: { families: [], variants: [] } });
        if (path === '/drafts' && req.method() === 'POST') return route.fulfill({ json: replyDraft });
        if (path === '/drafts/local-draft') { if (req.method() === 'PATCH') replyDraft = { ...replyDraft, ...req.postDataJSON(), revision: replyDraft.revision + 1 }; return route.fulfill({ json: replyDraft }); }
        if (path === '/templates') return route.fulfill({ json: [] });
        return route.fulfill({ status: 503, json: { message: 'LOCAL_FIXTURE_UNEXPECTED_REQUEST' } });
      });
      const target = await context.newPage();
      await target.goto(origin + '/__mailreview/superadmin');
      await target.locator('[data-message=m0]').waitFor();
      await target.evaluate(theme => { document.documentElement.dataset.adminTheme = theme; }, theme);
      await target.waitForFunction(() => typeof window.mailPoll === 'function');
      const cycle = async () => { const before = listRequests; await target.evaluate(() => window.mailPoll()); await target.waitForFunction(() => !document.querySelector('[data-messages]').textContent.includes('Cargando')); await target.waitForTimeout(100); assert(listRequests > before, 'Background metadata still checked'); };
      await target.locator('[data-search]').focus();
      await target.evaluate(() => {
        window.stableNodes = ['[data-messages]', '[data-message=m0]', '[data-box=fixture]', '[data-folder-id=inbox]', '[data-search]'].map(s => document.querySelector(s));
        window.listMutations = 0;
        new MutationObserver(rs => { window.listMutations += rs.length; }).observe(document.querySelector('[data-messages]'), { childList: true, subtree: true, attributes: true, characterData: true });
        window.scrollTo(0, 450); document.querySelector('.mail-list').scrollTop = 300;
        window.originalScroll = scrollY; window.originalListScroll = document.querySelector('.mail-list').scrollTop;
      });
      for (let n = 0; n < 5; n++) await cycle();
      assert(await target.evaluate(() => window.listMutations === 0 && window.stableNodes.every(n => n.isConnected) && document.activeElement === window.stableNodes[4] && scrollY === window.originalScroll && document.querySelector('.mail-list').scrollTop === window.originalListScroll), 'Idle cycles preserve DOM, focus and scroll');
      const add = (id, subject, seen = false) => messages.unshift({ ...messages[0], id, subject, seen, date: '2026-10-04T12:00:00Z' });
      const beforeActions = actions;
      await target.evaluate(() => { const host = document.querySelector('.mail-list'); const top = getComputedStyle(host).overflowY === 'auto' ? Math.max(0, host.getBoundingClientRect().top) : 0; window.arrivalAnchor = [...document.querySelectorAll('[data-message]')].find(n => n.getBoundingClientRect().bottom > top); window.arrivalTop = window.arrivalAnchor.getBoundingClientRect().top; });
      add('new', 'Novedad incluida'); await cycle(); await cycle();
      assert(await target.locator('[data-message=new]').count() === 1 && actions === beforeActions, 'New arrival once and no read mutation');
      assert(await target.evaluate(() => window.stableNodes[1].isConnected && document.activeElement === window.stableNodes[4]), 'Existing row and filter focus retained');
      const anchorDelta = await target.evaluate(() => ({ before: window.arrivalTop, after: window.arrivalAnchor.getBoundingClientRect().top, scroll: scrollY }));
      assert(Math.abs(anchorDelta.after - anchorDelta.before) < 2, 'Arrival preserves visible scroll anchor: ' + JSON.stringify(anchorDelta));
      await target.locator('[data-search]').fill('Novedad'); await target.waitForTimeout(350);
      add('excluded', 'Fuera de búsqueda'); await cycle();
      assert(await target.locator('[data-message=excluded]').count() === 0 && (await target.locator('[data-box=fixture]').innerText()).includes(String(box().unread)), 'Filtered arrival excluded with updated counter');
      await target.locator('select[data-state]').selectOption('read'); add('unread', 'Novedad no leída'); await cycle();
      assert(await target.locator('[data-message=unread]').count() === 0, 'Unread arrival excluded by read filter');
      await target.locator('select[data-state]').selectOption('all'); await target.locator('[data-search]').fill(''); await target.waitForTimeout(350);
      await target.locator('[data-next]').click(); await target.waitForTimeout(100);
      const pager = await target.locator('[data-pagination]').innerText(); add('page-new', 'Correo de página anterior'); await cycle();
      assert((await target.locator('[data-pagination]').innerText()).includes('2 /') && await target.locator('[data-message=page-new]').count() === 0, 'Pagination retained, new message respects current page');
      await target.locator('[data-prev]').click(); await target.waitForTimeout(100);
      await target.locator('[data-message=new]').click(); await target.locator('.mail-reader iframe').waitFor(); await target.waitForTimeout(150);
      await target.evaluate(() => { window.readerNode = document.querySelector('.mail-reader iframe'); });
      add('during-read', 'Durante lectura'); await cycle();
      assert(await target.evaluate(() => window.readerNode === document.querySelector('.mail-reader iframe') && document.querySelector('#mailboxWorkspace').dataset.view === 'read'), 'Reader remains open and unchanged');
      await target.locator('[data-reply=reply]').click(); await target.locator('.mail-editor [name=text]').fill('Texto sin perder durante comprobación');
      await target.evaluate(() => { window.replyNode = document.querySelector('.mail-editor [name=text]'); });
      const beforeReply = listRequests; add('during-reply', 'Durante edición');
      await target.evaluate(() => window.mailPoll()); await target.waitForTimeout(100);
      assert(listRequests === beforeReply && await target.evaluate(() => window.replyNode === document.querySelector('.mail-editor [name=text]') && window.replyNode.value === 'Texto sin perder durante comprobación' && document.activeElement === window.replyNode), 'Individual draft editing preserved');
      await target.locator('.mail-editor [data-close-editor]').click(); await target.waitForTimeout(100);
      // A stale response cannot undo a later explicit search.
      delayList = true; await target.evaluate(() => window.mailPoll()); await target.waitForTimeout(100); assert(pendingList, 'Delayed poll captured');
      await target.locator('[data-search]').fill('Durante lectura'); await target.waitForTimeout(350); await pendingList(); pendingList = null;
      assert(await target.locator('[data-message]').count() === 1 && await target.locator('[data-message=during-read]').count() === 1, 'Late response discarded');
      failList = true; await cycle(); failList = false;
      assert(await target.locator('[data-message=during-read]').count() === 1 && (await target.locator('[data-feedback]').innerText()).includes('proveedor'), 'Polling error visible without destroying list');
      await target.locator('[data-compose]').click(); await target.locator('[name=campaignName]').fill('Edición conservada');
      const beforeEdit = listRequests;
      await target.evaluate(() => { window.campaignNode = document.querySelector('[name=campaignName]'); window.mailPoll(); }); await target.waitForTimeout(150);
      assert(listRequests === beforeEdit && await target.evaluate(() => window.campaignNode === document.querySelector('[name=campaignName]') && window.campaignNode.value === 'Edición conservada' && document.activeElement === window.campaignNode), 'Campaign editing preserved');
      target.on('dialog', dialog => dialog.accept());
      const drawer = async () => { if (mobile && !(await target.locator('body').getAttribute('class')).includes('sidebar-open')) await target.locator('#sidebarToggle').tap(); };
      await drawer();
      if (mobile) await target.locator('[data-nav-target=section-dashboard]').tap(); else await target.locator('[data-nav-target=section-dashboard]').click();
      await target.waitForTimeout(100); const outside = listRequests; await target.evaluate(() => window.mailPoll()); await target.waitForTimeout(100); assert(listRequests === outside, 'No hidden list rendering');
      await drawer();
      const clientGroup = target.locator('.sidebar-group[aria-controls=navCliente]');
      if (await clientGroup.getAttribute('aria-expanded') !== 'true') await clientGroup.click();
      await target.locator('[data-nav-target=section-inbox]').click(); await target.waitForTimeout(200);
      assert(listRequests > outside && await target.evaluate(() => window.mailIntervals === 1), 'Reentry loads current data without duplicate intervals');
      await drawer();
      const group = id => target.locator('.sidebar-group[aria-controls=' + id + ']');
      const openIds = () => target.evaluate(() => [...document.querySelectorAll('.sidebar-group')].filter(b => b.getAttribute('aria-expanded') === 'true').map(b => b.getAttribute('aria-controls')));
      // Explicitly pin Product, independently of the selected route.
      await group('navProducto').click();
      await group('navProducto').focus(); await target.keyboard.press('Space');
      assert((await openIds()).length === 0, 'Main group closes with keyboard');
      await target.keyboard.press('Enter'); assert(JSON.stringify(await openIds()) === '["navProducto"]', 'Main group opens with keyboard');
      if (!mobile) {
        const positions = await target.locator('.sidebar-group').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().top));
        for (const steps of [12, 1]) for (const id of ['navMultimedia', 'navAdmin', 'navCliente', 'navMultimedia']) {
          const rect = await group(id).boundingBox(); await target.mouse.move(rect.x + 30, rect.y + rect.height / 2, { steps });
          assert(JSON.stringify(await openIds()) === JSON.stringify([id]), 'Exactly one temporary principal group');
          assert(await target.locator('.sidebar-group').evaluateAll((ns, previous) => ns.every((n, i) => n.getBoundingClientRect().top === previous[i]), positions), 'Header geometry unchanged');
        }
        await target.mouse.move(700, 100); assert(JSON.stringify(await openIds()) === '["navProducto"]', 'Pinned group restored');
        await group('navMultimedia').hover(); await group('navMultimedia').click(); await target.mouse.move(700, 100); assert(JSON.stringify(await openIds()) === '["navMultimedia"]', 'Temporary click becomes pinned');
        await group('navMultimedia').click(); await target.waitForTimeout(100); assert((await openIds()).length === 0, 'Unpin stays closed under pointer');
        await target.mouse.move(700, 100); await group('navAdmin').hover(); await target.mouse.move(700, 100); assert((await openIds()).length === 0, 'Without pinned group leave closes all');
        await group('navMultimedia').hover();
      } else await group('navMultimedia').tap();
      await target.locator('.sidebar-subgroup').focus(); await target.keyboard.press('Enter');
      assert(await target.locator('#navGaleria').isVisible() && await target.locator('#navMultimedia').isVisible(), 'Nested Gallery keyboard disclosure');
      if (!mobile) await target.locator('[data-nav-target=section-gallery-carousel]').hover();
      await target.locator('[data-nav-target=section-gallery-carousel]').click(); await target.waitForTimeout(100);
      assert(await target.locator('#section-gallery').isVisible() && target.url().includes('carousel'), 'Gallery descendant navigates');
      await drawer();
      await target.locator('[data-nav-target=section-gallery-mosaic]').click(); await target.waitForTimeout(100);
      assert(await target.locator('#section-gallery').isVisible() && !target.url().includes('carousel'), 'Mosaic descendant navigates');
      await drawer();
      if (mobile) { await target.locator('.sidebar-subgroup').tap(); assert(!(await target.locator('#navGaleria').isVisible()), 'Gallery touch closes'); await target.locator('.sidebar-subgroup').tap(); }
      await target.screenshot({ path: `output/playwright/stability-${mobile ? 'mobile' : 'desktop'}-${theme}.png`, fullPage: true });
      assert(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      results.push({ theme, mode: mobile ? 'mobile' : 'desktop', idleCycles: 5, listRequests, actions, pager });
    } finally { await context.close(); }
  }
  return results;
}
