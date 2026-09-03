(function () {
  "use strict";

  const elements = {
    section: document.getElementById("section-media"),
    search: document.getElementById("mediaSearch"),
    category: document.getElementById("mediaCategoryFilter"),
    type: document.getElementById("mediaTypeFilter"),
    statusFilter: document.getElementById("mediaStatusFilter"),
    status: document.getElementById("mediaAdminStatus"),
    grid: document.getElementById("mediaPlacementGrid"),
    libraryStatus: document.getElementById("mediaLibraryStatus"),
    libraryFolders: document.getElementById("mediaLibraryFolders"),
    libraryUpload: document.getElementById("mediaLibraryUpload"),
    libraryUploadButton: document.getElementById("mediaLibraryUploadButton"),
    libraryUploadProgress: document.getElementById(
      "mediaLibraryUploadProgress",
    ),
    modal: document.getElementById("mediaEditorModal"),
    title: document.getElementById("mediaEditorTitle"),
    route: document.getElementById("mediaEditorRoute"),
    close: document.getElementById("mediaEditorClose"),
    cancel: document.getElementById("mediaEditorCancel"),
    save: document.getElementById("mediaEditorSave"),
    deviceButtons: document.querySelectorAll("[data-media-device]"),
    inheritRow: document.getElementById("mediaInheritRow"),
    inherit: document.getElementById("mediaInheritGeneral"),
    previewStage: document.getElementById("mediaPreviewStage"),
    preview: document.getElementById("mediaPreviewFrame"),
    dimensions: document.getElementById("mediaPreviewDimensions"),
    movement: document.getElementById("mediaMovementStatus"),
    heroChrome: document.getElementById("mediaHeroChrome"),
    image: document.getElementById("mediaPreviewImage"),
    video: document.getElementById("mediaPreviewVideo"),
    empty: document.getElementById("mediaPreviewEmpty"),
    videoToggle: document.getElementById("mediaVideoToggle"),
    focalX: document.getElementById("mediaFocalX"),
    focalY: document.getElementById("mediaFocalY"),
    zoom: document.getElementById("mediaZoom"),
    fit: document.getElementById("mediaFit"),
    focalXValue: document.getElementById("mediaFocalXValue"),
    focalYValue: document.getElementById("mediaFocalYValue"),
    zoomValue: document.getElementById("mediaZoomValue"),
    resetDevice: document.getElementById("mediaResetDevice"),
    resetAll: document.getElementById("mediaResetAll"),
    message: document.getElementById("mediaEditorMessage"),
  };

  if (!elements.section || !elements.grid || !elements.modal) return;

  const pageDocument = elements.section.ownerDocument;
  const geometryEngine = window.CRONOX_MEDIA_GEOMETRY;
  const state = {
    placements: [],
    loaded: false,
    loadPromise: null,
    placement: null,
    draft: null,
    initial: null,
    device: "desktop",
    saving: false,
    resetAll: false,
    returnFocus: null,
    drag: null,
    geometry: null,
    previewSize: null,
    resizeFrame: 0,
    folders: [],
    libraryPromise: null,
    uploading: false,
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  };
  const apiBase = () =>
    String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");

  const safeMediaUrl = (value) => {
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
      return url.href;
    } catch {
      return "";
    }
  };

  const prepareVideoThumbnail = (video, source, poster = "") => {
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.disablePictureInPicture = true;
    if (poster) video.poster = poster;
    video.src = source;
    const showReferenceFrame = () => {
      try {
        const target = Number.isFinite(video.duration)
          ? Math.min(1, Math.max(0.2, video.duration / 10))
          : 0.5;
        if (video.currentTime < target) video.currentTime = target;
      } catch {
        // Some browsers do not allow seeking until more data is available.
      }
      video.pause?.();
    };
    video.addEventListener("loadedmetadata", showReferenceFrame, {
      once: true,
    });
  };

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
    const response = await fetch(`${apiBase()}${path}`, {
      ...options,
      method,
      headers,
      credentials: "include",
      cache: method === "GET" ? "no-store" : undefined,
    });
    return parseResponse(response);
  };

  const setStatus = (message, kind = "info") => {
    elements.status.textContent = message;
    elements.status.dataset.state = kind;
  };
  const setMessage = (message = "", kind = "info") => {
    elements.message.textContent = message;
    elements.message.dataset.state = kind;
  };

  const statusLabels = {
    DEFAULT: "Predeterminado",
    CUSTOM: "Personalizado",
    RESPONSIVE_CUSTOM: "Personalizado por dispositivo",
  };

  const normalizedSearch = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const createBadge = (text) => {
    const badge = pageDocument.createElement("span");
    badge.className = "media-card__badge";
    badge.textContent = text;
    return badge;
  };

  const createPreview = (placement) => {
    const preview = pageDocument.createElement("div");
    preview.className = "media-card__preview";
    const source = safeMediaUrl(placement.source);
    if (source && placement.mediaType === "video") {
      const video = pageDocument.createElement("video");
      prepareVideoThumbnail(
        video,
        source,
        safeMediaUrl(placement.poster),
      );
      video.setAttribute("aria-label", `Vista previa de ${placement.label}`);
      preview.appendChild(video);
    } else if (source) {
      const image = pageDocument.createElement("img");
      image.src = source;
      image.alt = `Vista previa de ${placement.label}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      preview.appendChild(image);
    } else {
      const empty = pageDocument.createElement("span");
      empty.className = "media-card__empty";
      empty.textContent = "Sin archivo disponible para la vista previa";
      preview.appendChild(empty);
    }
    const type = pageDocument.createElement("span");
    type.className = "media-card__type";
    type.textContent =
      placement.mediaType === "video" ? "V\u00eddeo" : "Imagen";
    preview.appendChild(type);
    return preview;
  };

  const createCard = (placement) => {
    const article = pageDocument.createElement("article");
    article.className = "media-card";
    article.dataset.mediaPlacement = placement.key;
    article.appendChild(createPreview(placement));

    const body = pageDocument.createElement("div");
    body.className = "media-card__body";
    const title = pageDocument.createElement("h3");
    title.textContent = placement.label;
    const route = pageDocument.createElement("p");
    route.className = "media-card__meta";
    route.textContent = placement.route;
    body.append(title, route);
    if (placement.sourceFilename) {
      const filename = pageDocument.createElement("p");
      filename.className = "media-card__meta";
      filename.textContent = placement.sourceFilename;
      body.appendChild(filename);
    }
    const badges = pageDocument.createElement("div");
    badges.className = "media-card__badges";
    badges.append(
      createBadge(placement.category),
      createBadge(statusLabels[placement.status] || "Predeterminado"),
    );
    body.appendChild(badges);

    const actions = pageDocument.createElement("div");
    actions.className = "media-card__actions";
    const edit = pageDocument.createElement("button");
    edit.type = "button";
    edit.className = "btn primary";
    edit.textContent = "Editar encuadre";
    edit.addEventListener("click", () => openEditor(placement.key, edit));
    actions.appendChild(edit);
    if (placement.publicUrl) {
      const link = pageDocument.createElement("a");
      link.href = placement.publicUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Ver en la web";
      actions.appendChild(link);
    }
    body.appendChild(actions);
    article.appendChild(body);
    return article;
  };

  const formatFileSize = (value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "Archivo original";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const createAssetCard = (asset, placementKey) => {
    const article = pageDocument.createElement("article");
    article.className = "media-asset";
    article.dataset.mediaAsset = asset.id;
    const preview = pageDocument.createElement("div");
    preview.className = "media-asset__preview";
    const source = safeMediaUrl(asset.source);
    if (source && asset.mediaType === "video") {
      const video = pageDocument.createElement("video");
      prepareVideoThumbnail(video, source, safeMediaUrl(asset.poster));
      video.setAttribute("aria-label", `Fotograma de ${asset.originalFilename}`);
      preview.appendChild(video);
    } else if (source) {
      const image = pageDocument.createElement("img");
      image.src = source;
      image.alt = `Vista previa de ${asset.originalFilename}`;
      image.loading = "lazy";
      image.decoding = "async";
      preview.appendChild(image);
    }
    const kind = pageDocument.createElement("span");
    kind.className = "media-asset__kind";
    kind.textContent = asset.mediaType === "video" ? "Vídeo" : "Foto";
    preview.appendChild(kind);
    const active = Array.isArray(asset.activeFor)
      ? asset.activeFor.includes(placementKey)
      : false;
    if (active) {
      const activeBadge = pageDocument.createElement("span");
      activeBadge.className = "media-asset__active";
      activeBadge.textContent = "En uso";
      preview.appendChild(activeBadge);
    }

    const body = pageDocument.createElement("div");
    body.className = "media-asset__body";
    const name = pageDocument.createElement("p");
    name.className = "media-asset__name";
    name.textContent = asset.originalFilename || "Archivo multimedia";
    const meta = pageDocument.createElement("p");
    meta.className = "media-asset__meta";
    meta.textContent = asset.builtin
      ? "Original incluido con la web"
      : formatFileSize(asset.fileSize);
    const use = pageDocument.createElement("button");
    use.type = "button";
    use.className = "btn";
    use.textContent = active
      ? "Archivo en uso"
      : asset.builtin
        ? "Volver a usar el original"
        : "Usar en portada";
    use.disabled = active;
    use.addEventListener("click", () =>
      selectAsset(placementKey, asset.builtin ? null : asset.id, use),
    );
    body.append(name, meta, use);
    article.append(preview, body);
    return article;
  };

  const createSubfolder = (label, assets, placementKey) => {
    const details = pageDocument.createElement("details");
    details.className = "media-library__subfolder";
    details.open = true;
    const summary = pageDocument.createElement("summary");
    summary.textContent = `${label} (${assets.length})`;
    details.appendChild(summary);
    if (!assets.length) {
      const empty = pageDocument.createElement("p");
      empty.className = "media-library__empty";
      empty.textContent = `Todavía no hay ${label.toLowerCase()} guardados.`;
      details.appendChild(empty);
      return details;
    }
    const grid = pageDocument.createElement("div");
    grid.className = "media-library__assets";
    assets.forEach((asset) =>
      grid.appendChild(createAssetCard(asset, placementKey)),
    );
    details.appendChild(grid);
    return details;
  };

  const renderLibrary = () => {
    if (!elements.libraryFolders) return;
    const fragment = pageDocument.createDocumentFragment();
    state.folders.forEach((folder) => {
      const section = pageDocument.createElement("section");
      section.className = "media-library__folder";
      section.dataset.mediaFolder = folder.key;
      const title = pageDocument.createElement("h4");
      title.className = "media-library__folder-title";
      title.textContent = folder.label;
      const placementKey = folder.placementKeys?.[0] || "home.hero.video";
      section.append(
        title,
        createSubfolder("Fotos", folder.photos || [], placementKey),
        createSubfolder("Vídeos", folder.videos || [], placementKey),
      );
      fragment.appendChild(section);
    });
    elements.libraryFolders.replaceChildren(fragment);
  };

  const loadLibrary = async (force = false) => {
    if (state.libraryPromise && !force) return state.libraryPromise;
    elements.libraryFolders?.setAttribute("aria-busy", "true");
    state.libraryPromise = requestJson("/api/admin/media/library")
      .then((payload) => {
        state.folders = Array.isArray(payload.folders) ? payload.folders : [];
        renderLibrary();
        if (elements.libraryStatus) {
          elements.libraryStatus.textContent =
            "Los archivos se conservan aunque dejen de estar en uso.";
          elements.libraryStatus.dataset.state = "info";
        }
        return state.folders;
      })
      .catch((error) => {
        if (elements.libraryStatus) {
          elements.libraryStatus.textContent =
            error.message || "No se pudo cargar la multimedia pasada.";
          elements.libraryStatus.dataset.state = "error";
        }
        throw error;
      })
      .finally(() => {
        state.libraryPromise = null;
        elements.libraryFolders?.setAttribute("aria-busy", "false");
      });
    return state.libraryPromise;
  };

  const selectAsset = async (placementKey, assetId, button) => {
    const placement = state.placements.find((item) => item.key === placementKey);
    if (!placement || button?.disabled) return;
    if (button) button.disabled = true;
    try {
      const payload = await requestJson(
        `/api/admin/media/placements/${encodeURIComponent(placementKey)}/asset`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId,
            expectedRevision: placement.revision,
          }),
        },
      );
      const updated = payload.placement;
      const index = state.placements.findIndex((item) => item.key === placementKey);
      if (index >= 0 && updated) state.placements[index] = updated;
      render();
      await loadLibrary(true);
      setStatus(`${updated?.sourceFilename || "El archivo"} está ahora en uso.`, "success");
      try {
        window.localStorage.removeItem("cronox.mediaFraming.web.v2");
        window.localStorage.removeItem("cronox.mediaFraming.web.v3");
      } catch {
        // Storage can be unavailable in hardened/private browsing contexts.
      }
    } catch (error) {
      setStatus(error.message || "No se pudo reutilizar el archivo.", "error");
      if (button) button.disabled = false;
    }
  };

  const uploadLibraryAsset = async () => {
    const file = elements.libraryUpload?.files?.[0];
    const placement = state.placements.find(
      (item) => item.key === "home.hero.video",
    );
    if (!file || !placement || state.uploading) {
      if (!file && elements.libraryStatus) {
        elements.libraryStatus.textContent = "Selecciona una foto o un vídeo.";
        elements.libraryStatus.dataset.state = "error";
      }
      return;
    }
    state.uploading = true;
    elements.libraryUpload.disabled = true;
    elements.libraryUploadButton.disabled = true;
    elements.libraryUploadProgress.hidden = false;
    elements.libraryUploadProgress.removeAttribute("value");
    if (elements.libraryStatus) {
      elements.libraryStatus.textContent = `Guardando ${file.name}…`;
      elements.libraryStatus.dataset.state = "info";
    }
    try {
      const form = new FormData();
      form.append("file", file);
      await requestJson(
        `/api/admin/media/placements/${encodeURIComponent(placement.key)}/assets`,
        { method: "POST", body: form },
      );
      await loadLibrary(true);
      if (elements.libraryStatus) {
        elements.libraryStatus.textContent = `${file.name} se ha guardado en PORTADAS.`;
        elements.libraryStatus.dataset.state = "success";
      }
    } catch (error) {
      if (elements.libraryStatus) {
        elements.libraryStatus.textContent =
          error.message || "No se pudo guardar el archivo.";
        elements.libraryStatus.dataset.state = "error";
      }
    } finally {
      state.uploading = false;
      elements.libraryUpload.disabled = false;
      elements.libraryUploadButton.disabled = false;
      elements.libraryUploadProgress.hidden = true;
      elements.libraryUpload.value = "";
    }
  };

  const filteredPlacements = () => {
    const query = normalizedSearch(elements.search.value);
    return state.placements.filter((placement) => {
      const haystack = normalizedSearch(
        `${placement.label} ${placement.route} ${placement.sourceFilename || ""}`,
      );
      return (
        (!query || haystack.includes(query)) &&
        (!elements.category.value ||
          placement.category === elements.category.value) &&
        (!elements.type.value || placement.mediaType === elements.type.value) &&
        (!elements.statusFilter.value ||
          placement.status === elements.statusFilter.value)
      );
    });
  };

  const render = () => {
    const placements = filteredPlacements();
    const fragment = pageDocument.createDocumentFragment();
    placements.forEach((placement) =>
      fragment.appendChild(createCard(placement)),
    );
    if (!placements.length) {
      const empty = pageDocument.createElement("div");
      empty.className = "empty-state";
      const strong = pageDocument.createElement("strong");
      strong.textContent =
        "No hay multimedia web que coincida con los filtros.";
      empty.appendChild(strong);
      fragment.appendChild(empty);
    }
    elements.grid.replaceChildren(fragment);
    const visibleLabel =
      placements.length === 1
        ? "ubicaci\u00f3n web visible"
        : "ubicaciones web visibles";
    setStatus(
      `${placements.length} ${visibleLabel} de ${state.placements.length}.`,
    );
  };

  const populateCategories = () => {
    const current = elements.category.value;
    Array.from(elements.category.options)
      .slice(1)
      .forEach((option) => option.remove());
    [...new Set(state.placements.map((placement) => placement.category))]
      .sort((a, b) => a.localeCompare(b, "es"))
      .forEach((category) => {
        const option = pageDocument.createElement("option");
        option.value = category;
        option.textContent = category;
        elements.category.appendChild(option);
      });
    elements.category.value = current;
  };

  const load = async (force = false) => {
    if (state.loaded && !force) return state.placements;
    if (state.loadPromise) return state.loadPromise;
    elements.grid.setAttribute("aria-busy", "true");
    setStatus("Cargando Multimedia Web\u2026");
    state.loadPromise = requestJson("/api/admin/media/placements")
      .then((payload) => {
        state.placements = Array.isArray(payload.placements)
          ? payload.placements
          : [];
        state.loaded = true;
        populateCategories();
        render();
        loadLibrary().catch(() => undefined);
        return state.placements;
      })
      .catch((error) => {
        state.loaded = false;
        setStatus(
          error.message || "No se pudo cargar Multimedia Web.",
          "error",
        );
        const retry = pageDocument.createElement("button");
        retry.type = "button";
        retry.className = "btn";
        retry.textContent = "Reintentar";
        retry.addEventListener("click", () =>
          load(true).catch(() => undefined),
        );
        elements.grid.replaceChildren(retry);
        throw error;
      })
      .finally(() => {
        state.loadPromise = null;
        elements.grid.setAttribute("aria-busy", "false");
      });
    return state.loadPromise;
  };

  const currentFrame = () => {
    if (!state.draft) return null;
    return state.device === "desktop"
      ? state.draft.desktop
      : state.draft[state.device] || state.draft.desktop;
  };

  const isInherited = () =>
    state.device !== "desktop" && !state.draft?.[state.device];
  const dirty = () =>
    Boolean(
      state.draft &&
        JSON.stringify(state.draft) !== JSON.stringify(state.initial),
    );

  const simulatedViewport = () => {
    if (state.device === "tablet") {
      return state.placement?.preview?.tablet || { width: 768, height: 1024 };
    }
    if (state.device === "mobile") {
      return state.placement?.preview?.mobile || { width: 390, height: 844 };
    }
    return {
      width: Math.max(320, Math.round(window.innerWidth || 1440)),
      height: Math.max(320, Math.round(window.innerHeight || 900)),
    };
  };

  const fitPreview = (viewport) => {
    const rect = elements.previewStage.getBoundingClientRect?.();
    const availableWidth = Math.max(
      240,
      Number(rect?.width || elements.previewStage.clientWidth || 720),
    );
    const availableHeight = Math.max(
      260,
      Number(
        rect?.height ||
          elements.previewStage.clientHeight ||
          Math.min((window.innerHeight || 900) * 0.6, 650),
      ),
    );
    const scale = Math.min(
      availableWidth / viewport.width,
      availableHeight / viewport.height,
      1,
    );
    const size = {
      width: viewport.width * scale,
      height: viewport.height * scale,
    };
    elements.preview.style.width = `${size.width}px`;
    elements.preview.style.height = `${size.height}px`;
    state.previewSize = size;
    return size;
  };

  const activeMedia = () =>
    state.placement?.mediaType === "video" ? elements.video : elements.image;

  const renderPreview = () => {
    const frame = currentFrame();
    const media = activeMedia();
    const viewport = simulatedViewport();
    const size = fitPreview(viewport);
    const deviceLabel =
      state.device === "desktop"
        ? "Escritorio"
        : state.device === "tablet"
          ? "Tablet"
          : "M\u00f3vil";
    elements.dimensions.textContent = `${deviceLabel} \u00b7 ${viewport.width} \u00d7 ${viewport.height} px`;
    if (!frame || !media || !geometryEngine || media.hidden) {
      state.geometry = null;
      geometryEngine?.clear(media, elements.preview);
      elements.movement.textContent = geometryEngine
        ? "Esperando las dimensiones del archivo multimedia\u2026"
        : "No se pudo inicializar el motor de encuadre.";
      return null;
    }
    const result = geometryEngine.apply(media, elements.preview, frame, {
      frameWidth: size.width,
      frameHeight: size.height,
    });
    state.geometry = result;
    if (!result.valid) {
      elements.movement.textContent =
        "Esperando las dimensiones del archivo multimedia\u2026";
      return result;
    }
    const horizontal = result.movementX
      ? `horizontal ${Math.round(result.travelX)} px`
      : "horizontal sin recorrido";
    const vertical = result.movementY
      ? `vertical ${Math.round(result.travelY)} px`
      : "vertical sin recorrido";
    elements.movement.textContent = `Movimiento disponible: ${horizontal}; ${vertical}.`;
    return result;
  };

  const syncControls = () => {
    if (!state.placement || !state.draft) return;
    const frame = currentFrame();
    const inherited = isInherited();
    elements.inheritRow.hidden = state.device === "desktop";
    elements.inherit.checked = inherited;
    elements.deviceButtons.forEach((button) => {
      const active = button.dataset.mediaDevice === state.device;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    elements.focalX.value = String(frame.focalX);
    elements.focalY.value = String(frame.focalY);
    elements.zoom.value = String(frame.zoom);
    elements.fit.value = frame.fit;
    elements.focalXValue.value = `${Math.round(frame.focalX)}%`;
    elements.focalYValue.value = `${Math.round(frame.focalY)}%`;
    elements.zoomValue.value = `${Number(frame.zoom).toFixed(2)}\u00d7`;

    const result = renderPreview();
    elements.focalX.disabled = inherited || !result?.movementX;
    elements.focalY.disabled = inherited || !result?.movementY;
    elements.zoom.disabled = inherited;
    elements.fit.disabled = inherited;
    elements.resetDevice.disabled = inherited;
    elements.focalX.title = result?.movementX
      ? "Ajustar posici\u00f3n horizontal"
      : "No hay recorrido horizontal con este ajuste";
    elements.focalY.title = result?.movementY
      ? "Ajustar posici\u00f3n vertical"
      : "No hay recorrido vertical con este ajuste";
  };

  const schedulePreview = () => {
    if (state.resizeFrame) window.cancelAnimationFrame?.(state.resizeFrame);
    state.resizeFrame = window.requestAnimationFrame?.(() => {
      state.resizeFrame = 0;
      if (elements.modal.classList.contains("show")) syncControls();
    });
  };

  const setFrameValue = (property, value) => {
    if (!state.draft || isInherited()) return;
    state.draft[state.device][property] = value;
    state.resetAll = false;
    syncControls();
  };

  const preparePreview = () => {
    const source = safeMediaUrl(state.placement?.source);
    elements.image.hidden = true;
    elements.video.hidden = true;
    elements.empty.hidden = Boolean(source);
    elements.videoToggle.hidden = true;
    elements.heroChrome.hidden = state.placement?.key !== "home.hero.video";
    elements.video.pause();
    elements.video.removeAttribute("src");
    elements.image.removeAttribute("src");
    geometryEngine?.clear(elements.video, elements.preview);
    geometryEngine?.clear(elements.image, elements.preview);
    if (!source) return;
    if (state.placement.mediaType === "video") {
      elements.video.src = source;
      elements.video.hidden = false;
      elements.video.muted = true;
      elements.video.playsInline = true;
      elements.videoToggle.hidden = false;
      elements.videoToggle.textContent = "Reproducir v\u00eddeo";
    } else {
      elements.image.src = source;
      elements.image.alt = state.placement.label;
      elements.image.hidden = false;
    }
  };

  const openEditor = async (key, trigger) => {
    let placement = state.placements.find((item) => item.key === key);
    if (!placement) return;
    state.returnFocus = trigger || pageDocument.activeElement;
    try {
      const payload = await requestJson(
        `/api/admin/media/placements/${encodeURIComponent(key)}`,
      );
      placement = payload.placement || placement;
    } catch (error) {
      setStatus(
        error.message || "No se pudo actualizar la ubicaci\u00f3n.",
        "error",
      );
      return;
    }
    state.placement = placement;
    state.draft = clone(placement.framing);
    state.initial = clone(placement.framing);
    state.device = "desktop";
    state.resetAll = false;
    state.geometry = null;
    elements.title.textContent = placement.label;
    elements.route.textContent = placement.route;
    setMessage("");
    preparePreview();
    elements.modal.classList.add("show");
    elements.modal.setAttribute("aria-hidden", "false");
    pageDocument.body.style.overflow = "hidden";
    syncControls();
    schedulePreview();
    elements.close.focus();
  };

  const closeEditor = (force = false) => {
    if (state.saving && !force) return false;
    if (
      !force &&
      dirty() &&
      !window.confirm(
        "Hay cambios de encuadre sin guardar. \u00bfQuieres descartarlos?",
      )
    ) {
      return false;
    }
    elements.video.pause();
    elements.video.removeAttribute("src");
    elements.image.removeAttribute("src");
    elements.modal.classList.remove("show");
    elements.modal.setAttribute("aria-hidden", "true");
    pageDocument.body.style.overflow = "";
    state.drag = null;
    state.geometry = null;
    state.placement = null;
    state.draft = null;
    state.initial = null;
    const target = state.returnFocus;
    state.returnFocus = null;
    if (target?.isConnected && typeof target.focus === "function")
      target.focus();
    return true;
  };

  const resetDevice = () => {
    if (!state.draft || !state.placement || isInherited()) return;
    state.draft[state.device] =
      state.device === "desktop" ? clone(state.placement.defaults) : null;
    state.resetAll = false;
    syncControls();
  };

  const resetAll = () => {
    if (!state.draft || !state.placement) return;
    if (
      !window.confirm(
        "Se restablecer\u00e1n los encuadres de escritorio, tablet y m\u00f3vil al guardar. \u00bfContinuar?",
      )
    ) {
      return;
    }
    state.draft = {
      desktop: clone(state.placement.defaults),
      tablet: null,
      mobile: null,
    };
    state.resetAll = true;
    syncControls();
  };

  const save = async () => {
    if (!state.placement || !state.draft || state.saving) return;
    state.saving = true;
    elements.save.disabled = true;
    elements.cancel.disabled = true;
    elements.save.textContent = "Guardando\u2026";
    setMessage("");
    try {
      const path = `/api/admin/media/placements/${encodeURIComponent(
        state.placement.key,
      )}`;
      const payload = state.resetAll
        ? await requestJson(`${path}/reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: state.placement.revision,
            }),
          })
        : await requestJson(path, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...state.draft,
              expectedRevision: state.placement.revision,
            }),
          });
      const updated = payload.placement;
      const index = state.placements.findIndex(
        (item) => item.key === updated?.key,
      );
      if (index >= 0 && updated) state.placements[index] = updated;
      try {
        window.localStorage.removeItem("cronox.mediaFraming.web.v2");
        window.localStorage.removeItem("cronox.mediaFraming.v1");
      } catch {
        // Storage can be unavailable in hardened/private browsing contexts.
      }
      render();
      setStatus(
        `${updated?.label || "La ubicaci\u00f3n"} se ha actualizado.`,
        "success",
      );
      state.initial = clone(updated?.framing || state.draft);
      closeEditor(true);
    } catch (error) {
      setMessage(
        error.status === 409
          ? "Hay una versi\u00f3n m\u00e1s reciente. Tus cambios siguen aqu\u00ed; recarga la ubicaci\u00f3n antes de volver a guardar."
          : error.message || "No se pudieron guardar los cambios.",
        "error",
      );
    } finally {
      state.saving = false;
      elements.save.disabled = false;
      elements.cancel.disabled = false;
      elements.save.textContent = "Guardar";
    }
  };

  [
    elements.search,
    elements.category,
    elements.type,
    elements.statusFilter,
  ].forEach((control) =>
    control.addEventListener(
      control === elements.search ? "input" : "change",
      render,
    ),
  );
  elements.deviceButtons.forEach((button) =>
    button.addEventListener("click", () => {
      state.device = button.dataset.mediaDevice;
      state.drag = null;
      syncControls();
    }),
  );
  elements.inherit.addEventListener("change", () => {
    if (!state.draft || state.device === "desktop") return;
    state.draft[state.device] = elements.inherit.checked
      ? null
      : clone(state.draft.desktop);
    state.resetAll = false;
    syncControls();
  });
  elements.focalX.addEventListener("input", () =>
    setFrameValue("focalX", clamp(elements.focalX.value, 0, 100)),
  );
  elements.focalY.addEventListener("input", () =>
    setFrameValue("focalY", clamp(elements.focalY.value, 0, 100)),
  );
  elements.zoom.addEventListener("input", () =>
    setFrameValue("zoom", clamp(elements.zoom.value, 1, 3)),
  );
  elements.fit.addEventListener("change", () =>
    setFrameValue("fit", elements.fit.value),
  );
  elements.resetDevice.addEventListener("click", resetDevice);
  elements.resetAll.addEventListener("click", resetAll);
  elements.save.addEventListener("click", save);
  elements.cancel.addEventListener("click", () => closeEditor());
  elements.close.addEventListener("click", () => closeEditor());
  elements.libraryUploadButton?.addEventListener("click", uploadLibraryAsset);
  elements.video.addEventListener("loadedmetadata", syncControls);
  elements.image.addEventListener("load", syncControls);
  elements.videoToggle.addEventListener("click", async () => {
    if (elements.video.paused) {
      try {
        await elements.video.play();
        elements.videoToggle.textContent = "Pausar v\u00eddeo";
      } catch {
        setMessage("El navegador no pudo reproducir la vista previa.", "error");
      }
    } else {
      elements.video.pause();
      elements.videoToggle.textContent = "Reproducir v\u00eddeo";
    }
  });

  elements.preview.addEventListener("pointerdown", (event) => {
    if (
      !state.draft ||
      isInherited() ||
      !state.geometry?.valid ||
      (!state.geometry.movementX && !state.geometry.movementY) ||
      !safeMediaUrl(state.placement?.source)
    ) {
      return;
    }
    const frame = currentFrame();
    state.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      focalX: frame.focalX,
      focalY: frame.focalY,
      geometry: state.geometry,
      device: state.device,
    };
    elements.preview.setPointerCapture?.(event.pointerId);
    elements.preview.classList.add("is-dragging");
    event.preventDefault();
  });
  elements.preview.addEventListener("pointermove", (event) => {
    if (
      !state.drag ||
      state.drag.pointerId !== event.pointerId ||
      state.drag.device !== state.device ||
      !state.draft ||
      isInherited()
    ) {
      return;
    }
    const next = geometryEngine.focalFromDrag(
      state.drag.geometry,
      state.drag,
      event.clientX - state.drag.x,
      event.clientY - state.drag.y,
    );
    if (state.drag.geometry.movementX) {
      state.draft[state.device].focalX = next.focalX;
    }
    if (state.drag.geometry.movementY) {
      state.draft[state.device].focalY = next.focalY;
    }
    state.resetAll = false;
    syncControls();
  });
  const stopDrag = (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    if (elements.preview.hasPointerCapture?.(event.pointerId)) {
      elements.preview.releasePointerCapture(event.pointerId);
    }
    state.drag = null;
    elements.preview.classList.remove("is-dragging");
  };
  elements.preview.addEventListener("pointerup", stopDrag);
  elements.preview.addEventListener("pointercancel", stopDrag);

  if (typeof ResizeObserver === "function") {
    const previewObserver = new ResizeObserver(schedulePreview);
    previewObserver.observe(elements.previewStage);
  }
  window.addEventListener("resize", schedulePreview, { passive: true });
  pageDocument.addEventListener("keydown", (event) => {
    if (!elements.modal.classList.contains("show") || event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    closeEditor();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  pageDocument
    .querySelectorAll('[data-nav-target="section-media"]')
    .forEach((button) =>
      button.addEventListener("click", () => load().catch(() => undefined)),
    );
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#section-media") {
      load().catch(() => undefined);
    }
  });
  if (window.location.hash === "#section-media") {
    load().catch(() => undefined);
  }

  window.CRONOX_ADMIN_MEDIA = {
    load,
    openEditor,
    renderPreview,
    state,
  };
})();
