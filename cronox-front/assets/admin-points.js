(() => {
  "use strict";
  const root = document.getElementById("salePointsRoot");
  if (!root) return;
  const esc = (value) =>
    String(value ?? "").replace(
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
  const money = (value) =>
    value == null
      ? "No disponible"
      : new Intl.NumberFormat("es-ES", {
          style: "currency",
          currency: "EUR",
        }).format(value / 100);
  const localNow = () =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(new Date())
      .replace(" ", "T");
  const dateLabel = (value) =>
    new Date(value).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const numeric = (value) => {
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(value)))
      throw new Error(
        "Introduce un importe positivo o cero, con un máximo de dos decimales.",
      );
    const [whole, decimal = ""] = String(value).replace(",", ".").split(".");
    const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
    if (!Number.isSafeInteger(result))
      throw new Error("Importe demasiado grande.");
    return result;
  };
  const roundCommission = (amount, bp) =>
    Number((BigInt(amount) * BigInt(bp) + 5000n) / 10000n);
  const input = (name, title, value = "", type = "text", extra = "") =>
    `<label>${esc(title)}<input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const action = (name, text, extra = "") =>
    `<button class="btn" type="button" data-action="${name}" ${extra}>${text}</button>`;
  const table = (headers, rows) =>
    `<div class="finance-table-wrap"><table class="finance-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sin registros en este periodo.</td></tr>`}</tbody></table></div>`;
  let detail,
    variants = [],
    points = [],
    revision = 0,
    picker,
    observer,
    activeForm;
  let historyProductId = '', historyFilterEvents;
  const historyParams = () => ({ from, to, search, ...(historyProductId ? { productId:historyProductId } : {}) });
  let from = localNow().slice(0, 8) + "01",
    to = localNow().slice(0, 10),
    search = "";
  const api = async (path = "", body, key) => {
    const response = await fetch(
      (window.CRONOX_API?.API_BASE || "") + "/api/admin/sale-points" + path,
      {
        credentials: "include",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                ...(await window.CRONOX_API.getCsrfHeaders()),
                "Content-Type": "application/json",
                "Idempotency-Key": key,
              }
            : {}),
        },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(
        Array.isArray(data.message)
          ? data.message.join(" · ")
          : data.message || "No se pudo completar la operación.",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  };
  function navigate(id = "") {
    window.CRONOX_ADMIN_NAV?.navigate(
      "#section-sale-points" +
        (id ? "?" + new URLSearchParams({ point: id, ...historyParams() }) : ""),
    );
  }
  function editor(title, content, submit) {
    if (
      activeForm?.isConnected &&
      window.CRONOX_ADMIN_SHELL?.hasDirty() &&
      !confirm("¿Descartar el formulario sin guardar?")
    )
      return null;
    if (activeForm) window.CRONOX_ADMIN_SHELL?.release(activeForm);
    const host = root.querySelector("[data-editor]");
    host.innerHTML = `<article class="finance-card pos-editor"><h2 tabindex="-1">${esc(title)}</h2><form><div class="pos-fields">${content}</div><div data-preview aria-live="polite"></div><p role="alert" data-error></p><div class="pos-actions"><button class="btn primary" type="submit">Guardar</button>${action("cancel", "Cancelar")}</div></form></article>`;
    const form = host.querySelector("form");
    let key = crypto.randomUUID(),
      submittedBody = null,
      busy = false;
    activeForm = form;
    const readForm = () =>
      JSON.stringify(
        [...form.querySelectorAll("input,select,textarea")].map((el) => [
          el.value,
          el.checked,
        ]),
      );
    queueMicrotask(() => window.CRONOX_ADMIN_SHELL?.capture(form, readForm));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const error = form.querySelector("[data-error]");
      error.textContent = "";
      try {
        // Keep the same request key after uncertain network failures. Editing the
        // payload after such a failure requires a reload/review, never a new sale.
        const payload = submit.read(form);
        if (submittedBody && submittedBody !== JSON.stringify(payload))
          throw new Error(
            "Hay un intento pendiente. Reintenta con los mismos datos o recarga para comprobar si se guardó antes de modificarlo.",
          );
        busy = true;
        form.querySelector("[type=submit]").disabled = true;
        submittedBody = JSON.stringify(payload);
        let result;
        try {
          result = await api(submit.path, payload, key);
        } catch (e) {
          if (e.status >= 400 && e.status < 500) {
            submittedBody = null;
            key = crypto.randomUUID();
          }
          throw e;
        }
        window.CRONOX_ADMIN_SHELL?.clear(form);
        window.CRONOX_ADMIN_SHELL?.release(form);
        host.innerHTML = "";
        if (result.occurredAt) {
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Madrid",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date(result.occurredAt));
          if (day < from) from = day;
          if (day > to) to = day;
        }
        if (!detail) search = "";
        const target = result.pointId || detail?.point.id;
        const nextHash =
          "#section-sale-points?" +
          new URLSearchParams({ point: target, ...historyParams() });
        if (location.hash !== nextHash) navigate(target);
        else await load();
      } catch (e) {
        error.textContent = e.message;
      } finally {
        busy = false;
        if (form.isConnected)
          form.querySelector("[type=submit]").disabled = false;
      }
    });
    form.querySelector("[data-action=cancel]").onclick = () => {
      if (busy) return;
      if (
        submittedBody &&
        !confirm(
          "Comprueba el historial antes de registrar de nuevo una operación cuyo resultado no se ha confirmado.",
        )
      )
        return;
      window.CRONOX_ADMIN_SHELL?.clear(form);
      window.CRONOX_ADMIN_SHELL?.release(form);
      host.innerHTML = "";
    };
    host.querySelector("h2").focus();
    return form;
  }
  function editPoint(point) {
    const form = editor(
      point ? "Editar punto de venta" : "Nuevo punto de venta",
      input(
        "name",
        "Nombre / edición",
        point?.name,
        "text",
        'required maxlength="160"',
      ) +
        `<label>Tipo<select class="select" name="type">${[
          ["STORE", "Tienda"],
          ["EVENT", "Evento"],
          ["OTHER", "Otro"],
        ]
          .map(
            ([v, t]) =>
              `<option value="${v}" ${point?.type === v ? "selected" : ""}>${t}</option>`,
          )
          .join("")}</select></label>` +
        input("city", "Ciudad", point?.city) +
        input("venue", "Lugar", point?.venue) +
        input("startsOn", "Inicio (opcional)", point?.startsOn, "date") +
        input("endsOn", "Fin (opcional)", point?.endsOn, "date") +
        input(
          "commission",
          "Comisión predeterminada (%)",
          (point?.commissionBp ?? 0) / 100,
          "number",
          'min="0" max="100" step="0.01" required',
        ) +
        input("notes", "Notas", point?.notes) +
        (point
          ? `<label><input name="archived" type="checkbox" ${point.archived ? "checked" : ""}>Archivado (conserva todo el historial)</label><p class="pos-archive-explanation">Archivar bloquea nuevas ventas y gastos. Conserva las ventas, los gastos, el historial y sus estadísticas. Puedes reactivar el punto cuando lo necesites.</p>`
          : input(
              "participation",
              "Participación (€)",
              "0",
              "number",
              'min="0" step="0.01" required',
            ) +
            input(
              "expenseDate",
              "Fecha del gasto · Madrid",
              localNow(),
              "datetime-local",
              "required",
            )),
      {
        path: point ? "/" + point.id : "",
        read: (form) => {
          const f = new FormData(form);
          return {
            name: f.get("name"),
            type: f.get("type"),
            city: f.get("city"),
            venue: f.get("venue"),
            startsOn: f.get("startsOn") || undefined,
            endsOn: f.get("endsOn") || undefined,
            commissionBp: numeric(f.get("commission")),
            notes: f.get("notes"),
            archived: !!f.get("archived"),
            ...(point
              ? { revision: point.revision }
              : {
                  participationCents: numeric(f.get("participation")),
                  expenseDate: f.get("expenseDate"),
                }),
          };
        },
      },
    );
    return form;
  }
  function registerSale(sale) {
    const point = detail.point;
    const form = editor(
      sale ? "Corregir venta · solo diferencias" : "Registrar venta",
      input(
        "occurredAt",
        sale ? "Fecha del ajuste · Madrid" : "Fecha de venta · Madrid",
        localNow(),
        "datetime-local",
        "required",
      ) +
        `<label>Método de pago<select class="select" name="paymentMethod">${[
          ["", "Sin especificar"],
          ["CASH", "Efectivo"],
          ["EXTERNAL_CARD", "Tarjeta externa"],
          ["BANK_TRANSFER", "Transferencia"],
          ["OTHER", "Otro"],
        ]
          .map(
            ([v, t]) =>
              `<option value="${v}" ${sale?.state.paymentMethod === v ? "selected" : ""}>${t}</option>`,
          )
          .join("")}</select></label>` +
        input("note", "Notas", sale?.state.note) +
        `<label>Stock de esta operación<select class="select" name="stockHandling"><option value="DEDUCT_NOW">${sale ? 'Ajustar stock al guardar (solo diferencias)' : 'Descontar stock al guardar'}</option><option value="ALREADY_ADJUSTED">${sale ? 'El stock ya estaba ajustado' : 'Ya estaba descontado'}</option></select></label><p>${sale ? 'Elige si este ajuste debe modificar el stock por la diferencia de cantidades o si ya lo ajustaste anteriormente.' : 'Si eliges «Ya estaba descontado», se registra la venta y su beneficio sin volver a restar unidades del stock.'}</p>` +
        (sale
          ? input("reason", "Motivo de la corrección", "", "text", "required")
          : "") +
        '<div class="pos-lines" data-lines></div>' +
        action("add-line", "Añadir prenda"),
      {
        path: `/${point.id}/sales${sale ? "/" + sale.id + "/correct" : ""}`,
        read: (form) => {
          const f = new FormData(form);
          return {
            occurredAt: f.get("occurredAt"),
            paymentMethod: f.get("paymentMethod"),
            stockHandling: f.get("stockHandling"),
            note: f.get("note"),
            ...(sale
              ? { revision: sale.revision, reason: f.get("reason") }
              : {}),
            lines: readLines(),
          };
        },
      },
    );
    if (!form) return;
    const linesHost = form.querySelector("[data-lines]");
    function readLines() {
      return [...linesHost.children].map((row) => ({
        ...(row.dataset.id ? { id: row.dataset.id } : {}),
        variantId: Number(row.querySelector("[data-variant]").value),
        quantity: Number(row.querySelector("[data-qty]").value),
        unitPriceCents: numeric(row.querySelector("[data-price]").value),
        commissionBp: numeric(row.querySelector("[data-commission]").value),
      }));
    }
    function preview() {
      const host = form.querySelector("[data-preview]");
      try {
        const lines = readLines();
        let revenue = 0,
          cost = 0,
          commissions = 0;
        const rows = lines.map((line, i) => {
          const old = sale?.state.lines.find((l) => l.id === line.id),
            variant = variants.find((v) => v.id === line.variantId);
          const unitCost = old ? old.unitCostCents : variant?.unitCostCents;
          if (unitCost == null)
            throw new Error(
              "Selecciona prendas con coste configurado. Un coste cero explícito sí es válido.",
            );
          const paid = line.unitPriceCents * line.quantity,
            fee =
              roundCommission(paid, line.commissionBp) +
              (old
                ? old.commissionCents -
                  roundCommission(
                    old.unitPriceCents * old.quantity,
                    old.commissionBp,
                  )
                : 0);
          revenue += paid;
          cost += unitCost * line.quantity;
          commissions += fee;
          return [
            i + 1,
            money(paid),
            money(unitCost * line.quantity),
            money(fee),
            money(paid - unitCost * line.quantity - fee),
          ];
        });
        host.innerHTML =
          table(
            ["Línea", "Pagado", "Coste", "Comisión", "Beneficio"],
            rows,
          ) +
          `<p>Total pagado: <strong>${money(revenue)}</strong> · Comisión: ${money(commissions)} · Para CRONOX: ${money(revenue - commissions)} · Coste: ${money(cost)} · Beneficio antes de gastos fijos: <strong>${money(revenue - cost - commissions)}</strong></p>${sale ? "<p>Se registrará la diferencia respecto a la venta anterior. Las líneas ya devueltas conservan su saldo; el historial incluye los costes de prendas que no se repusieron.</p>" : ""}`;
      } catch (e) {
        host.textContent = e.message;
      }
    }
    function addLine(line) {
      const row = document.createElement("fieldset");
      row.className = "pos-line";
      if (line) row.dataset.id = line.id;
      const available = [...variants];
      if (line && !available.some((v) => v.id === line.variantId))
        available.push({
          id: line.variantId,
          name: line.name,
          size: line.size,
          stock: "—",
        });
      row.innerHTML = `<legend>Prenda</legend><label>Producto y talla<select class="select" data-variant required ${line ? "disabled" : ""}><option value="">Seleccionar</option>${available.map((v) => `<option value="${v.id}" ${line?.variantId === v.id ? "selected" : ""}>${esc(v.name)} · ${esc(v.size)} · stock ${v.stock}</option>`).join("")}</select></label><label>Cantidad<input class="input" data-qty type="number" min="${sale ? 0 : 1}" max="1000" step="1" required value="${line?.quantity ?? 1}" ></label><label>Precio pagado por unidad (€)<input class="input" data-price type="number" min="0" max="100000" step="0.01" required value="${line ? (line.unitPriceCents / 100).toFixed(2) : ""}" ></label><label>Comisión (%)<input class="input" data-commission type="number" min="0" max="100" step="0.01" required value="${(line?.commissionBp ?? point.commissionBp) / 100}" ></label>${line?.returned ? "<small>Con devolución: saldo protegido. Puedes añadir nuevas líneas.</small>" : action("remove-line", "Quitar línea")}`;
      row
        .querySelector("[data-action=remove-line]")
        ?.addEventListener("click", () => {
          row.remove();
          preview();
        });
      linesHost.append(row);
      preview();
    }
    form.querySelector("[data-action=add-line]").onclick = () => addLine();
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);
    if (sale) sale.state.lines.forEach(addLine);
    else addLine();
  }
  function returnSale(sale) {
    const form = editor(
      "Devolución total o parcial",
      input(
        "occurredAt",
        "Fecha de devolución · Madrid",
        localNow(),
        "datetime-local",
        "required",
      ) +
        input("reason", "Motivo", "", "text", "required") +
        "<p>Indica cantidad 0 para las prendas que conservas. La comisión recuperada es un importe total, no un porcentaje. Sin reposición, el coste permanece como gasto.</p>" +
        sale.state.lines
          .filter((l) => l.quantity > 0)
          .map(
            (l) =>
              `<fieldset class="pos-line" data-return="${l.id}"><legend>${esc(l.name)} · ${esc(l.size)}</legend><p>Precio pagado: ${money(l.unitPriceCents)} · Coste unitario: ${money(l.unitCostCents)} · Comisión pendiente: ${money(l.commissionCents)}</p><label>Cantidad a devolver<input class="input" data-qty type="number" value="0" min="0" max="${l.quantity}" step="1" required></label><label><input data-restock type="checkbox">Reponer stock</label><label>Comisión recuperada (€)<input class="input" data-recovery type="number" min="0" max="${l.commissionCents / 100}" step="0.01" value="0" required></label></fieldset>`,
          )
          .join(""),
      {
        path: `/${detail.point.id}/sales/${sale.id}/returns`,
        read: (form) => {
          const f = new FormData(form),
            lines = [...form.querySelectorAll("[data-return]")]
              .map((row) => ({
                id: row.dataset.return,
                quantity: Number(row.querySelector("[data-qty]").value),
                restock: row.querySelector("[data-restock]").checked,
                recoveredCommissionCents: numeric(
                  row.querySelector("[data-recovery]").value,
                ),
              }))
              .filter((l) => l.quantity);
          if (!lines.length) throw new Error("Selecciona al menos una unidad.");
          return {
            occurredAt: f.get("occurredAt"),
            reason: f.get("reason"),
            revision: sale.revision,
            lines,
          };
        },
      },
    );
    return form;
  }
  function expense(original) {
    editor(
      original ? "Anular gasto con trazabilidad" : "Registrar gasto fijo",
      input(
        "description",
        original ? "Motivo de anulación" : "Descripción",
        "",
        "text",
        "required",
      ) +
        input(
          "occurredAt",
          "Fecha del gasto / ajuste · Madrid",
          localNow(),
          "datetime-local",
          "required",
        ) +
        input(
          "amount",
          "Importe (€)",
          original ? Math.abs(original.expenseCents) / 100 : "",
          "number",
          `min="0" step="0.01" required ${original ? "readonly" : ""}`,
        ),
      {
        path: `/${detail.point.id}/expenses`,
        read: (form) => {
          const f = new FormData(form);
          return {
            occurredAt: f.get("occurredAt"),
            description: f.get("description"),
            amountCents: numeric(f.get("amount")),
            ...(original ? { reversesId: original.id } : {}),
          };
        },
      },
    );
  }
  function listView() {
    root.innerHTML = `<div class="finance-heading"><div><h1>Puntos de venta</h1><p>Tiendas, eventos y ediciones independientes · Importes en EUR</p></div>${action("create", "Crear punto de venta")}</div><div data-editor></div><label>Buscar punto o ciudad<input class="input" data-point-search type="search" value="${esc(search)}"></label><div class="pos-list">${
      points
        .map((p) => {
          const t = p.totals;
          return `<article class="finance-card"><h2><button class="btn" data-open="${p.id}">${esc(p.name)}</button></h2><p>${esc(p.city)} · ${esc(p.venue)} ${p.archived ? "· Archivado" : ""}</p><dl class="pos-metrics">${[
            ["Unidades netas", t.unitsSold - t.unitsReturned],
            ["Facturación", money(t.revenueCents)],
            ["Comisiones", money(t.commissionCents)],
            ["Costes de prendas", money(t.costCents)],
            ["Gastos fijos", money(t.fixedExpenseCents)],
            ["Beneficio neto", money(t.profitCents)],
          ]
            .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
            .join("")}</dl></article>`;
        })
        .join("") || "<p>No hay puntos de venta.</p>"
    }</div>`;
    root.querySelector("[data-action=create]").onclick = () => editPoint();
    root
      .querySelectorAll("[data-open]")
      .forEach(
        (button) => (button.onclick = () => { search = ""; navigate(button.dataset.open); }),
      );
    const field = root.querySelector("[data-point-search]");
    let timer;
    field.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        search = field.value;
        await load();
        root.querySelector("[data-point-search]")?.focus();
      }, 350);
    };
  }
  function detailView() {
    const { point, report, sales, entries } = detail,
      t = report.totals;
    const blocked = point.archived ? 'disabled aria-describedby="pos-archived-help"' : '';
    const archivedStatus = point.archived ? `<div class="pos-archive-status" role="status"><strong>Punto archivado</strong><p id="pos-archived-help">No puedes registrar nuevas ventas ni gastos mientras esté archivado. Las operaciones anteriores, el historial y sus estadísticas se conservan.</p>${action("reactivate", "Reactivar")}<p data-reactivate-error role="alert"></p></div>` : '';
    root.innerHTML = `<div class="finance-heading"><div><h1>${esc(point.name)}</h1><p>${esc(point.city)} · ${esc(point.venue)} ${point.archived ? "· Archivado" : ""}</p></div><div class="pos-actions">${action("list", "Todos los puntos")}${action("edit", "Editar punto")}${action("sale", "Registrar venta", blocked)}${action("expense", "Registrar gasto", blocked)}</div></div>${archivedStatus}<div data-editor></div><div class="finance-controls"><div class="pos-range"></div><div class="pos-history-filter"><label for="pos-history-input">Filtrar historial por producto</label><input id="pos-history-input" class="input" data-history-search type="search" role="combobox" aria-autocomplete="list" aria-controls="pos-history-options" aria-expanded="false" autocomplete="off" value="${esc(search)}"><div id="pos-history-options" class="pos-history-options" role="listbox" aria-label="Productos del historial" hidden></div></div>${action("filter", "Aplicar filtro")}</div><p>Los indicadores incluyen todas las prendas del periodo. La búsqueda filtra el historial.</p><article class="finance-card"><dl class="pos-metrics">${[
      ["Facturación", money(t.revenueCents)],
      ["Beneficio neto", money(t.profitCents)],
      ["Unidades netas", report.netUnits],
      ["Ventas", t.salesCount],
      ["Ticket medio neto", money(report.averageTicketCents)],
      ["Costes de prendas", money(t.costCents)],
      ["Comisiones", money(t.commissionCents)],
      ["Para CRONOX antes de costes", money(report.cronoxCents)],
      ["Gastos fijos", money(t.fixedExpenseCents)],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join(
        "",
      )}</dl><div class="finance-chart"></div></article><article class="finance-card"><h2>Productos ganadores y tallas</h2><p>Beneficio después de coste y comisión; los gastos fijos se muestran por separado.</p><label>Ordenar por<select class="select" data-ranking><option value="revenueCents">Facturación</option><option value="netUnits">Unidades netas</option><option value="profitCents">Beneficio</option></select></label><div data-products></div></article><article class="finance-card"><h2>Ventas</h2>${table(
      ["Fecha · Madrid", "Detalle", "Acciones"],
      sales.map((s) => [
        esc(dateLabel(s.soldAt)),
        `<details><summary>${s.state.lines.map((l) => `${esc(l.name)} ${esc(l.size)} × ${l.quantity}`).join(" · ")}</summary>${table(
          [
            "Prenda",
            "Cantidad pendiente",
            "Precio pagado/u.",
            "Coste/u.",
            "Comisión pendiente",
          ],
          s.state.lines.map((l) => [
            esc(l.name) + " " + esc(l.size),
            l.quantity,
            money(l.unitPriceCents),
            money(l.unitCostCents),
            money(l.commissionCents),
          ]),
        )}<p>${esc(s.state.note)} · ${esc(s.state.paymentMethod)} · Revisión ${s.revision}</p></details>`,
        `${action("correct", "Corregir", `data-sale="${s.id}"`)} ${action("return", "Devolver", `data-sale="${s.id}" ${s.state.lines.some((l) => l.quantity > 0) ? "" : "disabled"}`)}`,
      ]),
    )}</article><article class="finance-card"><h2>Historial de ventas, ajustes y gastos</h2>${table(
      ["Fecha efectiva · Madrid", "Concepto", "Importe / cambios", "Registro"],
      entries.map((e) => [
        esc(dateLabel(e.occurredAt)),
        `${esc({ SALE: "Venta", CORRECTION: "Corrección", RETURN: "Devolución", EXPENSE: "Gasto", EXPENSE_REVERSAL: "Anulación de gasto", POINT_CREATE: "Creación / participación", POINT_EDIT: "Edición del punto" }[e.kind])}<br>${esc(e.description)}`,
        e.expenseCents ||
        ["EXPENSE", "POINT_CREATE", "EXPENSE_REVERSAL"].includes(e.kind)
          ? `${money(e.expenseCents)} ${e.expenseCents >= 0 && !entries.some((r) => r.reversesId === e.id) ? action("reverse", "Anular gasto", `data-entry="${e.id}"`) : ""}`
          : table(
              [
                "Prenda",
                "Ingreso",
                "Coste",
                "Comisión",
                "Unidades Δ / devueltas",
              ],
              e.lines.map((l) => [
                esc(l.name) + " " + esc(l.size),
                money(l.revenueCents),
                money(l.costCents),
                money(l.commissionCents),
                `${l.unitsSold} / ${l.unitsReturned}`,
              ]),
            ),
        `<small>Admin #${e.actorId}<br>${esc(dateLabel(e.createdAt))}</small>${
          e.before
            ? `<details><summary>Valores anteriores</summary>${
                e.before.lines
                  ? table(
                      [
                        "Prenda",
                        "Cantidad",
                        "Precio/u.",
                        "Coste/u.",
                        "Comisión",
                      ],
                      e.before.lines.map((l) => [
                        esc(l.name) + " " + esc(l.size),
                        l.quantity,
                        money(l.unitPriceCents),
                        money(l.unitCostCents),
                        money(l.commissionCents),
                      ]),
                    )
                  : `<p>${esc(e.before.name)} · ${esc(e.before.city)} · ${esc(e.before.venue)} · Comisión: ${e.before.commissionBp / 100}% · ${e.before.archived ? "Archivado" : "Activo"}</p>`
              }</details>`
            : ""
        }`,
      ]),
    )}</article>`;
    picker = new window.CRONOX_FINANCE.DatePicker(
      root.querySelector(".pos-range"),
      { from, to },
      (range) => {
        from = range.from;
        to = range.to;
        navigate(point.id);
      },
    );
    const chart = root.querySelector(".finance-chart");
    window.CRONOX_FINANCE.drawChart(chart, report, money);
    if (typeof ResizeObserver === "function") {
      let width = chart.clientWidth;
      observer = new ResizeObserver(() => {
        if (chart.clientWidth !== width) {
          width = chart.clientWidth;
          window.CRONOX_FINANCE.drawChart(chart, report, money);
        }
      });
      observer.observe(chart);
    }
    const rank = () => {
      const field = root.querySelector("[data-ranking]").value;
      const score = (p) =>
        field === "netUnits" ? p.unitsSold - p.unitsReturned : p[field];
      root.querySelector("[data-products]").innerHTML =
        "<h3>Productos</h3>" +
        table(
          [
            "Producto",
            "Unidades netas",
            "Facturación",
            "Coste",
            "Comisión",
            "Beneficio",
          ],
          [...report.products]
            .sort((a, b) => score(b) - score(a))
            .map((p) => [
              esc(p.name),
              p.unitsSold - p.unitsReturned,
              money(p.revenueCents),
              money(p.costCents),
              money(p.commissionCents),
              money(p.profitCents),
            ]),
        ) +
        "<h3>Desglose por talla</h3>" +
        table(
          [
            "Producto / talla",
            "Unidades netas",
            "Facturación",
            "Coste",
            "Comisión",
            "Beneficio",
          ],
          [...report.variants]
            .sort((a, b) => score(b) - score(a))
            .map((p) => [
              esc(p.name) + " · " + esc(p.size),
              p.unitsSold - p.unitsReturned,
              money(p.revenueCents),
              money(p.costCents),
              money(p.commissionCents),
              money(p.profitCents),
            ]),
        );
    };
    rank();
    root.querySelector("[data-ranking]").onchange = rank;
    setupHistoryFilter(point, report);
    root.querySelector("[data-action=list]").onclick = () => {
      search = "";
      navigate();
    };
    root.querySelector("[data-action=edit]").onclick = () => editPoint(point);
    root.querySelector("[data-action=sale]").onclick = () => registerSale();
    root.querySelector("[data-action=expense]").onclick = () => expense();
    const reactivate = root.querySelector('[data-action=reactivate]');
    if (reactivate) {
      const key = crypto.randomUUID();
      const payload = { name:point.name, type:point.type, city:point.city, venue:point.venue,
        startsOn:point.startsOn || undefined, endsOn:point.endsOn || undefined, notes:point.notes,
        commissionBp:point.commissionBp, archived:false, revision:point.revision };
      reactivate.onclick = async () => {
        if (reactivate.disabled) return;
        if (activeForm?.isConnected && !window.CRONOX_ADMIN_SHELL?.canLeave('reactivate')) return;
        const error = root.querySelector('[data-reactivate-error]');
        error.textContent = ''; reactivate.disabled = true; reactivate.textContent = 'Reactivando…';
        try { await api('/' + point.id, payload, key); await load(); }
        catch (e) { error.textContent = e.message; reactivate.disabled = false; reactivate.textContent = 'Reactivar'; }
      };
    }
    root
      .querySelectorAll("[data-action=correct]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            registerSale(sales.find((s) => s.id === b.dataset.sale))),
      );
    root
      .querySelectorAll("[data-action=return]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            returnSale(sales.find((s) => s.id === b.dataset.sale))),
      );
    root
      .querySelectorAll("[data-action=reverse]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            expense(entries.find((e) => e.id === b.dataset.entry))),
      );
  }
  function setupHistoryFilter(point, report) {
    const host=root.querySelector('.pos-history-filter'), field=host.querySelector('input'), popup=host.querySelector('[role=listbox]');
    historyFilterEvents=new AbortController(); const options={signal:historyFilterEvents.signal};
    const normalize=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es').trim();
    const products=[...report.products].sort((a,b)=>(b.unitsSold-b.unitsReturned)-(a.unitsSold-a.unitsReturned) || b.revenueCents-a.revenueCents || a.productId-b.productId);
    let visible=[], active=-1;
    const close=()=>{ popup.hidden=true; field.setAttribute('aria-expanded','false'); field.removeAttribute('aria-activedescendant'); active=-1; };
    const apply=(product)=>{
      const selected = product || (historyProductId && field.value.trim()===search ? products.find(p=>String(p.productId)===historyProductId) : undefined);
      search=selected ? selected.name : field.value.trim(); historyProductId=selected ? String(selected.productId) : '';
      close(); const next='#section-sale-points?'+new URLSearchParams({point:point.id,...historyParams()});
      if(location.hash===next) load(); else navigate(point.id);
    };
    const highlight=()=>{
      popup.querySelectorAll('[role=option]').forEach((node,i)=>node.setAttribute('aria-selected',String(i===active)));
      if(active>=0){ const node=popup.querySelectorAll('[role=option]')[active]; field.setAttribute('aria-activedescendant',node.id); node.scrollIntoView({block:'nearest'}); }
      else field.removeAttribute('aria-activedescendant');
    };
    const open=()=>{
      const term=normalize(field.value);
      visible=products.filter(p=>!term || normalize(p.name).includes(term) || String(p.productId)===term).slice(0,10);
      active=-1; popup.hidden=false; field.setAttribute('aria-expanded','true'); field.removeAttribute('aria-activedescendant');
      popup.innerHTML=`<p class="pos-history-hint">${term ? 'Coincidencias del historial' : 'Los 10 más vendidos · periodo seleccionado'}</p>`+
        (visible.length ? visible.map((p,i)=>`<button type="button" role="option" id="pos-history-option-${i}" aria-selected="false" data-suggestion="${i}"><span>${esc(p.name)}</span><small>${p.unitsSold-p.unitsReturned} uds. netas · #${p.productId}</small></button>`).join('') : '<p class="pos-history-hint">No hay productos coincidentes en este periodo.</p>');
      popup.querySelectorAll('[data-suggestion]').forEach(b=>b.onclick=()=>apply(visible[Number(b.dataset.suggestion)]));
    };
    field.addEventListener('focus',open,options);
    field.addEventListener('click',()=>{if(popup.hidden)open();},options);
    field.addEventListener('input',()=>{historyProductId=''; open();},options);
    field.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); if(popup.hidden)open(); if(visible.length){active=active<0 ? (event.key==='ArrowDown'?0:visible.length-1) : (active+(event.key==='ArrowDown'?1:-1)+visible.length)%visible.length; highlight();} }
      else if(event.key==='Escape'){event.preventDefault();close();}
      else if(event.key==='Enter'){event.preventDefault();apply(!popup.hidden&&active>=0 ? visible[active] : undefined);}
    },options);
    host.addEventListener('focusout',e=>{if(e.relatedTarget&&!host.contains(e.relatedTarget))close();},options);
    document.addEventListener('pointerdown',e=>{if(!host.contains(e.target))close();},options);
    root.querySelector('[data-action=filter]').onclick=()=>apply();
  }
  async function load() {
    historyFilterEvents?.abort();
    if (activeForm) window.CRONOX_ADMIN_SHELL?.release(activeForm);
    const current = ++revision;
    picker?.destroy();
    observer?.disconnect();
    root.innerHTML = '<p role="status">Cargando puntos de venta…</p>';
    try {
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      const id = params.get("point");
      if (id) {
        from = params.get("from") || from;
        to = params.get("to") || to;
        search = params.get("search") || "";
        historyProductId = /^[1-9]\d*$/.test(params.get('productId') || '') ? params.get('productId') : '';
      } else {
        historyProductId = '';
      }
      const result = await api(
        id
          ? `/${encodeURIComponent(id)}?${new URLSearchParams(historyParams())}`
          : "?" + new URLSearchParams({ search }),
      );
      const options = id ? await api("/options") : [];
      if (current !== revision) return;
      variants = options;
      detail = id ? result : null;
      points = id ? [] : result;
      detail ? detailView() : listView();
    } catch (e) {
      if (current !== revision) return;
      root.innerHTML = `<p role="alert">${esc(e.message)}</p>${action("retry", "Reintentar")}`;
      root.querySelector("button").onclick = load;
    }
  }
  window.CRONOX_POINTS = { load };
})();
