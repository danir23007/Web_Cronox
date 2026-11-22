(() => {
  "use strict";
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
  const names = {
    brand: "CRONOX",
    name: "Nombre del producto",
    size: "Talla",
    color: "Color",
    barcode: "Código de barras",
    identifier: "Identificador legible",
    custom: "Texto personalizado",
  };
  window.CRONOX_LABEL_TEMPLATE_EDITOR = Object.freeze({
    create(root, { api, onChange, onPreview }) {
      let draft,
        defaults,
        revision = 0,
        savedHash = "",
        busy = false,
        hasSaved = false;
      const clone = (v) => JSON.parse(JSON.stringify(v));
      const status = (text) => {
        const el = root.querySelector("[data-editor-status]");
        if (el) el.textContent = text;
      };
      const stateMessage = () =>
        JSON.stringify(draft) !== savedHash
          ? "Cambios sin guardar. Puedes verlos antes de guardar."
          : hasSaved
            ? "Plantilla guardada."
            : "Diseño predeterminado; todavía no guardado.";
      function changed() {
        status(stateMessage());
        onChange();
      }
      function measurements() {
        const roll = draft.layout.profile === "brother-ql700-dk22223";
        if (roll) {
          draft.layout.width = 50;
          draft.layout.pageWidth = 50;
          draft.layout.pageHeight = draft.layout.height;
          draft.layout.gap = 0;
          draft.layout.orientation = "portrait";
        }
        root.querySelector("[data-orientation]").value =
          draft.layout.orientation;
        root.querySelector("[data-orientation]").disabled = roll;
        root.querySelectorAll("[data-layout]").forEach((el) => {
          el.value = draft.layout[el.dataset.layout];
          el.disabled =
            roll &&
            ["width", "pageWidth", "pageHeight", "gap"].includes(
              el.dataset.layout,
            );
        });
      }
      function draw() {
        root.innerHTML = `<style>.label-editor-elements{display:grid;gap:12px;margin:16px 0}.label-editor-element{border:1px solid #aaa;border-radius:6px;padding:12px;min-width:0}.label-editor-element .labels-layout{margin:8px 0}.label-editor-element textarea{width:100%;min-height:70px}.label-editor-element header{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}</style><h3>Editor de plantilla</h3><p>Plantilla compartida entre dispositivos. El nombre, la talla y el color se rellenan con el producto seleccionado. El nombre puede abreviarse con puntos suspensivos tras dos líneas. CRONOX se imprime completo como texto vectorial.</p><p data-editor-status role="status" aria-live="polite"></p><div class="labels-actions"><button class="btn primary" data-editor-action="save">Guardar plantilla</button><button class="btn" data-editor-action="preview">Ver cambios sin guardar</button><button class="btn" data-editor-action="reload">Cargar plantilla guardada</button><button class="btn" data-editor-action="reset">Restaurar diseño predeterminado</button></div>
      <label>Perfil de impresión<select class="input" data-profile><option value="brother-ql700-dk22223">CRONOX · Brother QL-700 · DK-22223</option><option value="custom">Personalizado / hojas</option></select></label><label>Orientación del contenido<select class="input" data-orientation><option value="portrait">Sin giro</option><option value="rotated">Girado 90°</option></select></label>
      <div class="labels-layout">${Object.entries({
        width: "Ancho físico (mm)",
        height: "Alto / largo de corte (mm)",
        margin: "Margen en extremos / página (mm)",
        padding: "Margen lateral / interior (mm)",
        gap: "Separación entre etiquetas (mm)",
        pageWidth: "Ancho de página (mm)",
        pageHeight: "Alto de página (mm)",
      })
        .map(
          ([key, title]) =>
            `<label>${title}<input class="input" data-layout="${key}" type="number" step="0.1"></label>`,
        )
        .join(
          "",
        )}</div><p>Papel horizontal de 50 × 35 mm: 46,9 mm imprimibles, margen lateral mínimo 1,55 mm y 3 mm en los extremos. Nombre y talla consecutivos comparten una fila. El giro manual −90° se muestra solo sobre el cartón.</p>
      <div class="label-editor-elements">${draft.elements
        .map(
          (el, i) =>
            `<section class="label-editor-element" data-element-index="${i}"><header><label><input type="checkbox" data-field="visible" ${el.visible ? "checked" : ""} ${el.kind === "barcode" ? "disabled" : ""}> ${names[el.kind]}${el.kind === "barcode" ? " · Obligatorio" : ""}</label><div><button class="btn" data-editor-action="up" ${i === 0 ? "disabled" : ""} aria-label="Subir ${names[el.kind]}">Subir</button><button class="btn" data-editor-action="down" ${i === draft.elements.length - 1 ? "disabled" : ""} aria-label="Bajar ${names[el.kind]}">Bajar</button>${el.kind === "custom" ? '<button class="btn" data-editor-action="remove">Eliminar texto</button>' : ""}</div></header>${el.kind === "custom" ? `<label>Texto<textarea class="input" maxlength="160" data-field="text">${esc(el.text)}</textarea></label>` : ""}<div class="labels-layout"><label>Tamaño (pt)<input class="input" data-field="fontSizePt" type="number" min="6" max="18" step="0.5" value="${el.fontSizePt}" ${el.kind === "barcode" ? "disabled" : ""}></label><label>Alineación<select class="input" data-field="align">${[
              ["left", "Izquierda"],
              ["center", "Centro"],
              ["right", "Derecha"],
            ]
              .map(
                ([v, label]) =>
                  `<option value="${v}" ${el.align === v ? "selected" : ""}>${label}</option>`,
              )
              .join(
                "",
              )}</select></label><label>Separación posterior (mm)<input class="input" data-field="gapAfter" type="number" min="0" max="5" step="0.1" value="${el.gapAfter}"></label><label>Máximo de líneas<input class="input" data-field="maxLines" type="number" min="1" max="${el.kind === "name" ? 2 : 3}" step="1" value="${el.maxLines}" ${el.kind === "barcode" ? "disabled" : ""}></label></div></section>`,
        )
        .join(
          "",
        )}</div><button class="btn" data-editor-action="add" ${draft.elements.length >= 16 ? "disabled" : ""}>Añadir texto personalizado</button><p>El código mantiene sus barras, contraste y zonas de silencio. La composición apila los elementos sin superponerlos; un diseño que no cabe se rechazará al guardar o imprimir. Los cambios de esta plantilla no modifican el catálogo.</p>`;
        root.querySelector("[data-profile]").value = draft.layout.profile;
        root.querySelector("[data-orientation]").value =
          draft.layout.orientation;
        measurements();
        status(stateMessage());
      }
      function accept(result) {
        draft = clone(result.template);
        defaults = clone(result.defaults);
        revision = result.revision;
        hasSaved = result.saved === true;
        savedHash = JSON.stringify(draft);
        draw();
        if (result.notice) status(result.notice);
        onChange();
      }
      async function load() {
        accept(await api("/template"));
      }
      async function operate(fn) {
        if (busy) return;
        busy = true;
        const controls = [
            ...root.querySelectorAll("button,input,select,textarea"),
          ],
          old = controls.map((c) => c.disabled);
        controls.forEach((c) => (c.disabled = true));
        status("Procesando plantilla…");
        try {
          await fn();
        } catch (error) {
          status(error.message || "No se pudo guardar la plantilla.");
        } finally {
          busy = false;
          controls.forEach((c, i) => (c.disabled = old[i]));
        }
      }
      root.innerHTML = "<p>Cargando plantilla compartida…</p>";
      root.addEventListener("change", (event) => {
        if (!draft || busy) return;
        const el = event.target;
        if (el.matches("[data-profile]")) {
          draft.layout.profile = el.value;
          if (el.value === "brother-ql700-dk22223")
            draft.layout = { ...defaults.layout };
          else {
            draft.layout.pageWidth = 210;
            draft.layout.pageHeight = 297;
          }
          measurements();
          changed();
          return;
        }
        if (el.matches("[data-orientation]")) {
          draft.layout.orientation = el.value;
          changed();
          return;
        }
        if (el.dataset.layout) {
          draft.layout[el.dataset.layout] = Number(el.value);
          measurements();
          changed();
          return;
        }
        if (el.dataset.field) {
          const element =
              draft.elements[
                Number(el.closest("[data-element-index]").dataset.elementIndex)
              ],
            key = el.dataset.field;
          element[key] =
            el.type === "checkbox"
              ? el.checked
              : ["fontSizePt", "gapAfter", "maxLines"].includes(key)
                ? Number(el.value)
                : el.value;
          changed();
        }
      });
      root.addEventListener("click", (event) => {
        const button = event.target.closest("[data-editor-action]");
        if (!button || busy || !draft) return;
        const action = button.dataset.editorAction;
        if (action === "preview") {
          onPreview();
          return;
        }
        if (action === "save") {
          const template = clone(draft);
          operate(async () => {
            accept(await api("/template", { revision, template }));
            status("Plantilla guardada y disponible desde otros dispositivos.");
          });
          return;
        }
        if (action === "reload") {
          operate(load);
          return;
        }
        if (action === "reset") {
          operate(async () => {
            accept(await api("/template/reset", { revision }));
            status("Diseño predeterminado restaurado y guardado.");
          });
          return;
        }
        if (action === "add") {
          if (draft.elements.length >= 16) return;
          draft.elements.push({
            id: "custom-" + crypto.randomUUID(),
            kind: "custom",
            visible: true,
            text: "Texto personalizado",
            fontSizePt: 7.5,
            align: "center",
            gapAfter: 0.5,
            maxLines: 2,
          });
        } else {
          const index = Number(
            button.closest("[data-element-index]").dataset.elementIndex,
          );
          if (action === "remove" && draft.elements[index].kind === "custom")
            draft.elements.splice(index, 1);
          if (action === "up" && index > 0)
            [draft.elements[index - 1], draft.elements[index]] = [
              draft.elements[index],
              draft.elements[index - 1],
            ];
          if (action === "down" && index < draft.elements.length - 1)
            [draft.elements[index + 1], draft.elements[index]] = [
              draft.elements[index],
              draft.elements[index + 1],
            ];
        }
        draw();
        changed();
      });
      return Object.freeze({
        load,
        definition: () => draft,
        revision: () => revision,
      });
    },
  });
})();
