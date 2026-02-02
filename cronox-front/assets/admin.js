(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const requestsBody = $('#requestsBody');
  const messageBox = $('#messageBox');
  const filterStatus = $('#filterStatus');
  const requestSearch = $('#requestSearch');
  const requestDateFrom = $('#requestDateFrom');
  const requestDateTo = $('#requestDateTo');
  const requestAttemptsMin = $('#requestAttemptsMin');
  const requestAttemptsMax = $('#requestAttemptsMax');
  const requestSocialNetwork = $('#requestSocialNetwork');
  const requestUserCircle = $('#requestUserCircle');
  const requestSortBy = $('#requestSortBy');
  const requestSortDir = $('#requestSortDir');
  const requestFiltersReset = $('#requestFiltersReset');
  const requestsPageInfo = $('#requestsPageInfo');
  const requestsPrev = $('#requestsPrev');
  const requestsNext = $('#requestsNext');
  const requestsPageSize = $('#requestsPageSize');
  const requestsBody23 = $('#requestsBody23');
  const messageBox23 = $('#messageBox23');
  const filterStatus23 = $('#filterStatus23');
  const requestSearch23 = $('#requestSearch23');
  const requestDateFrom23 = $('#requestDateFrom23');
  const requestDateTo23 = $('#requestDateTo23');
  const requestAttemptsMin23 = $('#requestAttemptsMin23');
  const requestAttemptsMax23 = $('#requestAttemptsMax23');
  const requestSocialNetwork23 = $('#requestSocialNetwork23');
  const requestUserCircle23 = $('#requestUserCircle23');
  const requestSortBy23 = $('#requestSortBy23');
  const requestSortDir23 = $('#requestSortDir23');
  const requestFiltersReset23 = $('#requestFiltersReset23');
  const requestsPageInfo23 = $('#requestsPageInfo23');
  const requestsPrev23 = $('#requestsPrev23');
  const requestsNext23 = $('#requestsNext23');
  const requestsPageSize23 = $('#requestsPageSize23');
  const tabs = document.querySelectorAll('#adminTabs button');
  const logoutBtn = $('#logoutBtn');
  const backBtn = $('#backBtn');
  const refreshDashboardBtn = $('#refreshDashboardBtn');
  const dashboardMessage = $('#dashboardMessage');
  const totalUsers = $('#totalUsers');
  const usersByCircle = $('#usersByCircle');
  const pendingRequestsTotal = $('#pendingRequestsTotal');
  const pendingRequestsByType = $('#pendingRequestsByType');
  const ordersTotal = $('#ordersTotal');
  const ordersBreakdown = $('#ordersBreakdown');
  const revenueToday = $('#revenueToday');
  const revenueMonth = $('#revenueMonth');
  const alertLowStock = $('#alertLowStock');
  const alertOldRequests = $('#alertOldRequests');
  const loadingRow = '<tr><td colspan="8" class="empty">Cargando solicitudes…</td></tr>';
  const productsBody = $('#productsBody');
  const productsMessage = $('#productsMessage');
  const productSearch = $('#productSearch');
  const productStatusFilter = $('#productStatusFilter');
  const productDateFrom = $('#productDateFrom');
  const productDateTo = $('#productDateTo');
  const productStockState = $('#productStockState');
  const productCategory = $('#productCategory');
  const productSortBy = $('#productSortBy');
  const productSortDir = $('#productSortDir');
  const productFiltersReset = $('#productFiltersReset');
  const productsPageInfo = $('#productsPageInfo');
  const productsPrev = $('#productsPrev');
  const productsNext = $('#productsNext');
  const productsPageSize = $('#productsPageSize');
  const createProductBtn = $('#createProductBtn');
  const productModal = $('#productModal');
  const productModalTitle = $('#productModalTitle');
  const productForm = $('#productForm');
  const productImagesInput = $('#productImages');
  const productImagesPreview = $('#productImagesPreview');
  const productCancelBtn = $('#productCancelBtn');
  const productSubmitBtn = $('#productSubmitBtn');
  const codesBody = $('#codesBody');
  const codesMessage = $('#codesMessage');
  const codeSearch = $('#codeSearch');
  const codeStatusFilter = $('#codeStatusFilter');
  const createCodeBtn = $('#createCodeBtn');
  const codeModal = $('#codeModal');
  const codeModalTitle = $('#codeModalTitle');
  const codeForm = $('#codeForm');
  const codeCancelBtn = $('#codeCancelBtn');
  const codeSubmitBtn = $('#codeSubmitBtn');
  const productsState = {
    page: 1,
    pageSize: 25,
    q: '',
    dateFrom: '',
    dateTo: '',
    stockState: '',
    categoryId: '',
    isActive: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
  };
  const codesState = { page: 1, limit: 20, search: '', isActive: '' };
  const requestsState = {
    page: 1,
    pageSize: 25,
    q: '',
    status: 'PENDING',
    dateFrom: '',
    dateTo: '',
    attemptsMin: '',
    attemptsMax: '',
    socialNetwork: '',
    userCircle: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
  };
  const requests23State = {
    page: 1,
    pageSize: 25,
    q: '',
    status: 'PENDING',
    dateFrom: '',
    dateTo: '',
    attemptsMin: '',
    attemptsMax: '',
    socialNetwork: '',
    userCircle: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
  };
  let editingProductId = null;
  let editingCodeId = null;
  let cachedProductImages = [];
  let codesCache = [];
  let productSearchTimeout = null;
  let codeSearchTimeout = null;
  let requestSearchTimeout = null;
  let requestSearchTimeout23 = null;

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

  const setScopedMessage = (el, text = '', type = 'success') => {
    if (!el) return;
    if (!text) {
      el.className = 'message';
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.className = `message show ${type === 'error' ? 'error' : 'success'}`;
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

  const STATUS_LABELS = {
    PENDING: 'PENDIENTE',
    APPROVED: 'APROBADA',
    DENIED: 'RECHAZADA',
    EXPIRED: 'EXPIRADA',
  };

  const statusBadge = (status) => {
    const normalized = String(status || '').toUpperCase();
    const cls =
      normalized === 'APPROVED'
        ? 'approved'
        : normalized === 'DENIED'
          ? 'denied'
          : normalized === 'EXPIRED'
            ? 'expired'
            : 'pending';
    const label = STATUS_LABELS[normalized] || normalized || '—';
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

  const formatRelativeTime = (value) => {
    if (!value) return { label: '—', full: '—' };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return { label: String(value), full: String(value) };
    }
    const diffMs = Date.now() - date.getTime();
    const future = diffMs < 0;
    const absSeconds = Math.round(Math.abs(diffMs) / 1000);
    const absMinutes = Math.round(absSeconds / 60);
    const absHours = Math.round(absMinutes / 60);
    const absDays = Math.round(absHours / 24);

    let label = '';
    if (absSeconds < 60) {
      label = `${future ? 'en' : 'hace'} ${absSeconds}s`;
    } else if (absMinutes < 60) {
      label = `${future ? 'en' : 'hace'} ${absMinutes}m`;
    } else if (absHours < 24) {
      label = `${future ? 'en' : 'hace'} ${absHours}h`;
    } else {
      label = `${future ? 'en' : 'hace'} ${absDays} días`;
    }

    return { label, full: formatDate(date) };
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

  const formatMoney = (cents) => {
    const value = Number(cents || 0) / 100;
    if (window.CRONOX_API?.formatPrice) {
      try {
        return window.CRONOX_API.formatPrice(value);
      } catch (e) {
        // ignore
      }
    }
    return `${value.toFixed(2)} €`;
  };

  const formatCurrency = (value) => {
    const amount = Number(value || 0);
    if (window.CRONOX_API?.formatPrice) {
      try {
        return window.CRONOX_API.formatPrice(amount);
      } catch (e) {
        // ignore
      }
    }
    return `${amount.toFixed(2)} €`;
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

  const toggleModal = (modalEl, open) => {
    if (!modalEl) return;
    if (open) {
      modalEl.classList.add('show');
    } else {
      modalEl.classList.remove('show');
    }
  };

  const parseNumberOrNull = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizeDateRange = (value, endOfDay = false) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date.toISOString();
  };

  const buildRequestQuery = (state) => {
    return {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q || undefined,
      status: state.status || undefined,
      sortBy: state.sortBy || undefined,
      sortDir: state.sortDir || undefined,
      dateFrom: state.dateFrom ? normalizeDateRange(state.dateFrom) : undefined,
      dateTo: state.dateTo ? normalizeDateRange(state.dateTo, true) : undefined,
      attemptsMin: parseNumberOrNull(state.attemptsMin) ?? undefined,
      attemptsMax: parseNumberOrNull(state.attemptsMax) ?? undefined,
      socialNetwork: state.socialNetwork || undefined,
      userCircle: parseNumberOrNull(state.userCircle) ?? undefined,
    };
  };

  const buildProductQuery = (state) => {
    return {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q || undefined,
      isActive: state.isActive || undefined,
      dateFrom: state.dateFrom ? normalizeDateRange(state.dateFrom) : undefined,
      dateTo: state.dateTo ? normalizeDateRange(state.dateTo, true) : undefined,
      stockState: state.stockState || undefined,
      categoryId: parseNumberOrNull(state.categoryId) ?? undefined,
      sortBy: state.sortBy || undefined,
      sortDir: state.sortDir || undefined,
    };
  };

  const normalizePaginated = (data, state) => {
    if (Array.isArray(data)) {
      return {
        items: data,
        page: state.page,
        pageSize: state.pageSize,
        totalItems: data.length,
        totalPages: 1,
      };
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    const page = Number(data?.page ?? state.page);
    const pageSize = Number(data?.pageSize ?? state.pageSize);
    const totalItems = Number(data?.totalItems ?? items.length);
    const totalPages = Number(data?.totalPages ?? Math.max(1, Math.ceil(totalItems / pageSize || 1)));
    return { items, page, pageSize, totalItems, totalPages };
  };

  const updatePagination = (meta, state, elements) => {
    const { info, prev, next, size } = elements;
    if (info) {
      info.textContent = `Página ${meta.page} de ${meta.totalPages} · ${meta.totalItems} resultados`;
    }
    if (prev) prev.disabled = meta.page <= 1;
    if (next) next.disabled = meta.page >= meta.totalPages;
    if (size && size.value !== String(state.pageSize)) {
      size.value = String(state.pageSize);
    }
  };

  const syncRequestsStateFromInputs = () => {
    if (filterStatus) requestsState.status = filterStatus.value || 'PENDING';
    if (requestSearch) requestsState.q = requestSearch.value.trim();
    if (requestDateFrom) requestsState.dateFrom = requestDateFrom.value;
    if (requestDateTo) requestsState.dateTo = requestDateTo.value;
    if (requestAttemptsMin) requestsState.attemptsMin = requestAttemptsMin.value;
    if (requestAttemptsMax) requestsState.attemptsMax = requestAttemptsMax.value;
    if (requestSocialNetwork) requestsState.socialNetwork = requestSocialNetwork.value.trim();
    if (requestUserCircle) requestsState.userCircle = requestUserCircle.value;
    if (requestSortBy) requestsState.sortBy = requestSortBy.value || 'createdAt';
    if (requestSortDir) requestsState.sortDir = requestSortDir.value || 'desc';
  };

  const syncRequests23StateFromInputs = () => {
    if (filterStatus23) requests23State.status = filterStatus23.value || 'PENDING';
    if (requestSearch23) requests23State.q = requestSearch23.value.trim();
    if (requestDateFrom23) requests23State.dateFrom = requestDateFrom23.value;
    if (requestDateTo23) requests23State.dateTo = requestDateTo23.value;
    if (requestAttemptsMin23) requests23State.attemptsMin = requestAttemptsMin23.value;
    if (requestAttemptsMax23) requests23State.attemptsMax = requestAttemptsMax23.value;
    if (requestSocialNetwork23) requests23State.socialNetwork = requestSocialNetwork23.value.trim();
    if (requestUserCircle23) requests23State.userCircle = requestUserCircle23.value;
    if (requestSortBy23) requests23State.sortBy = requestSortBy23.value || 'createdAt';
    if (requestSortDir23) requests23State.sortDir = requestSortDir23.value || 'desc';
  };

  const syncProductsStateFromInputs = () => {
    if (productSearch) productsState.q = productSearch.value.trim();
    if (productDateFrom) productsState.dateFrom = productDateFrom.value;
    if (productDateTo) productsState.dateTo = productDateTo.value;
    if (productStockState) productsState.stockState = productStockState.value;
    if (productCategory) productsState.categoryId = productCategory.value;
    if (productStatusFilter) productsState.isActive = productStatusFilter.value;
    if (productSortBy) productsState.sortBy = productSortBy.value || 'createdAt';
    if (productSortDir) productsState.sortDir = productSortDir.value || 'desc';
  };

  const resetProductsFilters = () => {
    if (productSearch) productSearch.value = '';
    if (productDateFrom) productDateFrom.value = '';
    if (productDateTo) productDateTo.value = '';
    if (productStockState) productStockState.value = '';
    if (productCategory) productCategory.value = '';
    if (productStatusFilter) productStatusFilter.value = '';
    if (productSortBy) productSortBy.value = 'createdAt';
    if (productSortDir) productSortDir.value = 'desc';
    productsState.page = 1;
    syncProductsStateFromInputs();
    fetchProducts();
  };

  const resetRequestsFilters = () => {
    if (requestSearch) requestSearch.value = '';
    if (requestDateFrom) requestDateFrom.value = '';
    if (requestDateTo) requestDateTo.value = '';
    if (requestAttemptsMin) requestAttemptsMin.value = '';
    if (requestAttemptsMax) requestAttemptsMax.value = '';
    if (requestSocialNetwork) requestSocialNetwork.value = '';
    if (requestUserCircle) requestUserCircle.value = '';
    if (filterStatus) filterStatus.value = 'PENDING';
    if (requestSortBy) requestSortBy.value = 'createdAt';
    if (requestSortDir) requestSortDir.value = 'desc';
    requestsState.page = 1;
    syncRequestsStateFromInputs();
    fetchRequests();
  };

  const resetRequests23Filters = () => {
    if (requestSearch23) requestSearch23.value = '';
    if (requestDateFrom23) requestDateFrom23.value = '';
    if (requestDateTo23) requestDateTo23.value = '';
    if (requestAttemptsMin23) requestAttemptsMin23.value = '';
    if (requestAttemptsMax23) requestAttemptsMax23.value = '';
    if (requestSocialNetwork23) requestSocialNetwork23.value = '';
    if (requestUserCircle23) requestUserCircle23.value = '';
    if (filterStatus23) filterStatus23.value = 'PENDING';
    if (requestSortBy23) requestSortBy23.value = 'createdAt';
    if (requestSortDir23) requestSortDir23.value = 'desc';
    requests23State.page = 1;
    syncRequests23StateFromInputs();
    fetchRequests23();
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
        const created = formatRelativeTime(req.createdAt);
        const normalizedStatus = String(req.status || '').toUpperCase();
        const isActionable = normalizedStatus === 'PENDING' || normalizedStatus === 'EXPIRED';
        const actions = isActionable
          ? `<div class="actions">
              <button class="btn primary" data-action="approve" data-id="${req.id}">APROBAR</button>
              <button class="btn danger" data-action="deny" data-id="${req.id}">RECHAZAR</button>
            </div>`
          : '<span style="color:#7b7f8f;">—</span>';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;

        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
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
        const created = formatRelativeTime(req.createdAt);
        const remaining = typeof req.remainingMs === 'number' ? formatDuration(req.remainingMs) : '—';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
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
    try {
      const data = await window.CRONOX_API?.admin?.listCircleUpgradeRequests(
        buildRequestQuery(requestsState),
      );
      const meta = normalizePaginated(data, requestsState);
      requestsState.page = meta.page;
      requestsState.pageSize = meta.pageSize;
      renderRequests(meta.items || []);
      updatePagination(meta, requestsState, {
        info: requestsPageInfo,
        prev: requestsPrev,
        next: requestsNext,
        size: requestsPageSize,
      });
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
    try {
      const data = await window.CRONOX_API?.admin?.listAutoCircleRequests(
        buildRequestQuery(requests23State),
      );
      const meta = normalizePaginated(data, requests23State);
      requests23State.page = meta.page;
      requests23State.pageSize = meta.pageSize;
      renderRequests23(meta.items || []);
      updatePagination(meta, requests23State, {
        info: requestsPageInfo23,
        prev: requestsPrev23,
        next: requestsNext23,
        size: requestsPageSize23,
      });
    } catch (error) {
      console.error('[ADMIN] Error cargando solicitudes 2->3', error);
      if (messageBox23) {
        messageBox23.textContent = 'No se pudieron cargar las solicitudes 2→3.';
        messageBox23.className = 'message show error';
      }
      renderRequests23([], { error: true });
    }
  };

  const setDashboardValue = (el, value) => {
    if (!el) return;
    el.textContent = value ?? '—';
  };

  const renderDashboard = (data) => {
    if (!data) return;
    setDashboardValue(totalUsers, data.users?.total ?? 0);

    if (usersByCircle) {
      const circles = Array.isArray(data.users?.byCircle) ? data.users.byCircle : [];
      usersByCircle.innerHTML = circles.length
        ? circles
            .map((item) => `<span class="badge">Círculo ${item.circle}: ${item.count}</span>`)
            .join('')
        : '<span class="badge">Sin datos</span>';
    }

    setDashboardValue(pendingRequestsTotal, data.requests?.pendingTotal ?? 0);
    if (pendingRequestsByType) {
      const byType = data.requests?.byType || {};
      const entries = Object.entries(byType);
      pendingRequestsByType.innerHTML = entries.length
        ? entries
            .map(([key, value]) => `<span class=\"badge\">${key}: ${value ?? 0}</span>`)
            .join('')
        : '<span class="badge">Sin datos</span>';
    }

    setDashboardValue(ordersTotal, data.orders?.total ?? 0);
    if (ordersBreakdown) {
      const today = data.orders?.today ?? 0;
      const week = data.orders?.week ?? 0;
      ordersBreakdown.textContent = `Hoy: ${today} · Semana: ${week}`;
    }

    setDashboardValue(revenueToday, formatCurrency(data.revenue?.today ?? 0));
    if (revenueMonth) {
      revenueMonth.textContent = `Mes: ${formatCurrency(data.revenue?.month ?? 0)}`;
    }

    setDashboardValue(alertLowStock, data.alerts?.lowStock ?? 0);
    setDashboardValue(alertOldRequests, data.alerts?.oldPendingRequests ?? 0);
  };

  const fetchDashboard = async () => {
    setScopedMessage(dashboardMessage, '');
    if (totalUsers) totalUsers.textContent = '…';
    try {
      const data = await window.CRONOX_API?.admin?.getDashboard?.();
      renderDashboard(data);
    } catch (error) {
      console.error('No se pudo cargar el dashboard', error);
      setScopedMessage(dashboardMessage, 'No se pudieron cargar los datos del resumen.', 'error');
    }
  };

  const renderProductImagesPreview = (urls = []) => {
    if (!productImagesPreview) return;
    if (!urls.length) {
      productImagesPreview.innerHTML = '<p class="empty" style="margin:0;">Sin imágenes seleccionadas.</p>';
      return;
    }

    productImagesPreview.innerHTML = urls
      .map(
        (url) => `
          <div class="image-thumb">
            <img src="${url}" alt="preview" />
          </div>
        `,
      )
      .join('');
  };

  const collectVariantPayload = () => {
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    return sizes.map((size) => {
      const input = document.getElementById(`stock${size}`);
      const stock = Number(input?.value || 0);
      return { size, stockQty: Number.isFinite(stock) ? stock : 0 };
    });
  };

  const resetProductForm = () => {
    editingProductId = null;
    cachedProductImages = [];
    productForm?.reset();
    renderProductImagesPreview([]);
    if (productModalTitle) productModalTitle.textContent = 'Crear producto';
    if (productSubmitBtn) productSubmitBtn.disabled = false;
  };

  const loadProductCategories = async () => {
    if (!productCategory || !window.CRONOX_API?.getCategories) return;
    try {
      const categories = await window.CRONOX_API.getCategories({ page: 1, limit: 200 });
      const options = Array.isArray(categories) ? categories : [];
      const currentValue = productCategory.value;
      productCategory.innerHTML = '<option value="">Todas</option>';
      options.forEach((category) => {
        const option = document.createElement('option');
        option.value = String(category.id);
        option.textContent = category.name || category.slug || `Categoría ${category.id}`;
        productCategory.appendChild(option);
      });
      if (currentValue) {
        productCategory.value = currentValue;
      }
    } catch (error) {
      console.warn('[ADMIN] No se pudieron cargar categorías', error);
    }
  };

  const fetchProducts = async () => {
    if (!productsBody) return;
    productsBody.innerHTML = '<tr><td colspan="7" class="empty">Cargando productos…</td></tr>';
    setScopedMessage(productsMessage, '');
    try {
      const data = await window.CRONOX_API?.admin?.listAdminProducts(
        buildProductQuery(productsState),
      );
      const meta = normalizePaginated(data, productsState);
      productsState.page = meta.page;
      productsState.pageSize = meta.pageSize;
      renderProducts(meta.items || []);
      updatePagination(meta, productsState, {
        info: productsPageInfo,
        prev: productsPrev,
        next: productsNext,
        size: productsPageSize,
      });
    } catch (error) {
      console.error('[ADMIN] Error cargando productos', error);
      setScopedMessage(productsMessage, 'No se pudieron cargar los productos.', 'error');
      productsBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty">
            Error al cargar productos.
            <button type="button" class="btn" data-retry-products="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>`;
    }
  };

  const renderProducts = (items = []) => {
    if (!productsBody) return;
    if (!items.length) {
      productsBody.innerHTML = '<tr><td colspan="7" class="empty">No hay productos con esos filtros.</td></tr>';
      return;
    }

    productsBody.innerHTML = items
      .map((product) => {
        const totalStock = Array.isArray(product.variants)
          ? product.variants.reduce((acc, variant) => acc + (Number(variant.stockQty ?? variant.stock ?? 0) || 0), 0)
          : 0;
        const primaryImage =
          product.imageUrl ||
          (Array.isArray(product.images) && product.images.length ? product.images[0].url : '');
        const activeLabel = product.isActive ? 'Activo' : 'Inactivo';
        const created = formatRelativeTime(product.createdAt);
        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:10px;">
                ${primaryImage ? `<img src="${primaryImage}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid #1d1d26;" />` : ''}
                <div>
                  <div style="font-weight:600;">${product.name}</div>
                  <div style="color:#8e93a4; font-size:0.9rem;">${product.slug || ''}</div>
                </div>
              </div>
            </td>
            <td>${formatMoney(product.price)}</td>
            <td>${product.collection || '—'}</td>
            <td>${activeLabel}</td>
            <td>${totalStock}</td>
            <td>
              <div class="time-label" title="${created.full}">${created.label}</div>
              <div class="time-sub">${created.full}</div>
            </td>
            <td>
              <div class="actions">
                <button class="btn" data-edit-product="${product.id}">Editar</button>
                <button class="btn danger" data-disable-product="${product.id}">${product.isActive ? 'Desactivar' : 'Inactivar'}</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const openProductModal = async (productId = null) => {
    resetProductForm();
    editingProductId = productId;
    if (!productModal) return;

    if (productId) {
      if (productModalTitle) productModalTitle.textContent = 'Editar producto';
      try {
        const product = await window.CRONOX_API?.admin?.getAdminProduct(productId);
        if (product) {
          const priceInput = document.getElementById('productPrice');
          const nameInput = document.getElementById('productName');
          const descInput = document.getElementById('productDescription');
          const collectionInput = document.getElementById('productCollection');
          const isActiveInput = document.getElementById('productIsActive');

          if (nameInput) nameInput.value = product.name || '';
          if (descInput) descInput.value = product.description || '';
          if (collectionInput) collectionInput.value = product.collection || '';
          if (priceInput) priceInput.value = Number(product.price || 0) / 100;
          if (isActiveInput) isActiveInput.checked = Boolean(product.isActive);

          cachedProductImages = Array.isArray(product.images)
            ? product.images.map((img) => img?.url).filter(Boolean)
            : [];
          renderProductImagesPreview(cachedProductImages);

          const variantMap = Array.isArray(product.variants)
            ? product.variants.reduce((acc, variant) => {
                if (variant.size) acc[String(variant.size).toUpperCase()] = variant;
                return acc;
              }, {})
            : {};
          ['XS', 'S', 'M', 'L', 'XL', 'XXL'].forEach((size) => {
            const input = document.getElementById(`stock${size}`);
            if (input) {
              input.value = variantMap[size]?.stockQty ?? variantMap[size]?.stock ?? 0;
            }
          });
        }
      } catch (error) {
        console.error('[ADMIN] Error obteniendo producto', error);
        setScopedMessage(productsMessage, 'No se pudo cargar el producto.', 'error');
        return;
      }
    }

    toggleModal(productModal, true);
  };

  const uploadProductImages = async (files) => {
    if (!files || !files.length) return [];
    try {
      const response = await window.CRONOX_API?.admin?.uploadProductImages(files);
      if (Array.isArray(response?.urls)) {
        return response.urls;
      }
    } catch (error) {
      console.error('[ADMIN] Error subiendo imágenes', error);
      throw new Error(error?.message || 'No se pudieron subir las imágenes');
    }
    return [];
  };

  const submitProduct = async (event) => {
    event?.preventDefault();
    if (!productForm) return;

    const formData = new FormData(productForm);
    const priceValue = Number(formData.get('price') || 0);
    const priceCents = Number.isFinite(priceValue) ? Math.round(priceValue * 100) : 0;
    const payload = {
      name: formData.get('name') || '',
      description: formData.get('description') || '',
      collection: formData.get('collection') || '',
      price: priceCents,
      isActive: productForm.querySelector('#productIsActive')?.checked ?? true,
      variants: collectVariantPayload(),
    };

    let imageUrls = [];
    const files = productImagesInput?.files ? Array.from(productImagesInput.files) : [];

    try {
      if (files.length) {
        imageUrls = await uploadProductImages(files);
      } else if (!editingProductId) {
        imageUrls = cachedProductImages;
      }

      if (imageUrls.length) {
        payload.imageUrls = imageUrls;
      }

      if (editingProductId) {
        await window.CRONOX_API?.admin?.updateAdminProduct(editingProductId, payload);
        setScopedMessage(productsMessage, 'Producto actualizado correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.createAdminProduct(payload);
        setScopedMessage(productsMessage, 'Producto creado correctamente.', 'success');
      }

      toggleModal(productModal, false);
      await fetchProducts();
    } catch (error) {
      console.error('[ADMIN] Error guardando producto', error);
      const message = error?.message || 'No se pudo guardar el producto.';
      setScopedMessage(productsMessage, message, 'error');
    } finally {
      if (productSubmitBtn) productSubmitBtn.disabled = false;
    }
  };

  const disableProduct = async (productId) => {
    if (!productId) return;
    if (!window.confirm('¿Desactivar este producto?')) return;
    try {
      await window.CRONOX_API?.admin?.deleteAdminProduct(productId);
      setScopedMessage(productsMessage, 'Producto desactivado.', 'success');
      fetchProducts();
    } catch (error) {
      console.error('[ADMIN] Error al desactivar producto', error);
      setScopedMessage(productsMessage, error?.message || 'No se pudo desactivar.', 'error');
    }
  };

  const onProductTableClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editId = target.dataset.editProduct;
    const disableId = target.dataset.disableProduct;
    if (target.dataset.retryProducts) {
      fetchProducts();
      return;
    }
    if (editId) {
      openProductModal(Number(editId));
      return;
    }
    if (disableId) {
      disableProduct(Number(disableId));
    }
  };

  const resetCodeForm = () => {
    editingCodeId = null;
    codeForm?.reset();
    if (codeModalTitle) codeModalTitle.textContent = 'Crear código';
  };

  const fetchCodes = async () => {
    if (!codesBody) return;
    codesBody.innerHTML = '<tr><td colspan="6" class="empty">Cargando códigos…</td></tr>';
    setScopedMessage(codesMessage, '');
    const query = {
      page: codesState.page,
      limit: codesState.limit,
      search: codesState.search || undefined,
      isActive: codesState.isActive || undefined,
    };
    try {
      const data = await window.CRONOX_API?.admin?.listPromoCodes(query);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      codesCache = items;
      renderCodes(items);
    } catch (error) {
      console.error('[ADMIN] Error cargando códigos', error);
      setScopedMessage(codesMessage, 'No se pudieron cargar los códigos.', 'error');
      codesBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty">
            Error al cargar códigos.
            <button type="button" class="btn" data-retry-codes="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>`;
    }
  };

  const renderCodes = (items = []) => {
    if (!codesBody) return;
    if (!items.length) {
      codesBody.innerHTML = '<tr><td colspan="6" class="empty">No hay códigos con esos filtros.</td></tr>';
      return;
    }

    codesBody.innerHTML = items
      .map((code) => {
        const typeLabel = code.type === 'PERCENT' ? `${code.value}%` : formatMoney(code.value);
        const usageLabel =
          code.usageLimit != null ? `${code.usageCount || 0} / ${code.usageLimit}` : `${code.usageCount || 0}`;
        const activeLabel = code.isActive ? 'Activo' : 'Inactivo';
        const dateLabel = (value) => (value ? formatDate(value) : '—');
        return `
          <tr>
            <td>
              <div style="font-weight:600;">${code.code}</div>
              <div style="color:#8e93a4; font-size:0.9rem;">${activeLabel}</div>
            </td>
            <td>${code.type}</td>
            <td>${typeLabel}</td>
            <td>${usageLabel}</td>
            <td>
              <div style="display:flex; flex-direction:column; gap:4px; color:#8e93a4; font-size:0.9rem;">
                <span>Inicio: ${dateLabel(code.startsAt)}</span>
                <span>Expira: ${dateLabel(code.expiresAt)}</span>
              </div>
            </td>
            <td>
              <div class="actions">
                <button class="btn" data-edit-code="${code.id}">Editar</button>
                <button class="btn danger" data-disable-code="${code.id}">${code.isActive ? 'Desactivar' : 'Inactivar'}</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const openCodeModal = (code = null) => {
    resetCodeForm();
    editingCodeId = code?.id ?? null;
      if (code) {
        if (codeModalTitle) codeModalTitle.textContent = 'Editar código';
        const codeInput = document.getElementById('codeCode');
        const typeInput = document.getElementById('codeType');
        const valueInput = document.getElementById('codeValue');
        const minCartInput = document.getElementById('codeMinCart');
        const usageLimitInput = document.getElementById('codeUsageLimit');
        const startsAtInput = document.getElementById('codeStartsAt');
        const expiresAtInput = document.getElementById('codeExpiresAt');
        const isActiveInput = document.getElementById('codeIsActive');

        if (codeInput) codeInput.value = code.code || '';
        const typeValue = code.type || 'PERCENT';
        if (typeInput) typeInput.value = typeValue;
        if (valueInput) {
          const isPercent = String(typeValue).toUpperCase() === 'PERCENT';
          valueInput.value = isPercent ? code.value ?? '' : Number(code.value || 0) / 100;
        }
        if (minCartInput) minCartInput.value = code.minCartValue != null ? Number(code.minCartValue) / 100 : '';
        if (usageLimitInput) usageLimitInput.value = code.usageLimit ?? '';
        if (startsAtInput && code.startsAt) {
          startsAtInput.value = new Date(code.startsAt).toISOString().slice(0, 16);
        }
      if (expiresAtInput && code.expiresAt) {
        expiresAtInput.value = new Date(code.expiresAt).toISOString().slice(0, 16);
      }
      if (isActiveInput) isActiveInput.checked = Boolean(code.isActive);
    }

    toggleModal(codeModal, true);
  };

  const submitCode = async (event) => {
    event?.preventDefault();
    if (!codeForm) return;

    const formData = new FormData(codeForm);
    const codeValue = (formData.get('code') || '').toString().replace(/\s+/g, '').toUpperCase();
    const payload = {
      code: codeValue,
      type: formData.get('type') || 'PERCENT',
      value: Number(formData.get('value') || 0),
      minCartValue: formData.get('minCartValue') ? Math.round(Number(formData.get('minCartValue')) * 100) : undefined,
      usageLimit: formData.get('usageLimit') ? Number(formData.get('usageLimit')) : undefined,
      startsAt: formData.get('startsAt')
        ? new Date(formData.get('startsAt')).toISOString()
        : undefined,
      expiresAt: formData.get('expiresAt')
        ? new Date(formData.get('expiresAt')).toISOString()
        : undefined,
      isActive: codeForm.querySelector('#codeIsActive')?.checked ?? true,
    };

    const isPercent = String(payload.type).toUpperCase() === 'PERCENT';
    payload.value = isPercent ? Math.round(payload.value) : Math.round(payload.value * 100);

    try {
      if (editingCodeId) {
        await window.CRONOX_API?.admin?.updatePromoCode(editingCodeId, payload);
        setScopedMessage(codesMessage, 'Código actualizado correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.createPromoCode(payload);
        setScopedMessage(codesMessage, 'Código creado correctamente.', 'success');
      }
      toggleModal(codeModal, false);
      fetchCodes();
    } catch (error) {
      console.error('[ADMIN] Error guardando código', error);
      setScopedMessage(codesMessage, error?.message || 'No se pudo guardar el código.', 'error');
    }
  };

  const disableCode = async (id) => {
    if (!id) return;
    if (!window.confirm('¿Desactivar este código?')) return;
    try {
      await window.CRONOX_API?.admin?.deletePromoCode(id);
      setScopedMessage(codesMessage, 'Código desactivado.', 'success');
      fetchCodes();
    } catch (error) {
      console.error('[ADMIN] Error desactivando código', error);
      setScopedMessage(codesMessage, error?.message || 'No se pudo desactivar.', 'error');
    }
  };

  const onCodesTableClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.retryCodes) {
      fetchCodes();
      return;
    }
    const editId = target.dataset.editCode;
    const disableId = target.dataset.disableCode;
    if (editId) {
      const parsedId = Number(editId);
      const found = codesCache.find((item) => item.id === parsedId);
      openCodeModal(found || { id: parsedId });
      return;
    }
    if (disableId) {
      disableCode(Number(disableId));
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
      filterStatus.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestSearch) {
      requestSearch.addEventListener('input', () => {
        clearTimeout(requestSearchTimeout);
        requestSearchTimeout = setTimeout(() => {
          syncRequestsStateFromInputs();
          requestsState.page = 1;
          fetchRequests();
        }, 250);
      });
    }
    if (requestDateFrom) {
      requestDateFrom.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestDateTo) {
      requestDateTo.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestAttemptsMin) {
      requestAttemptsMin.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestAttemptsMax) {
      requestAttemptsMax.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestSocialNetwork) {
      requestSocialNetwork.addEventListener('input', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestUserCircle) {
      requestUserCircle.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestSortBy) {
      requestSortBy.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestSortDir) {
      requestSortDir.addEventListener('change', () => {
        syncRequestsStateFromInputs();
        requestsState.page = 1;
        fetchRequests();
      });
    }
    if (requestFiltersReset) {
      requestFiltersReset.addEventListener('click', resetRequestsFilters);
    }
    if (requestsPrev) {
      requestsPrev.addEventListener('click', () => {
        if (requestsState.page > 1) {
          requestsState.page -= 1;
          fetchRequests();
        }
      });
    }
    if (requestsNext) {
      requestsNext.addEventListener('click', () => {
        requestsState.page += 1;
        fetchRequests();
      });
    }
    if (requestsPageSize) {
      requestsPageSize.addEventListener('change', () => {
        requestsState.pageSize = Number(requestsPageSize.value || 25);
        requestsState.page = 1;
        fetchRequests();
      });
    }

    if (filterStatus23) {
      filterStatus23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestSearch23) {
      requestSearch23.addEventListener('input', () => {
        clearTimeout(requestSearchTimeout23);
        requestSearchTimeout23 = setTimeout(() => {
          syncRequests23StateFromInputs();
          requests23State.page = 1;
          fetchRequests23();
        }, 250);
      });
    }
    if (requestDateFrom23) {
      requestDateFrom23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestDateTo23) {
      requestDateTo23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestAttemptsMin23) {
      requestAttemptsMin23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestAttemptsMax23) {
      requestAttemptsMax23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestSocialNetwork23) {
      requestSocialNetwork23.addEventListener('input', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestUserCircle23) {
      requestUserCircle23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestSortBy23) {
      requestSortBy23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestSortDir23) {
      requestSortDir23.addEventListener('change', () => {
        syncRequests23StateFromInputs();
        requests23State.page = 1;
        fetchRequests23();
      });
    }
    if (requestFiltersReset23) {
      requestFiltersReset23.addEventListener('click', resetRequests23Filters);
    }
    if (requestsPrev23) {
      requestsPrev23.addEventListener('click', () => {
        if (requests23State.page > 1) {
          requests23State.page -= 1;
          fetchRequests23();
        }
      });
    }
    if (requestsNext23) {
      requestsNext23.addEventListener('click', () => {
        requests23State.page += 1;
        fetchRequests23();
      });
    }
    if (requestsPageSize23) {
      requestsPageSize23.addEventListener('change', () => {
        requests23State.pageSize = Number(requestsPageSize23.value || 25);
        requests23State.page = 1;
        fetchRequests23();
      });
    }

    if (productStatusFilter) {
      productStatusFilter.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productSearch) {
      productSearch.addEventListener('input', () => {
        clearTimeout(productSearchTimeout);
        productSearchTimeout = setTimeout(() => {
          syncProductsStateFromInputs();
          productsState.page = 1;
          fetchProducts();
        }, 250);
      });
    }

    if (productDateFrom) {
      productDateFrom.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productDateTo) {
      productDateTo.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productStockState) {
      productStockState.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productCategory) {
      productCategory.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productSortBy) {
      productSortBy.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productSortDir) {
      productSortDir.addEventListener('change', () => {
        syncProductsStateFromInputs();
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productFiltersReset) {
      productFiltersReset.addEventListener('click', resetProductsFilters);
    }

    if (productsPrev) {
      productsPrev.addEventListener('click', () => {
        if (productsState.page > 1) {
          productsState.page -= 1;
          fetchProducts();
        }
      });
    }

    if (productsNext) {
      productsNext.addEventListener('click', () => {
        productsState.page += 1;
        fetchProducts();
      });
    }

    if (productsPageSize) {
      productsPageSize.addEventListener('change', () => {
        productsState.pageSize = Number(productsPageSize.value || 25);
        productsState.page = 1;
        fetchProducts();
      });
    }

    if (productImagesInput) {
      productImagesInput.addEventListener('change', () => {
        const files = productImagesInput.files ? Array.from(productImagesInput.files) : [];
        const urls = files.map((file) => URL.createObjectURL(file));
        renderProductImagesPreview(urls);
      });
    }

    if (productForm) {
      productForm.addEventListener('submit', submitProduct);
    }

    if (productCancelBtn) {
      productCancelBtn.addEventListener('click', () => toggleModal(productModal, false));
    }

    if (createProductBtn) {
      createProductBtn.addEventListener('click', () => openProductModal(null));
    }

    if (productsBody) {
      productsBody.addEventListener('click', onProductTableClick);
    }

    if (codeStatusFilter) {
      codeStatusFilter.addEventListener('change', () => {
        codesState.isActive = codeStatusFilter.value;
        fetchCodes();
      });
    }

    if (codeSearch) {
      codeSearch.addEventListener('input', () => {
        clearTimeout(codeSearchTimeout);
        codeSearchTimeout = setTimeout(() => {
          codesState.search = codeSearch.value.trim();
          fetchCodes();
        }, 250);
      });
    }

    if (codeForm) {
      codeForm.addEventListener('submit', submitCode);
    }

    const codeCodeInput = document.getElementById('codeCode');
    if (codeCodeInput) {
      codeCodeInput.addEventListener('input', () => {
        codeCodeInput.value = codeCodeInput.value.replace(/\s+/g, '').toUpperCase();
      });
    }

    if (codeCancelBtn) {
      codeCancelBtn.addEventListener('click', () => toggleModal(codeModal, false));
    }

    if (createCodeBtn) {
      createCodeBtn.addEventListener('click', () => openCodeModal());
    }

    if (codesBody) {
      codesBody.addEventListener('click', onCodesTableClick);
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
          if (targetSection === 'section-dashboard') {
            fetchDashboard();
          } else if (targetSection === 'section-34') {
            syncRequestsStateFromInputs();
            fetchRequests();
          } else if (targetSection === 'section-23') {
            syncRequests23StateFromInputs();
            fetchRequests23();
          } else if (targetSection === 'section-products') {
            syncProductsStateFromInputs();
            loadProductCategories();
            fetchProducts();
          } else if (targetSection === 'section-codes') {
            fetchCodes();
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

    refreshDashboardBtn?.addEventListener('click', fetchDashboard);
  };

  const init = async () => {
    const user = await ensureAdmin();
    if (!user) return;
    bindEvents();
    syncRequestsStateFromInputs();
    syncRequests23StateFromInputs();
    syncProductsStateFromInputs();
    fetchDashboard();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
