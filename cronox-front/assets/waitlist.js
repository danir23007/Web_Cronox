(function () {
  'use strict';

  let refresh = () => {};
  const activeMessage = 'Ya tienes un aviso activado para esta talla. Recibirás un mail avisándote cuando volvamos a tener esta talla de este producto.';
  const label = size => window.CRONOX_SIZES?.label?.(size) || String(size).replace('US_', 'US ');
  // Reservations have already been deducted from stockQty, as on the PDP and checkout.
  const soldOutVariants = product => (product?.variants || Object.values(product?.variantMap || {}))
    .filter(v => Number.isSafeInteger(Number(v.id)) && v.isActive !== false &&
      (v.stockQty ?? v.stock) != null && Number.isFinite(Number(v.stockQty ?? v.stock)) &&
      Number(v.stockQty ?? v.stock) <= 0);

  const request = async (id, method = 'GET') => {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') Object.assign(headers, await window.CRONOX_API?.getCsrfHeaders?.());
    const response = await fetch(`${window.CRONOX_API?.API_BASE || ''}/api/waitlist/${id}`, {
      method, headers, credentials: 'include', cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof data.message === 'string' ? data.message : 'No hemos podido gestionar el aviso. Vuelve a intentarlo.');
      error.status = response.status;
      throw error;
    }
    return data;
  };

  window.CRONOX_WAITLIST = { mount(product, anchor) {
    document.getElementById('productWaitlist')?.remove();
    refresh = () => {};
    let variants = soldOutVariants(product);
    if (!anchor || !variants.length) return;

    const params = new URLSearchParams(location.search);
    const initial = variants.find(v => String(v.id) === params.get('waitlist')) ||
      variants.find(v => String(v.sizeCode || v.size).toUpperCase().replace(/\s+/g, '_') === params.get('size')?.toUpperCase()) || variants[0];
    const root = document.createElement('details');
    root.id = 'productWaitlist'; root.className = 'restock-panel'; root.open = true;
    // Only static markup; product-controlled values are assigned as text below.
    root.innerHTML = '<summary>Avísame cuando vuelva</summary><label for="restockSize">Elige la talla para tu aviso</label><select id="restockSize"></select><p class="restock-choice"></p><p class="restock-status" role="status" aria-live="polite"></p><button class="btn" type="button"></button><p class="restock-help">Disponibilidad sujeta a existencias. Este aviso no reserva la prenda.</p>';
    anchor.insertAdjacentElement('afterend', root);
    const select = root.querySelector('select');
    const status = root.querySelector('.restock-status');
    const choice = root.querySelector('.restock-choice');
    const button = root.querySelector('button');
    variants.forEach(v => select.add(new Option(label(v.size), String(v.id))));
    select.value = String(initial.id);
    let subscription = null, generation = 0, busy = false, readFailed = false;
    const selected = () => variants.find(v => String(v.id) === select.value);
    const remember = () => {
      const url = new URL(location.href);
      url.searchParams.set('waitlist', select.value);
      history.replaceState(history.state, '', url);
    };
    const render = () => {
      const variant = selected();
      if (!variant || !root.isConnected) return;
      choice.textContent = `${product.name} · Talla ${label(variant.size)}`;
      button.textContent = busy ? 'Un momento…' : readFailed ? 'Volver a comprobar' : subscription ? 'Cancelar aviso' : window.CRONOX_USER ? 'Avísame cuando vuelva' : 'Iniciar sesión o registrarme';
      button.disabled = busy || subscription?.status === 'PROCESSING';
      select.disabled = busy;
      root.setAttribute('aria-busy', String(busy));
    };
    const showState = () => {
      if (subscription) {
        status.textContent = subscription.status === 'PROCESSING' ? 'Tu aviso ya se está enviando.' :
          subscription.status === 'UNCERTAIN' ? 'Tu aviso tiene una entrega sin confirmar. No lo reenviaremos automáticamente.' :
          subscription.status === 'FAILED' ? 'No pudimos enviar tu aviso. Puedes cancelarlo.' : activeMessage;
      } else status.textContent = window.CRONOX_USER ?
        'Confirma tu aviso. Te avisaremos cuando esta talla vuelva a estar disponible.' :
        'Inicia sesión o crea tu cuenta. Al volver tendrás que confirmar el aviso.';
    };
    // Recheck before POST: the page's product snapshot may have become stale.
    // The server still validates availability atomically.
    const updateAvailability = latest => {
      const next = soldOutVariants(latest);
      if (!next.length) { root.remove(); refresh = () => {}; return false; }
      const previousId = select.value;
      variants = next;
      select.replaceChildren(...next.map(v => new Option(label(v.size), String(v.id))));
      const stillEligible = next.some(v => String(v.id) === previousId);
      select.value = stillEligible ? previousId : String(next[0].id);
      if (!stillEligible) { subscription = null; remember(); }
      return stillEligible;
    };
    refresh = async () => {
      const current = ++generation;
      subscription = null; readFailed = false; busy = true; status.textContent = 'Comprobando tu aviso…'; render();
      try {
        await window.CRONOX_AUTH_READY;
        const result = window.CRONOX_USER ? await request(select.value) : { subscription: null };
        if (current !== generation || !root.isConnected) return;
        subscription = result.subscription; showState();
      } catch (error) {
        if (current !== generation) return;
        readFailed = true;
        status.textContent = error.status === 401 ? 'Inicia sesión de nuevo para gestionar tu aviso.' : error.message;
      } finally { if (current === generation) { busy = false; render(); } }
    };
    select.addEventListener('change', () => { remember(); void refresh(); });
    button.addEventListener('click', async () => {
      if (busy) return;
      remember();
      if (!window.CRONOX_USER) {
        try { await window.CRONOX_openAuthModal?.('login'); }
        catch { status.textContent = 'No se pudo abrir el acceso a tu cuenta. Vuelve a intentarlo.'; }
        return;
      }
      if (readFailed) { void refresh(); return; }
      const current = ++generation;
      const cancelling = Boolean(subscription);
      const variantId = select.value;
      busy = true; status.textContent = cancelling ? 'Cancelando aviso…' : 'Comprobando disponibilidad…'; render();
      try {
        if (!cancelling) {
          if (!window.CRONOX_API?.getProductBySlug) throw new Error('No pudimos comprobar la disponibilidad. Vuelve a intentarlo.');
          const latest = await window.CRONOX_API.getProductBySlug(product.slug, { cache: 'no-store' });
          if (current !== generation || !root.isConnected) return;
          if (!latest) throw new Error('No pudimos comprobar la disponibilidad. Vuelve a intentarlo.');
          if (!updateAvailability(latest)) {
            status.textContent = 'Esta talla ya está disponible. Actualiza la página para comprarla.';
            return;
          }
          status.textContent = 'Activando aviso…';
        }
        const result = await request(variantId, cancelling ? 'DELETE' : 'POST');
        if (current !== generation || !root.isConnected) return;
        subscription = result.subscription;
        if (cancelling) status.textContent = 'Aviso cancelado.';
        else showState();
      } catch (error) {
        if (current !== generation) return;
        status.textContent = error.message;
        // The server may have committed even if the response was lost.
        readFailed = true;
      } finally { if (current === generation) { busy = false; render(); } }
    });
    void refresh();
  } };
  window.addEventListener('cronox:userChanged', () => void refresh());
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
})();
