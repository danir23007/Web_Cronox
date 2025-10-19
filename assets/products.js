// ======================================================
// assets/products.js — Grid + filtros + enlaces a PDP
// + mini-galería en cards con flechas < y >
// + scroll exacto al volver (back) y foco en última vista
// (v4) — SIN .card-plus ni overlay de Quick-Add
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
  window.CRONOX_PRODUCTS = PRODUCTS; // para PDP si lo necesitas

  // ---- Búsqueda inicial (?q=) ----
  const url = new URL(window.location);
  const initialQueryRaw  = url.searchParams.get("q") || "";
  if (searchInput && initialQueryRaw) searchInput.value = initialQueryRaw;

  // ======= Tarjeta con mini-galería + botón "+" clásico (.fav-add) =======
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

    // Botón "+" CLÁSICO (no navega; app.js gestiona el click)
    const plus = document.createElement("button");
    plus.className = "fav-add";
    plus.type = "button";
    plus.setAttribute("aria-label", `Añadir rápido ${p.name}`);
    plus.textContent = "+";
    // No añadimos listener aquí: app.js (delegación) maneja .fav-add para carrito

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
