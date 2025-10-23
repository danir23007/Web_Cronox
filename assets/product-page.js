// ====================================================== 
// assets/product-page.js — PDP + carrito + relacionados + back suave + marca de retorno
// CRONOX
// ======================================================
(function () {
  const CART_KEY = "cronox_cart";
  const RETURN_KEY = "cronox_scroll_to"; // <- aquí guardamos el id para volver

  // --- Referencias principales ---
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
  const toast  = document.getElementById("toast");
  const relatedGrid = document.getElementById("relatedGrid");

  let selectedSize = "";
  let galleryImages = [];
  let currentImageIndex = 0;
  let zoomLevel = 0;
  const pointerFineQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: fine)")
    : { matches: false };

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

  // --- Catálogo (inyectado desde index o fallback local del HTML) ---
  const PRODUCTS = Array.isArray(window.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : [];

  // --- Utils ---
  function getId() {
    try { return new URL(window.location.href).searchParams.get("id") || ""; }
    catch { return ""; }
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

  // --- Carrito ---
  function addToCart(item) {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const cart = raw ? JSON.parse(raw) : [];
      const idx = cart.findIndex(x => x.id === item.id && x.size === item.size);
      if (idx >= 0) {
        cart[idx].qty = (Number(cart[idx].qty) || 0) + (Number(item.qty) || 1);
      } else {
        cart.push({ ...item, qty: Number(item.qty) || 1 });
      }
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      window.dispatchEvent(new Event("cart:updated"));
    } catch (e) {
      console.error("[CRONOX] Error guardando en carrito:", e);
      alert("No se pudo guardar el carrito en este navegador.");
    }
  }
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // --- Relacionados ---
  function similarityScore(a, b) {
    let score = 0;
    if (a.color && b.color && a.color === b.color) score += 1;
    const ac = Array.isArray(a.categories) ? a.categories : [];
    const bc = Array.isArray(b.categories) ? b.categories : [];
    if (ac.length && bc.length && ac.some(c => bc.includes(c))) score += 2;
    return score;
  }
  function getRelated(current, max = 4) {
    const pool = PRODUCTS.filter(x => x.id !== current.id);
    return pool
      .map(x => ({ p: x, s: similarityScore(current, x) }))
      .sort((u, v) => v.s - u.s)
      .slice(0, max)
      .map(o => o.p);
  }
  function cardHTML(p) {
    return `
      <a class="product-card" href="producto.html?id=${encodeURIComponent(p.id)}" aria-label="${p.name}">
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
  }

  // --- Render PDP ---
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

  function sanitizeImages(list, fallback) {
    const result = [];
    const push = (src) => {
      const value = typeof src === "string" ? src.trim() : "";
      if (value && !result.includes(value)) {
        result.push(value);
      }
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
    const canZoom = Boolean(pointerFineQuery?.matches) && galleryImages.length > 0;
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
          if (!Number.isNaN(idx)) {
            showImage(idx);
          }
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
      if (zoomLevel !== 0) {
        resetZoom();
      }
    });
  }

  function setupSizeButtons(sizes) {
    if (!pSizeGroup) return;
    const normalized = normalizeSizes(sizes);
    pSizeGroup.innerHTML = normalized
      .map(size => `<button type="button" class="size-btn" data-size="${size}" role="radio" aria-checked="false">${size}</button>`)
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

    activate(buttons[0]);
    buttons.forEach(btn => {
      btn.addEventListener("click", () => activate(btn));
    });

    syncAddButtonWidth();
  }

  function render(p) {
    if (!p) return;

    setupGallery(p);
    if (pName)  pName.textContent  = p.name || "";
    if (pPrice) pPrice.textContent = p.priceLabel || money(p.price);
    if (pDesc)  pDesc.textContent  = p.desc || "";

    setupSizeButtons(p.sizes);

    setPageTitle(p);
    renderRelated(p);

    syncAddButtonWidth();

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  // --- Back suave (fade-out) + guardar id para volver ---
  function setupBackLinks(currentId) {
    const links = document.querySelectorAll('a.js-back[href^="index.html#store"]');
    links.forEach(a => {
      a.addEventListener("click", (e) => {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Guarda el id para reposicionar en la tienda
        try { sessionStorage.setItem(RETURN_KEY, currentId); } catch {}
        if (prefersReduced) return; // navegación normal sin fade

        e.preventDefault();
        document.documentElement.classList.add("page-exit");
        document.body.classList.add("page-exit");
        const href = a.getAttribute("href");
        setTimeout(() => { window.location.href = href; }, 220);
      });
    });
  }

  // --- Init ---
  function init() {
    const id = getId();
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) {
      window.location.replace("index.html#store");
      return;
    }

    render(p);

    pAdd?.addEventListener("click", () => {
      const fallbackSize = normalizeSizes(p.sizes)[0] || "M";
      const size = selectedSize || fallbackSize;
      addToCart({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        priceLabel: p.priceLabel || money(p.price),
        image: p.image,
        size,
        qty: 1
      });
      showToast("Añadido al carrito ✓");
    });

    setupBackLinks(p.id);
  }

  window.addEventListener("resize", syncAddButtonWidth);

  init();
})();
