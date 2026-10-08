(() => {
  'use strict';
  if (/^\/admin(?:[/.\-]|$)/i.test(location.pathname) || window.CRONOX_LIVE_PRESENCE) return;
  window.CRONOX_LIVE_PRESENCE = true;
  let timer = null, pending = false, posting = false, controller = null, revision = 0, productId = null, lastSent = 0, stopped = false, rerun = false;
  const base = () => window.CRONOX_API?.API_BASE || window.__CRONOX_API_BASE__ || document.querySelector('meta[name="cronox:api-base"]')?.content || '';
  const path = () => {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/tienda' || location.hash === '#store') return 'store';
    if (p === '/' || p === '/index.html') return 'home';
    if (/^\/producto(?:\/|\.html$)/.test(p)) return 'product';
    if (['/cesta', '/cart.html'].includes(p)) return 'cart';
    if (['/checkout', '/checkout.html'].includes(p)) return 'checkout';
    return 'other';
  };
  const locked = async work => {
    if (navigator.locks) return navigator.locks.request('cronox-live-presence', work);
    const key = 'cronox_live_lease', owner = crypto.randomUUID();
    try {
      const previous = JSON.parse(localStorage.getItem(key) || 'null');
      if (previous?.until > Date.now()) return;
      localStorage.setItem(key, JSON.stringify({ owner, until: Date.now() + 15000 }));
      await new Promise(resolve => setTimeout(resolve, 60));
      if (JSON.parse(localStorage.getItem(key) || 'null')?.owner !== owner) return;
    } catch { return; /* Without shared storage, do not issue overlapping browser proofs. */ }
    // Transport errors must reach the heartbeat retry, even without Web Locks.
    try { return await work(); }
    finally {
      try { if (JSON.parse(localStorage.getItem(key) || 'null')?.owner === owner) localStorage.removeItem(key); } catch { /* Lease expires automatically. */ }
    }
  };
  const resolveAuth = async () => {
    if (window.CRONOX_AUTH_STATE === 'unknown' || !window.CRONOX_AUTH_STATE) {
      if (window.CRONOX_AUTH_READY) await window.CRONOX_AUTH_READY;
      if (window.CRONOX_AUTH_STATE === 'unknown' || !window.CRONOX_AUTH_STATE) {
        if (window.CRONOX_refreshAuthState) await window.CRONOX_refreshAuthState();
        else {
          // Information pages omit app.js; reuse its validated session endpoint.
          const response = await fetch(`${base()}/api/me`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000) });
          let user;
          if (response.ok) user = await response.json();
          else if (response.status === 401 && (await response.json()).code === 'AUTH_REQUIRED') user = null;
          else throw new Error('Presence authentication unresolved');
          window.CRONOX_USER = user;
          window.CRONOX_AUTH_STATE = user ? 'authenticated' : 'anonymous';
        }
      }
    }
    if (!['anonymous', 'authenticated'].includes(window.CRONOX_AUTH_STATE)) throw new Error('Presence authentication unresolved');
    return !['ADMIN', 'SUPERADMIN'].includes(window.CRONOX_USER?.role);
  };
  const schedule = (delay = 30000) => {
    clearTimeout(timer); timer = null;
    if (stopped || document.hidden) return;
    timer = setTimeout(() => { timer = null; void send(); }, delay);
  };
  const refresh = () => schedule(Math.max(0, 5100 - (Date.now() - lastSent)));
  const bounded = async work => {
    let timeout;
    try { return await Promise.race([work, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Presence prerequisite timed out')), 10000); })]); }
    finally { clearTimeout(timeout); }
  };
  async function send() {
    if (stopped || document.hidden) return;
    if (pending) { rerun = true; return; }
    pending = true; let retry = false;
    try {
      await bounded(resolveAuth());
      await locked(async () => {
        if (stopped || document.hidden) return;
        if (!['anonymous', 'authenticated'].includes(window.CRONOX_AUTH_STATE)) throw new Error('Presence authentication changed');
        const attempt = revision;
        const allowed = !['ADMIN', 'SUPERADMIN'].includes(window.CRONOX_USER?.role);
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 10000);
        try {
          const headers = window.CRONOX_API?.getCsrfHeaders
            ? await bounded(window.CRONOX_API.getCsrfHeaders())
            : { 'x-csrf-token': (await (await fetch(`${base()}/api/auth/csrf`, { credentials: 'include', cache: 'no-store', signal: controller.signal })).json()).csrfToken };
          if (attempt !== revision || stopped || document.hidden || controller.signal.aborted) return;
          const section = path(), id = productId || Number(document.getElementById('pFavoriteToggle')?.dataset.productId) || null;
          posting = true;
          const response = await fetch(`${base()}/api/live-stats/presence`, {
            method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, ...(section === 'product' && id ? { productId: id } : {}), enabled: allowed }),
          });
          if (!response.ok) throw new Error('Presence signal failed');
          if (attempt === revision) lastSent = Date.now();
        } finally { clearTimeout(timeout); posting = false; controller = null; }
      });
    } catch { retry = true; }
    finally {
      pending = false;
      const immediate = rerun; rerun = false;
      schedule(immediate ? 0 : retry ? 5000 : 30000);
    }
  }
  const identityChanged = () => {
    revision++;
    if (pending) { if (controller) { rerun = true; if (!posting) controller.abort(); } return; }
    schedule(0);
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; controller?.abort(); } else refresh(); });
  window.addEventListener('pageshow', () => { stopped = false; refresh(); });
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); timer = null; controller?.abort(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('hashchange', refresh);
  window.addEventListener('cronox:productViewed', e => { productId = Number(e.detail?.productId) || null; refresh(); });
  window.addEventListener('cart:updated', refresh);
  window.addEventListener('cronox:userChanged', identityChanged);
  window.addEventListener('cronox:authResolved', identityChanged);
  window.addEventListener('cronox:session-ended', () => { window.CRONOX_AUTH_STATE = 'unknown'; identityChanged(); });
  // Temporary presence is independent of opt-in daily analytics.
  refresh();
})();
