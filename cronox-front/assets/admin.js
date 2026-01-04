(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const requestsBody = $('#requestsBody');
  const messageBox = $('#messageBox');
  const filterStatus = $('#filterStatus');
  const requestsBody23 = $('#requestsBody23');
  const messageBox23 = $('#messageBox23');
  const filterStatus23 = $('#filterStatus23');
  const tabs = document.querySelectorAll('#adminTabs button');
  const logoutBtn = $('#logoutBtn');
  const backBtn = $('#backBtn');
  const loadingRow = '<tr><td colspan="8" class="empty">Cargando solicitudes…</td></tr>';

  const setMessage = (text = '', type = 'success') => {
    if (!messageBox) return;
    if (!text) {
      messageBox.className = 'message';
      messageBox.textContent = '';
      return;
    }
    messageBox.textContent = text;
    messageBox.className = `message show ${type === 'error' ? 'error' : 'success'}`;
  };

  const redirectToHome = () => {
    window.location.href = 'index.html';
  };

  const ensureAdmin = async () => {
    if (!window.CRONOX_API?.getMe) {
      redirectToHome();
      return null;
    }
    const user = await window.CRONOX_API.getMe();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN')) {
      redirectToHome();
      return null;
    }
    return user;
  };

  const statusBadge = (status) => {
    const normalized = String(status || '').toUpperCase();
    const cls = normalized === 'APPROVED' ? 'approved' : normalized === 'DENIED' ? 'denied' : 'pending';
    const label = normalized === 'APPROVED' ? 'APPROVED' : normalized === 'DENIED' ? 'DENIED' : 'PENDING';
    return `<span class="status ${cls}">${label}</span>`;
  };

  const formatDate = (value) => {
    if (!value) return '';
    try {
      const date = new Date(value);
      return date.toLocaleString('es-ES');
    } catch (e) {
      return value;
    }
  };

  const formatDuration = (ms) => {
    if (ms <= 0) return 'Expirado';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const setLoading = (isLoading) => {
    if (!requestsBody) return;
    if (isLoading) {
      requestsBody.innerHTML = loadingRow;
    }
  };

  const setLoading23 = (isLoading) => {
    if (!requestsBody23) return;
    if (isLoading) {
      requestsBody23.innerHTML = '<tr><td colspan="6" class="empty">Cargando solicitudes…</td></tr>';
    }
  };

  const renderRequests = (items, options = { error: false }) => {
    if (!requestsBody) return;
    if (options.error) {
      requestsBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty">
            No se pudieron cargar las solicitudes.
            <button type="button" class="btn" data-retry="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>
      `;
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      requestsBody.innerHTML = '<tr><td colspan="8" class="empty">No hay solicitudes con ese estado.</td></tr>';
      return;
    }

    requestsBody.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const isPending = req.status === 'PENDING';
        const actions = isPending
          ? `<div class="actions">
              <button class="btn primary" data-action="approve" data-id="${req.id}">APROBAR</button>
              <button class="btn danger" data-action="deny" data-id="${req.id}">DENEGAR</button>
            </div>`
          : '<span style="color:#7b7f8f;">—</span>';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;

        return `<tr>
          <td>${formatDate(req.createdAt)}</td>
          <td>${userName || '—'}</td>
          <td>${req.userId}</td>
          <td>${req.socialNetwork}</td>
          <td>${req.username}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join('');
  };

  const renderRequests23 = (items, options = { error: false }) => {
    if (!requestsBody23) return;
    if (options.error) {
      requestsBody23.innerHTML = `
        <tr>
          <td colspan="6" class="empty">
            No se pudieron cargar las solicitudes.
            <button type="button" class="btn" data-retry-23="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>
      `;
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      requestsBody23.innerHTML = '<tr><td colspan="6" class="empty">No hay solicitudes con ese estado.</td></tr>';
      return;
    }

    requestsBody23.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const remaining = typeof req.remainingMs === 'number' ? formatDuration(req.remainingMs) : '—';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;
        return `<tr>
          <td>${formatDate(req.createdAt)}</td>
          <td>${userName || '—'}</td>
          <td>${req.userId}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${remaining}</td>
        </tr>`;
      })
      .join('');
  };

  const fetchRequests = async () => {
    setLoading(true);
    setMessage('');
    const status = filterStatus?.value || 'PENDING';
    try {
      const data = await window.CRONOX_API?.admin?.listCircleUpgradeRequests(status);
      renderRequests(data || []);
    } catch (error) {
      console.error('[ADMIN] Error cargando solicitudes', error);
      setMessage('No se pudieron cargar las solicitudes.', 'error');
      renderRequests([], { error: true });
    }
  };

  const fetchRequests23 = async () => {
    setLoading23(true);
    if (messageBox23) {
      messageBox23.textContent = '';
      messageBox23.className = 'message';
    }
    const status = filterStatus23?.value || 'PENDING';
    try {
      const data = await window.CRONOX_API?.admin?.listAutoCircleRequests(status);
      renderRequests23(data || []);
    } catch (error) {
      console.error('[ADMIN] Error cargando solicitudes 2->3', error);
      if (messageBox23) {
        messageBox23.textContent = 'No se pudieron cargar las solicitudes 2→3.';
        messageBox23.className = 'message show error';
      }
      renderRequests23([], { error: true });
    }
  };

  const handleAction = async (action, id) => {
    if (!id) return;
    const button = document.querySelector(`button[data-id="${id}"][data-action="${action}"]`);
    if (button) button.disabled = true;
    try {
      if (action === 'approve') {
        await window.CRONOX_API?.admin?.approveCircleUpgrade(id, {});
        setMessage('Solicitud aprobada correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.denyCircleUpgrade(id, {});
        setMessage('Solicitud denegada.', 'success');
      }
      await fetchRequests();
    } catch (error) {
      console.error('[ADMIN] Acción fallida', error);
      setMessage(error?.message || 'No se pudo completar la acción.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };

  const bindEvents = () => {
    if (filterStatus) {
      filterStatus.addEventListener('change', fetchRequests);
    }
    if (filterStatus23) {
      filterStatus23.addEventListener('change', fetchRequests23);
    }

    if (requestsBody) {
      requestsBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (target.dataset.retry) {
          fetchRequests();
          return;
        }
        if (!action || !id) return;
        handleAction(action, id);
      });
    }

    if (requestsBody23) {
      requestsBody23.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.retry23) {
          fetchRequests23();
        }
      });
    }

    if (tabs?.length) {
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const targetSection = tab.dataset.section;
          document.querySelectorAll('.admin-section').forEach((section) => {
            section.hidden = section.id !== targetSection;
          });
          tabs.forEach((btn) => btn.classList.toggle('primary', btn === tab));
          if (targetSection === 'section-34') {
            fetchRequests();
          } else if (targetSection === 'section-23') {
            fetchRequests23();
          }
        });
      });
    }

    logoutBtn?.addEventListener('click', async () => {
      try {
        await window.CRONOX_API?.logout?.();
      } catch (e) {
        console.warn('No se pudo cerrar sesión', e);
      }
      redirectToHome();
    });

    backBtn?.addEventListener('click', redirectToHome);
  };

  const init = async () => {
    const user = await ensureAdmin();
    if (!user) return;
    bindEvents();
    fetchRequests();
    fetchRequests23();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
