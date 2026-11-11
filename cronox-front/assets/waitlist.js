(function () {
  'use strict';
  const label = size => window.CRONOX_SIZES?.label?.(size) || String(size).replace('US_', 'US ');
  const key = size => window.CRONOX_SIZES?.key?.(size) || String(size).toUpperCase().replace(/\s+/g, '_');
  const variants = p => (p?.variants || Object.values(p?.variantMap || {})).filter(v => v.isActive !== false && Number.isSafeInteger(Number(v.id)));
  const unavailable = v => window.CRONOX_STOCK?.productStockStatus([v], null) === 'out_of_stock';
  const storageKey = 'cronox.restock.intent';
  let dialog, product, selectedSize = '', busy = false, generation = 0, returnFocus, pending, pendingFocus;
  const request = async (id, method = 'GET') => {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') Object.assign(headers, await window.CRONOX_API.getCsrfHeaders());
    const response = await fetch(`${window.CRONOX_API.API_BASE || ''}/api/waitlist/${id}`, { method, headers, credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(response.status >= 500 ? 'No se pudo guardar el aviso. La talla se conserva; vuelve a intentarlo.' : typeof data.message === 'string' ? data.message : 'No se pudo guardar el aviso. Vuelve a intentarlo.');
      error.status = response.status; throw error;
    }
    return data;
  };
  const status = text => { dialog.querySelector('[data-restock-status]').textContent = text; };
  const chosen = () => variants(product).find(v => key(v.sizeCode || v.size) === selectedSize);
  function remember(value) {
    pending = value;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch {}
  }
  function controls() {
    dialog.setAttribute('aria-busy', String(busy));
    dialog.querySelectorAll('[data-restock-size]').forEach(button => {
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(button.dataset.restockSize === selectedSize));
    });
    dialog.querySelector('[data-restock-retry]').disabled = busy;
    dialog.querySelector('[data-restock-cancel]').disabled = busy;
  }
  function ensure() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.className = 'restock-dialog';
    dialog.setAttribute('aria-labelledby', 'restockTitle'); dialog.setAttribute('aria-describedby', 'restockPrompt');
    dialog.innerHTML = '<button type="button" class="restock-close" aria-label="Cerrar avisos de reposición">×</button><h2 id="restockTitle"></h2><p id="restockPrompt">Selecciona tu talla para recibir un aviso cuando vuelva</p><div class="restock-sizes" role="group" aria-label="Talla del aviso"></div><p data-restock-status role="status" aria-live="polite"></p><button type="button" data-restock-retry hidden>Reintentar</button><a data-restock-buy hidden>Continuar con la compra</a><p class="restock-help">Este aviso no reserva la prenda.</p>';
    document.body.append(dialog);
    const cancel=document.createElement('button');cancel.type='button';cancel.dataset.restockCancel='';cancel.textContent='Cancelar aviso';cancel.hidden=true;
    dialog.querySelector('[data-restock-retry]').after(cancel);
    cancel.onclick=async()=>{
      if(busy || !chosen())return;
      const current=++generation;busy=true;controls();status('Cancelando aviso…');
      try{await request(chosen().id,'DELETE');if(current!==generation)return;cancel.hidden=true;status('Aviso cancelado.');}
      catch(error){if(current===generation)status(error.message || 'No se pudo cancelar. Vuelve a intentarlo.');}
      finally{if(current===generation){busy=false;controls();}}
    };
    dialog.querySelector('.restock-close').onclick = () => dialog.close();
    dialog.addEventListener('keydown', event => {
      if(event.key !== 'Tab')return;
      const focusable=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')].filter(el=>!el.hidden && el.getClientRects().length);
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => {
      generation++; busy = false; window.CRONOX_unlockScroll?.('restock');
      const fallback=document.querySelector(`.product-card[data-slug="${CSS.escape(product.slug)}"] .product-restock button`) || document.querySelector('#productWaitlist button');
      const target=returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : fallback;
      target?.focus({ preventScroll: true });
    });
    dialog.querySelector('[data-restock-retry]').onclick = () => void subscribe();
  }
  function drawSizes() {
    const sizes = window.CRONOX_SIZES?.sort?.(variants(product).map(v => key(v.sizeCode || v.size))) || variants(product).map(v => key(v.size));
    const host = dialog.querySelector('.restock-sizes'); host.replaceChildren();
    [...new Set(sizes)].forEach(size => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.restockSize = size;
      button.textContent = label(size); button.setAttribute('aria-label', `Avisarme de la talla ${label(size)}`);
      button.onclick = () => { if (busy) return; selectedSize = size; controls(); void subscribe(); };
      host.append(button);
    });
    controls();
  }
  function showAvailable() {
    status('Esta talla ya está disponible. Puedes continuar con la compra.');
    const link = dialog.querySelector('[data-restock-buy]'); link.hidden = false;
    link.href = `/producto/${encodeURIComponent(product.slug)}?size=${encodeURIComponent(selectedSize)}`;
    dialog.querySelector('[data-restock-retry]').hidden = true; remember(null);
  }
  async function subscribe() {
    if (busy || !chosen() || !dialog.open) return;
    const current = ++generation;
    busy = true; controls(); status('Guardando aviso…');
    dialog.querySelector('[data-restock-retry]').hidden = true; dialog.querySelector('[data-restock-buy]').hidden = true;
    dialog.querySelector('[data-restock-cancel]').hidden = true;
    try {
      await window.CRONOX_AUTH_READY;
      if (current !== generation) return;
      if (!window.CRONOX_USER) {
        pendingFocus = returnFocus;
        remember({ slug: product.slug, size: selectedSize, at: Date.now() });
        dialog.close(); await window.CRONOX_openAuthModal('login'); return;
      }
      const requestedAt = performance.now();
      const latest = await window.CRONOX_API.getProductBySlug(product.slug, { cache: 'no-store' });
      if (current !== generation) return;
      product = latest;
      dialog.querySelector('#restockTitle').textContent = latest.name;
      const variant = chosen();
      if (!variant) { drawSizes(); throw new Error('Esta talla ya no pertenece a la ficha actual. Selecciona una talla válida.'); }
      if (!unavailable(variant)) { showAvailable(); return; }
      const result = await request(variant.id, 'POST');
      if (current !== generation) return;
      status(result.existing ? 'Ya tienes un aviso para esta talla' : `Te avisaremos cuando vuelva la talla ${label(selectedSize)}`);
      dialog.querySelector('[data-restock-cancel]').hidden = result.subscription?.status === 'PROCESSING';
      remember(null);
      window.dispatchEvent(new CustomEvent('cronox:productAvailability', { detail: { product: latest, requestedAt } }));
    } catch (error) {
      if (current !== generation) return;
      if (error.status === 409) showAvailable();
      else {
        status(error.status === 401 ? 'Inicia sesión de nuevo para guardar el aviso.' : error.message || 'No se pudo guardar el aviso. Vuelve a intentarlo.');
        if (error.status === 401) window.CRONOX_USER = null;
        dialog.querySelector('[data-restock-retry]').hidden = false;
      }
    } finally { if (current === generation) { busy = false; controls(); } }
  }
  async function open(next, options = {}) {
    ensure(); if (dialog.open && busy) return;
    const current = ++generation;
    product = next; selectedSize = options.size ? key(options.size) : ''; busy = false;
    returnFocus = options.returnFocus || document.activeElement;
    dialog.querySelector('#restockTitle').textContent = product.name;
    dialog.querySelector('[data-restock-retry]').hidden = true; dialog.querySelector('[data-restock-buy]').hidden = true;
    dialog.querySelector('[data-restock-cancel]').hidden = true;
    status(''); drawSizes(); if (!dialog.open) dialog.showModal(); window.CRONOX_lockScroll?.('restock');
    (dialog.querySelector(`[data-restock-size="${CSS.escape(selectedSize)}"]`) || dialog.querySelector('[data-restock-size]'))?.focus();
    if (options.submit && chosen()) { void subscribe(); return; }
    // Read-only on opening: neither visiting nor opening creates a request.
    try {
      await window.CRONOX_AUTH_READY; if (current !== generation || !window.CRONOX_USER) return;
      const states = await Promise.all(variants(product).filter(unavailable).map(async v => ({ size: key(v.sizeCode || v.size), state: await request(v.id) })));
      if (current !== generation) return;
      const subscribed = states.filter(row => row.state.subscription).map(row => label(row.size));
      if (subscribed.length) status(`Ya tienes avisos para: ${subscribed.join(', ')}. Puedes seleccionar otra talla.`);
    } catch { /* Selection revalidates with the server; a failed read never claims success. */ }
  }
  async function resume() {
    if (!window.CRONOX_USER || !pending) return;
    const intent = pending; remember(null);
    try { await open(await window.CRONOX_API.getProductBySlug(intent.slug, { cache: 'no-store' }), { size: intent.size, submit: true, returnFocus: pendingFocus }); pendingFocus=null; }
    catch { remember(intent); }
  }
  window.CRONOX_WAITLIST = {
    open,
    mount(next, anchor, selected = () => '') {
      document.getElementById('productWaitlist')?.remove();
      if (!anchor || !variants(next).some(unavailable)) return;
      const root = document.createElement('div'); root.id = 'productWaitlist'; root.className = 'restock-panel';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Avisarme';
      button.onclick = () => { const size = selected(); const v = variants(next).find(v => key(v.sizeCode || v.size) === key(size)); void open(next, { size: v && unavailable(v) ? size : '', submit: Boolean(v && unavailable(v)) }); };
      root.append(button); anchor.insertAdjacentElement('afterend', root);
    },
  };
  window.addEventListener('cronox:restockOpen', event => void open(event.detail.product, event.detail));
  window.addEventListener('cronox:userChanged', () => void resume());
  try { const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (value && typeof value.slug === 'string' && typeof value.size === 'string' && Date.now() - value.at < 1800000) pending = value; } catch {}
  Promise.resolve(window.CRONOX_AUTH_READY).then(() => resume());
})();
