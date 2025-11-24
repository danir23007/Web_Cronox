// ======================================================
// assets/cart-badge.js — contador de carrito en topbar
// ======================================================
(function () {
  const API = window.CRONOX_API || {};
  const Cart = window.CRONOX_CART || null;

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
    const value = Number.isFinite(count) ? count : 0;
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
    try {
      if (Cart?.fetchCart) {
        const cart = await Cart.fetchCart();
        render(cart?.itemsCount ?? 0);
        return;
      }
      if (API?.getCart) {
        const cart = await API.getCart();
        render(cart?.itemsCount ?? 0);
        return;
      }
    } catch (error) {
      console.warn('[CRONOX] No se pudo refrescar el badge del carrito', error);
    }
    render(0);
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
})();
