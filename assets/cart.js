// ======================================================
// assets/cart.js — Listado y control del carrito (localStorage)
// ======================================================
(function () {
  const KEY = 'cronox_cart';
  const listEl = document.getElementById('cartList');
  const emptyEl = document.getElementById('cartEmpty');
  const subtotalEl = document.getElementById('subtotal');
  const btnClear = document.getElementById('btnClear');
  const btnCheckout = document.getElementById('btnCheckout');

  function money(n) {
    try { return (n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }); }
    catch { return `${n} €`; }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function save(cart) {
    localStorage.setItem(KEY, JSON.stringify(cart));
  }

  function calcSubtotal(cart) {
    return cart.reduce((acc, it) => acc + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
    }

  function render() {
    const cart = load();
    if (!cart.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      subtotalEl.textContent = money(0);
      return;
    }
    emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    cart.forEach((it, idx) => {
      const row = document.createElement('div');
      row.style.cssText = "display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:#0b0b0b;";

      row.innerHTML = `
        <div style="background:#000;width:96px;height:96px;display:grid;place-items:center;border-radius:8px;overflow:hidden;">
          <img src="${it.image}" alt="${it.name}" style="max-width:100%;max-height:100%;object-fit:contain;">
        </div>
        <div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <strong style="font:700 14px/1.2 system-ui;">${it.name}</strong>
            ${it.size ? `<span style="font:700 11px/1 system-ui;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px 8px;color:#fff;">Talla ${it.size.toUpperCase()}</span>` : ""}
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
            <button class="qty" data-action="dec" data-idx="${idx}" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;">−</button>
            <span style="min-width:28px;text-align:center;">${it.qty}</span>
            <button class="qty" data-action="inc" data-idx="${idx}" style="width:28px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;cursor:pointer;">+</button>
            <button class="remove" data-idx="${idx}" style="margin-left:12px;border:none;background:transparent;color:#f19999;cursor:pointer;">Eliminar</button>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font:700 14px/1 system-ui;">${money((Number(it.price)||0)* (Number(it.qty)||0))}</div>
          <div style="color:#9a9a9a;font:12px/1.2 system-ui;margin-top:4px;">${money(it.price)} c/u</div>
        </div>
      `;
      frag.appendChild(row);
    });

    listEl.innerHTML = "";
    listEl.appendChild(frag);
    subtotalEl.textContent = money(calcSubtotal(cart));
  }

  // Delegación de eventos para +, -, eliminar
  document.addEventListener('click', (e) => {
    const qbtn = e.target.closest('.qty');
    const rbtn = e.target.closest('.remove');
    if (!qbtn && !rbtn) return;

    const cart = load();

    if (qbtn) {
      const idx = Number(qbtn.dataset.idx);
      const action = qbtn.dataset.action;
      if (!isNaN(idx) && cart[idx]) {
        if (action === 'inc') cart[idx].qty += 1;
        if (action === 'dec') cart[idx].qty = Math.max(1, (cart[idx].qty || 1) - 1);
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

  btnClear?.addEventListener('click', () => {
    if (confirm('¿Vaciar tu carrito?')) {
      save([]);
      render();
    }
  });

  btnCheckout?.addEventListener('click', () => {
    alert('Checkout de ejemplo: aquí integraríamos tu TPV o Shopify cuando lo tengas.');
  });

  // init
  render();
})();
