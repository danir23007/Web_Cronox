(() => {
  "use strict";
  if (window.CRONOX_BULK) return;
  const lists = new Map();
  const LIMIT = 100;
  const stateLabel = (value) => ({
    ACTIVE: "Activa",
    PENDING_PASSWORD: "Pendiente de contraseña",
    PRE_REGISTERED: "Prerregistrado",
  })[value] || value || "—";
  const element = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const button = (text) => {
    const node = element("button", text, "btn");
    node.type = "button";
    return node;
  };
  async function api(path, body) {
    const response = await fetch(
      `${window.CRONOX_API.API_BASE || ""}/api/admin/bulk/${path}`,
      {
        method: body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(body?.operationId ? 45000 : 15000),
        headers: body
          ? {
              ...(await window.CRONOX_API.getCsrfHeaders()),
              "Content-Type": "application/json",
            }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw Object.assign(
        new Error(
          response.status >= 500
            ? "El servidor no pudo completar la operación."
            : Array.isArray(data?.message)
              ? data.message.join(" ")
              : data?.message || "No se pudo completar la operación.",
        ),
        { status: response.status },
      );
    return data;
  }
  const filterKey = (query) =>
    JSON.stringify(
      Object.entries(query)
        .filter(
          ([k, v]) =>
            !["page", "pageSize", "limit"].includes(k) && v !== undefined,
        )
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  function updateSelection(s) {
    s.count.textContent = s.ids.size + " seleccionados";
    s.actions.hidden = !s.ids.size;
    s.body.querySelectorAll("[data-bulk-id]").forEach((input) => {
      input.checked = s.ids.has(Number(input.dataset.bulkId));
    });
    s.all.checked = s.total > 0 && s.ids.size === s.total;
    s.all.indeterminate = s.ids.size > 0 && !s.all.checked;
    s.all.disabled = s.busy || s.total === 0;
  }
  function clearSelection(s, message = "") {
    s.ids.clear();
    s.notice.textContent = message;
    updateSelection(s);
  }
  function addPageCells(s) {
    const rows = [...s.body.querySelectorAll("tr")];
    s.items.forEach((item, index) => {
      const row = rows[index];
      if (!row || row.querySelector("[data-bulk-id]")) return;
      const td = element("td", null, "bulk-select-cell");
      const input = element("input");
      input.type = "checkbox";
      input.dataset.bulkId = item.id;
      input.setAttribute("aria-label", "Seleccionar " + (item.name || item.email || "#" + item.id));
      td.append(input);
      row.prepend(td);
    });
    if (!s.items.length) {
      s.body.querySelectorAll("td[colspan]").forEach((cell) => {
        cell.colSpan = s.table.tHead.rows[0].cells.length;
      });
    }
  }
  function setMode(s, active) {
    if (s.active === active) return;
    s.active = active;
    s.requestVersion += 1;
    clearSelection(s);
    s.toggle.textContent = active ? "Cancelar Bulk Edit" : "Bulk Edit";
    s.toggle.setAttribute("aria-expanded", String(active));
    s.bar.hidden = !active;
    s.table.classList.toggle("bulk-edit-active", active);
    if (active) {
      s.table.tHead.rows[0].prepend(s.header);
      addPageCells(s);
    } else {
      s.header.remove();
      s.body.querySelectorAll(".bulk-select-cell").forEach((cell) => cell.remove());
      s.body.querySelectorAll("td[colspan]").forEach((cell) => {
        cell.colSpan = s.table.tHead.rows[0].cells.length;
      });
    }
    updateSelection(s);
  }
  function mount({ kind, body, query, reload, role }) {
    if (role !== "SUPERADMIN" || !body || lists.has(kind)) return;
    const table = body.closest("table");
    const header = element("th", null, "bulk-select-cell");
    header.setAttribute("scope", "col");
    header.setAttribute("aria-label", "Selección");
    const all = element("input");
    all.type = "checkbox";
    all.setAttribute("aria-label", "Seleccionar todos");
    const selectAll = element("label", null, "bulk-select-all");
    selectAll.append(all, document.createTextNode("Seleccionar todos"));
    const bar = element("div", null, "bulk-selection");
    const toggle = button("Bulk Edit");
    toggle.classList.add("bulk-mode-toggle");
    toggle.setAttribute("aria-expanded", "false");
    const limit = element("small", "Máximo " + LIMIT + " registros por operación.");
    const actions = element("div", null, "bulk-actions");
    const count = element("strong");
    const edit = button("Editar seleccionados");
    const clear = button("Limpiar selección");
    const notice = element("p", null, "bulk-notice");
    notice.setAttribute("role", "status");
    actions.append(edit, clear);
    bar.append(selectAll, count, limit, actions, notice);
    bar.hidden = true;
    const wrapper = table.closest(".admin-table-scroll") || table;
    wrapper.before(toggle, bar);
    table.classList.add("bulk-table", "bulk-table--" + kind);
    const s = {
      kind, body, table, header, toggle, bar, query, reload,
      ids: new Set(), items: [], total: 0, active: false, requestVersion: 0,
      all, count, actions, notice, key: filterKey(query()), busy: false,
    };
    lists.set(kind, s);
    toggle.addEventListener("click", () => setMode(s, !s.active));
    const filterEdited = (event) => {
      if (event.target.matches("input,select") &&
          !event.target.closest("table,.bulk-selection")) {
        s.requestVersion += 1;
        s.key = filterKey(query());
        if (s.ids.size) clearSelection(s, "Selección limpiada porque han cambiado los filtros o la búsqueda.");
      }
    };
    body.closest("section").addEventListener("input", filterEdited);
    body.closest("section").addEventListener("change", filterEdited);
    clear.addEventListener("click", () => clearSelection(s));
    body.addEventListener("click", (event) => {
      if (event.target.closest("[data-bulk-id]")) event.stopPropagation();
    }, true);
    body.addEventListener("change", (event) => {
      const input = event.target.closest("[data-bulk-id]");
      if (!input || !s.active) return;
      const id = Number(input.dataset.bulkId);
      if (input.checked && s.ids.size >= LIMIT) {
        input.checked = false;
        notice.textContent = "Límite de " + LIMIT + " registros.";
        return;
      }
      input.checked ? s.ids.add(id) : s.ids.delete(id);
      updateSelection(s);
    });
    all.addEventListener("change", async () => {
      if (!s.active || s.busy) return;
      if (!all.checked) {
        clearSelection(s);
        return;
      }
      if (s.total > LIMIT) {
        clearSelection(s, "Hay " + s.total + " resultados y el límite es " + LIMIT + ". No se ha seleccionado ninguno. Acota los filtros o selecciona manualmente hasta " + LIMIT + ".");
        return;
      }
      s.busy = true;
      updateSelection(s);
      const version = ++s.requestVersion;
      const key = filterKey(query());
      const params = new URLSearchParams(
        Object.entries(query()).filter(([k, v]) =>
          !["page", "pageSize", "limit"].includes(k) && v !== undefined),
      );
      notice.textContent = "Consultando todos los resultados del backend…";
      try {
        const result = await api(kind + "/selection?" + params);
        if (!s.active || s.requestVersion !== version || filterKey(query()) !== key) return;
        if (!Array.isArray(result.ids) || result.ids.length > LIMIT)
          throw new Error("Selección incompleta o inválida.");
        s.ids = new Set(result.ids.map(Number));
        notice.textContent = "Selección capturada: " + s.ids.size + " registros. Los nuevos registros no se añadirán automáticamente.";
      } catch (error) {
        if (s.active && s.requestVersion === version) {
          if (error.status === 400) clearSelection(s);
          notice.textContent = error.message;
        }
      } finally {
        s.busy = false;
        updateSelection(s);
      }
    });
    edit.addEventListener("click", () => openEditor(s, edit));
    updateSelection(s);
  }
  function beforeLoad(kind) {
    const s = lists.get(kind);
    if (!s) return;
    const key = filterKey(s.query());
    if (key !== s.key) {
      const had = s.ids.size;
      s.ids.clear();
      s.requestVersion += 1;
      s.key = key;
      if (had) s.notice.textContent = "Selección limpiada porque han cambiado los filtros o la búsqueda.";
    }
    updateSelection(s);
  }
  function page(kind, items, total = items.length) {
    const s = lists.get(kind);
    if (!s) return;
    s.items = items;
    s.total = Number(total) || 0;
    if (s.active) addPageCells(s);
    updateSelection(s);
  }
  function leave(sectionId) {
    lists.forEach((s) => {
      if (s.body.closest("section")?.id !== sectionId) setMode(s, false);
    });
  }
  async function openEditor(s, opener) {
    if (document.querySelector(".admin-bulk-dialog")) return;
    const noun = s.kind === "users" ? "usuarios" : "productos",
      ids = [...s.ids];
    const dialog = element("dialog", null, "admin-bulk-dialog"),
      title = element("h2", `Editar ${ids.length} ${noun}`);
    title.id = "bulkTitle";
    dialog.setAttribute("aria-labelledby", title.id);
    const close = button("Cerrar"),
      fields = element("fieldset"),
      status = element("p"),
      summary = element("section"),
      footer = element("div", null, "bulk-actions");
    status.setAttribute("role", "status");
    const review = button("Revisar cambios"),
      apply = button("Aplicar cambios"),
      check = button("Consultar resultado"),
      retry = button("Reintentar la misma operación");
    apply.disabled = true;
    check.hidden = true;
    retry.hidden = true;
    let preview = null,
      operation = null,
      processing = false,
      uncertain = false,
      categories = [],
      categoryReady = false,
      categoryBox = null;
    const controls = {};
    function select(key, label, options) {
      const wrap = element("label", label),
        input = element("select", null, "select");
      input.dataset.bulkField = key;
      options.forEach(([value, text]) => {
        const o = element("option", text);
        o.value = value;
        input.append(o);
      });
      wrap.append(input);
      fields.append(wrap);
      controls[key] = input;
      return input;
    }
    const unchanged = ["", "No modificar"];
    if (s.kind === "users") {
      select("role", "Rol", [
        unchanged,
        ...["USER", "FRIEND", "ADMIN"].map((v) => [v, v]),
      ]);
      select("circleLevel", "Círculo", [
        unchanged,
        ...[1, 2, 3, 4, 5].map((v) => [String(v), `Círculo ${v}`]),
      ]);
      select("accountState", "Estado", [
        unchanged,
        ["ACTIVE", "Activa"],
        ["PENDING_PASSWORD", "Pendiente de contraseña"],
        ["PRE_REGISTERED", "Prerregistrado"],
      ]);
      fields.append(
        element(
          "p",
          "El círculo es obligatorio. Las cuentas SUPERADMIN quedan excluidas; no puedes modificar tu propio rol ni estado. Activa requiere una contraseña existente; Pendiente de contraseña requiere no tenerla; Prerregistrado requiere además un prerregistro existente. Esta edición no crea contraseñas ni envía correos.",
        ),
      );
    } else {
      select("isActive", "Estado del producto", [
        unchanged,
        ["true", "Activar"],
        ["false", "Desactivar"],
      ]);
      select("categoryMode", "Categorías", [
        unchanged,
        ["add", "Añadir categorías"],
        ["remove", "Quitar categorías"],
        ["replace", "Sustituir categorías"],
        ["clear", "Dejar sin categorías"],
      ]);
      categoryBox = element("div", null, "bulk-categories");
      categoryBox.hidden = true;
      const categoryStatus = element("p"),
        categoryRetry = button("Reintentar categorías");
      categoryRetry.hidden = true;
      fields.append(categoryStatus, categoryRetry, categoryBox);
      const load = async () => {
        categoryReady = false;
        categoryRetry.hidden = true;
        categoryStatus.textContent = "Cargando todas las categorías…";
        try {
          categories = await window.CRONOX_API.admin.listAllAdminCategories();
          categoryBox.replaceChildren();
          categoryBox.append(window.CRONOX_CATEGORY_CONTROLS.render(categories, [], () => updateValidity()));
          categoryBox.querySelectorAll('[data-category-choice]').forEach(input => { input.dataset.bulkCategory = ''; });
          categoryReady = true;
          categoryStatus.textContent = categories.length
            ? ""
            : "No hay categorías disponibles.";
        } catch {
          categoryStatus.textContent =
            "No se pudieron cargar todas las categorías.";
          categoryRetry.hidden = false;
        }
        updateValidity();
      };
      categoryRetry.addEventListener("click", load);
      void load();
      fields.append(
        element(
          "p",
          "Sustituir conserva las categorías pendientes de clasificación. Dejar sin categorías requiere elegir esa acción explícita. Añadir y quitar conservan las demás asociaciones.",
        ),
      );
    }
    function changes() {
      const c = {};
      Object.entries(controls).forEach(([k, input]) => {
        if (input.value !== "")
          c[k] =
            k === "circleLevel"
              ? Number(input.value)
              : k === "isActive"
                ? input.value === "true"
                : input.value;
      });
      if (c.categoryMode && c.categoryMode !== "clear")
        c.categoryIds = [
          ...fields.querySelectorAll("[data-bulk-category]:checked"),
        ].map((i) => Number(i.value));
      return c;
    }
    function updateValidity() {
      const c = changes();
      if (categoryBox)
        categoryBox.hidden = !c.categoryMode || c.categoryMode === "clear";
      review.disabled =
        processing ||
        uncertain ||
        !Object.keys(c).length ||
        !!(
          c.categoryMode &&
          c.categoryMode !== "clear" &&
          (!categoryReady || !c.categoryIds.length)
        );
    }
    fields.addEventListener("change", () => {
      preview = null;
      operation = null;
      apply.disabled = true;
      summary.replaceChildren();
      updateValidity();
    });
    function busy(value) {
      processing = value;
      fields.disabled = value || uncertain;
      close.disabled = value || uncertain;
      apply.disabled = value || !preview?.counts.changed;
      check.disabled = value;
      retry.disabled = value;
      updateValidity();
    }
    function describe(c, plan) {
      const lines = [];
      const count = (key) =>
        plan.rows.filter(
          (r) =>
            r.state === "changed" &&
            JSON.stringify(r.before[key]) !== JSON.stringify(r.after[key]),
        ).length;
      if (c.role)
        lines.push(
          `Cambiar el rol a ${c.role} de ${count("role")} usuarios. Los permisos y sesiones se actualizarán.`,
        );
      if (c.circleLevel)
        lines.push(
          `Asignar el círculo ${c.circleLevel} a ${count("circleLevel")} usuarios.`,
        );
      if (c.accountState)
        lines.push(`Cambiar el estado a ${stateLabel(c.accountState)} de ${count("accountState")} usuarios. Las sesiones se actualizarán.`);
      if (c.isActive !== undefined)
        lines.push(
          `${c.isActive ? "Activar" : "Desactivar"} ${count("isActive")} productos.`,
        );
      if (c.categoryMode) {
        const names = categories
          .filter((cat) => (c.categoryIds || []).includes(cat.id))
          .map((cat) => cat.name)
          .join(", ");
        const number = count("categoryIds");
        lines.push(
          c.categoryMode === "clear"
            ? `Dejar ${number} productos sin categorías.`
            : c.categoryMode === "replace"
              ? `Sustituir las categorías de ${number} productos por ${names}. Se eliminan las asociaciones anteriores.`
              : `${c.categoryMode === "add" ? "Añadir" : "Quitar"} ${names} en ${number} productos, conservando las demás categorías.`,
        );
      }
      return lines.join(" ");
    }
    function renderPlan(plan, c) {
      summary.replaceChildren(element("p", describe(c, plan)));
      summary.append(
        element(
          "p",
          `${plan.counts.changed} cambiarán · ${plan.counts.unchanged} sin cambios · ${plan.counts.excluded} excluidos`,
        ),
      );
      for (const [state, label] of [
        ["changed", "Cambiarán"],
        ["unchanged", "Sin cambios"],
        ["excluded", "Excluidos"],
      ]) {
        const detail = element("details"),
          heading = element("summary", label),
          ul = element("ul");
        plan.rows
          .filter((r) => r.state === state)
          .forEach((r) =>
            ul.append(
              element(
                "li",
                `${r.name} (#${r.id})${s.kind === "users" ? ` · Estado: ${stateLabel(r.before.accountState)} → ${stateLabel(r.after.accountState)}` : ""}${r.reason ? " — " + r.reason : ""}`,
              ),
            ),
          );
        detail.append(heading, ul);
        summary.append(detail);
      }
      apply.textContent = `Aplicar cambios a ${plan.counts.changed} ${noun}`;
      apply.disabled = !plan.counts.changed;
    }
    review.addEventListener("click", async () => {
      busy(true);
      status.textContent = "Validando y preparando el resumen…";
      try {
        const c = changes();
        preview = await api("preview", { kind: s.kind, ids, changes: c });
        operation = null;
        renderPlan(preview, c);
        status.textContent = "Revisa el resumen antes de aplicar.";
      } catch (e) {
        preview = null;
        status.textContent = e.message;
      } finally {
        busy(false);
      }
    });
    async function completed(result) {
      uncertain = false;
      preview = null;
      operation = null;
      s.ids.clear();
      updateSelection(s);
      const c = result.counts;
      status.textContent = `Completado: ${c.changed} modificados, ${c.unchanged} sin cambios y ${c.excluded} excluidos.`;
      fields.disabled = true;
      review.hidden = true;
      apply.hidden = true;
      check.hidden = true;
      retry.hidden = true;
      close.disabled = false;
      await s.reload();
      window.dispatchEvent(new CustomEvent("cronox:productsChanged"));
      opener.focus();
    }
    async function execute() {
      if (processing) return;
      if (!operation) {
        if (!preview) return;
        operation = {
          kind: s.kind,
          ids,
          changes: changes(),
          reviewToken: preview.reviewToken,
          operationId: crypto.randomUUID(),
        };
      }
      busy(true);
      status.textContent = `Procesando operación ${operation.operationId}…`;
      try {
        await completed(await api("execute", operation));
      } catch (e) {
        if (e.status && e.status < 500) {
          uncertain = false;
          preview = null;
          operation = null;
          status.textContent = e.message + " Revisa de nuevo los cambios.";
          check.hidden = true;
          retry.hidden = true;
        } else {
          uncertain = true;
          status.textContent = `Resultado no confirmado. Consulta la operación ${operation.operationId} antes de repetirla.`;
          check.hidden = false;
          retry.hidden = true;
        }
      } finally {
        busy(false);
        if (!operation && review.hidden) fields.disabled = true;
      }
    }
    apply.addEventListener("click", execute);
    retry.addEventListener("click", execute);
    check.addEventListener("click", async () => {
      if (!operation || processing) return;
      busy(true);
      try {
        await completed(await api(`operations/${operation.operationId}`));
      } catch (e) {
        status.textContent = e.message;
        if (e.status === 404) {
          retry.hidden = false;
          status.textContent +=
            " El reintento conserva el mismo identificador y no duplica cambios.";
        }
      } finally {
        busy(false);
        if (!operation && review.hidden) fields.disabled = true;
      }
    });
    const dismiss = () => {
      if (processing || uncertain) return;
      dialog.close();
      dialog.remove();
      opener.focus();
    };
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      dismiss();
    });
    footer.append(review, apply, check, retry, close);
    dialog.append(title, fields, summary, status, footer);
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
    updateValidity();
    busy(true);
    status.textContent = "Consultando los valores actuales…";
    try {
      const initial = await api("preview", { kind: s.kind, ids, changes: {} });
      const values = element("p");
      values.textContent = Object.keys(initial.rows[0]?.before || {})
        .map((key) => {
          const different =
            new Set(initial.rows.map((r) => JSON.stringify(r.before[key])))
              .size > 1;
          const labels = {
            role: "Rol",
            circleLevel: "Círculo",
            accountState: "Estado",
            isActive: "Estado",
            categoryIds: "Categorías",
          };
          return `${labels[key]}: ${different ? "Valores distintos" : key === "categoryIds" ? "Mismas categorías" : key === "accountState" ? stateLabel(initial.rows[0].before[key]) : String(initial.rows[0].before[key])}`;
        })
        .join(" · ");
      fields.prepend(values);
      status.textContent = "Todos los campos comienzan en «No modificar».";
    } catch (e) {
      status.textContent = e.message;
    } finally {
      busy(false);
    }
  }
  window.CRONOX_BULK = { mount, beforeLoad, page, leave, isActive: (kind) => lists.get(kind)?.active || false };
})();
