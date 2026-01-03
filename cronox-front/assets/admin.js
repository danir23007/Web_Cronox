(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const requestsBody = $('#requestsBody');
  const messageBox = $('#messageBox');
  const filterStatus = $('#filterStatus');
  const logoutBtn = $('#logoutBtn');
  const backBtn = $('#backBtn');

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
    if (!user || user.role !== 'ADMIN') {
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

  const setLoading = (isLoading) => {
    if (!requestsBody) return;
    if (isLoading) {
      requestsBody.innerHTML = '<tr><td colspan="8" class="empty">Cargando solicitudes…</td></tr>';
    }
  };

  const renderRequests = (items) => {
    if (!requestsBody) return;
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

        return `<tr>
          <td>${req.requestNumber ?? '—'}</td>
          <td>${formatDate(req.createdAt)}</td>
          <td>${userName || '—'}</td>
          <td>${req.userId}</td>
          <td>${req.socialNetwork}</td>
          <td>${req.username}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${actions}</td>
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
      renderRequests([]);
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

    if (requestsBody) {
      requestsBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (!action || !id) return;
        handleAction(action, id);
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
  };

  document.addEventListener('DOMContentLoaded', init);
})();
