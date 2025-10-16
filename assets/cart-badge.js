// ======================================================
// assets/cart-badge.js — contador de carrito en topbar
// ======================================================
(function () {
  const KEY = 'cronox_cart';

  function readCount() {
    try {
      const raw = localStorage.getItem(KEY);
      const items = raw ? JSON.parse(raw) : [];
      return items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
    } catch { return 0; }
  }

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
  }

  // Refrescar cuando algo cambie el carrito:
  window.addEventListener('cart:updated', render);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) render();   // cambios desde otra pestaña
  });
  document.addEventListener('DOMContentLoaded', render);
})();
