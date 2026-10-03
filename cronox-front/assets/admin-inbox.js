/* Private mailbox client. The browser never receives IMAP/SMTP credentials. */
(() => {
  "use strict";
  const root = document.getElementById("mailboxWorkspace");
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
  const date = (v) =>
    v
      ? new Date(v).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
      : "Nunca";
  const codes = {
    MAILBOX_OPERATION_FAILED:
      "No se pudo completar la operación. Reintenta o revisa el diagnóstico del buzón.",
    MAILBOX_MESSAGE_UNAVAILABLE:
      "El mensaje ya no está disponible en el buzón original.",
    MAILBOX_MESSAGE_NOT_FOUND:
      "El mensaje ya no está disponible en el buzón original.",
    AUTHENTICATION_FAILED:
      "El proveedor rechazó la autenticación. Revisa el producto y la credencial privada.",
    CONNECTION_FAILED:
      "No se pudo conectar con el proveedor. Revisa DNS, TLS y disponibilidad.",
    MAILBOX_INACTIVE:
      "Este buzón está inactivo. Actívalo desde Configuración para modificar el original.",
    MAILBOX_INACTIVE_CACHED_ONLY:
      "Este buzón está inactivo y este contenido aún no está descargado. Actívalo o consulta el webmail.",
    MAILBOX_SERVER_NOT_ALLOWED:
      "Selecciona los servidores oficiales del producto contratado y sus puertos TLS.",
    MAILBOX_MIGRATION_REQUIRED:
      "Pendiente de instalación: aplica la migración de buzones en el entorno local.",
    MAILBOX_ENCRYPTION_NOT_CONFIGURED:
      "Pendiente de configuración: falta la clave de cifrado del servidor.",
    MAILBOX_KEY_UNAVAILABLE:
      "No se puede descifrar el contenido. Revisa la clave actual y las anteriores.",
    MAILBOX_PRIVATE_STORAGE_NOT_CONFIGURED:
      "Pendiente de configuración: falta el almacenamiento privado.",
    MAILBOX_CREDENTIAL_MISSING:
      "Falta una credencial privada. Configúrala en el servidor o desde Configuración.",
    MAILBOX_WORKER_DISABLED:
      "La sincronización está desactivada en este entorno.",
    MAILBOX_SENDING_DISABLED: "Los envíos están desactivados en este entorno.",
    MAILBOX_BUSY: "El buzón está ocupado. Reintenta dentro de unos segundos.",
    MAILBOX_ACCESS_DENIED: "No tienes permiso para este buzón.",
    MAILBOX_DRAFT_CHANGED_OR_QUEUED:
      "El borrador cambió o ya está en la bandeja de salida. Recarga antes de continuar.",
    MAILBOX_CONFIGURATION_CHANGED:
      "La configuración cambió en otra sesión. Recarga antes de guardar.",
    MAILBOX_MOVE_NOT_SUPPORTED:
      "Este servidor no admite mover mensajes con seguridad. Utiliza su webmail.",
    MAILBOX_DESTINATION_NOT_AVAILABLE:
      "No se encontró la carpeta de destino. Revisa las carpetas reales del buzón.",
    MAILBOX_PUSH_NOT_CONFIGURED:
      "Falta la configuración Web Push del servidor.",
    MAILBOX_CONTENT_TOO_LARGE_USE_WEBMAIL:
      "El contenido supera el límite local. Ábrelo en Hostinger.",
    MAILBOX_ATTACHMENT_TOO_LARGE_USE_WEBMAIL:
      "El adjunto supera el límite local. Descárgalo desde Hostinger.",
    MAILBOX_ADDRESS_IMMUTABLE_CREATE_NEW_BOX:
      "La dirección de un buzón existente no se cambia. Añade otro buzón.",
    INVALID_RECIPIENT:
      "Introduce direcciones válidas separadas por comas, sin nombres ni saltos de línea.",
    MAILBOX_SESSION_REQUIRED: "La sesión ha caducado. Vuelve a iniciar sesión.",
  };
  const status = {
    PENDING_CONFIG: "Pendiente de configuración",
    CONNECTED: "Conectado",
    DISCONNECTED: "Sin conexión",
    DRAFT: "Borrador",
    QUEUED: "Pendiente",
    PENDING: "Pendiente",
    PROCESSING: "En proceso",
    SMTP_ACCEPTED: "Aceptado por SMTP",
    FAILED: "Fallido",
    UNKNOWN: "Resultado incierto",
  };
  let overview = null,
    boxId = "",
    folderId = "",
    folderKind = "\\Inbox",
    state = "all",
    search = "",
    page = 1,
    selected = null,
    selectedMailboxId = null,
    draft = null,
    dirty = false,
    editVersion = 0,
    saveTimer,
    savePromise = null,
    listSeq = 0,
    noticeCursor = new Date().toISOString(),
    timer = null,
    initialized = false,
    loading = null;
  const seenNotices = new Set();
  async function api(path, method = "GET", data) {
    const headers = {};
    let body;
    if (data instanceof FormData) body = data;
    else if (data !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(data);
    }
    if (method !== "GET")
      Object.assign(headers, await window.CRONOX_API.getCsrfHeaders());
    const response = await fetch(
      (window.CRONOX_API?.API_BASE || "") + "/api/admin/mailbox" + path,
      { method, headers, body, credentials: "include", cache: "no-store" },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        codes[result.message] ||
          `${result.message || "No se pudo completar la operación"} (${response.status})`,
      );
    return result;
  }
  const feedback = (text, error = false) => {
    const host = root.querySelector("[data-feedback]");
    if (host) {
      host.className = error ? "mail-error" : "mail-muted";
      host.textContent = text;
    }
  };
  const guard = (fn) => async (event) => {
    try {
      await fn(event);
    } catch (e) {
      feedback(e.message, true);
    }
  };
  const box = () => overview?.boxes.find((b) => b.id === boxId);
  const leave = async () => {
    if (dirty) {
      await save();
      if (dirty)
        throw Error("El texto no se ha guardado. Reintenta antes de salir.");
    }
    clearTimeout(saveTimer);
  };
  function shell() {
    root.dataset.view = "list";
    root.innerHTML = `<div class="mail-toolbar"><h2>Correo</h2><button class="btn" data-compose>Nuevo mensaje</button><button class="btn" data-refresh>Actualizar</button><button class="btn" data-drafts>Borradores y salida</button><button class="btn" data-devices>Notificaciones</button>${overview.superadmin ? '<button class="btn" data-settings>Configuración</button>' : ""}</div><div data-feedback role="status" aria-live="polite"></div><div class="mail-notice" data-setup></div><div class="mail-layout"><aside class="mail-boxes" aria-label="Buzones"><div class="mail-box-links" data-boxes></div><hr><label>Carpeta<select data-folder></select></label><p class="mail-muted" data-box-status></p></aside><div class="mail-list"><form class="mail-filters"><label>Buscar<input data-search type="search" placeholder="Remitente, destinatario o asunto" maxlength="120"></label><label>Estado<select data-state><option value="all">Todos</option><option value="unread">No leídos</option><option value="read">Leídos</option></select></label><button class="btn" type="submit">Buscar</button></form><p class="mail-muted">Búsqueda solo sobre mensajes sincronizados. Los contadores reflejan la caché importada.</p><div data-messages aria-live="polite"></div><div data-pagination class="mail-pager"></div></div><div class="mail-reader" hidden></div><div class="mail-editor" hidden></div><div class="mail-settings" hidden></div><div class="mail-devices" hidden></div></div>`;
    root.querySelector("[data-compose]").onclick = guard(() => compose());
    root.querySelector("[data-refresh]").onclick = guard(refresh);
    root.querySelector("[data-drafts]").onclick = guard(showDrafts);
    root.querySelector("[data-devices]").onclick = guard(showDevices);
    root.querySelector("[data-settings]")?.addEventListener(
      "click",
      guard(() => settings(boxId || undefined)),
    );
    root.querySelector(".mail-filters").onsubmit = guard(async (e) => {
      e.preventDefault();
      search = root.querySelector("[data-search]").value;
      state = root.querySelector("[data-state]").value;
      page = 1;
      await list();
    });
    root.querySelector("[data-folder]").onchange = guard(async (e) => {
      folderId = boxId ? e.target.value : "";
      folderKind = boxId ? "" : e.target.value;
      page = 1;
      await list();
    });
    renderOverview();
  }
  function renderOverview() {
    if (!overview) return;
    const total = overview.boxes.reduce((n, b) => n + b.unread, 0);
    const badge = document.querySelector("[data-mailbox-count]");
    if (badge) badge.textContent = total ? String(total) : "";
    root.querySelector("[data-setup]").textContent = !overview.boxes.length
      ? overview.superadmin
        ? "Pendiente de configuración. Añade tus buzones existentes en Configuración."
        : "No tienes buzones asignados. Un SUPERADMIN puede concederte acceso."
      : [
          !overview.workerEnabled
            ? "Sincronización en segundo plano desactivada."
            : "",
          !overview.sendEnabled ? "Envíos desactivados." : "",
          overview.encryptionConfigured ? "Cifrado configurado." : "Clave de cifrado pendiente.",
          overview.storageConfigured ? "Ruta privada configurada." : "Almacenamiento privado pendiente.",
        ]
          .filter(Boolean)
          .join(" ") ||
        "Los buzones originales siguen en Hostinger. Abrir un mensaje lo marca leído; las importaciones no lo hacen.";
    const host = root.querySelector("[data-boxes]");
    host.innerHTML =
      `<button class="btn" data-box="" ${!boxId ? 'aria-current="true"' : ""}>Todos los buzones <small>${total} no leídos</small></button>` +
      overview.boxes
        .map(
          (b) =>
            `<button class="btn" data-box="${esc(b.id)}" ${boxId === b.id ? 'aria-current="true"' : ""}>${esc(b.name)} <small>${esc(b.address)} · ${b.unread} no leídos</small></button>`,
        )
        .join("");
    host.querySelectorAll("[data-box]").forEach(
      (b) =>
        (b.onclick = guard(async () => {
          await leave();
          boxId = b.dataset.box;
          folderId = "";
          folderKind = boxId ? "" : "\\Inbox";
          page = 1;
          show("list");
          renderOverview();
          await list();
        })),
    );
    const folders = root.querySelector("[data-folder]");
    folders.innerHTML = boxId
      ? `<option value="">Todas las carpetas</option>` +
        (box()?.folders || [])
          .map(
            (f) =>
              `<option value="${esc(f.id)}">${esc(f.path)}${f.importBefore ? ` · importando ${f.importedCount ?? 0} de ${f.remoteCount}` : ""}</option>`,
          )
          .join("")
      : [
          ["\\Inbox", "Entrada"],
          ["\\Sent", "Enviados"],
          ["\\Drafts", "Borradores del proveedor"],
          ["\\Junk", "Spam"],
          ["\\Trash", "Papelera"],
          ["", "Todas las carpetas"],
        ]
          .map(
            ([value, label]) =>
              `<option value="${esc(value)}">${label}</option>`,
          )
          .join("");
    folders.value = boxId ? folderId : folderKind;
    root.querySelector("[data-box-status]").textContent = box()
      ? `${status[box().status] || box().status}${!box().active ? " · Inactivo" : ""} · Última sincronización: ${date(box().lastSyncAt)}${box().errorCode ? " · " + (codes[box().errorCode] || box().errorCode) : ""}`
      : "Selecciona un buzón para ver su conexión y carpetas.";
    root.querySelector("[data-compose]").disabled = !overview.boxes.some(
      (b) => b.canSend,
    );
    root.querySelector("[data-refresh]").disabled =
      !overview.workerEnabled || !overview.boxes.some((b) => b.active);
  }
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        await leave();
        overview = await api("/overview");
        if (boxId && !overview.boxes.some((b) => b.id === boxId)) boxId = "";
        shell();
        await list();
        const message = new URLSearchParams(location.search).get("mail");
        if (message && /^[\da-f-]{36}$/i.test(message)) {
          history.replaceState(null, "", location.pathname + location.hash);
          await read(message);
        }
      } catch (e) {
        if (!root.querySelector("[data-feedback]"))
          root.innerHTML =
            '<div data-feedback role="status"></div><button class="btn" data-retry>Reintentar</button>';
        feedback(e.message, true);
        root
          .querySelector("[data-retry]")
          ?.addEventListener("click", () => void load());
      } finally {
        loading = null;
      }
    })();
    return loading;
  }
  function show(view) {
    root.dataset.view = view;
    for (const v of ["reader", "editor", "settings", "devices"])
      root.querySelector(".mail-" + v).hidden = !(
        {
          read: "reader",
          compose: "editor",
          settings: "settings",
          devices: "devices",
        }[view] === v
      );
  }
  async function list() {
    const seq = ++listSeq,
      host = root.querySelector("[data-messages]");
    if (!host) return;
    host.textContent = "Cargando mensajes…";
    const q = new URLSearchParams({
      mailboxId: boxId,
      folderId,
      folderKind,
      state,
      search,
      page: String(page),
    });
    try {
      const data = await api("/messages?" + q);
      if (seq !== listSeq) return;
      host.innerHTML = data.messages.length
        ? data.messages
            .map(
              (m) =>
                `<button class="mail-message ${m.seen ? "" : "unread"}" data-message="${esc(m.id)}" ${selected === m.id ? 'aria-current="true"' : ""}><span>${esc(m.sender || "Sin remitente")}</span><strong>${esc(m.subject)}</strong><small>${esc(m.preview || "Contenido pendiente de descargar")}${m.hasAttachments ? " · Adjuntos" : ""}</small><small>${esc(overview.boxes.find((b) => b.id === m.mailboxId)?.name || "Buzón")}</small><time>${esc(date(m.date))}</time></button>`,
            )
            .join("")
        : "<p>No hay mensajes sincronizados para estos filtros. Revisa el estado de conexión y el progreso del buzón.</p>";
      host
        .querySelectorAll("[data-message]")
        .forEach((b) => (b.onclick = guard(() => read(b.dataset.message))));
      const p = data.pagination;
      root.querySelector("[data-pagination]").innerHTML =
        `<button class="btn" data-prev ${page <= 1 ? "disabled" : ""}>Anterior</button><span>${p.total} mensajes · ${page} / ${p.pages}</span><button class="btn" data-next ${page >= p.pages ? "disabled" : ""}>Siguiente</button>`;
      root.querySelector("[data-prev]").onclick = guard(async () => {
        page--;
        await list();
      });
      root.querySelector("[data-next]").onclick = guard(async () => {
        page++;
        await list();
      });
    } catch (e) {
      if (seq === listSeq) {
        host.innerHTML =
          '<p class="mail-error">' +
          esc(e.message) +
          '</p><button class="btn" data-retry-list>Reintentar</button>';
        host.querySelector("[data-retry-list]").onclick = guard(list);
      }
    }
  }
  async function refresh() {
    await leave();
    const boxes = boxId ? [box()] : overview.boxes.filter((b) => b.active);
    for (const b of boxes) await api("/boxes/" + b.id + "/refresh", "POST");
    feedback(
      "Actualización solicitada al trabajador existente. Puede tardar unos segundos.",
    );
    await list();
  }
  async function read(id) {
    await leave();
    show("read");
    selected = id;
    const host = root.querySelector(".mail-reader");
    host.innerHTML = "<p>Cargando contenido sin imágenes externas…</p>";
    try {
      const m = await api("/messages/" + id);
      selectedMailboxId = m.mailboxId;
      const b = overview.boxes.find((b) => b.id === m.mailboxId),
        env = m.envelope || {};
      const joined = (a) =>
        (a || [])
          .map(
            (x) =>
              (x.name ? x.name + " <" : "") + x.address + (x.name ? ">" : ""),
          )
          .join(", ");
      host.innerHTML = `<button class="btn mail-back" data-back>← Volver a la lista</button><h3>${esc(m.subject)}</h3><dl><dt>Buzón</dt><dd>${esc(b?.address)}</dd><dt>De</dt><dd>${esc(joined(env.from))}</dd><dt>Para</dt><dd>${esc(joined(env.to))}</dd><dt>CC</dt><dd>${esc(joined(env.cc) || "—")}</dd>${env.replyTo?.length ? `<dt>Responder a (Reply-To)</dt><dd>${esc(joined(env.replyTo))}</dd>` : ""}<dt>Fecha</dt><dd>${esc(date(m.date))}</dd></dl><div class="mail-actions">${b?.canSend ? '<button class="btn" data-reply="reply">Responder</button><button class="btn" data-reply="replyAll">Responder a todos</button><button class="btn" data-reply="forward">Reenviar</button>' : ""}<button class="btn" data-unread>Marcar no leído</button>${b?.canSend ? '<button class="btn" data-trash>Mover a papelera</button><button class="btn" data-restore>Restaurar a Entrada</button>' : ""}</div><p class="mail-muted">Imágenes remotas bloqueadas. Cargarlas puede revelar tu IP y la apertura al remitente.</p><button class="btn" data-images>Cargar imágenes externas</button><iframe title="Contenido aislado del mensaje" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe><div class="mail-files">${m.files.map((f) => `<a data-file="${esc(f.id)}" href="#">Descargar ${esc(f.name)} (${Math.ceil(f.size / 1024)} KB)</a>`).join("")}</div><p><a target="_blank" rel="noopener noreferrer" href="${b?.provider === "titan" ? "https://app.titan.email" : "https://mail.hostinger.com"}">Abrir el buzón original en Hostinger</a></p>`;
      const doc = (remote) =>
        `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${remote ? "https:" : "'none'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{font:16px/1.5 system-ui;overflow-wrap:anywhere;margin:12px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}</style></head><body>${m.body.html || "<pre>" + esc(m.body.text) + "</pre>"}</body></html>`;
      host.querySelector("iframe").srcdoc = doc(false);
      host.querySelector("[data-images]").onclick = () => {
        host.querySelector("iframe").srcdoc = doc(true);
        host.querySelector("[data-images]").hidden = true;
      };
      if (!b?.active)
        host
          .querySelectorAll("[data-unread],[data-trash],[data-restore]")
          .forEach((button) => (button.disabled = true));
      host.querySelector("[data-back]").onclick = guard(async () => {
        show("list");
        await list();
      });
      host
        .querySelectorAll("[data-reply]")
        .forEach(
          (button) =>
            (button.onclick = guard(() =>
              compose(m.mailboxId, m.id, button.dataset.reply),
            )),
        );
      host.querySelector("[data-unread]").onclick = guard(async () => {
        await api("/messages/" + id + "/action", "POST", {
          operation: "unread",
        });
        feedback("Marcado no leído y sincronizado con el proveedor.");
        await list();
      });
      for (const operation of ["trash", "restore"])
        host.querySelector("[data-" + operation + "]")?.addEventListener(
          "click",
          guard(async () => {
            await api("/messages/" + id + "/action", "POST", { operation });
            show("list");
            selected = null;
            await list();
            feedback(
              operation === "trash"
                ? "Movido a papelera."
                : "Restaurado a Entrada.",
            );
          }),
        );
      host.querySelectorAll("[data-file]").forEach(
        (link) =>
          (link.onclick = guard(async (e) => {
            e.preventDefault();
            await download(link.dataset.file);
          })),
      );
      if (!m.seen && b?.active) {
        try {
          await api("/messages/" + id + "/action", "POST", {
            operation: "read",
          });
        } catch (error) {
          if (/permiso|sesión|ya no está disponible/.test(error.message))
            throw error;
          feedback(
            "Contenido disponible. No se pudo marcar leído en el proveedor: " +
              error.message,
            true,
          );
        }
      }
      await list();
    } catch (e) {
      host.innerHTML = `<button class="btn" data-back>← Volver</button><p class="mail-error">${esc(e.message)}</p><button class="btn" data-retry-body>Reintentar</button><p><a href="https://mail.hostinger.com" target="_blank" rel="noopener noreferrer">Consultar original en Hostinger</a></p>`;
      host.querySelector("[data-back]").onclick = () => show("list");
      host.querySelector("[data-retry-body]").onclick = guard(() => read(id));
    }
  }
  async function download(id) {
    const response = await fetch(
      (window.CRONOX_API?.API_BASE || "") + "/api/admin/mailbox/files/" + id,
      { credentials: "include" },
    );
    if (!response.ok) {
      const result = await response.json();
      throw Error(codes[result.message] || "No se pudo descargar el adjunto.");
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const name = decodeURIComponent(
      disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] || "attachment",
    );
    const url = URL.createObjectURL(await response.blob()),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function compose(id = boxId, messageId, mode) {
    await leave();
    const chosen = id || overview.boxes.find((b) => b.canSend)?.id;
    if (!chosen) throw Error("No tienes permiso de envío en ningún buzón.");
    draft = await api("/drafts", "POST", {
      mailboxId: chosen,
      ...(messageId ? { messageId, mode } : {}),
    });
    renderComposer();
  }
  const recoveryKey = () => `cronox-mail-draft:${draft?.id}`;
  function values() {
    const form = root.querySelector(".mail-editor form");
    return {
      to: form.elements.to.value,
      cc: form.elements.cc.value,
      bcc: form.elements.bcc.value,
      subject: form.elements.subject.value,
      text: form.elements.text.value,
      revision: draft.revision,
    };
  }
  function renderComposer() {
    show("compose");
    const host = root.querySelector(".mail-editor"),
      b = overview.boxes.find((b) => b.id === draft.mailboxId),
      locked = draft.status !== "DRAFT";
    dirty = false;
    editVersion = 0;
    host.innerHTML = `<button class="btn mail-back" data-back>← Volver</button><h3>${locked ? "Bandeja de salida" : "Redactar"}</h3><p>Remitente: <strong>${esc(b?.fromName)} &lt;${esc(b?.address)}&gt;</strong></p><form><div class="mail-addresses"><label>Para<input name="to" value="${esc(draft.to)}" ${locked ? "disabled" : ""}></label><label>CC<input name="cc" value="${esc(draft.cc)}" ${locked ? "disabled" : ""}></label></div><label>CCO (no visible para los demás destinatarios)<input name="bcc" value="${esc(draft.bcc)}" ${locked ? "disabled" : ""}></label><label>Asunto<input name="subject" value="${esc(draft.subject)}" maxlength="500" ${locked ? "disabled" : ""}></label><label>Mensaje (texto)<textarea name="text" ${locked ? "disabled" : ""}>${esc(draft.text)}</textarea></label><p class="mail-muted">Direcciones separadas por comas. El envío usa siempre el buzón mostrado.</p><div data-draft-files class="mail-files"></div>${locked ? "" : '<label>Añadir adjuntos<input data-upload type="file" multiple></label>'}<p class="mail-saved" data-save-state role="status">${esc(status[draft.status] || draft.status)}</p><div class="mail-actions">${locked ? '<button class="btn" type="button" data-clone>Crear nuevo borrador para revisar o reenviar</button>' : '<button class="btn" type="button" data-save>Guardar borrador</button><button class="btn" type="submit" data-send>Enviar ahora</button>'}<button class="btn" type="button" data-close-editor>Volver a la lista</button></div></form><div data-send-result></div><button class="btn" data-recover hidden>Recuperar texto no guardado de esta pestaña</button>`;
    renderFiles();
    renderSend();
    if (host.querySelector("[data-send]"))
      host.querySelector("[data-send]").disabled =
        !overview.sendEnabled || !overview.workerEnabled || !b?.active;
    host.querySelector("[data-back]").onclick = guard(async () => {
      await leave();
      show("list");
    });
    host.querySelector("[data-close-editor]").onclick = guard(async () => {
      await leave();
      show("list");
      await list();
    });
    host.querySelector("form").oninput = () => {
      if (locked) return;
      dirty = true;
      editVersion++;
      host.querySelector("[data-save-state]").textContent =
        "Cambios sin guardar…";
      try {
        sessionStorage.setItem(recoveryKey(), JSON.stringify(values()));
      } catch {}
      clearTimeout(saveTimer);
      saveTimer = setTimeout(
        () => void save().catch((e) => feedback(e.message, true)),
        700,
      );
    };
    host.querySelector("[data-save]")?.addEventListener("click", guard(save));
    host.querySelector("form").onsubmit = guard(async (e) => {
      e.preventDefault();
      if (locked) return;
      const send = host.querySelector("[data-send]");
      send.disabled = true;
      try {
        await save();
        if (dirty) throw Error("Guarda el borrador antes de enviar.");
        let key = sessionStorage.getItem(recoveryKey() + ":request");
        if (!key) {
          key = crypto.randomUUID();
          sessionStorage.setItem(recoveryKey() + ":request", key);
        }
        draft = await api("/drafts/" + draft.id + "/send", "POST", {
          revision: draft.revision,
          requestKey: key,
        });
        renderComposer();
        feedback(
          "Envío solicitado. La aceptación SMTP no garantiza la entrega final.",
        );
      } finally {
        if (send.isConnected) send.disabled = false;
      }
    });
    host.querySelector("[data-clone]")?.addEventListener(
      "click",
      guard(async () => {
        const risk = draft.sends.some((s) =>
          ["UNKNOWN", "SMTP_ACCEPTED"].includes(s.status),
        );
        if (
          risk &&
          !confirm(
            "El proveedor pudo aceptar el mensaje. Crear otro y enviarlo puede duplicarlo. Revisa primero Enviados en Hostinger. ¿Crear un nuevo borrador?",
          )
        )
          return;
        draft = await api("/drafts/" + draft.id + "/clone", "POST", {
          acknowledge: risk,
        });
        renderComposer();
      }),
    );
    host.querySelector("[data-upload]")?.addEventListener(
      "change",
      guard(async (e) => {
        await save();
        for (const file of [...e.target.files]) {
          const data = new FormData();
          data.append("file", file);
          await api("/drafts/" + draft.id + "/files", "POST", data);
        }
        const current = await api("/drafts/" + draft.id);
        draft.revision = current.revision;
        draft.files = current.files;
        renderFiles();
        e.target.value = "";
      }),
    );
    let recover;
    try {
      recover = JSON.parse(sessionStorage.getItem(recoveryKey()) || "null");
    } catch {}
    if (
      recover &&
      !locked &&
      ["to", "cc", "bcc", "subject", "text"].some(
        (k) => recover[k] !== draft[k],
      )
    ) {
      host.querySelector("[data-recover]").hidden = false;
      host.querySelector("[data-recover]").onclick = () => {
        for (const k of ["to", "cc", "bcc", "subject", "text"])
          host.querySelector("form").elements[k].value = recover[k] || "";
        dirty = true;
        editVersion++;
        host.querySelector("[data-save-state]").textContent =
          "Texto recuperado. Guarda antes de salir.";
        host.querySelector("[data-recover]").hidden = true;
      };
    }
  }
  function renderFiles() {
    const host = root.querySelector("[data-draft-files]");
    if (!host) return;
    host.innerHTML = draft.files
      .map(
        (f) =>
          `<span>${esc(f.name)} (${Math.ceil(f.size / 1024)} KB) ${draft.status === "DRAFT" ? `<button class="btn" type="button" data-remove-file="${esc(f.id)}">Quitar</button>` : ""}</span>`,
      )
      .join("");
    host.querySelectorAll("[data-remove-file]").forEach(
      (button) =>
        (button.onclick = guard(async () => {
          await save();
          await api("/files/" + button.dataset.removeFile, "DELETE");
          const current = await api("/drafts/" + draft.id);
          draft.revision = current.revision;
          draft.files = current.files;
          renderFiles();
        })),
    );
  }
  function renderSend() {
    const host = root.querySelector("[data-send-result]");
    if (!host) return;
    host.innerHTML = draft.sends
      .map(
        (s) =>
          `<div class="mail-notice"><strong>${esc(status[s.status] || s.status)}</strong><p>${s.status === "SMTP_ACCEPTED" ? "Aceptado por el servidor SMTP; la entrega final no está confirmada." : s.status === "UNKNOWN" ? "No se reintentará automáticamente. Comprueba Enviados y el destinatario antes de crear otro envío." : s.status === "FAILED" ? "No se enviará automáticamente otra vez. Revisa el diagnóstico antes de crear un nuevo borrador." : "El envío explícito está en la bandeja de salida."}</p><p>Copia en Enviados: ${esc({ SAVED: "guardada", PROVIDER_MANAGED: "gestionada por el proveedor", FAILED_OR_UNCERTAIN: "fallida o incierta; no repitas el envío por este motivo", PENDING: "pendiente", NOT_ATTEMPTED: "no realizada" }[s.sentCopyStatus] || s.sentCopyStatus)}</p>${s.rejected?.length ? `<p>Destinatarios rechazados: ${esc(s.rejected.join(", "))}. No vuelvas a enviar a los que ya fueron aceptados.</p>` : ""}</div>`,
      )
      .join("");
  }
  async function save() {
    clearTimeout(saveTimer);
    if (savePromise) return savePromise;
    if (!draft || draft.status !== "DRAFT" || !dirty) return;
    savePromise = (async () => {
      while (dirty) {
        const version = editVersion,
          data = values();
        root.querySelector("[data-save-state]").textContent = "Guardando…";
        try {
          const result = await api("/drafts/" + draft.id, "PATCH", data);
          draft.revision = result.revision;
          draft.files = result.files;
          if (version === editVersion) {
            Object.assign(draft, data, { revision: result.revision });
            dirty = false;
            try {
              sessionStorage.removeItem(recoveryKey());
            } catch {}
            root.querySelector("[data-save-state]").textContent = "Guardado";
            document.dispatchEvent(
              new CustomEvent("cronox:admin-saved", {
                detail: { container: root.querySelector(".mail-editor") },
              }),
            );
          }
        } catch (e) {
          root.querySelector("[data-save-state]").textContent =
            "No guardado. Tu texto sigue en esta pestaña; reintenta.";
          throw e;
        }
      }
    })().finally(() => {
      savePromise = null;
    });
    return savePromise;
  }
  async function showDrafts() {
    await leave();
    show("compose");
    const host = root.querySelector(".mail-editor");
    host.textContent = "Cargando borradores y bandeja de salida…";
    const rows = await api("/drafts");
    host.innerHTML =
      '<button class="btn" data-back>← Volver</button><h3>Borradores y bandeja de salida</h3><p class="mail-muted">Tus últimos 100 borradores y envíos. Borradores del cliente CRONOX; no se suben a Borradores de Hostinger.</p>' +
      (rows.length
        ? rows
            .map(
              (d) =>
                `<button class="mail-message" data-draft="${esc(d.id)}"><strong>${esc(d.subject || "(Sin asunto)")}</strong><small>${esc(overview.boxes.find((b) => b.id === d.mailboxId)?.address)} · ${esc(status[d.sends[0]?.status || d.status] || d.status)} · ${esc(date(d.updatedAt))}</small></button>`,
            )
            .join("")
        : "<p>No tienes borradores.</p>");
    host.querySelector("[data-back]").onclick = () => show("list");
    host.querySelectorAll("[data-draft]").forEach(
      (button) =>
        (button.onclick = guard(async () => {
          draft = await api("/drafts/" + button.dataset.draft);
          renderComposer();
        })),
    );
  }
  async function settings(id) {
    await leave();
    show("settings");
    const host = root.querySelector(".mail-settings"),
      b = overview.boxes.find((b) => b.id === id),
      admins = await api("/administrators");
    host.innerHTML = `<button class="btn mail-back" data-back>← Volver</button><h3>Configuración de buzones</h3><p>Conecta direcciones ya existentes. No se crean cuentas ni se cambian DNS. Los campos de contraseña vacíos conservan la credencial guardada.</p><div class="mail-actions">${overview.boxes.map((b) => `<button class="btn" data-edit-box="${esc(b.id)}">${esc(b.name)}</button>`).join("")}<button class="btn" data-add-box>Añadir buzón</button></div><form><div class="mail-addresses"><label>Nombre visible<input name="name" value="${esc(b?.name || "")}" required maxlength="100"></label><label>Dirección<input name="address" type="email" value="${esc(b?.address || "")}" ${b ? "readonly" : ""} required></label><label>Nombre del remitente<input name="fromName" value="${esc(b?.fromName || "CRONOX")}" required maxlength="100"></label><label>Producto<select name="provider"><option value="hostinger">Hostinger Email</option><option value="titan">Titan Email contratado en Hostinger</option></select></label></div><p class="mail-muted">Comprueba el producto en hPanel → Emails → Conectar aplicaciones y dispositivos. Solo se admiten los servidores oficiales permitidos.</p><div class="mail-addresses"><label>IMAP<input name="imapHost" readonly></label><label>Puerto IMAP<input name="imapPort" type="number" value="993" readonly></label><label>SMTP<input name="smtpHost" readonly></label><label>Puerto SMTP<select name="smtpPort"><option value="465">465 · TLS directo</option><option value="587">587 · STARTTLS obligatorio</option></select></label><label>Variable privada IMAP<input name="imapSecretRef" value="${esc(b?.imapSecretRef || "")}" list="mailCredentialRefs" placeholder="SMTP_SUPPORT_PASS"></label><label>Variable privada SMTP<input name="smtpSecretRef" value="${esc(b?.smtpSecretRef || "")}" list="mailCredentialRefs" placeholder="SMTP_SUPPORT_PASS"></label><label>Contraseña IMAP nueva<input name="imapPassword" type="password" autocomplete="new-password" placeholder="${b?.imapCredentialSaved ? "Guardada; vacío conserva" : "Opcional si usas una variable"}"></label><label>Contraseña SMTP nueva<input name="smtpPassword" type="password" autocomplete="new-password" placeholder="${b?.smtpCredentialSaved ? "Guardada; vacío conserva" : "Opcional si usas una variable"}"></label></div><datalist id="mailCredentialRefs">${overview.credentialRefs.map((ref) => `<option value="${esc(ref)}">`).join("")}</datalist><label>Copia en Enviados<select name="sentCopy"><option value="append">Guardar con IMAP (comprobar copia antes de añadir)</option><option value="provider">El proveedor ya guarda una copia automáticamente</option></select></label><label><span><input type="checkbox" name="active" ${b?.active ? "checked" : ""}> Activar este buzón</span></label><label><span><input type="checkbox" name="notify" ${b?.notify !== false ? "checked" : ""}> Avisos de nuevos mensajes de Entrada</span></label><div class="mail-grants"><h4>Permisos explícitos para ADMIN</h4><p>SUPERADMIN tiene acceso. ADMIN necesita una concesión por buzón. USER y FRIEND no pueden acceder.</p><div data-grants></div><button class="btn" type="button" data-grant-add>Añadir permiso</button></div><button class="btn" type="submit">Guardar configuración</button>${b ? '<button class="btn" type="button" data-test>Probar IMAP y SMTP sin enviar correo</button>' : ""}</form><div data-test-result role="status"></div><div data-suggestions></div>`;
    const form = host.querySelector("form");
    form.elements.provider.value = b?.provider || "hostinger";
    form.elements.smtpPort.value = String(b?.smtpPort || 465);
    form.elements.sentCopy.value = b?.sentCopy || "append";
    const servers = () => {
      form.elements.imapHost.value =
        form.elements.provider.value === "titan"
          ? "imap.titan.email"
          : "imap.hostinger.com";
      form.elements.smtpHost.value =
        form.elements.provider.value === "titan"
          ? "smtp.titan.email"
          : "smtp.hostinger.com";
    };
    servers();
    form.elements.provider.onchange = servers;
    const grantHost = host.querySelector("[data-grants]");
    const addGrant = (p) => {
      const row = document.createElement("div");
      row.className = "mail-grant";
      row.innerHTML = `<label>Administrador<select data-grant-user>${admins.map((a) => `<option value="${a.id}">#${a.id} ${esc(a.name || a.email)}</option>`).join("")}</select></label><label>Acceso<select data-grant-access><option value="read">Leer</option><option value="send">Leer y enviar</option></select></label><label><span><input type="checkbox" data-grant-notify ${p?.notify !== false ? "checked" : ""}> Avisos</span><span><input type="checkbox" data-grant-details ${p?.details ? "checked" : ""}> Detalles en avisos</span></label><button class="btn" type="button" data-grant-remove>Revocar</button>`;
      grantHost.append(row);
      if (p) {
        row.querySelector("[data-grant-user]").value = String(p.userId);
        row.querySelector("[data-grant-access]").value = p.access;
      }
      row.querySelector("[data-grant-remove]").onclick = () => row.remove();
    };
    (b?.permissions || []).forEach(addGrant);
    host.querySelector("[data-grant-add]").onclick = () => addGrant();
    form.onsubmit = guard(async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      data.imapPort = Number(data.imapPort);
      data.smtpPort = Number(data.smtpPort);
      data.username = data.address;
      data.active = form.elements.active.checked;
      data.notify = form.elements.notify.checked;
      data.permissions = [...grantHost.children].map((row) => ({
        userId: Number(row.querySelector("[data-grant-user]").value),
        access: row.querySelector("[data-grant-access]").value,
        notify: row.querySelector("[data-grant-notify]").checked,
        details: row.querySelector("[data-grant-details]").checked,
      }));
      if (b) data.revision = b.revision;
      const button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        overview = await api(
          "/boxes" + (b ? "/" + b.id : ""),
          b ? "PATCH" : "POST",
          data,
        );
        form.elements.imapPassword.value = "";
        form.elements.smtpPassword.value = "";
        document.dispatchEvent(
          new CustomEvent("cronox:admin-saved", {
            detail: { container: host },
          }),
        );
        feedback("Configuración guardada. Ningún mensaje se ha enviado.");
        await settings(
          b?.id || overview.boxes.find((x) => x.address === data.address)?.id,
        );
        renderOverview();
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    host.querySelector("[data-test]")?.addEventListener(
      "click",
      guard(async () => {
        host.querySelector("[data-test-result]").textContent =
          "Comprobando conexión, TLS y autenticación…";
        const result = await api("/boxes/" + b.id + "/test", "POST");
        host.querySelector("[data-test-result]").textContent =
          `IMAP: ${result.imap === "TLS_AUTH_OK" ? "TLS y autenticación correctos" : codes[result.imap] || result.imap}. SMTP: ${result.smtp === "TLS_AUTH_OK" ? "TLS y autenticación correctos" : codes[result.smtp] || result.smtp}.${result.errorCode ? " " + (codes[result.errorCode] || result.errorCode) : ""}${result.folders ? " Carpetas: " + result.folders.map((f) => f.path).join(", ") : ""}`;
      }),
    );
    host.querySelector("[data-back]").onclick = () => show("list");
    host
      .querySelectorAll("[data-edit-box]")
      .forEach(
        (button) =>
          (button.onclick = guard(() => settings(button.dataset.editBox))),
      );
    host.querySelector("[data-add-box]").onclick = guard(() => settings());
    if (!b) {
      const hints = host.querySelector("[data-suggestions]");
      hints.innerHTML =
        "<h4>Variables existentes detectadas</h4>" +
        overview.suggestions
          .map(
            (s, i) =>
              `<button class="btn" data-suggest="${i}">${esc(s.name)} · ${esc(s.address)}</button>`,
          )
          .join("");
      hints.querySelectorAll("[data-suggest]").forEach(
        (button) =>
          (button.onclick = () => {
            const s = overview.suggestions[Number(button.dataset.suggest)];
            form.elements.name.value = s.name;
            form.elements.address.value = s.address;
            form.elements.imapSecretRef.value = s.credentialRef;
            form.elements.smtpSecretRef.value = s.credentialRef;
            if (s.provider) form.elements.provider.value = s.provider;
            servers();
          }),
      );
    }
  }
  function b64(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(
      atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
  }
  async function showDevices() {
    await leave();
    show("devices");
    const host = root.querySelector(".mail-devices"),
      config = await api("/push/config"),
      devices = await api("/push/devices");
    host.innerHTML = `<button class="btn mail-back" data-back>← Volver</button><h3>Notificaciones en este dispositivo</h3><p>Los avisos son genéricos por defecto. Dependen del navegador, la conexión, el ahorro de batería y el sistema; no son inmediatos ni universales.</p><p>Android: utiliza un navegador compatible, permite notificaciones y revisa el ahorro de batería. iPhone/iPad: iOS/iPadOS 16.4 o posterior; abre en Safari, Compartir → Añadir a pantalla de inicio, abre el icono y pulsa Activar. Se necesita HTTPS.</p>${!config.configured ? '<p class="mail-notice">Pendiente de configuración Web Push en el servidor.</p>' : ""}<label>Nombre del dispositivo<input data-device-name value="Este dispositivo" maxlength="80"></label><div data-device-boxes>${overview.boxes.map((b) => `<label><span><input type="checkbox" value="${esc(b.id)}" checked> ${esc(b.name)} · ${esc(b.address)}</span></label>`).join("")}</div><label><span><input type="checkbox" data-push-details> Mostrar remitente y asunto en la pantalla bloqueada, si tengo permiso</span></label><button class="btn" data-enable ${!config.configured ? "disabled" : ""}>Activar o actualizar notificaciones</button><button class="btn" data-disable-local>Desactivar en este navegador</button><h4>Dispositivos de tu cuenta</h4>${devices.map((d) => `<div class="mail-notice">${esc(d.name)} · ${d.active ? "Activo" : "Desactivado"} ${d.active ? `<button class="btn" data-disable-device="${esc(d.id)}">Desactivar</button>` : ""}</div>`).join("")}<p data-push-result role="status"></p>`;
    const current = devices.find(
      (d) => d.id === sessionStorage.getItem("cronox-mail-device"),
    );
    if (current) {
      host.querySelector("[data-device-name]").value = current.name;
      host.querySelector("[data-push-details]").checked = current.details;
      host
        .querySelectorAll("[data-device-boxes] input")
        .forEach(
          (input) => (input.checked = current.mailboxIds.includes(input.value)),
        );
    }
    host.querySelector("[data-back]").onclick = () => show("list");
    host.querySelector("[data-enable]").onclick = guard(async () => {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw Error(
          "Este navegador no admite Web Push. En iPhone abre el icono añadido a la pantalla de inicio.",
        );
      if ((await Notification.requestPermission()) !== "granted")
        throw Error(
          "No se ha concedido permiso. Revisa los ajustes del navegador.",
        );
      const registration = await navigator.serviceWorker.register(
        "/mailbox-sw.js",
        { scope: "/" },
      );
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription)
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64(config.publicKey),
        });
      const result = await api("/push/devices", "POST", {
        subscription: subscription.toJSON(),
        name: host.querySelector("[data-device-name]").value,
        mailboxIds: [
          ...host.querySelectorAll("[data-device-boxes] input:checked"),
        ].map((i) => i.value),
        details: host.querySelector("[data-push-details]").checked,
      });
      sessionStorage.setItem("cronox-mail-device", result.id);
      host.querySelector("[data-push-result]").textContent =
        "Notificaciones activadas para los buzones seleccionados. No se ha enviado ningún correo.";
    });
    host.querySelector("[data-disable-local]").onclick = guard(async () => {
      const id = sessionStorage.getItem("cronox-mail-device");
      if (id) await api("/push/devices/" + id, "DELETE");
      const registration = await navigator.serviceWorker.getRegistration("/");
      const sub = await registration?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      sessionStorage.removeItem("cronox-mail-device");
      await showDevices();
    });
    host.querySelectorAll("[data-disable-device]").forEach(
      (button) =>
        (button.onclick = guard(async () => {
          await api("/push/devices/" + button.dataset.disableDevice, "DELETE");
          await showDevices();
        })),
    );
  }
  async function pulse() {
    if (!initialized || !overview || document.visibilityState !== "visible")
      return;
    try {
      const next = await api("/overview");
      overview = next;
      const allowed = new Set(next.boxes.map((b) => b.id));
      if (
        (boxId && !allowed.has(boxId)) ||
        (selectedMailboxId && !allowed.has(selectedMailboxId)) ||
        (draft && !next.boxes.find((b) => b.id === draft.mailboxId)?.canSend)
      ) {
        boxId = "";
        selected = null;
        selectedMailboxId = null;
        draft = null;
        dirty = false;
        document.querySelector(".mail-toast-host")?.remove();
        shell();
        await list();
      } else {
        renderOverview();
        if (selected && root.dataset.view === "read") {
          await api("/messages/" + selected + "/status");
        }
        if (draft && draft.status !== "DRAFT") {
          const current = await api("/drafts/" + draft.id);
          draft = current;
          renderSend();
        }
      }
      const notices = await api(
        "/notices?after=" + encodeURIComponent(noticeCursor),
      );
      noticeCursor = notices.cursor;
      for (const n of notices.notices) {
        if (seenNotices.has(n.id)) continue;
        seenNotices.add(n.id);
        let host = document.querySelector(".mail-toast-host");
        if (!host) {
          host = document.createElement("div");
          host.className = "mail-toast-host";
          host.setAttribute("aria-live", "polite");
          document.body.append(host);
        }
        const button = document.createElement("button");
        button.textContent = `${n.mailbox}: ${n.sender ? n.sender + " · " : ""}${n.subject}`;
        button.onclick = () => {
          location.hash = "#section-inbox";
          void load()
            .then(() => read(n.messageId))
            .catch((e) => feedback(e.message, true));
          button.remove();
        };
        host.append(button);
        setTimeout(() => button.remove(), 15000);
      }
      if (seenNotices.size > 200) seenNotices.clear();
    } catch (e) {
      if (/permiso|sesión|ya no está disponible/.test(e.message)) {
        root.querySelector(".mail-reader")?.replaceChildren();
        root.querySelector(".mail-editor")?.replaceChildren();
        dirty = false;
        draft = null;
        selected = null;
        document.querySelector(".mail-toast-host")?.remove();
        show("list");
      }
      feedback(e.message, true);
    }
  }
  async function initialize() {
    if (
      initialized ||
      document.documentElement.dataset.adminAuthState !== "authorized"
    )
      return;
    initialized = true;
    await load();
    timer = setInterval(() => void pulse(), 30000);
  }
  new MutationObserver(() => void initialize()).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ["data-admin-auth-state"] },
  );
  void initialize();
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    void api("/push/logout", "POST").catch(() => {});
    void navigator.serviceWorker?.getRegistration("/").then(async (r) => {
      r?.active?.postMessage({ type: "CLEAR_MAIL_NOTIFICATIONS" });
      await (await r?.pushManager.getSubscription())?.unsubscribe();
    });
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith("cronox-mail-")) sessionStorage.removeItem(key);
    }
    if (timer) clearInterval(timer);
    document.querySelector(".mail-toast-host")?.remove();
  });
  window.CRONOX_INBOX = { load, hasUnsavedChanges: () => dirty };
})();
