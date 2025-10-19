// ======================================================
// assets/products.js — Grid + filtros + enlaces a PDP + Quick-Add (+)
// + scroll exacto al volver (back) y foco en última vista
// + mini-galería en cards con flechas < y >
// (v3)
// ======================================================
(function () {
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");
  const filtersForm = document.getElementById("filtersForm");
  const btnClearFilters = document.getElementById("btnClearFilters");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");

  const RETURN_KEY = "cronox_scroll_to";
  const SCROLL_POS_KEY = "cronox_scroll_pos";

  try { history.scrollRestoration = "manual"; } catch {}

  const norm = (s) =>
    (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  function euros(n){
    return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n);
  }

  // === Catálogo (usa 'image' + 'images' (frente/espalda) ) ===
  const PRODUCTS = [
    {
      id: "camiseta-washed-gris",
      name: "Camiseta Washed Gris",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      images: [
        "assets/products/camiseta_washed_gris.png",
        "assets/products/camiseta_washed_gris_2.png"
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl"],
      color: "gris",
      colors: ["gris"],
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave."
    },
    {
      id: "camiseta-washed-negra",
      name: "Camiseta Washed Negra",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_negra.png",
      images: [
        "assets/products/camiseta_washed_negra.png",
        "assets/products/camiseta_washed_negra_2.png"
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      colors: ["negro"],
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];
  window.CRONOX_PRODUCTS = PRODUCTS; // para PDP

  // ---- Búsqueda inicial (?q=) ----
  const url = new URL(window.location);
  const initialQueryRaw  = url.searchParams.get("q") || "";
  if (searchInput && initialQueryRaw) searchInput.value = initialQueryRaw;

  // ======================================================
  // Quick-Add DOM (panel blanco, orden vertical)
  // ======================================================
  let qaOverlay, qaPanel, qaClose, qaImg1, qaImg2, qaName, qaPrice, qaColor, qaSize, qaQty, qaAdd, qaLink;
  let qaCurrentProduct = null;

  function ensureQuickAddDOM() {
    if (qaOverlay) return;

    qaOverlay = document.createElement("div");
    qaOverlay.className = "qa-overlay";
    qaOverlay.id = "quickAdd";
    qaOverlay.setAttribute("aria-hidden", "true");
    qaOverlay.innerHTML = `
      <div class="qa-panel" role="dialog" aria-modal="true">
        <button class="qa-close" aria-label="Cerrar">×</button>

        <!-- 1) Fotos arriba -->
        <div class="qa-media">
          <img id="qaImg1" alt="" loading="lazy" decoding="async">
          <img id="qaImg2" alt="" loading="lazy" decoding="async">
        </div>

        <!-- 2) Nombre + precio -->
        <div class="qa-info">
          <h3 class="qa-name" id="qaName"></h3>
          <p class="qa-price" id="qaPrice"></p>

          <!-- 3) Color -->
          <div class="qa-row">
            <span class="qa-label">Color</span>
            <select id="qaColor" class="qa-select"></select>
          </div>

          <!-- 4) Talla -->
          <div class="qa-row">
            <span class="qa-label">Talla</span>
            <select id="qaSize" class="qa-select"></select>
          </div>

          <!-- 5) Añadir -->
          <div class="qa-row" style="margin-top:6px">
            <button id="qaAdd" class="qa-btn">Añadir al carrito</button>
          </div>

          <!-- 6) Ver detalles -->
          <a id="qaLink" class="qa-muted-link" href="#" rel="nofollow">Ver detalles del producto</a>
        </div>
      </div>
    `;
    document.body.appendChild(qaOverlay);

    qaPanel = qaOverlay.querySelector(".qa-panel");
    qaClose = qaOverlay.querySelector(".qa-close");
    qaImg1  = qaOverlay.querySelector("#qaImg1");
    qaImg2  = qaOverlay.querySelector("#qaImg2");
    qaName  = qaOverlay.querySelector("#qaName");
    qaPrice = qaOverlay.querySelector("#qaPrice");
    qaColor = qaOverlay.querySelector("#qaColor");
    qaSize  = qaOverlay.querySelector("#qaSize");
    qaQty   = document.createElement("input"); // cantidad 1
    qaAdd   = qaOverlay.querySelector("#qaAdd");
    qaLink  = qaOverlay.querySelector("#qaLink");

    // Cerrar
    qaClose.addEventListener("click", closeQuickAdd);
    qaOverlay.addEventListener("click", (e) => {
      if (!e.target.closest(".qa-panel")) closeQuickAdd();
    });
    window.addEventListener("keydown", (e) => {
      if (qaOverlay.getAttribute("aria-hidden") === "false" && e.key === "Escape") closeQuickAdd();
    });

    // Añadir al carrito
    qaAdd.addEventListener("click", () => {
      if (!qaCurrentProduct) return;
      const size = qaSize?.value || "M";
      const color = qaColor?.value || qaCurrentProduct.color || null;
      const qty  = 1;
      addToCart({
        id: qaCurrentProduct.id,
        name: qaCurrentProduct.name,
        price: Number(qaCurrentProduct.price) || 0,
        priceLabel: qaCurrentProduct.priceLabel || euros(qaCurrentProduct.price),
        image: qaCurrentProduct.image,
        color,
        size,
        qty
      });
      qaAdd.disabled = true;
      const prev = qaAdd.textContent;
      qaAdd.textContent = "Añadido ✓";
      setTimeout(() => { qaAdd.textContent = prev; qaAdd.disabled = false; }, 1200);
    });

    // Ver detalles
    qaLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (!qaCurrentProduct) return;
      window.location.href = `producto.html?id=${encodeURIComponent(qaCurrentProduct.id)}`;
    });
  }

  function openQuickAdd(product) {
    ensureQuickAddDOM();
    qaCurrentProduct = product;

    // Imágenes (2 primeras; si falta la 2ª, repetimos la 1ª)
    const imgs = Array.isArray(product.images) && product.images.length ? product.images : [product.image];
    qaImg1.src = imgs[0];
    qaImg1.alt = product.name;
    qaImg2.src = imgs[1] || imgs[0];
    qaImg2.alt = product.name;

    // Nombre y precio
    qaName.textContent  = product.name || "";
    qaPrice.textContent = product.priceLabel || euros(product.price);

    // Color
    const colors = product.colors && product.colors.length ? product.colors : (product.color ? [product.color] : ["Único"]);
    qaColor.innerHTML = colors.map(c => `<option value="${c}">${c.toString().toUpperCase()}</option>`).join("");

    // Talla
    const sizes = product.sizes && product.sizes.length ? product.sizes : ["m"];
    qaSize.innerHTML = sizes.map(s => `<option value="${s.toUpperCase()}">${s.toUpperCase()}</option>`).join("");

    // Link a detalle
    qaLink.href = `producto.html?id=${encodeURIComponent(product.id)}`;

    // Mostrar
    qaOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    qaClose.focus();
  }

  function closeQuickAdd() {
    if (!qaOverlay) return;
    qaOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    qaCurrentProduct = null;
  }

  // Carrito
  function addToCart(item) {
    try {
      const raw = localStorage.getItem("cronox_cart");
      const cart = raw ? JSON.parse(raw) : [];
      const idx = cart.findIndex(x => x.id === item.id && x.size === item.size && x.color === item.color);
      if (idx >= 0) {
        cart[idx].qty = (Number(cart[idx].qty) || 0) + (Number(item.qty) || 1);
      } else {
        cart.push({ ...item, qty: Number(item.qty) || 1, addedAt: Date.now() });
      }
      localStorage.setItem("cronox_cart", JSON.stringify(cart));
      if (typeof window.updateCartBadge === "function") window.updateCartBadge(cart.length);
      window.dispatchEvent(new Event("cart:updated"));
    } catch (e) {
      console.error("[CRONOX] Error guardando en carrito:", e);
      alert("No se pudo guardar el carrito en este navegador.");
    }
  }

  // ======= Tarjeta con mini-galería + botón "+" =======
  function createCard(p) {
    const a = document.createElement("a");
    a.href = `producto.html?id=${encodeURIComponent(p.id)}`;
    a.className = "product-card";
    a.setAttribute("data-id", p.id);

    // Envoltorio de imagen para posicionar galería y "+" dentro
    const media = document.createElement("div");
    media.className = "product-media";

    // Contenedor de imágenes (galería)
    const gallery = document.createElement("div");
    gallery.className = "product-images";

    const imgs = Array.isArray(p.images) && p.images.length ? p.images : [p.image];
    const imgEls = imgs.map((src, i) => {
      const im = document.createElement("img");
      im.className = "product-img" + (i === 0 ? " active" : "");
      im.loading = "lazy";
      im.decoding = "async";
      im.alt = p.name || "Producto";
      im.src = src;
      return im;
    });
    imgEls.forEach(im => gallery.appendChild(im));

    // Flechas (solo si hay >1 imagen)
    if (imgEls.length > 1) {
      const prev = document.createElement("button");
      prev.className = "product-arrow prev";
      prev.type = "button";
      prev.setAttribute("aria-label", "Imagen anterior");
      prev.textContent = "‹";

      const next = document.createElement("button");
      next.className = "product-arrow next";
      next.type = "button";
      next.setAttribute("aria-label", "Imagen siguiente");
      next.textContent = "›";

      // Estado interno por tarjeta
      let index = 0;
      const show = (i) => {
        imgEls.forEach((el, j) => el.classList.toggle("active", j === i));
      };
      prev.addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        index = (index - 1 + imgEls.length) % imgEls.length;
        show(index);
      });
      next.addEventListener("click", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        index = (index + 1) % imgEls.length;
        show(index);
      });

      gallery.appendChild(prev);
      gallery.appendChild(next);
    }

    // Botón "+" (Quick-Add)
    const plus = document.createElement("button");
    plus.className = "card-plus";
    plus.type = "button";
    plus.setAttribute("aria-label", `Añadir rápido ${p.name}`);
    plus.textContent = "+";
    plus.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openQuickAdd(p);
    });

    media.appendChild(gallery);
    media.appendChild(plus);

    const name = document.createElement("h3");
    name.className = "product-name";
    name.textContent = p.name;

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = p.priceLabel || euros(p.price);

    a.appendChild(media);
    a.appendChild(name);
    a.appendChild(price);
    return a;
  }

  function renderProducts(list) {
    if (!productsGrid) return;
    productsGrid.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      if (productsFallback) {
        productsFallback.hidden = false;
        productsFallback.innerHTML = '<p>No hay productos que mostrar.</p>';
      }
      return;
    }

    if (productsFallback) productsFallback.hidden = true;
    const frag = document.createDocumentFragment();
    list.forEach((p) => frag.appendChild(createCard(p)));
    productsGrid.appendChild(frag);

    restoreScrollOrFocus();
  }

  // ---- Filtros + Búsqueda ----
  function getActiveFilters() {
    const f = { cat: [], size: [], color: [] };
    if (!filtersForm) return f;

    f.cat = Array.from(filtersForm.querySelectorAll('input[name="cat"]:checked')).map(el => norm(el.value));
    f.size = Array.from(filtersForm.querySelectorAll('input[name="size"]:checked')).map(el => norm(el.value));
    f.color= Array.from(filtersForm.querySelectorAll('input[name="color"]:checked')).map(el => norm(el.value));
    return f;
  }

  function matchesFilters(p, f) {
    if (f.cat.length)  { if (!(p.categories||[]).some(c=>f.cat.includes(norm(c)))) return false; }
    if (f.size.length) { if (!(p.sizes||[]).some(s=>f.size.includes(norm(s)))) return false; }
    if (f.color.length){ if (!f.color || !f.color.includes(norm(p.color))) return false; }
    return true;
  }

  function matchesQuery(p, qNorm) {
    if (!qNorm) return true;
    const haystack = `${norm(p.name)} ${norm(p.desc)} ${(p.categories||[]).map(norm).join(" ")} ${norm(p.color)}`.trim();
    return haystack.includes(qNorm);
  }

  function applyAll() {
    const f = getActiveFilters();
    const qRaw = searchInput ? searchInput.value : initialQueryRaw;
    const qNorm = norm(qRaw);
    const out = PRODUCTS.filter(p => matchesFilters(p, f) && matchesQuery(p, qNorm));
    renderProducts(out);
  }

  // ---- Guardar scroll antes de salir a PDP ----
  if (productsGrid) {
    productsGrid.addEventListener("click", (e) => {
      const link = e.target.closest("a.product-card[href]");
      if (!link) return;
      try { sessionStorage.setItem(SCROLL_POS_KEY, String(window.scrollY || 0)); } catch {}
      const pid = link.getAttribute("data-id") || link.dataset.id;
      if (pid) { try { sessionStorage.setItem(RETURN_KEY, pid); } catch {} }
    }, { capture: true });
  }

  // ---- Restaurar scroll o centrar tarjeta ----
  function ensureHighlightStyles() {
    if (document.getElementById("cronox-card-flash")) return;
    const style = document.createElement("style");
    style.id = "cronox-card-flash";
    style.textContent = `.cronox-flash{outline:2px solid rgba(255,255,255,.85);box-shadow:0 0 0 6px rgba(255,255,255,.18);transition:outline-color .6s ease, box-shadow .6s ease}`;
    document.head.appendChild(style);
  }

  function restoreScrollOrFocus() {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let y = null;
    try { y = sessionStorage.getItem(SCROLL_POS_KEY); } catch {}
    if (y !== null && y !== undefined) {
      const yNum = Math.max(0, parseInt(y, 10) || 0);
      try { sessionStorage.removeItem(SCROLL_POS_KEY); } catch {}
      requestAnimationFrame(() => {
        window.scrollTo({ top: yNum, behavior: prefersReduced ? "auto" : "instant" });
      });
      return;
    }

    let pid = null;
    try { pid = sessionStorage.getItem(RETURN_KEY); } catch {}
    if (!pid) return;
    try { sessionStorage.removeItem(RETURN_KEY); } catch {}

    requestAnimationFrame(() => {
      const card = productsGrid?.querySelector(`.product-card[data-id="${CSS.escape(pid)}"]`);
      if (!card) return;
      card.style.scrollMarginTop = "84px";
      card.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });
      ensureHighlightStyles();
      card.classList.add("cronox-flash");
      setTimeout(() => { card.classList.remove("cronox-flash"); }, 1400);
    });
  }

  window.addEventListener("pageshow", (e) => { if (e.persisted) restoreScrollOrFocus(); });

  // ---- Eventos búsqueda/filtros ----
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => { e.preventDefault(); applyAll(); });
  }
  if (filtersForm) {
    filtersForm.addEventListener("submit", (e) => { e.preventDefault(); applyAll(); });
  }
  if (btnClearFilters && filtersForm) {
    btnClearFilters.addEventListener("click", () => {
      filtersForm.querySelectorAll('input[type="checkbox"]').forEach(chk => (chk.checked = false));
      applyAll();
    });
  }

  // Primera pintura
  applyAll();
})();
