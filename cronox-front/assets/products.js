// ======================================================
// assets/products.js (v8)
// - Grid + filtros + mini-galería
// - “+” abre Quick-Add vertical
// - Quick-Add SIN selector de color (usa color del producto)
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

  function euros(n){ return new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n); }

  const API = window.CRONOX_API || {};
  const STAR_ICON = window.CRONOX_STAR_ICON || '<span class="icon-star"></span>';

  const localFallbackFactory = () => [
    {
      id: "camiseta-washed-gris",
      name: "Grey Core Tee",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      images: [
        "assets/products/camiseta_washed_gris.png",
        "assets/products/camiseta_washed_gris_2.png"
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl", "xxl"],
      color: "gris",
      colors: ["gris"],
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave."
    },
    {
      id: "camiseta-washed-negra",
      name: "Black Core Tee",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_negra.png",
      images: [
        "assets/products/camiseta_washed_negra.png",
        "assets/products/camiseta_washed_negra_2.png"
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl", "xxl"],
      color: "negro",
      colors: ["negro"],
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];

  const fallbackFactory = typeof API.getFallbackProducts === "function"
    ? API.getFallbackProducts.bind(API)
    : localFallbackFactory;

  const cloneProduct = (product = {}) => {
    const copy = { ...product };
    if (Array.isArray(product.images)) copy.images = [...product.images];
    if (Array.isArray(product.sizes)) copy.sizes = [...product.sizes];
    if (Array.isArray(product.colors)) copy.colors = [...product.colors];
    if (Array.isArray(product.categories)) copy.categories = [...product.categories];
    if (Array.isArray(product.variants)) copy.variants = product.variants.map((variant) => ({ ...variant }));
    if (product.variantMap && typeof product.variantMap === "object") {
      copy.variantMap = Object.entries(product.variantMap).reduce((acc, [key, value]) => {
        acc[key] = { ...value };
        return acc;
      }, {});
    }
    if (product.priceCents != null) copy.priceCents = product.priceCents;
    if (product.backendId != null) copy.backendId = product.backendId;
    if (product.slug) copy.slug = product.slug;
    return copy;
  };

  const cloneProducts = (list) => (Array.isArray(list) ? list.map(cloneProduct) : []);

  const getFallbackList = () => {
    try {
      const list = fallbackFactory();
      if (Array.isArray(list) && list.length) return cloneProducts(list);
    } catch {}
    return cloneProducts(localFallbackFactory());
  };

  const adaptCatalogLocally = (rawList, fallbackList) => {
    const source = Array.isArray(rawList) ? rawList : [];
    const fallback = Array.isArray(fallbackList) && fallbackList.length
      ? fallbackList
      : getFallbackList();

    return source.map((item, index) => {
      const data = typeof item === "object" && item ? item : {};
      const template = cloneProduct(fallback[index % fallback.length] || {});
      const priceValue = data.price != null ? Number(data.price) : Number(template.price) || 0;
      const templateImages = Array.isArray(template.images) ? [...template.images] : [];
      const sourceImages = Array.isArray(data.images) ? [...data.images] : [];
      const candidateImage = data.image || sourceImages[0] || template.image || templateImages[0] || "";
      const uniqueImages = [];
      const pushImage = (value) => {
        const clean = typeof value === "string" ? value.trim() : "";
        if (clean && !uniqueImages.includes(clean)) uniqueImages.push(clean);
      };
      pushImage(candidateImage);
      sourceImages.forEach(pushImage);
      templateImages.forEach(pushImage);

      const backendId = data.backendId != null
        ? data.backendId
        : (data.id != null ? data.id : template.backendId);

      return {
        ...template,
        ...data,
        id: data.id != null ? String(data.id) : template.id || `product-${index + 1}`,
        backendId: backendId != null ? backendId : undefined,
        slug: data.slug || template.slug || undefined,
        name: data.name || template.name || "Producto CRONOX",
        price: priceValue,
        priceLabel: data.priceLabel || template.priceLabel || euros(priceValue),
        image: candidateImage || uniqueImages[0] || template.image || "",
        images: uniqueImages,
        categories: Array.isArray(data.categories) && data.categories.length
          ? data.categories
          : template.categories || [],
        sizes: Array.isArray(data.sizes) && data.sizes.length
          ? data.sizes
          : template.sizes || [],
        colors: Array.isArray(data.colors) && data.colors.length
          ? data.colors
          : template.colors || [],
        color: data.color || template.color || "",
        desc: data.desc || template.desc || "",
      };
    });
  };

  const adaptCatalog = (rawList) => {
    const fallback = getFallbackList();
    if (typeof API.adaptProducts === "function") {
      try {
        const adapted = API.adaptProducts(rawList, fallback);
        if (Array.isArray(adapted) && adapted.length) {
          return adapted;
        }
      } catch {}
    }
    return adaptCatalogLocally(rawList, fallback);
  };

  let PRODUCTS = [];

  const normalizeProduct = (product) => {
    const copy = cloneProduct(product || {});
    const backendId = copy.backendId != null
      ? copy.backendId
      : (copy.id != null ? copy.id : undefined);
    const id = copy.id != null
      ? String(copy.id)
      : (backendId != null ? String(backendId) : "");
    return {
      ...copy,
      id,
      backendId: backendId != null ? backendId : undefined,
      slug: copy.slug || undefined,
    };
  };

  const setProducts = (list) => {
    const normalized = Array.isArray(list) ? list.map(normalizeProduct) : [];
    PRODUCTS = normalized;
    window.CRONOX_PRODUCTS = PRODUCTS;
  };

  // ---- Búsqueda inicial (?q=) ----
  const url = new URL(window.location);
  const initialQueryRaw  = url.searchParams.get("q") || "";
  if (searchInput && initialQueryRaw) searchInput.value = initialQueryRaw;

  // ======================================================
  // Quick-Add DOM (panel negro, sin color)
  // ======================================================
  let qaOverlay, qaPanel, qaClose, qaImg1, qaImg2, qaName, qaPrice, /* qaColor, */ qaSizeGroup, qaAdd, qaLink;
  let qaCurrentProduct = null;
  let qaSelectedSize = "";

  const findVariantForSize = (product, size) => {
    if (!product || !size) return null;
    const map = product.variantMap || {};
    const key = String(size).toUpperCase();
    return map[key] || map[key.toLowerCase()] || null;
  };

  function ensureQuickAddDOM() {
    if (qaOverlay) return;

    qaOverlay = document.createElement("div");
    qaOverlay.className = "qa-overlay";
    qaOverlay.id = "quickAdd";
    qaOverlay.setAttribute("aria-hidden", "true");
    qaOverlay.innerHTML = `
      <div class="qa-panel" role="dialog" aria-modal="true">
        <button class="qa-close" aria-label="Cerrar">×</button>

        <div class="qa-media">
          <img id="qaImg1" alt="" loading="lazy" decoding="async">
          <img id="qaImg2" alt="" loading="lazy" decoding="async">
        </div>

        <div class="qa-info">
          <h3 class="qa-name" id="qaName"></h3>
          <p class="qa-price" id="qaPrice"></p>

          <div class="qa-row">
            <span class="qa-label">Talla</span>
            <div id="qaSizes" class="qa-sizes" role="radiogroup" aria-label="Selecciona una talla"></div>
          </div>

          <div class="qa-row">
            <button id="qaAdd" class="qa-btn">Añadir al carrito</button>
          </div>

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
    qaSizeGroup = qaOverlay.querySelector("#qaSizes");
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
      const fallbackSize = qaCurrentProduct.sizes?.[0] || "M";
      const size = (qaSelectedSize || String(fallbackSize)).toUpperCase();
      const color = qaCurrentProduct.color || (qaCurrentProduct.colors?.[0]) || "Único";
      const variant = findVariantForSize(qaCurrentProduct, size);

      if (!variant || !variant.id) {
        alert("No hay stock disponible para esa talla ahora mismo.");
        return;
      }

      const ev = new CustomEvent("cronox:addToCart", {
        detail: {
          id: qaCurrentProduct.id,
          productId: qaCurrentProduct.backendId || qaCurrentProduct.id,
          slug: qaCurrentProduct.slug,
          name: qaCurrentProduct.name,
          price: Number(variant.price ?? qaCurrentProduct.price) || 0,
          priceLabel: variant.priceLabel || qaCurrentProduct.priceLabel || euros(qaCurrentProduct.price),
          priceCents: variant.priceCents ?? qaCurrentProduct.priceCents,
          image: (qaCurrentProduct.images?.[0]) || qaCurrentProduct.image,
          size,
          color,
          qty: 1,
          variantId: variant.id,
        }
      });
      window.dispatchEvent(ev);

      qaAdd.disabled = true;
      const prev = qaAdd.textContent;
      qaAdd.textContent = "Añadido ✓";
      setTimeout(() => { qaAdd.textContent = prev; qaAdd.disabled = false; }, 1100);
    });

    // Ver detalles
    qaLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (!qaCurrentProduct) return;
      const key = qaCurrentProduct.slug || qaCurrentProduct.id;
      if (qaCurrentProduct.slug) {
        window.location.href = `/producto.html?slug=${encodeURIComponent(key)}`;
      } else {
        window.location.href = `/producto.html?id=${encodeURIComponent(key)}`;
      }
    });
  }

  function setupQuickAddSizes(product) {
    if (!qaSizeGroup) return;

    const rawSizes = Array.isArray(product?.sizes) && product.sizes.length ? product.sizes : ["m"];
    const variantMap = product?.variantMap || {};
    const variantKeys = Object.keys(variantMap);
    const normalized = (variantKeys.length ? variantKeys : rawSizes)
      .map((size) => String(size || "").toUpperCase());

    const firstAvailable = normalized.find((size) => {
      const variant = variantMap[size] || variantMap[size.toUpperCase()];
      return variant ? variant.isAvailable !== false : true;
    }) || normalized[0] || "";
    qaSelectedSize = firstAvailable;

    qaSizeGroup.innerHTML = normalized
      .map((size) => {
        const variant = variantMap[size] || variantMap[size.toUpperCase()];
        const disabled = Boolean(variant) && variant.isAvailable === false;
        return `<button type="button" class="qa-size-btn${disabled ? ' is-disabled' : ''}" data-size="${size}" role="radio" aria-checked="false" ${disabled ? 'disabled' : ''}>${size}</button>`;
      })
      .join("");

    const buttons = Array.from(qaSizeGroup.querySelectorAll(".qa-size-btn"));
    if (!buttons.length) {
      return;
    }

    const updateTabIndexes = () => {
      buttons.forEach((btn) => {
        btn.tabIndex = btn.classList.contains("is-active") ? 0 : -1;
      });
    };

    const activate = (btn) => {
      buttons.forEach((button) => {
        const isActive = button === btn;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-checked", isActive ? "true" : "false");
      });
      qaSelectedSize = btn?.dataset.size || (normalized[0] || "");
      updateTabIndexes();
    };

    const firstButton = buttons.find((btn) => !btn.disabled) || buttons[0];
    if (firstButton) {
      activate(firstButton);
    } else {
      qaSelectedSize = "";
    }

    buttons.forEach((btn, index) => {
      btn.addEventListener("click", () => activate(btn));
      btn.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          activate(btn);
          return;
        }

        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex = (index + 1) % buttons.length;
          buttons[nextIndex].focus();
          activate(buttons[nextIndex]);
          return;
        }

        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          const prevIndex = (index - 1 + buttons.length) % buttons.length;
          buttons[prevIndex].focus();
          activate(buttons[prevIndex]);
        }
      });
    });
  }

  function openQuickAdd(product) {
    ensureQuickAddDOM();
    qaCurrentProduct = product;

    const imgs = Array.isArray(product.images) && product.images.length ? product.images : [product.image];
    qaImg1.src = imgs[0];  qaImg1.alt = product.name;
    qaImg2.src = imgs[1] || imgs[0];  qaImg2.alt = product.name;

    qaName.textContent  = product.name || "";
    qaPrice.textContent = product.priceLabel || euros(product.price);

    setupQuickAddSizes(product);

    const key = product.slug || product.id;
    if (product.slug) {
      qaLink.href = `/producto.html?slug=${encodeURIComponent(key)}`;
    } else {
      qaLink.href = `/producto.html?id=${encodeURIComponent(key)}`;
    }

    qaOverlay.setAttribute("aria-hidden","false");
    if (typeof window.CRONOX_lockScroll === "function") window.CRONOX_lockScroll("quick-add");
    else document.body.classList.add("no-scroll");
    qaClose.focus();
  }

  function closeQuickAdd() {
    if (!qaOverlay) return;
    qaOverlay.setAttribute("aria-hidden","true");
    if (typeof window.CRONOX_unlockScroll === "function") window.CRONOX_unlockScroll("quick-add");
    else document.body.classList.remove("no-scroll");
    qaCurrentProduct = null;
    qaSelectedSize = "";
  }

  window.CRONOX_openQuickAddById = function(id){
    const p = PRODUCTS.find(x => x.id === id || x.slug === id);
    if (p) openQuickAdd(p);
  };

  // ======= Tarjeta con mini-galería + botón "+" clásico =======
  function createCard(p) {
    const key = p.slug || String(p.id) || String(p.backendId);
    const detailHref = p.slug
      ? `/producto.html?slug=${encodeURIComponent(key)}`
      : key
        ? `/producto.html?id=${encodeURIComponent(key)}`
        : "#";

    const a = document.createElement("a");
    a.href = detailHref;
    a.className = "product-card";
    if (key) a.setAttribute("data-id", key);
    if (p.slug) a.setAttribute("data-slug", p.slug);

    const media = document.createElement("div");
    media.className = "product-media";

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

      let index = 0;
      const show = (i) => imgEls.forEach((el, j) => el.classList.toggle("active", j === i));
      prev.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); index=(index-1+imgEls.length)%imgEls.length; show(index); });
      next.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); index=(index+1)%imgEls.length; show(index); });

      gallery.appendChild(prev);
      gallery.appendChild(next);
    }

    const favBtn = document.createElement("button");
    favBtn.className = "favorite-toggle";
    favBtn.type = "button";
    favBtn.setAttribute("aria-label", "Marcar como favorito");
    favBtn.dataset.productId = String(p.backendId ?? p.id ?? "");
    favBtn.dataset.slug = p.slug || "";
    favBtn.dataset.name = p.name || "Producto";
    favBtn.dataset.price = p.priceLabel || euros(p.price);
    favBtn.dataset.image = imgs[0] || p.image || "";
    favBtn.innerHTML = STAR_ICON;
    favBtn.dataset.favBound = "1";
    favBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.toggleFromButton === "function") {
        window.CRONOX_FAVORITES.toggleFromButton(favBtn);
      }
    });

    const plus = document.createElement("button");
    plus.className = "fav-add";
    plus.type = "button";
    plus.setAttribute("aria-label", `Añadir rápido ${p.name}`);
    plus.textContent = "+";
    plus.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      openQuickAdd(p);
    });

    media.appendChild(gallery);
    media.appendChild(favBtn);
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

    if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.updateDomState === "function") {
      window.CRONOX_FAVORITES.updateDomState();
    }

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

  async function loadCatalog() {
    const fallback = adaptCatalog(cloneProducts(fallbackFactory()));
    if (!API || typeof API.getProducts !== "function") {
      return { products: fallback, source: "fallback" };
    }

    try {
      const raw = await API.getProducts({ limit: 48, sortBy: "createdAt", order: "desc" });
      if (!Array.isArray(raw) || !raw.length) {
        throw new Error("Catálogo vacío");
      }
      return { products: adaptCatalog(raw), source: "api" };
    } catch (error) {
      console.warn("[CRONOX] No se pudo cargar el catálogo desde la API, usando fallback local.", error);
      return { products: fallback, source: "fallback" };
    }
  }

  const notifyCatalogReady = (source) => {
    try {
      const detail = { products: cloneProducts(PRODUCTS), source };
      window.dispatchEvent(new CustomEvent("cronox:productsLoaded", { detail }));
    } catch {}
  };

  async function initCatalog() {
    const { products, source } = await loadCatalog();
    setProducts(products);
    applyAll();
    notifyCatalogReady(source);
  }

  window.CRONOX_catalogReady = initCatalog();

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
})();
