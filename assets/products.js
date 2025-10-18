// ======================================================
// assets/products.js — CRONOX STORE (grid + overlay detalle)
// ======================================================
(function () {
  // ---- Nodos base ----
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");
  const filtersForm = document.getElementById("filtersForm");
  const btnClearFilters = document.getElementById("btnClearFilters");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");

  // ---- Nodos del overlay de detalle ----
  const detailEl = document.getElementById("productDetail");
  const pdImage = document.getElementById("pdImage");
  const pdName  = document.getElementById("pdName");
  const pdPrice = document.getElementById("pdPrice");
  const pdDesc  = document.getElementById("pdDesc");
  const pdClose = document.getElementById("pdClose");
  const pdAddToCart = document.getElementById("pdAddToCart");
  const pdSize = document.getElementById("pdSize");
  const pdQty  = document.getElementById("pdQty");
  const toast  = document.getElementById("toast");

  if (!productsGrid) {
    console.warn("[CRONOX] No se encontró #productsGrid.");
  }

  // ---- Utils ----
  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  function euros(n) {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
  }

  function showFallback(msg) {
    if (!productsFallback) return;
    productsFallback.hidden = false;
    productsFallback.innerHTML = `<p>${msg || "No hay productos que mostrar."}</p>`;
  }

  function hideFallback() {
    if (!productsFallback) return;
    productsFallback.hidden = true;
  }

  // ---- Estado búsqueda inicial por URL (?q=) ----
  const url = new URL(window.location);
  const initialQueryRaw = url.searchParams.get("q") || "";
  const initialQueryNorm = norm(initialQueryRaw);
  if (searchInput && initialQueryRaw) searchInput.value = initialQueryRaw;

  // === Tus productos actuales (sin tocar) ===
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
  // Exponer por si lo necesitas en otros scripts
  window.CRONOX_PRODUCTS = PRODUCTS;

  // ---- Render tarjeta (sin navegación a producto.html) ----
  function createCard(p, index) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.tabIndex = 0;
    card.setAttribute("data-index", String(index));
    card.setAttribute("aria-label", p.name || "Producto");

    // Imagen (clases compatibles con tu CSS actual)
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

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(price);
    return card;
  }

  function renderProducts(list) {
    if (!productsGrid) return;
    productsGrid.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      showFallback("No hay productos que mostrar.");
      return;
    }

    hideFallback();
    const frag = document.createDocumentFragment();
    list.forEach((p, i) => frag.appendChild(createCard(p, i)));
    productsGrid.appendChild(frag);
  }

  // ---- Filtros + Búsqueda ----
  function getActiveFilters() {
    const f = { cat: [], size: [], color: [] };
    if (!filtersForm) return f;

    // categorías
    f.cat = Array.from(filtersForm.querySelectorAll('input[name="cat"]:checked'))
      .map(el => el.value.toLowerCase());

    // tallas
    f.size = Array.from(filtersForm.querySelectorAll('input[name="size"]:checked'))
      .map(el => el.value.toLowerCase());

    // colores
    f.color = Array.from(filtersForm.querySelectorAll('input[name="color"]:checked'))
      .map(el => el.value.toLowerCase());

    return f;
  }

  function matchesFilters(p, f) {
    // Categoría
    if (f.cat.length) {
      const hasCat = (p.categories || []).some(c => f.cat.includes(norm(c)));
      if (!hasCat) return false;
    }
    // Talla
    if (f.size.length) {
      const hasSize = (p.sizes || []).some(s => f.size.includes(norm(s)));
      if (!hasSize) return false;
    }
    // Color
    if (f.color.length) {
      if (!f.color.includes(norm(p.color))) return false;
    }
    return true;
  }

  function matchesQuery(p, qNorm) {
    if (!qNorm) return true;
    const haystack =
      `${norm(p.name)} ${norm(p.desc)} ${(p.categories || []).map(norm).join(" ")} ${norm(p.color)}`
        .trim();
    return haystack.includes(qNorm);
  }

  function applyAll() {
    const f = getActiveFilters();
    const qRaw = searchInput ? searchInput.value : initialQueryRaw;
    const qNorm = norm(qRaw);

    const out = PRODUCTS.filter(p => matchesFilters(p, f) && matchesQuery(p, qNorm));
    renderProducts(out);
  }

  // ---- Eventos de UI: búsqueda y filtros ----
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = searchInput ? searchInput.value : "";
      // Actualiza la URL (?q=) sin recargar
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

  // ---- Overlay Detalle ----
  let currentIndex = null;

  function openDetail(index) {
    const p = (Array.isArray(PRODUCTS) ? PRODUCTS : [])[index];
    if (!p || !detailEl) return;

    currentIndex = index;

    if (pdImage) { pdImage.src = p.image; pdImage.alt = p.name || ""; }
    if (pdName)  pdName.textContent  = p.name || "";
    if (pdPrice) pdPrice.textContent = p.priceLabel || euros(p.price);
    if (pdDesc)  pdDesc.textContent  = p.desc || "";

    // Rellena tallas dinámicamente si existen
    if (pdSize && Array.isArray(p.sizes) && p.sizes.length) {
      pdSize.innerHTML = p.sizes
        .map(s => `<option value="${s.toUpperCase()}">${s.toUpperCase()}</option>`)
        .join("");
    }

    detailEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    pdClose && pdClose.focus();
  }

  function closeDetail() {
    if (!detailEl) return;
    detailEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentIndex = null;
  }

  // Click tarjeta -> abrir detalle
  if (productsGrid) {
    productsGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".product-card");
      if (!card) return;
      const i = Number(card.getAttribute("data-index"));
      openDetail(i);
    });

    // Accesible: Enter o Espacio sobre tarjeta
    productsGrid.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const card = e.target.closest(".product-card");
        if (!card) return;
        e.preventDefault();
        const i = Number(card.getAttribute("data-index"));
        openDetail(i);
      }
    });
  }

  // Cierre overlay
  pdClose && pdClose.addEventListener("click", closeDetail);
  detailEl && detailEl.addEventListener("click", (e) => {
    const panel = e.target.closest(".product-detail__panel");
    if (!panel) closeDetail();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && detailEl && detailEl.getAttribute("aria-hidden") === "false") {
      closeDetail();
    }
  });

  // ---- Carrito en localStorage ----
  function addToCart(product, { size = "M", qty = 1 } = {}) {
    try {
      const key = "cronox_cart";
      const raw = localStorage.getItem(key);
      const cart = raw ? JSON.parse(raw) : [];
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        priceLabel: product.priceLabel || euros(product.price),
        image: product.image,
        size,
        qty,
        addedAt: Date.now(),
      });
      localStorage.setItem(key, JSON.stringify(cart));

      if (typeof window.updateCartBadge === "function") {
        window.updateCartBadge(cart.length);
      }
    } catch (err) {
      console.error("[CRONOX] Error guardando en carrito:", err);
    }
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  pdAddToCart && pdAddToCart.addEventListener("click", () => {
    if (currentIndex == null) return;
    const p = PRODUCTS[currentIndex];
    const size = (pdSize && pdSize.value) ? pdSize.value : "M";
    const qty  = Math.max(1, parseInt((pdQty && pdQty.value) ? pdQty.value : "1", 10));
    addToCart(p, { size, qty });
    showToast("Añadido al carrito");
  });

  // ---- Primera pintura (con estado inicial de URL y filtros) ----
  applyAll();
})();
