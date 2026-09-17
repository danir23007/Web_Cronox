(function (globalScope) {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const safeUrl = (value) => globalScope.CRONOX_SECURITY?.productImageUrl?.(value, "") || "";
  const defaults = () => ({
    galleryPositionX: 50,
    galleryPositionY: 50,
    galleryZoom: 1,
    galleryFit: "CONTAIN",
  });
  let images = [];
  let selectedKey = null;
  let expectedUpdatedAt = null;
  let productId = null;
  let busy = false;
  let drag = null;

  const elements = {};
  const keyOf = (image) => image.id ? `id:${image.id}` : image.clientId;
  const selected = () => images.find((image) => keyOf(image) === selectedKey && image.isActive) || null;
  const active = () => images.filter((image) => image.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = () => images.filter((image) => !image.isActive);
  const announce = (message, isError = false) => {
    if (!elements.status) return;
    elements.status.textContent = message;
    elements.status.style.color = isError ? "#ff7777" : "";
  };

  const normalizeOrder = () => {
    const ordered = active();
    const primary = ordered.find((image) => image.isPrimary) || ordered[0];
    ordered.forEach((image) => { image.isPrimary = image === primary; });
    if (primary) {
      const index = ordered.indexOf(primary);
      if (index > 0) ordered.splice(index, 1);
      if (ordered[0] !== primary) ordered.unshift(primary);
    }
    ordered.forEach((image, index) => { image.sortOrder = index; });
  };

  const normalizeImage = (raw, index) => ({
    id: Number(raw?.id) || undefined,
    clientId: raw?.clientId || `new:${globalScope.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random()}`}`,
    url: safeUrl(raw?.url),
    alt: String(raw?.alt || ""),
    sortOrder: Number(raw?.sortOrder ?? index),
    isPrimary: Boolean(raw?.isPrimary),
    isActive: raw?.isActive !== false,
    galleryPositionX: Number(raw?.galleryPositionX ?? 50),
    galleryPositionY: Number(raw?.galleryPositionY ?? 50),
    galleryZoom: Number(raw?.galleryZoom ?? 1),
    galleryFit: String(raw?.galleryFit || "CONTAIN").toUpperCase() === "COVER" ? "COVER" : "CONTAIN",
  });

  const applyPreview = () => {
    const image = selected();
    if (!image || !elements.previewImage || !elements.preview) return;
    elements.previewImage.src = image.url;
    elements.previewImage.alt = image.alt || "Vista previa de la imagen seleccionada";
    elements.x.value = String(image.galleryPositionX);
    elements.y.value = String(image.galleryPositionY);
    elements.zoom.value = String(image.galleryZoom);
    elements.fit.value = image.galleryFit;
    elements.alt.value = image.alt;
    elements.xValue.textContent = `${Math.round(image.galleryPositionX)}%`;
    elements.yValue.textContent = `${Math.round(image.galleryPositionY)}%`;
    elements.zoomValue.textContent = `${image.galleryZoom.toFixed(2)}×`;
    const framing = {
      focalX: image.galleryPositionX,
      focalY: image.galleryPositionY,
      zoom: image.galleryZoom,
      fit: image.galleryFit,
      minZoom: 0.5,
      maxZoom: 3,
    };
    globalScope.CRONOX_MEDIA_GEOMETRY?.apply(elements.previewImage, elements.preview, framing);
    const ordered = active();
    const index = ordered.indexOf(image);
    elements.primary.disabled = image.isPrimary || busy;
    elements.left.disabled = index <= 0 || busy;
    elements.right.disabled = index < 0 || index >= ordered.length - 1 || busy;
    elements.archive.disabled = ordered.length <= 1 || busy;
    elements.cardEditor.hidden = !image.isPrimary;
  };

  const render = () => {
    normalizeOrder();
    const ordered = active();
    if (!ordered.some((image) => keyOf(image) === selectedKey)) selectedKey = ordered[0] ? keyOf(ordered[0]) : null;
    elements.thumbnails.innerHTML = "";
    ordered.forEach((image, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "product-gallery-thumb";
      button.dataset.imageKey = keyOf(image);
      button.setAttribute("aria-pressed", String(keyOf(image) === selectedKey));
      button.setAttribute("aria-label", `Seleccionar imagen ${index + 1}${image.isPrimary ? ", principal" : ""}`);
      const thumb = document.createElement("img");
      thumb.src = image.url;
      thumb.alt = "";
      button.appendChild(thumb);
      if (image.isPrimary) {
        const badge = document.createElement("span");
        badge.className = "product-gallery-badge";
        badge.textContent = "Principal";
        button.appendChild(badge);
      }
      const position = document.createElement("span");
      position.textContent = `${index + 1}${image.alt ? " · SEO ✓" : ""}`;
      button.appendChild(position);
      button.addEventListener("click", () => { selectedKey = keyOf(image); render(); });
      elements.thumbnails.appendChild(button);
    });
    elements.editor.hidden = !ordered.length;
    announce(ordered.length ? `${ordered.length} imagen${ordered.length === 1 ? "" : "es"} activa${ordered.length === 1 ? "" : "s"}.` : "Sin imágenes activas.");
    renderHistory();
    applyPreview();
  };

  const renderHistory = () => {
    elements.history.innerHTML = "";
    const entries = archived();
    if (!entries.length) {
      elements.history.textContent = "No hay imágenes en el historial.";
      return;
    }
    entries.forEach((image) => {
      const item = document.createElement("div");
      item.className = "product-gallery-history-item";
      const preview = document.createElement("img");
      preview.src = image.url;
      preview.alt = image.alt || "Imagen archivada";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "btn";
      restore.textContent = "Añadir de nuevo a la galería";
      restore.disabled = busy;
      restore.addEventListener("click", () => {
        if (image.isActive) return;
        image.isActive = true;
        image.isPrimary = active().length === 1;
        image.sortOrder = active().length - 1;
        selectedKey = keyOf(image);
        render();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn danger";
      remove.textContent = "Eliminar definitivamente";
      remove.disabled = busy || !image.id || !productId;
      remove.addEventListener("click", async () => {
        if (!globalScope.confirm("Esta acción eliminará el archivo definitivamente y no se puede deshacer. ¿Continuar?")) return;
        busy = true;
        render();
        try {
          const result = await globalScope.CRONOX_API?.admin?.deleteProductImage?.(productId, image.id, expectedUpdatedAt);
          images = images.filter((candidate) => candidate !== image);
          expectedUpdatedAt = result?.updatedAt || expectedUpdatedAt;
          announce("Imagen eliminada definitivamente.");
        } catch (error) {
          announce(error?.payload?.message || error?.message || "No se pudo eliminar la imagen.", true);
        } finally {
          busy = false;
          render();
        }
      });
      item.append(preview, restore, remove);
      elements.history.appendChild(item);
    });
  };

  const updateSelected = () => {
    const image = selected();
    if (!image) return;
    image.galleryPositionX = Number(elements.x.value);
    image.galleryPositionY = Number(elements.y.value);
    image.galleryZoom = Number(elements.zoom.value);
    image.galleryFit = elements.fit.value;
    image.alt = elements.alt.value;
    applyPreview();
  };

  const dispatchPrimaryChanged = (image) => document.dispatchEvent(new CustomEvent("cronox:primary-image-changed", { detail: { url: image?.url || "" } }));

  const bind = () => {
    Object.assign(elements, {
      status: byId("productGalleryStatus"), thumbnails: byId("productGalleryThumbnails"), editor: byId("productGalleryEditor"),
      preview: byId("productGalleryPreview"), previewImage: byId("productGalleryPreviewImage"),
      x: byId("productGalleryPositionX"), y: byId("productGalleryPositionY"), zoom: byId("productGalleryZoom"), fit: byId("productGalleryFit"), alt: byId("productGalleryAlt"),
      xValue: byId("productGalleryPositionXValue"), yValue: byId("productGalleryPositionYValue"), zoomValue: byId("productGalleryZoomValue"),
      reset: byId("productGalleryReset"), primary: byId("productGalleryPrimary"), left: byId("productGalleryLeft"), right: byId("productGalleryRight"), archive: byId("productGalleryArchive"),
      history: byId("productGalleryHistoryGrid"), cardEditor: byId("productCardFramingEditor"),
    });
    if (!elements.thumbnails) return;
    [elements.x, elements.y, elements.zoom, elements.fit, elements.alt].forEach((input) => input?.addEventListener("input", updateSelected));
    elements.previewImage?.addEventListener("load", applyPreview);
    elements.reset?.addEventListener("click", () => { Object.assign(selected() || {}, defaults()); render(); });
    elements.primary?.addEventListener("click", () => {
      const image = selected();
      if (!image) return;
      images.forEach((candidate) => { candidate.isPrimary = candidate === image; });
      image.sortOrder = -1;
      normalizeOrder();
      dispatchPrimaryChanged(image);
      render();
    });
    const move = (offset) => {
      const image = selected();
      const ordered = active();
      const from = ordered.indexOf(image);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= ordered.length) return;
      [ordered[from].sortOrder, ordered[to].sortOrder] = [ordered[to].sortOrder, ordered[from].sortOrder];
      if (to === 0) {
        images.forEach((candidate) => { candidate.isPrimary = candidate === image; });
        dispatchPrimaryChanged(image);
      }
      render();
    };
    elements.left?.addEventListener("click", () => move(-1));
    elements.right?.addEventListener("click", () => move(1));
    elements.archive?.addEventListener("click", () => {
      const image = selected();
      const ordered = active();
      if (!image || ordered.length <= 1) { announce("El producto debe conservar al menos una imagen activa.", true); return; }
      if (image.isPrimary && !globalScope.confirm("Vas a quitar la imagen principal. La siguiente imagen activa pasará a ser principal. ¿Continuar?")) return;
      const wasPrimary = image.isPrimary;
      image.isActive = false;
      image.isPrimary = false;
      const replacement = active()[0];
      if (wasPrimary && replacement) { replacement.isPrimary = true; dispatchPrimaryChanged(replacement); }
      selectedKey = replacement ? keyOf(replacement) : null;
      render();
    });
    elements.preview?.addEventListener("pointerdown", (event) => {
      const image = selected();
      const geometry = globalScope.CRONOX_MEDIA_GEOMETRY?.apply(elements.previewImage, elements.preview, { focalX:image?.galleryPositionX, focalY:image?.galleryPositionY, zoom:image?.galleryZoom, fit:image?.galleryFit, minZoom:.5, maxZoom:3 });
      if (!image || !geometry?.valid) return;
      drag = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, focalX:image.galleryPositionX, focalY:image.galleryPositionY, geometry };
      elements.preview.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    elements.preview?.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const focal = globalScope.CRONOX_MEDIA_GEOMETRY?.focalFromDrag(drag.geometry, drag, event.clientX-drag.x, event.clientY-drag.y);
      const image = selected();
      if (focal && image) { image.galleryPositionX=focal.focalX; image.galleryPositionY=focal.focalY; applyPreview(); }
    });
    ["pointerup", "pointercancel"].forEach((name) => elements.preview?.addEventListener(name, () => { drag = null; }));
    render();
  };

  const manager = {
    bind,
    reset() { images=[]; selectedKey=null; expectedUpdatedAt=null; productId=null; busy=false; render(); },
    load(product) {
      productId = Number(product?.id) || null;
      expectedUpdatedAt = product?.updatedAt || null;
      images = Array.isArray(product?.images) ? product.images.map(normalizeImage).filter((image) => image.url) : [];
      normalizeOrder();
      selectedKey = active()[0] ? keyOf(active()[0]) : null;
      render();
    },
    addUploaded(urls) {
      const existing = new Set(images.map((image) => image.url));
      const additions = urls.map((url, index) => normalizeImage({ url, isActive:true, isPrimary:active().length === 0 && index === 0, sortOrder:active().length + index }, index)).filter((image) => image.url && !existing.has(image.url));
      images.push(...additions);
      normalizeOrder();
      if (additions[0]) selectedKey = keyOf(additions[0]);
      render();
    },
    serialize() { normalizeOrder(); return [...active(), ...archived()].map(({ clientId, ...image }) => image); },
    expectedUpdatedAt: () => expectedUpdatedAt,
    primaryUrl: () => active().find((image) => image.isPrimary)?.url || "",
    notify: announce,
  };
  globalScope.CRONOX_PRODUCT_GALLERY = manager;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once:true }); else bind();
})(window);
