// ======================================================
// assets/product-page.js — Página de producto + Añadir al carrito
// ======================================================
(function () {
  const container = document.getElementById("productContainer");
  const notFound = document.getElementById("productNotFound");

  // Productos actuales (los mismos que en assets/products.js)
  const PRODUCTS = [
    {
      id: "camiseta-washed-gris",
      name: "Camiseta Washed Gris",
      price: 49,
      priceLabel: "49 €",
      image: "assets/products/camiseta_washed_gris.png",
      sizes: ["s", "m", "l", "xl"],
      color: "gris",
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave."
    },
    {
      id: "camiseta-washed-negra",
      name: "Camiseta Washed Negra",
      price: 49,
      priceLabel: "49 €",
      image: "assets/products/camiseta_washed_negra.png",
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];

  function getId() {
    const url = new URL(window.location);
    return url.searchParams.get("id") || "";
  }

  function money(n) {
    try { return (n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' }); }
    catch { return `${n} €`; }
  }

  function render(p) {
    if (!container) return;

    const sizeChips = Array.isArray(p.sizes) && p.sizes.length
      ? `
        <div style="margin:10px 0 16px;">
          <div style="font:600 13px/1 system-ui;margin:0 0 8px;color:#fff;">Tallas</div>
          <div id="sizeGroup" style="display:flex;gap:8px;flex-wrap:wrap;">
            ${p.sizes.map(s => `
              <button type="button" class="size-chip" data-size="${s}"
                style="border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:10px 12px;background:transparent;color:#fff;font:700 12px/1 system-ui;cursor:pointer;">
                ${s.toUpperCase()}
              </button>`).join("")}
          </div>
        </div>
      ` : "";

    container.innerHTML = `
      <article class="product-page" style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div class="product-page__media" style="background:#000;display:grid;place-items:center;padding:12px;">
          <img src="${p.image}" alt="${p.name}" style="width:100%;height:auto;max-height:72vh;object-fit:contain;" />
        </div>
        <div class="product-page__body" style="padding:6px 4px;">
          <h1 style="font:800 24px/1.2 system-ui;margin:0 0 8px;color:#fff;">${p.name}</h1>
          <p style="font:700 18px/1 system-ui;margin:0 0 12px;color:#e0e0e0;">${p.priceLabel || money(p.price)}</p>
          <p style="font:400 14px/1.6 system-ui;color:#cfcfcf;margin:0 0 16px;">${p.desc || ""}</p>
          ${sizeChips}
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button id="btnAddToCart"
              style="background:#fff;color:#000;border:none;border-radius:10px;padding:12px 16px;font:800 13px/1 system-ui;cursor:pointer;">
              Añadir al carrito
            </button>
            <a href="index.html#store"
              style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:12px 16px;font:800 13px/1 system-ui;text-decoration:none;">
              Seguir comprando
            </a>
          </div>
          <p id="addMsg" style="margin-top:12px;color:#9fe29f;display:none;">Añadido al carrito ✓</p>
        </div>
      </article>
    `;

    // selección de talla
    let selectedSize = null;
    const group = document.getElementById('sizeGroup');
    if (group) {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('.size-chip');
        if (!btn) return;
        selectedSize = btn.dataset.size || null;
        // visual
        Array.from(group.querySelectorAll('.size-chip')).forEach(b => {
          b.style.background = 'transparent';
          b.style.borderColor = 'rgba(255,255,255,.18)';
        });
        btn.style.background = '#fff';
        btn.style.color = '#000';
        btn.style.borderColor = '#fff';
      });
    }

    // añadir al carrito
    document.getElementById('btnAddToCart')?.addEventListener('click', () => {
      if (Array.isArray(p.sizes) && p.sizes.length && !selectedSize) {
        alert('Selecciona una talla antes de añadir al carrito.');
        return;
      }
      const item = {
        id: p.id,
        name: p.name,
        price: p.price,
        priceLabel: p.priceLabel || money(p.price),
        image: p.image,
        size: selectedSize || null,
        qty: 1
      };
      addToCart(item);
      const msg = document.getElementById('addMsg');
      if (msg) { msg.style.display = 'block'; setTimeout(()=> msg.style.display='none', 1500); }
    });

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  function addToCart(item) {
    try {
      const KEY = 'cronox_cart';
      const raw = localStorage.getItem(KEY);
      const cart = raw ? JSON.parse(raw) : [];
      // si mismo id + talla → sumar cantidad
      const idx = cart.findIndex(x => x.id === item.id && x.size === item.size);
      if (idx >= 0) {
        cart[idx].qty += item.qty;
      } else {
        cart.push(item);
      }
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch (e) {
      console.error('No se pudo guardar en carrito:', e);
      alert('No se pudo guardar el carrito en este navegador.');
    }
  }

  function init() {
    const id = getId();
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) {
      if (notFound) notFound.hidden = false;
      return;
    }
    render(p);
  }

  init();
})();
