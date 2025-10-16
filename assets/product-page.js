// ======================================================
// assets/product-page.js — Página individual de producto (solo dos camisetas actuales)
// ======================================================
(function () {
  const container = document.getElementById("productContainer");
  const notFound = document.getElementById("productNotFound");

  // Tus productos actuales (idénticos a los del products.js)
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

  function render(p) {
    if (!container) return;
    container.innerHTML = `
      <article class="product-page" style="max-width:1200px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div class="product-page__media" style="background:#000;display:grid;place-items:center;padding:12px;">
          <img src="${p.image}" alt="${p.name}" style="width:100%;height:auto;max-height:72vh;object-fit:contain;" />
        </div>
        <div class="product-page__body" style="padding:6px 4px;">
          <h1 style="font:800 24px/1.2 system-ui;margin:0 0 8px;color:#fff;">${p.name}</h1>
          <p style="font:700 18px/1 system-ui;margin:0 0 12px;color:#e0e0e0;">${p.priceLabel}</p>
          <p style="font:400 14px/1.6 system-ui;color:#cfcfcf;margin:0 0 16px;">${p.desc}</p>

          <div style="margin:10px 0 16px;">
            <div style="font:600 13px/1 system-ui;margin:0 0 8px;color:#fff;">Tallas</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${p.sizes.map(s => `<button type="button" style="border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;background:transparent;color:#fff;font:700 12px/1 system-ui;cursor:pointer;">${s.toUpperCase()}</button>`).join("")}
            </div>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button style="background:#fff;color:#000;border:none;border-radius:10px;padding:12px 16px;font:800 13px/1 system-ui;cursor:pointer;">Añadir al carrito</button>
            <a href="index.html#store" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:12px 16px;font:800 13px/1 system-ui;text-decoration:none;">Seguir comprando</a>
          </div>
        </div>
      </article>
    `;

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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
