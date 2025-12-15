// ====================================================== 
// assets/product-page.js — PDP + carrito + relacionados + back suave + marca de retorno
// CRONOX
// ======================================================
(function () {
  const RETURN_KEY = "cronox_scroll_to"; // para volver a la card de la tienda

  // --- Referencias principales DOM ---
  const pMedia = document.getElementById("pMedia");
  const pMediaViewport = document.getElementById("pMediaViewport");
  const pMediaPrev = document.getElementById("pMediaPrev");
  const pMediaNext = document.getElementById("pMediaNext");
  const pThumbs = document.getElementById("pThumbs");
  const pName  = document.getElementById("pName");
  const pPrice = document.getElementById("pPrice");
  const pDesc      = document.getElementById("pDesc");
  const pSizeGroup = document.getElementById("pSizeGroup");
  const pAdd       = document.getElementById("pAdd");
  const pFavoriteToggle = document.getElementById("pFavoriteToggle");
  const toast  = document.getElementById("toast");
  const relatedGrid = document.getElementById("relatedGrid");

  let selectedSize = "";
  let galleryImages = [];
  let currentImageIndex = 0;
  let zoomLevel = 0;

  const pointerFineQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: fine)")
    : { matches: false };

  const mobileViewportQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(max-width: 480px)")
    : null;

  const API = window.CRONOX_API || {};

  // ==========================
  // Utils generales
  // ==========================

  const isMobileViewport = () => Boolean(mobileViewportQuery?.matches);

  const findVariantForSize = (product, size) => {
    if (!product || !size) return null;
    const map = product.variantMap || {};
    const key = String(size).toUpperCase();
    return map[key] || map[key.toLowerCase()] || null;
  };

  function syncAddButtonWidth() {
    if (!pAdd || !pSizeGroup) return;
    requestAnimationFrame(() => {
      if (!pAdd || !pSizeGroup) return;
      pAdd.style.width = "auto";
      const width = Math.round(pSizeGroup.getBoundingClientRect().width);
      if (width > 0) {
        pAdd.style.width = `${width}px`;
      }
    });
  }

  function money(n) {
    const v = Number(n) || 0;
    try { return v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
    catch { return `${v} €`; }
  }

  function setPageTitle(p) {
    try {
      if (!p) return;
      document.title = `${p.name} — CRONOX`;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute("content", `${p.name} · ${p.desc || "Producto CRONOX"}`);
    } catch {}
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function addToCart(item) {
    window.dispatchEvent(new CustomEvent("cronox:addToCart", { detail: item }));
  }

  // ==========================
  // Catálogo (API + fallback)
  // ==========================

  const localFallbackFactory = () => [
    {
      id: "camiseta-washed-gris",
      slug: "camiseta-washed-gris",
      name: "Grey Core Tee",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      images: [
        "assets/products/camiseta_washed_gris.png",
        "assets/products/camiseta_washed_gris_2.png",
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl", "xxl"],
      color: "gris",
      colors: ["gris"],
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave.",
    },
    {
      id: "camiseta-washed-negra",
      slug: "camiseta-washed-negra",
      name: "Black Core Tee",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_negra.png",
      images: [
        "assets/products/camiseta_washed_negra.png",
        "assets/products/camiseta_washed_negra_2.png",
      ],
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl", "xxl"],
      color: "negro",
      colors: ["negro"],
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave.",
    },
  ];

  const fallbackFactory = typeof API.getFallbackProducts === "function"
    ? API.getFallbackProducts.bind(API)
    : localFallbackFactory;

  const cloneProduct = typeof API.cloneProduct === "function"
    ? API.cloneProduct.bind(API)
    : (product = {}) => {
        const copy = { ...product };
        if (Array.isArray(product.images)) copy.images = [...product.images];
        if (Array.isArray(product.sizes)) copy.sizes = [...product.sizes];
        if (Array.isArray(product.colors)) copy.colors = [...product.colors];
        if (Array.isArray(product.categories)) copy.categories = [...product.categories];
        if (Array.isArray(product.variants)) copy.variants = product.variants.map(v => ({ ...v }));
        if (product.variantMap && typeof product.variantMap === "object") {
          copy.variantMap = Object.entries(product.variantMap).reduce((acc, [k, v]) => {
            acc[k] = { ...v };
            return acc;
          }, {});
        }
        if (product.slug) copy.slug = product.slug;
        if (product.priceCents != null) copy.priceCents = product.priceCents;
        if (product.backendId != null) copy.backendId = product.backendId;
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

  const adaptWithApi = typeof API.adaptProducts === "function"
    ? API.adaptProducts.bind(API)
    : null;

  const ensureFallbackList = typeof API.ensureFallbackList === "function"
    ? API.ensureFallbackList.bind(API)
    : null;

  const adaptCatalog = (rawList) => {
    const fallback = ensureFallbackList ? ensureFallbackList(rawList) : getFallbackList();
    if (adaptWithApi) {
      try {
        const adapted = adaptWithApi(rawList, fallback);
        if (Array.isArray(adapted) && adapted.length) return adapted;
      } catch {}
    }
    return cloneProducts(Array.isArray(rawList) && rawList.length ? rawList : fallback);
  };

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

  let PRODUCTS = [];

  const setProducts = (list) => {
    PRODUCTS = Array.isArray(list) ? list.map(normalizeProduct) : [];
    window.CRONOX_PRODUCTS = PRODUCTS;
  };

  async function ensureCatalog() {
    const globalCatalog = Array.isArray(window.CRONOX_PRODUCTS)
      ? window.CRONOX_PRODUCTS
      : [];
    const hasIdentifiers = globalCatalog.some((p) => p && (p.slug || p.backendId != null));

    if (globalCatalog.length && hasIdentifiers) {
      setProducts(globalCatalog);
      return PRODUCTS;
    }

    try {
      if (!API || typeof API.getProducts !== "function") {
        throw new Error("Cliente API no disponible");
      }
      const raw = await API.getProducts();
      const adapted = adaptCatalog(raw);
      setProducts(adapted);
      return PRODUCTS;
    } catch (error) {
      console.warn("[CRONOX] No se pudo cargar el catálogo en PDP, usando fallback local.", error);
      const fallback = adaptCatalog(getFallbackList());
      setProducts(fallback);
      return PRODUCTS;
    }
  }

  // ==========================
  // Localizar producto por la URL
  // ==========================
  function getProductKey() {
    const url = new URL(window.location.href);
    const slug = url.searchParams.get("slug");
    const id   = url.searchParams.get("id");
    return (slug || id || "").trim();
  }

  // ==========================
  // Galería de imágenes
  // ==========================
  function sanitizeImages(list, fallback) {
    const result = [];
    const push = (src) => {
      const value = typeof src === "string" ? src.trim() : "";
      if (value && !result.includes(value)) result.push(value);
    };
    if (Array.isArray(list)) list.forEach(push);
    push(fallback);
    return result;
  }

  function getActiveImage() {
    if (!pMediaViewport) return null;
    return pMediaViewport.querySelector(".pdp__media-img.is-active");
  }

  function resetZoom() {
    zoomLevel = 0;
    if (pMedia) pMedia.classList.remove("is-zoomed", "is-zoomed-max");
    const active = getActiveImage();
    if (active) {
      active.style.transform = "";
      active.style.transformOrigin = "";
    }
  }

  function updateZoomClass() {
    if (!pMedia) return;
    const canZoom = Boolean(pointerFineQuery?.matches) && galleryImages.length > 0 && !isMobileViewport();
    pMedia.classList.toggle("has-zoom", canZoom);
    if (!canZoom) resetZoom();
  }

  function updateThumbState(activeIndex) {
    if (!pThumbs) return;
    const buttons = pThumbs.querySelectorAll(".pdp__thumb");
    buttons.forEach(btn => {
      const idx = Number(btn.dataset.index);
      const isActive = idx === activeIndex;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-current", isActive ? "true" : "false");
    });
  }

  function showImage(index) {
    if (!pMediaViewport) return;
    const imgs = Array.from(pMediaViewport.querySelectorAll(".pdp__media-img"));
    if (!imgs.length) return;

    const total = imgs.length;
    const normalized = ((index % total) + total) % total;

    imgs.forEach((img, idx) => {
      const isActive = idx === normalized;
      img.classList.toggle("is-active", isActive);
      if (isActive) {
        img.removeAttribute("hidden");
        img.setAttribute("aria-hidden", "false");
      } else {
        img.setAttribute("hidden", "true");
        img.setAttribute("aria-hidden", "true");
      }
    });

    currentImageIndex = normalized;
    updateThumbState(normalized);
    resetZoom();

    const single = total <= 1;
    if (pMediaPrev) pMediaPrev.hidden = single;
    if (pMediaNext) pMediaNext.hidden = single;
  }

  function setupGallery(p) {
    const images = sanitizeImages(p?.images, p?.image);
    galleryImages = images;

    if (!images.length) {
      if (pMediaViewport) pMediaViewport.innerHTML = "";
      if (pThumbs) {
        pThumbs.innerHTML = "";
        pThumbs.hidden = true;
        pThumbs.setAttribute("aria-hidden", "true");
      }
      updateZoomClass();
      return;
    }

    const altBase = p?.name ? String(p.name) : "Producto CRONOX";

    if (pMediaViewport) {
      pMediaViewport.innerHTML = images.map((src, idx) => {
        const activeClass = idx === 0 ? " is-active" : "";
        const hiddenAttr = idx === 0 ? "" : " hidden";
        const idAttr = idx === 0 ? ' id="pImage"' : "";
        const altSuffix = images.length > 1 ? ` — imagen ${idx + 1}` : "";
        const loading = idx === 0 ? "eager" : "lazy";
        return `<img${idAttr} class="pdp__media-img${activeClass}" src="${src}" alt="${altBase}${altSuffix}" loading="${loading}" decoding="async"${hiddenAttr} aria-hidden="${idx === 0 ? "false" : "true"}">`;
      }).join("");
    }

    if (pThumbs) {
      pThumbs.innerHTML = images.map((src, idx) => {
        const activeClass = idx === 0 ? " is-active" : "";
        return `<button type="button" class="pdp__thumb${activeClass}" data-index="${idx}" aria-label="Ver imagen ${idx + 1} de ${images.length}"><img src="${src}" alt="${altBase} miniatura ${idx + 1}" loading="lazy" decoding="async"></button>`;
      }).join("");
      const hideThumbs = images.length <= 1;
      pThumbs.hidden = hideThumbs;
      pThumbs.setAttribute("aria-hidden", hideThumbs ? "true" : "false");
      pThumbs.querySelectorAll(".pdp__thumb").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          if (!Number.isNaN(idx)) showImage(idx);
        });
      });
    }

    updateZoomClass();
    showImage(0);
  }

  if (typeof pointerFineQuery?.addEventListener === "function") {
    pointerFineQuery.addEventListener("change", updateZoomClass);
  } else if (typeof pointerFineQuery?.addListener === "function") {
    pointerFineQuery.addListener(updateZoomClass);
  }

  if (typeof mobileViewportQuery?.addEventListener === "function") {
    mobileViewportQuery.addEventListener("change", updateZoomClass);
  } else if (typeof mobileViewportQuery?.addListener === "function") {
    mobileViewportQuery.addListener(updateZoomClass);
  }

  pMediaPrev?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showImage(currentImageIndex - 1);
  });

  pMediaNext?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showImage(currentImageIndex + 1);
  });

  if (pMedia) {
    const updateOrigin = (event) => {
      const img = getActiveImage();
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const x = rect.width ? ((event.clientX - rect.left) / rect.width) * 100 : 50;
      const y = rect.height ? ((event.clientY - rect.top) / rect.height) * 100 : 50;
      img.style.transformOrigin = `${x}% ${y}%`;
    };

    pMedia.addEventListener("click", (event) => {
      if (isMobileViewport()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!pointerFineQuery?.matches) return;
      if (event.target.closest(".pdp__media-arrow")) return;
      const img = getActiveImage();
      if (!img) return;
      zoomLevel = (zoomLevel + 1) % 3;
      if (zoomLevel === 0) {
        resetZoom();
        return;
      }

      const scale = zoomLevel === 1 ? 2 : 4;
      updateOrigin(event);
      img.style.transform = `scale(${scale})`;
      pMedia.classList.add("is-zoomed");
      pMedia.classList.toggle("is-zoomed-max", zoomLevel === 2);
    });

    pMedia.addEventListener("mousemove", (event) => {
      if (zoomLevel === 0) return;
      updateOrigin(event);
    });

    pMedia.addEventListener("mouseleave", () => {
      if (zoomLevel !== 0) resetZoom();
    });
  }

  // ==========================
  // Tallas
  // ==========================
  function normalizeSizes(list) {
    const arr = Array.isArray(list) && list.length ? list : ["M"];
    const seen = new Set();
    return arr
      .map(s => String(s || "").trim().toUpperCase())
      .filter(s => {
        if (!s) return false;
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      });
  }

  function setupSizeButtons(product) {
    if (!pSizeGroup) return;
    const normalized = normalizeSizes(product?.sizes);
    pSizeGroup.innerHTML = normalized
      .map((size) => {
        const variant = findVariantForSize(product, size);
        const disabled = Boolean(variant) && variant.isAvailable === false;
        return `<button type="button" class="size-btn${disabled ? ' is-disabled' : ''}" data-size="${size}" role="radio" aria-checked="false" ${disabled ? 'disabled' : ''}>${size}</button>`;
      })
      .join("");

    const buttons = Array.from(pSizeGroup.querySelectorAll(".size-btn"));
    if (!buttons.length) {
      selectedSize = "";
      syncAddButtonWidth();
      return;
    }

    const activate = (btn) => {
      buttons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-checked", isActive ? "true" : "false");
        if (isActive) selectedSize = b.dataset.size || "";
      });
    };

    const firstButton = buttons.find((btn) => !btn.disabled) || buttons[0];
    if (firstButton) activate(firstButton);
    else selectedSize = "";

    buttons.forEach(btn => {
      btn.addEventListener("click", () => activate(btn));
    });

    syncAddButtonWidth();
  }

  // ==========================
  // Relacionados
  // ==========================
  function similarityScore(a, b) {
    let score = 0;
    if (a.color && b.color && a.color === b.color) score += 1;
    const ac = Array.isArray(a.categories) ? a.categories : [];
    const bc = Array.isArray(b.categories) ? b.categories : [];
    if (ac.length && bc.length && ac.some(c => bc.includes(c))) score += 2;
    return score;
  }

  function getRelated(current, max = 4) {
    const currentId = current?.id != null ? String(current.id) : "";
    const currentSlug = current?.slug ? String(current.slug) : "";
    const pool = PRODUCTS.filter(x => {
      const pid = x?.id != null ? String(x.id) : "";
      const slug = x?.slug ? String(x.slug) : "";
      return pid !== currentId && (!currentSlug || slug !== currentSlug);
    });
    return pool
      .map(x => ({ p: x, s: similarityScore(current, x) }))
      .sort((u, v) => v.s - u.s)
      .slice(0, max)
      .map(o => o.p);
  }

  function cardHTML(p) {
    const href = p.slug
      ? `/producto.html?slug=${encodeURIComponent(p.slug)}`
      : `/producto.html?id=${encodeURIComponent(p.id)}`;
    const productId = String(p.backendId ?? p.id ?? "");
    return `
      <a class="product-card" href="${href}" aria-label="${p.name}">
        <button class="favorite-toggle" type="button" aria-label="Marcar como favorito" data-product-id="${productId}" data-slug="${p.slug || ''}">
          <span class="icon-star"></span>
        </button>
        <img class="product-img" src="${p.image}" alt="${p.name}" loading="lazy" decoding="async">
        <div class="product-card__info">
          <h3 class="product-name">${p.name}</h3>
          <p class="product-price">${p.priceLabel || money(p.price)}</p>
        </div>
      </a>
    `;
  }

  function renderRelated(current) {
    if (!relatedGrid) return;
    const rel = getRelated(current, 4);
    relatedGrid.innerHTML = rel.map(cardHTML).join("");
    if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.updateDomState === "function") {
      window.CRONOX_FAVORITES.updateDomState();
    }
  }

  // ==========================
  // Render PDP + back suave
  // ==========================
  function render(product) {
    if (!product) {
      if (pName) pName.textContent = "Producto no disponible";
      if (pDesc) pDesc.textContent = "Este producto ya no está activo en la colección.";
      if (pFavoriteToggle) pFavoriteToggle.hidden = true;
      return;
    }

    setupGallery(product);

    if (pName)  pName.textContent  = product.name || "";
    if (pPrice) pPrice.textContent = product.priceLabel || money(product.price);
    if (pDesc)  pDesc.textContent  = product.desc || "";

    if (pFavoriteToggle) {
      const pid = product.backendId ?? product.id ?? "";
      pFavoriteToggle.dataset.productId = String(pid);
      pFavoriteToggle.dataset.slug = product.slug || "";
      pFavoriteToggle.hidden = !pid;
      if (!pFavoriteToggle.dataset.favBound) {
        pFavoriteToggle.dataset.favBound = "1";
        pFavoriteToggle.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.toggleFromButton === "function") {
            window.CRONOX_FAVORITES.toggleFromButton(pFavoriteToggle);
          }
        });
      }
    }

    setupSizeButtons(product);
    setPageTitle(product);
    renderRelated(product);
    if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.updateDomState === "function") {
      window.CRONOX_FAVORITES.updateDomState();
    }
    syncAddButtonWidth();

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  function setupBackLinks(currentId) {
    const links = document.querySelectorAll('a.js-back[href^="index.html#store"]');
    links.forEach(a => {
      a.addEventListener("click", (e) => {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try { sessionStorage.setItem(RETURN_KEY, currentId); } catch {}
        if (prefersReduced) return; // navegación normal

        e.preventDefault();
        document.documentElement.classList.add("page-exit");
        document.body.classList.add("page-exit");
        const href = a.getAttribute("href");
        setTimeout(() => { window.location.href = href; }, 220);
      });
    });
  }

  // ==========================
  // INIT
  // ==========================
  async function init() {
    const key = getProductKey();
    const catalog = await ensureCatalog();

    const cleanedCatalog = catalog.filter((item) => Boolean(item && (item.id || item.slug)));
    if (cleanedCatalog.length !== catalog.length) {
      setProducts(cleanedCatalog);
    }

    const keyLower = String(key || "").trim().toLowerCase();
    let target = cleanedCatalog.find((p) =>
      (p.slug && p.slug.toLowerCase() === keyLower) ||
      String(p.id).toLowerCase() === keyLower ||
      String(p.backendId || "").toLowerCase() === keyLower
    );

    if (!target) {
      console.warn("[CRONOX] Producto no encontrado para clave:", keyLower);
      render(null);
      setupBackLinks("");
      return;
    }

    render(target);

    // botón añadir al carrito
    if (target && pAdd) {
      pAdd.addEventListener("click", () => {
        const normalizedSizes = normalizeSizes(target.sizes);
        const fallbackSize = normalizedSizes[0] || "M";
        const size = (selectedSize || fallbackSize || "M").toUpperCase();
        const variant = findVariantForSize(target, size);

        if (!variant || !variant.id) {
          alert("No hay stock disponible para esa talla ahora mismo.");
          return;
        }

        const image = (Array.isArray(target.images) && target.images[0]) || target.image;

        addToCart({
          id: target.id,
          productId: target.backendId || target.id,
          slug: target.slug,
          name: target.name,
          price: Number(variant.price ?? target.price) || 0,
          priceLabel: variant.priceLabel || target.priceLabel || money(target.price),
          priceCents: variant.priceCents ?? target.priceCents,
          image,
          size,
          color: target.color || (target.colors?.[0]) || "Único",
          qty: 1,
          variantId: variant.id,
        });
        showToast("Añadido al carrito ✓");
      });
    }

    setupBackLinks(String(target ? (target.slug || target.id || "") : ""));
  }

  window.addEventListener("resize", syncAddButtonWidth);

  // OJO: aquí ya no redirigimos nunca a index.html#store.
  init().catch((error) => {
    console.error("[CRONOX] Error inicializando la PDP:", error);
    // si hay error gordo, al menos mostramos mensaje
    render(null);
  });
})();
