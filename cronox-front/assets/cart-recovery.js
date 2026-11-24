(() => {
  'use strict';
  const storageKey = 'cronox.cart.recovery';
  const url = new URL(location.href);
  const supplied = url.searchParams.get('recover');
  const valid = value => /^[a-f0-9-]{36}$/.test(value || '');
  const onCart = /^\/(?:cesta|cart(?:\.html)?)\/?$/.test(location.pathname);
  let episode = valid(supplied) ? supplied : null;
  try {
    if (episode) sessionStorage.setItem(storageKey, JSON.stringify({ episode, expires: Date.now() + 3600000 }));
    else {
      const pending = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (valid(pending?.episode) && pending.expires > Date.now()) episode = pending.episode;
    }
  } catch { /* Same-page login still keeps the destination in the URL. */ }
  let busy = false, recovered = false, loginOpened = false, visited = false;
  const post = async path => {
    const response = await fetch((window.CRONOX_API.API_BASE || '') + '/api/cart/' + path, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: await window.CRONOX_API.getCsrfHeaders(),
    });
    if (!response.ok) throw Error('CART_RECOVERY_REQUEST_FAILED');
    return response.json();
  };
  const status = text => {
    let element = document.getElementById('cartRecoveryStatus');
    if (!element) {
      element = document.createElement('p'); element.id = 'cartRecoveryStatus'; element.setAttribute('role', 'status');
      document.getElementById('cartItems')?.before(element);
    }
    element.textContent = text;
  };
  const resolve = async () => {
    if (busy || document.visibilityState !== 'visible') return;
    const user = window.CRONOX_USER;
    if (!['USER', 'FRIEND'].includes(user?.role)) {
      if (episode && onCart && window.CRONOX_AUTH_STATE === 'anonymous' && !loginOpened) {
        loginOpened = true;
        status('Inicia sesión con la cuenta de tu carrito para continuar.');
        await window.CRONOX_openAuthModal?.('login');
      }
      return;
    }
    if (episode && !onCart) {
      // Fixed local destination, never a redirect supplied by the URL.
      location.replace('/cesta?recover=' + encodeURIComponent(episode));
      return;
    }
    if (!onCart) return;
    busy = true;
    try {
      if (episode && !recovered) {
        const result = await post('recover/' + encodeURIComponent(episode));
        recovered = true; visited = true;
        try { sessionStorage.removeItem(storageKey); } catch {}
        url.searchParams.delete('recover'); history.replaceState(null, '', url.pathname + url.search + url.hash);
        status(result.valid
          ? 'Esta es tu cesta actual. Revisa los precios, las tallas y la disponibilidad antes de continuar.'
          : 'El enlace ya no está disponible para esta cuenta. Puedes continuar con tu cesta actual.');
        // The existing cart renderer handles stock, price and edition warnings.
        await window.CRONOX_CART?.fetchCart?.();
      } else if (!visited) {
        await post('activity'); visited = true;
      }
    } catch {
      status('No se pudo comprobar el carrito. Vuelve a intentarlo.');
    } finally { busy = false; }
  };
  window.addEventListener('cronox:authResolved', () => void resolve());
  document.addEventListener('visibilitychange', event => {
    if (event.isTrusted && document.visibilityState === 'visible') { visited = false; void resolve(); }
  });
  if (window.CRONOX_AUTH_STATE) void resolve();
})();
