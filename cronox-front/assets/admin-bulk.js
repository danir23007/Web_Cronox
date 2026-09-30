(() => {
  "use strict";
  if (window.CRONOX_BULK) return;
  const lists = new Map();
  const LIMIT = 100;
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
    s.count.textContent = `${s.ids.size} seleccionados`;
    s.actions.hidden = !s.ids.size;
    const visible = [...s.body.querySelectorAll("[data-bulk-id]")];
    visible.forEach((input) => {
      input.checked = s.ids.has(Number(input.dataset.bulkId));
    });
    const checked = visible.filter((input) => input.checked).length;
    s.all.checked = !!visible.length && checked === visible.length;
    s.all.indeterminate = checked > 0 && checked < visible.length;
    s.all.disabled = !visible.length;
  }
  function mount({ kind, body, query, reload, role }) {
    if (role !== "SUPERADMIN" || !body || lists.has(kind)) return;
    const table = body.closest("table"),
      header = element("th"),
      all = element("input");
    all.type = "checkbox";
    all.setAttribute("aria-label", "Seleccionar esta página");
    header.append(all);
    table.tHead.rows[0].prepend(header);
    const bar = element("div", null, "bulk-selection"),
      selectAll = button("Seleccionar todos los resultados filtrados");
    const limit = element("small", `Máximo ${LIMIT} registros por operación.`),
      actions = element("div", null, "bulk-actions"),
      count = element("strong");
    const edit = button("Editar seleccionados"),
      clear = button("Limpiar selección"),
      notice = element("p", null, "bulk-notice");
    notice.setAttribute("role", "status");
    actions.append(count, edit, clear);
    bar.append(selectAll, limit, actions, notice);
    const wrapper = table.closest(".admin-table-scroll") || table;
    wrapper.before(bar);
    const s = {
      kind,
      body,
      query,
      reload,
      ids: new Set(),
      all,
      count,
      actions,
      notice,
      key: filterKey(query()),
      busy: false,
    };
    lists.set(kind, s);
    const filterEdited = (event) => {
      if (
        event.target.matches("input,select") &&
        !event.target.closest("table,.bulk-selection") &&
        s.ids.size
      ) {
        s.ids.clear();
        notice.textContent =
          "Selección limpiada porque han cambiado los filtros o la búsqueda.";
        updateSelection(s);
      }
    };
    body.closest("section").addEventListener("input", filterEdited);
    body.closest("section").addEventListener("change", filterEdited);
    clear.addEventListener("click", () => {
      s.ids.clear();
      updateSelection(s);
    });
    all.addEventListener("change", () => {
      const ids = [...body.querySelectorAll("[data-bulk-id]")].map((i) =>
        Number(i.dataset.bulkId),
      );
      if (all.checked && new Set([...s.ids, ...ids]).size > LIMIT) {
        notice.textContent = `No se pueden seleccionar más de ${LIMIT} registros.`;
        updateSelection(s);
        return;
      }
      ids.forEach((id) => (all.checked ? s.ids.add(id) : s.ids.delete(id)));
      updateSelection(s);
    });
    body.addEventListener(
      "click",
      (event) => {
        if (event.target.closest("[data-bulk-id]")) event.stopPropagation();
      },
      true,
    );
    body.addEventListener("change", (event) => {
      const input = event.target.closest("[data-bulk-id]");
      if (!input) return;
      const id = Number(input.dataset.bulkId);
      if (input.checked && s.ids.size >= LIMIT) {
        input.checked = false;
        notice.textContent = `Límite de ${LIMIT} registros.`;
        return;
      }
      input.checked ? s.ids.add(id) : s.ids.delete(id);
      updateSelection(s);
    });
    selectAll.addEventListener("click", async () => {
      if (s.busy) return;
      s.busy = true;
      selectAll.disabled = true;
      const key = filterKey(query()),
        params = new URLSearchParams(
          Object.entries(query()).filter(([, v]) => v !== undefined),
        );
      notice.textContent = "Consultando todos los resultados del backend…";
      try {
        const result = await api(`${kind}/selection?${params}`);
        if (filterKey(query()) !== key) {
          notice.textContent = "Los filtros han cambiado. Repite la selección.";
          return;
        }
        if (!Array.isArray(result.ids) || result.ids.length > LIMIT)
          throw new Error("Selección incompleta o inválida.");
        s.ids = new Set(result.ids);
        notice.textContent = `Selección capturada: ${s.ids.size} registros. Los nuevos registros no se añadirán automáticamente.`;
        updateSelection(s);
      } catch (e) {
        notice.textContent = e.message;
      } finally {
        s.busy = false;
        selectAll.disabled = false;
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
      s.key = key;
      if (had)
        s.notice.textContent =
          "Selección limpiada porque han cambiado los filtros o la búsqueda.";
    }
    updateSelection(s);
    s.all.disabled = true;
    s.all.checked = false;
    s.all.indeterminate = false;
  }
  function page(kind, items) {
    const s = lists.get(kind);
    if (!s) return;
    const rows = [...s.body.querySelectorAll("tr")];
    items.forEach((item, index) => {
      const row = rows[index];
      if (!row || row.querySelector("[data-bulk-id]")) return;
      const td = element("td"),
        input = element("input");
      input.type = "checkbox";
      input.dataset.bulkId = item.id;
      input.setAttribute(
        "aria-label",
        `Seleccionar ${item.name || item.email || "#" + item.id}`,
      );
      td.append(input);
      row.prepend(td);
    });
    if (!items.length)
      s.body.querySelectorAll("[colspan]").forEach((td) => (td.colSpan += 1));
    updateSelection(s);
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
      fields.append(
        element(
          "p",
          "El círculo es obligatorio. Las cuentas SUPERADMIN quedan excluidas; no puedes modificar tu propio rol. No se editan estados de registro ni credenciales.",
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
          categories.forEach((c) => {
            const label = element("label"),
              input = element("input");
            input.type = "checkbox";
            input.value = c.id;
            input.dataset.bulkCategory = "";
            label.append(
              input,
              document.createTextNode(
                c.name + (c.isActive === false ? " (inactiva)" : ""),
              ),
            );
            categoryBox.append(label);
          });
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
          "Sustituir elimina las asociaciones anteriores. Dejar sin categorías requiere elegir esa acción explícita. Añadir y quitar conservan las demás asociaciones.",
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
                `${r.name} (#${r.id})${r.reason ? " — " + r.reason : ""}`,
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
            isActive: "Estado",
            categoryIds: "Categorías",
          };
          return `${labels[key]}: ${different ? "Valores distintos" : key === "categoryIds" ? "Mismas categorías" : String(initial.rows[0].before[key])}`;
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
  window.CRONOX_BULK = { mount, beforeLoad, page };
})();
