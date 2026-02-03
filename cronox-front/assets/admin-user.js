(() => {
  const qs = new URLSearchParams(window.location.search);
  const userId = qs.get('id');
  const apiBaseBadge = document.getElementById('apiBaseBadge');
  const errorBox = document.getElementById('errorBox');
  const refreshAllBtn = document.getElementById('refreshAll');
  const refreshAuditBtn = document.getElementById('refreshAudit');
  const refreshNotesBtn = document.getElementById('refreshNotes');
  const summarySession = document.getElementById('summarySession');
  const summaryRole = document.getElementById('summaryRole');
  const summaryId = document.getElementById('summaryId');
  const summaryEmail = document.getElementById('summaryEmail');
  const summaryName = document.getElementById('summaryName');
  const summaryCircle = document.getElementById('summaryCircle');
  const summaryCreated = document.getElementById('summaryCreated');
  const summaryUpdated = document.getElementById('summaryUpdated');
  const profileList = document.getElementById('profileList');
  const auditBody = document.getElementById('auditBody');
  const notesList = document.getElementById('notesList');
  const noteForm = document.getElementById('noteForm');
  const noteTitle = document.getElementById('noteTitle');
  const noteBody = document.getElementById('noteBody');
  const tabs = document.querySelectorAll('.tab');

  const showError = (message) => {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  const clearError = () => {
    if (!errorBox) return;
    errorBox.textContent = '';
    errorBox.hidden = true;
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString('es-ES');
  };

  const formatText = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  };

  const normalizeList = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload?.data && Array.isArray(payload.data.items)) return payload.data.items;
    return [];
  };

  const truncateJson = (value, limit = 220) => {
    if (value === undefined) return '—';
    let output = '';
    try {
      output = typeof value === 'string' ? value : JSON.stringify(value);
    } catch (error) {
      output = String(value);
    }
    if (!output) return '—';
    return output.length > limit ? `${output.slice(0, limit)}…` : output;
  };

  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const setBadgeText = (element, label, value) => {
    if (!element) return;
    element.textContent = `${label} · ${formatText(value)}`;
  };

  const renderSummary = (user = {}) => {
    setBadgeText(summaryRole, 'Role', user.role);
    const sessionStatus = user.session?.status || user.sessionStatus || (user.lastLoginAt ? 'Activa' : '—');
    setBadgeText(summarySession, 'Session', sessionStatus);
    if (summaryId) summaryId.textContent = formatText(user.id);
    if (summaryEmail) summaryEmail.textContent = formatText(user.email);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    if (summaryName) summaryName.textContent = formatText(fullName || user.username);
    if (summaryCircle) summaryCircle.textContent = formatText(user.circle);
    if (summaryCreated) summaryCreated.textContent = formatDate(user.createdAt);
    if (summaryUpdated) summaryUpdated.textContent = formatDate(user.updatedAt);
  };

  const renderProfile = (user = {}) => {
    if (!profileList) return;
    const fields = [
      { label: 'ID', value: user.id },
      { label: 'Email', value: user.email },
      { label: 'Nombre', value: user.firstName },
      { label: 'Apellidos', value: user.lastName },
      { label: 'Role', value: user.role },
      { label: 'Circle', value: user.circle },
      { label: 'Teléfono', value: user.phone },
      { label: 'País', value: user.country },
      { label: 'Ciudad', value: user.city },
      { label: 'Dirección', value: user.address },
      { label: 'Código postal', value: user.postalCode },
      { label: 'Creado', value: user.createdAt, format: formatDate },
      { label: 'Actualizado', value: user.updatedAt, format: formatDate },
      { label: 'Último acceso', value: user.lastLoginAt, format: formatDate },
      { label: 'Stripe customer', value: user.stripeCustomerId },
    ];

    const rows = fields
      .filter((field) => field.value !== null && field.value !== undefined && field.value !== '')
      .map((field) => {
        const formatted = field.format ? field.format(field.value) : formatText(field.value);
        return `
          <div class="kv-row">
            <dt>${escapeHtml(field.label)}</dt>
            <dd>${escapeHtml(formatted)}</dd>
          </div>
        `;
      })
      .join('');

    profileList.innerHTML = rows || '<div class="note-meta">No hay información adicional.</div>';
  };

  const renderAuditLogs = (logs) => {
    if (!auditBody) return;
    if (!logs.length) {
      auditBody.innerHTML = '<tr><td colspan="4">Sin registros.</td></tr>';
      return;
    }
    const rows = logs.slice(0, 50).map((entry) => {
      const dateValue = entry.createdAt || entry.at || entry.timestamp;
      const action = entry.action || entry.actionType || entry.type || '—';
      const ip = entry.ip || entry.ipAddress || entry.meta?.ip || '—';
      const metaValue = entry.meta ?? entry.metadata ?? entry.details ?? entry.context ?? entry.payload ?? entry;
      const metaPreview = truncateJson(metaValue);
      return `
        <tr>
          <td>${escapeHtml(formatDate(dateValue))}</td>
          <td>${escapeHtml(action)}</td>
          <td>${escapeHtml(ip)}</td>
          <td>${escapeHtml(metaPreview)}</td>
        </tr>
      `;
    });
    auditBody.innerHTML = rows.join('');
  };

  const renderNotes = (notes) => {
    if (!notesList) return;
    if (!notes.length) {
      notesList.innerHTML = '<div class="note-meta">Sin notas.</div>';
      return;
    }
    notesList.innerHTML = notes
      .map((note) => {
        const title = note.title || 'Nota';
        const created = formatDate(note.createdAt || note.created_at || note.createdOn || note.updatedAt);
        const author = note.author?.email || note.authorEmail || '—';
        const body = note.body || note.content || '';
        return `
          <article class="note-card">
            <div class="note-header">
              <div>
                <div class="note-title">${escapeHtml(title)}</div>
                <div class="note-meta">${escapeHtml(created)} · ${escapeHtml(author)}</div>
              </div>
              <button class="btn" type="button" data-note-id="${escapeHtml(note.id)}">Eliminar</button>
            </div>
            <div>${escapeHtml(body)}</div>
          </article>
        `;
      })
      .join('');
  };

  const loadUserDetail = async () => {
    if (!window.CRONOX_API?.admin?.getUserDetail) {
      showError('La API de administración no está disponible en esta página.');
      return;
    }
    try {
      const data = await window.CRONOX_API.admin.getUserDetail(userId);
      const user = data?.user || data || {};
      renderSummary(user);
      renderProfile(user);
    } catch (error) {
      console.error('[ADMIN USER] Error cargando detalle', error);
      showError('No se pudo cargar el detalle del usuario.');
    }
  };

  const loadAuditLogs = async () => {
    if (!auditBody) return;
    auditBody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
    if (!window.CRONOX_API?.admin?.getUserAuditLogs) {
      showError('La API de auditoría no está disponible.');
      auditBody.innerHTML = '<tr><td colspan="4">Sin datos.</td></tr>';
      return;
    }
    try {
      const data = await window.CRONOX_API.admin.getUserAuditLogs(userId);
      const logs = normalizeList(data);
      renderAuditLogs(logs);
    } catch (error) {
      console.error('[ADMIN USER] Error cargando audit logs', error);
      showError('No se pudieron cargar los audit logs.');
      auditBody.innerHTML = '<tr><td colspan="4">Sin datos.</td></tr>';
    }
  };

  const loadNotes = async () => {
    if (!notesList) return;
    notesList.innerHTML = '<div class="note-meta">Cargando…</div>';
    if (!window.CRONOX_API?.admin?.listAdminNotes) {
      showError('La API de notas no está disponible.');
      notesList.innerHTML = '<div class="note-meta">Sin datos.</div>';
      return;
    }
    try {
      const data = await window.CRONOX_API.admin.listAdminNotes({ userId });
      const notes = normalizeList(data);
      renderNotes(notes);
    } catch (error) {
      console.error('[ADMIN USER] Error cargando notas', error);
      showError('No se pudieron cargar las notas.');
      notesList.innerHTML = '<div class="note-meta">Sin datos.</div>';
    }
  };

  const loadAll = () => {
    clearError();
    Promise.allSettled([loadUserDetail(), loadAuditLogs(), loadNotes()]);
  };

  const setApiBaseBadge = () => {
    if (!apiBaseBadge) return;
    const base = window.CRONOX_API_BASE || window.__CRONOX_API_BASE__ || '—';
    apiBaseBadge.textContent = `API: ${base}`;
  };

  const handleTabClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tabId = target.dataset.tab;
    if (!tabId) return;
    tabs.forEach((tab) => tab.classList.toggle('active', tab === target));
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
  };

  const handleNoteSubmit = async (event) => {
    event.preventDefault();
    if (!noteBody || !window.CRONOX_API?.admin?.createAdminNote) {
      showError('No se puede crear la nota en este momento.');
      return;
    }
    const body = noteBody.value.trim();
    const title = noteTitle?.value.trim();
    if (!body) {
      showError('La nota necesita contenido.');
      return;
    }
    clearError();
    const payload = { userId, body };
    if (title) payload.title = title;
    try {
      await window.CRONOX_API.admin.createAdminNote(payload);
      if (noteBody) noteBody.value = '';
      if (noteTitle) noteTitle.value = '';
      loadNotes();
    } catch (error) {
      console.error('[ADMIN USER] Error creando nota', error);
      showError('No se pudo crear la nota.');
    }
  };

  const handleNoteDelete = async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const noteId = target.dataset.noteId;
    if (!noteId) return;
    if (!window.CRONOX_API?.admin?.deleteAdminNote) {
      showError('No se puede eliminar la nota en este momento.');
      return;
    }
    try {
      await window.CRONOX_API.admin.deleteAdminNote(noteId);
      loadNotes();
    } catch (error) {
      console.error('[ADMIN USER] Error eliminando nota', error);
      showError('No se pudo eliminar la nota.');
    }
  };

  if (!userId) {
    showError('Falta el parámetro ?id=123 en la URL. Ejemplo: admin-user.html?id=123');
    if (profileList) {
      profileList.innerHTML = '<div class="note-meta">No hay usuario seleccionado.</div>';
    }
  }

  setApiBaseBadge();

  tabs.forEach((tab) => {
    tab.addEventListener('click', handleTabClick);
  });

  refreshAllBtn?.addEventListener('click', loadAll);
  refreshAuditBtn?.addEventListener('click', loadAuditLogs);
  refreshNotesBtn?.addEventListener('click', loadNotes);
  noteForm?.addEventListener('submit', handleNoteSubmit);
  notesList?.addEventListener('click', handleNoteDelete);

  if (userId) {
    loadAll();
  }
})();
