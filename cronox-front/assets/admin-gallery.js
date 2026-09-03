(function () {
  "use strict";

  const SLOT_DEFINITIONS = [
    {
      key: "featured",
      displayOrder: 0,
      featured: true,
      placeholderColor: "grey",
    },
    {
      key: "slot-01",
      displayOrder: 1,
      featured: false,
      placeholderColor: "white",
    },
    {
      key: "slot-02",
      displayOrder: 2,
      featured: false,
      placeholderColor: "red",
    },
    {
      key: "slot-03",
      displayOrder: 3,
      featured: false,
      placeholderColor: "grey",
    },
    {
      key: "slot-04",
      displayOrder: 4,
      featured: false,
      placeholderColor: "white",
    },
    {
      key: "slot-05",
      displayOrder: 5,
      featured: false,
      placeholderColor: "grey",
    },
    {
      key: "slot-06",
      displayOrder: 6,
      featured: false,
      placeholderColor: "white",
    },
    {
      key: "slot-07",
      displayOrder: 7,
      featured: false,
      placeholderColor: "red",
    },
    {
      key: "slot-08",
      displayOrder: 8,
      featured: false,
      placeholderColor: "grey",
    },
    {
      key: "slot-09",
      displayOrder: 9,
      featured: false,
      placeholderColor: "red",
    },
    {
      key: "slot-10",
      displayOrder: 10,
      featured: false,
      placeholderColor: "grey",
    },
    {
      key: "slot-11",
      displayOrder: 11,
      featured: false,
      placeholderColor: "white",
    },
    {
      key: "slot-12",
      displayOrder: 12,
      featured: false,
      placeholderColor: "red",
    },
  ];
  const COLORS = { white: "#fff", red: "#b1001a", grey: "#737373" };
  const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const PRODUCT_PAGE_SIZE = 20;
  const LIBRARY_PAGE_SIZE = 24;

  const elements = {
    section: document.getElementById("section-gallery"),
    grid: document.getElementById("adminGalleryGrid"),
    status: document.getElementById("galleryAdminStatus"),
    modal: document.getElementById("galleryEditorModal"),
    title: document.getElementById("galleryEditorTitle"),
    slotLabel: document.getElementById("galleryEditorSlotLabel"),
    close: document.getElementById("galleryEditorClose"),
    cancel: document.getElementById("galleryEditorCancel"),
    save: document.getElementById("galleryEditorSave"),
    remove: document.getElementById("galleryRemovePhoto"),
    upload: document.getElementById("galleryUploadInput"),
    progress: document.getElementById("galleryUploadProgress"),
    compactLibrary: document.getElementById("galleryAssetLibrary"),
    libraryModal: document.getElementById("galleryLibraryModal"),
    libraryClose: document.getElementById("galleryLibraryClose"),
    libraryStatus: document.getElementById("galleryLibraryStatus"),
    libraryGrid: document.getElementById("galleryLibraryGrid"),
    libraryMore: document.getElementById("galleryLibraryMore"),
    productSearch: document.getElementById("galleryProductSearch"),
    productSearchClear: document.getElementById("galleryProductSearchClear"),
    selectedProducts: document.getElementById("gallerySelectedProducts"),
    productStatus: document.getElementById("galleryProductStatus"),
    productRepository: document.getElementById("galleryProductRepository"),
    productsMore: document.getElementById("galleryProductsMore"),
    description: document.getElementById("galleryDescription"),
    descriptionCounter: document.getElementById("galleryDescriptionCounter"),
    viewport: document.getElementById("galleryCropViewport"),
    cropImage: document.getElementById("galleryCropImage"),
    focalX: document.getElementById("galleryFocalX"),
    focalY: document.getElementById("galleryFocalY"),
    zoom: document.getElementById("galleryZoom"),
    focalXValue: document.getElementById("galleryFocalXValue"),
    focalYValue: document.getElementById("galleryFocalYValue"),
    zoomValue: document.getElementById("galleryZoomValue"),
    reset: document.getElementById("galleryResetFraming"),
    alt: document.getElementById("galleryAltText"),
    instagram: document.getElementById("galleryInstagramUrl"),
    message: document.getElementById("galleryEditorMessage"),
  };

  if (!elements.section || !elements.grid || !elements.modal) return;
  const pageDocument = elements.section.ownerDocument;

  const state = {
    slots: [],
    assets: [],
    recentAssets: [],
    assetTotal: 0,
    loaded: false,
    loadPromise: null,
    draft: null,
    saving: false,
    uploading: false,
    returnFocus: null,
    cropDrag: null,
    reorderSaving: false,
    dragSourceKey: null,
    dropTargetKey: null,
    dragPreview: null,
    assetDetailRequest: 0,
    contentRevision: 0,
    assetContentDirty: false,
    selectedProductIds: [],
    selectedProductMap: new Map(),
    productResults: [],
    productPage: 1,
    productTotalPages: 1,
    productLoading: false,
    productRequest: 0,
    productTimer: null,
    fullLibraryAssets: [],
    fullLibraryPage: 0,
    fullLibraryTotalPages: 1,
    fullLibraryLoading: false,
    fullLibraryRequest: 0,
    libraryReturnFocus: null,
  };

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, Number(value) || 0));
  const apiBase = () =>
    String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
  const apiUrl = (path) => `${apiBase()}${path}`;

  const parseResponse = async (response) => {
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = Array.isArray(payload?.message)
        ? payload.message.join(" ")
        : payload?.message;
      const error = new Error(
        message || `Error del servidor (${response.status})`,
      );
      error.status = response.status;
      throw error;
    }
    return payload || {};
  };

  const requestJson = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      if (!window.CRONOX_API?.getCsrfHeaders) {
        throw new Error(
          "No se pudo inicializar la protección de la solicitud.",
        );
      }
      Object.assign(headers, await window.CRONOX_API.getCsrfHeaders());
    }
    const response = await fetch(apiUrl(path), {
      ...options,
      method,
      headers,
      credentials: "include",
    });
    return parseResponse(response);
  };

  const setStatus = (message, status = "info") => {
    elements.status.textContent = message;
    elements.status.dataset.state = status;
  };
  const setEditorMessage = (message = "") => {
    elements.message.textContent = message;
  };
  const setRepositoryStatus = (element, message = "", status = "info") => {
    element.textContent = message;
    element.dataset.state = status;
  };

  const normalizeProduct = (product) => {
    const id = Number(product?.id);
    if (!Number.isInteger(id) || id < 1) return null;
    return {
      id,
      slug: typeof product.slug === "string" ? product.slug : "",
      name: typeof product.name === "string" ? product.name : `Producto ${id}`,
      price: Number.isFinite(Number(product.price))
        ? Number(product.price)
        : null,
      currency: /^[A-Z]{3}$/.test(String(product.currency || ""))
        ? String(product.currency)
        : "EUR",
      imageUrl: typeof product.imageUrl === "string" ? product.imageUrl : "",
      available: product.available === true,
    };
  };

  const normalizeAsset = (asset) => {
    if (!asset?.id || !asset?.imageUrl) return null;
    return {
      ...asset,
      description:
        typeof asset.description === "string" ? asset.description : null,
      products: (Array.isArray(asset.products) ? asset.products : [])
        .map(normalizeProduct)
        .filter(Boolean),
    };
  };

  const upsertAssets = (assets) => {
    const byId = new Map(state.assets.map((asset) => [asset.id, asset]));
    (Array.isArray(assets) ? assets : []).forEach((candidate) => {
      const asset = normalizeAsset(candidate);
      if (asset)
        byId.set(asset.id, { ...(byId.get(asset.id) || {}), ...asset });
    });
    state.assets = Array.from(byId.values());
  };

  const getAsset = (id) =>
    state.assets.find((asset) => asset.id === id) || null;
  const normalizedSlot = (definition, candidate) => ({
    ...definition,
    ...candidate,
    key: definition.key,
    displayOrder: definition.displayOrder,
    featured: definition.featured,
    placeholderColor: ["white", "red", "grey"].includes(
      candidate?.placeholderColor,
    )
      ? candidate.placeholderColor
      : definition.placeholderColor,
    focalX: clamp(candidate?.focalX ?? 50, 0, 100),
    focalY: clamp(candidate?.focalY ?? 50, 0, 100),
    zoom: clamp(candidate?.zoom ?? 1, 1, 3),
    altText: typeof candidate?.altText === "string" ? candidate.altText : "",
    instagramUrl:
      typeof candidate?.instagramUrl === "string" ? candidate.instagramUrl : "",
    asset: normalizeAsset(candidate?.asset),
  });
  const normalizeSlots = (slots) => {
    const byKey = new Map(
      (Array.isArray(slots) ? slots : []).map((slot) => [slot?.key, slot]),
    );
    return SLOT_DEFINITIONS.map((definition) =>
      normalizedSlot(definition, byKey.get(definition.key)),
    );
  };
  const slotLabel = (slot) =>
    slot.featured
      ? "Foto destacada"
      : `Posición ${String(slot.displayOrder).padStart(2, "0")}`;
  const shortSlotLabel = (slot) =>
    slot.featured ? "Destacada" : String(slot.displayOrder).padStart(2, "0");
  const applyFraming = (target, slot) => {
    target.style.setProperty("--focal-x", `${slot.focalX}%`);
    target.style.setProperty("--focal-y", `${slot.focalY}%`);
    target.style.setProperty("--zoom", String(slot.zoom));
  };

  const renderGrid = () => {
    const fragment = pageDocument.createDocumentFragment();
    state.slots.forEach((slot) => {
      const tile = pageDocument.createElement("div");
      const occupied = Boolean(slot.asset?.imageUrl);
      tile.className = `gallery-admin-slot${slot.featured ? " gallery-admin-slot--featured" : ""}${occupied ? " gallery-admin-slot--occupied" : ""}`;
      tile.dataset.gallerySlot = slot.key;
      tile.draggable = occupied && !state.reorderSaving;
      tile.setAttribute("role", "group");
      tile.setAttribute(
        "aria-label",
        `${slotLabel(slot)}${occupied ? ", foto asignada y arrastrable" : ", vacía"}`,
      );
      tile.style.setProperty(
        "--gallery-slot-color",
        COLORS[slot.placeholderColor] || COLORS.grey,
      );
      applyFraming(tile, slot);
      if (occupied) {
        const image = pageDocument.createElement("img");
        image.src = slot.asset.imageUrl;
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        tile.appendChild(image);
      }
      const label = pageDocument.createElement("span");
      label.className = "gallery-admin-slot__label";
      label.textContent = slot.featured
        ? "Destacada"
        : String(slot.displayOrder).padStart(2, "0");
      tile.appendChild(label);
      const pencil = pageDocument.createElement("button");
      pencil.type = "button";
      pencil.className = "gallery-admin-slot__edit";
      pencil.setAttribute(
        "aria-label",
        `Editar ${slotLabel(slot).toLowerCase()}`,
      );
      pencil.textContent = "\u270e";
      pencil.draggable = false;
      pencil.addEventListener("pointerdown", (event) =>
        event.stopPropagation(),
      );
      pencil.addEventListener("dragstart", (event) => event.preventDefault());
      pencil.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!state.reorderSaving) openEditor(slot.key, pencil);
      });
      tile.appendChild(pencil);
      fragment.appendChild(tile);
    });
    elements.grid.replaceChildren(fragment);
    elements.grid.classList.toggle("is-reordering", state.reorderSaving);
    elements.grid.setAttribute("aria-busy", String(state.reorderSaving));
  };

  const getTile = (key) =>
    Array.from(elements.grid.querySelectorAll("[data-gallery-slot]")).find(
      (tile) => tile.dataset.gallerySlot === key,
    ) || null;
  const setDropTarget = (key) => {
    elements.grid
      .querySelectorAll(".is-drop-target")
      .forEach((tile) => tile.classList.remove("is-drop-target"));
    state.dropTargetKey = key || null;
    if (key && key !== state.dragSourceKey)
      getTile(key)?.classList.add("is-drop-target");
  };
  const clearDragState = () => {
    elements.grid
      .querySelectorAll(".is-dragging, .is-drop-target")
      .forEach((tile) =>
        tile.classList.remove("is-dragging", "is-drop-target"),
      );
    state.dragPreview?.remove();
    state.dragPreview = null;
    state.dragSourceKey = null;
    state.dropTargetKey = null;
  };
  const createDragPreview = (tile, clientX, clientY) => {
    const image = tile.querySelector("img");
    if (!image) return null;
    const preview = pageDocument.createElement("div");
    preview.className = "gallery-drag-preview";
    const previewImage = image.cloneNode();
    previewImage.removeAttribute("id");
    previewImage.draggable = false;
    preview.appendChild(previewImage);
    preview.style.left = `${clientX - 64}px`;
    preview.style.top = `${clientY - 48}px`;
    pageDocument.body.appendChild(preview);
    return preview;
  };
  const slotFromEvent = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const tile = target.closest("[data-gallery-slot]");
    return tile && elements.grid.contains(tile) ? tile : null;
  };
  const handleTileDragStart = (event) => {
    const tile = slotFromEvent(event);
    if (!tile) return;
    const key = tile.dataset.gallerySlot;
    const slot = state.slots.find((item) => item.key === key);
    if (
      state.reorderSaving ||
      !slot?.asset ||
      event.target.closest?.(".gallery-admin-slot__edit") ||
      !event.dataTransfer
    ) {
      event.preventDefault();
      return;
    }
    state.dragSourceKey = key;
    tile.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    state.dragPreview = createDragPreview(tile, event.clientX, event.clientY);
    if (state.dragPreview && event.dataTransfer.setDragImage) {
      try {
        const preview = state.dragPreview;
        event.dataTransfer.setDragImage(preview, 64, 48);
        window.setTimeout(() => {
          preview.remove();
          if (state.dragPreview === preview) state.dragPreview = null;
        }, 0);
      } catch {
        state.dragPreview.remove();
        state.dragPreview = null;
      }
    }
  };
  const handleTileDragOver = (event) => {
    const targetKey = slotFromEvent(event)?.dataset.gallerySlot;
    if (
      state.reorderSaving ||
      !state.dragSourceKey ||
      !targetKey ||
      targetKey === state.dragSourceKey
    ) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(targetKey);
  };
  const handleTileDragLeave = (event) => {
    if (
      event.relatedTarget instanceof Node &&
      elements.grid.contains(event.relatedTarget)
    )
      return;
    setDropTarget(null);
  };
  const handleTileDrop = (event) => {
    if (!state.dragSourceKey) return;
    event.preventDefault();
    const sourceKey =
      state.dragSourceKey || event.dataTransfer?.getData("text/plain");
    const targetKey = slotFromEvent(event)?.dataset.gallerySlot;
    if (!sourceKey || !targetKey || sourceKey === targetKey) {
      clearDragState();
      return;
    }
    clearDragState();
    void reorderSlots(sourceKey, targetKey);
  };
  const reorderSlots = async (sourceKey, targetKey) => {
    if (state.reorderSaving || sourceKey === targetKey) return false;
    const source = state.slots.find((slot) => slot.key === sourceKey);
    const target = state.slots.find((slot) => slot.key === targetKey);
    if (!source?.asset || !target) return false;
    const previousSlots = state.slots.map((slot) => ({
      ...slot,
      asset: slot.asset ? { ...slot.asset } : null,
    }));
    const wasSwap = Boolean(target.asset);
    state.reorderSaving = true;
    setStatus("Guardando la nueva disposición…");
    renderGrid();
    try {
      const response = await requestJson("/api/admin/gallery/slots/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceKey, targetKey }),
      });
      if (
        !Array.isArray(response.slots) ||
        response.slots.length !== SLOT_DEFINITIONS.length
      ) {
        throw new Error(
          "El servidor no devolvió una disposición de galería válida.",
        );
      }
      state.slots = normalizeSlots(response.slots);
      upsertAssets(state.slots.map((slot) => slot.asset).filter(Boolean));
      setStatus(
        wasSwap
          ? `Posiciones ${shortSlotLabel(source)} y ${shortSlotLabel(target)} intercambiadas.`
          : `Foto movida a la posición ${shortSlotLabel(target)}.`,
        "success",
      );
      return true;
    } catch (error) {
      state.slots = previousSlots;
      setStatus(
        `${error.message || "No se pudo reorganizar la galería."} La disposición anterior se ha restaurado.`,
        "error",
      );
      return false;
    } finally {
      state.reorderSaving = false;
      clearDragState();
      renderGrid();
    }
  };

  const loadGallery = async (force = false) => {
    if (state.loadPromise) return state.loadPromise;
    if (state.loaded && !force) return state.slots;
    setStatus("Cargando galería…");
    state.loadPromise = Promise.all([
      requestJson("/api/admin/gallery/slots"),
      requestJson("/api/admin/gallery/assets"),
    ])
      .then(([slotResponse, assetResponse]) => {
        state.slots = normalizeSlots(slotResponse.slots);
        upsertAssets(assetResponse.assets);
        upsertAssets(state.slots.map((slot) => slot.asset).filter(Boolean));
        state.recentAssets = (
          Array.isArray(assetResponse.assets) ? assetResponse.assets : []
        )
          .map(normalizeAsset)
          .filter(Boolean)
          .slice(0, 3);
        state.assetTotal = Number.isFinite(Number(assetResponse.total))
          ? Number(assetResponse.total)
          : state.recentAssets.length;
        state.loaded = true;
        renderGrid();
        setStatus("13 posiciones listas para editar.", "success");
        return state.slots;
      })
      .catch((error) => {
        state.loaded = false;
        state.slots = normalizeSlots([]);
        renderGrid();
        setStatus(error.message || "No se pudo cargar la galería.", "error");
        throw error;
      })
      .finally(() => {
        state.loadPromise = null;
      });
    return state.loadPromise;
  };

  const selectedAsset = () => getAsset(state.draft?.assetId);
  const createAssetButton = (asset, fullLibrary = false) => {
    const button = pageDocument.createElement("button");
    button.type = "button";
    button.className = "gallery-asset";
    button.dataset.galleryAsset = asset.id;
    button.setAttribute(
      "aria-pressed",
      String(asset.id === state.draft?.assetId),
    );
    button.setAttribute(
      "aria-label",
      `Seleccionar ${asset.originalFilename || "foto de la biblioteca"}`,
    );
    const image = pageDocument.createElement("img");
    image.src = asset.imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    button.appendChild(image);
    button.addEventListener("click", async () => {
      const selected = await selectAsset(asset.id);
      if (selected && fullLibrary) closeFullLibrary();
    });
    return button;
  };

  const renderCompactLibrary = () => {
    const fragment = pageDocument.createDocumentFragment();
    for (let index = 0; index < 3; index += 1) {
      const asset = state.recentAssets[index];
      if (asset) fragment.appendChild(createAssetButton(asset));
      else {
        const empty = pageDocument.createElement("button");
        empty.type = "button";
        empty.className = "gallery-asset gallery-asset--empty";
        empty.disabled = true;
        empty.setAttribute("aria-label", "Sin foto antigua en esta posición");
        fragment.appendChild(empty);
      }
    }
    const extraCount = Math.max(0, state.assetTotal - 3);
    const more = pageDocument.createElement("button");
    more.type = "button";
    more.className = "gallery-asset gallery-asset--more";
    more.dataset.galleryLibraryMore = "";
    more.textContent = `+${Math.min(extraCount, 99)}`;
    more.disabled = extraCount === 0;
    more.setAttribute(
      "aria-label",
      extraCount
        ? `Abrir Fotos antiguas: ${extraCount} fotografías adicionales`
        : "No hay fotografías adicionales",
    );
    more.addEventListener("click", openFullLibrary);
    fragment.appendChild(more);
    elements.compactLibrary.replaceChildren(fragment);
  };

  const renderFullLibrary = () => {
    const fragment = pageDocument.createDocumentFragment();
    if (!state.fullLibraryAssets.length && !state.fullLibraryLoading) {
      const empty = pageDocument.createElement("p");
      empty.className = "gallery-library-empty";
      empty.textContent = state.assetTotal
        ? "No se pudieron mostrar las fotos antiguas."
        : "Todavía no hay fotos antiguas.";
      fragment.appendChild(empty);
    } else {
      state.fullLibraryAssets.forEach((asset) =>
        fragment.appendChild(createAssetButton(asset, true)),
      );
    }
    elements.libraryGrid.replaceChildren(fragment);
    elements.libraryMore.hidden =
      state.fullLibraryLoading ||
      state.fullLibraryPage >= state.fullLibraryTotalPages;
    elements.libraryMore.disabled = state.fullLibraryLoading;
  };

  const loadFullLibraryPage = async (page, append = false) => {
    if (state.fullLibraryLoading) return;
    const requestId = ++state.fullLibraryRequest;
    state.fullLibraryLoading = true;
    setRepositoryStatus(elements.libraryStatus, "Cargando fotos…");
    elements.libraryMore.disabled = true;
    try {
      const response = await requestJson(
        `/api/admin/gallery/assets?page=${page}&limit=${LIBRARY_PAGE_SIZE}`,
      );
      if (requestId !== state.fullLibraryRequest) return;
      const incoming = (Array.isArray(response.assets) ? response.assets : [])
        .map(normalizeAsset)
        .filter(Boolean);
      const byId = new Map(
        (append ? state.fullLibraryAssets : []).map((asset) => [
          asset.id,
          asset,
        ]),
      );
      incoming.forEach((asset) => byId.set(asset.id, asset));
      state.fullLibraryAssets = Array.from(byId.values());
      state.fullLibraryPage = Number(response.page) || page;
      state.fullLibraryTotalPages = Number(response.totalPages) || 1;
      state.assetTotal = Number.isFinite(Number(response.total))
        ? Number(response.total)
        : state.assetTotal;
      upsertAssets(incoming);
      setRepositoryStatus(
        elements.libraryStatus,
        `${state.assetTotal} foto${state.assetTotal === 1 ? "" : "s"} guardada${state.assetTotal === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      if (requestId !== state.fullLibraryRequest) return;
      setRepositoryStatus(
        elements.libraryStatus,
        error.message || "No se pudo cargar Fotos antiguas.",
        "error",
      );
    } finally {
      if (requestId === state.fullLibraryRequest) {
        state.fullLibraryLoading = false;
        renderFullLibrary();
      }
    }
  };

  const openFullLibrary = () => {
    if (state.assetTotal <= 3) return;
    state.libraryReturnFocus = pageDocument.activeElement;
    state.fullLibraryAssets = [];
    state.fullLibraryPage = 0;
    state.fullLibraryTotalPages = 1;
    elements.libraryModal.classList.add("show");
    elements.libraryModal.setAttribute("aria-hidden", "false");
    renderFullLibrary();
    elements.libraryClose.focus();
    void loadFullLibraryPage(1);
  };
  const closeFullLibrary = () => {
    if (!elements.libraryModal.classList.contains("show")) return;
    ++state.fullLibraryRequest;
    state.fullLibraryLoading = false;
    elements.libraryModal.classList.remove("show");
    elements.libraryModal.setAttribute("aria-hidden", "true");
    const target = state.libraryReturnFocus;
    state.libraryReturnFocus = null;
    if (target?.isConnected && typeof target.focus === "function")
      target.focus();
  };

  const formatPrice = (product) => {
    if (!Number.isFinite(product.price)) return "";
    try {
      return new Intl.NumberFormat("es-ES", {
        style: "currency",
        currency: product.currency,
      }).format(product.price / 100);
    } catch {
      return `${(product.price / 100).toFixed(2)} €`;
    }
  };
  const renderSelectedProducts = () => {
    const fragment = pageDocument.createDocumentFragment();
    state.selectedProductIds.forEach((id) => {
      const product = state.selectedProductMap.get(id);
      if (!product) return;
      const button = pageDocument.createElement("button");
      button.type = "button";
      button.className = "gallery-selected-product";
      button.setAttribute("aria-label", `Quitar ${product.name}`);
      const name = pageDocument.createElement("span");
      name.textContent = product.name;
      const remove = pageDocument.createElement("b");
      remove.setAttribute("aria-hidden", "true");
      remove.textContent = "×";
      button.append(name, remove);
      button.addEventListener("click", () => toggleProduct(product));
      fragment.appendChild(button);
    });
    elements.selectedProducts.replaceChildren(fragment);
  };
  const renderProductRepository = () => {
    const fragment = pageDocument.createDocumentFragment();
    state.productResults.forEach((product) => {
      const selected = state.selectedProductIds.includes(product.id);
      const button = pageDocument.createElement("button");
      button.type = "button";
      button.className = "gallery-product-option";
      button.dataset.galleryProduct = String(product.id);
      button.setAttribute("role", "checkbox");
      button.setAttribute("aria-checked", String(selected));
      button.disabled = !state.draft?.assetId;
      const media = pageDocument.createElement("span");
      media.className = "gallery-product-option__image";
      if (product.imageUrl) {
        const image = pageDocument.createElement("img");
        image.src = product.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        media.appendChild(image);
      }
      const content = pageDocument.createElement("span");
      content.className = "gallery-product-option__content";
      const name = pageDocument.createElement("strong");
      name.className = "gallery-product-option__name";
      name.textContent = product.name;
      content.appendChild(name);
      if (Number.isFinite(product.price)) {
        const price = pageDocument.createElement("span");
        price.className = "gallery-product-option__meta";
        price.textContent = formatPrice(product);
        content.appendChild(price);
      }
      if (!product.available) {
        const archived = pageDocument.createElement("span");
        archived.className = "gallery-product-option__status";
        archived.textContent = "ARCHIVADO";
        content.appendChild(archived);
      }
      button.append(media, content);
      button.addEventListener("click", () => toggleProduct(product));
      fragment.appendChild(button);
    });
    if (!state.productResults.length && !state.productLoading) {
      const empty = pageDocument.createElement("p");
      empty.className = "gallery-library-empty";
      empty.textContent = "No hay productos para esta búsqueda.";
      fragment.appendChild(empty);
    }
    elements.productRepository.replaceChildren(fragment);
    elements.productsMore.hidden =
      state.productLoading || state.productPage >= state.productTotalPages;
    elements.productsMore.disabled = state.productLoading;
    renderSelectedProducts();
  };
  const markContentDirty = () => {
    if (!state.draft?.assetId) return;
    state.assetContentDirty = true;
    state.contentRevision += 1;
  };
  const toggleProduct = (product) => {
    if (!state.draft?.assetId) {
      setRepositoryStatus(
        elements.productStatus,
        "Selecciona primero una foto.",
        "error",
      );
      return;
    }
    const index = state.selectedProductIds.indexOf(product.id);
    if (index >= 0) state.selectedProductIds.splice(index, 1);
    else {
      state.selectedProductIds.push(product.id);
      state.selectedProductMap.set(product.id, product);
    }
    markContentDirty();
    renderProductRepository();
  };
  const loadProducts = async (search = "", page = 1, append = false) => {
    const requestId = ++state.productRequest;
    state.productLoading = true;
    setRepositoryStatus(elements.productStatus, "Buscando productos…");
    elements.productsMore.disabled = true;
    try {
      const response = await requestJson(
        `/api/admin/gallery/products?search=${encodeURIComponent(search)}&page=${page}&limit=${PRODUCT_PAGE_SIZE}`,
      );
      if (requestId !== state.productRequest) return;
      const incoming = (
        Array.isArray(response.products) ? response.products : []
      )
        .map(normalizeProduct)
        .filter(Boolean);
      incoming.forEach((product) => {
        if (state.selectedProductMap.has(product.id)) {
          state.selectedProductMap.set(product.id, product);
        }
      });
      const byId = new Map(
        (append ? state.productResults : []).map((product) => [
          product.id,
          product,
        ]),
      );
      incoming.forEach((product) => byId.set(product.id, product));
      state.productResults = Array.from(byId.values());
      state.productPage = Number(response.page) || page;
      state.productTotalPages = Number(response.totalPages) || 1;
      setRepositoryStatus(
        elements.productStatus,
        `${Number(response.total) || state.productResults.length} producto${Number(response.total) === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      if (requestId !== state.productRequest) return;
      setRepositoryStatus(
        elements.productStatus,
        error.message || "No se pudo cargar el repositorio de productos.",
        "error",
      );
      if (!append) state.productResults = [];
    } finally {
      if (requestId === state.productRequest) {
        state.productLoading = false;
        renderProductRepository();
      }
    }
  };

  const setAssetContent = (asset) => {
    const products = Array.isArray(asset?.products) ? asset.products : [];
    state.selectedProductIds = products.map((product) => product.id);
    state.selectedProductMap = new Map(
      products.map((product) => [product.id, product]),
    );
    elements.description.value = asset?.description || "";
    elements.descriptionCounter.value = `${elements.description.value.length}/2000`;
    state.assetContentDirty = false;
    renderProductRepository();
  };
  const confirmDiscardContent = () => {
    if (!state.assetContentDirty) return true;
    return window.confirm(
      "Hay cambios sin guardar en los productos o el texto. ¿Quieres descartarlos?",
    );
  };
  const loadAssetDetails = async (assetId, revision) => {
    const requestId = ++state.assetDetailRequest;
    try {
      const response = await requestJson(
        `/api/admin/gallery/assets/${encodeURIComponent(assetId)}`,
      );
      const asset = normalizeAsset(response.asset);
      if (asset) upsertAssets([asset]);
      if (
        !asset ||
        requestId !== state.assetDetailRequest ||
        state.draft?.assetId !== assetId ||
        state.contentRevision !== revision ||
        state.assetContentDirty
      ) {
        return;
      }
      setAssetContent(asset);
      syncControls();
    } catch (error) {
      if (
        requestId === state.assetDetailRequest &&
        state.draft?.assetId === assetId
      ) {
        setEditorMessage(
          error.message || "No se pudo cargar el contenido de la foto.",
        );
      }
    }
  };
  const selectAsset = async (assetId) => {
    const asset = getAsset(assetId);
    if (!state.draft || !asset) return false;
    if (state.draft.assetId !== assetId && !confirmDiscardContent())
      return false;
    state.draft.assetId = assetId;
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    state.contentRevision += 1;
    const revision = state.contentRevision;
    setAssetContent(asset);
    setEditorMessage("");
    renderCompactLibrary();
    renderFullLibrary();
    syncControls();
    void loadAssetDetails(assetId, revision);
    return true;
  };

  const syncControls = () => {
    if (!state.draft) return;
    const draft = state.draft;
    elements.focalX.value = String(draft.focalX);
    elements.focalY.value = String(draft.focalY);
    elements.zoom.value = String(draft.zoom);
    elements.focalXValue.value = `${Math.round(draft.focalX)}%`;
    elements.focalYValue.value = `${Math.round(draft.focalY)}%`;
    elements.zoomValue.value = `${Number(draft.zoom).toFixed(2)}×`;
    elements.alt.value = draft.altText;
    elements.instagram.value = draft.instagramUrl;
    const asset = selectedAsset();
    elements.viewport.classList.toggle(
      "gallery-crop-viewport--featured",
      draft.featured,
    );
    elements.viewport.style.setProperty(
      "--gallery-slot-color",
      COLORS[draft.placeholderColor] || COLORS.grey,
    );
    applyFraming(elements.viewport, draft);
    elements.cropImage.hidden = !asset;
    if (asset) {
      elements.cropImage.src = asset.imageUrl;
      elements.cropImage.alt = draft.altText;
    } else {
      elements.cropImage.removeAttribute("src");
      elements.cropImage.alt = "";
    }
    [elements.focalX, elements.focalY, elements.zoom, elements.reset].forEach(
      (control) => {
        control.disabled = !asset;
      },
    );
    elements.alt.required = Boolean(asset);
    elements.remove.disabled = !asset;
    elements.description.disabled = !asset;
    renderProductRepository();
  };

  const openEditor = (key, trigger) => {
    const slot = state.slots.find((item) => item.key === key);
    if (!slot) return;
    state.returnFocus = trigger || pageDocument.activeElement;
    if (slot.asset) upsertAssets([slot.asset]);
    state.draft = {
      key: slot.key,
      featured: slot.featured,
      placeholderColor: slot.placeholderColor,
      assetId: slot.asset?.id || null,
      focalX: slot.focalX,
      focalY: slot.focalY,
      zoom: slot.zoom,
      altText: slot.altText || "",
      instagramUrl: slot.instagramUrl || "",
    };
    state.contentRevision += 1;
    setAssetContent(slot.asset);
    elements.title.textContent = `Editar ${slotLabel(slot).toLowerCase()}`;
    elements.slotLabel.textContent = slot.featured
      ? "Ocupa dos columnas y tres filas"
      : `Posición ${slot.displayOrder} de 12`;
    setEditorMessage("");
    elements.upload.value = "";
    elements.progress.hidden = true;
    elements.productSearch.value = "";
    renderCompactLibrary();
    syncControls();
    elements.modal.classList.add("show");
    elements.modal.setAttribute("aria-hidden", "false");
    pageDocument.body.style.overflow = "hidden";
    elements.close.focus();
    void loadProducts();
  };
  const closeEditor = (force = false) => {
    if (state.saving && !force) return;
    if (!force && !confirmDiscardContent()) return;
    closeFullLibrary();
    ++state.assetDetailRequest;
    ++state.productRequest;
    elements.modal.classList.remove("show");
    elements.modal.setAttribute("aria-hidden", "true");
    pageDocument.body.style.overflow = "";
    state.draft = null;
    state.cropDrag = null;
    state.assetContentDirty = false;
    elements.viewport.classList.remove("is-dragging");
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target?.isConnected && typeof target.focus === "function")
      target.focus();
  };

  const isSafeInstagramUrl = (value) => {
    if (!value.trim()) return true;
    try {
      const url = new URL(value.trim());
      const parts = url.pathname.split("/").filter(Boolean);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
          url.hostname.toLowerCase(),
        ) &&
        ["p", "reel", "tv"].includes(parts[0]) &&
        /^[A-Za-z0-9_-]+$/.test(parts[1] || "")
      );
    } catch {
      return false;
    }
  };
  const saveSlot = async () => {
    if (!state.draft || state.saving) return;
    state.draft.altText = elements.alt.value.trim();
    state.draft.instagramUrl = elements.instagram.value.trim();
    if (state.draft.assetId && state.draft.altText.length < 3) {
      setEditorMessage(
        "Escribe un texto alternativo de al menos 3 caracteres.",
      );
      elements.alt.focus();
      return;
    }
    if (!isSafeInstagramUrl(state.draft.instagramUrl)) {
      setEditorMessage(
        "Introduce una URL HTTPS válida de una publicación de Instagram.",
      );
      elements.instagram.focus();
      return;
    }
    state.saving = true;
    elements.save.disabled = true;
    elements.cancel.disabled = true;
    elements.save.textContent = "Guardando…";
    setEditorMessage("");
    try {
      const body = {
        assetId: state.draft.assetId,
        focalX: state.draft.focalX,
        focalY: state.draft.focalY,
        zoom: state.draft.zoom,
        altText: state.draft.altText,
        instagramUrl: state.draft.instagramUrl || null,
      };
      if (state.draft.assetId) {
        body.description = elements.description.value;
        body.productIds = [...state.selectedProductIds];
      }
      const payload = await requestJson(
        `/api/admin/gallery/slots/${encodeURIComponent(state.draft.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const index = state.slots.findIndex(
        (slot) => slot.key === state.draft.key,
      );
      if (index >= 0) {
        state.slots[index] = normalizedSlot(
          SLOT_DEFINITIONS[index],
          payload.slot,
        );
        if (state.slots[index].asset) upsertAssets([state.slots[index].asset]);
      }
      state.assetContentDirty = false;
      renderGrid();
      setStatus(
        `${index >= 0 ? slotLabel(state.slots[index]) : "Posición"} actualizada con sus productos y texto.`,
        "success",
      );
      closeEditor(true);
    } catch (error) {
      setEditorMessage(error.message || "No se pudieron guardar los cambios.");
    } finally {
      state.saving = false;
      elements.save.disabled = false;
      elements.cancel.disabled = false;
      elements.save.textContent = "Guardar cambios";
    }
  };

  const uploadAsset = async (file) => {
    if (!file || state.uploading) return;
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setEditorMessage("Selecciona una imagen JPEG, PNG o WebP.");
      elements.upload.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setEditorMessage("La imagen supera el máximo permitido de 25 MB.");
      elements.upload.value = "";
      return;
    }
    const editingKey = state.draft?.key;
    state.uploading = true;
    elements.upload.disabled = true;
    elements.progress.hidden = false;
    elements.progress.value = 0;
    setEditorMessage("");
    try {
      const csrfHeaders = await window.CRONOX_API.getCsrfHeaders();
      const asset = await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", apiUrl("/api/admin/gallery/assets"));
        request.withCredentials = true;
        request.setRequestHeader("Accept", "application/json");
        Object.entries(csrfHeaders).forEach(([name, value]) =>
          request.setRequestHeader(name, value),
        );
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            elements.progress.value = Math.round(
              (event.loaded / event.total) * 100,
            );
          }
        });
        request.addEventListener("load", () => {
          let payload = null;
          try {
            payload = request.responseText
              ? JSON.parse(request.responseText)
              : null;
          } catch {
            payload = null;
          }
          if (
            request.status < 200 ||
            request.status >= 300 ||
            !payload?.asset
          ) {
            const message = Array.isArray(payload?.message)
              ? payload.message.join(" ")
              : payload?.message;
            reject(
              new Error(
                message || `Error al subir la imagen (${request.status})`,
              ),
            );
            return;
          }
          resolve(payload.asset);
        });
        request.addEventListener("error", () =>
          reject(
            new Error(
              "No se pudo conectar con el servidor para subir la imagen.",
            ),
          ),
        );
        const form = new FormData();
        form.append("file", file);
        request.send(form);
      });
      const normalized = normalizeAsset(asset);
      if (!normalized)
        throw new Error("El servidor devolvió una foto no válida.");
      upsertAssets([normalized]);
      state.recentAssets = [
        normalized,
        ...state.recentAssets.filter((item) => item.id !== normalized.id),
      ].slice(0, 3);
      state.assetTotal += 1;
      renderCompactLibrary();
      if (state.draft?.key === editingKey) await selectAsset(normalized.id);
    } catch (error) {
      setEditorMessage(error.message || "No se pudo subir la imagen.");
    } finally {
      state.uploading = false;
      elements.upload.disabled = false;
      elements.upload.value = "";
      elements.progress.hidden = true;
    }
  };

  const updateFramingFromInputs = () => {
    if (!state.draft) return;
    state.draft.focalX = clamp(elements.focalX.value, 0, 100);
    state.draft.focalY = clamp(elements.focalY.value, 0, 100);
    state.draft.zoom = clamp(elements.zoom.value, 1, 3);
    syncControls();
  };
  [elements.focalX, elements.focalY, elements.zoom].forEach((input) =>
    input.addEventListener("input", updateFramingFromInputs),
  );
  elements.alt.addEventListener("input", () => {
    if (state.draft) state.draft.altText = elements.alt.value;
  });
  elements.instagram.addEventListener("input", () => {
    if (state.draft) state.draft.instagramUrl = elements.instagram.value;
  });
  elements.description.addEventListener("input", () => {
    elements.descriptionCounter.value = `${elements.description.value.length}/2000`;
    markContentDirty();
  });
  elements.productSearch.addEventListener("input", () => {
    window.clearTimeout(state.productTimer);
    state.productTimer = window.setTimeout(() => {
      void loadProducts(elements.productSearch.value.trim());
    }, 250);
  });
  elements.productSearchClear.addEventListener("click", () => {
    window.clearTimeout(state.productTimer);
    elements.productSearch.value = "";
    elements.productSearch.focus();
    void loadProducts();
  });
  elements.productsMore.addEventListener("click", () =>
    loadProducts(
      elements.productSearch.value.trim(),
      state.productPage + 1,
      true,
    ),
  );
  elements.libraryMore.addEventListener("click", () =>
    loadFullLibraryPage(state.fullLibraryPage + 1, true),
  );
  elements.libraryClose.addEventListener("click", closeFullLibrary);
  elements.libraryModal.addEventListener("click", (event) => {
    if (event.target === elements.libraryModal) closeFullLibrary();
  });
  elements.reset.addEventListener("click", () => {
    if (!state.draft) return;
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    syncControls();
  });
  elements.remove.addEventListener("click", () => {
    if (!state.draft) return;
    if (!confirmDiscardContent()) return;
    ++state.assetDetailRequest;
    state.draft.assetId = null;
    state.draft.altText = "";
    state.draft.instagramUrl = "";
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    setAssetContent(null);
    renderCompactLibrary();
    syncControls();
  });
  elements.upload.addEventListener("change", () =>
    uploadAsset(elements.upload.files?.[0]),
  );
  elements.save.addEventListener("click", saveSlot);
  elements.cancel.addEventListener("click", () => closeEditor());
  elements.close.addEventListener("click", () => closeEditor());
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeEditor();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.libraryModal.classList.contains("show")) {
      event.preventDefault();
      closeFullLibrary();
    } else if (elements.modal.classList.contains("show")) {
      event.preventDefault();
      closeEditor();
    }
  });

  elements.grid.addEventListener("dragstart", handleTileDragStart);
  elements.grid.addEventListener("dragover", handleTileDragOver);
  elements.grid.addEventListener("dragleave", handleTileDragLeave);
  elements.grid.addEventListener("drop", handleTileDrop);
  elements.grid.addEventListener("dragend", clearDragState);
  elements.viewport.addEventListener("pointerdown", (event) => {
    if (!state.draft?.assetId) return;
    state.cropDrag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      focalX: state.draft.focalX,
      focalY: state.draft.focalY,
    };
    elements.viewport.classList.add("is-dragging");
    elements.viewport.setPointerCapture?.(event.pointerId);
  });
  elements.viewport.addEventListener("pointermove", (event) => {
    if (
      !state.cropDrag ||
      !state.draft ||
      state.cropDrag.pointerId !== event.pointerId
    )
      return;
    const rect = elements.viewport.getBoundingClientRect();
    const zoom = Math.max(1, state.draft.zoom);
    state.draft.focalX = clamp(
      state.cropDrag.focalX -
        ((event.clientX - state.cropDrag.x) / Math.max(rect.width, 1)) *
          (100 / zoom),
      0,
      100,
    );
    state.draft.focalY = clamp(
      state.cropDrag.focalY -
        ((event.clientY - state.cropDrag.y) / Math.max(rect.height, 1)) *
          (100 / zoom),
      0,
      100,
    );
    syncControls();
  });
  const stopDrag = (event) => {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    state.cropDrag = null;
    elements.viewport.classList.remove("is-dragging");
  };
  elements.viewport.addEventListener("pointerup", stopDrag);
  elements.viewport.addEventListener("pointercancel", stopDrag);

  pageDocument
    .querySelectorAll('[data-nav-target="section-gallery"]')
    .forEach((button) =>
      button.addEventListener("click", () =>
        loadGallery().catch(() => undefined),
      ),
    );
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#section-gallery")
      loadGallery().catch(() => undefined);
  });
  if (window.location.hash === "#section-gallery")
    loadGallery().catch(() => undefined);

  window.CRONOX_ADMIN_GALLERY = { load: loadGallery, openEditor, state };
})();
