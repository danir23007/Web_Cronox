(function () {
  "use strict";
  const section = document.getElementById("section-key-screen");
  if (!section) return;
  const $ = (id) => document.getElementById(id);
  const el = {
    master: $("keyMaster"), masterLabel: $("keyMasterLabel"), message: $("keyAdminMessage"),
    count: $("keyCount"), select: $("keyScreenSelect"), newName: $("keyNewName"), create: $("keyCreate"),
    activate: $("keyActivate"), remove: $("keyDelete"), editor: $("keyEditor"), form: $("keyForm"),
    uploadInput: $("keyMediaUpload"), upload: $("keyUpload"), assets: $("keyAssetGrid"),
    stage: $("keyPreviewStage"), preview: $("keyPreview"), frame: $("keyPreviewMedia"),
    overlay: $("keyPreviewOverlay"), content: $("keyPreviewContent"), overlayValue: $("keyOverlayValue"),
    formGroup: $("keyPreviewForm"), privacy: $("keyPreviewPrivacy"),
  };
  const renderer = window.CRONOX_KEY_SCREEN_RENDERER;
  const geometryEngine = window.CRONOX_MEDIA_GEOMETRY;
  const state = { loaded: false, screens: [], assets: [], settings: null, current: null, device: "desktop", media: null, mediaKey: "", geometry: null, drag: null };
  const names = [
    "internalName", "mode", "title", "subtitle", "placeholder", "buttonText", "successTitle", "successMessage", "textColor", "overlayStrength", "inputStyle", "buttonStyle",
    "desktopFocalX", "desktopFocalY", "desktopZoom", "desktopFit", "desktopHorizontalAlign", "desktopVerticalAlign", "desktopOffsetX", "desktopOffsetY",
    "mobileFocalX", "mobileFocalY", "mobileZoom", "mobileFit", "mobileHorizontalAlign", "mobileVerticalAlign", "mobileOffsetX", "mobileOffsetY",
    "desktopFormOffsetX", "desktopFormOffsetY", "desktopPrivacyOffsetX", "desktopPrivacyOffsetY",
    "mobileFormOffsetX", "mobileFormOffsetY", "mobilePrivacyOffsetX", "mobilePrivacyOffsetY",
  ];
  const base = () => String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
  const parse = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(payload.message) ? payload.message.join(" ") : payload.message || `Error ${response.status}`);
    return payload;
  };
  const request = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (["POST", "PATCH", "DELETE"].includes(method)) Object.assign(headers, await window.CRONOX_API.getCsrfHeaders());
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    return parse(await fetch(`${base()}${path}`, { ...options, method, headers, credentials: "include", cache: "no-store", body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined }));
  };
  const message = (text, error = false) => { el.message.textContent = text || ""; el.message.className = `message${text ? " show" : ""}${error ? " error" : " success"}`; };
  const safeUrl = (value) => { try { const url = new URL(value, location.origin); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; } };
  const selectedScreen = () => state.screens.find((screen) => screen.id === el.select.value) || null;
  const inputFor = (name) => el.form.elements[name];
  const setInput = (name, value) => { const input = inputFor(name); if (input) input.value = String(value); };
  const legacyValue = (screen, name) => {
    if (name === "desktopHorizontalAlign" || name === "mobileHorizontalAlign") return screen.horizontalAlign || "CENTER";
    if (name === "desktopVerticalAlign" || name === "mobileVerticalAlign") return screen.verticalAlign || "CENTER";
    if (name === "desktopOffsetX" || name === "mobileOffsetX") return screen.offsetX ?? 0;
    if (name === "desktopOffsetY" || name === "mobileOffsetY") return screen.offsetY ?? 0;
    if (name.startsWith("mobile")) return screen[name.replace("mobile", "desktop")];
    return "";
  };
  const formValues = () => {
    const values = {};
    names.forEach((name) => {
      const input = inputFor(name);
      if (input) values[name] = input.type === "number" || input.type === "range" ? Number(input.value) : input.value;
    });
    return values;
  };
  const formFrame = () => ({ ...state.current, ...formValues() });
  const viewport = () => renderer.VIEWPORTS[state.device];
  const devicePrefix = () => state.device === "mobile" ? "mobile" : "desktop";

  const fill = (screen) => {
    state.current = screen;
    el.editor.hidden = !screen;
    if (!screen) return;
    names.forEach((name) => {
      const input = inputFor(name);
      if (input) input.value = screen[name] ?? legacyValue(screen, name);
    });
    renderAssets();
    renderPreview();
  };

  const renderSelect = () => {
    const selected = state.current?.id || state.settings?.activeScreenId || state.screens[0]?.id || "";
    el.select.replaceChildren(...state.screens.map((screen) => {
      const option = document.createElement("option");
      option.value = screen.id;
      option.textContent = `${screen.internalName}${screen.id === state.settings?.activeScreenId ? " · SELECCIONADA" : ""}`;
      return option;
    }));
    el.select.value = state.screens.some((screen) => screen.id === selected) ? selected : state.screens[0]?.id || "";
    fill(selectedScreen());
  };

  const renderAssets = () => {
    el.assets.replaceChildren(...state.assets.map((asset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key-asset";
      button.setAttribute("aria-pressed", String(asset.id === state.current?.mediaAssetId));
      const media = document.createElement(asset.mediaType === "video" ? "video" : "img");
      media.src = safeUrl(asset.publicUrl);
      if (media.tagName === "VIDEO") { media.muted = true; media.preload = "metadata"; }
      const label = document.createElement("span");
      label.textContent = asset.originalFilename;
      button.append(media, label);
      button.addEventListener("click", async () => save({ mediaAssetId: asset.id }));
      return button;
    }));
  };

  const scalePreview = () => {
    const size = viewport();
    el.stage.dataset.device = state.device;
    el.preview.style.width = `${size.width}px`;
    el.preview.style.height = `${size.height}px`;
    const scale = (el.stage.clientWidth || size.width) / size.width;
    el.preview.style.transform = `scale(${scale})`;
    renderer.applyViewport(el.preview, size.width, size.height);
    applyMedia();
  };

  const applyMedia = () => {
    if (!state.media) { state.geometry = null; return; }
    const config = renderer.resolve(formFrame(), state.device);
    const size = viewport();
    state.geometry = geometryEngine.apply(state.media, el.frame, config, { frameWidth: size.width, frameHeight: size.height });
  };

  const ensureMedia = (asset) => {
    const source = safeUrl(asset?.publicUrl);
    const key = asset ? `${asset.id}:${asset.mediaType}:${source}` : "";
    if (key === state.mediaKey) { applyMedia(); return; }
    state.mediaKey = key;
    state.media = null;
    state.geometry = null;
    el.frame.replaceChildren();
    if (!asset || !source) return;
    const media = document.createElement(asset.mediaType === "video" ? "video" : "img");
    state.media = media;
    media.src = source;
    media.setAttribute("aria-hidden", "true");
    if (media.tagName === "VIDEO") { media.muted = true; media.loop = true; media.playsInline = true; media.autoplay = true; media.preload = "metadata"; }
    const readyEvent = media.tagName === "VIDEO" ? "loadedmetadata" : "load";
    media.addEventListener(readyEvent, () => { applyMedia(); if (media.tagName === "VIDEO") media.play().catch(() => undefined); });
    el.frame.append(media);
    if ((media.tagName === "IMG" && media.complete) || (media.tagName === "VIDEO" && media.readyState >= 1)) applyMedia();
  };

  const renderPreview = () => {
    if (!state.current) return;
    const screen = formFrame();
    const asset = state.assets.find((item) => item.id === state.current.mediaAssetId);
    const size = viewport();
    renderer.applyViewport(el.preview, size.width, size.height);
    renderer.applyContent(el.content, screen, state.device);
    renderer.applyInternalOffsets(el.formGroup, el.privacy, screen, state.device);
    el.overlay.style.opacity = String(Number(screen.overlayStrength) / 100);
    el.overlayValue.textContent = `${screen.overlayStrength}%`;
    el.content.style.setProperty("--key-text", screen.textColor || "#ffffff");
    el.content.dataset.inputStyle = screen.inputStyle;
    el.content.dataset.buttonStyle = screen.buttonStyle;
    el.content.querySelector("h1").textContent = screen.title;
    el.content.querySelector(":scope > p").textContent = screen.subtitle;
    el.formGroup.querySelector("input").placeholder = screen.placeholder;
    el.formGroup.querySelector("button").textContent = screen.buttonText;
    el.privacy.textContent = screen.privacyLabel || "Política de privacidad";
    ensureMedia(asset);
    scalePreview();
  };

  const switchDevice = (device) => {
    state.device = device === "mobile" ? "mobile" : "desktop";
    section.querySelectorAll("[data-key-device]").forEach((button) => {
      const active = button.dataset.keyDevice === state.device;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    section.querySelectorAll("[data-key-controls]").forEach((fieldset) => { fieldset.hidden = fieldset.dataset.keyControls !== state.device; });
    renderPreview();
  };

  const save = async (partial) => {
    if (!state.current) return;
    try {
      const updated = await request(`/api/admin/key-screens/${encodeURIComponent(state.current.id)}`, { method: "PATCH", body: { expectedRevision: state.current.revision, ...partial } });
      state.screens = state.screens.map((screen) => screen.id === updated.id ? updated : screen);
      state.current = updated;
      renderSelect();
      message("Cambios guardados.");
    } catch (error) { message(error.message, true); }
  };

  const beginDrag = (event) => {
    if (event.button !== 0 || !state.current) return;
    const screen = formFrame();
    const config = renderer.resolve(screen, state.device);
    const kind = el.formGroup.contains(event.target) ? "form" : el.privacy.contains(event.target) ? "privacy" : el.content.contains(event.target) ? "content" : "media";
    if (kind === "media" && !state.geometry?.valid) return;
    state.drag = { pointerId: event.pointerId, kind, x: event.clientX, y: event.clientY, config, geometry: state.geometry };
    el.preview.classList.add("is-dragging");
    el.preview.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event) => {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = el.preview.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / viewport().width : 1;
    const deltaX = (event.clientX - drag.x) / scale;
    const deltaY = (event.clientY - drag.y) / scale;
    const prefix = devicePrefix();
    if (drag.kind === "media") {
      const focal = geometryEngine.focalFromDrag(drag.geometry, drag.config, deltaX, deltaY);
      setInput(`${prefix}FocalX`, focal.focalX.toFixed(1));
      setInput(`${prefix}FocalY`, focal.focalY.toFixed(1));
    } else if (drag.kind === "content") {
      const size = viewport();
      const offsets = renderer.clampContentOffsets({
        viewportWidth: size.width,
        viewportHeight: size.height,
        contentWidth: el.content.offsetWidth || Math.min(520, size.width - 40),
        contentHeight: el.content.offsetHeight || (state.device === "mobile" ? 300 : 230),
        horizontalAlign: drag.config.horizontalAlign,
        verticalAlign: drag.config.verticalAlign,
        offsetX: drag.config.offsetX + deltaX,
        offsetY: drag.config.offsetY + deltaY,
      });
      setInput(`${prefix}OffsetX`, offsets.offsetX);
      setInput(`${prefix}OffsetY`, offsets.offsetY);
    } else {
      const field = drag.kind === "form" ? "FormOffset" : "PrivacyOffset";
      const startX = drag.kind === "form" ? drag.config.formOffsetX : drag.config.privacyOffsetX;
      const startY = drag.kind === "form" ? drag.config.formOffsetY : drag.config.privacyOffsetY;
      setInput(`${prefix}${field}X`, Math.round(Math.min(400, Math.max(-400, startX + deltaX))));
      setInput(`${prefix}${field}Y`, Math.round(Math.min(400, Math.max(-400, startY + deltaY))));
    }
    renderPreview();
    event.preventDefault();
  };

  const endDrag = (event) => {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    el.preview.releasePointerCapture?.(event.pointerId);
    state.drag = null;
    el.preview.classList.remove("is-dragging");
  };

  const zoomMedia = (event) => {
    if (!state.geometry?.valid || !state.current) return;
    event.preventDefault();
    const rect = el.preview.getBoundingClientRect();
    const scale = rect.width > 0 ? rect.width / viewport().width : 1;
    const pointX = (event.clientX - rect.left) / scale;
    const pointY = (event.clientY - rect.top) / scale;
    const config = renderer.resolve(formFrame(), state.device);
    const nextZoom = Math.min(3, Math.max(1, config.zoom * Math.exp(-event.deltaY * 0.0015)));
    const next = geometryEngine.zoomAtPoint(state.geometry, nextZoom, pointX, pointY);
    const prefix = devicePrefix();
    setInput(`${prefix}Zoom`, next.zoom.toFixed(2));
    setInput(`${prefix}FocalX`, next.focalX.toFixed(1));
    setInput(`${prefix}FocalY`, next.focalY.toFixed(1));
    renderPreview();
  };

  const load = async () => {
    try {
      const data = await request("/api/admin/key-screens");
      state.settings = data.settings;
      state.screens = data.screens;
      state.assets = data.assets;
      state.loaded = true;
      el.count.textContent = data.preregisteredCount;
      el.master.checked = data.settings.enabled;
      el.masterLabel.textContent = data.settings.enabled ? "ACTIVA" : "DESACTIVADA";
      renderSelect();
      message("");
    } catch (error) { message(error.message, true); }
  };

  el.form.addEventListener("input", renderPreview);
  el.form.addEventListener("submit", (event) => { event.preventDefault(); save(formValues()); });
  el.select.addEventListener("change", () => fill(selectedScreen()));
  el.create.addEventListener("click", async () => { const internalName = el.newName.value.trim(); if (!internalName) return message("Escribe un nombre para la pantalla.", true); try { const screen = await request("/api/admin/key-screens", { method: "POST", body: { internalName } }); state.screens.unshift(screen); state.current = screen; el.newName.value = ""; renderSelect(); message("Pantalla creada."); } catch (error) { message(error.message, true); } });
  el.activate.addEventListener("click", async () => { if (!state.current) return; try { state.settings = await request("/api/admin/key-screens/active", { method: "PATCH", body: { screenId: state.current.id } }); renderSelect(); message("Pantalla seleccionada. Usa el interruptor para mostrarla al público."); } catch (error) { message(error.message, true); } });
  el.master.addEventListener("change", async () => { try { state.settings = await request("/api/admin/key-screens/master", { method: "PATCH", body: { enabled: el.master.checked } }); el.masterLabel.textContent = state.settings.enabled ? "ACTIVA" : "DESACTIVADA"; message(state.settings.enabled ? "Pantalla clave activada." : "Pantalla clave desactivada."); } catch (error) { el.master.checked = !el.master.checked; message(error.message, true); } });
  el.remove.addEventListener("click", async () => { if (!state.current || !confirm(`¿Eliminar "${state.current.internalName}"?`)) return; try { await request(`/api/admin/key-screens/${encodeURIComponent(state.current.id)}`, { method: "DELETE" }); state.screens = state.screens.filter((screen) => screen.id !== state.current.id); state.current = null; renderSelect(); message("Pantalla eliminada."); } catch (error) { message(error.message, true); } });
  el.upload.addEventListener("click", async () => { const file = el.uploadInput.files?.[0]; if (!file) return message("Selecciona un archivo.", true); const body = new FormData(); body.append("file", file); try { el.upload.disabled = true; const asset = await request("/api/admin/key-screens/media", { method: "POST", body }); state.assets.unshift(asset); renderAssets(); await save({ mediaAssetId: asset.id }); el.uploadInput.value = ""; } catch (error) { message(error.message, true); } finally { el.upload.disabled = false; } });
  section.querySelectorAll("[data-key-device]").forEach((button) => button.addEventListener("click", () => switchDevice(button.dataset.keyDevice)));
  el.preview.addEventListener("pointerdown", beginDrag);
  el.preview.addEventListener("pointermove", moveDrag);
  el.preview.addEventListener("pointerup", endDrag);
  el.preview.addEventListener("pointercancel", endDrag);
  el.preview.addEventListener("wheel", zoomMedia, { passive: false });
  window.addEventListener("resize", scalePreview, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(scalePreview).observe(el.stage);
  window.CRONOX_KEY_SCREEN = { load };
})();
