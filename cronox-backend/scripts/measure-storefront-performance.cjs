// Deterministic source/asset audit. This does not emulate browser networking or paint.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../../cronox-front');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('assets/app.js');
const appPreloader = app.slice(app.indexOf('  // ===== Preloader ====='), app.indexOf('  // ===== Topbar ====='));
const home = new JSDOM(read('index.html'));
const fallback = [...home.window.document.scripts].find(s => s.textContent.includes('FAILSAFE') || s.textContent.includes('var tried=false'))?.textContent || '';
function simulate(domAt, loadAt, options = {}) {
  let now = 0, nextId = 0, unlockAt = null, hiddenAt = null, imageReleasedAt = null, readyEvents = 0;
  const tasks = new Map(), listeners = {};
  const classes = new Set(['is-loading']);
  const body = { classList: {
    contains: n => classes.has(n),
    remove: n => { classes.delete(n); if (n === 'is-loading' && unlockAt === null) unlockAt = now; },
    add: n => classes.add(n),
  } };
  const preloader = { dataset: options.persistent ? { persistent: 'true' } : {}, querySelectorAll: () => [{ removeAttribute(name) { if (name === 'src') imageReleasedAt = now; } }], style: new Proxy({}, { set(o, k, v) { o[k] = v; if (k === 'display' && v === 'none' && hiddenAt === null) hiddenAt = now; return true; } }), remove() { if (hiddenAt === null) hiddenAt = now; } };
  const addEventListener = (name, fn) => (listeners[name] ||= []).push(fn);
  const setTimeout = (fn, delay = 0) => { const id = ++nextId; tasks.set(id, { at: now + delay, fn }); return id; };
  const document = { body, readyState: 'loading', getElementById: () => preloader, addEventListener };
  const window = { history: {}, scrollTo() {}, addEventListener, dispatchEvent() { readyEvents += 1; } };
  const context = { window, document, CustomEvent: function () {}, Date: { now: () => now }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }), setTimeout, clearTimeout: id => tasks.delete(id), requestAnimationFrame: fn => setTimeout(fn, 16) };
  if (!options.persistent) vm.runInNewContext(fallback, context);
  if (!options.appUnavailable) vm.runInNewContext(appPreloader, context);
  setTimeout(() => { document.readyState = 'interactive'; (listeners.DOMContentLoaded || []).forEach(fn => fn()); }, domAt);
  if (loadAt !== null) setTimeout(() => { document.readyState = 'complete'; (listeners.load || []).forEach(fn => fn()); }, loadAt);
  while (tasks.size) {
    const [id, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
    tasks.delete(id); now = task.at; if (now > 15000) break; task.fn();
  }
  return { domAtMs: domAt, loadAtMs: loadAt, scrollUnlockedAtMs: unlockAt, overlayRemovedAtMs: hiddenAt, imageReleasedAtMs: imageReleasedAt, readyEvents };
}
const pages = ['index.html', 'producto.html', 'favorites.html', 'cart.html', 'checkout.html', 'gallery.html'].map(file => {
  const html = read(file), dom = new JSDOM(html);
  const urls = new Set([...dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"][href],link[rel="preload"][href],img[src],video[src]')].map(el => el.getAttribute('src') || el.getAttribute('href')).filter(Boolean));
  const resources = [...urls].map(url => {
    const target = path.resolve(root, url.split('?')[0].replace(/^\//, ''));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) return { url, bytes: null };
    const data = fs.readFileSync(target);
    return { url, bytes: data.length, gzipBytes: /\.(js|css)$/.test(target) ? zlib.gzipSync(data).length : null };
  });
  dom.window.close();
  return { file, htmlBytes: Buffer.byteLength(html), staticResourceReferences: urls.size, localReferencedBytes: resources.reduce((sum, r) => sum + (r.bytes || 0), 0), resources };
});
home.window.close();
console.log(JSON.stringify({ note: 'Static references are not measured network requests or transferred bytes. Simulations use identical DOM/load timing, no CPU/network emulation. /tienda reuses index.html.', preloader: { fast: simulate(100, 500), slowResources: simulate(500, 8000), missingLoad: simulate(500, null), appFailure: simulate(500, null, { appUnavailable: true }), persistentCheckout: simulate(500, 8000, { persistent: true }) }, pages }, null, 2));
