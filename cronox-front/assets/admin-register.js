(() => {
  "use strict";
  const root = document.querySelector("#section-register");
  const work = root.querySelector("#register-work"),
    receipt = root.querySelector("#register-ticket");
  const feedback = root.querySelector("#register-feedback");
  const money = (cents) =>
    (cents / 100).toLocaleString("es-ES", {
      style: "currency",
      currency: "EUR",
    });
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
  const button = (act, title, attrs = "") =>
    `<button type="button" data-act="${act}" ${attrs}>${title}</button>`;
  const symbols = {
    purchase: "M4 7h16v14H4z M8 8V6a4 4 0 0 1 8 0v2",
    refund: "M9 4 4 9l5 5 M5 9h9a6 6 0 0 1 0 12",
    exchange: "M3 7h17l-4-4 M21 17H4l4 4",
    event: "M3 9l2-5h14l2 5 M4 9v11h16V9 M9 20v-7h6v7",
    "no-event": "M3 5h18v13H3z M7 21h10 M12 18v3",
    credential: "M3 4h18v16H3z M7 10h4v4H7z M14 9h4 M14 13h4",
    guest: "M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 21a8 8 0 0 1 16 0",
  };
  const tile = (act, title, detail, disabled = false) =>
    button(
      act,
      `<svg aria-hidden="true" viewBox="0 0 24 24" class="register-symbol"><path d="${symbols[act]}"/></svg><strong>${title}</strong><small>${detail}</small>`,
      disabled ? 'class="register-tile" disabled' : 'class="register-tile"',
    );
  const img = (url) => {
    const src = window.CRONOX_SECURITY.productImageUrl(url);
    return src ? `<img alt="" loading="lazy" src="${esc(src)}">` : "";
  };
  const empty = () => ({
    items: [],
    units: 0,
    totalCents: 0,
    point: null,
    customer: null,
  });
  let step = "entry",
    mode = "scan",
    ticket = empty(),
    hasContext = false,
    identified = false;
  let operation = "PURCHASE";
  const requests = new Set();
  let refreshTimer;
  const cancelDialog = root.querySelector("[data-cancel-dialog]");
  let cancelOpener;
  function syncReset() {
    const after = step === "after-sales" ? window.CRONOX_AFTER_SALES.status() : {};
    const completed = !!sale || after.completed;
    const reset = root.querySelector("[data-act=reset]");
    const label = { PURCHASE: "compra", RETURN: "devolución", EXCHANGE: "cambio" }[after.kind || operation];
    reset.hidden = step === "entry";
    reset.disabled = recording || uncertain || !!attempt || !!after.locked;
    reset.textContent = completed ? "Volver al inicio" : "Cancelar " + label;
    cancelDialog.querySelector("h3").textContent = "¿Cancelar " + label + "?";
  }
  function abortPreparation() {
    requests.forEach((controller) => controller.abort());
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
  function resetPreparation() {
    if (recording || uncertain || attempt || !window.CRONOX_AFTER_SALES.canLeave()) return;
    abortPreparation();
    window.CRONOX_AFTER_SALES.reset();
    operation = "PURCHASE";
    paymentMethod = "";
    sale = attempt = null;
    validationError = false;
    ticket = empty();
    hasContext = identified = false;
    mode = "scan";
    query = "";
    offset = 0;
    products = points = [];
    more = false;
    go("entry");
  }
  cancelDialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-cancel-keep]")) cancelDialog.close();
    if (event.target.closest("[data-cancel-confirm]")) {
      if (recording || uncertain || attempt || !window.CRONOX_AFTER_SALES.canLeave()) return;
      cancelDialog.close();
      resetPreparation();
    }
  });
  cancelDialog.addEventListener("close", () => {
    if (cancelOpener?.isConnected && !cancelOpener.hidden && !root.hidden) cancelOpener.focus();
  });
  let paymentMethod = "",
    sale = null,
    attempt = null,
    recording = false,
    uncertain = false,
    validationError = false,
    validations = 0;
  let epoch = 0,
    pending = Promise.resolve(),
    points = [],
    identifying = false,
    products = [],
    choices = [];
  let query = "",
    offset = 0,
    more = false,
    searchVersion = 0,
    audio;
  function notice(message = "", error = false) {
    feedback.textContent = message;
    feedback.classList.toggle("register-error", error);
    const local = work.querySelector("[data-identification-status]");
    if (local) local.textContent = message;
  }
  async function api(path, body) {
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
    const headers = body
      ? {
          "Content-Type": "application/json",
          ...(await window.CRONOX_API.getCsrfHeaders()),
        }
      : {};
    const r = await fetch(
      (window.CRONOX_API?.API_BASE || "") + "/api/admin/register/" + path,
      {
        method: body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      },
    );
    const result = await r.json().catch(() => null);
    if (!r.ok || result == null)
      throw Object.assign(
        Error(
          []
            .concat(
              result?.message || "No se pudo consultar la caja. Reintenta.",
            )
            .join(" "),
        ),
        { status: r.status, code: result?.code },
      );
    return result;
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
    }
  }
  function invalidate() {
    epoch++;
    searchVersion++;
    pending = Promise.resolve();
    choices = [];
    identifying = false;
    window.CRONOX_REGISTER_CAMERA.stop();
  }
  function run(task, loading) {
    const version = epoch;
    validations++;
    syncPaid();
    const current = () => version === epoch && !root.hidden;
    pending = pending.then(async () => {
      if (!current()) {
        validations--;
        syncPaid();
        return;
      }
      notice(loading);
      try {
        await task(current);
      } catch (e) {
        if (current()) {
          validationError = true;
          notice(e.message, true);
        }
      } finally {
        validations--;
        syncPaid();
      }
    });
    return pending;
  }
  function go(next) {
    invalidate();
    step = next;
    notice();
    render();
    if (step === "items" && !refreshTimer) refreshTimer = setInterval(refreshPrices, 10000);
    work.querySelector("h3")?.focus();
    if (step === "points") listPoints();
    if (step === "items" && mode === "manual") listProducts();
    if (step === "credential" || (step === "items" && mode === "scan"))
      work.querySelector("[name=code]")?.focus();
  }
  const pendingStorage = "cronox.register.pending";
  try {
    const saved = sessionStorage.getItem(pendingStorage);
    if (saved) {
      attempt = JSON.parse(saved);
      uncertain = true;
      step = "items";
    }
  } catch {
    /* Recovery stays available in this tab when storage is unavailable. */
  }
  const paymentLabels = {
    EXTERNAL_STRIPE: "TARJETA · STRIPE",
    BIZUM: "BIZUM",
    CASH: "EFECTIVO",
  };
  function syncPaid() {
    syncReset();
    if (step === "after-sales") return;
    const paid = receipt.querySelector("[data-act=paid]");
    if (paid)
      paid.disabled = !!(
        sale ||
        recording ||
        uncertain ||
        validations ||
        validationError ||
        !paymentMethod ||
        !ticket.items.length ||
        !ticket.revision ||
        !identified ||
        !hasContext ||
        step !== "items"
      );
    const locked = recording || uncertain;
    work.querySelectorAll("button,input,select,summary").forEach((el) => {
      if (locked) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
    receipt.querySelectorAll("button,input").forEach((el) => {
      if (el.dataset.act === "paid") return;
      el.disabled =
        locked && !["recover-sale", "retry-sale"].includes(el.dataset.act);
    });
  }
  function showRecorded(result) {
    try {
      sessionStorage.removeItem(pendingStorage);
    } catch {}
    sale = result;
    ticket = result;
    hasContext = identified = true;
    recording = false;
    uncertain = false;
    attempt = null;
    invalidate();
    step = "recorded";
    work.innerHTML =
      "<h3>VENTA REGISTRADA</h3><p>La compra ha quedado registrada y entregada.</p>";
    drawTicket();
    notice("VENTA REGISTRADA · Pedido #" + result.orderId);
  }
  async function registerSale(recover = false) {
    if (recording || sale) return;
    if (!attempt) {
      if (
        !paymentMethod ||
        validations ||
        validationError ||
        !ticket.items.length
      )
        return;
      attempt = {
        key: crypto.randomUUID(),
        revision: ticket.revision,
        paymentMethod,
        items: itemInputs(),
        pointId: ticket.point?.id ?? null,
        userId: ticket.customer?.id ?? null,
      };
    }
    try {
      sessionStorage.setItem(pendingStorage, JSON.stringify(attempt));
    } catch {}
    recording = true;
    uncertain = true;
    invalidate();
    syncPaid();
    notice(recover ? "Recuperando resultado…" : "Registrando venta…");
    try {
      showRecorded(
        await api(
          recover ? "sales/" + attempt.key : "sales",
          recover ? undefined : attempt,
        ),
      );
    } catch (e) {
      recording = false;
      if (
        !recover &&
        e.code !== "REGISTER_KEY_REUSED" &&
        [400, 401, 403, 409, 422].includes(e.status)
      ) {
        try {
          sessionStorage.removeItem(pendingStorage);
        } catch {}
        uncertain = false;
        attempt = null;
        validationError = true;
        drawTicket();
      } else {
        drawTicket();
      }
      const message = uncertain
        ? "Resultado pendiente de confirmar. Recupera el resultado o reintenta con la misma operación. " +
          e.message
        : e.message;
      receipt.querySelector("[data-payment-error]").textContent = message;
      notice(message, true);
      syncPaid();
    }
  }
  function drawTicket() {
    receipt.hidden = step === "entry" && !ticket.units;
    const shortcut = root.querySelector("[data-act=ticket]");
    shortcut.hidden = receipt.hidden;
    shortcut.textContent = "Ver ticket · " + money(ticket.totalCents);
    receipt.innerHTML = `${sale ? `<h3>VENTA REGISTRADA</h3><p>Pedido #${sale.orderId} · ${esc(paymentLabels[sale.paymentMethod])}</p>` : ""}<header><small>COMPRA</small><h3>Ticket</h3></header>
      <p>${hasContext ? esc(ticket.point?.name || "Sin evento") : "Contexto pendiente"} · ${identified ? esc(ticket.customer ? ticket.customer.name + " · " + ticket.customer.email : "Invitado") : "Cliente pendiente"}</p>
      ${
        ticket.items.length
          ? ticket.items
              .map(
                (
                  l,
                  i,
                ) => `<article class="register-line">${img(l.image)}<div><strong>${esc(l.name)}</strong><small>${esc(l.color || "—")} · ${esc(l.size)}${l.lotName ? " · " + esc(l.lotName) : ""}</small><small>${l.previousPriceCents ? `<del>${money(l.previousPriceCents)}</del> ` : ""}${money(l.unitPriceCents)} / ud.</small>
      ${sale ? `<small>${l.quantity} uds.</small>` : `<div class="register-counter">${button("minus", "−", `aria-label="Reducir cantidad" data-i="${i}"`)}<b>${l.quantity}</b>${button("plus", "+", `aria-label="Aumentar cantidad" data-i="${i}"`)}${button("remove", "Quitar", `data-i="${i}"`)}</div>`}</div><b>${money(l.subtotalCents)}</b></article>`,
              )
              .join("")
          : "<p>Aún no hay artículos.</p>"
      }
      <footer><span>${ticket.units} uds. · Total</span><strong>${money(ticket.totalCents)}</strong></footer>
      ${
        sale
          ? ""
          : `<fieldset data-payments><legend>Pago recibido</legend>${Object.entries(
              paymentLabels,
            )
              .map(
                ([value, label]) =>
                  `<label><input type="radio" name="register-payment" value="${value}" ${paymentMethod === value ? "checked" : ""}>${label}</label>`,
              )
              .join("")}</fieldset>
      ${button("paid", "PAGADO")}<small>Confirma únicamente cuando hayas recibido el pago</small>
      <p data-payment-error role="status" aria-live="polite"></p>
      ${attempt ? button("recover-sale", "Recuperar resultado") + button("retry-sale", "Reintentar registro") : ""}
      ${validationError ? button("validate-ticket", "Revisar ticket") : ""}`
      }`;
    syncPaid();
  }
  const scanForm = (
    credential,
  ) => `<form data-form="code"><label>${credential ? "Acreditación o correo electrónico" : "Código de la prenda"}<input name="code" ${credential ? 'placeholder="Escanea la acreditación o escribe el email" aria-describedby="register-identification-status"' : ""} maxlength="${credential ? 512 : 13}" required autocomplete="off" spellcheck="false"></label><button>${credential ? "Identificar" : "Añadir"}</button></form>
    ${button("camera", "Abrir cámara")}<div data-camera hidden><video muted playsinline></video><label>Cámara<select data-devices></select></label>${button("close-camera", "Cerrar lector")}</div><div data-choice></div>${credential ? '<p id="register-identification-status" data-identification-status role="status" aria-live="polite"></p>' : ""}`;
  function render() {
    const titles = {
      entry: "Operación",
      context: "¿Dónde se realiza la compra?",
      points: "Punto de venta",
      client: "Cliente",
      credential: "Escanear acreditación",
      items: "Artículos",
    };
    let content = "";
    if (step === "entry")
      content =
        tile("purchase", "COMPRA", "Preparar un ticket") +
        tile("refund", "DEVOLUCIÓN", "Devolver artículos") +
        tile("exchange", "CAMBIO", "Cambiar de talla");
    if (step === "context")
      content =
        tile("event", "EN EVENTO", "Elegir punto de venta") +
        tile("no-event", "SIN EVENTO", "Venta directa");
    if (step === "points")
      content =
        "<div data-points></div>" + button("points", "Actualizar puntos");
    if (step === "client")
      content =
        tile("credential", "ESCANEAR ACREDITACIÓN", "Identificar cliente") +
        tile("guest", "COMPRA INVITADO", "Continuar sin cuenta");
    if (step === "credential") content = scanForm(true);
    if (step === "items")
      content =
        `<div class="register-tabs">${button("scan", "Escanear", `aria-pressed="${mode === "scan"}"`)}${button("manual", "Selección manual", `aria-pressed="${mode === "manual"}"`)}</div>` +
        (mode === "scan"
          ? scanForm(false)
          : `<form data-form="search"><label>Nombre o referencia<input name="q" maxlength="120" value="${esc(query)}"></label><button>Buscar</button></form><div data-products></div>`);
    work.innerHTML =
      (step === "entry" ? "" : button("back", "← Atrás")) +
      `<h3 tabindex="-1">${titles[step]}</h3>` +
      content;
    drawTicket();
  }
  function listPoints() {
    run(async (current) => {
      const rows = await api("points");
      if (!current()) return;
      points = rows;
      work.querySelector("[data-points]").innerHTML =
        rows
          .map((p, i) =>
            button(
              "point",
              `<strong>${esc(p.name)}</strong><small>${esc([p.venue, p.city, p.startsOn].filter(Boolean).join(" · "))}</small>`,
              `class="register-tile" data-i="${i}"`,
            ),
          )
          .join("") || "<p>No hay puntos activos.</p>";
      notice();
    }, "Consultando puntos…");
  }
  async function listProducts() {
    const version = ++searchVersion,
      active = epoch;
    notice("Consultando catálogo…");
    try {
      const data = await api(
        "catalog?q=" + encodeURIComponent(query) + "&offset=" + offset,
      );
      if (active !== epoch || version !== searchVersion) return;
      products = data.products;
      more = data.more;
      work.querySelector("[data-products]").innerHTML =
        products
          .map(
            (
              p,
              i,
            ) => `<details><summary>${img(p.image)}<span><strong>${esc(p.modelName)}</strong><small>${esc(p.color || "—")}</small></span></summary>
        ${
          p.options.length
            ? `<form data-form="product" data-i="${i}"><label>Talla y tirada<select name="option">${p.options.map((o, j) => `<option value="${j}" ${o.stock ? "" : "disabled"}>${esc(o.size)}${o.lotName ? " · " + esc(o.lotName) : ""} · ${o.stock} uds. · ${money(o.unitPriceCents)}</option>`).join("")}</select></label>
        <label>Unidades<input type="number" name="qty" min="1" max="999" value="1" required></label><button ${p.options.some((o) => o.stock > 0) ? "" : "disabled"}>Añadir</button></form>`
            : "<p>No disponible para vender.</p>"
        }</details>`,
          )
          .join("") || "<p>Sin resultados.</p>";
      work
        .querySelector("[data-products]")
        .insertAdjacentHTML(
          "beforeend",
          button("prev", "Anterior", offset ? "" : "disabled") +
            button("next", "Siguiente", more ? "" : "disabled"),
        );
      notice();
    } catch (e) {
      if (active === epoch && version === searchVersion)
        notice(e.message, true);
    }
  }
  const itemInputs = () =>
    ticket.items.map(({ variantId, lotId, quantity }) => ({
      variantId,
      lotId,
      quantity,
    }));
  function quote(
    items,
    pointId = ticket.point?.id,
    userId = ticket.customer?.id,
  ) {
    return api("quote", {
      items,
      pointId: pointId ?? null,
      userId: userId ?? null,
    });
  }
  function changedPrices(next) {
    return next.items
      .filter((l) =>
        ticket.items.some(
          (o) =>
            o.variantId === l.variantId &&
            o.lotId === l.lotId &&
            (o.unitPriceCents !== l.unitPriceCents ||
              o.previousPriceCents !== l.previousPriceCents),
        ),
      )
      .map((l) => l.name + " · " + money(l.unitPriceCents))
      .join(", ");
  }
  function context(point) {
    run(async (current) => {
      const next = await quote(itemInputs(), point?.id ?? null);
      if (!current()) return;
      validationError = false;
      const changes = changedPrices(next);
      ticket = next;
      hasContext = true;
      go("client");
      if (changes) notice("Precios actualizados: " + changes);
    }, "Validando punto y disponibilidad…");
  }
  function client(customer) {
    run(async (current) => {
      const next = await quote(
        itemInputs(),
        ticket.point?.id,
        customer?.id ?? null,
      );
      if (!current()) return;
      validationError = false;
      const changes = changedPrices(next);
      ticket = next;
      identified = true;
      go("items");
      if (changes) notice("Precios actualizados: " + changes);
    }, "Validando ticket…");
  }
  async function update(items, current, message) {
    const next = await quote(items);
    if (!current()) return false;
    const changes = changedPrices(next);
    ticket = next;
    validationError = false;
    drawTicket();
    notice(changes ? "Precios actualizados: " + changes : message);
    return true;
  }
  async function add(o, quantity, current) {
    const items = itemInputs(),
      line = items.find(
        (l) => l.variantId === o.variantId && l.lotId === o.lotId,
      );
    if (line) line.quantity += quantity;
    else items.push({ variantId: o.variantId, lotId: o.lotId, quantity });
    return update(items, current, `${o.name} · ${o.size} añadido al ticket.`);
  }
  function beep() {
    if (audio?.state !== "running") return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.065);
  }
  function read(value) {
    if (step === "credential" && identifying) return;
    const credential = step === "credential";
    const version = epoch;
    if (credential) identifying = true;
    return run(
      async (current) => {
        const target = work.querySelector("[data-choice]");
        if (step === "credential") {
          const found = await api("customer", { content: value });
          if (!current()) return;
          if (operation !== "PURCHASE") {
            closeCamera();
            invalidate();
            step = "after-sales";
            window.CRONOX_AFTER_SALES.open({
              customer: found,
              kind: operation,
              api,
              work,
              receipt,
              notice,
            });
            return;
          }
          const next = await quote(itemInputs(), ticket.point?.id, found.id);
          if (!current()) return;
          const changes = changedPrices(next);
          ticket = next;
          identified = true;
          closeCamera();
          go("items");
          if (changes) notice("Precios actualizados: " + changes);
          return;
        }
        if (choices.length)
          throw Error("Elige o cancela primero la tirada pendiente.");
        if (!/^CR[XL][0-9]{10}$/.test(value))
          throw Error("Código de prenda no válido.");
        const opts = await api("barcode", { code: value });
        if (!current()) return;
        if (opts.length === 1) {
          if (await add(opts[0], 1, current)) beep();
          return;
        }
        closeCamera();
        choices = opts;
        target.innerHTML =
          opts
            .map((o, i) =>
              button(
                "lot",
                `${esc(o.lotName)} · ${o.stock} uds. · ${money(o.unitPriceCents)}`,
                `data-i="${i}"`,
              ),
            )
            .join("") + button("cancel-lot", "Cancelar");
        notice("Selecciona la tirada de esta prenda.");
      },
      credential ? "Identificando…" : "Leyendo código…",
    ).finally(() => {
      if (version === epoch) identifying = false;
    });
  }
  function closeCamera() {
    window.CRONOX_REGISTER_CAMERA.stop();
    const panel = work.querySelector("[data-camera]");
    if (panel) panel.hidden = true;
  }
  function camera(deviceId) {
    const panel = work.querySelector("[data-camera]");
    panel.hidden = false;
    window.CRONOX_REGISTER_CAMERA.start({
      video: panel.querySelector("video"),
      devices: panel.querySelector("select"),
      deviceId,
      format: step === "credential" ? "qr_code" : "code_128",
      onRead: read,
      onError: (msg) => {
        closeCamera();
        notice(msg, true);
      },
    });
  }
  root.addEventListener("change", (e) => {
    if (e.target.name === "register-payment") {
      paymentMethod = e.target.value;
      syncPaid();
    }

    if (e.target.matches("[data-devices]")) camera(e.target.value);
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    if (recording || uncertain || sale) return;
    const f = e.target,
      data = new FormData(f);
    if (f.dataset.form === "code") {
      const value = data.get("code");
      if (step !== "credential") f.reset();
      f.elements.code.focus();
      read(value);
    }
    if (f.dataset.form === "search") {
      query = data.get("q");
      offset = 0;
      listProducts();
    }
    if (f.dataset.form === "product") {
      const o = products[+f.dataset.i]?.options[+data.get("option")],
        q = Number(data.get("qty"));
      if (o) run((c) => add(o, q, c), "Actualizando ticket…");
    }
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const action = b.dataset.act;
    if (action === "paid" || action === "retry-sale") {
      registerSale();
      return;
    }
    if (action === "recover-sale") {
      registerSale(true);
      return;
    }
    if (action === "validate-ticket") {
      run(async (current) => {
        const next = await quote(itemInputs());
        if (!current()) return;
        ticket = next;
        validationError = false;
        drawTicket();
        notice("Ticket revalidado. Revisa el importe antes de confirmar.");
      }, "Revalidando ticket…");
      return;
    }
    if ((recording || uncertain) && action !== "ticket") return;
    if (sale && !["reset", "ticket"].includes(action)) return;
    if (action === "reset" && !window.CRONOX_AFTER_SALES.canLeave()) {
      notice("Recupera la operación pendiente antes de iniciar otra.", true);
      return;
    }
    const act = b.dataset.act,
      i = Number(b.dataset.i);
    if (act === "ticket") receipt.focus();
    if (act === "reset") {
      if (sale || (step === "after-sales" && window.CRONOX_AFTER_SALES.status().completed)) resetPreparation();
      else {
        cancelOpener = b;
        syncReset();
        cancelDialog.showModal();
      }
      return;
    }
    if (act === "back")
      go(
        {
          context: "entry",
          points: "context",
          client: "context",
          credential: operation === 'PURCHASE' ? 'client' : 'entry',
          items: "client",
        }[step],
      );
    if (act === "purchase") {
      operation = "PURCHASE";
      go("context");
    }
    if (act === "refund" || act === "exchange") {
      operation = act === "refund" ? "RETURN" : "EXCHANGE";
      go("credential");
      camera();
    }
    if (act === "event") go("points");
    if (act === "points") listPoints();
    if (act === "point") context(points[i]);
    if (act === "no-event") context(null);
    if (act === "guest") client(null);

    if (act === "credential") {
      go("credential");
      camera();
    }
    if (act === "scan" || act === "manual") {
      mode = act;
      go("items");
      if (act === "scan") camera();
    }
    if (act === "camera") camera();
    if (act === "close-camera") closeCamera();
    if (act === "prev" || act === "next") {
      offset += act === "next" ? 24 : -24;
      listProducts();
    }
    if (act === "lot") {
      const o = choices[i];
      if (o) {
        b.parentElement
          .querySelectorAll("button")
          .forEach((btn) => (btn.disabled = true));
        run(async (c) => {
          try {
            if (await add(o, 1, c)) {
              choices = [];
              work.querySelector("[data-choice]").replaceChildren();
              beep();
            }
          } finally {
            if (c())
              work
                .querySelectorAll("[data-choice] button")
                .forEach((btn) => (btn.disabled = false));
          }
        }, "Actualizando ticket…");
      }
    }
    if (act === "cancel-lot") {
      choices = [];
      work.querySelector("[data-choice]").replaceChildren();
      notice();
    }
    if (["minus", "plus", "remove"].includes(act)) {
      const row = ticket.items[i];
      run(async (current) => {
        const items = itemInputs(),
          line = items.find(
            (l) => l.variantId === row.variantId && l.lotId === row.lotId,
          );
        if (!line) return;
        line.quantity =
          act === "remove" ? 0 : line.quantity + (act === "plus" ? 1 : -1);
        await update(
          items.filter((l) => l.quantity > 0),
          current,
          "Ticket actualizado.",
        );
      }, "Actualizando ticket…");
    }
    if (!audio && window.AudioContext)
      try {
        audio = new AudioContext();
      } catch {
        /* Sound is optional. */
      }
  });
  function refreshPrices() {
    if (
      root.hidden ||
      !ticket.items.length ||
      step !== "items" ||
      attempt ||
      sale ||
      recording ||
      uncertain
    )
      return;
    run(async (current) => {
      const next = await quote(itemInputs());
      if (!current()) return;
      const changes = changedPrices(next);
      validationError = validationError || !!changes;
      ticket = next;
      drawTicket();
      if (changes) notice("Oferta o precio actualizado: " + changes);
    }, feedback.textContent);
  }
  window.CRONOX_REGISTER = {
    syncReset,
    open() {
      if (step === "after-sales" || window.CRONOX_AFTER_SALES.hasPending()) {
        step = "after-sales";
        window.CRONOX_AFTER_SALES.open({
          kind: operation,
          api,
          work,
          receipt,
          notice,
        });
        return;
      }
      if (sale) {
        showRecorded(sale);
        return;
      }
      if (attempt) {
        work.innerHTML = "<h3>Recuperar venta pendiente</h3>";
        drawTicket();
        syncPaid();
        notice(
          "Hay una operación pendiente. Recupera su resultado antes de comenzar otra compra.",
        );
        return;
      }
      go(step);
    },
    leave() {
      if (cancelDialog.open) cancelDialog.close();
      if (!recording && !uncertain && !attempt && window.CRONOX_AFTER_SALES.canLeave()) abortPreparation();
      clearInterval(refreshTimer);
      refreshTimer = undefined;
      invalidate();
      window.CRONOX_AFTER_SALES.leave();
    },
  };
})();
