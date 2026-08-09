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
  const safeProductImage = (value, fallback = 'assets/logo_banner.png') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };

  const FREE_SHIPPING_THRESHOLD = 6500;
  const STANDARD_SHIPPING = 295;
  const EXPRESS_SHIPPING = 495;

  const SHIPPING_OPTIONS = [
    { code: 'STANDARD', label: 'Envío estándar (2,95€)', helper: 'Gratis a partir de 65€' },
    { code: 'EXPRESS', label: 'Envío express (4,95€)' },
  ];

  const Cart = window.CRONOX_CART || null;

  const state = {
    cart: null,
    shippingMethod: 'STANDARD',
  };

  const calculateShipping = (itemsTotal, method) => {
    if (method === 'EXPRESS') return EXPRESS_SHIPPING;
    if (itemsTotal >= FREE_SHIPPING_THRESHOLD) return 0;
    return STANDARD_SHIPPING;
  };


  const renderShippingOptions = () => {
    if (!shippingOptionsEl) return;
    shippingOptionsEl.innerHTML = '';

    SHIPPING_OPTIONS.forEach((option) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'shipping-option';
      wrapper.innerHTML = `
        <input type="radio" name="shippingMethod" value="${option.code}" ${
          option.code === state.shippingMethod ? 'checked' : ''
        }>
        <div class="shipping-option__info">
          <span class="shipping-option__label">${option.label}</span>
          ${option.helper ? `<small class="shipping-option__helper">${option.helper}</small>` : ''}
        </div>
        <span class="shipping-option__price" data-code="${option.code}"></span>
      `;
      shippingOptionsEl.appendChild(wrapper);
    });
  };

  const renderSummary = () => {
    const subtotalCents = state.cart?.subtotalCents || 0;
    const shippingCents = state.cart
      ? calculateShipping(subtotalCents, state.shippingMethod)
      : 0;
    const isFree = shippingCents === 0 && state.shippingMethod === 'STANDARD';
    const shippingLabel = isFree
      ? 'Gratis (envío estándar)'
      : `${state.shippingMethod === 'EXPRESS' ? 'Envío express' : 'Envío estándar'} · ${money(
          shippingCents,
        )}`;

    subtotalEl && (subtotalEl.textContent = money(subtotalCents));
    shippingLabelEl && (shippingLabelEl.textContent = state.cart ? shippingLabel : '—');
    totalEl && (totalEl.textContent = money((state.cart ? subtotalCents : 0) + shippingCents));

    if (shippingOptionsEl) {
      shippingOptionsEl.querySelectorAll('.shipping-option__price').forEach((priceEl) => {
        const code = priceEl.getAttribute('data-code');
        if (code === 'STANDARD') {
          const cost = calculateShipping(subtotalCents, 'STANDARD');
          priceEl.textContent = money(cost);
          priceEl.classList.toggle('is-free', cost === 0);
        } else if (code === 'EXPRESS') {
          priceEl.textContent = money(EXPRESS_SHIPPING);
          priceEl.classList.remove('is-free');
        }
      });
    }
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
      const itemId = String(item.id ?? '');
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const imageUrl = safeProductImage(item.product?.image || item.product?.imageUrl);
      const display = {
        id: escapeHtml(itemId),
        qty,
        size: item.size ? escapeHtml(String(item.size).toUpperCase()) : '',
        priceLabel: escapeHtml(item.priceLabel || money(item.priceCents || 0)),
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
      frag.appendChild(article);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
    renderSummary();
  };

  const syncCart = async () => {
    try {
      if (Cart?.fetchCart) {
        state.cart = await Cart.fetchCart();
      } else if (API?.getCart) {
        state.cart = await API.getCart();
      } else {
        state.cart = { items: [], subtotalCents: 0, itemsCount: 0 };
      }
    } catch (error) {
      console.warn('[CRONOX] Error cargando el carrito', error);
      state.cart = { items: [], subtotalCents: 0, itemsCount: 0 };
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
      await syncCart();
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
      await syncCart();
    }
  };

  const clearCart = async () => {
    try {
      if (Cart?.clearCartItems) state.cart = await Cart.clearCartItems();
      else state.cart = await API.clearCart();
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

  shippingOptionsEl?.addEventListener('change', (event) => {
    const input = event.target.closest('input[name="shippingMethod"]');
    if (!input) return;
    state.shippingMethod = input.value === 'EXPRESS' ? 'EXPRESS' : 'STANDARD';
    renderSummary();
  });

  btnCheckout?.addEventListener('click', () => {
    window.location.href = '/checkout.html';
  });

  document.addEventListener('DOMContentLoaded', () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
    renderShippingOptions();
    syncCart();
  });

  window.addEventListener('cart:updated', (event) => {
    const cart = event?.detail;
    if (cart && cart.items) {
      state.cart = cart;
      renderCart();
    }
  });
})();
