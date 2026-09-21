(function () {
  "use strict";
  const section = document.getElementById("section-newsletter");
  if (!section) return;
  const $ = (id) => document.getElementById(id);
  const elements = {
    status: $("newsletterAdminStatus"), save: $("newsletterAdminSave"), upload: $("newsletterAssetUpload"),
    uploadButton: $("newsletterAssetUploadButton"), assets: $("newsletterAssetGrid"),
    focalX: $("newsletterFocalX"), focalY: $("newsletterFocalY"), zoom: $("newsletterZoom"),
    focalXValue: $("newsletterFocalXValue"), focalYValue: $("newsletterFocalYValue"), zoomValue: $("newsletterZoomValue"),
    focalXLabel: $("newsletterFocalXLabel"), focalYLabel: $("newsletterFocalYLabel"), zoomLabel: $("newsletterZoomLabel"),
    reset: $("newsletterFrameReset"), asciiEnabled: $("newsletterAsciiEnabled"),
    mediaOpacity: $("newsletterMediaOpacity"), mediaOpacityValue: $("newsletterMediaOpacityValue"),
    asciiOpacity: $("newsletterAsciiOpacity"), asciiOpacityValue: $("newsletterAsciiOpacityValue"),
    preview: $("newsletterPreview"), previewTitle: $("newsletterPreviewTitle"), previewSurface: $("newsletterPreviewSurface"), previewRoot: $("newsletterPreviewRoot"),
  };
  const roots = [...section.querySelectorAll("[data-newsletter-preview]")];
  const geometry = window.CRONOX_MEDIA_GEOMETRY;
  const renderer = window.CRONOX_NEWSLETTER_RENDERER;
  roots.forEach((root) => renderer?.renderStructure?.(root, { preview: true }));
  const resizePreviewSurfaces = () => {
    section.querySelectorAll('.newsletter-preview__surface').forEach((surface) => {
      const viewport = surface.parentElement;
      const width = Number(surface.dataset.newsletterLogicalWidth || 0);
      const height = Number(surface.dataset.newsletterLogicalHeight || 0);
      if (!viewport || !width || !height) return;
      const scale = Math.min(1, viewport.clientWidth / width);
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      surface.style.transform = `scale(${scale})`;
      viewport.style.height = `${height * scale}px`;
    });
  };
  const state = { loaded: false, loading: null, saving: false, device: "desktop", layer: "background", draft: null, assets: [], controllers: [], drag: null };
  const apiBase = () => window.CRONOX_API?.API_BASE || "";
  const frame = (value) => ({ focalX: Number(value?.focalX ?? 50), focalY: Number(value?.focalY ?? 50), zoom: Number(value?.zoom ?? 1), fit: value?.fit || "COVER" });
  const asciiFrame = (value) => ({ x: Number(value?.x ?? 50), y: Number(value?.y ?? 50), scale: Number(value?.scale ?? 1) });
  const setStatus = (message, kind = "info") => { elements.status.textContent = message; elements.status.dataset.state = kind; };
  const parse = async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || `Error del servidor (${response.status})`);
    return payload;
  };
  const request = async (path, options = {}) => {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (method !== "GET") Object.assign(headers, await window.CRONOX_API?.getCsrfHeaders?.());
    return parse(await fetch(`${apiBase()}${path}`, { ...options, method, headers, credentials: "include", cache: method === "GET" ? "no-store" : undefined }));
  };
  const selectedSource = () => state.assets.find((asset) => asset.id === state.draft?.mediaAssetId)?.source || state.draft?.source || renderer?.FALLBACK_SOURCE;
  const previewConfig = () => ({ ...state.draft, source: selectedSource() });
  const updatePreviews = () => state.controllers.forEach((controller) => controller?.update?.(previewConfig()));
  const updatePreviewViewport = () => {
    const mobile = state.device === "mobile";
    elements.previewRoot.dataset.newsletterDevice = state.device;
    elements.previewSurface.dataset.newsletterLogicalWidth = mobile ? "390" : "1280";
    elements.previewSurface.dataset.newsletterLogicalHeight = mobile ? "844" : "720";
    elements.preview.classList.toggle("newsletter-preview--mobile", mobile);
    elements.preview.classList.toggle("newsletter-preview--desktop", !mobile);
    elements.preview.dataset.editLayer = state.layer;
    elements.previewTitle.textContent = mobile ? "Mobile · 390 px" : "Desktop";
    resizePreviewSurfaces();
    state.controllers.forEach((controller) => controller?.reflow?.());
  };
  const syncControls = () => {
    if (!state.draft) return;
    const ascii = state.layer === "ascii";
    const current = ascii ? state.draft[`${state.device}Ascii`] : state.draft[state.device];
    const x = ascii ? current.x : current.focalX;
    const y = ascii ? current.y : current.focalY;
    const zoom = ascii ? current.scale : current.zoom;
    elements.focalX.min = ascii ? "5" : "0"; elements.focalX.max = ascii ? "95" : "100";
    elements.focalY.min = ascii ? "5" : "0"; elements.focalY.max = ascii ? "95" : "100";
    elements.zoom.min = ascii ? "0.5" : "1"; elements.zoom.max = ascii ? "2" : "3";
    elements.focalX.value = String(x); elements.focalY.value = String(y); elements.zoom.value = String(zoom);
    elements.focalXValue.textContent = `${Math.round(x)}%`; elements.focalYValue.textContent = `${Math.round(y)}%`; elements.zoomValue.textContent = `${zoom.toFixed(2)}×`;
    elements.focalXLabel.textContent = ascii ? "ASCII horizontal" : "Posición X";
    elements.focalYLabel.textContent = ascii ? "ASCII vertical" : "Posición Y";
    elements.zoomLabel.textContent = ascii ? "Escala ASCII" : "Zoom";
    elements.mediaOpacity.value = String(Math.round(state.draft.mediaOpacity * 100)); elements.mediaOpacityValue.textContent = `${Math.round(state.draft.mediaOpacity * 100)}%`;
    elements.asciiEnabled.checked = state.draft.asciiEnabled; elements.asciiOpacity.value = String(Math.round(state.draft.asciiOpacity * 100)); elements.asciiOpacityValue.textContent = `${Math.round(state.draft.asciiOpacity * 100)}%`;
    section.querySelectorAll("[data-newsletter-edit-device]").forEach((button) => { const active = button.dataset.newsletterEditDevice === state.device; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    section.querySelectorAll("[data-newsletter-edit-layer]").forEach((button) => { const active = button.dataset.newsletterEditLayer === state.layer; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    updatePreviewViewport();
  };
  const renderAssets = () => {
    elements.assets.replaceChildren();
    const fallback = document.createElement("button"); fallback.type = "button"; fallback.className = `newsletter-asset${state.draft?.mediaAssetId ? "" : " is-selected"}`; fallback.dataset.assetId = "";
    fallback.innerHTML = `<img src="${renderer.FALLBACK_SOURCE}" alt=""><span>Imagen predeterminada</span>`; elements.assets.appendChild(fallback);
    state.assets.forEach((asset) => { const button = document.createElement("button"); button.type = "button"; button.className = `newsletter-asset${state.draft?.mediaAssetId === asset.id ? " is-selected" : ""}`; button.dataset.assetId = asset.id; const image = document.createElement("img"); image.src = asset.source; image.alt = ""; image.loading = "lazy"; const label = document.createElement("span"); label.textContent = asset.originalFilename; button.append(image, label); elements.assets.appendChild(button); });
  };
  const load = () => {
    if (state.loading) return state.loading;
    state.loading = Promise.all([request("/api/admin/newsletter"), request("/api/admin/newsletter/assets")]).then(([settings, library]) => {
      state.assets = Array.isArray(library.assets) ? library.assets : [];
      state.draft = { mediaAssetId: settings.mediaAssetId || null, source: settings.source || null, desktop: frame(settings.desktop), mobile: frame(settings.mobile), desktopAscii: asciiFrame(settings.desktopAscii), mobileAscii: asciiFrame(settings.mobileAscii || settings.desktopAscii), mediaOpacity: Number(settings.mediaOpacity ?? 1), asciiEnabled: settings.asciiEnabled !== false, asciiOpacity: Number(settings.asciiOpacity ?? 1), revision: Number(settings.revision || 0) };
      state.controllers = roots.map((root) => renderer.mount(root, previewConfig()));
      state.loaded = true; renderAssets(); syncControls(); updatePreviews(); resizePreviewSurfaces(); setStatus("Configuración cargada.");
    }).catch((error) => setStatus(error.message || "No se pudo cargar Newsletter.", "error")).finally(() => { state.loading = null; });
    return state.loading;
  };
  const changeFrame = (backgroundKey, asciiKey, value) => { if (!state.draft) return; const target = state.layer === "ascii" ? state.draft[`${state.device}Ascii`] : state.draft[state.device]; target[state.layer === "ascii" ? asciiKey : backgroundKey] = Number(value); syncControls(); updatePreviews(); };
  elements.focalX.addEventListener("input", () => changeFrame("focalX", "x", elements.focalX.value));
  elements.focalY.addEventListener("input", () => changeFrame("focalY", "y", elements.focalY.value));
  elements.zoom.addEventListener("input", () => changeFrame("zoom", "scale", elements.zoom.value));
  elements.reset.addEventListener("click", () => { if (!state.draft) return; if (state.layer === "ascii") state.draft[`${state.device}Ascii`] = asciiFrame(); else state.draft[state.device] = frame(); syncControls(); updatePreviews(); });
  elements.mediaOpacity.addEventListener("input", () => { if (!state.draft) return; state.draft.mediaOpacity = Number(elements.mediaOpacity.value) / 100; syncControls(); updatePreviews(); });
  elements.asciiEnabled.addEventListener("change", () => { if (!state.draft) return; state.draft.asciiEnabled = elements.asciiEnabled.checked; updatePreviews(); });
  elements.asciiOpacity.addEventListener("input", () => { if (!state.draft) return; state.draft.asciiOpacity = Number(elements.asciiOpacity.value) / 100; syncControls(); updatePreviews(); });
  section.querySelectorAll("[data-newsletter-edit-device]").forEach((button) => button.addEventListener("click", () => { state.device = button.dataset.newsletterEditDevice; syncControls(); updatePreviews(); }));
  section.querySelectorAll("[data-newsletter-edit-layer]").forEach((button) => button.addEventListener("click", () => { state.layer = button.dataset.newsletterEditLayer; syncControls(); }));
  elements.assets.addEventListener("click", (event) => { const button = event.target.closest("[data-asset-id]"); if (!button || !state.draft) return; const asset = state.assets.find((item) => item.id === button.dataset.assetId); state.draft.mediaAssetId = asset?.id || null; state.draft.source = asset?.source || null; renderAssets(); updatePreviews(); });
  roots.forEach((root) => {
    const wrapper = root.querySelector(".popup-image-wrapper"); const image = root.querySelector(".popup-image");
    wrapper?.addEventListener("pointerdown", (event) => { if (!state.draft) return; const device = state.device; const current = state.draft[device]; const result = geometry?.apply?.(image, wrapper, current); if (state.layer === "background" && !result?.valid) return; const rect = wrapper.getBoundingClientRect(); const ascii = state.draft[`${device}Ascii`]; state.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, focalX: current.focalX, focalY: current.focalY, asciiX: ascii.x, asciiY: ascii.y, geometry: result, rect, device, layer: state.layer, wrapper }; wrapper.setPointerCapture?.(event.pointerId); wrapper.classList.add("is-dragging"); event.preventDefault(); });
    wrapper?.addEventListener("pointermove", (event) => { if (!state.drag || state.drag.pointerId !== event.pointerId) return; if (state.drag.layer === "ascii") { const target = state.draft[`${state.drag.device}Ascii`]; target.x = Math.max(5, Math.min(95, state.drag.asciiX + ((event.clientX - state.drag.x) / Math.max(1, state.drag.rect.width)) * 100)); target.y = Math.max(5, Math.min(95, state.drag.asciiY + ((event.clientY - state.drag.y) / Math.max(1, state.drag.rect.height)) * 100)); } else { const next = geometry.focalFromDrag(state.drag.geometry, state.drag, event.clientX - state.drag.x, event.clientY - state.drag.y); state.draft[state.drag.device].focalX = next.focalX; state.draft[state.drag.device].focalY = next.focalY; } syncControls(); updatePreviews(); });
    const stop = (event) => { if (!state.drag || state.drag.pointerId !== event.pointerId) return; state.drag.wrapper.releasePointerCapture?.(event.pointerId); state.drag.wrapper.classList.remove("is-dragging"); state.drag = null; };
    wrapper?.addEventListener("pointerup", stop); wrapper?.addEventListener("pointercancel", stop);
  });
  elements.uploadButton.addEventListener("click", async () => { const file = elements.upload.files?.[0]; if (!file) return setStatus("Selecciona una imagen.", "error"); elements.uploadButton.disabled = true; try { const form = new FormData(); form.append("file", file); const response = await request("/api/admin/newsletter/assets", { method: "POST", body: form }); const uploaded = { ...response.asset, source: response.asset.publicUrl || response.asset.source }; state.assets.unshift(uploaded); state.draft.mediaAssetId = uploaded.id; state.draft.source = uploaded.source; renderAssets(); updatePreviews(); setStatus("Imagen subida. Guarda para publicarla.", "success"); } catch (error) { setStatus(error.message, "error"); } finally { elements.uploadButton.disabled = false; } });
  elements.save.addEventListener("click", async () => { if (!state.draft || state.saving) return; state.saving = true; elements.save.disabled = true; setStatus("Guardando…"); try { const saved = await request("/api/admin/newsletter", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaAssetId: state.draft.mediaAssetId, desktop: state.draft.desktop, mobile: state.draft.mobile, desktopAscii: state.draft.desktopAscii, mobileAscii: state.draft.mobileAscii, mediaOpacity: state.draft.mediaOpacity, asciiEnabled: state.draft.asciiEnabled, asciiOpacity: state.draft.asciiOpacity, expectedRevision: state.draft.revision }) }); state.draft.revision = saved.revision; state.draft.source = saved.source; setStatus("Newsletter guardada correctamente.", "success"); } catch (error) { setStatus(error.message, "error"); } finally { state.saving = false; elements.save.disabled = false; } });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => { resizePreviewSurfaces(); state.controllers.forEach((controller) => controller?.reflow?.()); }).observe(section.querySelector('.newsletter-admin__previews'));
  else window.addEventListener('resize', resizePreviewSurfaces);
  document.querySelectorAll('[data-nav-target="section-newsletter"]').forEach((button) => button.addEventListener("click", load));
  if (window.location.hash === "#section-newsletter") void load();
  window.CRONOX_NEWSLETTER_ADMIN = { load, state };
})();
