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
  const money = (n) =>
    (n / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const btn = (action, label, extra = "") =>
    `<button type="button" data-as="${action}" ${extra}>${label}</button>`;
  const storage = "cronox.register.after-sale.pending";
  let ui,
    customer,
    kind,
    order,
    orders = [],
    page = 1,
    more = false,
    selected = new Map(),
    preview = null,
    attempt = null,
    result = null,
    busy = false,
    version = 0,
    reader = null;
  let condition = false,
    reason = "",
    method = "",
    reference = "",
    externalDone = false;
  try {
    attempt = JSON.parse(sessionStorage.getItem(storage) || "null");
  } catch {}
  function stop() {
    window.CRONOX_REGISTER_CAMERA.stop();
    reader = null;
  }
  function notice(text, error = false) {
    ui.notice(text, error);
    const el = ui.work.querySelector("[data-as-status]");
    if (el) el.textContent = text;
    const errorBox = ui.receipt.querySelector("[data-as-error]");
    if (errorBox) errorBox.textContent = error ? text : "";
  }
  function invalidate() {
    busy = false;
    preview = null;
    stop();
    version++;
  }
  const payload = () => ({
    kind,
    userId: customer.id,
    orderId: order.id,
    units: [...selected.values()].map((u) => ({
      itemId: u.itemId,
      ordinal: u.ordinal,
      version: u.version,
      ...(kind === "EXCHANGE"
        ? { incomingCode: u.incomingCode, outgoingCode: u.outgoingCode }
        : {}),
    })),
    restock: condition,
    reason,
    paymentMethod: kind === "RETURN" ? method : undefined,
    externalReference: reference || undefined,
  });
  function updateLock() {
    ui.work
      .querySelectorAll("button,input,select,textarea")
      .forEach(
        (el) =>
          (el.disabled =
            el.dataset.asDisabled === "true" ||
            busy ||
            !!attempt ||
            (!!result && el.dataset.as !== "reload")),
      );
    ui.receipt
      .querySelectorAll("[data-as=confirm]")
      .forEach(
        (el) =>
          (el.disabled =
            busy ||
            !!attempt ||
            !preview ||
            (kind === "RETURN" && !externalDone) ||
            (!condition && kind === "EXCHANGE")),
      );
    ui.receipt
      .querySelectorAll("[data-as=recover],[data-as=retry]")
      .forEach((el) => (el.disabled = busy));
    window.CRONOX_REGISTER?.syncReset();
  }
  async function task(fn) {
    const active = version;
    busy = true;
    updateLock();
    try {
      await fn(() => active === version);
    } catch (e) {
      if (active === version) notice(e.message, true);
    } finally {
      if (active === version) {
        busy = false;
        updateLock();
      }
    }
  }
  async function loadHistory() {
    invalidate();
    ui.work.innerHTML =
      heading() + btn("refresh-history", "Reintentar carga de compras");
    notice("Consultando compras…");
    await task(async (current) => {
      const data = await ui.api(
        `after-sales/orders?userId=${customer.id}&page=${page}`,
      );
      if (!current()) return;
      orders = data.items;
      more = data.more;
      renderHistory();
      notice();
    });
  }
  function heading() {
    return `<h3>${kind === "RETURN" ? "Devolución" : "Cambio de talla"}</h3><p><strong>${esc(customer?.name || "Cliente")}</strong> · ${esc(customer?.email || "")}</p><p data-as-status role="status" aria-live="polite"></p>`;
  }
  function renderHistory() {
    ui.work.innerHTML =
      heading() +
      orders
        .map((o) =>
          btn(
            "order",
            `<small>${esc(new Date(o.purchasedAt || o.createdAt).toLocaleDateString("es-ES"))}</small><span><strong>Pedido #${o.id}</strong><small>${o.source === "ONLINE" ? "Online" : "Físico"} · ${esc(o.status)} · ${money(Math.round(Number(o.total) * 100))}</small></span>`,
            `class="register-history-card" data-id="${o.id}"`,
          ),
        )
        .join("") +
      (orders.length ? "" : "<p>No hay compras asociadas a esta cuenta.</p>") +
      btn(
        "prev",
        "Anterior",
        page > 1 ? "" : 'disabled data-as-disabled="true"',
      ) +
      btn("next", "Siguiente", more ? "" : 'disabled data-as-disabled="true"');
    ui.receipt.hidden = false;
    ui.receipt.innerHTML =
      "<h3>Selecciona una compra</h3><p>La cuenta debe ser la titular de la compra.</p>";
  }
  async function openOrder(id) {
    invalidate();
    selected.clear();
    preview = null;
    condition = false;
    reason = method = reference = "";
    externalDone = false;
    await task(async (current) => {
      const detail = await ui.api(
        `after-sales/orders/${id}?userId=${customer.id}`,
      );
      if (!current()) return;
      order = detail;
      renderOrder();
      notice();
    });
  }
  function historyMarkup() {
    return `<h4>Historial</h4>${order.history.map((op) => `<article><strong>${op.kind === "RETURN" ? "Devolución" : "Cambio de talla"}</strong> · ${esc(new Date(op.occurredAt).toLocaleString("es-ES"))}<p>${op.kind === "RETURN" ? money(op.refundCents) : ""}</p>${op.units.map((u) => `<p>${esc(u.name)} · ${op.kind === "RETURN" ? `Devuelta 1 unidad de talla ${esc(u.fromSize || u.originalSize || "sin datos")}` : `Cambio de talla: ${esc(u.fromSize)} → ${esc(u.toSize)}`} · ${money(u.valueCents)}</p>`).join("")}</article>`).join("") || "<p>Sin operaciones posteriores.</p>"}`;
  }
  function renderOrder() {
    ui.work.innerHTML =
      heading() +
      btn("history", "← Compras") +
      `<h3>Pedido #${order.id}</h3><p>${order.source === "ONLINE" ? "Online" : "Físico"} · ${esc(order.status)}</p><div class="register-after-units">${order.units
        .map((u) => {
          const image = window.CRONOX_SECURITY.productImageUrl(u.image);
          return `<label class="register-after-unit">${image ? `<img alt="" src="${esc(image)}">` : ""}<input type="checkbox" data-as-unit="${u.id}" ${selected.has(u.id) ? "checked" : ""} ${!u.eligible || u.state !== "HELD" ? 'disabled data-as-disabled="true"' : ""}><span><strong>${esc(u.name)}</strong><small>${esc(u.color || "—")} · Talla ${esc(u.size)} · Unidad ${u.ordinal + 1} de ${u.purchasedQuantity} · ${money(u.valueCents)}</small><small>Lote ${esc(u.lotName || "sin evidencia")} · ${u.state === "RETURNED" ? "Devuelta" : "Conservada"}</small>${u.originalSize !== u.size ? `<small>Originalmente talla ${esc(u.originalSize)}</small>` : ""}${u.limitation ? `<small>${esc(u.limitation)}</small>` : ""}</span></label>`;
        })
        .join("")}</div>${historyMarkup()}`;
    ticket();
  }
  function ticket() {
    ui.receipt.hidden = false;
    const shortcut = document.querySelector(
      "#section-register [data-act=ticket]",
    );
    shortcut.hidden = false;
    shortcut.textContent = "Ver resumen";
    const units = [...selected.values()];
    const complete =
      kind === "RETURN" || units.every((u) => u.incomingCode && u.outgoingCode);
    ui.receipt.innerHTML = `<h3>${kind === "RETURN" ? "Devolución" : "Cola de cambios"}</h3><p>Pedido #${order.id} · ${esc(customer.name)}</p>${units.map((u, i) => `<article class="register-line"><div><strong>${esc(u.name)}</strong><small>${kind === "EXCHANGE" ? `Talla ${esc(u.size)} → ${esc(u.targetSize || "pendiente")}` : `Talla ${esc(u.size)}`} · Lote ${esc(u.lotName || u.lotId)}</small><small>${money(u.valueCents)}</small>${kind === "EXCHANGE" ? btn("scan", u.outgoingCode ? "Repetir pareja" : u.incomingCode ? "Escanear talla que se lleva" : "Escanear talla entregada", `data-unit="${esc(u.id)}"`) : ""}</div></article>`).join("")}
     ${kind === "RETURN" ? `<footer><span>Importe de artículos</span><strong>${money(units.reduce((n, u) => n + u.valueCents, 0))}</strong></footer>` : "<p>El cambio conserva el importe pagado.</p>"}
     ${
       units.length && complete
         ? `<div class="register-condition"><label><input type="checkbox" data-as-field="condition" ${condition ? "checked" : ""}>¿Este cliente traía la prenda en buen estado y con la etiqueta puesta?</label><small>Marcarla confirma que todas las unidades seleccionadas pueden volver al stock. Procesa las condiciones diferentes por separado.</small></div>
      ${!condition && kind === "RETURN" ? `<label>Motivo y disposición de prendas no vendibles<textarea maxlength="500" data-as-field="reason">${esc(reason)}</textarea></label>` : ""}
      ${
        kind === "RETURN"
          ? `<label>Método del reintegro<select data-as-field="method"><option value="">Seleccionar</option>${[
              ["EXTERNAL_STRIPE", "Tarjeta · Stripe externo"],
              ["BIZUM", "Bizum"],
              ["CASH", "Efectivo"],
            ]
              .map(
                ([v, label]) =>
                  `<option value="${v}" ${method === v ? "selected" : ""}>${label}</option>`,
              )
              .join(
                "",
              )}</select></label><label>Referencia real del reintegro externo${order.source === "ONLINE" ? " (Stripe re_… cuando corresponda)" : ""}<input maxlength="120" data-as-field="reference" value="${esc(reference)}"></label><label><input type="checkbox" data-as-field="externalDone" ${externalDone ? "checked" : ""}>Confirmo que el reintegro externo ya se ha realizado</label>`
          : ""
      }
      ${btn("preview", "Revisar operación")}<p data-as-preview>${preview ? `Resumen validado · ${kind === "RETURN" ? money(preview.refundCents) : units.length + " cambios de talla"}` : "Revisa las condiciones y el resumen antes de confirmar."}</p>${btn("confirm", kind === "RETURN" ? "DEVOLVER" : "CAMBIAR", preview ? "" : "disabled")}`
         : ""
     }
     <p data-as-error role="status" aria-live="polite"></p>${attempt ? btn("recover", "Recuperar operación") + btn("retry", "Reintentar con la misma clave") : ""}`;
    updateLock();
  }
  function startReader(id) {
    invalidate();
    condition = false;
    const unit = selected.get(id);
    if (unit.outgoingCode) {
      unit.incomingCode = null;
      unit.outgoingCode = null;
      unit.targetSize = null;
    }
    reader = { id, direction: unit.incomingCode ? "OUT" : "IN" };
    ui.work.innerHTML =
      heading() +
      btn("back-order", "← Volver al pedido", `data-id="${order.id}"`) +
      `<h3>${reader.direction === "IN" ? "1. Prenda que entrega el cliente" : "2. Prenda que se lleva"}</h3><p>${esc(unit.name)} · Talla ${esc(unit.size)} · Lote ${esc(unit.lotName || unit.lotId)}</p><form data-as-form="scan"><label>Código de barras<input name="code" maxlength="13" autocomplete="off" required></label><button>Comprobar</button></form>${btn("camera", "Abrir cámara")}<div data-as-camera hidden><video muted playsinline></video><label>Cámara<select data-as-device></select></label>${btn("close-camera", "Cerrar cámara")}</div>`;
    ui.work.querySelector("[name=code]").focus();
  }
  async function readCode(value) {
    if (busy || !reader || attempt) return;
    const scan = { ...reader };
    stop();
    reader = scan;
    await task(async (current) => {
      const unit = selected.get(scan.id),
        data = await ui.api("after-sales/scan", {
          userId: customer.id,
          orderId: order.id,
          itemId: unit.itemId,
          ordinal: unit.ordinal,
          version: unit.version,
          direction: scan.direction,
          code: value,
        });
      if (!current()) return;
      if (scan.direction === "IN") {
        unit.incomingCode = value;
        startReader(unit.id);
      } else {
        unit.outgoingCode = value;
        unit.targetSize = data.size;
        renderOrder();
        notice(
          "Pareja verificada. Confirma el estado y revisa el resumen para completar el cambio.",
        );
      }
    });
  }
  function camera(deviceId) {
    const panel = ui.work.querySelector("[data-as-camera]");
    panel.hidden = false;
    window.CRONOX_REGISTER_CAMERA.start({
      video: panel.querySelector("video"),
      devices: panel.querySelector("select"),
      deviceId,
      format: "code_128",
      onRead: readCode,
      onError: (message) => notice(message, true),
    });
  }
  async function review() {
    if (!selected.size) return;
    if (kind === "EXCHANGE" && !condition) {
      notice("Confirma el buen estado y la etiqueta antes del cambio.", true);
      return;
    }
    if (kind === "RETURN" && (!method || (!condition && !reason.trim()))) {
      notice(
        "Selecciona el método y completa el estado o motivo de las prendas.",
        true,
      );
      return;
    }
    await task(async (current) => {
      const data = await ui.api("after-sales/preview", payload());
      if (!current()) return;
      preview = data;
      ticket();
      notice(
        "Resumen validado. Revisa las unidades y el importe antes de confirmar.",
      );
    });
  }
  function recorded(receipt) {
    if (
      !receipt ||
      !["RETURN", "EXCHANGE"].includes(receipt.kind) ||
      !Number.isInteger(receipt.orderId) ||
      !Number.isSafeInteger(receipt.refundCents) ||
      !Array.isArray(receipt.units) ||
      !receipt.units.length ||
      (attempt && receipt.key !== attempt.key)
    )
      throw Error(
        "El servidor no devolvió una confirmación válida. Recupera el resultado de la operación.",
      );
    result = receipt;
    attempt = null;
    busy = false;
    stop();
    try {
      sessionStorage.removeItem(storage);
    } catch {}
    ui.work.innerHTML =
      heading() +
      `<p>Pedido #${receipt.orderId}</p>${btn("reload", "Ver compra actualizada")}`;
    const shortcut = document.querySelector(
      "#section-register [data-act=ticket]",
    );
    shortcut.hidden = false;
    shortcut.textContent = "Ver resultado";
    ui.receipt.hidden = false;
    ui.receipt.innerHTML = `<h3>${receipt.kind === "RETURN" ? "DEVOLUCIÓN REGISTRADA" : "CAMBIO REGISTRADO"}</h3><p>Pedido #${receipt.orderId} · ${esc(new Date(receipt.occurredAt).toLocaleString("es-ES"))}</p>${receipt.units.map((u) => `<p><strong>${esc(u.name)}</strong> · ${receipt.kind === "RETURN" ? `Devuelta 1 unidad de talla ${esc(u.fromSize || u.originalSize || "sin datos")}` : `${esc(u.fromSize)} → ${esc(u.toSize)}`} · ${money(u.valueCents)}</p>`).join("")}<footer><strong>${money(receipt.refundCents)}</strong></footer><p>${receipt.restock ? "Unidades reincorporadas a su lote." : "Prendas registradas como no vendibles."}</p>`;
    ui.receipt.insertAdjacentHTML(
      "beforeend",
      receipt.kind === "RETURN"
        ? "<p>Reintegro externo confirmado manualmente · " +
            esc(
              {
                CASH: "Efectivo",
                BIZUM: "Bizum",
                EXTERNAL_STRIPE: "Tarjeta · Stripe",
              }[receipt.paymentMethod] || receipt.paymentMethod,
            ) +
            "</p>"
        : "<p>Sin movimiento de dinero.</p>",
    );
    notice(
      receipt.kind === "RETURN" ? "DEVOLUCIÓN REGISTRADA" : "CAMBIO REGISTRADO",
    );
    updateLock();
  }
  async function confirm(recover = false) {
    if (busy || result) return;
    if (!attempt) {
      if (!preview) return;
      attempt = {
        ...payload(),
        key: crypto.randomUUID(),
        revision: preview.revision,
        externalDone: kind === "RETURN" ? externalDone : false,
      };
    }
    busy = true;
    stop();
    updateLock();
    try {
      sessionStorage.setItem(storage, JSON.stringify(attempt));
    } catch {}
    notice(recover ? "Recuperando operación…" : "Registrando operación…");
    try {
      recorded(
        await ui.api(
          recover
            ? "after-sales/operations/" + attempt.key
            : "after-sales/confirm",
          recover ? undefined : attempt,
        ),
      );
    } catch (e) {
      busy = false;
      if (!recover && [400, 403, 409, 422].includes(e.status)) {
        attempt = null;
        preview = null;
        try {
          sessionStorage.removeItem(storage);
        } catch {}
      }
      if (order) ticket();
      else pendingView();
      notice(
        (attempt
          ? "Resultado incierto. Recupera o reintenta la misma operación. "
          : "") + e.message,
        true,
      );
      updateLock();
    }
  }
  function pendingView() {
    ui.work.innerHTML = "<h3>Recuperar operación pendiente</h3>";
    ui.receipt.hidden = false;
    ui.receipt.innerHTML =
      "<p>Conserva esta operación hasta confirmar su resultado.</p>" +
      btn("recover", "Recuperar operación") +
      btn("retry", "Reintentar con la misma clave");
    updateLock();
  }
  document.addEventListener("click", (e) => {
    if (!ui) return;
    const b = e.target.closest("[data-as]");
    if (!b || b.disabled) return;
    const action = b.dataset.as;
    if (action === "recover") {
      confirm(true);
      return;
    }
    if (action === "retry") {
      confirm();
      return;
    }
    if (busy || attempt) return;
    if (action === "order") openOrder(Number(b.dataset.id));
    if (action === "back-order") {
      stop();
      renderOrder();
    }
    if (action === "history") {
      selected.clear();
      page = 1;
      loadHistory();
    }
    if (action === "refresh-history") loadHistory();
    if (action === "prev" || action === "next") {
      page += action === "next" ? 1 : -1;
      loadHistory();
    }
    if (action === "scan") startReader(b.dataset.unit);
    if (action === "camera") camera();
    if (action === "close-camera") {
      stop();
      const p = ui.work.querySelector("[data-as-camera]");
      if (p) p.hidden = true;
    }
    if (action === "preview") review();
    if (action === "confirm") confirm();
    if (action === "reload") {
      const id = order?.id ?? Number(result?.orderId);
      result = null;
      openOrder(id);
    }
  });
  document.addEventListener("change", (e) => {
    if (!ui || busy || attempt) return;
    const id = e.target.dataset.asUnit;
    if (id) {
      invalidate();
      condition = false;
      externalDone = false;
      const unit = order.units.find((u) => u.id === id);
      if (e.target.checked) selected.set(id, { ...unit });
      else selected.delete(id);
      ticket();
    }
    const field = e.target.dataset.asField;
    if (field) {
      if (field !== "externalDone") preview = null;
      const val =
        e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (field === "condition") condition = val;
      if (field === "reason") reason = val;
      if (field === "method") method = val;
      if (field === "reference") reference = val;
      if (field === "externalDone") externalDone = val;
      if (field === "condition") ticket();
      else {
        updateLock();
        const msg = ui.receipt.querySelector("[data-as-preview]");
        if (msg && field !== "externalDone")
          msg.textContent = "Revisa el resumen antes de confirmar.";
      }
    }
    if (e.target.matches("[data-as-device]")) camera(e.target.value);
  });
  document.addEventListener("submit", (e) => {
    if (e.target.dataset.asForm === "scan") {
      e.preventDefault();
      readCode(new FormData(e.target).get("code"));
    }
  });
  window.CRONOX_AFTER_SALES = {
    open(context) {
      ui = context;
      const shortcut = document.querySelector(
        "#section-register [data-act=ticket]",
      );
      shortcut.hidden = true;
      if (attempt) {
        customer = {
          id: attempt.userId,
          name: "Cliente de la operación pendiente",
        };
        kind = attempt.kind;
        pendingView();
        return;
      }
      if (context.customer) {
        customer = context.customer;
        kind = context.kind;
        order = null;
        selected.clear();
        result = null;
        page = 1;
        loadHistory();
      } else if (result) recorded(result);
      else if (order) renderOrder();
      else if (customer) loadHistory();
    },
    leave() {
      version++;
      busy = false;
      stop();
    },
    reset() {
      version++;
      busy = false;
      stop();
      customer = order = result = null;
      selected.clear();
      preview = null;
      orders = [];
      page = 1;
      more = condition = externalDone = false;
      reason = method = reference = "";
    },
    canLeave() {
      return !attempt;
    },
    status() {
      return { kind, completed: !!result, locked: !!attempt };
    },
    hasPending() {
      return !!attempt;
    },
  };
})();
