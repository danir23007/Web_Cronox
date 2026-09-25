(() => {
  "use strict";
  const root = document.getElementById("mailWorkspace");
  const feedback = document.getElementById("mailFeedback");
  const D = window.CRONOX_MAIL_DOCUMENT;
  if (!root || !D) return;
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
  const api = (path, method, body) => window.CRONOX_API.admin.mailRequest(path || "", method || "GET", body);
  const state = {
    key: "", account: null, folders: [], signatures: [], catalog: [],
    folderId: "", current: null, dirty: false, history: [], future: [],
    selected: [], mobile: false, dragging: null, preview: null, page: 1,
    busy: false, signatureEditor: false,
  };
  const pathFor = (suffix) => "/" + encodeURIComponent(state.key) + suffix;
  const button = (action, label, attrs, className) =>
    '<button class="' + (className || "btn") + '" type="button" data-mail-action="' +
    action + '" ' + (attrs || "") + ">" + label + "</button>";
  const message = (text, kind) => {
    feedback.textContent = text;
    feedback.dataset.kind = kind || "";
    const status = root.querySelector("[data-mail-save-status]");
    if (status) status.textContent = text;
  };
  const uploadErrorMessage = (error) => {
    const status = Number(error && error.status);
    const detail = String((error && error.message) || "");
    if (status === 401 || status === 403)
      return "Tu sesión no permite subir imágenes. Vuelve a iniciar sesión.";
    if (status === 413 || /tamaño|5 MB|dimensiones/i.test(detail))
      return detail || "La imagen supera el tamaño permitido.";
    if (/JPEG|PNG|WebP|formato|Imagen no válida/i.test(detail))
      return detail;
    if (status === 503 || /almacenamiento|servicio de imágenes/i.test(detail))
      return detail || "El servicio de imágenes no está disponible.";
    return detail || "No se pudo completar la subida de la imagen.";
  };
  const canLeave = () => !state.dirty || window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?");
  const folderName = () => (state.folders.find((f) => f.id === state.folderId) || {}).name || "Círculo";
  const payload = () => ({
    name: state.current.name,
    folderId: state.current.folderId || state.folderId || (state.folders[0] || {}).id || "",
    subject: state.current.subject || "Firma",
    preheader: state.current.preheader || "",
    purpose: state.current.purpose || undefined,
    document: state.current.document,
    signatureMode: state.current.signatureMode || "none",
    signatureId: state.current.signatureId || undefined,
    revision: state.current.revision || undefined,
  });
  function checkpoint() {
    state.history.push(D.clone(state.current));
    if (state.history.length > 80) state.history.shift();
    state.future = [];
    state.dirty = true;
    message("Cambios sin guardar");
  }
  function navCard(title, detail, status, action, key, icon) {
    const hasIcon = icon != null && icon !== "";
    return '<article class="mail-nav-card ' + (!hasIcon ? "mail-account-card" : "") + '">' +
      (hasIcon ? '<div class="mail-card-icon" aria-hidden="true">' + esc(icon) + "</div>" : "") +
      '<div><h3>' + esc(title) + '</h3><p>' + esc(detail) +
      '</p>' + status + '</div>' + button(action, 'Abrir <span aria-hidden="true">→</span>',
      'data-' + (action === "account" ? "key" : "id") + '="' + esc(key) + '"', "btn mail-primary") + "</article>";
  }
  async function load() {
    if (!canLeave()) return;
    state.current = null; state.dirty = false; state.key = "";
    message("Cargando cuentas…");
    const accounts = await api();
    root.innerHTML = '<header class="mail-view-heading"><div><span class="mail-eyebrow">Comunicaciones</span>' +
      '<h3>Cuentas de envío</h3><p>Elige desde qué dirección trabaja la plantilla.</p></div>' +
      button('deliveries', 'Historial de envíos', '', 'btn mail-secondary') + '</header>' +
      '<div class="mail-accounts">' + accounts.map((a) => navCard(
        a.email || a.name || a.key,
        a.counts.folders + " círculos · " + a.counts.templates + " plantillas",
        '<span class="mail-status ' + (a.configured ? "is-ready" : "") + '"><i></i>' +
          (a.configured ? "SMTP configurado" : "SMTP pendiente") + "</span>",
        "account", a.key,
      )).join("") + "</div>";
    message("Selecciona una cuenta de correo.");
  }
  async function openAccount(key) {
    if (!canLeave()) return;
    state.key = key; state.current = null; state.dirty = false;
    const accounts = await api();
    state.account = accounts.find((a) => a.key === key) || { key: key };
    await api(pathFor("/initialize"), "POST");
    const values = await Promise.all([
      api(pathFor("/folders")), api(pathFor("/signatures")), api("/catalog"),
    ]);
    state.folders = values[0]; state.signatures = values[1]; state.catalog = values[2];
    renderCircles();
  }
  function breadcrumb(action, label, current) {
    return '<div class="mail-breadcrumb">' + button(action, "← " + esc(label), "", "mail-link") +
      "<span>/</span><strong>" + esc(current) + "</strong></div>";
  }
  function renderCircles() {
    state.current = null; state.dirty = false;
    root.innerHTML = breadcrumb("accounts", "Cuentas", state.account.email || state.key) +
      '<header class="mail-view-heading"><div><span class="mail-eyebrow">' +
      esc(state.account.email || state.key) + '</span><h3>Elige un círculo</h3>' +
      '<p>Cada círculo conserva sus propias plantillas y borradores.</p></div>' +
      button("signatures", "Firmas", "", "btn mail-secondary") + '</header><div class="mail-circles">' +
      state.folders.map((f, index) => navCard(
        f.name, f._count.templates + (f._count.templates === 1 ? " plantilla" : " plantillas"),
        "", "circle", f.id, String(index + 1).padStart(2, "0"),
      )).join("") + "</div>";
    message("Selecciona un círculo.");
  }
  async function openCircle(id) {
    state.folderId = id; state.page = 1;
    await renderTemplates();
  }
  async function renderTemplates() {
    state.current = null; state.dirty = false;
    const params = new URLSearchParams({
      folderId: state.folderId, page: state.page, limit: 30,
      sort: "updatedAt", archived: "false",
    });
    const data = await api(pathFor("/templates?" + params.toString()));
    root.innerHTML = breadcrumb("circles", "Círculos", folderName()) +
      '<header class="mail-view-heading"><div><span class="mail-eyebrow">' +
      esc(state.account.email || state.key) + "</span><h3>" + esc(folderName()) +
      "</h3><p>" + data.total + ' plantillas en este círculo</p></div>' +
      button("new", "+ Nueva plantilla", "", "btn mail-primary") + '</header><div class="mail-template-grid">' +
      (data.items.map((t) => '<article class="mail-template-card"><div class="mail-template-top">' +
        '<span class="mail-template-state ' + (t.published ? "is-published" : "") + '">' +
        (t.published ? "Publicada" : "Borrador") + "</span><time>" +
        new Date(t.updatedAt).toLocaleDateString("es-ES") + "</time></div><h3>" +
        esc(t.name) + "</h3><p>" + esc(t.subject) + "</p>" +
        button("edit", "Editar plantilla", 'data-id="' + esc(t.id) + '"', "btn mail-secondary") +
        "</article>").join("") || '<div class="mail-empty"><h3>Este círculo está vacío</h3><p>Crea una plantilla para empezar.</p></div>') +
      '</div><div class="mail-pagination">' +
      button("previous", "← Anterior", state.page <= 1 ? "disabled" : "", "mail-link") +
      "<span>Página " + state.page + "</span>" +
      button("next", "Siguiente →", state.page * 30 >= data.total ? "disabled" : "", "mail-link") +
      "</div>";
    message(folderName() + " · " + data.total + " plantillas");
  }
  function bounded(value, fallback, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : fallback;
  }
  function blockStyle(block) {
    const padding = bounded(block.padding, 16, 80);
    const background = /^#[\da-f]{3,8}$/i.test(block.background || "") ? block.background : "#ffffff";
    const foreground = /^#[\da-f]{3,8}$/i.test(block.color || "") ? block.color : "#202124";
    const backgroundImage = block.backgroundImage && /^https:\/\//i.test(block.backgroundImage)
      ? "background-image:url('" + esc(block.backgroundImage) + "');background-size:" +
        (block.backgroundSize || "cover") + ";background-position:" +
        (block.backgroundPosition || "center center") + ";"
      : "";
    return "padding:" + padding + "px;text-align:" +
      (["left", "center", "right"].includes(block.align) ? block.align : "left") +
      ";color:" + foreground + ";background-color:" + background + ";font-size:" +
      bounded(block.size, block.type === "heading" ? 28 : 16, 60) + "px;font-weight:" +
      ([400, 600, 700, 800].includes(Number(block.weight)) ? block.weight : 400) +
      ";line-height:" + bounded(block.lineHeight, 1.5, 3) + ";" +
      (bounded(block.borderWidth, 0, 8) ? "border:" + bounded(block.borderWidth, 0, 8) +
        "px solid " + (/^#[\da-f]{3,8}$/i.test(block.borderColor || "")
          ? block.borderColor : "#dddddd") + ";border-radius:" +
        bounded(block.borderRadius, 0, 30) + "px;" : "") + backgroundImage;
  }
  const tokenized = (text) => esc(text || "").replace(
    /\{\{([A-Za-z][\w.]*)\}\}/g,
    '<span class="mail-variable-chip" contenteditable="false">{{$1}}</span>',
  );
  function buttonPreviewStyle(block) {
    const background = /^#[\da-f]{3,8}$/i.test(block.buttonBackground || "")
      ? block.buttonBackground : "#ffffff";
    const color = /^#[\da-f]{3,8}$/i.test(block.buttonColor || "")
      ? block.buttonColor : "#111111";
    return "padding:" + bounded(block.padding, 12, 40) + "px " +
      bounded(block.padding, 18, 60) + "px;border-radius:" +
      bounded(block.borderRadius, 2, 30) + "px;background:" + background +
      ";color:" + color + ";font-size:" + bounded(block.size, 14, 40) +
      "px;font-weight:" + ([400, 600, 700, 800].includes(Number(block.weight))
        ? block.weight : 700) + ";line-height:" + bounded(block.lineHeight, 1.2, 3) + ";";
  }
  function renderBlocks(blocks, prefix) {
    prefix = prefix || [];
    return blocks.map((block, index) => {
      const path = prefix.concat(index);
      const encoded = path.join("/");
      let content = "";
      if (["heading", "text"].includes(block.type)) {
        content = '<div class="mail-direct-text" contenteditable="true" role="textbox" data-edit-text="' +
          encoded + '" data-placeholder="Haz clic para escribir">' + tokenized(block.text) + "</div>";
      } else if (block.type === "rich") {
        content = '<div class="mail-direct-text" contenteditable="true" role="textbox" data-edit-rich="' + encoded + '"></div>';
      } else if (["image", "logo", "video"].includes(block.type)) {
        content = block.src
          ? '<div class="mail-image-frame"><img src="' + esc(block.src) + '" alt="' +
            esc(block.alt) + '" style="width:' + Math.min(640, Number(block.width) || 560) +
            'px;max-width:100%"><span class="mail-resize-handle" data-resize="' +
            encoded + '" title="Arrastra para cambiar el tamaño"></span></div>'
          : '<button type="button" class="mail-image-empty" data-mail-action="assets" data-path="' +
            encoded + '">Subir o elegir una imagen</button>';
      } else if (["button", "social"].includes(block.type)) {
        content = '<span class="mail-button-preview mail-direct-text" contenteditable="true" ' +
          'role="textbox" data-edit-text="' + encoded + '" style="' + buttonPreviewStyle(block) + '">' +
          tokenized(block.text || "Ver más") + "</span>";
      } else if (block.type === "divider") content = "<hr>";
      else if (block.type === "spacer") content = '<div style="height:' + Math.min(100, Number(block.size) || 32) + 'px"></div>';
      else if (block.type === "orderItems") {
        content = '<div class="mail-dynamic-card"><div class="mail-product-thumb"></div>' +
          '<div><strong>Camiseta CRONOX × 2</strong><span>M</span></div><strong>69,90 €</strong></div>';
      } else if (block.type === "orderTotals") {
        const labels = Object.assign({
          subtotal: "Total parcial", discount: "Descuento", shipping: "Envío",
          taxes: "Impuestos", total: "Total", savings: "Ahorraste",
        }, block.labels || {});
        content = '<div class="mail-dynamic-totals">' +
          [[labels.subtotal, "69,90 €"], [labels.discount, "5,00 €"],
            [labels.shipping, "4,90 €"], [labels.taxes, "12,13 €"],
            [labels.total, "69,80 €"], [labels.savings, "5,00 €"]]
            .map((row, index) => "<div><span data-preview-label=\"" +
              ["subtotal", "discount", "shipping", "taxes", "total", "savings"][index] +
              "\">" + esc(row[0]) + "</span><strong>" + row[1] + "</strong></div>").join("") +
          "</div>";
      } else if (block.type === "customerDetails") {
        const labels = Object.assign({
          contact: "Contacto", shippingAddress: "Dirección de envío",
          shippingMethod: "Método de envío",
        }, block.labels || {});
        content = '<div class="mail-dynamic-details"><div><strong data-preview-label="contact">' + esc(labels.contact) +
          "</strong><span>Alex García</span><span>alex@example.com</span></div><div><strong data-preview-label=\"shippingAddress\">" +
          esc(labels.shippingAddress) + "</strong><span>Calle Ejemplo 12</span><span>28001, Madrid</span></div>" +
          '<div><strong data-preview-label="shippingMethod">' + esc(labels.shippingMethod) + "</strong><span>Envío estándar</span></div></div>";
      } else if (block.type === "trackingDetails") {
        const labels = Object.assign({
          carrier: "Transportista", tracking: "Número de seguimiento", status: "Estado actual",
        }, block.labels || {});
        content = '<div class="mail-dynamic-totals">' +
          [[labels.carrier, "Transportista de ejemplo"], [labels.tracking, "PRUEBA123"], [labels.status, "En camino"]]
            .map((row, index) => "<div><span data-preview-label=\"" +
              ["carrier", "tracking", "status"][index] + "\">" + esc(row[0]) +
              "</span><strong>" + row[1] + "</strong></div>").join("") +
          "</div>";
      } else if (block.type === "statusDetails") {
        content = '<div class="mail-dynamic-status"><span data-preview-label="status">' +
          esc((block.labels || {}).status || "Estado actual") + "</span>: <strong>Entregado</strong></div>";
      }
      else if (["columns", "section"].includes(block.type)) {
        content = '<div class="mail-canvas-columns" style="--mail-columns:' +
          ((block.columns || []).length || 1) + '">' +
          (block.columns || [[]]).map((column, columnIndex) => {
            const columnPath = path.concat(columnIndex);
            return '<div class="mail-canvas-column" data-drop-list="' + columnPath.join("/") + '">' +
              renderBlocks(column, columnPath) + '<span class="mail-column-drop">Suelta contenido aquí</span></div>';
          }).join("") + "</div>";
      } else if (block.type === "html") {
        content = '<div class="mail-html-placeholder"><strong>HTML personalizado</strong>' +
          "<span>Consulta su resultado aislado en Vista previa.</span></div>";
      } else content = "<span>" + esc(D.labels[block.type] || block.type) + "</span>";
      return '<div class="mail-canvas-block ' + (state.selected.join("/") === encoded ? "is-selected" : "") +
        '" data-block="' + encoded + '" style="' + blockStyle(block) + '">' +
        button("select", "⋮⋮", 'draggable="true" data-path="' + encoded + '" aria-label="Seleccionar y mover ' +
          esc(D.labels[block.type] || block.type) + '"', "mail-drag-handle") +
        content + '<span class="mail-block-label">' + esc(D.labels[block.type] || block.type) + "</span></div>";
    }).join("");
  }
  function blockChoices() {
    return ["text", "heading", "image", "button", "divider", "spacer", "columns", "section"].map((type) =>
      button("add", "<span>" + (type === "image" ? "▧" : type === "heading" ? "H" : type === "text" ? "T" : "+") +
        "</span>" + esc(D.labels[type]), 'draggable="true" data-type="' + type + '"', "mail-block-choice"),
    ).join("");
  }
  function editor() {
    const current = state.current;
    const purposeOptions = state.catalog.filter((item) => item.senderKey === state.key).map((item) =>
      '<option value="' + esc(item.key) + '" ' + (item.key === current.purpose ? "selected" : "") +
      ">" + esc(item.name) + "</option>",
    ).join("");
    const signatureOptions = state.signatures.filter((item) => !item.archivedAt).map((item) =>
      '<option value="' + esc(item.id) + '">' + esc(item.name) + "</option>",
    ).join("");
    const folderOptions = state.folders.map((item) =>
      '<option value="' + esc(item.id) + '" ' +
      (item.id === current.folderId ? "selected" : "") + ">" +
      esc(item.name) + "</option>",
    ).join("");
    root.innerHTML = '<div class="mail-editor-shell"><header class="mail-editor-header">' +
      '<div class="mail-editor-nav">' + button("templates", "← " + esc(folderName()), "", "mail-link") +
      "<div><strong>" + esc(current.name) + '</strong><span data-mail-save-status>' +
      (state.dirty ? "Cambios sin guardar" : "Borrador guardado") + "</span></div></div>" +
      '<div class="mail-editor-actions">' +
      button("undo", "↶", state.history.length ? 'title="Deshacer"' : "disabled", "mail-icon-btn") +
      button("redo", "↷", state.future.length ? 'title="Rehacer"' : "disabled", "mail-icon-btn") +
      button("save", state.signatureEditor ? "Guardar firma" : "Guardar borrador", "", "btn mail-secondary") +
      (!state.signatureEditor ? button("publish", "Publicar", "", "btn mail-primary") : "") +
      '</div></header><section class="mail-compose-fields"><label><span>De</span><input value="' +
      esc(state.account.email || state.key) + '" readonly></label>' +
      (!state.signatureEditor
        ? '<label><span>Asunto</span><input data-field="subject" value="' + esc(current.subject) +
          '" maxlength="200" placeholder="Asunto del correo"></label><label><span>Preheader</span>' +
          '<input data-field="preheader" value="' + esc(current.preheader || "") +
          '" maxlength="300" placeholder="Texto que se ve junto al asunto"></label>'
        : "") + '</section><div class="mail-builder"><aside class="mail-add-panel"><h4>Añadir</h4>' +
      "<p>Arrastra un bloque al correo</p>" + blockChoices() +
      button("assets", "Biblioteca de imágenes", "", "mail-library-button") +
      '</aside><main class="mail-workbench"><div class="mail-preview-bar"><div class="mail-device-switch">' +
      button("desktop", "Escritorio", 'aria-pressed="' + (!state.mobile) + '"', "mail-device") +
      button("mobile", "Móvil", 'aria-pressed="' + state.mobile + '"', "mail-device") +
      '</div><span>El contenido se adapta automáticamente</span></div><div class="mail-stage-wrap ' +
      (state.mobile ? "is-mobile" : "") + '"><div class="mail-stage" data-drop-list="">' +
      (renderBlocks(current.document.blocks) ||
        '<div class="mail-empty-canvas"><strong>Empieza a diseñar</strong><span>Arrastra un bloque aquí o selecciónalo en “Añadir”.</span></div>') +
      '</div></div></main><aside class="mail-inspector" id="mailInspector"></aside></div>' +
      '<details class="mail-advanced"><summary>Opciones avanzadas</summary><div class="mail-advanced-grid">' +
      '<label>Nombre interno<input data-field="name" value="' + esc(current.name) + '" maxlength="120"></label>' +
      (!state.signatureEditor
        ? '<label>Uso automático<select data-field="purpose"><option value="">Sin automatización</option>' +
          purposeOptions + '</select></label><label>Firma<select id="mailSignature">' +
          '<option value="none">Sin firma</option><option value="default">Predeterminada</option>' +
          signatureOptions + '</select></label><label>Círculo<select data-field="folderId">' +
          folderOptions + "</select></label>" +
          button("compiled-preview", "Vista previa del HTML final", "", "btn mail-secondary") +
          button("plain-text", "Ver texto plano", "", "btn mail-secondary") +
          button("export", "Exportar HTML", "", "btn mail-secondary") +
          button("test", "Enviar prueba", state.account.configured ? "" : 'disabled title="SMTP no configurado"', "btn mail-secondary") +
          (current.id
            ? button("duplicate-template", "Duplicar plantilla", "", "btn mail-secondary") +
              button(current.archivedAt ? "restore-template" : "archive-template",
                current.archivedAt ? "Restaurar plantilla" : "Archivar plantilla", "", "btn mail-secondary") +
              button("versions", "Versiones publicadas", "", "btn mail-secondary")
            : "")
        : "") +
      '</div><div id="mailAdvancedOutput"></div></details></div>';
    if (!state.signatureEditor) {
      const signature = root.querySelector("#mailSignature");
      signature.value = current.signatureMode === "selected"
        ? current.signatureId : current.signatureMode || "none";
    }
    hydrateRich();
    renderInspector();
  }
  function hydrateRich() {
    root.querySelectorAll("[data-edit-rich]").forEach((element) => {
      const path = element.dataset.editRich.split("/").map(Number);
      const block = D.blockAt(state.current.document, path);
      element.replaceChildren(...D.safeRichNodes(block ? block.html : ""));
    });
  }
  function inspectorField(key, label, type, value) {
    type = type || "number";
    return "<label>" + label + '<input data-prop="' + key + '" type="' + type +
      '" value="' + esc(value == null ? "" : value) + '" ' +
      (type === "number" ? 'min="0" max="640" step="0.1"' : "") + "></label>";
  }
  function renderInspector() {
    const panel = root.querySelector("#mailInspector");
    if (!panel) return;
    const block = D.blockAt(state.current.document, state.selected);
    if (!block) {
      panel.innerHTML = '<div class="mail-inspector-empty"><span>◫</span><h4>Selecciona un elemento</h4>' +
        "<p>Sus opciones de diseño aparecerán aquí.</p></div>";
      return;
    }
    const variables = (state.catalog.find((item) => item.key === state.current.purpose) || {}).variables || [];
    const image = ["image", "logo", "video"].includes(block.type);
    const container = ["section", "columns"].includes(block.type);
    const dynamicBlock = ["orderItems", "orderTotals", "customerDetails", "trackingDetails", "statusDetails"].includes(block.type);
    const labelNames = {
      empty: "Texto sin artículos", subtotal: "Total parcial", discount: "Descuento",
      shipping: "Envío", taxes: "Impuestos", total: "Total", savings: "Ahorro",
      contact: "Contacto", shippingAddress: "Dirección de envío",
      shippingMethod: "Método de envío", carrier: "Transportista",
      tracking: "Seguimiento", status: "Estado",
    };
    const dynamicLabels = dynamicBlock
      ? Object.entries(block.labels || {}).map(([key, value]) =>
          '<label>' + esc(labelNames[key] || key) + '<input data-label="' +
          esc(key) + '" value="' + esc(value) + '"></label>').join("")
      : "";
    panel.innerHTML = '<div class="mail-inspector-title"><div><span>Editar</span><h4>' +
      esc(D.labels[block.type]) + "</h4></div>" +
      button("clear-selection", "×", 'aria-label="Cerrar propiedades"', "mail-icon-btn") +
      "</div>" +
      (["rich", "text", "heading"].includes(block.type)
        ? '<div class="mail-format-row">' +
          button("format-bold", "B", "", "mail-format-btn") +
          button("format-italic", "I", "", "mail-format-btn") +
          button("format-underline", "U", "", "mail-format-btn") +
          button("format-link", "↗", 'title="Añadir enlace"', "mail-format-btn") + "</div>"
        : "") +
      '<div class="mail-inspector-fields"><label>Alineación<select data-prop="align">' +
      '<option value="left">Izquierda</option><option value="center">Centro</option>' +
      '<option value="right">Derecha</option></select></label>' +
      (!container ? inspectorField("color", "Color de texto", "color", block.color || "#202124") : "") +
      inspectorField("background", "Color de fondo", "color", block.background || "#ffffff") +
      (!image && !container
        ? inspectorField("size", block.type === "spacer" ? "Altura" : "Tamaño", "number", block.size == null ? 16 : block.size) +
          '<label>Peso<select data-prop="weight"><option value="400">Normal</option>' +
          '<option value="600">Seminegrita</option><option value="700">Negrita</option>' +
          '<option value="800">Extra negrita</option></select></label>' +
          inspectorField("lineHeight", "Interlineado", "number", block.lineHeight == null ? 1.5 : block.lineHeight)
        : "") +
      inspectorField("padding", "Espaciado", "number", block.padding == null ? 16 : block.padding) +
      (["button", "social"].includes(block.type)
        ? inspectorField("url", "Enlace", "url", block.url || "") +
          inspectorField("buttonBackground", "Fondo del botón", "color", block.buttonBackground || "#ffffff") +
          inspectorField("buttonColor", "Texto del botón", "color", block.buttonColor || "#111111") +
          inspectorField("borderRadius", "Radio del botón", "number", block.borderRadius == null ? 2 : block.borderRadius)
        : "") +
      (image
        ? inspectorField("width", "Ancho", "range", block.width || 560) +
          inspectorField("alt", "Texto alternativo", "text", block.alt || "") +
          inspectorField("url", "Enlace opcional", "url", block.url || "") +
          button("assets", "Reemplazar imagen", "", "btn mail-secondary")
        : "") +
      (container
        ? inspectorField("backgroundImage", "Imagen de fondo", "url", block.backgroundImage || "") +
          '<label>Ajuste<select data-prop="backgroundSize"><option value="cover">Cubrir</option>' +
          '<option value="contain">Contener</option><option value="auto">Tamaño original</option></select></label>' +
          '<label>Posición<select data-prop="backgroundPosition"><option value="center center">Centro</option>' +
          '<option value="center top">Arriba</option><option value="center bottom">Abajo</option>' +
          '<option value="left center">Izquierda</option><option value="right center">Derecha</option></select></label>' +
          button("section-background", "Elegir fondo de biblioteca", "", "btn mail-secondary")
        : "") +
      dynamicLabels +
      (dynamicBlock
        ? inspectorField("borderWidth", "Grosor del borde", "number", block.borderWidth || 0) +
          inspectorField("borderColor", "Color del borde", "color", block.borderColor || "#dddddd") +
          inspectorField("borderRadius", "Radio del bloque", "number", block.borderRadius || 0)
        : "") +
      '<label>Insertar variable<select id="mailVariable"><option value="">Selecciona un dato</option>' +
      variables.map((variable) => '<option value="' + esc(variable.key) + '">' +
        esc(variable.description) + "</option>").join("") + "</select></label>" +
      button("variable", "Insertar variable", "", "btn mail-secondary") +
      '</div><div class="mail-inspector-actions">' +
      button("block-copy", "Duplicar", 'data-path="' + state.selected.join("/") + '"', "mail-link") +
      button("block-delete", "Eliminar", 'data-path="' + state.selected.join("/") + '"', "mail-link mail-danger") +
      "</div>";
    ["align", "weight", "backgroundSize", "backgroundPosition"].forEach((key) => {
      const field = panel.querySelector('[data-prop="' + key + '"]');
      if (field && block[key] != null) field.value = String(block[key]);
    });
  }
  function openDraftTargets(targets) {
    root.insertAdjacentHTML("beforeend",
      '<div class="mail-modal mail-save-modal" role="dialog" aria-modal="true" aria-labelledby="mailSaveTitle">' +
      '<div class="mail-modal-card mail-save-modal-card"><div class="mail-modal-head"><div>' +
      '<h3 id="mailSaveTitle">¿Dónde quieres guardar estos cambios?</h3>' +
      '<p>Esta plantilla también existe en otros círculos.</p></div>' +
      button("close-modal", "×", 'aria-label="Cancelar"', "mail-icon-btn") +
      '</div><div class="mail-save-targets">' + targets.map((target) =>
        '<label><input type="checkbox" data-draft-target="' + esc(target.id) +
        '" data-revision="' + esc(target.revision) + '" data-folder-name="' +
        esc(target.folderName) + '" ' + (target.current ? "checked disabled" : "") +
        '><span><strong>' + esc(target.folderName) + "</strong></span></label>",
      ).join("") + '</div><div class="mail-save-actions">' +
      button("close-modal", "Cancelar", "", "btn mail-secondary") +
      button("save-selected", "Guardar en seleccionados", "", "btn mail-primary") +
      "</div></div></div>");
  }
  function joinedCircleNames(names) {
    if (names.length < 2) return names[0] || "";
    return names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
  }
  async function save(targets) {
    let result;
    if (state.signatureEditor) {
      result = await api(pathFor("/signatures" + (state.current.id ? "/" + state.current.id : "")),
        state.current.id ? "PATCH" : "POST",
        { name: state.current.name, document: state.current.document, revision: state.current.revision });
    } else {
      if (state.current.id && !targets) {
        const available = await api(pathFor("/templates/" + state.current.id + "/draft-targets"));
        if (available.purpose === state.current.purpose &&
          state.current.folderId === state.folderId && available.targets.length > 1) {
          openDraftTargets(available.targets);
          return;
        }
      }
      if (state.current.id && targets && targets.length > 1) {
        const saved = await api(pathFor("/templates/" + state.current.id + "/drafts"),
          "PATCH", Object.assign(payload(), { targets: targets.map((target) => ({
            id: target.id, revision: target.revision,
          })) }));
        result = saved.template;
      } else {
        result = await api(pathFor("/templates" + (state.current.id ? "/" + state.current.id : "")),
          state.current.id ? "PATCH" : "POST", payload());
      }
    }
    state.current = result; state.dirty = false; state.history = []; state.future = [];
    const modal = root.querySelector(".mail-save-modal");
    if (modal) modal.remove();
    editor();
    message(targets && targets.length > 1
      ? "Borrador guardado en " + joinedCircleNames(targets.map((target) => target.folderName)) + "."
      : "Borrador guardado.", "success");
  }
  async function compiledPreview(showText) {
    const result = state.signatureEditor
      ? await api(pathFor("/signatures/preview"), "POST",
        { name: state.current.name, document: state.current.document })
      : await api(pathFor("/preview"), "POST", payload());
    state.preview = result;
    const output = root.querySelector("#mailAdvancedOutput");
    if (showText) output.innerHTML = '<pre class="mail-source">' + esc(result.text) + "</pre>";
    else {
      const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">';
      output.innerHTML = '<iframe id="mailPreview" class="mail-preview ' +
        (state.mobile ? "is-mobile" : "") +
        '" sandbox="" referrerpolicy="no-referrer" title="Vista previa aislada del correo"></iframe>';
      output.querySelector("iframe").srcdoc = result.html.replace("<head>", "<head>" + csp);
    }
    message("Vista previa generada con datos ficticios.");
    return result;
  }
  async function openAssets(background) {
    const result = await api(pathFor("/assets?page=1&limit=100"));
    const selected = D.blockAt(state.current.document, state.selected);
    root.insertAdjacentHTML("beforeend",
      '<div class="mail-modal" role="dialog" aria-modal="true" aria-labelledby="mailAssetTitle">' +
      '<div class="mail-modal-card"><div class="mail-modal-head"><div><span class="mail-eyebrow">Biblioteca</span>' +
      '<h3 id="mailAssetTitle">Imágenes de ' + esc(state.account.email || state.key) + "</h3></div>" +
      button("close-modal", "×", 'aria-label="Cerrar"', "mail-icon-btn") +
      '</div><label class="mail-upload-zone" for="mailUpload"><strong>Arrastra una imagen aquí o pulsa para subirla</strong>' +
      '<span>JPEG, PNG o WebP · máximo 5 MB</span><input id="mailUpload" type="file" ' +
      'accept="image/jpeg,image/png,image/webp" data-background="' + Boolean(background) + '"></label>' +
      '<div class="mail-assets">' + (result.items.map((asset) =>
        '<button type="button" data-mail-action="asset-use" data-url="' + esc(asset.url) +
        '" data-alt="' + esc(asset.alt) + '" data-background="' + Boolean(background) +
        '"><img src="' + esc(asset.url) + '" alt="' + esc(asset.alt) +
        '"><span>' + esc(asset.name) + "</span></button>",
      ).join("") || "<p>Aún no hay imágenes en esta cuenta.</p>") + "</div>" +
      (selected && !background && ["image", "logo", "video"].includes(selected.type)
        ? button("image-remove", "Quitar imagen del bloque", "", "mail-link mail-danger") : "") +
      "</div></div>");
  }
  async function uploadImage(file, background, insertion) {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error("Usa una imagen JPEG, PNG o WebP de hasta 5 MB.");
    }
    const form = new FormData();
    form.append("file", file);
    form.append("alt", file.name.replace(/\.[^.]+$/, ""));
    message("Subiendo imagen…");
    const asset = await api(pathFor("/assets"), "POST", form);
    checkpoint();
    const selected = D.blockAt(state.current.document, state.selected);
    if (background && selected) selected.backgroundImage = asset.url;
    else if (selected && ["image", "logo", "video"].includes(selected.type)) {
      selected.src = asset.url; selected.alt = asset.alt;
    } else {
      const path = insertion || [];
      const list = D.listAt(state.current.document, path);
      const block = Object.assign(D.createBlock("image"), { src: asset.url, alt: asset.alt });
      list.push(block);
      state.selected = path.concat(list.length - 1);
    }
    const modal = root.querySelector(".mail-modal");
    if (modal) modal.remove();
    editor();
    message("Imagen guardada e insertada.", "success");
  }
  function selectPath(path) {
    state.selected = path;
    renderInspector();
    root.querySelectorAll(".mail-canvas-block").forEach((block) => {
      block.classList.toggle("is-selected", block.dataset.block === path.join("/"));
    });
  }
  async function signatureList() {
    state.signatures = await api(pathFor("/signatures"));
    root.innerHTML = breadcrumb("circles", "Círculos", "Firmas") +
      '<header class="mail-view-heading"><div><span class="mail-eyebrow">' +
      esc(state.account.email || state.key) +
      '</span><h3>Firmas de cuenta</h3></div>' +
      button("signature-new", "+ Nueva firma", "", "btn mail-primary") +
      '</header><div class="mail-template-grid">' +
      state.signatures.map((signature) =>
        '<article class="mail-template-card"><h3>' + esc(signature.name) + "</h3><p>" +
        (signature.archivedAt ? "Archivada" : "Disponible") + "</p>" +
        button("signature-edit", "Editar firma", 'data-id="' + esc(signature.id) + '"', "btn mail-secondary") +
        "</article>",
      ).join("") + "</div>";
  }
  async function handleAction(name, element) {
    const path = (element.dataset.path || "").split("/").filter(Boolean).map(Number);
    if (name === "accounts") return load();
    if (name === 'deliveries' || name === 'delivery-next' || name === 'delivery-previous') {
      if (!canLeave()) return;
      state.deliveryPage = name === 'deliveries' ? 1 : Math.max(1, (state.deliveryPage || 1) + (name === 'delivery-next' ? 1 : -1));
      const result = await api('/deliveries?page=' + state.deliveryPage + '&limit=30');
      const labels = { PENDING: 'Pendiente de resultado', SMTP_ACCEPTED: 'Aceptado por SMTP', FAILED: 'Fallido', UNKNOWN: 'Resultado incierto' };
      root.innerHTML = breadcrumb('accounts', 'Cuentas', 'Historial de envíos') +
        '<p>Registro desde la activación de esta función. SMTP aceptado no acredita recepción ni lectura. No se guardan enlaces privados ni códigos.</p>' +
        '<div class="mail-template-grid">' + result.items.map(item =>
          '<article class="mail-template-card"><h3>' + esc(item.subject) + '</h3><p>' + esc(item.recipient) + '</p><p>' +
          esc(item.senderKey) + ' · ' + esc(item.purpose || 'Correo') + '</p><p>' + esc(labels[item.status] || item.status) + '</p><p>' +
          esc(new Date(item.createdAt).toLocaleString('es-ES')) + '</p></article>').join('') + '</div>' +
        '<p>' + esc(result.total) + ' envíos · Página ' + state.deliveryPage + '</p>' +
        button('delivery-previous', 'Anterior', state.deliveryPage <= 1 ? 'disabled' : '') +
        button('delivery-next', 'Siguiente', state.deliveryPage * 30 >= result.total ? 'disabled' : '');
      state.current = null; state.dirty = false;
      return;
    }
    if (name === "account") return openAccount(element.dataset.key);
    if (name === "circles") { if (canLeave()) renderCircles(); return; }
    if (name === "circle") return openCircle(element.dataset.id);
    if (name === "templates") { if (canLeave()) return renderTemplates(); return; }
    if (name === "previous" || name === "next") {
      state.page += name === "next" ? 1 : -1;
      return renderTemplates();
    }
    if (name === "new") {
      state.signatureEditor = false;
      state.current = {
        name: "Nueva plantilla", subject: "", preheader: "", folderId: state.folderId,
        document: { blocks: [] }, signatureMode: "none",
      };
      state.dirty = true; state.history = []; state.future = []; state.selected = [];
      return editor();
    }
    if (name === "edit") {
      state.signatureEditor = false;
      state.current = await api(pathFor("/templates/" + element.dataset.id));
      state.dirty = false; state.history = []; state.future = []; state.selected = [];
      return editor();
    }
    if (name === "select") return selectPath(path);
    if (name === "clear-selection") return selectPath([]);
    if (name === "desktop" || name === "mobile") {
      state.mobile = name === "mobile";
      return editor();
    }
    if (name === "add") {
      checkpoint();
      const list = D.listAt(state.current.document, []);
      list.push(D.createBlock(element.dataset.type));
      state.selected = [list.length - 1];
      return editor();
    }
    if (name === "block-delete" || name === "block-copy") {
      const target = path.length ? path : state.selected;
      const list = D.listAt(state.current.document, target.slice(0, -1));
      const index = target[target.length - 1];
      checkpoint();
      if (name === "block-delete") list.splice(index, 1);
      else list.splice(index + 1, 0, D.clone(list[index]));
      state.selected = [];
      return editor();
    }
    if (name === "undo" || name === "redo") {
      const from = name === "undo" ? state.history : state.future;
      const to = name === "undo" ? state.future : state.history;
      if (!from.length) return;
      to.push(D.clone(state.current));
      state.current = from.pop(); state.dirty = true; state.selected = [];
      return editor();
    }
    if (name === "save") return save();
    if (name === "save-selected") {
      const modal = element.closest(".mail-save-modal");
      const targets = Array.from(modal.querySelectorAll("[data-draft-target]:checked")).map((input) => ({
        id: input.dataset.draftTarget,
        revision: Number(input.dataset.revision),
        folderName: input.dataset.folderName,
      }));
      return save(targets);
    }
    if (name === "compiled-preview") return compiledPreview(false);
    if (name === "plain-text") return compiledPreview(true);
    if (name === "export") {
      const result = await compiledPreview(false);
      const url = URL.createObjectURL(new Blob([result.html], { type: "text/html" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "cronox-email.html"; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (name === "assets") {
      if (path.length) state.selected = path;
      return openAssets(false);
    }
    if (name === "section-background") return openAssets(true);
    if (name === "close-modal") return element.closest(".mail-modal").remove();
    if (name === "asset-use") {
      checkpoint();
      const block = D.blockAt(state.current.document, state.selected);
      if (element.dataset.background === "true" && block) block.backgroundImage = element.dataset.url;
      else if (block && ["image", "logo", "video"].includes(block.type)) {
        block.src = element.dataset.url; block.alt = element.dataset.alt;
      } else {
        state.current.document.blocks.push(Object.assign(D.createBlock("image"), {
          src: element.dataset.url, alt: element.dataset.alt,
        }));
      }
      element.closest(".mail-modal").remove();
      return editor();
    }
    if (name === "image-remove") {
      const block = D.blockAt(state.current.document, state.selected);
      checkpoint(); block.src = "";
      element.closest(".mail-modal").remove();
      return editor();
    }
    if (name === "variable") {
      const select = root.querySelector("#mailVariable");
      const block = D.blockAt(state.current.document, state.selected);
      if (!select || !select.value || !block) return;
      checkpoint();
      if (block.type === "rich") block.html = (block.html || "") + "{{" + select.value + "}}";
      else if (typeof block.text === "string") block.text += "{{" + select.value + "}}";
      return editor();
    }
    if (["format-bold", "format-italic", "format-underline", "format-link"].includes(name)) {
      const selector = '[data-edit-rich="' + state.selected.join("/") + '"],[data-edit-text="' +
        state.selected.join("/") + '"]';
      const editable = root.querySelector(selector);
      if (!editable) return message("Selecciona texto dentro del correo.");
      editable.focus();
      const command = {
        "format-bold": "bold", "format-italic": "italic",
        "format-underline": "underline", "format-link": "createLink",
      }[name];
      const value = command === "createLink" ? window.prompt("Enlace HTTPS, correo o teléfono") : null;
      if (command === "createLink" && (!value || !/^(https?:\/\/|mailto:|tel:)/i.test(value))) return;
      const selectedBlock = D.blockAt(state.current.document, state.selected);
      if (!state.dirty) checkpoint();
      if (document.execCommand) document.execCommand(command, false, value);
      selectedBlock.type = "rich";
      selectedBlock.html = editable.innerHTML;
      message("Cambios sin guardar");
      return;
    }
    if (name === "publish") {
      if (!state.current.id || state.dirty) return message("Guarda el borrador antes de publicarlo.", "warning");
      if (!window.confirm("¿Publicar esta versión para los próximos correos automáticos?")) return;
      state.current = await api(pathFor("/templates/" + state.current.id + "/actions"), "POST", {
        action: "publish", revision: state.current.revision, confirmed: true,
      });
      state.dirty = false;
      editor();
      return message("Versión publicada y activa.", "success");
    }
    if (name === "test") {
      if (!state.current.id || state.dirty) return message("Guarda el borrador antes de enviar una prueba.");
      const to = window.prompt("Destinatario de la prueba");
      if (!to || !window.confirm("¿Enviar una prueba real a " + to + "?")) return;
      const result = await api(pathFor("/templates/" + state.current.id + "/test"), "POST", {
        to: to, confirmed: true,
      });
      return message(result.message, "success");
    }
    if (name === "duplicate-template") {
      if (state.dirty) return message("Guarda el borrador antes de duplicarlo.");
      state.current = await api(pathFor("/templates/" + state.current.id + "/actions"), "POST", {
        action: "duplicate", revision: state.current.revision,
        folderId: state.current.folderId,
      });
      state.dirty = false; state.history = []; state.future = []; state.selected = [];
      editor();
      return message("Plantilla duplicada como borrador.", "success");
    }
    if (name === "archive-template" || name === "restore-template") {
      if (state.dirty) return message("Guarda el borrador antes de cambiar su estado.");
      if (name === "archive-template" &&
        !window.confirm("¿Archivar la plantilla? Si está publicada, se desactivará.")) return;
      state.current = await api(pathFor("/templates/" + state.current.id + "/actions"), "POST", {
        action: name === "archive-template" ? "archive" : "restore",
        revision: state.current.revision,
      });
      state.dirty = false;
      editor();
      return message(name === "archive-template" ? "Plantilla archivada." : "Plantilla restaurada.", "success");
    }
    if (name === "versions") {
      const versions = await api(pathFor("/templates/" + state.current.id + "/versions"));
      root.querySelector("#mailAdvancedOutput").innerHTML = '<div class="mail-version-list"><h4>Versiones publicadas</h4>' +
        versions.map((version) => "<p><span>" +
          new Date(version.createdAt).toLocaleString("es-ES") + " · " +
          (version.publications.length ? "Activa" : "Histórica") + "</span>" +
          button("restore-version", "Restaurar como borrador",
            'data-id="' + esc(version.id) + '"', "mail-link") + "</p>").join("") + "</div>";
      return;
    }
    if (name === "restore-version") {
      if (!window.confirm("¿Restaurar esta versión como borrador sin publicarla?")) return;
      state.current = await api(pathFor("/templates/" + state.current.id + "/actions"), "POST", {
        action: "restoreVersion", revision: state.current.revision, versionId: element.dataset.id,
      });
      state.dirty = false;
      return editor();
    }
    if (name === "signatures") return signatureList();
    if (name === "signature-new") {
      state.signatureEditor = true;
      state.current = { name: "Nueva firma", subject: "Firma", document: { blocks: [] } };
      state.history = []; state.future = []; state.selected = []; state.dirty = true;
      return editor();
    }
    if (name === "signature-edit") {
      state.signatureEditor = true;
      state.current = D.clone(state.signatures.find((signature) => signature.id === element.dataset.id));
      state.history = []; state.future = []; state.selected = []; state.dirty = false;
      return editor();
    }
  }
  root.addEventListener("click", async (event) => {
    const element = event.target.closest("[data-mail-action]");
    if (!element || element.disabled || state.busy) return;
    state.busy = true;
    try { await handleAction(element.dataset.mailAction, element); }
    catch (error) { message(error.message || "No se pudo completar la operación.", "error"); }
    finally { state.busy = false; }
  });
  root.addEventListener("mousedown", (event) => {
    if (event.target.closest('[data-mail-action^="format-"]')) event.preventDefault();
  });
  root.addEventListener("input", (event) => {
    if (!state.current) return;
    const element = event.target;
    if (element.dataset.field) {
      if (!state.dirty) checkpoint();
      state.current[element.dataset.field] = element.value;
      message("Cambios sin guardar");
    }
    if (element.dataset.prop) {
      if (!state.dirty) checkpoint();
      const block = D.blockAt(state.current.document, state.selected);
      block[element.dataset.prop] = ["number", "range"].includes(element.type)
        ? Number(element.value) : element.value;
      const canvas = root.querySelector('[data-block="' + state.selected.join("/") + '"]');
      if (canvas) canvas.setAttribute("style", blockStyle(block));
      const buttonPreview = canvas && canvas.querySelector(".mail-button-preview");
      if (buttonPreview) buttonPreview.setAttribute("style", buttonPreviewStyle(block));
      const image = canvas && canvas.querySelector("img");
      if (image && element.dataset.prop === "width") image.style.width = element.value + "px";
      message("Cambios sin guardar");
    }
    if (element.dataset.label) {
      if (!state.dirty) checkpoint();
      const block = D.blockAt(state.current.document, state.selected);
      block.labels = block.labels || {};
      block.labels[element.dataset.label] = element.value;
      const previewLabel = root.querySelector('[data-block="' + state.selected.join("/") +
        '"] [data-preview-label="' + element.dataset.label + '"]');
      if (previewLabel) previewLabel.textContent = element.value;
      message("Cambios sin guardar");
    }
    const textPath = element.dataset.editText == null ? element.dataset.editRich : element.dataset.editText;
    if (textPath != null) {
      if (!state.dirty) checkpoint();
      const block = D.blockAt(state.current.document, textPath.split("/").map(Number));
      if (element.dataset.editRich != null) block.html = element.innerHTML;
      else block.text = String(element.innerText == null ? element.textContent : element.innerText)
        .replace(/\n{3,}/g, "\n\n");
      message("Cambios sin guardar");
    }
  });
  root.addEventListener("change", (event) => {
    const element = event.target;
    if (element.id === "mailSignature") {
      checkpoint();
      state.current.signatureMode = ["none", "default"].includes(element.value)
        ? element.value : "selected";
      state.current.signatureId = state.current.signatureMode === "selected" ? element.value : null;
    }
    if (element.id === "mailUpload" && element.files && element.files[0]) {
      uploadImage(element.files[0], element.dataset.background === "true")
        .catch((error) => message(uploadErrorMessage(error), "error"));
    }
  });
  root.addEventListener("focusin", (event) => {
    const path = event.target.dataset.editText == null
      ? event.target.dataset.editRich : event.target.dataset.editText;
    if (path != null) selectPath(path.split("/").map(Number));
  });
  root.addEventListener("paste", (event) => {
    const editable = event.target.closest("[data-edit-rich],[data-edit-text]");
    if (!editable) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (document.execCommand) document.execCommand("insertText", false, text);
  });
  root.addEventListener("dragstart", (event) => {
    const element = event.target.closest("[data-type],.mail-drag-handle");
    if (!element) return;
    state.dragging = element.dataset.type
      ? { type: element.dataset.type }
      : { block: element.closest("[data-block]").dataset.block };
    if (event.dataTransfer) event.dataTransfer.setData("text/plain", "cronox-mail-block");
  });
  root.addEventListener("dragover", (event) => {
    if (state.dragging || (event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files"))) {
      event.preventDefault();
      const target = event.target.closest("[data-block],[data-drop-list]");
      if (target) target.classList.add("is-drop-target");
    }
  });
  root.addEventListener("dragleave", (event) => {
    const target = event.target.closest(".is-drop-target");
    if (target) target.classList.remove("is-drop-target");
  });
  root.addEventListener("drop", async (event) => {
    event.preventDefault();
    root.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    const targetBlock = (event.target.closest("[data-block]") || {}).dataset;
    const listElement = event.target.closest("[data-drop-list]");
    const listPath = listElement
      ? listElement.dataset.dropList.split("/").filter(Boolean).map(Number) : [];
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
      return uploadImage(event.dataTransfer.files[0], false, listPath)
        .catch((error) => message(uploadErrorMessage(error), "error"));
    }
    const dragging = state.dragging;
    state.dragging = null;
    if (!dragging) return;
    checkpoint();
    if (dragging.type) {
      const list = D.listAt(state.current.document, listPath);
      list.push(D.createBlock(dragging.type));
      state.selected = listPath.concat(list.length - 1);
    } else if (targetBlock && targetBlock.block) {
      D.moveBlock(state.current.document,
        dragging.block.split("/").map(Number),
        targetBlock.block.split("/").map(Number));
    } else {
      const sourcePath = dragging.block.split("/").map(Number);
      const sourceList = D.listAt(state.current.document, sourcePath.slice(0, -1));
      const targetList = D.listAt(state.current.document, listPath);
      const moved = sourceList && sourceList.splice(sourcePath[sourcePath.length - 1], 1)[0];
      if (moved && targetList) targetList.push(moved);
    }
    editor();
  });
  root.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-resize]");
    if (!handle) return;
    event.preventDefault();
    const path = handle.dataset.resize.split("/").map(Number);
    const block = D.blockAt(state.current.document, path);
    const startX = event.clientX;
    const startWidth = Number(block.width) || 560;
    checkpoint();
    const move = (moveEvent) => {
      block.width = Math.max(80, Math.min(640, startWidth + (moveEvent.clientX - startX) * 2));
      const image = root.querySelector('[data-block="' + path.join("/") + '"] img');
      if (image) image.style.width = block.width + "px";
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      renderInspector();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  });
  document.addEventListener("keydown", (event) => {
    if (!state.current || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      save().catch((error) => message(error.message, "error"));
    } else if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      handleAction(event.shiftKey ? "redo" : "undo", document.createElement("button"));
    } else if (event.key.toLowerCase() === "y") {
      event.preventDefault();
      handleAction("redo", document.createElement("button"));
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  window.CRONOX_MAILS = { load: load, canLeave: canLeave };
})();
