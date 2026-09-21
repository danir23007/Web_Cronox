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
  let loadedGalleryMode = "MOSAIC";
  let loadedCarouselItems = [];
  const CAROUSEL_SPEED_PX_PER_SECOND = 27;
  const CAROUSEL_DRAG_THRESHOLD_PX = 10;
  const carouselCleanups = new WeakMap();
  const activeCarouselAnimations = new Set();
  const syncCarouselAnimations = () => {
    activeCarouselAnimations.forEach((sync) => sync());
  };

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

  const normalizeCarouselOffset = (offset, cycleWidth) => {
    const width = Number(cycleWidth);
    if (!Number.isFinite(width) || width <= 0) return 0;
    const value = Number.isFinite(Number(offset)) ? Number(offset) : 0;
    return -((((-value % width) + width) % width));
  };

  const advanceCarouselOffset = (offset, deltaMs, cycleWidth) =>
    normalizeCarouselOffset(
      offset -
        CAROUSEL_SPEED_PX_PER_SECOND *
          (Math.max(0, Number(deltaMs) || 0) / 1000),
      cycleWidth,
    );

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
    variants: slot.variants && typeof slot.variants === "object" ? slot.variants : null,
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

  const applyItemFrame = (target, item) => {
    target.style.setProperty(
      "--desktop-focal-x",
      `${clamp(item.focalX, 0, 100, 50)}%`,
    );
    target.style.setProperty(
      "--desktop-focal-y",
      `${clamp(item.focalY, 0, 100, 50)}%`,
    );
    target.style.setProperty(
      "--desktop-zoom",
      String(clamp(item.zoom, 1, 3, 1)),
    );
    target.style.setProperty(
      "--desktop-fit",
      String(item.fit || "COVER").toLowerCase(),
    );
    target.style.setProperty(
      "--focal-x",
      `${clamp(item.focalX, 0, 100, 50)}%`,
    );
    target.style.setProperty(
      "--focal-y",
      `${clamp(item.focalY, 0, 100, 50)}%`,
    );
    target.style.setProperty("--zoom", String(clamp(item.zoom, 1, 3, 1)));
    if (item.tablet) {
      target.style.setProperty("--tablet-focal-x", `${item.tablet.focalX}%`);
      target.style.setProperty("--tablet-focal-y", `${item.tablet.focalY}%`);
      target.style.setProperty("--tablet-zoom", String(item.tablet.zoom));
      target.style.setProperty("--tablet-fit", item.tablet.fit.toLowerCase());
    }
    if (item.mobile) {
      target.style.setProperty("--mobile-focal-x", `${item.mobile.focalX}%`);
      target.style.setProperty("--mobile-focal-y", `${item.mobile.focalY}%`);
      target.style.setProperty("--mobile-zoom", String(item.mobile.zoom));
      target.style.setProperty("--mobile-fit", item.mobile.fit.toLowerCase());
    }
  };

  const applyGalleryImage = (
    image,
    item,
    context,
    options,
    onFinalError,
  ) => {
    const original = getImageUrl(item?.imageSrc);
    if (window.CRONOX_IMAGES) {
      window.CRONOX_IMAGES.apply(
        image,
        { url: original, variants: item?.variants },
        context,
        options,
      );
    } else if (original) {
      image.src = original;
    }
    const optimizedSource = image.getAttribute("src") || "";
    image.onerror = () => {
      if (original && optimizedSource && optimizedSource !== original) {
        image.removeAttribute("srcset");
        image.removeAttribute("sizes");
        image.onerror = onFinalError || null;
        image.src = original;
        return;
      }
      onFinalError?.();
    };
  };

  const productUrl = (product) =>
    product.available && product.slug
      ? `/producto/${encodeURIComponent(product.slug)}`
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
    applyGalleryImage(
      lightboxElements.image,
      item,
      "galleryLarge",
      { loading: "eager" },
      failed,
    );
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
    syncCarouselAnimations();
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
    syncCarouselAnimations();
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
      applyItemFrame(tile, item);
      tile.addEventListener("click", () => onOpen?.(item, tile));

      const image = pageDocument.createElement("img");
      applyGalleryImage(image, item, "galleryGrid");
      image.alt = alt;
      image.decoding = "async";
      image.loading = "lazy";
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

  const syncGalleryHeading = (root, carousel) => {
    const homepage = root.closest("[data-gallery-homepage-section]");
    homepage?.classList.toggle("gallery-homepage--carousel", carousel);
    const heading = homepage?.querySelector(".gallery-homepage__heading") ||
      root.closest(".gallery-page")?.querySelector(".gallery-visually-hidden");
    if (heading) heading.hidden = carousel;
  };

  const createCarouselSlide = (item, clone, onOpen) => {
    const button = pageDocument.createElement("button");
    const alt = item.alt?.trim() || "Imagen de la galería CRONOX";
    button.type = "button";
    button.className = "gallery-carousel__slide";
    button.dataset.galleryItemKey = item.key;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-label", `Abrir en pantalla completa: ${alt}`);
    button.draggable = false;
    applyItemFrame(button, item);
    if (clone) {
      button.tabIndex = -1;
      button.setAttribute("aria-hidden", "true");
    }
    const media = pageDocument.createElement("span");
    media.className = "gallery-carousel__media";
    const image = pageDocument.createElement("img");
    image.alt = clone ? "" : alt;
    image.decoding = "async";
    image.loading = "lazy";
    image.draggable = false;
    applyGalleryImage(image, item, "galleryGrid");
    media.appendChild(image);
    button.appendChild(media);
    button.addEventListener("click", (event) =>
      onOpen(item.key, event.currentTarget, event),
    );
    return button;
  };

  const renderCarousel = (items, root) => {
    if (!root) {
      galleryRoots.forEach((galleryRoot) => renderCarousel(items, galleryRoot));
      return;
    }
    carouselCleanups.get(root)?.();
    const logicalItems = items.filter((item) => item?.imageSrc).slice(0, 5);
    root.classList.add("gallery-carousel");
    root.classList.remove("gallery-grid--mosaic");
    root.dataset.galleryMode = "CAROUSEL";
    syncGalleryHeading(root, true);

    const viewport = pageDocument.createElement("div");
    viewport.className = "gallery-carousel__viewport";
    const track = pageDocument.createElement("div");
    track.className = "gallery-carousel__track";
    const firstGroup = pageDocument.createElement("div");
    firstGroup.className = "gallery-carousel__group";
    const cloneGroup = pageDocument.createElement("div");
    cloneGroup.className = "gallery-carousel__group";
    cloneGroup.setAttribute("aria-hidden", "true");
    const itemsByKey = new Map(logicalItems.map((item) => [item.key, item]));
    const state = {
      offset: 0,
      cycleWidth: 0,
      lastTimestamp: null,
      frame: null,
      pointer: null,
      suppressClickUntil: 0,
      reducedMotion: Boolean(
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
      ),
      pageVisible: !pageDocument.hidden,
      inView: true,
      destroyed: false,
    };

    const updateTransform = () => {
      track.style.transform = `translate3d(${state.offset.toFixed(3)}px,0,0)`;
    };
    const isPaused = () =>
      state.reducedMotion ||
      !state.pageVisible ||
      !state.inView ||
      state.destroyed ||
      Boolean(lightboxElements.root && !lightboxElements.root.hidden) ||
      Boolean(state.pointer);
    const cancelFrame = () => {
      if (state.frame !== null) window.cancelAnimationFrame?.(state.frame);
      state.frame = null;
      state.lastTimestamp = null;
    };
    const tick = (timestamp) => {
      state.frame = null;
      if (isPaused()) {
        state.lastTimestamp = null;
        return;
      }
      if (state.lastTimestamp !== null && state.cycleWidth > 0) {
        state.offset = advanceCarouselOffset(
          state.offset,
          Math.min(64, timestamp - state.lastTimestamp),
          state.cycleWidth,
        );
        updateTransform();
      }
      state.lastTimestamp = timestamp;
      state.frame = window.requestAnimationFrame?.(tick) ?? null;
    };
    const syncAnimation = () => {
      if (isPaused()) cancelFrame();
      else if (state.frame === null) {
        state.frame = window.requestAnimationFrame?.(tick) ?? null;
      }
    };
    const openItem = (key, trigger, event) => {
      if (Date.now() < state.suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const item = itemsByKey.get(key);
      if (item) openLightbox(item, trigger, logicalItems);
    };

    logicalItems.forEach((item) => {
      firstGroup.appendChild(createCarouselSlide(item, false, openItem));
      cloneGroup.appendChild(createCarouselSlide(item, true, openItem));
    });
    track.append(firstGroup, cloneGroup);
    viewport.appendChild(track);
    root.replaceChildren(viewport);
    activeCarouselAnimations.add(syncAnimation);

    const recalculate = () => {
      const previousWidth = state.cycleWidth;
      const previousProgress = previousWidth > 0 ? state.offset / previousWidth : 0;
      state.cycleWidth = firstGroup.getBoundingClientRect().width;
      state.offset = normalizeCarouselOffset(
        previousProgress * state.cycleWidth,
        state.cycleWidth,
      );
      updateTransform();
      syncAnimation();
    };

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button > 0) return;
      state.pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: state.offset,
        intent: null,
        moved: false,
      };
      viewport.setPointerCapture?.(event.pointerId);
      syncAnimation();
    });
    viewport.addEventListener("pointermove", (event) => {
      const pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      const deltaX = event.clientX - pointer.startX;
      const deltaY = event.clientY - pointer.startY;
      if (!pointer.intent && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 6) {
        pointer.intent =
          Math.abs(deltaX) > Math.abs(deltaY) * 1.15
            ? "horizontal"
            : "vertical";
      }
      if (pointer.intent !== "horizontal") return;
      event.preventDefault();
      pointer.moved = Math.abs(deltaX) >= CAROUSEL_DRAG_THRESHOLD_PX;
      state.offset = normalizeCarouselOffset(
        pointer.startOffset + deltaX,
        state.cycleWidth,
      );
      updateTransform();
    });
    const finishPointer = (event) => {
      const pointer = state.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      if (pointer.intent === "horizontal" && pointer.moved) {
        state.suppressClickUntil = Date.now() + 450;
        event.preventDefault();
      }
      state.pointer = null;
      viewport.releasePointerCapture?.(event.pointerId);
      syncAnimation();
    };
    viewport.addEventListener("pointerup", finishPointer);
    viewport.addEventListener("pointercancel", finishPointer);
    const visibility = () => {
      state.pageVisible = !pageDocument.hidden;
      syncAnimation();
    };
    pageDocument.addEventListener("visibilitychange", visibility);
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const motionChange = (event) => {
      state.reducedMotion = event.matches;
      syncAnimation();
    };
    motionQuery?.addEventListener?.("change", motionChange);
    const intersection = window.IntersectionObserver
      ? new window.IntersectionObserver(
          (entries) => {
            state.inView = entries.some((entry) => entry.isIntersecting);
            syncAnimation();
          },
          { rootMargin: "200px 0px" },
        )
      : null;
    intersection?.observe(root);
    const resize = window.ResizeObserver
      ? new window.ResizeObserver(recalculate)
      : null;
    resize?.observe(firstGroup);
    window.addEventListener("resize", recalculate);
    window.requestAnimationFrame?.(recalculate);

    carouselCleanups.set(root, () => {
      state.destroyed = true;
      cancelFrame();
      activeCarouselAnimations.delete(syncAnimation);
      intersection?.disconnect();
      resize?.disconnect();
      pageDocument.removeEventListener("visibilitychange", visibility);
      motionQuery?.removeEventListener?.("change", motionChange);
      window.removeEventListener("resize", recalculate);
    });
  };

  const renderGallery = (items = galleryItems, root) => {
    if (!root) {
      galleryRoots.forEach((galleryRoot) => renderGallery(items, galleryRoot));
      return;
    }
    carouselCleanups.get(root)?.();
    carouselCleanups.delete(root);
    root.classList.remove("gallery-carousel");
    root.classList.add("gallery-grid--mosaic");
    root.dataset.galleryMode = "MOSAIC";
    syncGalleryHeading(root, false);
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

  const normalizeApiCarouselItems = (items) => {
    if (!Array.isArray(items)) return [];
    return items
      .slice(0, 5)
      .map((item, index) =>
        normalizeItem(
          {
            key:
              typeof item?.key === "string" && item.key.trim()
                ? item.key.trim()
                : `carousel-${Number(item?.position) || index + 1}`,
            color: "grey",
            featured: false,
          },
          item,
        ),
      )
      .filter((item) => item.imageSrc);
  };

  const renderActiveGallery = (root) => {
    if (!root) {
      galleryRoots.forEach(renderActiveGallery);
      return;
    }
    if (loadedGalleryMode === "CAROUSEL" && loadedCarouselItems.length >= 3) {
      renderCarousel(loadedCarouselItems, root);
    } else {
      renderGallery(loadedGalleryItems || galleryItems, root);
    }
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
      loadedCarouselItems = normalizeApiCarouselItems(payload?.carouselItems);
      loadedGalleryMode =
        payload?.mode === "CAROUSEL" && loadedCarouselItems.length >= 3
          ? "CAROUSEL"
          : "MOSAIC";
      window.CRONOX_GALLERY.mode = loadedGalleryMode;
      window.CRONOX_GALLERY.items =
        loadedGalleryMode === "CAROUSEL"
          ? loadedCarouselItems
          : loadedGalleryItems;
      renderActiveGallery();
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
    mode: "MOSAIC",
    items: galleryItems,
    render: renderGallery,
    renderCarousel,
    load: loadGallery,
    closeLightbox,
    carouselMath: Object.freeze({
      speed: CAROUSEL_SPEED_PX_PER_SECOND,
      normalizeOffset: normalizeCarouselOffset,
      advanceOffset: advanceCarouselOffset,
    }),
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
