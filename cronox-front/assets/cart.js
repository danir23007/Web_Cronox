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
  const btnClear = document.getElementById('btnClear');
  const btnCheckout = document.getElementById('btnCheckout');
  const shippingSelect = document.getElementById('shippingMethod');
  const shippingPriceEl = document.getElementById('shippingPrice');

  const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const money = (cents) => EUR.format((Number(cents) || 0) / 100);

  const fallbackKey = 'cronox_cart';
  const readFallback = () => {
    try {
      const raw = localStorage.getItem(fallbackKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const state = {
    cart: null,
    shippingMethods: [],
    shippingMethodId: null,
  };

  const mapFallbackCart = () => {
    const items = readFallback();
    const mapped = items.map((item, idx) => ({
      id: idx + 1,
      variantId: item.variantId,
      qty: Number(item.qty) || 1,
      priceCents: Math.round((Number(item.price) || 0) * 100),
      priceLabel: item.priceLabel || money(Math.round((Number(item.price) || 0) * 100)),
      size: item.size,
      product: {
        name: item.name,
        image: item.image,
      },
    }));
    const subtotal = mapped.reduce((acc, it) => acc + (it.priceCents || 0) * it.qty, 0);
    return {
      items: mapped,
      subtotalCents: subtotal,
      itemsCount: mapped.reduce((acc, it) => acc + (Number(it.qty) || 0), 0),
      currency: 'EUR',
    };
  };

  const selectShipping = (methods) => {
    if (!Array.isArray(methods) || !methods.length) {
      state.shippingMethodId = null;
      return;
    }
    if (state.shippingMethodId && methods.some((m) => m.id === state.shippingMethodId)) {
      return;
    }
    state.shippingMethodId = methods[0].id;
  };

  const renderShippingOptions = () => {
    if (!shippingSelect) return;
    shippingSelect.innerHTML = '';
    state.shippingMethods.forEach((method) => {
      const option = document.createElement('option');
      option.value = String(method.id);
      option.textContent = `${method.name} · ${method.priceLabel || money(method.priceCents || 0)}`;
      option.selected = method.id === state.shippingMethodId;
      shippingSelect.appendChild(option);
    });
    if (shippingPriceEl) {
      const selected = state.shippingMethods.find((m) => m.id === state.shippingMethodId);
      shippingPriceEl.textContent = selected?.priceLabel || '—';
    }
  };

  const renderSummary = () => {
    if (!state.cart) {
      subtotalEl && (subtotalEl.textContent = money(0));
      totalEl && (totalEl.textContent = money(0));
      shippingLabelEl && (shippingLabelEl.textContent = 'Calculado en checkout');
      return;
    }
    subtotalEl && (subtotalEl.textContent = money(state.cart.subtotalCents || 0));
    const shipping = state.shippingMethods.find((m) => m.id === state.shippingMethodId);
    const shippingCents = shipping ? shipping.priceCents : 0;
    if (shippingLabelEl) {
      shippingLabelEl.textContent = shipping
        ? `${shipping.name} · ${shipping.priceLabel || money(shippingCents)}`
        : 'Selecciona método';
    }
    totalEl && (totalEl.textContent = money((state.cart.subtotalCents || 0) + shippingCents));
  };

  const renderEmpty = () => {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    renderSummary();
  };

  const renderCart = () => {
    if (!listEl) return;
    if (!state.cart) {
      renderEmpty();
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
      const article = document.createElement('article');
      article.className = 'cart-item';
      article.dataset.id = String(item.id);
      article.innerHTML = `
        <div class="ci-media">
          <img src="${item.product?.image || 'assets/logo_banner.png'}" alt="${item.product?.name || ''}" loading="lazy">
        </div>
        <div class="ci-info">
          <h3 class="ci-name">${item.product?.name || 'Producto CRONOX'}</h3>
          <p class="ci-meta">
            ${item.size ? `<span>Talla: ${String(item.size).toUpperCase()}</span>` : ''}
          </p>
          <div class="ci-controls">
            <label>Cant.
              <input type="number" class="ci-qty" min="1" value="${item.qty}" data-id="${item.id}" aria-label="Cantidad">
            </label>
            <button class="ci-remove" data-id="${item.id}" type="button">Eliminar</button>
          </div>
        </div>
        <div class="ci-price">
          <span>${item.priceLabel || money(item.priceCents || 0)}</span>
        </div>
      `;
      frag.appendChild(article);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
    renderSummary();
  };

  const syncCart = async () => {
    if (!API || typeof API.getCart !== 'function') {
      state.cart = mapFallbackCart();
      renderCart();
      return;
    }
    try {
      state.cart = await API.getCart();
    } catch (error) {
      console.warn('[CRONOX] Error cargando el carrito', error);
      state.cart = mapFallbackCart();
    }
    renderCart();
  };

  const syncShippingMethods = async () => {
    if (!API || typeof API.getShippingMethods !== 'function') {
      state.shippingMethods = [];
      state.shippingMethodId = null;
      renderSummary();
      return;
    }
    try {
      state.shippingMethods = await API.getShippingMethods();
      selectShipping(state.shippingMethods);
      renderShippingOptions();
      renderSummary();
    } catch (error) {
      console.warn('[CRONOX] Error cargando métodos de envío', error);
      state.shippingMethods = [];
      state.shippingMethodId = null;
      renderSummary();
    }
  };

  const handleQtyChange = async (input) => {
    const itemId = Number(input.dataset.id);
    const qty = Math.max(1, Number(input.value) || 1);
    input.value = String(qty);

    if (!API || typeof API.updateCartItem !== 'function') {
      const fallback = readFallback();
      if (fallback[itemId - 1]) {
        fallback[itemId - 1].qty = qty;
        try { localStorage.setItem(fallbackKey, JSON.stringify(fallback)); } catch {}
      }
      state.cart = mapFallbackCart();
      renderCart();
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: state.cart }));
      return;
    }

    try {
      state.cart = await API.updateCartItem(itemId, qty);
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo actualizar la cantidad', error);
      await syncCart();
    }
  };

  const handleRemove = async (button) => {
    const itemId = Number(button.dataset.id);
    if (!API || typeof API.removeCartItem !== 'function') {
      const fallback = readFallback();
      fallback.splice(itemId - 1, 1);
      try { localStorage.setItem(fallbackKey, JSON.stringify(fallback)); } catch {}
      state.cart = mapFallbackCart();
      renderCart();
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: state.cart }));
      return;
    }

    try {
      state.cart = await API.removeCartItem(itemId);
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo eliminar el artículo', error);
      await syncCart();
    }
  };

  const clearCart = async () => {
    if (!API || typeof API.clearCart !== 'function') {
      try { localStorage.removeItem(fallbackKey); } catch {}
      state.cart = mapFallbackCart();
      renderCart();
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: state.cart }));
      return;
    }
    try {
      state.cart = await API.clearCart();
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo vaciar el carrito', error);
    }
  };

  listEl?.addEventListener('input', (event) => {
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
    if (confirm('¿Vaciar tu carrito?')) {
      clearCart();
    }
  });

  shippingSelect?.addEventListener('change', (event) => {
    const value = Number(event.target.value);
    state.shippingMethodId = Number.isFinite(value) ? value : null;
    renderShippingOptions();
    renderSummary();
  });

  btnCheckout?.addEventListener('click', () => {
    alert('Para completar la compra inicia sesión y finaliza el pago desde el backend de CRONOX.');
  });

  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
    syncCart();
    syncShippingMethods();
  });

  window.addEventListener('cart:updated', (event) => {
    const cart = event?.detail;
    if (cart && cart.items) {
      state.cart = cart;
      renderCart();
    }
  });
})();
