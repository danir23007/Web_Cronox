async (page) => {
  const browser = page.context().browser(), results = [], errors = [];
  const check = (ok, label) => { if (!ok) throw Error(label); };
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width:390,height:844 } : { width:1440,height:1100 }, isMobile:mobile, hasTouch:mobile });
    try {
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
      await p.route('**/*', r => ['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname) && r.request().method() === 'GET' ? r.continue() : r.abort());
      await p.goto('http://127.0.0.1:43127/admin.html#section-map');
      await p.locator('.map-regions-table tbody tr').first().waitFor();
      const theme = p.getByRole('switch', { name:'Modo oscuro' });
      if (await theme.getAttribute('aria-checked') !== 'true') await theme.click();
      const ids = () => p.locator('.map-regions-table tbody [data-select]').evaluateAll(nodes => nodes.map(n => n.dataset.select));
      const click = async locator => mobile ? locator.tap() : locator.click();
      for (const division of ['communities','provinces']) {
        await p.locator('[name="division"]').selectOption(division);
        await p.waitForFunction(n => document.querySelectorAll('.map-regions-table tbody tr').length === n, division === 'provinces' ? 52 : 19);
        if (division === 'provinces') {
          check(await p.locator('[data-column="orders"]').getAttribute('aria-sort') === 'descending', 'Division lost sorting');
          await click(p.locator('[data-sort="name"]'));
        } else check(await p.locator('[data-column="name"]').getAttribute('aria-sort') === 'ascending', 'Initial alphabetical order');
        const report = await p.evaluate(async () => (await fetch('/api/admin/map?' + new URLSearchParams({ from:document.querySelector('[name="from"]').value,to:document.querySelector('[name="to"]').value,division:document.querySelector('[name="division"]').value }))).json());
        const rows = division === 'provinces' ? report.provinces : report.regions;
        for (const key of ['orders','units','revenueCents','name']) {
          for (const direction of key === 'name' ? [1,-1] : [-1,1]) {
            const button = p.locator('[data-sort="' + key + '"]');
            if (!mobile) { await button.focus(); await p.keyboard.press(direction === -1 ? 'Enter' : 'Space'); }
            else await click(button);
            const expected = [...rows].sort((a,b) => direction * (key === 'name' ? a.name.localeCompare(b.name,'es') : a[key]-b[key]) || a.name.localeCompare(b.name,'es') || a.id.localeCompare(b.id)).map(r => r.id);
            check(JSON.stringify(await ids()) === JSON.stringify(expected), division+' '+key+' '+direction);
            check(await p.locator('[data-column="'+key+'"]').getAttribute('aria-sort') === (direction === 1 ? 'ascending' : 'descending'), 'aria-sort');
          }
        }
        await click(p.locator('[data-sort="orders"]'));
        const sorted = await ids();
        await p.locator('[name="metric"]').selectOption('revenueCents');
        check(JSON.stringify(await ids()) === JSON.stringify(sorted), 'Metric changed sorting');
        await p.getByRole('button',{name:'Aplicar fechas',exact:true}).click();
        await p.locator('.map-results').waitFor({state:'visible'});
        check(JSON.stringify(await ids()) === JSON.stringify(sorted), 'Refresh lost sorting');
        const id = sorted[0], name = rows.find(r => r.id === id).name;
        await click(p.locator('.map-regions-table [data-select="'+id+'"]'));
        await p.waitForFunction(name => document.querySelector('.map-detail h2')?.textContent === name, name);
        check(await p.locator('[data-column="orders"]').getAttribute('aria-sort') === 'descending', 'Selection lost sorting');
        check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Document overflow');
        await p.locator('.map-regions-table thead').evaluate(head => head.scrollIntoView({block:'start'}));
        // The mobile table scrolls horizontally within its own container; all headers are touch targets.
        await p.locator('.map-regions-table').evaluate(t => t.parentElement.scrollLeft = 0);
        await p.screenshot({path:'output/playwright/admin-map-sorting/'+(mobile?'mobile':'desktop')+'-'+division+'.png'});
        results.push({mobile,division,rows:rows.length,sorting:'four columns, both directions, keyboard/touch, refresh, metric, selection'});
      }
    } finally { await context.close(); }
  }
  check(errors.length === 0, errors.join(';'));
  return {scope:'Actual local admin and local in-memory financial service; no production',results,errors};
}
