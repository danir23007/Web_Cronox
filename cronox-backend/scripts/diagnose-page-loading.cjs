// Read-only Chromium/CDP lifecycle audit. No backend or database is started.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const express = require('express');
const root = path.resolve(__dirname, '../../cronox-front');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const mode = process.argv[2] || 'local';
const waitMs = Number(process.env.AUDIT_WAIT_MS || 15000);
const safeUrl = value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return value; } };
async function main() {
  const app = express();
  if (process.env.AUDIT_STALL_GIF === '1') app.get('/assets/CRONOX-preloader.webp', (_req, res) => {
    const animation = fs.readFileSync(path.join(root, 'assets/CRONOX-preloader.webp'));
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': animation.length });
    res.write(animation.subarray(0, 65536)); // Intentionally unfinished, local-only regression fixture.
  });
  app.use('/api', (req, res) => {
    if (req.path === '/auth/me') return res.status(401).json({ message: 'Anonymous fixture' });
    if (req.path === '/media-framing') return res.json({ version: 5, placements: {} });
    if (req.path === '/cart') return res.json({ items: [], totals: {} });
    if (req.path === '/products') return res.json({ items: [], meta: { total: 0, totalPages: 1 } });
    return res.json({ items: [], assets: [], placements: {} });
  });
  if (process.env.AUDIT_LEGACY_UI_MEDIA === '1') app.get('/', (_req, res) => {
    const legacyHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace('assets/CRONOX-preloader.webp', 'assets/CRONOX-GIF.gif')
      .replace('assets/logo-topbar.webp', 'assets/logo_banner.png');
    res.type('html').send(legacyHtml);
  });
  app.use(express.static(path.join(root, 'public')));
  app.use(express.static(root));
  app.get('/faqs', (_req, res) => res.sendFile(path.join(root, 'faqs.html')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cronox-loading-'));
  const chrome = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let ws;
  try {
    const activePort = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !fs.existsSync(activePort); i++) await sleep(100);
    const port = fs.readFileSync(activePort, 'utf8').split('\n')[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let seq = 0, started = 0, events = [], requests = new Map(), errors = [];
    const pending = new Map();
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data), p = m.params || {}, at = Date.now() - started;
      if (m.id) { const task = pending.get(m.id); if (task) { clearTimeout(task.timer); pending.delete(m.id); m.error ? task.reject(new Error(m.error.message)) : task.resolve(m.result); } return; }
      if (['Page.frameStartedLoading', 'Page.frameStoppedLoading', 'Page.domContentEventFired', 'Page.loadEventFired', 'Page.frameNavigated'].includes(m.method)) events.push({ event: m.method, at, frame: p.frameId || p.frame?.id, url: p.frame?.url && safeUrl(p.frame.url) });
      if (m.method === 'Network.requestWillBeSent') requests.set(p.requestId, { url: safeUrl(p.request.url), type: p.type, method: p.request.method, at, initiator: p.initiator?.type, caller: p.initiator?.stack?.callFrames?.slice(0, 3).map(f => ({ url: safeUrl(f.url), line: f.lineNumber, function: f.functionName })), redirect: p.redirectResponse?.status });
      const req = requests.get(p.requestId);
      if (req && m.method === 'Network.responseReceived') Object.assign(req, { status: p.response.status, mime: p.response.mimeType, cache: p.response.fromDiskCache, headers: Object.fromEntries(Object.entries(p.response.headers).filter(([key]) => /^(content-type|content-length|content-range|accept-ranges|cache-control|location)$/i.test(key))) });
      if (req && ['Network.loadingFinished', 'Network.loadingFailed'].includes(m.method)) Object.assign(req, { end: at, duration: at - req.at, failed: p.errorText, bytes: p.encodedDataLength });
      if (m.method === 'Runtime.exceptionThrown') errors.push({ at, text: p.exceptionDetails.text, description: p.exceptionDetails.exception?.description?.slice(0, 400) });
      if (m.method === 'Fetch.requestPaused') {
        // Production observation must not submit analytics or mutate state.
        const block = !['GET', 'HEAD', 'OPTIONS'].includes(p.request.method) || (process.env.AUDIT_BLOCK && p.request.url.includes(process.env.AUDIT_BLOCK));
        void send(block ? 'Fetch.failRequest' : 'Fetch.continueRequest', block ? { requestId: p.requestId, errorReason: 'BlockedByClient' } : { requestId: p.requestId });
      }
    });
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const version = await send('Browser.getVersion');
    const base = mode === 'production' ? 'https://cronox.es' : `http://127.0.0.1:${server.address().port}`;
    if (process.env.AUDIT_MOBILE === '1') await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const runs = [];
    const scenarios = process.env.AUDIT_QUICK ? [{ route: '/', cache: 'cold', slow: process.env.AUDIT_SLOW === '1' }] : [
      { route: '/', cache: 'cold', slow: false }, { route: '/', cache: 'warm', slow: false },
      { route: '/faqs', cache: 'cold', slow: false }, { route: '/', cache: 'cold', slow: true },
    ];
    for (const scenario of scenarios) {
      await send('Page.navigate', { url: 'about:blank' }); await sleep(200);
      if (scenario.cache === 'cold') await send('Network.clearBrowserCache');
      await send('Network.emulateNetworkConditions', { offline: false, latency: scenario.slow ? 150 : 0, downloadThroughput: scenario.slow ? 200000 : -1, uploadThroughput: scenario.slow ? 100000 : -1 });
      events = []; requests = new Map(); errors = []; started = Date.now();
      await send('Page.navigate', { url: base + scenario.route });
      const screenshotAt = runs.length === 0 ? Number(process.env.AUDIT_SCREENSHOT_AT_MS || 0) : 0;
      if (screenshotAt > 0) {
        await sleep(screenshotAt);
        const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        fs.writeFileSync(process.env.AUDIT_SCREENSHOT, Buffer.from(shot.data, 'base64'));
      }
      await sleep(Math.max(0, waitMs - screenshotAt));
      const snapshot = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({readyState:document.readyState,url:location.origin+location.pathname,navigation:performance.getEntriesByType('navigation').map(n=>({domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd,responseEnd:n.responseEnd})),resources:performance.getEntriesByType('resource').filter(r=>/CRONOX-preloader|logo-topbar|logo_banner|chains-newsletter/.test(r.name)).map(r=>({name:r.name.split('/').pop(),start:r.startTime,responseStart:r.responseStart,responseEnd:r.responseEnd,transferSize:r.transferSize,decodedBodySize:r.decodedBodySize})),topbarLogo:(()=>{const i=document.querySelector('.topbar__logo-img');if(!i)return null;const r=i.getBoundingClientRect();return{src:i.currentSrc,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,width:r.width,height:r.height}})(),hero:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,readyState:v.readyState,networkState:v.networkState,time:v.currentTime,paused:v.paused,error:v.error?.code})),preloader:document.body?.className,icons:[...document.querySelectorAll('link[rel*=icon]')].map(i=>i.href)})` });
      runs.push({ ...scenario, snapshot: snapshot.result?.value && JSON.parse(snapshot.result.value), events, pending: [...requests.values()].filter(r => r.end === undefined), requests: [...requests.values()], errors });
      if (process.env.AUDIT_ASSERT_COMPLETE === '1') {
        const run = runs.at(-1);
        assert.equal(run.snapshot.readyState, 'complete');
        assert.ok(run.snapshot.navigation[0].load > 0 && run.snapshot.navigation[0].load < waitMs);
        assert.equal(events.filter(e => e.event === 'Page.frameStartedLoading').length, 1);
        assert.ok(events.some(e => e.event === 'Page.frameStoppedLoading'));
        assert.ok(!run.pending.some(r => r.url.endsWith('/CRONOX-preloader.webp')));
        if (scenario.route === '/') assert.ok(run.snapshot.hero.some(v => !v.paused && v.time > 0));
      }
      console.log(JSON.stringify({ mode, ...scenario, snapshot: runs.at(-1).snapshot, events, pending: runs.at(-1).pending }));
    }
    const output = path.resolve(process.env.AUDIT_OUTPUT || `loading-audit-${mode}.json`);
    fs.writeFileSync(output, JSON.stringify({ version, mode, note: 'Anonymous browser; non-read requests blocked; local API uses fixtures. No native tab UI captured.', runs }, null, 2));
    await send('Browser.close');
  } finally { ws?.close(); chrome.kill(); server.close(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
