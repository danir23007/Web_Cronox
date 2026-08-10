(() => {
  const qs = new URLSearchParams(window.location.search);
  const userId = qs.get('id');
  const apiBaseBadge = document.getElementById('apiBaseBadge');
  const statusArea = document.getElementById('statusArea');
  const profileStatus = document.getElementById('profileStatus');
  const auditStatus = document.getElementById('auditStatus');
  const notesStatus = document.getElementById('notesStatus');
  const ordersStatus = document.getElementById('ordersStatus');
  const requestsStatus = document.getElementById('requestsStatus');
  const refreshAllBtn = document.getElementById('refreshAll');
  const refreshAuditBtn = document.getElementById('refreshAudit');
  const refreshNotesBtn = document.getElementById('refreshNotes') as HTMLButtonElement | null;
  const backToUsersBtn = document.getElementById('backToUsers') as HTMLAnchorElement | null;
  const summarySession = document.getElementById('summarySession');
  const summaryRole = document.getElementById('summaryRole');
  const summaryId = document.getElementById('summaryId');
  const summaryEmail = document.getElementById('summaryEmail');
  const summaryName = document.getElementById('summaryName');
  const summaryCircle = document.getElementById('summaryCircle');
  const summaryOrdersCount = document.getElementById('summaryOrdersCount');
  const summaryTotalSpent = document.getElementById('summaryTotalSpent');
  const summaryLastOrder = document.getElementById('summaryLastOrder');
  const summaryCreated = document.getElementById('summaryCreated');
  const summaryUpdated = document.getElementById('summaryUpdated');
  const profileList = document.getElementById('profileList');
  const auditBody = document.getElementById('auditBody');
  const ordersBody = document.getElementById('ordersBody');
  const notesList = document.getElementById('notesList');
  const noteForm = document.getElementById('noteForm') as HTMLFormElement | null;
  const noteTitle = document.getElementById('noteTitle') as HTMLInputElement | null;
  const noteBody = document.getElementById('noteBody') as HTMLTextAreaElement | null;
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  const notesTab = document.querySelector<HTMLButtonElement>('.tab[data-tab="notes"]');
  const ordersPanel = document.getElementById('panel-orders');
  const requestsPanel = document.getElementById('panel-requests');
  const requestsPlaceholder = requestsPanel?.querySelector<HTMLElement>('.placeholder') || null;
  let notesAvailable = true;
  const kpiState: { ordersCount: number | null; totalSpent: number | null; lastOrderAt: string | null } = {
    ordersCount: null,
    totalSpent: null,
    lastOrderAt: null,
  };

  const ui = window.CRONOX_UI || {};
  const renderBanner = ui.renderBanner;
  const renderEmptyState = ui.renderEmptyState;
  const setLoading = ui.setLoading;
  const classifyApiError = window.CRONOX_API?.classifyApiError || (() => ({
    severity: 'error',
    userMessage: 'No pudimos completar la solicitud.',
    isRetryable: true,
    kind: 'unknown',
  }));

  const getErrorDetails = (error: CronoxApiError) => ({
    status: error?.status ?? error?.statusCode ?? 0,
    endpoint: error?.endpoint || '—',
    message: error?.message || 'Error desconocido',
  });

  const showGlobalBanner = (options: CronoxBannerOptions) => {
    if (!renderBanner || !statusArea) return;
    renderBanner(statusArea, options);
  };

  const clearGlobalBanner = () => {
    if (!statusArea) return;
    statusArea.innerHTML = '';
  };

  const redirectToLogin = () => {
    try {
      localStorage.setItem('cronox_open_auth_on_load', 'login');
    } catch (error) {
      console.warn('[ADMIN-USER] No se pudo marcar login automático', error);
    }
    window.location.href = 'index.html';
  };

  const showModuleError = ({
    container,
    error,
    title,
    isCritical = false,
    retry,
    backLink,
  }: {
    container: Element | null;
    error: CronoxApiError;
    title?: string;
    isCritical?: boolean;
    retry?: () => void;
    backLink?: string;
  }) => {
    if (!renderBanner || !container) return;
    const classification = classifyApiError(error);
    let severity = classification.severity || 'error';
    if (!isCritical && severity === 'error') {
      severity = 'warning';
    }
    const actions: CronoxBannerAction[] = [];
    if (typeof retry === 'function') {
      actions.push({ label: 'Reintentar', onClick: retry, variant: 'primary' });
    }
    if (backLink) {
      actions.push({ label: 'Volver', href: backLink });
    }
    if (classification.kind === 'auth') {
      actions.push({
        label: 'Iniciar sesión',
        onClick: () => {
          if (typeof redirectToLogin === 'function') {
            redirectToLogin();
            return;
          }
          try {
            localStorage.setItem('cronox_open_auth_on_load', 'login');
          } catch (error) {
            console.warn('[ADMIN-USER] No se pudo marcar login automático', error);
          }
          window.location.href = 'index.html';
        },
        variant: 'primary',
      });
    }
    renderBanner(container, {
      type: severity,
      title: title || 'Ocurrió un problema',
      message: classification.userMessage,
      details: getErrorDetails(error),
      actions,
    });
    if (isCritical) {
      showGlobalBanner({
        type: 'error',
        title: 'No se pudo cargar el usuario',
        message: classification.userMessage,
        details: getErrorDetails(error),
        actions,
      });
    }
  };

  const showOptionalUnavailable = (
    statusContainer: Element | null,
    contentContainer: Element | null,
    options: CronoxBannerOptions = {},
  ) => {
    if (renderBanner && statusContainer) {
      renderBanner(statusContainer, {
        type: 'warning',
        title: options.title || 'Módulo opcional',
        message: options.message || 'Este módulo aún no está disponible en backend.',
        details: options.details,
        actions: options.actions || [],
      });
    }
    if (renderEmptyState && contentContainer) {
      renderEmptyState(contentContainer, {
        title: options.emptyTitle || 'No disponible',
        message: options.emptyMessage || 'Este módulo aún no está disponible.',
        actions: options.actions || [],
      } as CronoxEmptyStateOptions);
    }
  };

  const setApiBaseBadge = (baseValue: string) => {
    if (!apiBaseBadge) return;
    apiBaseBadge.textContent = `API: ${baseValue || '—'}`;
  };

  if (!window.CRONOX_API || typeof window.CRONOX_API !== 'object') {
    setApiBaseBadge('—');
    showGlobalBanner({
      type: 'error',
      title: 'API no inicializada',
      message: 'Falta api.js o no se pudo cargar correctamente.',
      details: { status: 0, endpoint: '—', message: 'API no inicializada' },
      actions: [{ label: 'Recargar', onClick: () => window.location.reload(), variant: 'primary' }],
    });
    return;
  }

  setApiBaseBadge(window.CRONOX_API.API_BASE);

  const getUsersReturnHash = () => {
    const hash = window.location.hash || '';
    // Parse hash state to return to usuarios with the same filters.
    return hash.startsWith('#usuarios') ? hash : '#usuarios';
  };

  const usersReturnLink = `admin.html${getUsersReturnHash()}`;
  if (backToUsersBtn) {
    backToUsersBtn.href = usersReturnLink;
  }

  const formatDate = (value: unknown) => {
    if (!value) return '—';
    const date = new Date(value as string);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString('es-ES');
  };

  const formatText = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  };

  const formatCurrency = (value: unknown) => {
    const amount = Number(value || 0);
    if (window.CRONOX_API?.formatPrice) {
      try {
        return window.CRONOX_API.formatPrice(amount);
      } catch (error) {
        // ignore
      }
    }
    return `${amount.toFixed(2)} €`;
  };

  const normalizeList = (payload: unknown) => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray((payload as { items?: unknown[] }).items)) return (payload as { items: unknown[] }).items;
    if (payload && Array.isArray((payload as { data?: unknown[] }).data)) return (payload as { data: unknown[] }).data;
    if (payload && Array.isArray((payload as { data?: { items?: unknown[] } }).data?.items)) {
      return (payload as { data: { items: unknown[] } }).data.items;
    }
    return [];
  };

  const truncateJson = (value: unknown, limit = 220) => {
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

  const escapeHtml = (value: unknown) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const setBadgeText = (element: HTMLElement | null, label: string, value: unknown) => {
    if (!element) return;
    element.textContent = `${label} · ${formatText(value)}`;
  };

  const renderSummary = (user: Record<string, unknown> = {}, stats: Record<string, unknown> = {}) => {
    setBadgeText(summaryRole, 'Role', user.role);
    const sessionStatus =
      (user.session as { status?: string } | undefined)?.status ||
      (user.sessionStatus as string) ||
      (user.lastLoginAt ? 'Activa' : '—');
    setBadgeText(summarySession, 'Session', sessionStatus);
    if (summaryId) summaryId.textContent = formatText(user.id);
    if (summaryEmail) summaryEmail.textContent = formatText(user.email);
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    if (summaryName) summaryName.textContent = formatText(fullName || user.username);
    if (summaryCircle) summaryCircle.textContent = formatText(user.circle);
    if (summaryOrdersCount) summaryOrdersCount.textContent = formatText(stats.ordersCount ?? kpiState.ordersCount);
    if (summaryTotalSpent) {
      const totalValue = (stats.totalSpent as number | null | undefined) ?? kpiState.totalSpent;
      summaryTotalSpent.textContent = totalValue !== null && totalValue !== undefined ? formatCurrency(totalValue) : '—';
    }
    if (summaryLastOrder) {
      const lastOrderAt = (stats.lastOrderAt as string | null | undefined) ?? kpiState.lastOrderAt;
      summaryLastOrder.textContent = lastOrderAt ? formatDate(lastOrderAt) : '—';
    }
    if (summaryCreated) summaryCreated.textContent = formatDate(user.createdAt);
    if (summaryUpdated) summaryUpdated.textContent = formatDate(user.updatedAt);
  };

  const updateOrderKpis = (kpis: { ordersCount?: number; totalSpent?: number; lastOrderAt?: string } = {}) => {
    if (kpis.ordersCount !== undefined) kpiState.ordersCount = kpis.ordersCount;
    if (kpis.totalSpent !== undefined) kpiState.totalSpent = kpis.totalSpent;
    if (kpis.lastOrderAt !== undefined) kpiState.lastOrderAt = kpis.lastOrderAt;
    if (summaryOrdersCount) summaryOrdersCount.textContent = formatText(kpiState.ordersCount);
    if (summaryTotalSpent) {
      summaryTotalSpent.textContent =
        kpiState.totalSpent !== null && kpiState.totalSpent !== undefined ? formatCurrency(kpiState.totalSpent) : '—';
    }
    if (summaryLastOrder) {
      summaryLastOrder.textContent = kpiState.lastOrderAt ? formatDate(kpiState.lastOrderAt) : '—';
    }
  };

  const renderProfile = (user: Record<string, unknown> = {}) => {
    if (!profileList) return;
    const fields: Array<{ label: string; value: unknown; format?: (value: unknown) => string }> = [
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

  const renderAuditLogs = (logs: unknown[]) => {
    if (!auditBody) return;
    if (!logs.length) {
      auditBody.innerHTML = '<tr><td colspan="4">Sin registros.</td></tr>';
      return;
    }
    const rows = logs.slice(0, 50).map((entry) => {
      const log = entry as Record<string, unknown>;
      const dateValue = log.createdAt || log.at || log.timestamp;
      const action = log.action || log.actionType || log.type || '—';
      const ip = log.ip || log.ipAddress || (log.meta as Record<string, unknown> | undefined)?.ip || '—';
      const metaValue = log.meta ?? log.metadata ?? log.details ?? log.context ?? log.payload ?? log;
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

  const renderOrders = (orders: unknown[]) => {
    if (!ordersBody) return;
    if (!orders.length) {
      ordersBody.innerHTML = '<tr><td colspan="4">Sin pedidos.</td></tr>';
      return;
    }
    const rows = orders.map((orderEntry) => {
      const order = orderEntry as Record<string, unknown>;
      const id = order.id ?? order.orderId ?? order._id ?? '—';
      const dateValue = order.createdAt || order.created_at || order.date || order.orderedAt;
      const status = order.status || order.state || '—';
      const totalValue =
        order.total ??
        order.totalAmount ??
        order.totalPaid ??
        order.amount ??
        order.amountTotal ??
        order.grandTotal;
      const totalLabel = totalValue !== undefined && totalValue !== null ? formatCurrency(totalValue) : '—';
      return `
        <tr>
          <td>${escapeHtml(formatText(id))}</td>
          <td>${escapeHtml(formatDate(dateValue))}</td>
          <td>${escapeHtml(formatText(status))}</td>
          <td>${escapeHtml(totalLabel)}</td>
        </tr>
      `;
    });
    ordersBody.innerHTML = rows.join('');
  };

  const renderNotes = (notes: unknown[]) => {
    if (!notesList) return;
    if (!notes.length) {
      notesList.innerHTML = '<div class="note-meta">Sin notas.</div>';
      return;
    }
    notesList.innerHTML = notes
      .map((noteEntry) => {
        const note = noteEntry as Record<string, unknown>;
        const title = note.title || 'Nota';
        const created = formatDate(note.createdAt || note.created_at || note.createdOn || note.updatedAt);
        const author = (note.author as { email?: string } | undefined)?.email || note.authorEmail || '—';
        const body = note.body || note.content || '';
        return `
          <article class="note-card">
            <div class="note-header">
              <div>
                <div class="note-title">${escapeHtml(title)}</div>
                <div class="note-meta">${escapeHtml(created)} · ${escapeHtml(author)}</div>
              </div>
              <button class="btn" type="button" data-note-id="${escapeHtml(String(note.id ?? ''))}">Eliminar</button>
            </div>
            <div>${escapeHtml(body)}</div>
          </article>
        `;
      })
      .join('');
  };

  const setActiveTab = (tabId: string) => {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabId));
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${tabId}`);
    });
  };

  const setNotesAvailability = (available: boolean, message?: string) => {
    notesAvailable = available;
    if (notesTab) {
      notesTab.disabled = !available;
      notesTab.setAttribute('aria-disabled', String(!available));
      notesTab.classList.toggle('is-disabled', !available);
    }
    if (refreshNotesBtn) refreshNotesBtn.disabled = !available;
    if (noteForm) {
      const fields = noteForm.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input, textarea, button',
      );
      fields.forEach((field) => {
        field.disabled = !available;
      });
    }
    if (!available && notesList) {
      notesList.innerHTML = `<div class="note-meta">${message}</div>`;
    }
    if (!available && notesTab?.classList.contains('active')) {
      setActiveTab('profile');
    }
  };

  const loadUserDetail = async () => {
    if (!userId) return;
    if (!window.CRONOX_API?.admin?.getUserDetail) {
      showModuleError({
        container: profileStatus || statusArea,
        error: { status: 404, message: 'Endpoint no disponible', endpoint: 'admin.getUserDetail' },
        title: 'Detalle no disponible',
        isCritical: true,
        backLink: usersReturnLink,
      });
      return;
    }
    if (profileStatus) profileStatus.innerHTML = '';
    if (profileList && setLoading) {
      setLoading(profileList, true, { title: 'Cargando perfil...' });
    }
    try {
      const data = await window.CRONOX_API.admin.getUserDetail(userId);
      const payload = data as Record<string, unknown>;
      const user = (payload?.user as Record<string, unknown>) || (payload as Record<string, unknown>) || {};
      const stats = (payload?.stats as Record<string, unknown>) ||
        (payload?.kpis as Record<string, unknown>) ||
        (payload?.summary as Record<string, unknown>) || {};
      if (!user || Object.keys(user).length === 0) {
        if (renderEmptyState && profileList) {
          renderEmptyState(profileList, {
            title: 'Usuario no encontrado o sin datos',
            message: 'No hay información disponible para este usuario.',
            actions: [{ label: 'Volver a usuarios', href: usersReturnLink, variant: 'primary' }],
          });
        }
        return;
      }
      updateOrderKpis({
        ordersCount: (stats.ordersCount as number) ?? (stats.orders as number) ?? (stats.ordersTotal as number),
        totalSpent: (stats.totalSpent as number) ?? (stats.totalPaid as number) ?? (stats.spentTotal as number),
        lastOrderAt: (stats.lastOrderAt as string) ?? (stats.lastOrder as string) ?? (stats.lastOrderDate as string),
      });
      renderSummary(user, stats);
      renderProfile(user);
    } catch (error) {
      console.error('[ADMIN USER] Error cargando detalle', error);
      showModuleError({
        container: profileStatus || statusArea,
        error: error as CronoxApiError,
        title: 'No se pudo cargar el perfil',
        isCritical: true,
        retry: loadUserDetail,
        backLink: usersReturnLink,
      });
    }
  };

  const loadAuditLogs = async () => {
    if (!userId || !auditBody) return;
    if (auditStatus) auditStatus.innerHTML = '';
    if (setLoading) setLoading(auditBody, true, { title: 'Cargando audit logs…', colSpan: 4 });
    if (!window.CRONOX_API?.admin?.getUserAuditLogs) {
      showModuleError({
        container: auditStatus || statusArea,
        error: { status: 404, message: 'Endpoint no disponible', endpoint: 'admin.getUserAuditLogs' },
        title: 'Audit logs no disponibles',
        isCritical: false,
        retry: loadAuditLogs,
      });
      if (renderEmptyState) {
        renderEmptyState(auditBody, {
          title: 'No disponible',
          message: 'Este módulo aún no está disponible en backend.',
          colSpan: 4,
          actions: [{ label: 'Reintentar', onClick: loadAuditLogs }],
        });
      }
      return;
    }
    try {
      const data = await window.CRONOX_API.admin.getUserAuditLogs(userId);
      const logs = normalizeList(data);
      if (!logs.length) {
        if (renderEmptyState) {
          renderEmptyState(auditBody, {
            title: 'Sin registros',
            message: 'No hay audit logs para este usuario.',
            colSpan: 4,
          });
          return;
        }
      }
      renderAuditLogs(logs);
    } catch (error) {
      console.error('[ADMIN USER] Error cargando audit logs', error);
      showModuleError({
        container: auditStatus || statusArea,
        error: error as CronoxApiError,
        title: 'No se pudieron cargar los audit logs',
        isCritical: false,
        retry: loadAuditLogs,
      });
      if (renderEmptyState) {
        renderEmptyState(auditBody, {
          title: 'No disponible',
          message: 'No pudimos cargar los audit logs.',
          colSpan: 4,
          actions: [{ label: 'Reintentar', onClick: loadAuditLogs }],
        });
      }
    }
  };

  const loadNotes = async () => {
    if (!userId || !notesList) return;
    if (notesStatus) notesStatus.innerHTML = '';
    if (setLoading) {
      setLoading(notesList, true, { title: 'Cargando notas…' });
    }
    if (!window.CRONOX_API?.admin?.listAdminNotes) {
      setNotesAvailability(false, 'Notas no disponibles en este entorno.');
      showModuleError({
        container: notesStatus || statusArea,
        error: { status: 404, message: 'Endpoint no disponible', endpoint: 'admin.listAdminNotes' },
        title: 'Notas no disponibles',
        isCritical: false,
        retry: loadNotes,
      });
      return;
    }
    setNotesAvailability(true);
    try {
      const data = await window.CRONOX_API.admin.listAdminNotes({
        targetType: 'user',
        targetId: String(userId),
      });
      const notes = normalizeList(data);
      if (!notes.length && renderEmptyState) {
        renderEmptyState(notesList, {
          title: 'Sin notas',
          message: 'Todavía no hay notas internas para este usuario.',
          actions: [{ label: 'Crear nota', onClick: () => noteBody?.focus?.(), variant: 'primary' }],
        });
        return;
      }
      renderNotes(notes);
    } catch (error) {
      const err = error as CronoxApiError;
      if (err?.status === 404) {
        setNotesAvailability(false, 'Notas no disponibles en este entorno.');
        showModuleError({
          container: notesStatus || statusArea,
          error: err,
          title: 'Notas no disponibles',
          isCritical: false,
          retry: loadNotes,
        });
        return;
      }
      console.error('[ADMIN USER] Error cargando notas', error);
      showModuleError({
        container: notesStatus || statusArea,
        error: err,
        title: 'No se pudieron cargar las notas',
        isCritical: false,
        retry: loadNotes,
      });
      if (renderEmptyState) {
        renderEmptyState(notesList, {
          title: 'No disponible',
          message: 'No pudimos cargar las notas.',
          actions: [{ label: 'Reintentar', onClick: loadNotes }],
        });
      }
    }
  };

  const loadOrders = async () => {
    if (!userId || !ordersBody) return;
    if (ordersStatus) ordersStatus.innerHTML = '';
    if (setLoading) {
      setLoading(ordersBody, true, { title: 'Cargando pedidos…', colSpan: 4 });
    }
    const adminApi = window.CRONOX_API?.admin;
    if (!adminApi?.listAdminOrders && !adminApi?.getUserOrders && !adminApi?.listUserOrders) {
      showOptionalUnavailable(ordersStatus, ordersBody, {
        title: 'Pedidos no disponibles',
        message: 'Este módulo aún no está disponible en backend.',
        details: { status: 404, endpoint: 'admin.getUserOrders' },
        actions: [{ label: 'Reintentar', onClick: loadOrders }],
      });
      return;
    }
    try {
      const data = adminApi.listAdminOrders
        ? await adminApi.listAdminOrders({ userId })
        : adminApi.getUserOrders
          ? await adminApi.getUserOrders(userId)
          : await adminApi.listUserOrders!(userId);
      const orders = normalizeList(data);
      renderOrders(orders);
      if (!orders.length) {
        return;
      }
      const latest = orders
        .map((order) => (order as Record<string, unknown>)?.createdAt || (order as Record<string, unknown>)?.created_at || (order as Record<string, unknown>)?.date || (order as Record<string, unknown>)?.orderedAt)
        .filter(Boolean)
        .map((value) => new Date(value as string))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const totals = orders
        .map((order) => {
          const payload = order as Record<string, unknown>;
          return (
            payload.total ??
            payload.totalAmount ??
            payload.totalPaid ??
            payload.amount ??
            payload.amountTotal ??
            payload.grandTotal
          );
        })
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      updateOrderKpis({
        ordersCount: orders.length,
        totalSpent: totals.length ? totals.reduce((acc, value) => acc + value, 0) : undefined,
        lastOrderAt: latest ? latest.toISOString() : undefined,
      });
    } catch (error) {
      const err = error as CronoxApiError;
      if (err?.status === 404) {
        showOptionalUnavailable(ordersStatus, ordersBody, {
          title: 'Pedidos no disponible todavía',
          message: 'Este módulo aún no está disponible en backend.',
          details: getErrorDetails(err),
          actions: [{ label: 'Reintentar', onClick: loadOrders }],
        });
        return;
      }
      showModuleError({
        container: ordersStatus || statusArea,
        error: err,
        title: 'No se pudieron cargar los pedidos',
        isCritical: false,
        retry: loadOrders,
      });
      if (renderEmptyState) {
        renderEmptyState(ordersBody, {
          title: 'No disponible',
          message: 'No pudimos cargar los pedidos.',
          colSpan: 4,
          actions: [{ label: 'Reintentar', onClick: loadOrders }],
        });
      }
    }
  };

  const loadRequests = async () => {
    if (!userId || !requestsPlaceholder) return;
    if (requestsStatus) requestsStatus.innerHTML = '';
    if (setLoading) {
      setLoading(requestsPlaceholder, true, { title: 'Cargando solicitudes…' });
    }
    const adminApi = window.CRONOX_API?.admin;
    if (!adminApi?.getUserRequests && !adminApi?.listUserRequests) {
      showOptionalUnavailable(requestsStatus, requestsPlaceholder, {
        title: 'Solicitudes no disponibles',
        message: 'Este módulo aún no está disponible en backend.',
        details: { status: 404, endpoint: 'admin.getUserRequests' },
        actions: [{ label: 'Reintentar', onClick: loadRequests }],
      });
      return;
    }
    try {
      const data = adminApi.getUserRequests
        ? await adminApi.getUserRequests(userId)
        : await adminApi.listUserRequests!(userId);
      const requests = normalizeList(data);
      if (!requests.length && renderEmptyState) {
        renderEmptyState(requestsPlaceholder, {
          title: 'Sin solicitudes',
          message: 'Este usuario no tiene solicitudes activas.',
        });
        return;
      }
      if (renderEmptyState) {
        renderEmptyState(requestsPlaceholder, {
          title: 'Solicitudes cargadas',
          message: 'Este panel está listo para integrarse con el listado completo.',
        });
      }
    } catch (error) {
      showModuleError({
        container: requestsStatus || statusArea,
        error: error as CronoxApiError,
        title: 'No se pudieron cargar las solicitudes',
        isCritical: false,
        retry: loadRequests,
      });
      if (renderEmptyState) {
        renderEmptyState(requestsPlaceholder, {
          title: 'No disponible',
          message: 'No pudimos cargar las solicitudes.',
          actions: [{ label: 'Reintentar', onClick: loadRequests }],
        });
      }
    }
  };

  const loadAll = () => {
    clearGlobalBanner();
    Promise.allSettled([loadUserDetail(), loadAuditLogs(), loadNotes(), loadOrders(), loadRequests()]);
  };

  const handleTabClick = (event: Event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLButtonElement)) return;
    const tabId = target.dataset.tab;
    if (!tabId || target.disabled) return;
    setActiveTab(tabId);
  };

  const handleNoteSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!userId) return;
    if (!notesAvailable) {
      setNotesAvailability(false, 'Notas no disponibles en este entorno.');
      return;
    }
    if (!noteBody || !window.CRONOX_API?.admin?.createAdminNote) {
      setNotesAvailability(false, 'Notas no disponibles en este entorno.');
      return;
    }
    const body = noteBody.value.trim();
    const title = noteTitle?.value.trim();
    if (!body) {
      if (renderBanner && notesStatus) {
        renderBanner(notesStatus, {
          type: 'warning',
          title: 'Nota incompleta',
          message: 'La nota necesita contenido antes de guardar.',
        });
      }
      return;
    }
    if (notesStatus) notesStatus.innerHTML = '';
    const payload = {
      targetType: 'user',
      targetId: String(userId),
      content: title ? `${title}\n${body}` : body,
    };
    try {
      await window.CRONOX_API.admin.createAdminNote(payload);
      if (noteBody) noteBody.value = '';
      if (noteTitle) noteTitle.value = '';
      loadNotes();
    } catch (error) {
      console.error('[ADMIN USER] Error creando nota', error);
      showModuleError({
        container: notesStatus || statusArea,
        error: error as CronoxApiError,
        title: 'No se pudo crear la nota',
        isCritical: false,
        retry: loadNotes,
      });
    }
  };

  const handleNoteDelete = async (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || !userId) return;
    const noteId = target.dataset.noteId;
    if (!noteId) return;
    if (!notesAvailable) {
      setNotesAvailability(false, 'Notas no disponibles en este entorno.');
      return;
    }
    if (!window.CRONOX_API?.admin?.deleteAdminNote) {
      setNotesAvailability(false, 'Notas no disponibles en este entorno.');
      return;
    }
    try {
      await window.CRONOX_API.admin.deleteAdminNote(noteId);
      loadNotes();
    } catch (error) {
      console.error('[ADMIN USER] Error eliminando nota', error);
      showModuleError({
        container: notesStatus || statusArea,
        error: error as CronoxApiError,
        title: 'No se pudo eliminar la nota',
        isCritical: false,
        retry: loadNotes,
      });
    }
  };

  if (!userId) {
    showGlobalBanner({
      type: 'error',
      title: 'Usuario no seleccionado',
      message: 'Falta el parámetro ?id=123 en la URL. Ejemplo: admin-user.html?id=123',
      details: { status: 400, endpoint: window.location.href, message: 'Parámetro id faltante' },
      actions: [{ label: 'Volver a usuarios', href: usersReturnLink, variant: 'primary' }],
    });
    if (profileList) {
      if (renderEmptyState) {
        renderEmptyState(profileList, {
          title: 'Usuario no encontrado',
          message: 'Selecciona un usuario desde el listado.',
          actions: [{ label: 'Volver a usuarios', href: usersReturnLink, variant: 'primary' }],
        });
      } else {
        profileList.innerHTML = '<div class="note-meta">No hay usuario seleccionado.</div>';
      }
    }
  }

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
