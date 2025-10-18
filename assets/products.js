// ======================================================
// assets/products.js — Grid + filtros + enlaces a PDP + scroll a última vista
// ======================================================
(function () {
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");
  const filtersForm = document.getElementById("filtersForm");
  const btnClearFilters = document.getElementById("btnClearFilters");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");

  const RETURN_KEY = "cronox_scroll_to"; // <- lee el id guardado en la PDP

  const norm = (s) =>
    (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  function euros(n){
    return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n);
  }

  // === Catálogo actual (igual que en la PDP) ===
  const PRODUCTS = [
    {
      id: "camiseta-washed-gris",
      name: "Camiseta Washed Gris",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl"],
      color: "gris",
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave."
    },
    {
      id: "camiseta-washed-negra",
      name: "Camiseta Washed Negra",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_negra.png",
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];
  window.CRONOX_PRODUCTS = PRODUCTS; // para PDP

  // ---- Búsqueda inicial (?q=) ----
  const url = new URL(window.location);
  const initialQueryRaw  = url.searchParams.get("q") || "";
  if (searchInput && initialQueryRaw) searchInput.value = initialQueryRaw;

  // ---- Tarjeta como LINK a producto.html ----
  function createCard(p) {
    const a = document.createElement("a");
    a.href = `producto.html?id=${encodeURIComponent(p.id)}`;
    a.className = "product-card";
    a.setAttribute("data-id", p.id);

    const img = document.createElement("img");
    img.className = "product-img";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = p.name || "Producto";
    img.src = p.image;

    const name = document.createElement("h3");
    name.className = "product-name";
    name.textContent = p.name;

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = p.priceLabel || euros(p.price);

    a.appendChild(img);
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

    // Tras render: si hay marca de retorno, desplazarse a esa tarjeta
    scrollToLastViewed();
  }

  // ---- Filtros + Búsqueda ----
  function getActiveFilters() {
    const f = { cat: [], size: [], color: [] };
    if (!filtersForm) return f;

    f.cat = Array.from(filtersForm.querySelectorAll('input[name="cat"]:checked')).map(el => norm(el.value));
    f.size = Array.from(filtersForm.querySelectorAll('input[name="size"]:checked')).map(el => norm(el.value));
    f.color = Array.from(filtersForm.querySelectorAll('input[name="color"]:checked')).map(el => norm(el.value));
    return f;
  }

  function matchesFilters(p, f) {
    if (f.cat.length) {
      const hasCat = (p.categories || []).some(c => f.cat.includes(norm(c)));
      if (!hasCat) return false;
    }
    if (f.size.length) {
      const hasSize = (p.sizes || []).some(s => f.size.includes(norm(s)));
      if (!hasSize) return false;
    }
    if (f.color.length) {
      if (!f.color.includes(norm(p.color))) return false;
    }
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

  // ---- Scroll a última vista (con resaltado) ----
  function ensureHighlightStyles() {
    if (document.getElementById("cronox-card-flash")) return;
    const css = `
      .cronox-flash {
        outline: 2px solid rgba(255,255,255,.85);
        box-shadow: 0 0 0 6px rgba(255,255,255,.18);
        transition: outline-color .6s ease, box-shadow .6s ease, transform .2s ease;
      }
    `;
    const style = document.createElement("style");
    style.id = "cronox-card-flash";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function scrollToLastViewed() {
    let pid = null;
    try { pid = sessionStorage.getItem(RETURN_KEY); } catch {}
    if (!pid) return;

    // Limpia inmediatamente para no repetir en futuras visitas
    try { sessionStorage.removeItem(RETURN_KEY); } catch {}

    // Espera a que el navegador pinte
    requestAnimationFrame(() => {
      const card = productsGrid?.querySelector(`.product-card[data-id="${CSS.escape(pid)}"]`);
      if (!card) return;

      // Ajuste por topbar: usa scrollMarginTop para evitar quedar oculto
      card.style.scrollMarginTop = "84px";

      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "center" });

      // Resalta levemente la tarjeta
      ensureHighlightStyles();
      card.classList.add("cronox-flash");
      setTimeout(() => { card.classList.remove("cronox-flash"); }, 1400);
    });
  }

  // ---- Eventos
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = searchInput ? searchInput.value : "";
      const newURL = new URL(window.location);
      if (q && q.trim().length) newURL.searchParams.set("q", q);
      else newURL.searchParams.delete("q");
      window.history.replaceState({}, "", newURL.toString());
      applyAll();
    });
  }

  if (filtersForm) {
    filtersForm.addEventListener("submit", (e) => {
      e.preventDefault();
      applyAll();
    });
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
