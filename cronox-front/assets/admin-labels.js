(() => {
  "use strict";
  const root = document.getElementById("physicalLabels");
  if (!root) return;
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let page = 1,
    pages = 1,
    loaded = false,
    busy = false,
    layout;
  const selectionKey = (value) =>
    String(value).includes("|") ? String(value) : Number(value);
  const selection = new Map(),
    openProducts = new Set();
  let prepared = null,
    pendingAction = null;
  root.innerHTML = `<style>
  .labels-feedback{border:1px solid var(--admin-line,#aaa);border-radius:6px;padding:12px;margin:12px 0;overflow-wrap:anywhere}.labels-feedback[role=alert]{border-color:#bf4916}.labels-feedback[hidden],[data-prepared][hidden]{display:none}.labels-filters,.labels-actions,.labels-pages{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}.labels-filters label{flex:1;min-width:180px}.labels-product{border:1px solid var(--admin-line,#aaa);border-radius:8px;margin:12px 0;min-width:0}.labels-product summary{display:flex;align-items:center;gap:12px;padding:14px;cursor:pointer;list-style:none}.labels-product summary::-webkit-details-marker{display:none}.labels-product summary:focus-visible{outline:3px solid #4b7ce7;outline-offset:2px}.labels-product summary img,.labels-image-placeholder{width:56px;height:56px;flex:0 0 56px;object-fit:contain}.labels-image-placeholder{display:grid;place-items:center;font-size:10px;border:1px solid #aaa}.labels-heading{flex:1;min-width:0}.labels-heading strong{display:block;overflow-wrap:anywhere;font-size:1rem}.labels-heading small,.labels-product-selection{display:block;margin-top:4px}.labels-disclosure{flex-shrink:0;font-size:22px}.labels-product[open] .labels-disclosure{transform:rotate(45deg)}.labels-product-panel{padding:0 14px 14px}.labels-variants{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px}.labels-variant{border:1px solid #aaa;border-radius:6px;padding:10px;display:grid;gap:6px;min-width:140px;max-width:100%;overflow-wrap:anywhere}.labels-variant input[type=number]{width:100%}.labels-color-warning{color:var(--admin-ink,inherit);border-left:3px solid #bf7b16;padding:6px 10px;margin:0 14px 12px;overflow-wrap:anywhere}.labels-preview{width:100%;height:450px;border:1px solid #999;background:white}#physicalLabels{min-width:0}.labels-message{overflow-wrap:anywhere}@media print{#physicalLabels [data-context]{display:none!important}}@media(max-width:480px){.labels-product summary{gap:8px;padding:10px}.labels-product-panel{padding:0 10px 10px}.labels-product-selection{font-size:12px}}
  </style><form class="labels-filters"><label>Buscar por nombre o referencia<input class="input" name="search" type="search" maxlength="120" placeholder="Nombre o referencia"></label><label>Estado del producto<select class="input" name="active"><option value="">Todos</option><option value="true">Activo</option><option value="false">Inactivo</option></select></label><button class="btn" type="submit">Buscar</button></form>
  <p class="labels-message" role="status" aria-live="polite"></p><div class="labels-list"></div><div class="labels-pages"><button class="btn" data-action="prev">Anterior</button><span data-page></span><button class="btn" data-action="next">Siguiente</button></div>
  <p data-selection></p><div class="labels-actions"><button type="button" class="btn" data-action="clear">Vaciar selección</button><button type="button" class="btn" data-action="generate">Generar códigos ausentes</button><button type="button" class="btn" data-action="preview">Ver etiquetas</button><button type="button" class="btn primary" data-action="print">Imprimir selección</button><button type="button" class="btn" data-action="test">Imprimir etiqueta de prueba</button><button type="button" class="btn" data-action="pdf">Descargar PDF</button></div>
  <div class="labels-feedback" data-feedback role="status" aria-live="polite" tabindex="-1" hidden><p data-action-message></p><div data-recovery></div></div><div class="labels-actions" data-prepared hidden></div>
  <p>Selecciona Brother QL-700, formato de Windows <strong>PRUEBA 1 · 62 × 35 mm</strong> (Alimentar: 3 mm), escala <strong>100 % / tamaño real</strong>, sin ajustar a página ni cabeceras o pies. Revisa también papel y corte en el controlador; el diálogo puede conservar otra impresora o formato.</p><div data-context></div><div data-preview></div>`;
  root
    .querySelectorAll("button:not([type])")
    .forEach((button) => (button.type = "button"));
  const feedback = root.querySelector("[data-feedback]");
  function message(text, error = false) {
    root.querySelector(".labels-message").textContent = text;
    root.querySelector("[data-action-message]").textContent = text;
    feedback.hidden = false;
    feedback.setAttribute("role", error ? "alert" : "status");
  }
  function showFeedback() {
    feedback.focus({ preventScroll: true });
    feedback.scrollIntoView?.({ block: "nearest", behavior: "instant" });
  }
  const validQuantity = (q) => Number.isInteger(q) && q >= 1 && q <= 500;
  function context() {
    if (!layout) return;
    root.querySelector("[data-context]").innerHTML =
      `<p>Referencia de colocación manual sobre cartón de 55 × 105 mm: pegatina girada −90°, de 35 × 62 mm y centrada entre el agujero y la web. Esta vista no se imprime.</p><div class="labels-context" style="width:55mm;height:105mm;background:#000;position:relative;margin:16px auto;max-width:100%"><div data-context-sticker style="position:absolute;left:50%;top:50%;width:${Number(layout.width)}mm;height:${Number(layout.height)}mm;transform:translate(-50%,-50%) rotate(-90deg);background:#fff;display:grid;place-items:center;color:#000;font:12px Arial">62 × 35 mm</div></div>`;
  }
  function invalidate() {
    pendingAction = null;
    root.querySelector("[data-recovery]").replaceChildren();
    if (prepared)
      for (const url of [prepared.pdfUrl, prepared.htmlUrl])
        if (url) URL.revokeObjectURL(url);
    prepared = null;
    const links = root.querySelector("[data-prepared]");
    links.replaceChildren();
    links.hidden = true;
    root.querySelector("[data-preview]").replaceChildren();
    const sticker = root.querySelector("[data-context-sticker]");
    if (sticker) sticker.textContent = "62 × 35 mm";
  }
  window.addEventListener("pagehide", invalidate);
  function summary() {
    const lines = [...selection.values()],
      valid = lines.every((l) => validQuantity(l.quantity));
    root.querySelector("[data-selection]").textContent =
      `${selection.size} tallas seleccionadas · ${valid ? lines.reduce((n, l) => n + l.quantity, 0) + " etiquetas" : "revisa las cantidades"}. Máximo 200 tallas, 500 etiquetas por talla y 2000 por solicitud.`;
    root.querySelectorAll("[data-product-summary]").forEach((el) => {
      const ids = [
          ...el.closest("details").querySelectorAll("[data-variant]"),
        ].map((c) => selectionKey(c.dataset.variant)),
        chosen = ids
          .filter((id) => selection.has(id))
          .map((id) => selection.get(id));
      el.textContent = `${chosen.length} tallas · ${chosen.every((l) => validQuantity(l.quantity)) ? chosen.reduce((n, l) => n + l.quantity, 0) + " etiquetas" : "revisa las cantidades"}`;
    });
  }
  async function api(suffix = "", data) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      let csrf = {};
      if (data) {
        if (typeof window.CRONOX_API?.getCsrfHeaders !== "function")
          throw Error(
            "No se pudo validar la sesión del navegador. Vuelve a iniciar sesión.",
          );
        let csrfTimer;
        try {
          csrf = await Promise.race([
            window.CRONOX_API.getCsrfHeaders(),
            new Promise((_, reject) => {
              csrfTimer = setTimeout(
                () =>
                  reject(
                    Error(
                      "No se pudo validar la sesión a tiempo. Reintenta; la selección se conserva.",
                    ),
                  ),
                10000,
              );
            }),
          ]);
        } finally {
          clearTimeout(csrfTimer);
        }
      }
      const response = await fetch(
        (window.CRONOX_API?.API_BASE || "") +
          "/api/admin/physical-labels" +
          suffix,
        {
          method: data ? "POST" : "GET",
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: suffix === "/pdf" ? "application/pdf" : "application/json",
            ...(data
              ? {
                  "Content-Type": "application/json",
                  ...csrf,
                }
              : {}),
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
        },
      );
      if (response.ok && suffix === "/pdf") {
        const blob = await response.blob();
        if (
          !response.headers
            .get("Content-Type")
            ?.toLowerCase()
            .includes("application/pdf") ||
          !blob.size ||
          (await blob.slice(0, 5).text()) !== "%PDF-"
        )
          throw Error(
            "El servidor no ha entregado un PDF válido. Vuelve a intentarlo.",
          );
        return blob;
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = Error(
          response.status === 401
            ? "La sesión ha caducado. Inicia sesión de nuevo para preparar etiquetas."
            : Array.isArray(result.message)
              ? result.message.join(" · ")
              : result.message ||
                (response.status === 403
                  ? "No tienes permiso o no se pudo validar la sesión del navegador."
                  : `El servidor no pudo completar la operación (HTTP ${response.status}). Reintenta sin cambiar la selección.`),
        );
        error.status = response.status;
        error.code = result.code;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError")
        throw Error(
          "Se ha agotado el tiempo de preparación. Puedes reintentar; la selección se conserva.",
        );
      if (error instanceof TypeError)
        throw Error(
          "No se pudo conectar con el servidor. Comprueba la conexión y vuelve a intentarlo; la selección se conserva.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function operate(fn, trigger) {
    if (busy) return;
    busy = true;
    message(trigger ? "Preparando etiquetas…" : "Procesando…");
    const label = trigger?.textContent;
    if (trigger) {
      trigger.textContent = "Preparando…";
      showFeedback();
    }
    root.querySelector(".labels-actions").setAttribute("aria-busy", "true");
    const controls = [...root.querySelectorAll("button,input,select")],
      old = controls.map((c) => c.disabled);
    controls.forEach((c) => (c.disabled = true));
    let after;
    try {
      after = await fn();
    } catch (error) {
      message(error.message || "No se pudo completar la operación.", true);
      const recovery = root.querySelector("[data-recovery]");
      recovery.replaceChildren();
      if (pendingAction) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn primary";
        button.dataset.action = "generate-continue";
        button.textContent = "Generar códigos ausentes y continuar";
        recovery.append(button);
      }
      if (trigger) showFeedback();
    } finally {
      busy = false;
      controls.forEach((c, i) => (c.disabled = old[i]));
      if (trigger) trigger.textContent = label;
      root.querySelector(".labels-actions").setAttribute("aria-busy", "false");
    }
    // Never keep controls locked while a native print dialog is open.
    if (typeof after === "function") after();
  }
  async function refresh() {
    const params = new URLSearchParams(
      new FormData(root.querySelector("form")),
    );
    params.set("page", String(page));
    const data = await api("?" + params);
    pages = data.totalPages;
    layout = data.layout;
    context();
    root.querySelector("[data-page]").textContent =
      `Página ${page} de ${pages} · ${data.total} productos`;
    root.querySelector(".labels-list").innerHTML =
      data.items
        .map((p) => {
          const image = p.images[0]?.url || p.imageUrl,
            presentation = p.labelPresentation || {
              modelName: p.name,
              color: null,
              warning: null,
            };
          p.variants = [
            ...p.variants.map((v) => ({
              ...v,
              lotName: "Sin lote (c?digo antiguo)",
            })),
            ...(p.inventoryLots || []).flatMap((lot) => {
              const profile = lot.profile || {};
              if (lot.profilePending && lot.id !== p.activeLotId) return [];
              return p.variants
                .filter(
                  (v) =>
                    lot.id === p.activeLotId ||
                    profile.variants?.some((x) => x.id === v.id),
                )
                .map((v) => ({
                  ...v,
                  id: v.id + "|" + lot.id,
                  lotName: lot.name + (lot.archived ? " (archivada)" : ""),
                  stockQty: lot.slices
                    .filter((x) => x.variantId === v.id)
                    .reduce((n, x) => n + x.available, 0),
                  physicalBarcode: lot.physicalBarcodes.find(
                    (x) => x.variantId === v.id,
                  ),
                }));
            }),
          ];
          return `<details class="labels-product" data-product-id="${p.id}" ${openProducts.has(p.id) ? "open" : ""}><summary><span>${image && /^(https?:\/\/|\/)/i.test(image) ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<span class="labels-image-placeholder" aria-hidden="true">CRONOX</span>'}</span><span class="labels-heading"><strong title="${esc(p.name)}">${esc(presentation.modelName)}</strong><small>Color: ${esc(presentation.color || "-")} · ${p.isActive ? "Activo" : "Inactivo"}</small><span class="labels-product-selection" data-product-summary>0 tallas · 0 etiquetas</span></span><span class="labels-disclosure" aria-hidden="true">+</span><span class="sr-only">Mostrar u ocultar tallas</span></summary>${presentation.warning ? `<p class="labels-color-warning">${esc(presentation.warning)}</p>` : ""}<div class="labels-product-panel"><button class="btn" type="button" data-product="${p.id}">Seleccionar todas las tallas</button><div class="labels-variants">${p.variants.map((v) => `<div class="labels-variant"><label><input type="checkbox" data-variant="${v.id}" ${selection.has(v.id) ? "checked" : ""}> ${esc(v.size.replace("US_", "US "))}${v.isActive ? "" : " · Inactiva"}</label><strong>Lote: ${esc(v.lotName)}</strong><span>${v.stockQty} disponibles${v.stockQty <= 0 ? " · Sin stock" : ""}</span><span>${esc(v.sku)}</span><span>${esc(v.physicalBarcode?.code || "Código pendiente")}</span><label>Etiquetas<input class="input" aria-label="Cantidad talla ${esc(v.size.replace("US_", "US "))}" type="number" min="1" max="500" step="1" data-quantity="${v.id}" value="${selection.get(v.id)?.quantity ?? 1}"></label></div>`).join("") || "<p>Sin tallas registradas.</p>"}</div></div></details>`;
        })
        .join("") || "<p>No hay productos para estos filtros.</p>";
    summary();
    message("Lista actualizada.");
  }
  root.querySelector("form").onsubmit = (event) => {
    event.preventDefault();
    page = 1;
    operate(refresh);
  };
  root.addEventListener(
    "toggle",
    (event) => {
      const details = event.target;
      if (details.matches(".labels-product")) {
        const id = Number(details.dataset.productId);
        details.open ? openProducts.add(id) : openProducts.delete(id);
      }
    },
    true,
  );
  function changeSelection(event) {
    const el = event.target,
      id = selectionKey(el.dataset.variant || el.dataset.quantity);
    if (!id) return;
    const check = root.querySelector(`[data-variant="${id}"]`),
      quantity = root.querySelector(`[data-quantity="${id}"]`);
    if (check.checked)
      selection.set(id, {
        variantId: Number(String(id).split("|")[0]),
        ...(String(id).includes("|")
          ? { lotId: String(id).split("|")[1] }
          : {}),
        quantity: Number(quantity.value),
      });
    else selection.delete(id);
    invalidate();
    summary();
  }
  root.addEventListener("change", changeSelection);
  root.addEventListener("input", (event) => {
    if (event.target.dataset.quantity) changeSelection(event);
  });
  function requestPrint(document) {
    try {
      if (!document?.ready || !document?.frame?.contentWindow)
        throw Error("El documento de impresión no está disponible.");
      document.frame.contentWindow.focus();
      document.frame.contentWindow.print();
      message(
        `${document.quantity} etiquetas preparadas. Se ha solicitado el diálogo de impresión. Si no aparece, pulsa «Abrir documento para imprimir» y usa Imprimir / Ctrl+P, o descarga el PDF. No se confirma una impresión física.`,
      );
    } catch (error) {
      message(
        "El navegador no pudo abrir la impresión. Usa «Abrir documento para imprimir» y después Imprimir / Ctrl+P, o descarga el PDF preparado.",
        true,
      );
    }
    showFeedback();
  }
  function preparedLinks() {
    const links = root.querySelector("[data-prepared]");
    links.replaceChildren();
    links.hidden = false;
    const addLink = (text, url, download) => {
      const a = document.createElement("a");
      a.className = "btn";
      a.textContent = text;
      a.href = url;
      if (download) a.download = "cronox-etiquetas.pdf";
      else {
        a.target = "_blank";
        a.rel = "noopener";
      }
      links.append(a);
      return a;
    };
    if (prepared.htmlUrl)
      addLink("Abrir documento para imprimir", prepared.htmlUrl);
    if (prepared.pdfUrl) {
      addLink("Abrir PDF preparado", prepared.pdfUrl);
      prepared.downloadLink = addLink(
        "Descargar PDF preparado",
        prepared.pdfUrl,
        true,
      );
    }
    if (prepared.frame) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.dataset.action = "print-ready";
      button.textContent = "Abrir diálogo de impresión";
      button.disabled = !prepared.ready;
      links.append(button);
    }
  }
  async function prepare(action, lines) {
    invalidate();
    try {
      if (action === "pdf") {
        const blob = await api("/pdf", { lines });
        prepared = {
          pdfUrl: URL.createObjectURL(blob),
          quantity: lines.reduce((sum, l) => sum + l.quantity, 0),
        };
        preparedLinks();
        prepared.downloadLink.click();
        message(
          "PDF válido preparado: una página de 62 × 35 mm por etiqueta. Si la descarga no comienza, pulsa «Descargar PDF preparado».",
        );
        showFeedback();
        return;
      }
      const printing = action === "print" || action === "test";
      const [result, blob] = await Promise.all([
        api("/preview", { lines }),
        printing ? api("/pdf", { lines }) : Promise.resolve(null),
      ]);
      if (
        !result.html ||
        result.quantity !== lines.reduce((sum, l) => sum + l.quantity, 0)
      )
        throw Error(
          "La respuesta de etiquetas está incompleta. Vuelve a intentarlo.",
        );
      prepared = {
        quantity: result.quantity,
        htmlUrl: URL.createObjectURL(
          new Blob([result.html], { type: "text/html;charset=utf-8" }),
        ),
        ...(blob ? { pdfUrl: URL.createObjectURL(blob) } : {}),
      };
      const frame = document.createElement("iframe");
      frame.title = "Vista previa de etiquetas de 62 × 35 mm";
      frame.className = "labels-preview";
      frame.setAttribute("sandbox", "allow-same-origin allow-modals");
      prepared.frame = frame;
      preparedLinks();
      // Fallback links stay available even if the browser cannot load the frame.
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              Error(
                "No se pudo cargar la vista de impresión a tiempo. Puedes abrir el documento o descargar el PDF preparado.",
              ),
            ),
          10000,
        );
        frame.onload = async () => {
          try {
            const doc = frame.contentDocument;
            if (doc?.querySelectorAll(".sheet").length !== result.quantity)
              throw Error(
                "La vista de impresión no contiene las etiquetas esperadas. Usa el PDF preparado.",
              );
            await doc.fonts?.ready;
            clearTimeout(timer);
            resolve();
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        };
        frame.onerror = () => {
          clearTimeout(timer);
          reject(
            Error(
              "El navegador no pudo cargar el documento. Usa el PDF preparado.",
            ),
          );
        };
      });
      frame.srcdoc = result.html;
      root.querySelector("[data-preview]").append(frame);
      await ready;
      prepared.ready = true;
      preparedLinks();
      const sticker = root.querySelector("[data-context-sticker]");
      if (sticker && result.firstLabelSvg) {
        sticker.innerHTML = result.firstLabelSvg;
        sticker
          .querySelector("svg")
          ?.setAttribute("style", "width:100%;height:100%;display:block");
      }
      message(
        `${result.quantity} etiquetas preparadas, una página de 62 × 35 mm por etiqueta.`,
      );
      showFeedback();
      if (printing) {
        const document = prepared;
        return () => requestPrint(document);
      }
    } catch (error) {
      if (
        error.code === "LABEL_CODES_MISSING" ||
        (error.status === 409 && error.message.includes("Faltan códigos"))
      )
        pendingAction = { action, lines };
      throw error;
    }
  }
  root.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || busy) return;
    if (button.dataset.product) {
      button
        .closest("details")
        .querySelectorAll("[data-variant]")
        .forEach((check) => {
          check.checked = true;
          check.dispatchEvent(new Event("change", { bubbles: true }));
        });
      return;
    }
    const action = button.dataset.action;
    if (!action) return;
    event.preventDefault();
    if (action === "print-ready") {
      requestPrint(prepared);
      return;
    }
    if (action === "generate-continue") {
      if (!pendingAction) {
        message("Selecciona las tallas y vuelve a pulsar la acción.", true);
        showFeedback();
        return;
      }
      const continuation = pendingAction;
      operate(async () => {
        await api("/generate", { lines: continuation.lines });
        await refresh();
        return prepare(continuation.action, continuation.lines);
      }, button);
      return;
    }
    if (action === "prev" || action === "next") {
      const next = page + (action === "prev" ? -1 : 1);
      if (next < 1 || next > pages) return;
      page = next;
      operate(refresh);
      return;
    }
    if (action === "clear") {
      selection.clear();
      root
        .querySelectorAll("[data-variant]")
        .forEach((c) => (c.checked = false));
      invalidate();
      summary();
      return;
    }
    if (!selection.size) {
      message("Selecciona al menos una talla.", true);
      showFeedback();
      return;
    }
    operate(async () => {
      if ([...selection.values()].some((l) => !validQuantity(l.quantity)))
        throw Error("Revisa las cantidades: deben ser enteros entre 1 y 500.");
      const lines =
        action === "test"
          ? [{ ...selection.values().next().value, quantity: 1 }]
          : [...selection.values()];
      if (lines.some((l) => !validQuantity(l.quantity)))
        throw Error("Revisa las cantidades: deben ser enteros entre 1 y 500.");
      if (action === "generate") {
        await api("/generate", { lines });
        await refresh();
        message("Códigos guardados. Los existentes se han conservado.");
        return;
      }
      return prepare(action, lines);
    }, button);
  });
  summary();
  window.CRONOX_LABELS = Object.freeze({
    load: () => {
      if (!loaded)
        return operate(async () => {
          await refresh();
          loaded = true;
        });
    },
  });
})();
