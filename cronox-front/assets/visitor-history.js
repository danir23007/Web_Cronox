/* Daily facts use a server-issued HttpOnly proof, never a client-supplied identity. */
(() => {
  'use strict';
  if (/^\/admin(?:[/.\-]|$)/i.test(location.pathname)) return;
  const KEY = 'cronox_visitor_browser';
  const base = () => window.CRONOX_API?.API_BASE || window.__CRONOX_API_BASE__ || document.querySelector('meta[name="cronox:api-base"]')?.content || '';
  const csrfHeaders = async () => {
    if (window.CRONOX_API?.getCsrfHeaders) return window.CRONOX_API.getCsrfHeaders();
    // Some public access pages deliberately do not load the shared API/session wrapper.
    // Reuse their readable double-submit cookie without installing/changing authentication.
    const read = () => document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('cronox_csrf_token='))?.slice('cronox_csrf_token='.length);
    if (!read()) await fetch(`${base()}/api/auth/csrf`, { credentials:'include', signal:AbortSignal.timeout(10000) });
    const token = read(); if (!token) throw new Error('CSRF_UNAVAILABLE');
    return { 'x-csrf-token':decodeURIComponent(token) };
  };
  let enabled = false, revision = 0, lastSignature = '', pending = false, failures = 0, timer, rerun = false;
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  async function recordUnlocked() {
    if (!enabled || document.visibilityState !== 'visible') return;
    if (pending) { rerun = true; return; }
    pending = true;
    const attempt = revision;
    try {
      // Optional passport authentication returns an explicit guest only without credentials.
      // The shared fetch wrapper retains the existing refresh policy.
      const sessionResponse = await fetch(`${base()}/api/analytics/visits/session${navigator.locks?.request ? '' : '?prepare=false'}`, { credentials:'include', cache:'no-store', signal:AbortSignal.timeout(10000) });
      if (!sessionResponse.ok) {
        if ([401,403].includes(sessionResponse.status)) return;
        throw new Error('SESSION_UNAVAILABLE');
      }
      const session = await sessionResponse.json();
      if (session.category === 'anonymous' && !session.browserReady) return;
      if (!enabled || attempt !== revision) return;
      const signature = `${day()}:${session.userId ? `account:${session.userId}` : 'anonymous'}`;
      if (signature === lastSignature) return;
      const headers = await csrfHeaders();
      if (!enabled || attempt !== revision) return;
      const response = await fetch(`${base()}/api/analytics/visits`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...headers },
        signal:AbortSignal.timeout(10000),
        body: JSON.stringify({ path: location.pathname, expectedCategory:session.category }),
      });
      if ([401,403].includes(response.status)) return;
      if (!response.ok) throw new Error('VISIT_UNAVAILABLE');
      const result = await response.json();
      if (result.accepted && enabled && attempt === revision) { lastSignature = signature; failures = 0; }
    } catch (_) {
      // A small bounded retry, independent of navigation. It cannot turn an auth failure into an anonymous fact.
      if (enabled && attempt === revision && ++failures <= 3) { clearTimeout(timer); timer = setTimeout(() => { void record(); }, 15000); }
    } finally { pending = false; if (rerun) { rerun = false; lastSignature = ''; queueMicrotask(() => { void record(); }); } }
  }
  async function record() {
    // Without Web Locks, never issue a new anonymous proof concurrently. Verified accounts remain countable.
    if (!navigator.locks?.request) return recordUnlocked();
    return navigator.locks.request('cronox-daily-visitor-registration', recordUnlocked);
  }
  const start = () => { try { localStorage.removeItem(KEY); } catch (_) {} enabled = true; failures = 0; void record(); };
  const stop = () => {
    enabled = false; revision++; lastSignature = ''; clearTimeout(timer);
    try { localStorage.removeItem(KEY); } catch (_) {}
    const clearProof = async () => {
      try { await fetch(`${base()}/api/analytics/visits/consent-revoked`, { method:'POST', credentials:'include', headers:await csrfHeaders(), signal:AbortSignal.timeout(10000) }); }
      catch (_) {}
    };
    void (navigator.locks?.request ? navigator.locks.request('cronox-daily-visitor-registration', clearProof) : clearProof());
  };
  window.CRONOX_COOKIE_CONSENT?.registerService({ id: 'cronox-daily-visitors', category: 'analytics', load: start, disable: stop });
  window.addEventListener('cronox:userChanged', () => { void record(); });
  window.addEventListener('cronox:session-ended', () => { lastSignature = ''; void record(); });
  window.addEventListener('pageshow', () => { void record(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void record(); });
  // Crossing midnight counts only once the person returns/interacts, never an unattended heartbeat.
  window.addEventListener('pointerdown', event => { if (event.isTrusted && lastSignature.split(':')[0] !== day()) void record(); }, { passive: true });
  window.addEventListener('keydown', event => { if (event.isTrusted && lastSignature.split(':')[0] !== day()) void record(); }, { passive: true });
  // API scripts may initialize after consent. Wait briefly without blocking rendering.
  const ready = setInterval(() => { if (window.CRONOX_API?.getMe) { clearInterval(ready); void record(); } }, 500);
  setTimeout(() => clearInterval(ready), 15000);
})();
