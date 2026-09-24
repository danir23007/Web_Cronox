(function () {
  'use strict';
  let refresh = () => {};
  const label = size => window.CRONOX_SIZES?.label?.(size) || String(size).replace('US_', 'US ');
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
    const variants = (product.variants || Object.values(product.variantMap || {}))
      .filter(v => Number.isSafeInteger(Number(v.id)) && v.isActive !== false && (v.stockQty ?? v.stock) != null && Number.isFinite(Number(v.stockQty ?? v.stock)));
    if (!anchor || !variants.length) return;
    const soldOut = v => Number(v.stockQty ?? v.stock ?? 0) <= 0;
    const params = new URLSearchParams(location.search);
    const initial = variants.find(v => String(v.id) === params.get('waitlist')) ||
      variants.find(v => String(v.sizeCode || v.size).toUpperCase().replace(/\s+/g, '_') === params.get('size')?.toUpperCase()) || variants.find(soldOut) || variants[0];
    const root = document.createElement('details');
    root.id = 'productWaitlist'; root.className = 'restock-panel';
    root.open = variants.some(soldOut) || params.has('waitlist');
    // Only static markup; product-controlled values are assigned as text below.
    root.innerHTML = '<summary>Avísame cuando vuelva</summary><label for="restockSize">Elige la talla para tu aviso</label><select id="restockSize"></select><p class="restock-choice"></p><p class="restock-status" role="status" aria-live="polite"></p><button class="btn" type="button"></button><p class="restock-help">Disponibilidad sujeta a existencias. Este aviso no reserva la prenda.</p>';
    anchor.insertAdjacentElement('afterend', root);
    const select = root.querySelector('select');
    const status = root.querySelector('.restock-status');
    const choice = root.querySelector('.restock-choice');
    const button = root.querySelector('button');
    variants.forEach(v => select.add(new Option(`${label(v.size)} · ${soldOut(v) ? 'Agotada' : 'Disponible'}`, String(v.id))));
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
      choice.textContent = `${product.name} · Talla ${label(variant.size)}`;
      button.textContent = busy ? 'Un momento…' : readFailed ? 'Volver a comprobar' : subscription ? 'Cancelar aviso' : window.CRONOX_USER ? 'Avísame cuando vuelva' : 'Iniciar sesión o registrarme';
      button.disabled = busy || subscription?.status === 'PROCESSING' || (!subscription && !soldOut(variant) && !readFailed);
      select.disabled = busy;
      root.setAttribute('aria-busy', String(busy));
    };
    const showState = () => {
      if (subscription) {
        status.textContent = subscription.status === 'PROCESSING' ? 'Tu aviso ya se está enviando.' :
          subscription.status === 'UNCERTAIN' ? 'Tu aviso tiene una entrega sin confirmar. No lo reenviaremos automáticamente.' :
          subscription.status === 'FAILED' ? 'No pudimos enviar tu aviso. Puedes cancelarlo.' : 'Ya tienes un aviso activado para esta talla.';
      } else status.textContent = !soldOut(selected()) ? 'Esta talla está disponible. Puedes seleccionarla para comprar.' :
        window.CRONOX_USER ? 'Confirma tu aviso. Te avisaremos cuando esta talla vuelva a estar disponible.' : 'Inicia sesión o crea tu cuenta. Al volver tendrás que confirmar el aviso.';
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
      busy = true; status.textContent = cancelling ? 'Cancelando aviso…' : 'Activando aviso…'; render();
      try {
        const result = await request(select.value, cancelling ? 'DELETE' : 'POST');
        if (current !== generation || !root.isConnected) return;
        subscription = result.subscription;
        status.textContent = cancelling ? 'Aviso cancelado.' : result.existing ? 'Ya tienes un aviso activado para esta talla.' : 'Te avisaremos cuando esta talla vuelva a estar disponible.';
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
