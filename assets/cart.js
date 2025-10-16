// ======================================================
// assets/cart.js — Listado y control del carrito (localStorage)
// CRONOX
// ======================================================
(function () {
  const KEY = 'cronox_cart';

  // ---- Nodos
  const listEl     = document.getElementById('cartList');
  const emptyEl    = document.getElementById('cartEmpty');
  const subtotalEl = document.getElementById('subtotal');
  const btnClear   = document.getElementById('btnClear');
  const btnCheckout= document.getElementById('btnCheckout');

  // ---- Formateo €
  const EUR_FMT = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const money = (n) => EUR_FMT.format(Number(n) || 0);

  // ---- Storage helpers
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : [];
      // saneado mínimo
      return Array.isArray(data) ? data.map(it => ({
        id: it.id,
        name: String(it.name || ''),
        price: Number(it.price) || 0,
        priceLabel: it.priceLabel || money(it.price),
        image: String(it.image || ''),
        size: it.size || null,
        qty: Math.max(1, Number(it.qty) || 1),
      })) : [];
    } catch {
      return [];
    }
  }
  function save(cart) {
    localStorage.setItem(KEY, JSON.stringify(cart));
    // notificar a la burbuja
    window.dispatchEvent(new Event('cart:updated'));
  }

  // ---- Cálculo
  function calcSubtotal(cart) {
    const sum = cart.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    return Math.round(sum * 100) / 100; // 2 decimales
  }

  // ---- Render
  function render() {
    const cart = load();

    if (!cart.length) {
      if (listEl) listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      if (subtotalEl) subtotalEl.textContent = money(0);
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    const frag = document.createDocumentFragment();

    cart.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.style.cssText = `
        display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center;
        border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:#0b0b0b;
      `;

      row.innerHTML = `
        <div style="background:#000;width:96px;height:96px;display:grid;place-items:center;border-radius:8px;overflow:hidden;">
          <img src="${it.image}" alt="${escapeHtml(it.name)}" style="max-width:100%;max-height:100%;object-fit:contain;">
        </div>
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <strong style="font:700 14px/1.2 system-ui;">${escapeHtml(it.name)}</strong>
            ${it.size ? `<span style="font:700 11px/1 system-ui;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px 8px;color:#fff;">Talla ${escapeHtml(String(it.size).toUpperCase())}</span>` : ''}
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <button class="qty" data-action="dec" data-idx="${idx}" aria-label="Reducir cantidad" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;">−</button>
            <span style="min-width:28px;text-align:center;">${it.qty}</span>
            <button class="qty" data-action="inc" data-idx="${idx}" aria-label="Aumentar cantidad" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;">+</button>
            <button class="remove" data-idx="${idx}" style="margin-left:12px;border:none;background:transparent;color:#f19999;cursor:pointer;">Eliminar</button>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font:700 14px/1 system-ui;">${money(it.price * it.qty)}</div>
          <div style="color:#9a9a9a;font:12px/1.2 system-ui;margin-top:4px;">${money(it.price)} c/u</div>
        </div>
      `;
      frag.appendChild(row);
    });

    if (listEl) {
      listEl.innerHTML = '';
      listEl.appendChild(frag);
    }
    if (subtotalEl) subtotalEl.textContent = money(calcSubtotal(cart));
  }

  // ---- Escapador mínimo para nombres
  function escapeHtml(s) {
    return String(s)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  // ---- Interacciones (+, −, eliminar)
  document.addEventListener('click', (e) => {
    const qbtn = e.target.closest('.qty');
    const rbtn = e.target.closest('.remove');
    if (!qbtn && !rbtn) return;

    const cart = load();

    if (qbtn) {
      const idx = Number(qbtn.dataset.idx);
      const action = qbtn.dataset.action;
      if (!isNaN(idx) && cart[idx]) {
        if (action === 'inc') cart[idx].qty = (Number(cart[idx].qty) || 0) + 1;
        if (action === 'dec') cart[idx].qty = Math.max(1, (Number(cart[idx].qty) || 1) - 1);
        save(cart);
        render();
      }
    }

    if (rbtn) {
      const idx = Number(rbtn.dataset.idx);
      if (!isNaN(idx)) {
        cart.splice(idx, 1);
        save(cart);
        render();
      }
    }
  });

  // ---- Vaciar & Checkout
  btnClear?.addEventListener('click', () => {
    if (confirm('¿Vaciar tu carrito?')) {
      save([]);
      render();
    }
  });

  btnCheckout?.addEventListener('click', () => {
    const cart = load();
    if (!cart.length) {
      alert('Tu carrito está vacío.');
      return;
    }
    // Aquí integrarías tu checkout real (TPV/Shopify/etc.)
    alert('Checkout de ejemplo: integraremos tu pago aquí.');
  });

  // ---- Re-render cuando cambie en otra pestaña
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) render();
  });

  // ---- Init
  render();
})();
