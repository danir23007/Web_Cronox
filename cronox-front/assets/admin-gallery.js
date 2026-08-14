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
  const COLORS = {
    white: "#fff",
    red: "#b1001a",
    grey: "#737373",
  };
  const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
    library: document.getElementById("galleryAssetLibrary"),
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

  const state = {
    slots: [],
    assets: [],
    loaded: false,
    loadPromise: null,
    draft: null,
    saving: false,
    uploading: false,
    returnFocus: null,
    drag: null,
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
          "No se pudo inicializar la protecci\u00f3n de la solicitud.",
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
    asset:
      candidate?.asset?.id && candidate?.asset?.imageUrl
        ? candidate.asset
        : null,
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
      : `Posici\u00f3n ${String(slot.displayOrder).padStart(2, "0")}`;

  const applyFraming = (target, slot) => {
    target.style.setProperty("--focal-x", `${slot.focalX}%`);
    target.style.setProperty("--focal-y", `${slot.focalY}%`);
    target.style.setProperty("--zoom", String(slot.zoom));
  };

  const renderGrid = () => {
    const fragment = document.createDocumentFragment();
    state.slots.forEach((slot) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `gallery-admin-slot${slot.featured ? " gallery-admin-slot--featured" : ""}`;
      button.dataset.gallerySlot = slot.key;
      button.style.setProperty(
        "--gallery-slot-color",
        COLORS[slot.placeholderColor] || COLORS.grey,
      );
      button.setAttribute(
        "aria-label",
        `Editar ${slotLabel(slot).toLowerCase()}`,
      );
      applyFraming(button, slot);

      if (slot.asset?.imageUrl) {
        const image = document.createElement("img");
        image.src = slot.asset.imageUrl;
        image.alt = "";
        image.decoding = "async";
        button.appendChild(image);
      }

      const label = document.createElement("span");
      label.className = "gallery-admin-slot__label";
      label.textContent = slot.featured
        ? "Destacada"
        : String(slot.displayOrder).padStart(2, "0");
      button.appendChild(label);

      const pencil = document.createElement("span");
      pencil.className = "gallery-admin-slot__edit";
      pencil.setAttribute("aria-hidden", "true");
      pencil.textContent = "\u270e";
      button.appendChild(pencil);
      button.addEventListener("click", () => openEditor(slot.key, button));
      fragment.appendChild(button);
    });
    elements.grid.replaceChildren(fragment);
  };

  const mergeAssets = (assets) => {
    const unique = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      if (asset?.id && asset?.imageUrl) unique.set(asset.id, asset);
    });
    state.slots.forEach((slot) => {
      if (slot.asset?.id && !unique.has(slot.asset.id))
        unique.set(slot.asset.id, slot.asset);
    });
    state.assets = Array.from(unique.values());
  };

  const loadGallery = async (force = false) => {
    if (state.loadPromise) return state.loadPromise;
    if (state.loaded && !force) return state.slots;
    setStatus("Cargando galer\u00eda\u2026");
    state.loadPromise = Promise.all([
      requestJson("/api/admin/gallery/slots"),
      requestJson("/api/admin/gallery/assets"),
    ])
      .then(([slotResponse, assetResponse]) => {
        state.slots = normalizeSlots(slotResponse.slots);
        mergeAssets(assetResponse.assets);
        state.loaded = true;
        renderGrid();
        setStatus("13 posiciones listas para editar.", "success");
        return state.slots;
      })
      .catch((error) => {
        state.loaded = false;
        state.slots = normalizeSlots([]);
        renderGrid();
        setStatus(
          error.message || "No se pudo cargar la galer\u00eda.",
          "error",
        );
        throw error;
      })
      .finally(() => {
        state.loadPromise = null;
      });
    return state.loadPromise;
  };

  const selectedAsset = () =>
    state.assets.find((asset) => asset.id === state.draft?.assetId) || null;

  const renderLibrary = () => {
    const fragment = document.createDocumentFragment();
    if (!state.assets.length) {
      const empty = document.createElement("p");
      empty.className = "gallery-asset-library__empty";
      empty.textContent = "Todav\u00eda no hay fotos antiguas.";
      fragment.appendChild(empty);
    } else {
      state.assets.forEach((asset) => {
        const button = document.createElement("button");
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
        const image = document.createElement("img");
        image.src = asset.imageUrl;
        image.alt = "";
        image.loading = "lazy";
        button.appendChild(image);
        button.addEventListener("click", () => selectAsset(asset.id));
        fragment.appendChild(button);
      });
    }
    elements.library.replaceChildren(fragment);
  };

  const syncControls = () => {
    if (!state.draft) return;
    const draft = state.draft;
    elements.focalX.value = String(draft.focalX);
    elements.focalY.value = String(draft.focalY);
    elements.zoom.value = String(draft.zoom);
    elements.focalXValue.value = `${Math.round(draft.focalX)}%`;
    elements.focalYValue.value = `${Math.round(draft.focalY)}%`;
    elements.zoomValue.value = `${Number(draft.zoom).toFixed(2)}\u00d7`;
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
  };

  const selectAsset = (assetId) => {
    if (!state.draft || !state.assets.some((asset) => asset.id === assetId))
      return;
    state.draft.assetId = assetId;
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    setEditorMessage("");
    renderLibrary();
    syncControls();
  };

  const openEditor = (key, trigger) => {
    const slot = state.slots.find((item) => item.key === key);
    if (!slot) return;
    state.returnFocus = trigger || document.activeElement;
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
    elements.title.textContent = `Editar ${slotLabel(slot).toLowerCase()}`;
    elements.slotLabel.textContent = slot.featured
      ? "Ocupa dos columnas y tres filas"
      : `Posici\u00f3n ${slot.displayOrder} de 12`;
    setEditorMessage("");
    elements.upload.value = "";
    elements.progress.hidden = true;
    renderLibrary();
    syncControls();
    elements.modal.classList.add("show");
    elements.modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    elements.close.focus();
  };

  const closeEditor = (force = false) => {
    if (state.saving && !force) return;
    elements.modal.classList.remove("show");
    elements.modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    state.draft = null;
    state.drag = null;
    elements.viewport.classList.remove("is-dragging");
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target && typeof target.focus === "function") target.focus();
  };

  const isSafeInstagramUrl = (value) => {
    if (!value.trim()) return true;
    try {
      const url = new URL(value.trim());
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split("/").filter(Boolean);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        ["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
          host,
        ) &&
        ["p", "reel", "tv"].includes(parts[0]) &&
        Boolean(parts[1])
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
        "Introduce una URL HTTPS v\u00e1lida de una publicaci\u00f3n de Instagram.",
      );
      elements.instagram.focus();
      return;
    }

    state.saving = true;
    elements.save.disabled = true;
    elements.cancel.disabled = true;
    elements.save.textContent = "Guardando\u2026";
    setEditorMessage("");
    try {
      const payload = await requestJson(
        `/api/admin/gallery/slots/${encodeURIComponent(state.draft.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId: state.draft.assetId,
            focalX: state.draft.focalX,
            focalY: state.draft.focalY,
            zoom: state.draft.zoom,
            altText: state.draft.altText,
            instagramUrl: state.draft.instagramUrl || null,
          }),
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
      }
      renderGrid();
      setStatus(
        `${index >= 0 ? slotLabel(state.slots[index]) : "Posici\u00f3n"} actualizada.`,
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
      setEditorMessage("La imagen supera el m\u00e1ximo permitido de 25 MB.");
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

      state.assets = [
        asset,
        ...state.assets.filter((item) => item.id !== asset.id),
      ];
      if (state.draft?.key === editingKey) selectAsset(asset.id);
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
  elements.reset.addEventListener("click", () => {
    if (!state.draft) return;
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    syncControls();
  });
  elements.remove.addEventListener("click", () => {
    if (!state.draft) return;
    state.draft.assetId = null;
    state.draft.altText = "";
    state.draft.instagramUrl = "";
    state.draft.focalX = 50;
    state.draft.focalY = 50;
    state.draft.zoom = 1;
    renderLibrary();
    syncControls();
  });
  elements.upload.addEventListener("change", () =>
    uploadAsset(elements.upload.files?.[0]),
  );
  elements.save.addEventListener("click", saveSlot);
  elements.cancel.addEventListener("click", closeEditor);
  elements.close.addEventListener("click", closeEditor);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) closeEditor();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.modal.classList.contains("show"))
      closeEditor();
  });

  elements.viewport.addEventListener("pointerdown", (event) => {
    if (!state.draft?.assetId) return;
    state.drag = {
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
    if (!state.drag || !state.draft || state.drag.pointerId !== event.pointerId)
      return;
    const rect = elements.viewport.getBoundingClientRect();
    const zoom = Math.max(1, state.draft.zoom);
    state.draft.focalX = clamp(
      state.drag.focalX -
        ((event.clientX - state.drag.x) / Math.max(rect.width, 1)) *
          (100 / zoom),
      0,
      100,
    );
    state.draft.focalY = clamp(
      state.drag.focalY -
        ((event.clientY - state.drag.y) / Math.max(rect.height, 1)) *
          (100 / zoom),
      0,
      100,
    );
    syncControls();
  });
  const stopDrag = (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    state.drag = null;
    elements.viewport.classList.remove("is-dragging");
  };
  elements.viewport.addEventListener("pointerup", stopDrag);
  elements.viewport.addEventListener("pointercancel", stopDrag);

  document
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

  window.CRONOX_ADMIN_GALLERY = {
    load: loadGallery,
    openEditor,
    state,
  };
})();
