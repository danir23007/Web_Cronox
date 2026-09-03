(function () {
  "use strict";

  if (window.CRONOX_GALLERY?.initialized === true) return;

  const galleryItems = [
    { key: "featured", color: "grey", featured: true },
    { key: "slot-01", color: "white" },
    { key: "slot-02", color: "red" },
    { key: "slot-03", color: "grey" },
    { key: "slot-04", color: "white" },
    { key: "slot-05", color: "grey" },
    { key: "slot-06", color: "white" },
    { key: "slot-07", color: "red" },
    { key: "slot-08", color: "grey" },
    { key: "slot-09", color: "red" },
    { key: "slot-10", color: "grey" },
    { key: "slot-11", color: "white" },
    { key: "slot-12", color: "red" },
  ];
  const placeholderColors = new Set(["white", "red", "grey"]);
  const pageDocument = window.document;
  const galleryRoots = Array.from(
    pageDocument.querySelectorAll("[data-gallery-root]"),
  );
  let galleryLoadPromise = null;
  let loadedGalleryItems = null;

  const lightboxElements = {
    root: pageDocument.getElementById("galleryLightbox"),
    close: pageDocument.getElementById("galleryLightboxClose"),
    previous: pageDocument.getElementById("galleryLightboxPrevious"),
    next: pageDocument.getElementById("galleryLightboxNext"),
    stage: pageDocument.getElementById("galleryLightboxStage"),
    image: pageDocument.getElementById("galleryLightboxImage"),
    loading: pageDocument.getElementById("galleryLightboxLoading"),
    info: pageDocument.getElementById("galleryLightboxInfo"),
    products: pageDocument.getElementById("galleryLightboxProducts"),
    description: pageDocument.getElementById("galleryLightboxDescription"),
    instagramInfo: pageDocument.getElementById("galleryLightboxInstagramInfo"),
    instagramOverlay: pageDocument.getElementById(
      "galleryLightboxInstagramOverlay",
    ),
  };
  const lightboxState = {
    items: [],
    index: -1,
    trigger: null,
    scrollY: 0,
    bodyStyles: null,
    background: [],
    imageRequest: 0,
  };

  const getInstagramPostUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      const hostname = url.hostname.toLowerCase();
      const pathParts = url.pathname.split("/").filter(Boolean);
      const isInstagramHost = [
        "instagram.com",
        "www.instagram.com",
        "m.instagram.com",
      ].includes(hostname);
      const isPostPath =
        ["p", "reel", "tv"].includes(pathParts[0]) &&
        /^[A-Za-z0-9_-]+$/.test(pathParts[1] || "");
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !isInstagramHost ||
        !isPostPath
      ) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  };

  const getImageUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim(), window.location.origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return "";
      }
      return value.trim();
    } catch {
      return "";
    }
  };

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : fallback;
  };

  const normalizeFrame = (value) => {
    if (!value || typeof value !== "object") return null;
    const fit = String(value.fit || "").toUpperCase();
    if (!["COVER", "CONTAIN"].includes(fit)) return null;
    return {
      focalX: clamp(value.focalX, 0, 100, 50),
      focalY: clamp(value.focalY, 0, 100, 50),
      zoom: clamp(value.zoom, 1, 3, 1),
      fit,
    };
  };

  const fitLightboxImage = (naturalWidth, naturalHeight, hasInfo) => {
    const viewportWidth = Math.max(
      1,
      window.innerWidth || pageDocument.documentElement.clientWidth || 1,
    );
    const viewportHeight = Math.max(
      1,
      window.innerHeight || pageDocument.documentElement.clientHeight || 1,
    );
    const mobile = viewportWidth <= 767;
    const sidebarWidth = hasInfo
      ? Math.min(320, Math.max(290, viewportWidth * 0.18))
      : 0;
    const mobileInlineSpace = viewportWidth <= 420 ? 72 : 88;
    const availableWidth = Math.max(
      1,
      mobile
        ? viewportWidth - mobileInlineSpace
        : viewportWidth - 112 - sidebarWidth,
    );
    const availableHeight = Math.max(1, viewportHeight - (mobile ? 96 : 112));
    const scale = Math.min(
      1,
      availableWidth / naturalWidth,
      availableHeight / naturalHeight,
    );

    return {
      width: naturalWidth * scale,
      height: naturalHeight * scale,
    };
  };

  const applyLightboxDimensions = () => {
    const image = lightboxElements.image;
    const root = lightboxElements.root;
    if (!image?.naturalWidth || !image?.naturalHeight || !root) return false;
    const dimensions = fitLightboxImage(
      image.naturalWidth,
      image.naturalHeight,
      root.classList.contains("has-info"),
    );
    root.style.setProperty(
      "--gallery-lightbox-image-width",
      `${dimensions.width.toFixed(3)}px`,
    );
    root.style.setProperty(
      "--gallery-lightbox-image-height",
      `${dimensions.height.toFixed(3)}px`,
    );
    return true;
  };

  const normalizeProduct = (product) => {
    const id = Number(product?.id);
    const name = typeof product?.name === "string" ? product.name.trim() : "";
    if (!Number.isInteger(id) || id < 1 || !name) return null;
    const slug = typeof product?.slug === "string" ? product.slug.trim() : "";
    const price = Number(product?.price);
    const currency = /^[A-Z]{3}$/.test(String(product?.currency || ""))
      ? String(product.currency)
      : "EUR";
    return {
      id,
      slug,
      name,
      price: Number.isFinite(price) && price >= 0 ? price : null,
      currency,
      imageUrl: getImageUrl(product?.imageUrl),
      available: product?.available === true,
    };
  };

  const formatPrice = (price, currency) => {
    if (!Number.isFinite(price)) return "";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency,
      }).format(price / 100);
    } catch {
      return `${(price / 100).toFixed(2)} €`;
    }
  };

  const normalizeItem = (fallback, slot = {}) => ({
    key: fallback.key,
    featured: fallback.featured === true,
    color: placeholderColors.has(slot.placeholderColor)
      ? slot.placeholderColor
      : fallback.color,
    imageSrc: getImageUrl(slot.imageSrc),
    alt: typeof slot.alt === "string" ? slot.alt : "",
    instagramUrl: getInstagramPostUrl(slot.instagramUrl),
    focalX: clamp(slot.focalX, 0, 100, 50),
    focalY: clamp(slot.focalY, 0, 100, 50),
    zoom: clamp(slot.zoom, 1, 3, 1),
    fit: ["COVER", "CONTAIN"].includes(String(slot.fit || "").toUpperCase())
      ? String(slot.fit).toUpperCase()
      : "COVER",
    tablet: normalizeFrame(slot.tablet),
    mobile: normalizeFrame(slot.mobile),
    description: typeof slot.description === "string" ? slot.description : "",
    products: (Array.isArray(slot.products) ? slot.products : [])
      .map(normalizeProduct)
      .filter(Boolean),
  });

  const productUrl = (product) =>
    product.available && product.slug
      ? `/producto.html?slug=${encodeURIComponent(product.slug)}`
      : "";

  const renderProductCard = (product) => {
    const href = productUrl(product);
    const card = pageDocument.createElement(href ? "a" : "article");
    card.className = `gallery-lightbox__product${href ? "" : " gallery-lightbox__product--unavailable"}`;
    if (href) card.href = href;

    const media = pageDocument.createElement("span");
    media.className = "gallery-lightbox__product-media";
    if (product.imageUrl) {
      const image = pageDocument.createElement("img");
      image.src = product.imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      media.appendChild(image);
    }

    const content = pageDocument.createElement("span");
    content.className = "gallery-lightbox__product-content";
    const name = pageDocument.createElement("strong");
    name.className = "gallery-lightbox__product-name";
    name.textContent = product.name;
    content.appendChild(name);
    if (product.price !== null) {
      const price = pageDocument.createElement("span");
      price.className = "gallery-lightbox__product-price";
      price.textContent = formatPrice(product.price, product.currency);
      content.appendChild(price);
    }
    const action = pageDocument.createElement("span");
    action.className = "gallery-lightbox__product-action";
    action.textContent = href ? "VER PRODUCTO" : "NO DISPONIBLE";
    content.appendChild(action);
    card.append(media, content);
    return card;
  };

  const updateLightbox = () => {
    const item = lightboxState.items[lightboxState.index];
    if (!item || !lightboxElements.root) return;
    const requestId = ++lightboxState.imageRequest;
    const description = String(item.description || "").trim();
    const products = Array.isArray(item.products) ? item.products : [];
    const hasInfo = products.length > 0 || Boolean(description);
    const instagramUrl = getInstagramPostUrl(item.instagramUrl);

    lightboxElements.root.setAttribute("aria-busy", "true");
    lightboxElements.root.classList.remove("is-image-ready", "is-image-error");
    lightboxElements.image.removeAttribute("src");
    lightboxElements.image.alt = item.alt || "Imagen de la galería CRONOX";
    lightboxElements.products.replaceChildren(
      ...products.map(renderProductCard),
    );
    lightboxElements.products.hidden = products.length === 0;
    lightboxElements.description.textContent = description;
    lightboxElements.description.hidden = !description;
    lightboxElements.info.hidden = !hasInfo;
    lightboxElements.root.classList.toggle("has-info", hasInfo);

    [lightboxElements.instagramInfo, lightboxElements.instagramOverlay].forEach(
      (link) => {
        link.hidden = true;
        link.removeAttribute("href");
      },
    );
    const instagramControl = hasInfo
      ? lightboxElements.instagramInfo
      : lightboxElements.instagramOverlay;
    if (instagramUrl) {
      instagramControl.href = instagramUrl;
      instagramControl.hidden = false;
    }

    const hasMultiple = lightboxState.items.length > 1;
    lightboxElements.previous.hidden = !hasMultiple;
    lightboxElements.next.hidden = !hasMultiple;
    lightboxElements.loading.textContent = "Cargando imagen…";
    lightboxElements.image.loading = "eager";
    lightboxElements.image.decoding = "async";

    const ready = () => {
      if (requestId !== lightboxState.imageRequest) return;
      applyLightboxDimensions();
      lightboxElements.root.classList.add("is-image-ready");
      lightboxElements.root.setAttribute("aria-busy", "false");
    };
    const failed = () => {
      if (requestId !== lightboxState.imageRequest) return;
      lightboxElements.root.classList.add("is-image-error");
      lightboxElements.loading.textContent = "No se pudo cargar la imagen.";
      lightboxElements.root.setAttribute("aria-busy", "false");
    };
    lightboxElements.image.onload = ready;
    lightboxElements.image.onerror = failed;
    lightboxElements.image.src = item.imageSrc;
    if (typeof lightboxElements.image.decode === "function") {
      lightboxElements.image
        .decode()
        .then(ready)
        .catch(() => undefined);
    }
  };

  const lockBackground = () => {
    lightboxState.scrollY = window.scrollY || window.pageYOffset || 0;
    const style = pageDocument.body.style;
    lightboxState.bodyStyles = {
      position: style.position,
      top: style.top,
      width: style.width,
      overflow: style.overflow,
    };
    style.position = "fixed";
    style.top = `-${lightboxState.scrollY}px`;
    style.width = "100%";
    style.overflow = "hidden";
    lightboxState.background = Array.from(pageDocument.body.children)
      .filter((element) => element !== lightboxElements.root)
      .map((element) => ({
        element,
        inert: Boolean(element.inert),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    lightboxState.background.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
  };

  const unlockBackground = () => {
    lightboxState.background.forEach(({ element, inert, ariaHidden }) => {
      element.inert = inert;
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    });
    lightboxState.background = [];
    const previous = lightboxState.bodyStyles || {};
    pageDocument.body.style.position = previous.position || "";
    pageDocument.body.style.top = previous.top || "";
    pageDocument.body.style.width = previous.width || "";
    pageDocument.body.style.overflow = previous.overflow || "";
    lightboxState.bodyStyles = null;
    try {
      window.scrollTo(0, lightboxState.scrollY);
    } catch {
      // Some non-browser DOM environments do not implement scroll restoration.
    }
  };

  const openLightbox = (item, trigger, allItems) => {
    if (!item?.imageSrc || !lightboxElements.root) return;
    const occupied = (Array.isArray(allItems) ? allItems : []).filter(
      (candidate) => candidate?.imageSrc,
    );
    const index = occupied.findIndex((candidate) => candidate.key === item.key);
    if (index < 0) return;
    lightboxState.items = occupied;
    lightboxState.index = index;
    lightboxState.trigger = trigger;
    lockBackground();
    lightboxElements.root.hidden = false;
    lightboxElements.root.setAttribute("aria-hidden", "false");
    pageDocument.body.classList.add("gallery-lightbox-open");
    updateLightbox();
    lightboxElements.close.focus();
  };

  const closeLightbox = () => {
    if (!lightboxElements.root || lightboxElements.root.hidden) return;
    ++lightboxState.imageRequest;
    lightboxElements.image.removeAttribute("src");
    lightboxElements.root.hidden = true;
    lightboxElements.root.setAttribute("aria-hidden", "true");
    lightboxElements.root.classList.remove("is-image-ready", "is-image-error");
    pageDocument.body.classList.remove("gallery-lightbox-open");
    unlockBackground();
    const trigger = lightboxState.trigger;
    lightboxState.items = [];
    lightboxState.index = -1;
    lightboxState.trigger = null;
    if (trigger?.isConnected && typeof trigger.focus === "function") {
      trigger.focus();
    }
  };

  const navigateLightbox = (offset) => {
    if (lightboxState.items.length < 2) return;
    lightboxState.index =
      (lightboxState.index + offset + lightboxState.items.length) %
      lightboxState.items.length;
    updateLightbox();
  };

  const createGalleryTile = (item = {}, onOpen) => {
    const imageSource = getImageUrl(item.imageSrc);
    const featuredClass =
      item.featured === true ? " gallery__tile--featured" : "";

    if (imageSource) {
      const alt =
        typeof item.alt === "string" && item.alt.trim()
          ? item.alt.trim()
          : "Imagen de la galería CRONOX";
      const tile = pageDocument.createElement("button");
      tile.type = "button";
      tile.className = `gallery__tile gallery__tile--image gallery__tile--trigger${featuredClass}`;
      tile.dataset.gallerySlot = item.key || "";
      tile.draggable = false;
      tile.setAttribute("aria-haspopup", "dialog");
      tile.setAttribute("aria-label", `Abrir en pantalla completa: ${alt}`);
      tile.style.setProperty("--desktop-focal-x", `${clamp(item.focalX, 0, 100, 50)}%`);
      tile.style.setProperty("--desktop-focal-y", `${clamp(item.focalY, 0, 100, 50)}%`);
      tile.style.setProperty("--desktop-zoom", String(clamp(item.zoom, 1, 3, 1)));
      tile.style.setProperty("--desktop-fit", String(item.fit || "COVER").toLowerCase());
      tile.style.setProperty("--focal-x", `${clamp(item.focalX, 0, 100, 50)}%`);
      tile.style.setProperty("--focal-y", `${clamp(item.focalY, 0, 100, 50)}%`);
      tile.style.setProperty("--zoom", String(clamp(item.zoom, 1, 3, 1)));
      if (item.tablet) {
        tile.style.setProperty("--tablet-focal-x", `${item.tablet.focalX}%`);
        tile.style.setProperty("--tablet-focal-y", `${item.tablet.focalY}%`);
        tile.style.setProperty("--tablet-zoom", String(item.tablet.zoom));
        tile.style.setProperty("--tablet-fit", item.tablet.fit.toLowerCase());
      }
      if (item.mobile) {
        tile.style.setProperty("--mobile-focal-x", `${item.mobile.focalX}%`);
        tile.style.setProperty("--mobile-focal-y", `${item.mobile.focalY}%`);
        tile.style.setProperty("--mobile-zoom", String(item.mobile.zoom));
        tile.style.setProperty("--mobile-fit", item.mobile.fit.toLowerCase());
      }
      tile.addEventListener("click", () => onOpen?.(item, tile));

      const image = pageDocument.createElement("img");
      image.src = imageSource;
      image.alt = alt;
      image.decoding = "async";
      image.draggable = false;

      const media = pageDocument.createElement("span");
      media.className = "gallery__media";
      media.appendChild(image);
      tile.appendChild(media);
      return tile;
    }

    const color = placeholderColors.has(item.color) ? item.color : "grey";
    const tile = pageDocument.createElement("div");
    tile.className = `gallery__tile gallery__tile--placeholder gallery__tile--${color}${featuredClass}`;
    tile.dataset.gallerySlot = item.key || "";
    tile.setAttribute("aria-hidden", "true");
    return tile;
  };

  const renderGallery = (items = galleryItems, root) => {
    if (!root) {
      galleryRoots.forEach((galleryRoot) => renderGallery(items, galleryRoot));
      return;
    }
    const normalizedItems = Array.isArray(items) ? items : galleryItems;
    const fragment = pageDocument.createDocumentFragment();
    normalizedItems.forEach((item) =>
      fragment.appendChild(
        createGalleryTile(item, (selected, trigger) =>
          openLightbox(selected, trigger, normalizedItems),
        ),
      ),
    );
    root.replaceChildren(fragment);
  };

  const normalizeApiSlots = (slots) => {
    if (!Array.isArray(slots))
      throw new Error("Respuesta de galería no válida");
    const byKey = new Map(slots.map((slot) => [slot?.key, slot]));
    return galleryItems.map((fallback) =>
      normalizeItem(fallback, byKey.get(fallback.key)),
    );
  };

  const loadGallery = () => {
    if (loadedGalleryItems) return Promise.resolve(loadedGalleryItems);
    if (galleryLoadPromise) return galleryLoadPromise;
    galleryLoadPromise = (async () => {
      const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
      const response = await fetch(`${base}/api/gallery`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`No se pudo cargar la galería (${response.status})`);
      const payload = await response.json();
      loadedGalleryItems = normalizeApiSlots(payload?.slots);
      window.CRONOX_GALLERY.items = loadedGalleryItems;
      renderGallery(loadedGalleryItems);
      return loadedGalleryItems;
    })().catch((error) => {
      galleryLoadPromise = null;
      throw error;
    });
    return galleryLoadPromise;
  };

  const homepageHasActiveCatalogView = () => {
    const params = new URL(window.location.href).searchParams;
    return ["categorySlug", "search", "q"].some((key) =>
      Boolean(params.get(key)?.trim()),
    );
  };

  const syncHomepageGalleryVisibility = () => {
    const filtered = homepageHasActiveCatalogView();
    galleryRoots.forEach((root) => {
      if (!root.hasAttribute("data-gallery-homepage")) return;
      const section = root.closest("[data-gallery-homepage-section]") || root;
      section.hidden = filtered;
    });
    return galleryRoots.some((root) => {
      const section = root.closest("[data-gallery-homepage-section]") || root;
      return !section.hidden;
    });
  };

  const loadVisibleGalleries = () => {
    if (!syncHomepageGalleryVisibility()) return;
    loadGallery().catch(() => {
      window.CRONOX_GALLERY.items = galleryItems;
      renderGallery(galleryItems);
    });
  };

  lightboxElements.close?.addEventListener("click", closeLightbox);
  lightboxElements.previous?.addEventListener("click", () =>
    navigateLightbox(-1),
  );
  lightboxElements.next?.addEventListener("click", () => navigateLightbox(1));
  lightboxElements.root?.addEventListener("click", (event) => {
    if (event.target === lightboxElements.root) closeLightbox();
  });
  lightboxElements.stage?.addEventListener("click", (event) => {
    if (event.target === lightboxElements.stage) closeLightbox();
  });
  window.addEventListener("resize", () => {
    if (!lightboxElements.root || lightboxElements.root.hidden) return;
    applyLightboxDimensions();
  });
  pageDocument.addEventListener("keydown", (event) => {
    if (!lightboxElements.root || lightboxElements.root.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateLightbox(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateLightbox(1);
    } else if (event.key === "Tab") {
      const focusable = Array.from(
        lightboxElements.root.querySelectorAll(
          "button:not([hidden]):not([disabled]), a[href]:not([hidden])",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && pageDocument.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && pageDocument.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.CRONOX_GALLERY = {
    initialized: true,
    items: galleryItems,
    render: renderGallery,
    load: loadGallery,
    closeLightbox,
  };

  galleryRoots.forEach((root) => {
    if (root.dataset.galleryInitialized === "true") return;
    root.dataset.galleryInitialized = "true";
    renderGallery(galleryItems, root);
  });
  window.addEventListener("cronox:productsLoaded", loadVisibleGalleries);
  window.addEventListener("popstate", loadVisibleGalleries);
  loadVisibleGalleries();
})();
