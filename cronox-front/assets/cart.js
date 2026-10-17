// ======================================================
// assets/cart.js — Carrito conectado a la API de CRONOX
// ======================================================
(function () {
  const API = window.CRONOX_API || {};
  const listEl = document.getElementById('cartItems');
  const emptyEl = listEl ? listEl.querySelector('[data-empty]') : null;
  const subtotalEl = document.getElementById('sumSubtotal');
  const shippingLabelEl = document.getElementById('sumShipping');
  const totalEl = document.getElementById('sumTotal');
  const shippingOptionsEl = document.getElementById('shippingOptions');
  const btnClear = document.getElementById('btnClear');
  const btnCheckout = document.getElementById('btnCheckout');

  const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const money = (cents) => EUR.format((Number(cents) || 0) / 100);
  const escapeHtml = (value) => {
    const helper = window.CRONOX_SECURITY?.escapeHtml;
    return typeof helper === 'function'
      ? helper(value)
      : String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  };
  const safeProductImage = (value, fallback = 'assets/product-image-unavailable.svg') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };

  const Cart = window.CRONOX_CART || null;

  const state = {
    cart: null,
    shippingMethod: 'STANDARD',
    status: 'loading',
    error: null,
    quote: null,
    quoteKey: '',
    quoteRevision: 0,
    quoteLoading: false,
    quoteError: null,
  };
  const statusEl = document.createElement('div');
  statusEl.className = 'cart-status';
  statusEl.setAttribute('role', 'status');
  listEl?.parentElement.before(statusEl);

  const quoteStatus = document.createElement('p');
  quoteStatus.setAttribute('role', 'status');
  quoteStatus.hidden = true;
  shippingOptionsEl?.after(quoteStatus);
  const renderShipping = (methods) => {
    if (!shippingOptionsEl) return;
    const current = Array.from(shippingOptionsEl.querySelectorAll('input')).map(input => input.value);
    if (JSON.stringify(current) !== JSON.stringify(methods.map(method => method.code))) {
      shippingOptionsEl.innerHTML = methods.map(method => `<label class="shipping-option">
        <input type="radio" name="shippingMethod" value="${escapeHtml(method.code)}">
        <div class="shipping-option__info"><span class="shipping-option__label"></span>${method.code === 'STANDARD' ? '<small class="shipping-option__helper">Gratis a partir de 65,00 €</small>' : ''}</div>
        <span class="shipping-option__price" data-code="${escapeHtml(method.code)}"></span>
      </label>`).join('');
    }
    for (const method of methods) {
      const input = Array.from(shippingOptionsEl.querySelectorAll('input')).find(input => input.value === method.code);
      if (!input) continue;
      input.checked = method.code === state.shippingMethod;
      const row = input.closest('label');
      row.querySelector('.shipping-option__label').textContent = method.label;
      const price = row.querySelector('.shipping-option__price');
      price.textContent = money(method.amountCents);
      price.classList.toggle('is-free', method.amountCents === 0);
    }
  };
  const refreshQuote = async () => {
    if (!state.cart?.items?.length || state.status === 'loading' || state.status === 'error' || Cart?.state.pending) return;
    const key = JSON.stringify([state.shippingMethod, state.cart.subtotalCents, state.cart.items.map(item => [item.id, item.qty, item.priceCents])]);
    if (key === state.quoteKey) return;
    state.quoteKey = key;
    const revision = ++state.quoteRevision;
    state.quoteLoading = true;
    state.quoteError = null;
    renderSummary();
    try {
      const quote = await API.getCheckoutSummary({ shippingMethod: state.shippingMethod });
      if (revision !== state.quoteRevision) return;
      state.quote = quote;
      state.shippingMethod = quote.selectedShippingMethod?.code || '';
      state.quoteKey = JSON.stringify([state.shippingMethod, state.cart.subtotalCents, state.cart.items.map(item => [item.id, item.qty, item.priceCents])]);
      renderShipping(quote.shippingMethods || []);
      if (!state.shippingMethod) state.quoteError = 'No hay métodos de envío disponibles.';
    } catch (error) {
      if (revision !== state.quoteRevision) return;
      console.warn('[CRONOX] No se pudo calcular el envío', error);
      state.quote = null;
      state.quoteError = 'No se pudo calcular el envío. Vuelve a intentarlo.';
    } finally {
      if (revision === state.quoteRevision) { state.quoteLoading = false; renderSummary(); }
    }
  };
  const renderSummary = () => {
    const subtotalCents = state.cart?.subtotalCents || 0;
    const hasItems = Boolean(state.cart?.items?.length);
    const verified = hasItems && state.quote && !state.quoteLoading && !state.quoteError;
    const method = state.quote?.selectedShippingMethod;
    subtotalEl && (subtotalEl.textContent = money(subtotalCents));
    shippingLabelEl && (shippingLabelEl.textContent = verified ? `${method.label} · ${money(state.quote.totals.shippingCents)}` : '—');
    totalEl && (totalEl.textContent = verified ? money(state.quote.totals.totalCents) : hasItems ? '—' : money(0));
    const unavailable = !verified || state.status === 'loading' || state.status === 'error' || Boolean(Cart?.state.pending);
    if (btnCheckout) btnCheckout.disabled = unavailable;
    if (btnClear) btnClear.disabled = !hasItems || state.status === 'loading' || Boolean(Cart?.state.pending);
    quoteStatus.replaceChildren();
    quoteStatus.hidden = !hasItems || !state.quoteError;
    if (!quoteStatus.hidden) {
      quoteStatus.append(state.quoteError + ' ');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Reintentar';
      retry.addEventListener('click', () => { state.quoteKey = ''; refreshQuote(); });
      quoteStatus.append(retry);
    }
  };

  const renderEmpty = () => {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.hidden = false;
      listEl.appendChild(emptyEl);
    }
    renderSummary();
  };

  const renderCart = () => {
    if (!listEl) return;
    if (Cart) {
      state.cart = Cart.state.data;
      state.status = Cart.state.status;
      state.error = Cart.state.error;
    }
    if (!state.cart?.items?.length || state.status === 'loading' || Boolean(Cart?.state.pending)) {
      ++state.quoteRevision;
      state.quoteKey = '';
      state.quote = null;
      state.quoteLoading = false;
    }
    void refreshQuote();
    listEl.setAttribute('aria-busy', String(state.status === 'loading'));
    statusEl.classList.toggle('cart-status--initial-loading', state.status === 'loading' && !state.cart);
    statusEl.replaceChildren();
    statusEl.hidden = state.status !== 'loading' && state.status !== 'error';
    if (!statusEl.hidden) {
      const message = document.createElement('p');
      message.textContent = state.status === 'error' ? state.error : state.cart ? 'Actualizando cesta…' : 'Cargando cesta…';
      statusEl.appendChild(message);
      if (state.status === 'error') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Reintentar';
        retry.addEventListener('click', () => syncCart());
        statusEl.appendChild(retry);
      }
    }
    if (!state.cart) {
      listEl.replaceChildren();
      renderSummary();
      return;
    }
    const items = Array.isArray(state.cart.items) ? state.cart.items : [];
    if (!items.length) {
      renderEmpty();
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const itemId = String(item.id ?? '');
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const hasLastUnits = window.CRONOX_STOCK?.hasLastUnits([item.variant], item.product?.lastUnitsThreshold);
      const imageUrl = window.CRONOX_IMAGES?.resolveProduct(item, 'cart')?.src || safeProductImage(item.product?.image || item.product?.imageUrl);
      const display = {
        id: escapeHtml(itemId),
        qty,
        size: item.size ? escapeHtml(window.CRONOX_SIZES?.label?.(item.size) || String(item.size).toUpperCase()) : '',
        priceLabel: escapeHtml(money((item.priceCents || 0) * qty)),
        product: {
          name: escapeHtml(item.product?.name || 'Producto CRONOX'),
        },
      };
      const article = document.createElement('article');
      article.className = 'cart-item';
      article.dataset.id = itemId;
      article.innerHTML = `
        <div class="ci-media">
          <img src="${escapeHtml(imageUrl)}" alt="${display.product.name}" loading="lazy" referrerpolicy="no-referrer">
        </div>
        <div class="ci-info">
          <h3 class="ci-name">${display.product.name}</h3>
          <p class="ci-meta">
            ${display.size ? `<span>Talla: ${display.size}</span>` : ''}
            ${hasLastUnits ? '<span class="cart-low-stock">Últimas unidades</span>' : ''}
          </p>
          <div class="ci-controls">
            <label>Cant.
              <input type="number" class="ci-qty" min="1" value="${display.qty}" data-id="${display.id}" aria-label="Cantidad">
            </label>
            <button class="ci-remove" data-id="${display.id}" type="button">Eliminar</button>
          </div>
        </div>
        <div class="ci-price">
          <span>${display.priceLabel}</span>
        </div>
      `;
      window.CRONOX_IMAGES?.applyProduct(article.querySelector('.ci-media img'), item, 'cart');
      frag.appendChild(article);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
    renderSummary();
  };

  const syncCart = async ({ initial = false } = {}) => {
    state.status = 'loading';
    state.error = null;
    renderCart();
    try {
      if (initial && window.CRONOX_CART_READY) {
        state.cart = await window.CRONOX_CART_READY;
      } else if (Cart?.fetchCart) {
        state.cart = await Cart.fetchCart();
      } else if (API?.getCart) {
        state.cart = await API.getCart();
      } else {
        throw new Error('CART_API_UNAVAILABLE');
      }
      state.status = state.cart?.items?.length ? 'populated' : 'empty';
    } catch (error) {
      console.warn('[CRONOX] Error cargando el carrito', error);
      state.status = 'error';
      state.error = 'No se pudo cargar la cesta. Vuelve a intentarlo.';
    }
    renderCart();
  };

  const handleQtyChange = async (input) => {
    const itemId = Number(input.dataset.id);
    const qty = Math.max(1, Number(input.value) || 1);
    input.value = String(qty);
    try {
      if (Cart?.updateCartItem) state.cart = await Cart.updateCartItem(itemId, qty);
      else state.cart = await API.updateCartItem(itemId, qty);
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo actualizar la cantidad', error);
      state.status = 'error';
      state.error = 'No se pudo actualizar la cantidad. Vuelve a intentarlo.';
      renderCart();
    }
  };

  const handleRemove = async (button) => {
    const itemId = Number(button.dataset.id);
    try {
      if (Cart?.removeCartItem) state.cart = await Cart.removeCartItem(itemId);
      else state.cart = await API.removeCartItem(itemId);
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo eliminar el artículo', error);
      state.status = 'error';
      state.error = 'No se pudo eliminar el artículo. Vuelve a intentarlo.';
      renderCart();
    }
  };

  const clearCart = async () => {
    try {
      if (Cart?.clearCartItems) state.cart = await Cart.clearCartItems();
      else state.cart = await API.clearCart();
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo vaciar el carrito', error);
      state.status = 'error';
      state.error = 'No se pudo vaciar la cesta. Vuelve a intentarlo.';
      renderCart();
    }
  };

  listEl?.addEventListener('change', (event) => {
    const input = event.target.closest('.ci-qty');
    if (!input) return;
    handleQtyChange(input);
  });

  listEl?.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.ci-remove');
    if (removeBtn) {
      event.preventDefault();
      handleRemove(removeBtn);
    }
  });

  btnClear?.addEventListener('click', () => {
    if (confirm('¿Vaciar tu cesta?')) {
      clearCart();
    }
  });

  shippingOptionsEl?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="shippingMethod"]');
    if (!input) return;
    state.shippingMethod = input.value === 'EXPRESS' ? 'EXPRESS' : 'STANDARD';
    void refreshQuote();
  });

  btnCheckout?.addEventListener('click', () => {
    if (btnCheckout.disabled) return;
    window.location.href = '/checkout';
  });

  const init = () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
    state.shippingMethod = shippingOptionsEl?.querySelector('input:checked')?.value === 'EXPRESS'
      ? 'EXPRESS' : 'STANDARD';
    syncCart({ initial: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.addEventListener('cart:state', renderCart);

  window.addEventListener('cart:updated', (event) => {
    const cart = event?.detail;
    if (cart && cart.items) {
      state.cart = cart;
      renderCart();
    }
  });
})();
