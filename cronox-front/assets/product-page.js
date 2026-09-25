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
  const PRODUCT_PLACEHOLDER = window.CRONOX_PRODUCT_PLACEHOLDER || "assets/product-image-unavailable.svg";
  const safeProductImage = (value, fallback = "") => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === "function" ? helper(value, fallback) : fallback;
  };
  const escapeHtml = (value) => {
    const helper = window.CRONOX_SECURITY?.escapeHtml;
    return typeof helper === "function"
      ? helper(value)
      : String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
  };

  // ==========================
  // Utils generales
  // ==========================

  const isMobileViewport = () => Boolean(mobileViewportQuery?.matches);

  const findVariantForSize = (product, size) => {
    if (!product || !size) return null;
    const map = product.variantMap || {};
    const key = window.CRONOX_SIZES?.key?.(size) || String(size).toUpperCase();
    return map[key] || map[key.toLowerCase()] || null;
  };

  const isVariantAvailable = (variant) => {
    if (!variant || variant.id == null || variant.id === "") return false;
    if (variant.isActive === false || variant.isAvailable === false) return false;
    const stock = variant.stockQty ?? variant.stock;
    return stock == null || (Number.isFinite(Number(stock)) && Number(stock) > 0);
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
      if (document.querySelector('meta[name="cronox-seo"][content="server"]')) return;
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
    return new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent("cronox:addToCart", { detail: { ...item, onComplete: resolve } }));
    });
  }

  // ==========================
  // Catálogo obtenido de la API
  // ==========================

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

  const adaptCatalog = (rawList) => {
    return cloneProducts(Array.isArray(rawList) ? rawList : []);
  };

  const normalizeProduct = (product) => {
    const copy = cloneProduct(product || {});
    const backendId = copy.backendId != null
      ? copy.backendId
      : (copy.id != null ? copy.id : undefined);
    const id = copy.id != null
      ? String(copy.id)
      : (backendId != null ? String(backendId) : "");

    const normalizedImages = sanitizeImages(copy.images, copy.image);
    const primaryImage = normalizedImages[0] || (typeof copy.image === "string" ? copy.image : "");

    return {
      ...copy,
      id,
      backendId: backendId != null ? backendId : undefined,
      slug: copy.slug || undefined,
      images: normalizedImages,
      image: primaryImage,
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

    const authoritative = globalCatalog.every((product) =>
      product?.__fromBackend === true || product?.backendId != null);
    if (globalCatalog.length && hasIdentifiers && authoritative) {
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
      console.warn("[CRONOX] pdp_catalog_load_failed");
      setProducts([]);
      return PRODUCTS;
    }
  }

  // ==========================
  // Localizar producto por la URL
  // ==========================
  function getProductKey() {
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.replace(/\/+$/, "").match(/^\/producto\/([^/]+)$/);
    let pathSlug = "";
    if (pathMatch?.[1]) {
      try {
        pathSlug = decodeURIComponent(pathMatch[1]);
      } catch {
        pathSlug = pathMatch[1];
      }
    }
    const slug = url.searchParams.get("slug");
    const id   = url.searchParams.get("id");
    return (pathSlug || slug || id || "").trim();
  }

  function setCanonicalProductUrl(product) {
    const slug = String(product?.slug || "").trim();
    const path = slug
      ? `/producto/${encodeURIComponent(slug)}`
      : window.location.pathname;
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = new URL(path, 'https://cronox.es/').href;
  }

  // ==========================
  // Galería de imágenes
  // ==========================
  function sanitizeImages(list, fallback) {
    const result = [];
    const push = (candidate) => {
      const source = candidate && typeof candidate === "object" ? candidate : { url: candidate };
      const value = safeProductImage(source.url || source.imageUrl || candidate);
      if (value && !result.some(item => item.url === value)) {
        result.push({
          url: value,
          alt: String(source.alt || ""),
          variants: source.variants || null,
          width: Number(source.width) || null,
          height: Number(source.height) || null,
          galleryPositionX: Math.min(100, Math.max(0, Number(source.galleryPositionX ?? 50))),
          galleryPositionY: Math.min(100, Math.max(0, Number(source.galleryPositionY ?? 50))),
          galleryZoom: Math.min(3, Math.max(0.5, Number(source.galleryZoom ?? 1))),
          galleryFit: String(source.galleryFit || "CONTAIN").toUpperCase() === "COVER" ? "cover" : "contain",
        });
      }
    };
    if (Array.isArray(list)) list.forEach(push);
    push(fallback);
    if (!result.length) push(PRODUCT_PLACEHOLDER);
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
      applyGalleryFraming(active, galleryImages[currentImageIndex]);
    }
  }

  function applyGalleryFraming(image, item) {
    if (!image || !item) return;
    image.style.objectFit = item.galleryFit || "contain";
    image.style.objectPosition = `${item.galleryPositionX}% ${item.galleryPositionY}%`;
    image.style.transformOrigin = `${item.galleryPositionX}% ${item.galleryPositionY}%`;
    image.style.transform = `scale(${item.galleryZoom})`;
  }

  function installImageFallback(image, item) {
    if (!image) return;
    let triedOriginal = false;
    image.addEventListener("error", () => {
      if (!triedOriginal && item.url && item.url !== PRODUCT_PLACEHOLDER &&
          (image.hasAttribute("srcset") || image.getAttribute("src") !== item.url)) {
        triedOriginal = true;
        image.removeAttribute("srcset"); image.removeAttribute("sizes");
        image.src = item.url;
      } else if (image.getAttribute("src") !== PRODUCT_PLACEHOLDER) {
        image.removeAttribute("srcset"); image.removeAttribute("sizes");
        image.src = PRODUCT_PLACEHOLDER;
      }
    });
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
    applyGalleryFraming(imgs[normalized], galleryImages[normalized]);

    const single = total <= 1;
    if (pMediaPrev) pMediaPrev.hidden = single;
    if (pMediaNext) pMediaNext.hidden = single;
  }

  function setupGallery(p) {
    const images = sanitizeImages(p?.galleryImages?.length ? p.galleryImages : p?.images, p?.image);
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
      pMediaViewport.innerHTML = images.map((item, idx) => {
        const activeClass = idx === 0 ? " is-active" : "";
        const hiddenAttr = idx === 0 ? "" : " hidden";
        const idAttr = idx === 0 ? ' id="pImage"' : "";
        const altSuffix = images.length > 1 ? ` — imagen ${idx + 1}` : "";
        const loading = idx === 0 ? "eager" : "lazy";
        const alt = item.alt || `${altBase}${altSuffix}`;
        const resolved = window.CRONOX_IMAGES?.resolve(item, "pdp") || { src: item.url, srcset: "", sizes: "" };
        const responsive = resolved.srcset ? ` srcset="${escapeHtml(resolved.srcset)}" sizes="${escapeHtml(resolved.sizes)}"` : "";
        const dimensions = resolved.width && resolved.height ? ` width="${resolved.width}" height="${resolved.height}"` : "";
        return `<img${idAttr} class="pdp__media-img${activeClass}" src="${escapeHtml(resolved.src)}"${responsive}${dimensions} alt="${escapeHtml(alt)}" loading="${loading}" decoding="async"${hiddenAttr} aria-hidden="${idx === 0 ? "false" : "true"}">`;
      }).join("");
      pMediaViewport.querySelectorAll(".pdp__media-img").forEach((image, idx) => {
        window.CRONOX_IMAGES?.apply(image, images[idx], "pdp");
        installImageFallback(image, images[idx]);
        image.addEventListener("load", () => applyGalleryFraming(image, images[idx]));
        applyGalleryFraming(image, images[idx]);
      });
    }

    if (pThumbs) {
      pThumbs.innerHTML = images.map((item, idx) => {
        const activeClass = idx === 0 ? " is-active" : "";
        const resolved = window.CRONOX_IMAGES?.resolve(item, "small") || { src: item.url, srcset: "", sizes: "" };
        return `<button type="button" class="pdp__thumb${activeClass}" data-index="${idx}" aria-label="Ver imagen ${idx + 1} de ${images.length}"><img src="${escapeHtml(resolved.src)}"${resolved.srcset ? ` srcset="${escapeHtml(resolved.srcset)}" sizes="${escapeHtml(resolved.sizes)}"` : ""} alt="" loading="lazy" decoding="async"></button>`;
      }).join("");
      const hideThumbs = images.length <= 1;
      pThumbs.hidden = hideThumbs;
      pThumbs.setAttribute("aria-hidden", hideThumbs ? "true" : "false");
      pThumbs.querySelectorAll(".pdp__thumb").forEach(btn => {
        const imageIndex = Number(btn.dataset.index);
        const image = btn.querySelector("img");
        window.CRONOX_IMAGES?.apply(image, images[imageIndex], "small");
        installImageFallback(image, images[imageIndex]);
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

      const savedZoom = Number(galleryImages[currentImageIndex]?.galleryZoom || 1);
      const scale = savedZoom * (zoomLevel === 1 ? 2 : 4);
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
      .map(s => window.CRONOX_SIZES?.key?.(s) || String(s || "").trim().toUpperCase())
      .filter(s => {
        if (!s) return false;
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      })
      .sort((left, right) => (window.CRONOX_SIZES?.order?.(left) ?? 0) - (window.CRONOX_SIZES?.order?.(right) ?? 0));
  }

  function setupSizeButtons(product) {
    if (!pSizeGroup) return;
    selectedSize = "";
    const normalized = normalizeSizes(product?.sizes);
    pSizeGroup.innerHTML = normalized
      .map((size) => {
        const variant = findVariantForSize(product, size);
        const unavailable = window.CRONOX_STOCK?.classifyStock(window.CRONOX_STOCK.availableStock(product.variants)) === 'out_of_stock' || !isVariantAvailable(variant);
        const displaySize = window.CRONOX_SIZES?.label?.(size) || size;
        const label = unavailable ? `${displaySize}, no disponible` : displaySize;
        return `<button type="button" class="size-btn${unavailable ? ' is-unavailable' : ''}" data-size="${escapeHtml(size)}" role="radio" aria-label="${escapeHtml(label)}" aria-checked="false" aria-disabled="${unavailable ? 'true' : 'false'}" ${unavailable ? 'disabled' : ''}>${escapeHtml(displaySize)}</button>`;
      })
      .join("");

    const buttons = Array.from(pSizeGroup.querySelectorAll(".size-btn"));
    if (!buttons.length) {
      selectedSize = "";
      if (pAdd) {
        pAdd.disabled = true;
        pAdd.setAttribute("aria-disabled", "true");
      }
      syncAddButtonWidth();
      return;
    }

    const activate = (btn) => {
      if (!btn) return;
      buttons.forEach(b => {
        const isActive = b === btn;
        b.classList.toggle("is-active", isActive);
        b.setAttribute("aria-checked", isActive ? "true" : "false");
        if (isActive) selectedSize = b.dataset.size || "";
      });
      const variant = findVariantForSize(product, selectedSize);
      if (pPrice) pPrice.textContent = variant?.priceLabel || money(variant?.price ?? product.price);
      if (pAdd) {
        pAdd.disabled = !isVariantAvailable(variant);
        pAdd.setAttribute('aria-disabled', pAdd.disabled ? 'true' : 'false');
      }
    };

    const requestedSize = new URLSearchParams(location.search).get('size')?.toUpperCase();
    const firstButton = buttons.find(btn => String(btn.dataset.size).toUpperCase() === requestedSize) || buttons.find((btn) => !btn.disabled);
    if (firstButton) activate(firstButton);
    else selectedSize = "";

    if (pAdd) {
      pAdd.disabled = !firstButton || firstButton.disabled;
      pAdd.setAttribute("aria-disabled", pAdd.disabled ? "true" : "false");
    }

    buttons.forEach(btn => {
      btn.addEventListener("click", () => activate(btn));
    });

    syncAddButtonWidth();
  }

  // ==========================
  // Relacionados
  // ==========================
  function getRelated(current, max = 2) {
    const currentId = current?.id != null ? String(current.id) : "";
    const currentSlug = current?.slug ? String(current.slug) : "";
    const pool = PRODUCTS.filter((item) => {
      const pid = item?.id != null ? String(item.id) : "";
      const slug = item?.slug ? String(item.slug) : "";
      const isSameId = currentId && pid === currentId;
      const isSameSlug = currentSlug && slug === currentSlug;
      return !isSameId && !isSameSlug;
    });
    return pool.slice(0, max);
  }

  function buildRelatedCard(product) {
    if (typeof window.CRONOX_createProductCard !== "function") return null;
    return window.CRONOX_createProductCard(product);
  }

  function renderRelated(current) {
    if (!relatedGrid) return;
    const rel = getRelated(current, 2);
    relatedGrid.innerHTML = "";
    rel.forEach((p) => {
      const card = buildRelatedCard(p);
      if (card) {
        card.querySelectorAll("img.product-img").forEach((image) => {
        });
        relatedGrid.appendChild(card);
      }
    });
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
      if (pAdd) {
        pAdd.disabled = true;
        pAdd.setAttribute("aria-disabled", "true");
      }
      return;
    }

    setupGallery(product);

    if (pName)  pName.textContent  = product.name || "";
    if (pPrice) pPrice.textContent = product.priceLabel || money(product.price);
    const details = document.getElementById('pDetails');
    const description = product.description ?? product.desc ?? '';
    if (details) {
      details.replaceChildren(...String(description).split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean).map(line => {
        const item = document.createElement('li');
        item.textContent = line;
        return item;
      }));
    }
    if (pDesc) { pDesc.textContent = ''; pDesc.hidden = true; }

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

    window.CRONOX_WAITLIST?.mount(product, pAdd?.closest('.pdp__actions') || pSizeGroup);
    if (pPrice && pAdd) window.CRONOX_STOCK?.decoratePurchase(pPrice, pAdd, product);
    // A directly linked size owns the displayed price and purchase availability.
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
    const links = document.querySelectorAll('a.js-back[href^="/tienda#store"]');
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

    // A product must not disappear merely because it is beyond the first catalogue page.
    if (!target && key && typeof API.getProductBySlug === 'function') {
      try {
        const direct = await API.getProductBySlug(key);
        if (direct) target = normalizeProduct(direct);
      } catch {
        if (document.querySelector('#cronox-seo')) return; // retain valid server content during a transient API failure
      }
    }

    if (!target) {
      console.warn("[CRONOX] Producto no encontrado para clave:", keyLower);
      setCanonicalProductUrl(null);
      render(null);
      setupBackLinks("");
      return;
    }

    setCanonicalProductUrl(target);
    render(target);
    try {
      window.dispatchEvent(new CustomEvent("cronox:productViewed", {
        detail: { productId: Number(target.backendId) || null },
      }));
    } catch {}

    // botón añadir al carrito
    if (target && pAdd) {
      pAdd.addEventListener("click", async () => {
        if (pAdd.disabled || window.CRONOX_STOCK?.classifyStock(window.CRONOX_STOCK.availableStock(target.variants)) === 'out_of_stock') return;
        const size = window.CRONOX_SIZES?.label?.(selectedSize) || selectedSize.toUpperCase();
        const variant = findVariantForSize(target, size);

        if (!size || !isVariantAvailable(variant)) {
          alert("No hay stock disponible para esa talla ahora mismo.");
          return;
        }

        const image = (Array.isArray(target.images) && target.images[0]) || target.image;
        pAdd.disabled = true;
        const previousLabel = pAdd.textContent;
        pAdd.textContent = 'Añadiendo…';
        const added = await addToCart({
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
        pAdd.disabled = false;
        pAdd.textContent = previousLabel;
        showToast(added ? 'Añadido al carrito ✓' : 'No se pudo añadir. Vuelve a intentarlo.');
      });
    }

    setupBackLinks(String(target ? (target.slug || target.id || "") : ""));
  }

  window.addEventListener("resize", syncAddButtonWidth);

  // La PDP conserva su URL limpia incluso cuando falla la carga del catálogo.
  init().catch((error) => {
    console.error("[CRONOX] Error inicializando la PDP:", error);
    // si hay error gordo, al menos mostramos mensaje
    render(null);
  });
})();
