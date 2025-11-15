// ======================================================
// assets/cart-badge.js — contador de carrito en topbar
// ======================================================
(function () {
  const API = window.CRONOX_API || {};
  const KEY = 'cronox_cart';

  const readFallbackCount = () => {
    try {
      const raw = localStorage.getItem(KEY);
      const items = raw ? JSON.parse(raw) : [];
      return Array.isArray(items)
        ? items.reduce((n, it) => n + (Number(it.qty) || 0), 0)
        : 0;
    } catch {
      return 0;
    }
  };

  function updateBagVisual(hasItems) {
    document.querySelectorAll('.topbar__cart .icon-bag').forEach(icon => {
      if (hasItems) {
        icon.classList.add('has-items');
      } else {
        icon.classList.remove('has-items');
      }
    });
  }

  const render = (count) => {
    const value = Number.isFinite(count) ? count : readFallbackCount();
    document.querySelectorAll('.cart-count').forEach(el => {
      if (value > 0) {
        el.textContent = String(value);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
    updateBagVisual(value > 0);
  };

  const refreshFromApi = async () => {
    if (!API || typeof API.getCart !== 'function') {
      render(readFallbackCount());
      return;
    }
    try {
      const cart = await API.getCart();
      render(cart?.itemsCount ?? 0);
    } catch (error) {
      console.warn('[CRONOX] No se pudo refrescar el badge del carrito', error);
      render(readFallbackCount());
    }
  };

  window.addEventListener('cart:updated', (event) => {
    const cart = event?.detail;
    if (cart && typeof cart.itemsCount === 'number') {
      render(cart.itemsCount);
    } else {
      refreshFromApi();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    refreshFromApi();
  });

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      render(readFallbackCount());
    }
  });
})();
