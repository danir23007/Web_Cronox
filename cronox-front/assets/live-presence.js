(() => {
  'use strict';
  if (/^\/admin(?:[/.\-]|$)/i.test(location.pathname) || window.CRONOX_LIVE_PRESENCE) return;
  window.CRONOX_LIVE_PRESENCE = true;
  let enabled = false, timer = null, pending = false, productId = null, lastSent = 0;
  const path = () => {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/tienda' || location.hash === '#store') return 'store';
    if (p === '/' || p === '/index.html') return 'home';
    if (/^\/producto(?:\/|\.html$)/.test(p)) return 'product';
    if (['/cesta', '/cart.html'].includes(p)) return 'cart';
    if (['/checkout', '/checkout.html'].includes(p)) return 'checkout';
    return 'other';
  };
  // Serialize cookie issuance across tabs, including the very first signal.
  const locked = async work => {
    if (navigator.locks) return navigator.locks.request('cronox-live-presence', work);
    const key = 'cronox_live_lease', owner = crypto.randomUUID();
    try {
      const previous = JSON.parse(localStorage.getItem(key) || 'null');
      if (previous?.until > Date.now()) return;
      localStorage.setItem(key, JSON.stringify({ owner, until: Date.now() + 15000 }));
      await new Promise(resolve => setTimeout(resolve, 60));
      if (JSON.parse(localStorage.getItem(key) || 'null')?.owner !== owner) return;
      try { return await work(); }
      finally { if (JSON.parse(localStorage.getItem(key) || 'null')?.owner === owner) localStorage.removeItem(key); }
    } catch { /* No shared storage: do not knowingly count the same browser twice. */ }
  };
  const send = async (remove = false) => {
    if (pending || (!remove && (!enabled || document.hidden))) return;
    pending = true;
    try {
      await locked(async () => {
        if (!remove && (!enabled || document.hidden)) return;
        const headers = window.CRONOX_API?.getCsrfHeaders
          ? await window.CRONOX_API.getCsrfHeaders()
          : { 'x-csrf-token': (await (await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' })).json()).csrfToken };
        if (!headers) return;
        const section = path();
        const id = productId || Number(document.getElementById('pFavoriteToggle')?.dataset.productId) || null;
        lastSent = Date.now();
        await fetch(`${window.CRONOX_API?.API_BASE || ''}/api/live-stats/presence`, {
          method: 'POST', credentials: 'include', signal: AbortSignal.timeout(10000),
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ section, ...(section === 'product' && id ? { productId: id } : {}), enabled: !remove }),
        });
      });
    } catch { /* Presence is optional; retry on the next visible heartbeat. */ }
    finally { pending = false; if (!enabled && !remove) void send(true); }
  };
  const schedule = (delay = 30000) => {
    clearTimeout(timer); timer = null;
    if (!enabled || document.hidden) return;
    timer = setTimeout(async () => { await send(); schedule(); }, delay);
  };
  const refresh = () => schedule(Math.max(0, 5100 - (Date.now() - lastSent)));
  const start = () => { enabled = true; refresh(); };
  const stop = () => { enabled = false; clearTimeout(timer); timer = null; void send(true); };
  document.addEventListener('visibilitychange', () => document.hidden ? schedule() : refresh());
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', () => { clearTimeout(timer); timer = null; });
  window.addEventListener('focus', refresh);
  window.addEventListener('hashchange', refresh);
  window.addEventListener('cronox:productViewed', e => { productId = Number(e.detail?.productId) || null; refresh(); });
  window.addEventListener('cart:updated', refresh);
  window.addEventListener('cronox:userChanged', refresh);
  window.addEventListener('cronox:session-ended', refresh);
  window.CRONOX_COOKIE_CONSENT?.registerService({ id: 'cronox-live-presence', category: 'analytics', load: start, disable: stop });
})();
