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
    MAILBOX_NEW_MESSAGE_REQUIRES_CAMPAIGN:'Los nuevos mensajes se organizan como campañas. Para responder o reenviar, abre un mensaje recibido.',
    MAILBOX_CAMPAIGN_CAPACITY_WAITING:'En espera de capacidad de Información. Los destinatarios pendientes se conservan y continuarán después.',
    MAILBOX_CAMPAIGN_LEGACY_REVIEW_REQUIRED:'Campaña anterior bloqueada. Crea una nueva con familia y versiones por círculo; el original se conserva.',
    MAILBOX_LEGACY_CAMPAIGN_READ_ONLY:'El borrador anterior se conserva para consulta. Crea una nueva campaña con familia y círculos.',
    MAILBOX_CAMPAIGN_TEMPLATE_CONTENT_ONLY:'Una campaña usa solo su familia y evento: no admite redacción, destinatarios manuales ni cambios de remitente.',
    MAILBOX_MADRID_TIME_AMBIGUOUS: "Esta hora ocurre dos veces en Madrid. Elige UTC+02:00 o UTC+01:00.",
    MAILBOX_MADRID_TIME_DOES_NOT_EXIST: "Esta fecha u hora no existe en Madrid. Elige otra.",
    MAILBOX_SCHEDULE_IN_PAST: "La fecha de programación debe ser futura.",
    MAILBOX_TEMPLATE_VARIABLES_UNRESOLVED: "Faltan variables de la plantilla. Resuélvelas antes de enviar o programar.",
    MAILBOX_CAMPAIGN_PROVIDER_NOT_READY: "Campañas bloqueadas: confirma los límites del plan y la configuración del servidor.",
    MAILBOX_RECIPIENT_PREVIEW_CHANGED: "La selección o el borrador han cambiado. Revisa de nuevo el resumen.",
    MAILBOX_SENDER_CHANGE_REQUIRES_EMPTY_ATTACHMENTS: "Retira los adjuntos antes de cambiar el remitente y vuelve a añadirlos al buzón correcto.",
    MAILBOX_CAMPAIGN_CAPACITY_RESERVED_WAITING: "En espera de capacidad disponible; se conserva la reserva para correos transaccionales.",
    MAILBOX_CAMPAIGN_OWNER_OR_BOX_INACTIVE: "En espera: el administrador o el buzón está inactivo.",
    MAILBOX_CAMPAIGN_SEND_PERMISSION_REVOKED: "En espera: el administrador ya no tiene permiso de envío.",
    MAILBOX_CUSTOMER_ADDRESSES_IN_CONTENT: "El contenido o un adjunto incluye direcciones de clientes. Retíralas antes de enviar una comunicación común por círculos.",
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
    MAILBOX_BUSY: "No se ha liberado el buzón en 30 segundos. Puedes reintentar.",
    MAILBOX_CONTENT_DOWNLOAD_FAILED: "El proveedor no devolvió el contenido solicitado.",
    MAILBOX_CACHED_CONTENT_UNAVAILABLE: "No se pudo leer la copia privada del contenido.",
    MAILBOX_READ_STATE_NOT_CONFIRMED: "El proveedor no confirmó el cambio de leído.",
    MAILBOX_REPLY_CHOOSE_ONE: "Elige una única dirección para responder.",
    MAILBOX_REPLY_SINGLE_RECIPIENT_REQUIRED: "Una respuesta admite solo un destinatario y no permite CC ni CCO.",
    MAILBOX_REPLY_ADDRESS_UNAVAILABLE: "No hay una dirección válida para responder.",
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
    SCHEDULED: "Programado",
    COMPLETED: "Completado",
    CANCELLED: "Cancelado",
  };
  let overview = null,
    boxId = "",
    selectedFolders = null,
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
    listController = null,
    filterTimer = null,
    stateEpoch = 0,
    readSeq = 0,
    readController = null,
    noticeCursor = new Date().toISOString(),
    timer = null,
    initialized = false,
    loading = null;
  const seenNotices = new Set();
  async function api(path, method = "GET", data, signal) {
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
      { method, headers, body, signal, credentials: "include", cache: "no-store" },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.details?.join(' ') || codes[result.message] || `${result.message || "No se pudo completar la operación"} (${response.status})`);
      error.code = result.message;
      throw error;
    }
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
    invalidateReader();
    if (dirty && draft?.mode === 'campaign') {
      if (!window.confirm('Hay cambios de campaña sin guardar. ¿Quieres descartarlos?')) throw Error('Los cambios siguen en esta pestaña.');
      dirty = false;
    }
    if (dirty) {
      await save();
      if (dirty)
        throw Error("El texto no se ha guardado. Reintenta antes de salir.");
    }
    clearTimeout(saveTimer);
    window.CRONOX_ADMIN_SHELL?.release?.(root.querySelector('.mail-editor'));
  };
  function shell() {
    root.dataset.view = "list";
    root.innerHTML = `<div class="mail-toolbar"><h2>Correo</h2><button class="btn" data-compose>Nueva campaña</button><button class="btn" data-drafts>Borradores y salida</button>${overview.superadmin ? '<button class="btn" data-settings>Configuración</button>' : ""}</div><div data-feedback role="status" aria-live="polite"></div><div class="mail-notice" data-setup></div><div class="mail-layout"><aside class="mail-boxes" aria-label="Buzones"><div class="mail-box-links" data-boxes></div><hr><details class="mail-folder-filter"><summary>Carpetas <span class="mail-folder-arrow" aria-hidden="true">⌄</span></summary><div class="mail-folder-options"><div class="mail-actions"><button class="btn" type="button" data-folders-all>Recibidas</button><button class="btn" type="button" data-folders-clear>Limpiar</button></div><div data-folders></div></div></details><p class="mail-muted" data-box-status></p></aside><div class="mail-list"><form class="mail-filters"><label>Buscar<input data-search type="search" placeholder="Remitente, destinatario o asunto" maxlength="120"></label><label>Estado<select data-state><option value="all">Todos</option><option value="unread">No leídos</option><option value="read">Leídos</option></select></label></form><p class="mail-muted">Búsqueda solo sobre mensajes sincronizados. Los contadores reflejan la caché importada.</p><div data-messages aria-live="polite"></div><div data-pagination class="mail-pager"></div></div><div class="mail-reader" hidden></div><div class="mail-editor" hidden></div><div class="mail-settings" hidden></div></div>`;
    root.querySelector("[data-compose]").onclick = guard(() => compose());
    root.querySelector("[data-drafts]").onclick = guard(() => showDrafts());
    root.querySelector("[data-settings]")?.addEventListener(
      "click",
      guard(() => settings(boxId || undefined)),
    );
    const applyFilters = () => {
      clearTimeout(filterTimer);
      filterTimer = null;
      search = root.querySelector('[data-search]').value;
      state = root.querySelector('[data-state]').value;
      page = 1;
      return list();
    };
    root.querySelector('[data-search]').value = search;
    root.querySelector('[data-state]').value = state;
    root.querySelector('.mail-filters').onsubmit = guard(async event => { event.preventDefault(); await applyFilters(); });
    root.querySelector('[data-search]').oninput = () => {
      search = root.querySelector('[data-search]').value; page = 1;
      stateEpoch++; listSeq++; listController?.abort();
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => void applyFilters(), 250);
    };
    root.querySelector('[data-state]').onchange = guard(applyFilters);
    root.querySelector('[data-folders-all]').onclick = guard(async () => {
      selectedFolders = new Set(availableFolders().filter(f => !['\\Sent','\\Drafts'].includes(folderKind(f))).map(f => f.id)); page = 1; renderFolders(); await list();
    });
    root.querySelector('[data-folders-clear]').onclick = guard(async () => {
      selectedFolders = new Set(); page = 1; renderFolders(); await list();
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
          overview.encryptionConfigured ? "" : "Clave de cifrado pendiente.",
          overview.storageConfigured ? "" : "Almacenamiento privado pendiente.",
        ]
          .filter(Boolean)
          .join(" ") ||
        "Los buzones originales siguen en Hostinger. Abrir un mensaje lo marca leído; las importaciones no lo hacen.";
    const host = root.querySelector("[data-boxes]");
    host.innerHTML =
      `<button class="btn" data-box="" ${!boxId ? 'aria-current="true"' : ""}>Todos los buzones <small class="mail-unread ${total > 0 ? "has-unread" : ""}">${total} no leídos</small></button>` +
      overview.boxes
        .map(
          (b) =>
            `<button class="btn" data-box="${esc(b.id)}" ${boxId === b.id ? 'aria-current="true"' : ""}><strong>${esc(displayName(b))}</strong><small class="mail-address">${esc(b.address)}</small><small class="mail-unread ${b.unread > 0 ? "has-unread" : ""}">${b.unread} no leídos</small></button>`,
        )
        .join("");
    host.querySelectorAll("[data-box]").forEach(
      (b) =>
        (b.onclick = guard(async () => {
          await leave();
          boxId = b.dataset.box;

          page = 1;
          show("list");
          renderOverview();
          await list();
        })),
    );
    renderFolders();
    root.querySelector("[data-box-status]").textContent = box()
      ? `${status[box().status] || box().status}${!box().active ? " · Inactivo" : ""} · Última sincronización: ${date(box().lastSyncAt)}${box().errorCode ? " · " + (codes[box().errorCode] || box().errorCode) : ""}`
      : "Selecciona un buzón para ver su conexión y carpetas.";
    root.querySelector("[data-compose]").disabled = !overview.boxes.some(
      (b) => b.canSend,
    );
  }
  const mailboxLabel = name => /^no[ -]?reply$/i.test(name?.trim() || '') ? 'No-reply' : name;
  const displayName = b => {
    // Correct legacy default labels at presentation time, preserving custom names.
    if (mailboxLabel(b.name) === 'No-reply') return 'No-reply';
    if (b.address.toLowerCase() === 'no-reply@cronox.es' && b.name) return b.name;
    return { 'info@cronox.es':'Información', 'no-reply@cronox.es':'No-reply', 'orders@cronox.es':'Pedidos', 'support@cronox.es':'Soporte' }[b.address.toLowerCase()] || b.name;
  };
  function folderKind(f) {
    if (f.specialUse) return f.specialUse;
    const path = String(f.path).replace(/^INBOX[./]/i, '');
    if (/^INBOX$/i.test(path)) return '\\Inbox';
    if (/^(Sent|Sent Items|Sent Messages)$/i.test(path)) return '\\Sent';
    if (/^(Drafts|Draft)$/i.test(path)) return '\\Drafts';
    return null;
  }
  function folderLabel(f) {
    const special = {"\\Inbox":"Bandeja de entrada", "\\Sent":"Enviados", "\\Drafts":"Borradores", "\\Trash":"Papelera", "\\Junk":"Correo no deseado"};
    if (special[f.specialUse]) return special[f.specialUse];
    if (f.specialUse) return f.path;
    const name = String(f.path).replace(/^INBOX[./]/i, "").toLowerCase();
    return ({inbox:"Bandeja de entrada",sent:"Enviados","sent items":"Enviados","sent messages":"Enviados",drafts:"Borradores",trash:"Papelera","deleted items":"Papelera","deleted messages":"Papelera",junk:"Correo no deseado",spam:"Correo no deseado","junk e-mail":"Correo no deseado"})[name] || f.path;
  }
  function availableFolders() {
    return overview.boxes.filter(b => !boxId || b.id === boxId).flatMap(b => b.folders.map(f => ({...f, mailbox:displayName(b)})));
  }
  function renderFolders() {
    const folders = availableFolders();
    if (selectedFolders === null) selectedFolders = new Set(overview.boxes.flatMap(b => b.folders.filter(f => f.specialUse === '\\Inbox' || (!f.specialUse && f.path.toUpperCase() === 'INBOX')).map(f => f.id)));
    const host=root.querySelector('[data-folders]');
    host.innerHTML=folders.map(f=>`<label><span><input type="checkbox" data-folder-id="${esc(f.id)}" ${selectedFolders.has(f.id)?'checked':''}> ${esc(!boxId ? f.mailbox+' · '+folderLabel(f) : folderLabel(f))}${f.importBefore?' · importando':''}</span></label>`).join('') || '<p>No hay carpetas importadas.</p>';
    host.querySelectorAll('input').forEach(input=>input.onchange=guard(async()=>{if(input.checked)selectedFolders.add(input.dataset.folderId);else selectedFolders.delete(input.dataset.folderId);page=1;await list();}));
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
  function invalidateReader() {
    readSeq++; readController?.abort(); readController = null;
    selected = null; selectedMailboxId = null; feedback("");
  }
  function show(view) {
    if (view !== "read") invalidateReader();
    root.dataset.view = view;
    for (const v of ["reader", "editor", "settings"])
      root.querySelector(".mail-" + v).hidden = !(
        {
          read: "reader",
          compose: "editor",
          settings: "settings",
        }[view] === v
      );
  }
  async function list() {
    stateEpoch++;
    listController?.abort();
    listController = new AbortController();
    const seq = ++listSeq,
      host = root.querySelector("[data-messages]");
    if (!host) return;
    if (!availableFolders().some(f=>selectedFolders?.has(f.id))) {
      host.textContent='No hay carpetas seleccionadas. Marca una o varias para consultar mensajes.';
      root.querySelector('[data-pagination]').replaceChildren();return;
    }
    host.textContent = "Cargando mensajes…";
    const q = new URLSearchParams({
      mailboxId: boxId,
      folderIds: availableFolders().filter(f => selectedFolders?.has(f.id)).map(f => f.id).join(","),
      state,
      search,
      page: String(page),
    });
    try {
      const data = await api("/messages?" + q, "GET", undefined, listController.signal);
      if (seq !== listSeq) return;
      if (page > data.pagination.pages) { page = data.pagination.pages; return list(); }
      host.innerHTML = data.messages.length
        ? data.messages
            .map(
              (m) =>
                `<button class="mail-message ${m.seen === true ? "" : "unread"}" data-message="${esc(m.id)}" ${selected === m.id ? 'aria-current="true"' : ""}><span>${esc(m.sender || "Sin remitente")}</span><strong>${esc(m.subject)}</strong><small>${esc(m.preview || (m.bodyState === "LOADED" ? "Sin texto de vista previa" : m.bodyState === "FAILED" ? "Ha fallado la descarga. Abre el mensaje para reintentar." : "Contenido pendiente de descargar"))}${m.hasAttachments ? " · Adjuntos" : ""}</small><small>${esc(overview.boxes.find((b) => b.id === m.mailboxId)?.name || "Buzón")}</small><time>${esc(date(m.date))}</time></button>`,
            )
            .join("")
        : `<p>${state === 'unread' ? 'No hay correos no leídos para estos filtros.' : state === 'read' ? 'No hay correos leídos para estos filtros.' : 'No hay mensajes sincronizados para estos filtros.'}</p>`;
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
      if (seq === listSeq && e.name !== 'AbortError') {
        host.innerHTML =
          '<p class="mail-error">' +
          esc(e.message) +
          '</p><button class="btn" data-retry-list>Reintentar</button>';
        host.querySelector("[data-retry-list]").onclick = guard(list);
      }
    }
  }
  async function read(id) {
    await leave();
    show("read");
    selected = id;
    selectedMailboxId = null;
    const seq = ++readSeq;
    readController = new AbortController();
    const current = () => seq === readSeq && selected === id && root.dataset.view === "read";
    feedback("");
    const host = root.querySelector(".mail-reader");
    host.innerHTML = '<button class="btn" data-back>← Volver</button><p role="status" aria-busy="true">Descargando contenido sin imágenes externas… Si el buzón está sincronizando, esperamos un turno disponible (hasta 30 segundos).</p>';
    host.querySelector('[data-back]').onclick = () => show('list');
    try {
      const m = await api("/messages/" + id, "GET", undefined, readController.signal);
      if (!current()) return;
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
      host.innerHTML = `<button class="btn mail-back" data-back>← Volver a la lista</button><h3>${esc(m.subject)}</h3><dl><dt>Buzón</dt><dd>${esc(b?.address)}</dd><dt>De</dt><dd>${esc(joined(env.from))}</dd><dt>Para</dt><dd>${esc(joined(env.to))}</dd><dt>CC</dt><dd>${esc(joined(env.cc) || "—")}</dd>${env.replyTo?.length ? `<dt>Responder a (Reply-To)</dt><dd>${esc(joined(env.replyTo))}</dd>` : ""}<dt>Fecha</dt><dd>${esc(date(m.date))}</dd></dl><div class="mail-actions">${b?.canSend ? '<button class="btn" data-reply="reply">Responder</button><button class="btn" data-reply="forward">Reenviar</button>' : ""}<button class="btn" data-unread>Marcar como no leído</button>${b?.canSend ? '<button class="btn" data-trash>Mover a papelera</button>' : ""}</div>${m.replyChoices?.length > 1 ? `<label>Elige una única dirección para responder<select data-reply-choice><option value="">Selecciona una dirección</option>${m.replyChoices.map(address=>`<option value="${esc(address)}">${esc(address)}</option>`).join("")}</select></label>` : ""}<p data-read-state role="status"></p><p class="mail-muted">Imágenes remotas bloqueadas. Cargarlas puede revelar tu IP y la apertura al remitente.</p><button class="btn" data-images>Cargar imágenes externas</button><iframe title="Contenido aislado del mensaje" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe><div class="mail-files">${m.files.map((f) => `<a data-file="${esc(f.id)}" href="#">Descargar ${esc(f.name)} (${Math.ceil(f.size / 1024)} KB)</a>`).join("")}</div><p><a target="_blank" rel="noopener noreferrer" href="${b?.provider === "titan" ? "https://app.titan.email" : "https://mail.hostinger.com"}">Abrir el buzón original en Hostinger</a></p>`;
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
            (button.onclick = guard(() => {
              if (!current()) return;
              const chosen = host.querySelector('[data-reply-choice]')?.value;
              if (button.dataset.reply === 'reply' && m.replyChoices?.length > 1 && !chosen)
                throw Error("Elige una única dirección para responder.");
              return compose(m.mailboxId, m.id, button.dataset.reply, chosen);
            })),
        );
      const readerNotice = (text, failure = false) => {
        if (!current()) return;
        const notice = host.querySelector('[data-read-state]');
        notice.className = failure ? 'mail-error' : 'mail-muted'; notice.textContent = text;
      };
      let actionPending = false;
      const change = async operation => {
        if (!current() || actionPending) return;
        actionPending = true;
        stateEpoch++; listSeq++; listController?.abort();
        host.querySelectorAll('[data-unread],[data-trash]').forEach(button => button.disabled = true);
        readerNotice(operation === 'read' ? 'Contenido disponible. Actualizando el estado de leído…' : 'Esperando al buzón y actualizando el mensaje…');
        try {
          await api('/messages/' + id + '/action', 'POST', {operation});
          if (!current()) return;
          stateEpoch++; listSeq++; listController?.abort();
          const next = await api('/overview');
          if (!current()) return;
          overview = next; renderOverview();
          readerNotice(operation === 'read' ? 'Estado de leído confirmado por el proveedor.' : 'Marcado como no leído y confirmado por el proveedor.');
          host.querySelector('[data-retry-read]')?.remove();
          if (operation === 'trash') { show('list'); await list(); feedback('Movido a papelera.'); }
          else await list();
        } catch (error) {
          if (!current()) return;
          readerNotice((operation === 'read' ? 'Contenido disponible. No se ha confirmado el estado de leído: ' : 'No se ha confirmado la acción: ') + error.message, true);
          if (operation === 'read' && !host.querySelector('[data-retry-read]')) {
            const retry = document.createElement('button'); retry.className = 'btn'; retry.dataset.retryRead = ''; retry.textContent = 'Reintentar marcar leído';
            host.querySelector('[data-read-state]').after(retry); retry.onclick = () => void change('read');
          }
          await list();
        } finally {
          actionPending = false;
          if (current()) host.querySelectorAll('[data-unread],[data-trash]').forEach(button => button.disabled = !b?.active);
        }
      };
      host.querySelector('[data-unread]').onclick = () => void change('unread');
      host.querySelector('[data-trash]')?.addEventListener('click', () => void change('trash'));
      host.querySelectorAll("[data-file]").forEach(
        (link) =>
          (link.onclick = async (e) => {
            e.preventDefault();
            try { await download(link.dataset.file); }
            catch (error) { if (current()) readerNotice(error.message, true); }
          }),
      );
      if (!m.seen && b?.active) await change('read');
      else await list();
    } catch (e) {
      if (!current() || e.name === 'AbortError') return;
      const gone = ['MAILBOX_MESSAGE_UNAVAILABLE','MAILBOX_MESSAGE_NOT_FOUND','MAILBOX_UIDVALIDITY_CHANGED'].includes(e.code);
      host.innerHTML = `<button class="btn" data-back>← Volver</button><p class="mail-error">${gone ? 'El mensaje ya no está disponible en su ubicación original.' : 'Ha fallado la descarga del contenido: ' + esc(e.message)}</p>${gone ? '' : '<button class="btn" data-retry-body>Reintentar descarga</button>'}<p><a href="https://mail.hostinger.com" target="_blank" rel="noopener noreferrer">Consultar original en Hostinger</a></p>`;
      host.querySelector('[data-back]').onclick = () => show('list');
      host.querySelector('[data-retry-body]')?.addEventListener('click', guard(() => read(id)));
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
  async function compose(id = boxId, messageId, mode, replyRecipient) {
    await leave();
    const seq = readSeq;
    const chosen = messageId ? id : overview.boxes.find(b=>b.canSend && b.address.toLowerCase()==='info@cronox.es')?.id;
    if (!chosen) throw Error("No tienes permiso de envío en ningún buzón.");
    const created = messageId ? await api('/drafts', 'POST', {
      mailboxId: chosen, messageId, mode, ...(replyRecipient ? { replyRecipient } : {}),
    }) : { id: null, mailboxId: chosen, mode: 'campaign', revision: 1, status: 'DRAFT',
      campaignName: '', familyId: null, circles: [], campaignEvent: {}, files: [], campaigns: [], sends: [] };
    if (seq !== readSeq) return;
    draft = created;
    await renderComposer();
  }
  const recoveryKey = () => `cronox-mail-draft:${draft?.id}`;
  function values() {
    const form = root.querySelector(".mail-editor form");
    if (!draft || !form) return {};
    if (draft.mode === 'campaign') return {
      campaignName: form.elements.campaignName.value,
      familyId:form.elements.familyId.value || undefined,
      circles:[...form.querySelectorAll('[data-circle]:checked')].map(i=>Number(i.value)),
      variantId:Number(form.elements.variantId?.value) || undefined,
      revision:draft.revision,
    };
    return {
      to: form.elements.to?.value || "",
      cc: form.elements.cc?.value || "",
      bcc: form.elements.bcc?.value || "",
      mailboxId: form.elements.mailboxId?.value || draft.mailboxId,
      templateId: form.elements.templateId?.value || "",
      html: form.elements.html?.value || "",
      circles: [...form.querySelectorAll('[data-circle]:checked')].map(i=>Number(i.value)),
      subject: form.elements.subject.value,
      text: form.elements.text.value,
      revision: draft.revision,
    };
  }
  async function renderCampaign() {
    show('compose');
    dirty = false; editVersion = 0;
    const host = root.querySelector('.mail-editor'), currentDraft = draft, seq = readSeq;
    host.innerHTML = '<p role="status">Cargando campaña…</p>';
    const legacy = draft.mode === 'circles', locked = draft.status !== 'DRAFT';
    const options = legacy ? { families: [], variants: [] } : await api('/boxes/' + draft.mailboxId + '/campaign-options');
    if (draft !== currentDraft || readSeq !== seq) return;
    const campaign = draft.campaigns?.find(c => c.status !== 'CANCELLED') || (locked ? draft.campaigns?.[0] : null);
    host.innerHTML = `<button class="btn" data-back>← Volver</button><h3>${legacy ? 'Campaña anterior' : locked ? 'Salida de campaña' : 'Campaña'}</h3><p>Remitente fijo: <strong>info@cronox.es</strong></p>
      ${legacy ? '<p class="mail-notice">El contenido anterior se conserva para consulta. Crea una campaña con familia y versiones por círculo.</p>' : `<form id="mailCampaignForm">
      <label>Nombre de la campaña<input name="campaignName" maxlength="160" value="${esc(draft.campaignName || '')}" ${locked ? 'readonly' : ''}><small>Identificación interna; no se incluye en el correo del cliente.</small></label>
      <label>Familia de plantillas<select name="familyId" ${locked ? 'disabled' : ''}><option value="">Selecciona una familia</option>${options.families.map(f => `<option value="${esc(f.id)}" ${f.id === draft.familyId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <fieldset><legend>Círculos destinatarios</legend>${[1,2,3,4,5].map(c => `<label><span><input type="checkbox" data-circle value="${c}" ${draft.circles?.includes(c) ? 'checked' : ''} ${locked ? 'disabled' : ''}> Círculo ${c}</span></label>`).join('')}</fieldset>
      <label data-event hidden>Producto y talla repuestos<select name="variantId" ${locked ? 'disabled' : ''}><option value="">Selecciona una talla disponible</option>${options.variants.map(v => `<option value="${v.id}" ${v.id === draft.campaignEvent?.variantId ? 'selected' : ''}>${esc(v.name + ' · ' + v.size)}</option>`).join('')}</select></label>
      <p>Contenido procedente de Plantillas Mail. Se revisan las bajas y el círculo antes de cada entrega.</p>
      <p data-save-state role="status">${draft.id ? 'Borrador guardado' : 'Campaña sin guardar'}</p>
      ${locked ? '' : `<div class="mail-actions"><button class="btn" type="button" data-save>Guardar borrador</button><button class="btn" type="button" data-export-recipients disabled>Exportar destinatarios a Excel</button></div>
      <label>Fecha y hora · Europe/Madrid<input type="datetime-local" data-schedule></label>
      <label>Hora repetida en invierno<select data-offset><option value="">Automática (hora única)</option><option value="+02:00">Primera ocurrencia · UTC+02:00</option><option value="+01:00">Segunda ocurrencia · UTC+01:00</option></select></label><p data-date-state role="status"></p>
      <div class="mail-actions"><button class="btn" type="button" data-send disabled>Enviar ahora</button><button class="btn" type="button" data-schedule-send disabled>Programar envío</button></div>`}</form>`}
      <p data-audience-count role="status"></p><div data-campaign-review></div><div data-send-result></div>
      ${campaign ? `<div class="mail-actions">${!legacy ? `<button class="btn" data-campaign-edit ${campaign.startedAt || campaign.status !== 'SCHEDULED' ? 'disabled' : ''}>Editar programación</button>` : ''}<button class="btn" data-campaign-cancel ${!['SCHEDULED','PROCESSING'].includes(campaign.status) ? 'disabled' : ''}>Cancelar campaña</button></div>` : ''}`;
    const form = host.querySelector('form');
    let plan = null, audienceSeq = 0, dateSeq = 0, dateValid = false, sending = false, audienceController, audienceTimer;
    // Stable even after edits following a lost response: retries recover the
    // original requested campaign instead of enqueueing a second one.
    const requestKey = crypto.randomUUID();
    const current = () => draft === currentDraft && root.dataset.view === 'compose' && readSeq === seq;
    const selectionQuery = () => {
      const data = values();
      return new URLSearchParams({ familyId: data.familyId || '', circles: data.circles.join(','), revision: String(draft.revision), ...(data.variantId ? { variantId: String(data.variantId) } : {}) });
    };
    const updateButtons = () => {
      const valid = !sending && !!plan && plan.count > 0 && !plan.blocked.length && plan.policy.ready && overview.sendEnabled && overview.workerEnabled && overview.boxes.find(b => b.id === draft.mailboxId)?.active;
      const send = host.querySelector('[data-send]'), schedule = host.querySelector('[data-schedule-send]');
      if (send) send.disabled = !valid;
      if (schedule) schedule.disabled = !valid || !dateValid;
      const exp = host.querySelector('[data-export-recipients]');
      if (exp) exp.disabled = sending || !plan || !form.elements.familyId.value || !values().circles.length;
    };
    const renderPlan = result => {
      host.querySelector('[data-audience-count]').textContent = `${result.count} destinatarios válidos y únicos`;
      const target = host.querySelector('[data-campaign-review]');
      target.innerHTML = `${result.blocked.map(x => `<p class="mail-notice">${esc(x)}</p>`).join('')}${result.previews.map(p => `<details><summary>Círculo ${p.circle} · ${p.count} destinatarios${p.missing ? ' · Falta la versión' : ''}</summary>${p.missing ? '' : `<p>Asunto: ${esc(p.subject)}</p><iframe data-preview-circle="${p.circle}" sandbox="" referrerpolicy="no-referrer" title="Vista previa de círculo ${p.circle}" style="width:100%;height:360px;border:0"></iframe>`}</details>`).join('')}<p class="mail-muted">${esc(result.policy.reasons.join(' '))}</p>`;
      result.previews.forEach(p => { const frame = target.querySelector(`[data-preview-circle="${p.circle}"]`); if (frame) frame.srcdoc = p.html || ''; });
    };
    const refreshAudience = async () => {
      if (!current()) return;
      clearTimeout(audienceTimer); audienceController?.abort(); audienceController = new AbortController();
      const token = ++audienceSeq; plan = null; updateButtons();
      if (!form.elements.familyId.value || !values().circles.length) {
        host.querySelector('[data-audience-count]').textContent = 'Selecciona una familia y al menos un círculo para calcular destinatarios.';
        host.querySelector('[data-campaign-review]').replaceChildren(); return;
      }
      host.querySelector('[data-audience-count]').textContent = 'Calculando destinatarios…';
      try {
        const result = await api('/boxes/' + draft.mailboxId + '/campaign-audience?' + selectionQuery(), 'GET', undefined, audienceController.signal);
        if (!current() || token !== audienceSeq) return;
        plan = result; renderPlan(result); updateButtons();
      } catch (error) {
        if (!current() || token !== audienceSeq || error.name === 'AbortError') return;
        host.querySelector('[data-audience-count]').textContent = 'No se ha podido calcular los destinatarios. ' + error.message;
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Reintentar cálculo';
        retry.onclick = () => void refreshAudience(); host.querySelector('[data-campaign-review]').replaceChildren(retry);
      }
    };
    const validateDate = async () => {
      if (!current()) return;
      const token = ++dateSeq; dateValid = false; updateButtons();
      const localDate = host.querySelector('[data-schedule]').value, offset = host.querySelector('[data-offset]').value;
      if (!localDate) { host.querySelector('[data-date-state]').textContent = ''; return; }
      try {
        const result = await api('/schedule-preview?' + new URLSearchParams({ localDate, ...(offset ? { offset } : {}) }));
        if (!current() || token !== dateSeq) return;
        dateValid = new Date(result.scheduledAt) > new Date();
        host.querySelector('[data-date-state]').textContent = dateValid ? 'Envío: ' + date(result.scheduledAt) + ' · Europe/Madrid' : 'La fecha debe ser futura.';
      } catch (error) {
        if (!current() || token !== dateSeq) return;
        host.querySelector('[data-date-state]').textContent = error.message;
      }
      updateButtons();
    };
    host.querySelector('[data-back]').onclick = guard(async () => { await leave(); show('list'); await list(); });
    if (legacy) {
      host.querySelector('[data-campaign-review]').innerHTML = `<details><summary>Consultar contenido anterior</summary><strong>${esc(draft.subject)}</strong><pre style="white-space:pre-wrap">${esc(draft.text)}</pre><p>Adjuntos conservados: ${esc(draft.files.map(f => f.name).join(', ') || 'Ninguno')}</p></details>`;
    } else if (locked && campaign) {
      const saved = await api('/campaigns/' + campaign.id);
      if (!current()) return;
      host.querySelector('[data-audience-count]').textContent = `${status[saved.status] || saved.status} · ${saved.count} destinatarios · ${date(saved.scheduledAt)} · Europe/Madrid`;
      host.querySelector('[data-campaign-review]').innerHTML = `<h4>${esc(saved.familyName)}</h4>${saved.previews.map(p => `<details><summary>Círculo ${p.circle} · ${esc(p.subject)}</summary><iframe data-frozen-circle="${p.circle}" sandbox="" referrerpolicy="no-referrer" title="Contenido aprobado de círculo ${p.circle}" style="width:100%;height:360px;border:0"></iframe></details>`).join('')}`;
      saved.previews.forEach(p => { host.querySelector(`[data-frozen-circle="${p.circle}"]`).srcdoc = p.html || ''; });
    }
    if (form && !locked) {
      const eventVisibility = () => { host.querySelector('[data-event]').hidden = options.families.find(f => f.id === form.elements.familyId.value)?.eventKind !== 'RESTOCK'; };
      eventVisibility();
      form.onsubmit = event => event.preventDefault();
      const changed = event => {
        if (sending) return;
        if (event.target.matches('[data-schedule],[data-offset]')) { void validateDate(); return; }
        dirty = true; editVersion++;
        host.querySelector('[data-save-state]').textContent = 'Cambios sin guardar';
        if (event.target.name === 'campaignName') return;
        eventVisibility(); plan = null; audienceSeq++; audienceController?.abort(); updateButtons();
        host.querySelector('[data-campaign-review]').replaceChildren();
        host.querySelector('[data-audience-count]').textContent = 'Calculando destinatarios…';
        clearTimeout(audienceTimer); audienceTimer = setTimeout(() => void refreshAudience(), 180);
      };
      form.addEventListener('input', changed);
      // Select changes are also emitted on older touch browsers without input.
      form.addEventListener('change', changed);
      host.querySelector('[data-save]').onclick = guard(async () => {
        if (sending || savePromise) return;
        const button = host.querySelector('[data-save]'); button.disabled = true;
        try { await save(); await refreshAudience(); } finally { if (button.isConnected) button.disabled = false; }
      });
      host.querySelector('[data-export-recipients]').onclick = guard(async () => {
        const query = selectionQuery();
        const response = await fetch((window.CRONOX_API?.API_BASE || '') + '/api/admin/mailbox/boxes/' + draft.mailboxId + '/campaign-recipients.xlsx?' + query, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw Error('No se pudo exportar los destinatarios.');
        const url = URL.createObjectURL(await response.blob()), a = document.createElement('a');
        a.href = url; a.download = 'CRONOX-destinatarios.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        // The audience can change after export; it never grants sending permission.
        await refreshAudience();
      });
      const send = async scheduled => {
        if (sending || savePromise || !plan || plan.blocked.length || !plan.count) return;
        if (scheduled) { await validateDate(); if (!dateValid || sending) return; }
        sending = true; updateButtons();
        const data = values(), approved = plan, key = requestKey;
        const localDate = host.querySelector('[data-schedule]').value, offset = host.querySelector('[data-offset]').value;
        const freeze = disabled => { form.querySelectorAll('input,select,[data-save],[data-export-recipients]').forEach(el => { el.disabled = disabled; }); };
        freeze(true);
        try {
          const confirmed = await new Promise(resolve => {
            const modal = document.createElement('dialog'); modal.className = 'mail-campaign-confirm';
            modal.innerHTML = `<h3>${scheduled ? '¿Seguro que quieres programar esta campaña?' : '¿Seguro que quieres enviar esta campaña ahora?'}</h3><p>Nombre: <strong>${esc(data.campaignName || 'Campaña sin nombre')}</strong></p><p>Familia: ${esc(approved.family.name)}</p><p>Círculos: ${data.circles.join(', ')}</p><p>${approved.count} destinatarios válidos y únicos</p>${scheduled ? `<p>${esc(localDate)} · Europe/Madrid</p>` : ''}<p data-confirm-error role="alert"></p><div class="mail-actions"><button class="btn" type="button" data-confirm>Confirmar envío</button><button class="btn" type="button" data-cancel>Cancelar</button></div>`;
            document.body.append(modal); modal.showModal(); modal.querySelector('[data-cancel]').focus();
            const finish = value => { modal.close(); modal.remove(); resolve(value); };
            modal.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            modal.querySelector('[data-cancel]').onclick = () => finish(false);
            modal.querySelector('[data-confirm]').onclick = () => finish(true);
          });
          if (!confirmed || !current()) return;
          const result = await api('/boxes/' + draft.mailboxId + '/campaign', 'POST', {
            ...data, ...(draft.id ? { draftId: draft.id } : {}), requestKey: key, previewHash: approved.previewHash,
            ...(scheduled ? { localDate, ...(offset ? { offset } : {}) } : {}),
          });
          if (!current()) return;
          dirty = false;
          draft = await api('/drafts/' + result.draftId);
          document.dispatchEvent(new CustomEvent('cronox:admin-saved', { detail: { container: host } }));
          await renderComposer(); feedback('Campaña confirmada. El progreso se guarda en el servidor.');
        } catch (error) { feedback(error.message, true); }
        finally {
          sending = false;
          if (current()) { freeze(false); await refreshAudience(); await validateDate(); }
        }
      };
      host.querySelector('[data-send]').onclick = () => void send(false);
      host.querySelector('[data-schedule-send]').onclick = () => void send(true);
      await refreshAudience();
    }
    for (const action of ['edit','cancel']) host.querySelector('[data-campaign-' + action + ']')?.addEventListener('click', guard(async () => {
      if (!window.confirm(action === 'edit' ? 'Cancelar la programación y volver al borrador. ¿Continuar?' : 'Cancelar las entregas pendientes. ¿Continuar?')) return;
      await api('/campaigns/' + campaign.id + '/' + action, 'POST');
      draft = await api('/drafts/' + draft.id); await renderComposer();
    }));
    if (form) window.CRONOX_ADMIN_SHELL?.capture?.(host);
  }
  async function renderComposer() {
    if (draft.mode === 'campaign' || draft.mode === 'circles') return renderCampaign();
    show("compose");
    const host = root.querySelector(".mail-editor"),
      b = overview.boxes.find((b) => b.id === draft.mailboxId),
      locked = draft.status !== "DRAFT";
    dirty = false;
    editVersion = 0;
    const composerDraftId=draft.id;
    host.innerHTML = '<p role="status" aria-busy="true">Cargando borrador…</p>';
    const templates = []; // Replies and forwards do not use campaign templates.
    if(draft?.id!==composerDraftId)return;
    const campaign = draft.campaigns?.[0];
    host.innerHTML = `<button class="btn mail-back" data-back>← Volver</button><h3>${locked ? "Bandeja de salida" : "Borrador"}</h3>
      <label hidden>Plantilla<select name="templateId" form="mailComposerForm" ${locked?'disabled':''}><option value="">Sin plantilla</option>${templates.map(t=>`<option value="${esc(t.id)}" ${draft.templateId===t.id?'selected':''}>${esc(t.folder.name+' · '+t.name)}</option>`).join('')}</select></label>
      <form id="mailComposerForm"><label>Remitente${draft.mode==='circles'?`<select name="mailboxId" ${locked || draft.files.length?'disabled':''} title="Retira los adjuntos antes de cambiar el remitente">${overview.boxes.filter(x=>x.canSend).map(x=>`<option value="${esc(x.id)}" ${x.id===draft.mailboxId?'selected':''}>${esc(displayName(x)+' · '+x.address)}</option>`).join('')}</select>`:`<strong>${esc(b?.fromName)} &lt;${esc(b?.address)}&gt;</strong>`}</label>
      ${draft.mode==='circles'?`<fieldset><legend>Círculos · comunicación a suscriptores</legend>${[1,2,3,4,5].map(c=>`<label><span><input type="checkbox" data-circle value="${c}" ${draft.circles?.includes(c)?'checked':''} ${locked?'disabled':''}> Círculo ${c}</span></label>`).join('')}<p>Solo destinatarios únicos con suscripción activa. La pertenencia a un círculo no concede permiso publicitario. Exclusivamente CCO.</p><button class="btn" type="button" data-recipient-preview>Revisar destinatarios</button><p data-recipient-summary role="status"></p></fieldset>`:`<div class="mail-addresses"><label>Para${draft.singleReply ? " · una única dirección" : ""}<input name="to" value="${esc(draft.to)}" ${locked?'disabled':''}></label>${draft.singleReply ? "" : `<label>CC<input name="cc" value="${esc(draft.cc)}" ${locked?'disabled':''}></label>`}</div>${draft.singleReply ? "" : `<label>CCO<input name="bcc" value="${esc(draft.bcc)}" ${locked?'disabled':''}></label>`}` }
      <label>Asunto<input name="subject" value="${esc(draft.subject)}" maxlength="500" ${locked?'disabled':''}></label>
      <label>Versión de texto del mensaje<textarea name="text" ${locked?'disabled':''}>${esc(draft.text)}</textarea></label>
      <p>Puedes editar el diseño del mensaje y revisar su versión de texto. Los cambios se guardan en este borrador.</p>${!locked?'<button class="btn" type="button" data-edit-design>Editar diseño</button><iframe data-design-editor title="Editar diseño del borrador" sandbox="allow-same-origin" referrerpolicy="no-referrer" hidden></iframe>':''}<details><summary>Edición avanzada del HTML</summary><label>HTML<textarea name="html" ${locked?'disabled':''}>${esc(draft.html||'')}</textarea></label><p>El texto y HTML son versiones independientes. Si editas una, revisa también la otra.</p></details>
      <button class="btn" type="button" data-preview>Previsualizar mensaje</button><iframe data-compose-preview title="Vista previa aislada" sandbox="" referrerpolicy="no-referrer" hidden></iframe>
      <div data-draft-files class="mail-files"></div>${locked?'':'<label>Añadir adjuntos<input data-upload type="file" multiple></label>'}
      ${!locked && draft.mode==='circles'?'<label>Fecha y hora · Europe/Madrid<input type="datetime-local" data-schedule></label><label>Hora repetida al cambiar al horario de invierno<select data-offset><option value="">Automática (hora única)</option><option value="+02:00">Primera ocurrencia · UTC+02:00</option><option value="+01:00">Segunda ocurrencia · UTC+01:00</option></select></label><p>Al confirmar se fija la lista prevista y el contenido, incluidos los adjuntos. Antes de cada entrega se comprueban de nuevo las bajas. Revisa que el contenido y los archivos no incluyan direcciones de otros clientes.</p>':''}
      <p class="mail-saved" data-save-state role="status">${esc(status[draft.status]||draft.status)}</p><div class="mail-actions">
      ${locked?(campaign?`<button class="btn" type="button" data-campaign-edit ${campaign.startedAt || campaign.status!=='SCHEDULED'?'disabled':''}>Editar programación</button><button class="btn" type="button" data-campaign-cancel ${!['SCHEDULED','PROCESSING'].includes(campaign.status)?'disabled':''}>Cancelar envío</button>`:'<button class="btn" type="button" data-clone>Crear nuevo borrador para revisar o reenviar</button>'):'<button class="btn" type="button" data-save>Guardar borrador</button><button class="btn" type="submit" data-send>Enviar ahora</button>'+(draft.mode==='circles'?'<button class="btn" type="button" data-schedule-send>Programar envío</button>':'')}
      <button class="btn" type="button" data-close-editor>Volver a la lista</button></div></form><div data-send-result></div><button class="btn" data-recover hidden>Recuperar texto no guardado de esta pestaña</button>`;
    host.querySelector('[data-edit-design]')?.addEventListener('click',()=>{
      const editor=host.querySelector('[data-design-editor]');editor.hidden=false;
      editor.onload=()=>{
        const doc=editor.contentDocument;if(!doc)return;doc.body.contentEditable='true';
        doc.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
        doc.addEventListener('paste',event=>{event.preventDefault();doc.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});
        doc.addEventListener('input',()=>{
          const form=host.querySelector('form');form.elements.html.value=doc.documentElement.outerHTML;
          const urls=[...new Set([...doc.body.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(Boolean))];
          form.elements.text.value=doc.body.innerText+(urls.length?'\n\n'+urls.join('\n'):'');
          form.dispatchEvent(new Event('input',{bubbles:true}));
        });
      };
      editor.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{overflow-wrap:anywhere;min-height:200px}img{max-width:100%}table{max-width:100%}</style>${values().html||'<p>'+esc(values().text).replace(/\n/g,'<br>')+'</p>'}`;
    });
    host.querySelector('[data-preview]').onclick=()=>{
      const f=host.querySelector('[data-compose-preview]');f.hidden=false;f.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{overflow-wrap:anywhere}img{max-width:100%}table{max-width:100%}</style>${values().html||'<pre>'+esc(values().text)+'</pre>'}`;
    };
    host.querySelector('[data-recipient-preview]')?.addEventListener('click',guard(async()=>{await save();const summary=await api('/drafts/'+draft.id+'/recipients');host.querySelector('[data-recipient-summary]').textContent=`Círculos ${summary.circles.join(', ')||'ninguno'} · ${summary.count} destinatarios válidos y únicos. ${summary.policy.reasons.join(' ')}`;}));
    host.querySelector('[name=templateId]').onchange=guard(async event=>{
      if(locked)return;clearTimeout(saveTimer);if(savePromise)await savePromise;const id=event.target.value;
      if(id && (values().subject || values().text || values().html) && !confirm('Aplicar esta plantilla sustituirá el asunto, texto y HTML editados. ¿Continuar?')){event.target.value=draft.templateId||'';return;}
      let applied=false;try {
      if(id){let result=await api('/boxes/'+draft.mailboxId+'/template','POST',{templateId:id});
        if(result.variables.length){const variables=await templateVariables(result.variables);if(!variables){event.target.value=draft.templateId||'';return;}result=await api('/boxes/'+draft.mailboxId+'/template','POST',{templateId:id,variables});}
        const form=host.querySelector('form');form.elements.subject.value=result.subject;form.elements.text.value=result.text;form.elements.html.value=result.html;}
      applied=true;dirty=true;editVersion++;await save();host.querySelector('[data-preview]').click();
      }catch(error){if(!applied)event.target.value=draft.templateId||'';throw error;}
    });
    host.querySelector('[name=mailboxId]')?.addEventListener('change',guard(async event=>{
      clearTimeout(saveTimer);if(savePromise)await savePromise;
      if(draft.files.length){event.target.value=draft.mailboxId;throw Error(codes.MAILBOX_SENDER_CHANGE_REQUIRES_EMPTY_ATTACHMENTS);}
      if(!confirm('Cambiar el remitente actualizará las plantillas y quitará la selección actual. El contenido se conserva para revisarlo.')){event.target.value=draft.mailboxId;return;}
      host.querySelector('[name=templateId]').value='';dirty=true;editVersion++;await save();await renderComposer();
    }));
    for(const action of ['edit','cancel'])host.querySelector('[data-campaign-'+action+']')?.addEventListener('click',guard(async()=>{
      if(!confirm(action==='edit'?'Volver a borrador y cancelar esta programación para editarla y confirmar de nuevo.':'Cancelar entregas pendientes. Las ya aceptadas o en curso no se pueden retirar. ¿Continuar?'))return;
      await api('/campaigns/'+campaign.id+'/'+action,'POST');draft=await api('/drafts/'+draft.id);await renderComposer();
    }));
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
        await renderComposer();
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
        await renderComposer();
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
      ["to", "cc", "bcc", "subject", "text", "html"].some(
        (k) => recover[k] !== draft[k],
      )
    ) {
      host.querySelector("[data-recover]").hidden = false;
      host.querySelector("[data-recover]").onclick = () => {
        for (const k of ["to", "cc", "bcc", "subject", "text", "html"])
          if(host.querySelector("form").elements[k]) host.querySelector("form").elements[k].value = recover[k] || "";
        const f=host.querySelector('form');
        if(f.elements.mailboxId && recover.mailboxId===draft.mailboxId)f.elements.mailboxId.value=recover.mailboxId;
        if(f.elements.templateId && [...f.elements.templateId.options].some(o=>o.value===recover.templateId))f.elements.templateId.value=recover.templateId;
        f.querySelectorAll('[data-circle]').forEach(i=>i.checked=(recover.circles||draft.circles||[]).includes(Number(i.value)));
        dirty = true;
        editVersion++;
        host.querySelector("[data-save-state]").textContent =
          "Texto recuperado. Guarda antes de salir.";
        host.querySelector("[data-recover]").hidden = true;
      };
    }
  }
  function templateVariables(paths) {
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='mail-variable-dialog';
      const itemFields=['name','quantity','variantName','imageUrl','lineTotalFormatted'];
      const hasItems=paths.includes('items'),localFields=hasItems?paths.filter(p=>itemFields.includes(p)):[];
      const fields=paths.filter(p=>p!=='items'&&!localFields.includes(p));
      const labels={subject:'Asunto',title:'Título',message:'Mensaje',actionUrl:'Enlace de la acción',actionLabel:'Texto de la acción',customerEmail:'Correo del cliente',customerFullName:'Nombre del cliente',orderId:'Número de pedido',orderUrl:'Enlace del pedido',storeUrl:'Enlace de la tienda',supportCaseId:'Referencia de soporte',trackingNumber:'Seguimiento',shippingCarrier:'Transportista'};
      dialog.innerHTML=`<form method="dialog"><h3>Completar datos de la plantilla</h3><p>Estos valores solo componen el mensaje. No ejecutan acciones ni generan accesos o credenciales. Revisa el resultado antes de enviarlo.</p>${fields.map(p=>`<label>${esc(labels[p]||p)}<textarea data-variable="${esc(p)}"></textarea></label>`).join('')}${hasItems?'<fieldset><legend>Artículos</legend><div data-items></div><button class="btn" type="button" data-add-item>Añadir artículo</button></fieldset>':''}<button class="btn" value="cancel">Cancelar</button><button class="btn" value="apply">Aplicar valores y previsualizar</button></form>`;
      root.append(dialog);
      dialog.querySelector('[data-add-item]')?.addEventListener('click',()=>{
        const row=document.createElement('fieldset');row.dataset.item='';row.innerHTML=localFields.map(p=>`<label>${esc(({name:'Nombre',quantity:'Cantidad',variantName:'Variante',imageUrl:'Imagen HTTPS',lineTotalFormatted:'Importe de la línea'})[p]||p)}<input data-item-field="${esc(p)}" ${p==='quantity'?'type="number" min="1" value="1"':''}></label>`).join('')+'<button class="btn" type="button" data-remove-item>Quitar artículo</button>';dialog.querySelector('[data-items]').append(row);row.querySelector('[data-remove-item]').onclick=()=>row.remove();
      });
      dialog.addEventListener('close',()=>{
        if(dialog.returnValue!=='apply'){dialog.remove();resolve(null);return;}
        const data={};for(const input of dialog.querySelectorAll('[data-variable]')){
          const parts=input.dataset.variable.split('.');let target=data;
          parts.slice(0,-1).forEach(p=>{target[p]||={};target=target[p];});target[parts.at(-1)]=input.value;
        }
        if(hasItems)data.items=[...dialog.querySelectorAll('[data-item]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-item-field]')].map(i=>[i.dataset.itemField,i.dataset.itemField==='quantity'?Number(i.value):i.value])));
        dialog.remove();resolve(data);
      },{once:true});dialog.showModal();
    });
  }
  function renderFiles() {
    const host = root.querySelector("[data-draft-files]");
    if (!host) return;
    const sender=root.querySelector('.mail-editor [name=mailboxId]');
    if(sender)sender.disabled=draft.status!=='DRAFT'||!!draft.files.length;
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
    const campaign=draft.campaigns?.find(c=>c.status!=='CANCELLED') || (draft.status!=='DRAFT'?draft.campaigns?.[0]:null);
    if(campaign) {
      void api('/campaigns/'+campaign.id).then(c=>{if(!draft?.campaigns?.some(x=>x.id===c.id))return;
        host.innerHTML=`<div class="mail-notice"><strong>${esc(status[c.status]||c.status)}</strong><p>${esc(date(c.scheduledAt))} · Europe/Madrid · ${c.count} previstos</p>${c.errorCode?`<p>${esc(codes[c.errorCode]||c.errorCode)}</p>`:""}${!c.policy.ready?`<p>${esc(c.policy.reasons.join(" "))}</p>`:""}<p>${c.progress.map(g=>esc(((g.circle?'C\u00edrculo '+g.circle+' \u00b7 ':'')+ (status[g.status]||({EXCLUDED:'Excluidos por bajas o restricciones'}[g.status])||g.status))+': '+g.count)).join(' · ')}</p><p>SMTP aceptado no confirma entrega final. Los resultados inciertos no se reenvían. Cancelar detiene los pendientes; las entregas en curso podrían ser aceptadas.</p></div>`;
      }).catch(e=>feedback(e.message,true));return;
    }
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
    if (!draft || draft.status !== "DRAFT") return;
    if (draft.mode === 'campaign') {
      if (savePromise) return savePromise;
      const version = editVersion, data = values();
      savePromise = (async () => {
        const result = await api('/boxes/' + draft.mailboxId + '/campaign-draft', 'POST', {
          ...data, ...(draft.id ? { draftId: draft.id } : {}),
        });
        Object.assign(draft, result);
        if (version === editVersion) {
          dirty = false;
          root.querySelector('[data-save-state]').textContent = 'Borrador guardado';
          document.dispatchEvent(new CustomEvent('cronox:admin-saved', { detail: { container: root.querySelector('.mail-editor') } }));
        }
      })().finally(() => { savePromise = null; });
      return savePromise;
    }
    if (!dirty) return;
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
  async function showDrafts(view = 'drafts') {
    await leave();
    draft = null; dirty = false;
    show('compose');
    const host = root.querySelector('.mail-editor'), seq = readSeq;
    host.setAttribute('aria-busy', 'true');
    let rows;
    try { rows = await api('/drafts?view=' + view); }
    finally { host.removeAttribute('aria-busy'); }
    if (readSeq !== seq || root.dataset.view !== 'compose') return;
    const title = { drafts: 'Borradores', outbox: 'Salidas', history: 'Historial' }[view];
    host.innerHTML = `<button class="btn" data-back>← Volver</button><h3>${title}</h3><div class="mail-actions" aria-label="Listas de campañas">${[['drafts','Borradores'],['outbox','Salidas'],['history','Historial']].map(([key,label]) => `<button class="btn" type="button" data-campaign-list="${key}" aria-pressed="${key === view}">${label}</button>`).join('')}</div><p class="mail-muted">${view === 'drafts' ? 'Campañas guardadas, sin envío solicitado ni programación activa. Los borradores anteriores se conservan.' : view === 'outbox' ? 'Envíos confirmados, programados o pendientes de su turno.' : 'Envíos completados, cancelados o con incidencias; se conserva el historial.'}</p>` +
      (rows.length ? rows.map(d => {
        const campaign = d.campaigns?.[0], send = d.sends?.[0];
        const name = d.campaignName || (['campaign','circles'].includes(d.mode) ? (d.mode === 'circles' ? 'Campaña anterior · ' : 'Campaña sin nombre · ') + d.id.slice(0,8) + (d.subject ? ' · ' + d.subject : '') : d.subject || 'Mensaje sin asunto');
        return `<div class="mail-draft-row"><button class="mail-message" data-draft="${esc(d.id)}" ${view === 'history' && campaign ? `data-history-campaign="${esc(campaign.id)}"` : ''}><strong>${esc(name)}</strong>${d.mode === 'circles' ? '<span>Campaña anterior · solo consulta</span>' : ''}<small>${esc(overview.boxes.find(b => b.id === d.mailboxId)?.address)} · ${esc(status[view === 'drafts' ? 'DRAFT' : campaign?.status || send?.status || d.status] || d.status)}</small><time>${esc(date(view === 'outbox' ? campaign?.scheduledAt || d.updatedAt : d.updatedAt))}${campaign ? ' · Europe/Madrid' : ''}</time></button>${view === 'drafts' && d.status === 'DRAFT' ? `<button class="btn mail-draft-delete" type="button" data-delete-draft="${esc(d.id)}" aria-label="Eliminar borrador: ${esc(name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>` : ''}</div>`;
      }).join('') : `<p>No hay ${title.toLowerCase()} para mostrar.</p>`);
    host.querySelector('[data-back]').onclick = () => show('list');
    host.querySelectorAll('[data-campaign-list]').forEach(button => { button.onclick = guard(() => showDrafts(button.dataset.campaignList)); });
    host.querySelectorAll('[data-draft]').forEach(button => { button.onclick = guard(async () => {
      if (button.dataset.historyCampaign) return showCampaignHistory(button.dataset.historyCampaign);
      const current = await api('/drafts/' + button.dataset.draft);
      if (readSeq !== seq) return;
      draft = current; await renderComposer();
    }); });
    host.querySelectorAll('[data-delete-draft]').forEach(button => { button.onclick = guard(async () => {
      const row = rows.find(d => d.id === button.dataset.deleteDraft);
      const confirmed = await new Promise(resolve => {
        const modal = document.createElement('dialog'); modal.className = 'mail-campaign-confirm';
        modal.setAttribute('aria-labelledby', 'deleteDraftTitle');
        modal.innerHTML = `<h3 id="deleteDraftTitle">Eliminar borrador</h3><p>¿Eliminar este borrador? Esta acción no se puede deshacer.</p><div class="mail-actions"><button class="btn" type="button" data-confirm>Eliminar borrador</button><button class="btn" type="button" data-cancel>Cancelar</button></div>`;
        const finish = result => { modal.close(); modal.remove(); if (button.isConnected) button.focus(); resolve(result); };
        modal.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        modal.querySelector('[data-confirm]').onclick = () => finish(true);
        modal.querySelector('[data-cancel]').onclick = () => finish(false);
        document.body.append(modal); modal.showModal(); modal.querySelector('[data-cancel]').focus();
      });
      if (!confirmed) return;
      button.disabled = true;
      try {
        await api('/drafts/' + row.id, 'DELETE', { revision: row.revision });
        button.closest('.mail-draft-row').remove();
        await showDrafts(view);
        (host.querySelector('[data-delete-draft]') || host.querySelector('[data-back]'))?.focus();
      }
      finally { if (button.isConnected) button.disabled = false; }
    }); });
  }
  async function showCampaignHistory(id) {
    const seq = readSeq;
    const c = await api('/campaigns/' + id);
    if (readSeq !== seq) return;
    const host = root.querySelector('.mail-editor');
    host.innerHTML = `<button class="btn" data-history-back>← Historial</button><h3>${esc(c.campaignName || 'Campaña sin nombre')}</h3><p>Fecha de envío: ${c.sentAt || c.startedAt ? esc(date(c.sentAt || c.startedAt)) : 'Sin fecha confirmada'} · Europe/Madrid</p><p>${esc(status[c.status] || c.status)}</p><p>${c.accepted || 0} aceptados por SMTP · ${c.failed || 0} fallidos · ${c.uncertain || 0} inciertos · ${c.bounced || 0} rebotes confirmados</p><p data-effectiveness>Efectividad: ${c.effectiveness === null || c.effectiveness === undefined ? 'Sin datos' : `${c.effectiveness} % · ${c.attributed} de ${c.accepted} destinatarios`}</p><p>${c.attributed || 0} destinatarios únicos con acceso atribuido.</p><p class="mail-muted">Estimación de accesos con consentimiento e interacción en la web. No mide aperturas. SMTP aceptado no confirma recepción. ${c.trackingAvailable ? '' : 'Esta campaña no tiene seguimiento; no se atribuyen visitas retrospectivas.'}</p><h4>Contenido enviado</h4>${(c.previews || []).map((v, i) => `<details><summary>Círculo ${v.circle} · ${esc(v.subject)}</summary><iframe data-history-version="${i}" sandbox="" referrerpolicy="no-referrer" title="Contenido enviado del círculo ${v.circle}" style="width:100%;height:360px;border:0"></iframe><pre class="mail-history-content">${esc(v.sentText || v.text)}</pre></details>`).join('') || '<p>No hay contenido histórico asociado de forma fiable.</p>'}<p class="mail-muted">Las URLs de baja y seguimiento se individualizan al enviar; el contenido compartido se conserva una sola vez por versión.</p><h4>Destinatarios y resultados</h4>${(c.recipients || []).map(r => `<div class="mail-history-recipient"><strong>${esc(r.email)}</strong><br>Círculo ${r.circleLevel || '—'} · ${esc(status[r.status] || r.status)} · Versión ${esc(r.versionId || 'anterior')}<br>${r.visitedAt ? 'Acceso atribuido: ' + esc(date(r.visitedAt)) : 'Sin acceso atribuido'}${r.bouncedAt ? '<br>Rebote confirmado: ' + esc(date(r.bouncedAt)) : ''}</div>`).join('')}`;
    host.querySelector('[data-history-back]').onclick = guard(() => showDrafts('history'));
    (c.previews || []).forEach((v, i) => {
      host.querySelector(`[data-history-version="${i}"]`).srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;">' + (v.sentHtml || v.html || `<pre>${esc(v.text)}</pre>`);
    });
  }
  async function settings(id) {
    await leave();
    show("settings");
    const host = root.querySelector(".mail-settings"),
      b = overview.boxes.find((b) => b.id === id),
      admins = await api("/administrators");
    host.innerHTML = `<button class="btn mail-back" data-back>← Volver</button><h3>Configuración de buzones</h3><p>Selecciona un buzón y gestiona sus avisos y permisos.</p><div class="mail-actions">${overview.boxes.map((b) => `<button class="btn" data-edit-box="${esc(b.id)}">${esc(displayName(b))}</button>`).join("")}<button class="btn mail-add-box" type="button" data-add-box>Añadir buzón</button></div><form><div class="mail-addresses"><label>Nombre visible<input name="name" value="${esc(b ? mailboxLabel(b.name) : "")}" required maxlength="100"></label><label>Dirección<input name="address" type="email" value="${esc(b?.address || "")}" ${b ? "readonly" : ""} required></label><label>Nombre del remitente<input name="fromName" value="${esc(b?.fromName || "CRONOX")}" required maxlength="100"></label></div><details class="mail-advanced"><summary>Configuración avanzada</summary><p>Las credenciales vacías conservan los valores guardados. Revisa el producto contratado antes de realizar cambios de mantenimiento.</p><label>Producto<select name="provider"><option value="hostinger">Hostinger Email</option><option value="titan">Titan Email contratado en Hostinger</option></select></label><p class="mail-muted">Comprueba el producto en hPanel → Emails → Conectar aplicaciones y dispositivos. Solo se admiten los servidores oficiales permitidos.</p><div class="mail-addresses"><label>IMAP<input name="imapHost" readonly></label><label>Puerto IMAP<input name="imapPort" type="number" value="993" readonly></label><label>SMTP<input name="smtpHost" readonly></label><label>Puerto SMTP<select name="smtpPort"><option value="465">465 · TLS directo</option><option value="587">587 · STARTTLS obligatorio</option></select></label><label>Variable privada IMAP<input name="imapSecretRef" value="${esc(b?.imapSecretRef || "")}" list="mailCredentialRefs" placeholder="SMTP_SUPPORT_PASS"></label><label>Variable privada SMTP<input name="smtpSecretRef" value="${esc(b?.smtpSecretRef || "")}" list="mailCredentialRefs" placeholder="SMTP_SUPPORT_PASS"></label><label>Contraseña IMAP nueva<input name="imapPassword" type="password" autocomplete="new-password" placeholder="${b?.imapCredentialSaved ? "Guardada; vacío conserva" : "Opcional si usas una variable"}"></label><label>Contraseña SMTP nueva<input name="smtpPassword" type="password" autocomplete="new-password" placeholder="${b?.smtpCredentialSaved ? "Guardada; vacío conserva" : "Opcional si usas una variable"}"></label></div><datalist id="mailCredentialRefs">${overview.credentialRefs.map((ref) => `<option value="${esc(ref)}">`).join("")}</datalist><label>Copia en Enviados<select name="sentCopy"><option value="append">Guardar con IMAP (comprobar copia antes de añadir)</option><option value="provider">El proveedor ya guarda una copia automáticamente</option></select></label>${b ? '<button class="btn" type="button" data-test>Probar IMAP y SMTP sin enviar correo</button>' : ""}<div data-test-result role="status"></div><fieldset><legend>Bajas y rebotes confirmados de campañas</legend><label>Dirección a excluir<input type="email" data-suppression-email></label><label>Motivo<select data-suppression-reason><option value="UNSUBSCRIBED">Baja solicitada</option><option value="CONFIRMED_HARD_BOUNCE">Rebote permanente confirmado</option></select></label><button class="btn" type="button" data-suppress>Excluir de futuras campañas</button><p>No se deben registrar como rebotes los avisos temporales. Esta exclusión se conserva aunque otro flujo marque una suscripción.</p></fieldset></details><label><span><input type="checkbox" name="active" ${b?.active ? "checked" : ""}> Activar este buzón</span></label><label><span><input type="checkbox" name="notify" ${b?.notify !== false ? "checked" : ""}> Avisos de nuevos mensajes de Entrada</span></label><div class="mail-grants"><h4>Permisos explícitos para ADMIN</h4><p>SUPERADMIN tiene acceso. ADMIN necesita una concesión por buzón. USER y FRIEND no pueden acceder.</p><div data-grants></div><button class="btn" type="button" data-grant-add>Añadir permiso</button></div><button class="btn" type="submit">Guardar configuración</button></form><div data-suggestions></div>`;
    host.querySelector('[data-suppress]').onclick=guard(async()=>{
      const email=host.querySelector('[data-suppression-email]').value;
      if(!confirm('Excluir '+email+' de futuras campañas y registrar su preferencia de baja. ¿Continuar?'))return;
      await api('/suppressions','POST',{email,reason:host.querySelector('[data-suppression-reason]').value});
      host.querySelector('[data-suppression-email]').value='';feedback('Exclusión registrada.');
    });
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
          `IMAP: ${result.imap === "TLS_AUTH_OK" ? "TLS y autenticación correctos" : codes[result.imap] || result.imap}. SMTP: ${result.smtp === "TLS_AUTH_OK" ? "TLS y autenticación correctos" : codes[result.smtp] || result.smtp}.${result.errorCode ? " " + (codes[result.errorCode] || result.errorCode) : ""}${result.folders ? " Carpetas: " + result.folders.map(folderLabel).join(", ") : ""}`;
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
              `<button class="btn" data-suggest="${i}">${esc(displayName(s))} · ${esc(s.address)}</button>`,
          )
          .join("");
      hints.querySelectorAll("[data-suggest]").forEach(
        (button) =>
          (button.onclick = () => {
            const s = overview.suggestions[Number(button.dataset.suggest)];
            form.elements.name.value = displayName(s);
            form.elements.address.value = s.address;
            form.elements.imapSecretRef.value = s.credentialRef;
            form.elements.smtpSecretRef.value = s.credentialRef;
            if (s.provider) form.elements.provider.value = s.provider;
            servers();
          }),
      );
    }
  }
  async function pulse() {
    const pulseSeq = readSeq, epoch = stateEpoch;
    if (!initialized || !overview || document.visibilityState !== "visible")
      return;
    try {
      const next = await api("/overview");
      if (pulseSeq !== readSeq || epoch !== stateEpoch) return;
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
        if (['list', 'read'].includes(root.dataset.view)) await list();
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
        button.textContent = `${mailboxLabel(n.mailbox)}: ${n.sender ? n.sender + " · " : ""}${n.subject}`;
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
      if (pulseSeq !== readSeq) return;
      if (/permiso|sesión/.test(e.message)) {
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
  window.CRONOX_INBOX = { load, hasUnsavedChanges: () => dirty, discard: () => {
      if (draft?.mode !== 'campaign') return;
      draft = null; dirty = false; invalidateReader(); show('list');
    } };
})();
