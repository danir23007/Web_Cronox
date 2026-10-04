/* Attributed storefront access: consent + visible page + trusted interaction. No cookies. */
(() => {
  'use strict';
  const url = new URL(location.href), token = url.searchParams.get('cx_campaign');
  if (!token) return;
  url.searchParams.delete('cx_campaign');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  // Local QA, webdriver, internal pages and previews never contribute real metrics.
  if (navigator.webdriver || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /^\/admin|\/api\//i.test(location.pathname)) return;
  const started = Date.now();
  let enabled = false, interacted = false, sent = false, pending = false, retry;
  const base = () => window.CRONOX_API?.API_BASE || window.__CRONOX_API_BASE__ || '';
  const csrf = async () => {
    if (window.CRONOX_API?.getCsrfHeaders) return window.CRONOX_API.getCsrfHeaders();
    const read = () => document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('cronox_csrf_token='))?.split('=').slice(1).join('=');
    if (!read()) await fetch(base() + '/api/auth/csrf', { credentials: 'include' });
    if (!read()) throw Error('CSRF_UNAVAILABLE');
    return { 'x-csrf-token': decodeURIComponent(read()) };
  };
  async function record() {
    if (!enabled || !interacted || sent || pending || document.visibilityState !== 'visible') return;
    if (Date.now() - started < 2500) { clearTimeout(retry); retry = setTimeout(record, 2500); return; }
    pending = true;
    try {
      const headers = await csrf();
      if (!enabled) return;
      const response = await fetch(base() + '/api/mailbox-access/arrival', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ token, path: location.pathname }), signal: AbortSignal.timeout(10000),
      });
      if (response.ok) sent = true;
    } catch { /* Navigation and purchases remain independent of measurement. */ }
    finally { pending = false; }
  }
  window.CRONOX_COOKIE_CONSENT?.registerService({ id: 'cronox-campaign-access', category: 'analytics',
    load: () => { enabled = true; void record(); }, disable: () => { enabled = false; clearTimeout(retry); } });
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, event => {
    if (!event.isTrusted) return;
    interacted = true; void record();
  }, { passive: true });
})();
