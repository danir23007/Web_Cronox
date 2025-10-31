// ======================================================
// assets/cart-badge.js — contador de carrito en topbar
// ======================================================
(function () {
  const KEY = 'cronox_cart';

  // === Lee cantidad total del carrito desde localStorage ===
  function readCount() {
    try {
      const raw = localStorage.getItem(KEY);
      const items = raw ? JSON.parse(raw) : [];
      return items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
    } catch {
      return 0;
    }
  }

  // === Aplica cambios visuales al icono de bolsa ===
  function updateBagVisual(hasItems) {
    document.querySelectorAll('.topbar__cart .icon-bag').forEach(icon => {
      if (hasItems) {
        icon.classList.add('has-items');
      } else {
        icon.classList.remove('has-items');
      }
    });
  }

  // === Actualiza número en el badge y estilo ===
  function render() {
    const n = readCount();
    document.querySelectorAll('.cart-count').forEach(el => {
      if (n > 0) {
        el.textContent = String(n);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
    updateBagVisual(n > 0);
  }

  // === Escucha cambios en tiempo real ===
  window.addEventListener('cart:updated', render);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) render();
  });
  document.addEventListener('DOMContentLoaded', render);
})();
