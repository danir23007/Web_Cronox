// Read-only image diagnostic. Run against the local static frontend with public API snapshots.
const { chromium } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../cronox-front');
const output = path.resolve(__dirname, '../../test-results');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const scenario = process.argv[2] || 'gallery';
const device = process.argv[3] || 'desktop';
const label = process.argv[4] || 'before';
const viewport = device === 'mobile' ? { width: 390, height: 844 } : { width: 1366, height: 768 };

async function main() {
  const [gallery, products] = await Promise.all([
    fetch('https://cronox.es/api/gallery').then(r => r.json()),
    fetch('https://cronox.es/api/products').then(r => r.json()),
  ]);
  if (label === 'after') {
    const byId = new Map((products.items || []).map(product => [product.id, product]));
    for (const item of [...(gallery.slots || []), ...(gallery.carouselItems || [])]) {
      for (const related of item.products || []) {
        const matching = byId.get(related.id);
        related.imageRecord = matching?.images?.find(image => image.isPrimary) || matching?.images?.[0] || null;
      }
    }
  }
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/')) {
      const body = pathname === '/api/gallery' ? gallery : pathname === '/api/products' ? products : pathname === '/api/cart' ? { items: [], subtotalCents: 0, itemsCount: 0 } : {};
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
      return;
    }
    const file = pathname === '/' || pathname === '/tienda' ? '/index.html' : pathname === '/galeria' ? '/gallery.html' : pathname;
    const target = path.resolve(root, '.' + file);
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(target, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: device === 'mobile' ? 2 : 1 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__CRONOX_API_BASE__ = location.origin;
    window.__imageLoads = [];
    window.__layoutShift = 0;
    window.__layoutShiftSources = [];
    new PerformanceObserver(list => list.getEntries().forEach(entry => {
      if (!entry.hadRecentInput) {
        window.__layoutShift += entry.value;
        window.__layoutShiftSources.push({ value: entry.value, sources: entry.sources?.map(source => source.node?.className || source.node?.nodeName) || [] });
      }
    })).observe({ type: 'layout-shift', buffered: true });
    document.addEventListener('load', event => {
      if (event.target instanceof HTMLImageElement) {
        const image = event.target;
        const box = image.getBoundingClientRect();
        window.__imageLoads.push({ url: image.currentSrc || image.src, at: Math.round(performance.now()), visible: box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 });
      }
    }, true);
    sessionStorage.setItem('cronox_newsletter_seen', '1');
    document.cookie = 'cronox_cookie_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, preferences: false, analytics: false, marketing: false, consentVersion: '2', timestamp: new Date().toISOString() })) + '; path=/';
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 100000 });
  await cdp.send('Network.setBlockedURLs', { urls: ['*google-analytics*', '*googletagmanager*', '*doubleclick*', '*.mp4*'] });
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', event => {
    if (event.type === 'Image') requests.set(event.requestId, { url: event.request.url, start: event.timestamp, bytes: 0 });
  });
  cdp.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId);
    if (!request) return;
    Object.assign(request, { status: event.response.status, mime: event.response.mimeType, cacheControl: event.response.headers['cache-control'] || event.response.headers['Cache-Control'] || '', contentLength: Number(event.response.headers['content-length'] || event.response.headers['Content-Length']) || null, fromDiskCache: Boolean(event.response.fromDiskCache), fromServiceWorker: Boolean(event.response.fromServiceWorker), responseAt: event.timestamp });
  });
  cdp.on('Network.requestServedFromCache', event => { const request = requests.get(event.requestId); if (request) request.fromCache = true; });
  cdp.on('Network.loadingFinished', event => { const request = requests.get(event.requestId); if (request) Object.assign(request, { bytes: event.encodedDataLength, finishAt: event.timestamp }); });
  const results = [];
  try {
    for (const pass of ['cold', 'warm']) {
      if (pass === 'cold') await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      requests.clear();
      await page.goto(`http://127.0.0.1:4175/${scenario === 'gallery' ? 'galeria' : ''}`, { waitUntil: 'domcontentloaded' });
      let actionAt;
      let initialRequests = 0;
      if (scenario === 'gallery') {
        await page.locator('#galleryGrid[data-gallery-mode="CAROUSEL"] .gallery-carousel__slide').first().waitFor({ timeout: 10000 });
        await page.waitForTimeout(1200);
        initialRequests = [...requests.values()].filter(r => /storage\/v1\/object\/public\/gallery/.test(r.url)).length;
        actionAt = await page.evaluate(() => performance.now());
        await page.locator('#galleryGrid .gallery-carousel__slide').first().click({ force: true });
        await page.locator('#galleryLightbox:not([hidden])').waitFor();
      } else {
        await page.locator('#productsGrid .product-card').first().waitFor({ timeout: 10000 });
        actionAt = await page.evaluate(() => performance.now());
        await page.locator('#productsGrid .product-card').first().scrollIntoViewIfNeeded();
      }
      await page.waitForTimeout(10000);
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, `image-${label}-${scenario}-${device}-${pass}.png`) });
      const dom = await page.evaluate(({ scenario, actionAt }) => {
        const selector = scenario === 'gallery' ? '#galleryLightboxProducts img' : '#productsGrid .product-card .product-img.active';
        const images = [...document.querySelectorAll(selector)].map(img => {
          const box = img.getBoundingClientRect();
          const load = window.__imageLoads.find(row => row.url === (img.currentSrc || img.src) && row.at >= actionAt - 100);
          return { url: img.currentSrc || img.src, natural: [img.naturalWidth, img.naturalHeight], rendered: [Math.round(box.width), Math.round(box.height)], visible: box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0, complete: img.complete && img.naturalWidth > 0, loadedAt: load?.at || null, loading: img.loading, srcset: img.getAttribute('srcset') || '' };
        });
        return { images, layoutShift: window.__layoutShift, layoutShiftSources: window.__layoutShiftSources, actionAt, imageLoads: window.__imageLoads };
      }, { scenario, actionAt });
      const network = [...requests.values()].filter(r => r.url.includes('/storage/v1/object/public/') || r.url.includes('/assets/'));
      const related = network.filter(r => r.url.includes('/product-images/'));
      const summary = { label, scenario, device, pass, viewport, initialGalleryRequests: initialRequests, imageRequests: network.length, productImageRequests: related.length, transferredBytes: Math.round(network.reduce((n, r) => n + (r.bytes || 0), 0)), productImageBytes: Math.round(related.reduce((n, r) => n + (r.bytes || 0), 0)), visibleImages: dom.images.filter(i => i.visible).length, visibleLoaded: dom.images.filter(i => i.visible && i.complete).length, visibleLoadedAtMs: dom.images.filter(i => i.visible && i.loadedAt).map(i => Math.round(i.loadedAt - actionAt)), layoutShift: dom.layoutShift, layoutShiftSources: dom.layoutShiftSources, images: dom.images.slice(0, 5), requests: network.filter(r => related.includes(r) || r.url.includes('/gallery/')).slice(0, 25).map(r => ({ url: r.url, bytes: r.bytes, status: r.status, cacheControl: r.cacheControl, fromCache: Boolean(r.fromCache || r.fromDiskCache), durationMs: r.finishAt ? Math.round((r.finishAt - r.start) * 1000) : null })) };
      results.push(summary);
      fs.writeFileSync(path.join(output, `image-${label}-${scenario}-${device}-${pass}.json`), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify({ label, scenario, device, pass, initialGalleryRequests: summary.initialGalleryRequests, imageRequests: summary.imageRequests, productImageRequests: summary.productImageRequests, transferredBytes: summary.transferredBytes, productImageBytes: summary.productImageBytes, visibleImages: summary.visibleImages, visibleLoaded: summary.visibleLoaded, visibleLoadedAtMs: summary.visibleLoadedAtMs, layoutShift: summary.layoutShift, productRequests: summary.requests.filter(r => r.url.includes('/product-images/')).map(r => ({ url: r.url, bytes: r.bytes, status: r.status, durationMs: r.durationMs })) }));
      if (scenario === 'gallery') {
        await page.locator('#galleryLightboxNext').click();
        await page.locator('#galleryLightboxImage').waitFor({ state: 'visible' });
        await page.locator('#galleryLightboxClose').click();
        console.log(JSON.stringify({ label, scenario, device, pass, interaction: 'lightbox-next-close', passed: true }));
      } else {
        const firstCard = page.locator('#productsGrid .product-card').first();
        if (device === 'desktop') await firstCard.hover();
        else await firstCard.locator('.product-arrow.next').evaluate(button => button.click());
        await page.waitForFunction(() => {
          const gallery = document.querySelector('#productsGrid .product-card .product-images');
          const index = Number(gallery?.dataset.activeIndex);
          return index === 1 && gallery?.querySelectorAll('img')[1]?.naturalWidth > 0;
        }, null, { timeout: 15000 });
        const secondary = await firstCard.locator('.product-img').nth(1).getAttribute('src');
        console.log(JSON.stringify({ label, scenario, device, pass, interaction: 'secondary-card-image', passed: Boolean(secondary?.includes('/variants/') && secondary?.endsWith('/card.webp')) }));
      }
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  return results;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
