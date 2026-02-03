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
  const requestsBadge23 = $('#requestsBadge23');
  const requestsBadge34 = $('#requestsBadge34');
  const userDetailSection = $('#section-user');
  const userDetailBackBtn = $('#userDetailBack');
  const userDetailMessage = $('#userDetailMessage');
  const userAvatar = $('#userAvatar');
  const userName = $('#userName');
  const userEmail = $('#userEmail');
  const userBadges = $('#userBadges');
  const userOrdersCount = $('#userOrdersCount');
  const userTotalSpent = $('#userTotalSpent');
  const userRequestsCount = $('#userRequestsCount');
  const userLastActivity = $('#userLastActivity');
  const userLastActivityFull = $('#userLastActivityFull');
  const userDetailTabs = document.querySelectorAll('#userDetailTabs button');
  const userTabRequests = $('#userTabRequests');
  const userTabOrders = $('#userTabOrders');
  const userTabCodes = $('#userTabCodes');
  const userTabHistory = $('#userTabHistory');
  const userTabNotes = $('#userTabNotes');
  const userRequestsBody = $('#userRequestsBody');
  const userOrdersBody = $('#userOrdersBody');
  const userCodesBody = $('#userCodesBody');
  const userHistoryBody = $('#userHistoryBody');
  const userNotesList = $('#userNotesList');
  const userNoteInput = $('#userNoteInput');
  const userNoteSubmit = $('#userNoteSubmit');
  const userNotesMessage = $('#userNotesMessage');
  const activityBody = $('#activityBody');
  const activityMessage = $('#activityMessage');
  const activitySearch = $('#activitySearch');
  const activityActionType = $('#activityActionType');
  const activityTargetType = $('#activityTargetType');
  const activityDateFrom = $('#activityDateFrom');
  const activityDateTo = $('#activityDateTo');
  const activityFiltersReset = $('#activityFiltersReset');
  const activityPageInfo = $('#activityPageInfo');
  const activityPrev = $('#activityPrev');
  const activityNext = $('#activityNext');
  const activityPageSize = $('#activityPageSize');
  const usersBody = $('#usersBody');
  const usersMessage = $('#usersMessage');
  const usersPageInfo = $('#usersPageInfo');
  const usersPrev = $('#usersPrev');
  const usersNext = $('#usersNext');
  const usersSearch = $('#usersSearch');
  const usersEmail = $('#usersEmail');
  const usersPhone = $('#usersPhone');
  const usersRole = $('#usersRole');
  const usersCircle = $('#usersCircle');
  const usersSort = $('#usersSort');
  const usersOrder = $('#usersOrder');
  const usersFiltersReset = $('#usersFiltersReset');
  const usersPhoneHeader = $('#usersPhoneHeader');
  const apiUnavailable = $('#apiUnavailable');
  const statusArea = $('#statusArea');
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
  const loadingRow = '<tr><td colspan="9" class="empty">Cargando solicitudes…</td></tr>';
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
  const notesModal = $('#notesModal');
  const notesModalTitle = $('#notesModalTitle');
  const notesModalMessage = $('#notesModalMessage');
  const notesModalList = $('#notesModalList');
  const notesModalTextarea = $('#notesModalTextarea');
  const notesModalSubmit = $('#notesModalSubmit');
  const notesModalClose = $('#notesModalClose');
  const toastContainer = $('#toastContainer');
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
  const activityState = {
    page: 1,
    pageSize: 10,
    q: '',
    actionType: '',
    targetType: '',
    dateFrom: '',
    dateTo: '',
  };
  const usersState = {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
    q: '',
    email: '',
    phone: '',
    role: '',
    circle: '',
    sort: 'createdAt',
    order: 'desc',
  };
  const userDetailState = {
    userId: null,
    activeTab: 'requests',
    data: null,
  };
  const userNotesState = {
    items: [],
    editingId: null,
    targetId: null,
  };
  const requestNotesState = {
    items: [],
    editingId: null,
    targetType: '',
    targetId: '',
  };
  let editingProductId = null;
  let editingCodeId = null;
  let cachedProductImages = [];
  let codesCache = [];
  let productSearchTimeout = null;
  let codeSearchTimeout = null;
  let requestSearchTimeout = null;
  let requestSearchTimeout23 = null;
  let activitySearchTimeout = null;
  let usersSearchTimeout = null;
  let currentSectionId = 'section-dashboard';
  let lastSectionId = 'section-dashboard';
  let lastPendingCounts = { pending23: 0, pending34: 0 };
  const PENDING_STORAGE_KEY = 'cronox.admin.pendingCounts';
  const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'MODERATOR', 'LOGISTICS', 'MARKETING', 'ADMIN', 'SUPERADMIN']);
  const PERMISSIONS = {
    requests: ['SUPER_ADMIN', 'MODERATOR'],
    users: ['SUPER_ADMIN', 'MODERATOR'],
    userDetail: ['SUPER_ADMIN', 'MODERATOR'],
    products: ['SUPER_ADMIN', 'LOGISTICS'],
    orders: ['SUPER_ADMIN', 'LOGISTICS'],
    promoCodes: ['SUPER_ADMIN', 'MARKETING'],
    auditLog: ['SUPER_ADMIN'],
    notes: ['SUPER_ADMIN', 'MODERATOR'],
  };
  const SECTION_PERMISSIONS = {
    'section-23': 'requests',
    'section-34': 'requests',
    'section-activity': 'auditLog',
    'section-users': 'users',
    'section-products': 'products',
    'section-codes': 'promoCodes',
    'section-user': 'userDetail',
  };
  let currentAdminUser = null;
  let currentAdminRole = 'SUPER_ADMIN';

  const normalizeRole = (role) => {
    if (!role) return 'SUPER_ADMIN';
    if (role === 'SUPERADMIN' || role === 'ADMIN') return 'SUPER_ADMIN';
    return role;
  };

  const hasAccess = (role, allowedRoles) => {
    const effective = normalizeRole(role);
    if (effective === 'SUPER_ADMIN') return true;
    return Array.isArray(allowedRoles) && allowedRoles.includes(effective);
  };

  const canAccess = (key) => hasAccess(currentAdminRole, PERMISSIONS[key]);

  const ensureRestrictedNotice = (section) => {
    if (!section) return null;
    let notice = section.querySelector('.restricted-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'message error show restricted-notice';
      notice.textContent = 'No autorizado';
      section.prepend(notice);
    }
    return notice;
  };

  const applySectionAccess = (sectionId) => {
    const section = document.getElementById(sectionId);
    const permissionKey = SECTION_PERMISSIONS[sectionId];
    if (!permissionKey) {
      if (section) {
        section.classList.remove('restricted');
      }
      return true;
    }
    const allowed = canAccess(permissionKey);
    if (!section) return allowed;
    const notice = ensureRestrictedNotice(section);
    section.classList.toggle('restricted', !allowed);
    if (notice) {
      notice.hidden = allowed;
      notice.classList.toggle('show', !allowed);
    }
    return allowed;
  };

  const setTabVisibility = (sectionId, allowed) => {
    if (!tabs?.length) return;
    const tab = Array.from(tabs).find((btn) => btn.dataset.section === sectionId);
    if (tab) tab.hidden = !allowed;
  };

  const setUserTabVisibility = (tabId, allowed) => {
    if (!userDetailTabs?.length) return;
    const tab = Array.from(userDetailTabs).find((btn) => btn.dataset.userTab === tabId);
    if (tab) tab.hidden = !allowed;
  };

  const applyRoleVisibility = () => {
    setTabVisibility('section-23', canAccess('requests'));
    setTabVisibility('section-34', canAccess('requests'));
    setTabVisibility('section-activity', canAccess('auditLog'));
    setTabVisibility('section-users', canAccess('users'));
    setTabVisibility('section-products', canAccess('products'));
    setTabVisibility('section-codes', canAccess('promoCodes'));
    setUserTabVisibility('notes', canAccess('notes'));
    setUserTabVisibility('orders', canAccess('orders'));
    setUserTabVisibility('history', canAccess('auditLog'));
    if (!canAccess('notes') && userDetailState.activeTab === 'notes') {
      setUserDetailTab('requests');
    }
    if (!canAccess('orders') && userDetailState.activeTab === 'orders') {
      setUserDetailTab('requests');
    }
    if (!canAccess('auditLog') && userDetailState.activeTab === 'history') {
      setUserDetailTab('requests');
    }
    if (createProductBtn) createProductBtn.hidden = !canAccess('products');
    if (createCodeBtn) createCodeBtn.hidden = !canAccess('promoCodes');
  };

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

  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');

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

  const ui = window.CRONOX_UI || {};
  const renderBanner = ui.renderBanner;
  const renderEmptyState = ui.renderEmptyState;
  const setUiLoading = ui.setLoading;
  const classifyApiError = window.CRONOX_API?.classifyApiError || (() => ({
    severity: 'error',
    userMessage: 'No pudimos completar la solicitud.',
    isRetryable: true,
  }));

  const getErrorDetails = (error) => ({
    status: error?.status ?? error?.statusCode ?? 0,
    endpoint: error?.endpoint || '—',
    message: error?.message || 'Error desconocido',
  });

  const showGlobalStatus = (options) => {
    if (!renderBanner || !statusArea) return;
    renderBanner(statusArea, options);
  };

  const clearGlobalStatus = () => {
    if (!statusArea) return;
    statusArea.innerHTML = '';
  };

  const showModuleError = ({
    container,
    error,
    title,
    isCritical = false,
    retry,
    backLink,
    colSpan,
  }) => {
    if (!renderBanner || !container) return;
    const classification = classifyApiError(error);
    let severity = classification.severity || 'error';
    if (!isCritical && severity === 'error') {
      severity = 'warning';
    }
    const actions = [];
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
            console.warn('[ADMIN] No se pudo marcar login automático', error);
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
      colSpan,
    });
    if (isCritical) {
      showGlobalStatus({
        type: 'error',
        title: 'Problema crítico',
        message: classification.userMessage,
        details: getErrorDetails(error),
        actions,
      });
    }
  };

  const showEmptyTable = (container, options = {}) => {
    if (!renderEmptyState || !container) return;
    renderEmptyState(container, {
      title: options.title,
      message: options.message,
      actions: options.actions,
      colSpan: options.colSpan,
    });
  };

  const showToast = (message, type = 'success', title = '') => {
    if (!toastContainer || !message) return;
    const toast = document.createElement('div');
    const normalizedType = type === 'error' ? 'error' : 'success';
    const heading = title || (normalizedType === 'success' ? 'Listo' : 'Error');
    toast.className = `toast toast--${normalizedType}`;
    toast.innerHTML = `
      <strong>${escapeHtml(heading)}</strong>
      <div>${escapeHtml(message)}</div>
    `;
    toastContainer.appendChild(toast);
    const timeout = window.setTimeout(() => {
      toast.classList.add('toast--hide');
      window.setTimeout(() => toast.remove(), 220);
    }, 3200);
    toast.addEventListener('click', () => {
      window.clearTimeout(timeout);
      toast.remove();
    });
  };

  const readPendingStorage = () => {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || '{}') || {};
    } catch (error) {
      return {};
    }
  };

  const writePendingStorage = (payload) => {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(payload || {}));
  };

  const setBadge = (el, count, pulse) => {
    if (!el) return;
    const safeCount = Number(count || 0);
    if (safeCount > 0) {
      el.hidden = false;
      el.textContent = String(safeCount);
      el.classList.toggle('tab-badge--pulse', Boolean(pulse));
      return;
    }
    el.hidden = true;
    el.classList.remove('tab-badge--pulse');
  };

  const updateRequestBadges = (counts = {}) => {
    const stored = readPendingStorage();
    const pending23 = Number(counts.pending23 || 0);
    const pending34 = Number(counts.pending34 || 0);
    const pulse23 = pending23 > Number(stored.pending23 || 0);
    const pulse34 = pending34 > Number(stored.pending34 || 0);
    setBadge(requestsBadge23, pending23, pulse23);
    setBadge(requestsBadge34, pending34, pulse34);
    lastPendingCounts = { pending23, pending34 };
  };

  const markRequestsSeen = () => {
    const stored = readPendingStorage();
    writePendingStorage({
      ...stored,
      pending23: lastPendingCounts.pending23,
      pending34: lastPendingCounts.pending34,
      updatedAt: new Date().toISOString(),
    });
    updateRequestBadges(lastPendingCounts);
  };

  const redirectToHome = () => {
    window.location.href = 'index.html';
  };

  const redirectToLogin = () => {
    try {
      localStorage.setItem('cronox_open_auth_on_load', 'login');
    } catch (error) {
      console.warn('[ADMIN] No se pudo marcar login automático', error);
    }
    redirectToHome();
  };

  const showApiUnavailable = (reason = '') => {
    const detail = reason ? ` ${reason}` : '';
    if (renderBanner && statusArea) {
      renderBanner(statusArea, {
        type: 'error',
        title: 'API no disponible',
        message: `No pudimos conectar con la API.${detail}`,
        details: { status: 0, endpoint: '—', message: reason || 'API no disponible' },
        actions: [
          { label: 'Recargar', onClick: () => window.location.reload(), variant: 'primary' },
          { label: 'Volver', onClick: () => window.history.back() },
        ],
      });
    }
    setScopedMessage(apiUnavailable, `API no disponible.${detail}`, 'error');
  };

  const ensureAdmin = async () => {
    if (!window.CRONOX_API?.getMe) {
      showApiUnavailable('No se encontró el cliente de API.');
      return null;
    }
    const user = await window.CRONOX_API.getMe();
    const effectiveRole = normalizeRole(user?.role);
    if (!user || !ADMIN_ROLES.has(effectiveRole)) {
      redirectToHome();
      return null;
    }
    currentAdminUser = user;
    currentAdminRole = effectiveRole;
    return user;
  };

  const STATUS_LABELS = {
    PENDING: 'PENDIENTE',
    APPROVED: 'APROBADA',
    DENIED: 'RECHAZADA',
    REJECTED: 'RECHAZADA',
    EXPIRED: 'EXPIRADA',
  };

  const buildChip = (label, variant = 'gray') => {
    const safeLabel = escapeHtml(label || '—');
    return `<span class="chip chip--${variant}">${safeLabel}</span>`;
  };

  const statusBadge = (status) => {
    const normalized = String(status || '').toUpperCase();
    const label = STATUS_LABELS[normalized] || normalized || '—';
    const variant =
      normalized === 'APPROVED'
        ? 'green'
        : normalized === 'DENIED' || normalized === 'REJECTED'
          ? 'red'
          : normalized === 'EXPIRED'
            ? 'gray'
            : 'yellow';
    return buildChip(label, variant);
  };

  const orderStatusChip = (status) => {
    const normalized = String(status || '').toUpperCase();
    const label = normalized || '—';
    const variant =
      normalized === 'PAID' || normalized === 'SHIPPED' || normalized === 'DELIVERED' || normalized === 'COMPLETED'
        ? 'green'
        : normalized === 'PENDING'
          ? 'yellow'
          : normalized === 'CANCELLED' || normalized === 'CANCELED'
            ? 'red'
            : 'gray';
    return buildChip(label, variant);
  };

  const promoStatusChip = (isActive) => {
    return buildChip(isActive ? 'Activo' : 'Inactivo', isActive ? 'green' : 'red');
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

  const formatDateShort = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleDateString('es-ES');
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

  const formatAttemptLabel = (value) => {
    if (value == null || value === '') return '—';
    const attempt = Number(value);
    const label = Number.isFinite(attempt) ? `#${attempt}` : `#${value}`;
    const warning =
      Number.isFinite(attempt) && attempt >= 2
        ? ' <span class="attempts-warning" title="Muchos intentos">⚠️</span>'
        : '';
    return `${label}${warning}`;
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

  const setUserDetailMessage = (text = '', type = 'success') => {
    if (!userDetailMessage) return;
    if (!text) {
      userDetailMessage.className = 'message';
      userDetailMessage.textContent = '';
      return;
    }
    userDetailMessage.textContent = text;
    userDetailMessage.className = `message show ${type === 'error' ? 'error' : 'success'}`;
  };

  const setActiveAdminTab = (sectionId) => {
    if (!tabs?.length) return;
    tabs.forEach((btn) => btn.classList.toggle('primary', btn.dataset.section === sectionId));
  };

  const showSection = (sectionId) => {
    const allowed = applySectionAccess(sectionId);
    document.querySelectorAll('.admin-section').forEach((section) => {
      section.hidden = section.id !== sectionId;
    });
    currentSectionId = sectionId;
    if (sectionId === 'section-user') {
      if (tabs?.length) {
        tabs.forEach((btn) => btn.classList.remove('primary'));
      }
      return allowed;
    }
    setActiveAdminTab(sectionId);
    return allowed;
  };

  const getInitials = (value) => {
    if (!value) return 'CR';
    const parts = String(value).trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase());
    return letters.join('') || value.slice(0, 2).toUpperCase();
  };

  const setUserAvatar = (avatarUrl, displayName) => {
    if (!userAvatar) return;
    if (avatarUrl) {
      userAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName || 'Avatar'}">`;
      return;
    }
    userAvatar.textContent = getInitials(displayName);
  };

  const setUserDetailTab = (tabId) => {
    let resolvedTabId = tabId;
    let deniedLabel = '';
    if (tabId === 'notes' && !canAccess('notes')) {
      resolvedTabId = 'requests';
      deniedLabel = 'Notas';
    }
    if (tabId === 'orders' && !canAccess('orders')) {
      resolvedTabId = 'requests';
      deniedLabel = 'Pedidos';
    }
    if (tabId === 'history' && !canAccess('auditLog')) {
      resolvedTabId = 'requests';
      deniedLabel = 'Actividad';
    }
    if (resolvedTabId !== tabId) {
      showToast('No autorizado.', 'error', deniedLabel || 'Acceso');
    }
    userDetailState.activeTab = resolvedTabId;
    const panels = [
      { id: 'requests', el: userTabRequests },
      { id: 'orders', el: userTabOrders },
      { id: 'codes', el: userTabCodes },
      { id: 'history', el: userTabHistory },
      { id: 'notes', el: userTabNotes },
    ];
    panels.forEach((panel) => {
      if (panel.el) {
        panel.el.hidden = panel.id !== resolvedTabId;
      }
    });
    if (userDetailTabs?.length) {
      userDetailTabs.forEach((btn) => {
        btn.classList.toggle('primary', btn.dataset.userTab === tabId);
      });
    }
  };

  const renderUserRequests = (requests = []) => {
    if (!userRequestsBody) return;
    if (!requests.length) {
      showEmptyTable(userRequestsBody, {
        title: 'Sin solicitudes',
        message: 'Este usuario no tiene solicitudes registradas.',
        colSpan: 6,
      });
      return;
    }
    userRequestsBody.innerHTML = requests
      .map((req) => {
        const created = formatRelativeTime(req.createdAt);
        const typeLabel = req.fromCircle && req.toCircle ? `${req.fromCircle}→${req.toCircle}` : '—';
        const attemptLabel = formatAttemptLabel(req.attempts ?? req.requestNumber);
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${typeLabel}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${req.socialNetwork || '—'}</td>
          <td>${req.username || '—'}</td>
          <td>${attemptLabel}</td>
        </tr>`;
      })
      .join('');
  };

  const renderUserOrders = (orders = []) => {
    if (!userOrdersBody) return;
    if (!orders.length) {
      showEmptyTable(userOrdersBody, {
        title: 'Sin pedidos',
        message: 'Este usuario no tiene pedidos registrados.',
        colSpan: 4,
      });
      return;
    }
    userOrdersBody.innerHTML = orders
      .map((order) => {
        const created = formatRelativeTime(order.createdAt);
        const promo = order.promoCodeCode || '—';
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${orderStatusChip(order.status)}</td>
          <td>${formatCurrency(order.total)}</td>
          <td>${promo}</td>
        </tr>`;
      })
      .join('');
  };

  const renderUserCodes = (codes = []) => {
    if (!userCodesBody) return;
    if (!codes.length) {
      showEmptyTable(userCodesBody, {
        title: 'Sin códigos asociados',
        message: 'No hay códigos promocionales utilizados.',
        colSpan: 5,
      });
      return;
    }
    userCodesBody.innerHTML = codes
      .map((entry) => {
        const created = formatRelativeTime(entry.redeemedAt);
        const type = entry.promoCode?.type || '—';
        const value = entry.promoCode?.value != null ? entry.promoCode.value : '—';
        return `<tr>
          <td>${entry.promoCode?.code || '—'}</td>
          <td>${type}</td>
          <td>${value}</td>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${entry.orderId ?? '—'}</td>
        </tr>`;
      })
      .join('');
  };

  const getAdminLabel = (adminUser) => {
    if (!adminUser) return '—';
    return (
      adminUser.email ||
      adminUser.name ||
      [adminUser.firstName, adminUser.lastName].filter(Boolean).join(' ') ||
      '—'
    );
  };

  const renderUserHistory = (entries = []) => {
    if (!userHistoryBody) return;
    if (!entries.length) {
      showEmptyTable(userHistoryBody, {
        title: 'Sin historial disponible',
        message: 'No hay registros de historial para este usuario.',
        colSpan: 5,
      });
      return;
    }
    userHistoryBody.innerHTML = entries
      .map((entry) => {
        const created = formatRelativeTime(entry.createdAt);
        const detailParts = [];
        if (entry.fromCircle && entry.toCircle) {
          detailParts.push(`Círculo ${entry.fromCircle}→${entry.toCircle}`);
        }
        if (entry.targetType && entry.targetId) {
          detailParts.push(`${entry.targetType}:${entry.targetId}`);
        }
        const detail = detailParts.join(' · ') || '—';
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${entry.actionType || '—'}</td>
          <td>${getAdminLabel(entry.adminUser)}</td>
          <td>${detail}</td>
          <td>${entry.reason || '—'}</td>
        </tr>`;
      })
      .join('');
  };

  const renderNotesList = (state, container) => {
    if (!container) return;
    if (!state.items.length) {
      container.innerHTML = '<p class="note-empty">Sin notas internas.</p>';
      return;
    }
    container.innerHTML = state.items
      .map((note) => {
        const created = formatRelativeTime(note.createdAt);
        const authorLabel = escapeHtml(getAdminLabel(note.author));
        const isEditing = state.editingId === note.id;
        if (isEditing) {
          return `<div class="note-card" data-note-id="${note.id}">
            <div class="note-meta">
              <div class="note-author">${authorLabel}</div>
              <div class="time-sub" title="${created.full}">${created.label}</div>
            </div>
            <textarea class="textarea" data-note-edit="${note.id}">${escapeHtml(note.content)}</textarea>
            <div class="note-actions">
              <button type="button" class="btn primary note-button" data-note-action="save" data-note-id="${note.id}">Guardar</button>
              <button type="button" class="btn note-button" data-note-action="cancel" data-note-id="${note.id}">Cancelar</button>
            </div>
          </div>`;
        }
        return `<div class="note-card" data-note-id="${note.id}">
          <div class="note-meta">
            <div>
              <div class="note-author">${authorLabel}</div>
              <div class="time-sub" title="${created.full}">${created.label}</div>
            </div>
            <div class="note-actions">
              <button type="button" class="btn note-button" data-note-action="edit" data-note-id="${note.id}">Editar</button>
              <button type="button" class="btn danger note-button" data-note-action="delete" data-note-id="${note.id}">Eliminar</button>
            </div>
          </div>
          <div class="note-content">${escapeHtml(note.content)}</div>
        </div>`;
      })
      .join('');
  };

  const fetchNotesForTarget = async (targetType, targetId, state, container, messageEl) => {
    if (!targetType || !targetId) return;
    if (messageEl) messageEl.innerHTML = '';
    if (setUiLoading && container) {
      setUiLoading(container, true, { title: 'Cargando notas…' });
    }
    try {
      const notes = await window.CRONOX_API?.admin?.listAdminNotes?.({
        targetType,
        targetId: String(targetId),
      });
      state.items = Array.isArray(notes) ? notes : [];
      state.editingId = null;
      if (!state.items.length && renderEmptyState && container) {
        renderEmptyState(container, {
          title: 'Sin notas',
          message: 'Todavía no hay notas internas.',
        });
      } else {
        renderNotesList(state, container);
      }
    } catch (error) {
      console.error('[ADMIN] Error cargando notas', error);
      showModuleError({
        container: messageEl || statusArea,
        error,
        title: 'No se pudieron cargar las notas internas',
        isCritical: false,
        retry: () => fetchNotesForTarget(targetType, targetId, state, container, messageEl),
      });
      if (renderEmptyState && container) {
        renderEmptyState(container, {
          title: 'No disponible',
          message: 'No pudimos cargar las notas internas.',
          actions: [{ label: 'Reintentar', onClick: () => fetchNotesForTarget(targetType, targetId, state, container, messageEl) }],
        });
      }
    }
  };

  const fetchUserNotes = async (userId) => {
    userNotesState.targetType = 'user';
    userNotesState.targetId = userId;
    await fetchNotesForTarget('user', String(userId), userNotesState, userNotesList, userNotesMessage);
  };

  const openNotesModal = async ({ targetType, targetId, title }) => {
    if (!notesModal) return;
    if (!canAccess('notes')) {
      showToast('No autorizado.', 'error', 'Notas');
      return;
    }
    requestNotesState.targetType = targetType;
    requestNotesState.targetId = String(targetId);
    requestNotesState.editingId = null;
    if (notesModalTitle) {
      notesModalTitle.textContent = title || 'Notas internas';
    }
    if (notesModalTextarea) {
      notesModalTextarea.value = '';
    }
    toggleModal(notesModal, true);
    await fetchNotesForTarget(targetType, String(targetId), requestNotesState, notesModalList, notesModalMessage);
  };

  const createNoteForTarget = async (targetType, targetId, content, state, container, messageEl) => {
    if (!canAccess('notes')) {
      if (messageEl) setScopedMessage(messageEl, 'No autorizado.', 'error');
      showToast('No autorizado.', 'error', 'Notas');
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) {
      if (messageEl) setScopedMessage(messageEl, 'La nota no puede estar vacía.', 'error');
      return;
    }
    if (messageEl) setScopedMessage(messageEl, '');
    try {
      await window.CRONOX_API?.admin?.createAdminNote?.({
        targetType,
        targetId: String(targetId),
        content: trimmed,
      });
      await fetchNotesForTarget(targetType, String(targetId), state, container, messageEl);
      showToast('Nota interna guardada.', 'success', 'Notas');
    } catch (error) {
      console.error('[ADMIN] Error creando nota', error);
      if (messageEl) setScopedMessage(messageEl, 'No se pudo guardar la nota.', 'error');
      showToast('No se pudo guardar la nota.', 'error', 'Notas');
    }
  };

  const updateNoteContent = async (noteId, content, state, container, messageEl) => {
    if (!canAccess('notes')) {
      if (messageEl) setScopedMessage(messageEl, 'No autorizado.', 'error');
      showToast('No autorizado.', 'error', 'Notas');
      return;
    }
    const trimmed = content.trim();
    if (!trimmed) {
      if (messageEl) setScopedMessage(messageEl, 'La nota no puede estar vacía.', 'error');
      return;
    }
    if (messageEl) setScopedMessage(messageEl, '');
    try {
      await window.CRONOX_API?.admin?.updateAdminNote?.(noteId, { content: trimmed });
      await fetchNotesForTarget(state.targetType || 'user', state.targetId, state, container, messageEl);
      showToast('Nota interna actualizada.', 'success', 'Notas');
    } catch (error) {
      console.error('[ADMIN] Error actualizando nota', error);
      if (messageEl) setScopedMessage(messageEl, 'No se pudo actualizar la nota.', 'error');
      showToast('No se pudo actualizar la nota.', 'error', 'Notas');
    }
  };

  const deleteNote = async (noteId, state, container, messageEl) => {
    if (!noteId) return;
    if (!canAccess('notes')) {
      if (messageEl) setScopedMessage(messageEl, 'No autorizado.', 'error');
      showToast('No autorizado.', 'error', 'Notas');
      return;
    }
    if (!confirm('¿Eliminar esta nota interna?')) return;
    if (messageEl) setScopedMessage(messageEl, '');
    try {
      await window.CRONOX_API?.admin?.deleteAdminNote?.(noteId);
      await fetchNotesForTarget(state.targetType || 'user', state.targetId, state, container, messageEl);
      showToast('Nota interna eliminada.', 'success', 'Notas');
    } catch (error) {
      console.error('[ADMIN] Error eliminando nota', error);
      if (messageEl) setScopedMessage(messageEl, 'No se pudo eliminar la nota.', 'error');
      showToast('No se pudo eliminar la nota.', 'error', 'Notas');
    }
  };

  const handleNotesListClick = (event, state, container, messageEl) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.noteAction;
    const noteId = target.dataset.noteId;
    if (!action || !noteId) return;

    if (action === 'edit') {
      state.editingId = noteId;
      renderNotesList(state, container);
      return;
    }

    if (action === 'cancel') {
      state.editingId = null;
      renderNotesList(state, container);
      return;
    }

    if (action === 'save') {
      const textarea = container?.querySelector(`[data-note-edit="${noteId}"]`);
      if (textarea instanceof HTMLTextAreaElement) {
        updateNoteContent(noteId, textarea.value, state, container, messageEl);
      }
      return;
    }

    if (action === 'delete') {
      deleteNote(noteId, state, container, messageEl);
    }
  };

  const renderActivity = (items = [], options = { error: false }) => {
    if (!activityBody) return;
    if (options.error) {
      showEmptyTable(activityBody, {
        title: 'No se pudo cargar la actividad',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchActivity, variant: 'primary' }],
        colSpan: 5,
      });
      return;
    }
    if (!items.length) {
      showEmptyTable(activityBody, {
        title: 'Sin actividad reciente',
        message: 'No hay movimientos para mostrar.',
        colSpan: 5,
      });
      return;
    }
    activityBody.innerHTML = items
      .map((entry) => {
        const created = formatRelativeTime(entry.createdAt);
        const adminLabel = getAdminLabel(entry.adminUser);
        const targetLabel = entry.targetType && entry.targetId
          ? `${entry.targetType}:${entry.targetId}`
          : '—';
        const targetCell =
          entry.targetType === 'user' && entry.targetId
            ? `<a class="link-btn" href="admin-user.html?id=${encodeURIComponent(entry.targetId)}">${targetLabel}</a>`
            : targetLabel;
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${adminLabel}</td>
          <td>${entry.actionType || '—'}</td>
          <td class="activity-target">${targetCell}</td>
          <td>${entry.reason || '—'}</td>
        </tr>`;
      })
      .join('');
  };

  const fetchUserHistory = async (userId) => {
    if (!userId || !userHistoryBody) return;
    if (setUiLoading) setUiLoading(userHistoryBody, true, { title: 'Cargando historial…', colSpan: 5 });
    try {
      const data = await window.CRONOX_API?.admin?.getUserAuditLogs?.(userId);
      const items = Array.isArray(data) ? data : data?.items || [];
      renderUserHistory(items);
    } catch (error) {
      console.error('[ADMIN] Error cargando historial', error);
      showModuleError({
        container: userDetailMessage || statusArea,
        error,
        title: 'No se pudo cargar el historial',
        isCritical: false,
        retry: () => fetchUserHistory(userId),
        colSpan: 5,
      });
      showEmptyTable(userHistoryBody, {
        title: 'No se pudo cargar el historial',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: () => fetchUserHistory(userId), variant: 'primary' }],
        colSpan: 5,
      });
    }
  };

  const renderUserDetail = (payload) => {
    if (!payload) return;
    const user = payload.user || {};
    const stats = payload.stats || {};
    const displayName = user.username || user.email || `Usuario ${user.id || ''}`.trim();
    const email = user.email || '—';

    if (userName) userName.textContent = displayName;
    if (userEmail) userEmail.textContent = email;
    setUserAvatar(user.avatarUrl, displayName);

    if (userBadges) {
      const displayRole = normalizeRole(user.role);
      const badges = [
        `<span class="badge">Círculo ${user.circle ?? '—'}</span>`,
        displayRole ? `<span class="badge">${displayRole}</span>` : '',
      ].filter(Boolean);
      userBadges.innerHTML = badges.join('');
    }

    if (userOrdersCount) userOrdersCount.textContent = stats.ordersCount ?? 0;
    if (userTotalSpent) userTotalSpent.textContent = formatCurrency(stats.totalSpent ?? 0);
    if (userRequestsCount) userRequestsCount.textContent = stats.requestsCount ?? 0;

    const lastActivityDate = user.lastLoginAt || user.updatedAt || user.createdAt;
    const lastActivity = formatRelativeTime(lastActivityDate);
    if (userLastActivity) {
      userLastActivity.textContent = lastActivity.label;
      userLastActivity.title = lastActivity.full;
    }
    if (userLastActivityFull) {
      userLastActivityFull.textContent = lastActivity.full;
      userLastActivityFull.title = lastActivity.full;
    }

    renderUserRequests(payload.requests || []);
    if (canAccess('orders')) {
      renderUserOrders(payload.orders || []);
    }
    renderUserCodes(payload.codesUsed || []);
    if (canAccess('auditLog')) {
      fetchUserHistory(user.id);
    }
    if (canAccess('notes')) {
      fetchUserNotes(user.id);
    }
  };

  const setUserHash = (userId) => {
    const hash = `#user=${userId}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  };

  const clearUserHash = () => {
    if (window.location.hash.startsWith('#user=')) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const loadUserDetail = async (userId) => {
    if (!userId) return;
    if (!canAccess('userDetail')) {
      showSection('section-user');
      showModuleError({
        container: userDetailMessage || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.getUserDetail' },
        title: 'Sin permisos para el detalle de usuario',
        isCritical: true,
        backLink: 'admin.html#usuarios',
      });
      return;
    }
    if (userDetailMessage) userDetailMessage.innerHTML = '';
    if (userDetailSection) {
      showSection('section-user');
    }
    if (userName) userName.textContent = 'Cargando…';
    try {
      const data = await window.CRONOX_API?.admin?.getUserDetail?.(userId);
      userDetailState.data = data;
      if (!data || (!data.user && Object.keys(data || {}).length === 0)) {
        showModuleError({
          container: userDetailMessage || statusArea,
          error: { status: 404, message: 'Usuario no encontrado', endpoint: 'admin.getUserDetail' },
          title: 'Usuario no encontrado o sin datos',
          isCritical: true,
          backLink: 'admin.html#usuarios',
        });
        if (userRequestsBody) {
          showEmptyTable(userRequestsBody, {
            title: 'Usuario no encontrado o sin datos',
            message: 'Selecciona un usuario distinto desde la lista.',
            actions: [{ label: 'Volver a usuarios', href: 'admin.html#usuarios', variant: 'primary' }],
            colSpan: 6,
          });
        }
        return;
      }
      renderUserDetail(data);
    } catch (error) {
      console.error('[ADMIN] Error cargando usuario', error);
      showModuleError({
        container: userDetailMessage || statusArea,
        error,
        title: 'No se pudo cargar el detalle del usuario',
        isCritical: true,
        retry: () => loadUserDetail(userId),
        backLink: 'admin.html#usuarios',
      });
    }
  };

  const openUserDetail = (userId, options = {}) => {
    if (!userId) return;
    if (currentSectionId !== 'section-user') {
      lastSectionId = currentSectionId || 'section-dashboard';
    }
    userDetailState.userId = userId;
    setUserDetailTab(userDetailState.activeTab || 'requests');
    if (!options.skipHash) {
      setUserHash(userId);
    }
    loadUserDetail(userId);
  };

  const handleHashChange = () => {
    const match = window.location.hash.match(/user=(\d+)/);
    if (match) {
      const userId = Number(match[1]);
      if (Number.isFinite(userId)) {
        openUserDetail(userId, { skipHash: true });
        return;
      }
    }
    const sectionMatch = window.location.hash.match(/^#(section-[\w-]+)/);
    if (sectionMatch) {
      showSection(sectionMatch[1]);
      return;
    }
    if (currentSectionId === 'section-user') {
      showSection(lastSectionId || 'section-dashboard');
    }
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
      requestsBody23.innerHTML = '<tr><td colspan="7" class="empty">Cargando solicitudes…</td></tr>';
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

  const buildActivityQuery = (state) => {
    return {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q || undefined,
      actionType: state.actionType || undefined,
      targetType: state.targetType || undefined,
      dateFrom: state.dateFrom ? normalizeDateRange(state.dateFrom) : undefined,
      dateTo: state.dateTo ? normalizeDateRange(state.dateTo, true) : undefined,
    };
  };

  const buildUsersQuery = (state) => {
    return {
      page: state.page,
      pageSize: state.pageSize,
      q: state.q || undefined,
      email: state.email || undefined,
      phone: state.phone || undefined,
      role: state.role || undefined,
      circle: parseNumberOrNull(state.circle) ?? undefined,
      sort: state.sort || undefined,
      order: state.order || undefined,
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

  const syncActivityStateFromInputs = () => {
    if (activitySearch) activityState.q = activitySearch.value.trim();
    if (activityActionType) activityState.actionType = activityActionType.value;
    if (activityTargetType) activityState.targetType = activityTargetType.value;
    if (activityDateFrom) activityState.dateFrom = activityDateFrom.value;
    if (activityDateTo) activityState.dateTo = activityDateTo.value;
  };

  const syncUsersStateFromInputs = () => {
    if (usersSearch) usersState.q = usersSearch.value.trim();
    if (usersEmail) usersState.email = usersEmail.value.trim();
    if (usersPhone) usersState.phone = usersPhone.value.trim();
    if (usersRole) usersState.role = usersRole.value;
    if (usersCircle) usersState.circle = usersCircle.value;
    if (usersSort) usersState.sort = usersSort.value || 'createdAt';
    if (usersOrder) usersState.order = usersOrder.value || 'desc';
  };

  const applyUsersStateToInputs = () => {
    if (usersSearch) usersSearch.value = usersState.q || '';
    if (usersEmail) usersEmail.value = usersState.email || '';
    if (usersPhone) usersPhone.value = usersState.phone || '';
    if (usersRole) usersRole.value = usersState.role || '';
    if (usersCircle) usersCircle.value = usersState.circle || '';
    if (usersSort) usersSort.value = usersState.sort || 'createdAt';
    if (usersOrder) usersOrder.value = usersState.order || 'desc';
  };

  const readUsersStateFromQuery = () => {
    const params = new URLSearchParams(window.location.search);
    const page = Number(params.get('usersPage'));
    const pageSize = Number(params.get('usersPageSize'));
    usersState.page = Number.isFinite(page) && page > 0 ? page : usersState.page;
    usersState.pageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : usersState.pageSize;
    usersState.q = params.get('usersQ') ?? usersState.q;
    usersState.email = params.get('usersEmail') ?? usersState.email;
    usersState.phone = params.get('usersPhone') ?? usersState.phone;
    usersState.role = params.get('usersRole') ?? usersState.role;
    usersState.circle = params.get('usersCircle') ?? usersState.circle;
    usersState.sort = params.get('usersSort') ?? usersState.sort;
    usersState.order = params.get('usersOrder') ?? usersState.order;
  };

  const updateUsersQueryString = () => {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key, value) => {
      if (value === undefined || value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    };
    setOrDelete('usersPage', usersState.page);
    setOrDelete('usersPageSize', usersState.pageSize);
    setOrDelete('usersQ', usersState.q);
    setOrDelete('usersEmail', usersState.email);
    setOrDelete('usersPhone', usersState.phone);
    setOrDelete('usersRole', usersState.role);
    setOrDelete('usersCircle', usersState.circle);
    setOrDelete('usersSort', usersState.sort);
    setOrDelete('usersOrder', usersState.order);
    const newQuery = params.toString();
    const newUrl = newQuery ? `${window.location.pathname}?${newQuery}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, '', newUrl);
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

  const resetActivityFilters = () => {
    if (activitySearch) activitySearch.value = '';
    if (activityActionType) activityActionType.value = '';
    if (activityTargetType) activityTargetType.value = '';
    if (activityDateFrom) activityDateFrom.value = '';
    if (activityDateTo) activityDateTo.value = '';
    activityState.page = 1;
    syncActivityStateFromInputs();
    fetchActivity();
  };

  const resetUsersFilters = () => {
    if (usersSearch) usersSearch.value = '';
    if (usersEmail) usersEmail.value = '';
    if (usersPhone) usersPhone.value = '';
    if (usersRole) usersRole.value = '';
    if (usersCircle) usersCircle.value = '';
    if (usersSort) usersSort.value = 'createdAt';
    if (usersOrder) usersOrder.value = 'desc';
    usersState.page = 1;
    syncUsersStateFromInputs();
    fetchUsers();
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
      showEmptyTable(requestsBody, {
        title: 'No se pudieron cargar las solicitudes',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchRequests, variant: 'primary' }],
        colSpan: 9,
      });
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      showEmptyTable(requestsBody, {
        title: 'No hay resultados con estos filtros',
        message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
        actions: [{ label: 'Limpiar filtros', onClick: resetRequestsFilters, variant: 'primary' }],
        colSpan: 9,
      });
      return;
    }

    const canApprove = canAccess('requests');
    const canUseNotes = canAccess('notes');
    requestsBody.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const userLabel = userName || '—';
        const userCell = req.userId
          ? `<a class="link-btn" href="admin-user.html?id=${encodeURIComponent(req.userId)}">${userLabel}</a>`
          : userLabel;
        const created = formatRelativeTime(req.createdAt);
        const normalizedStatus = String(req.status || '').toUpperCase();
        const isActionable = normalizedStatus === 'PENDING' || normalizedStatus === 'EXPIRED';
        const actions = isActionable
          ? `<div class="actions">
              <button class="btn primary" data-action="approve" data-id="${req.id}" ${canApprove ? '' : 'disabled title="No autorizado"'}>APROBAR</button>
              <button class="btn danger" data-action="deny" data-id="${req.id}" ${canApprove ? '' : 'disabled title="No autorizado"'}>RECHAZAR</button>
            </div>`
          : '<span style="color:#7b7f8f;">—</span>';
        const attemptLabel = formatAttemptLabel(req.attempts ?? req.requestNumber);
        const noteTitle = escapeHtml(
          `Solicitud 3→4 · ${req.username || userLabel || req.userId || req.id}`,
        );
        const noteButton = canUseNotes
          ? `<button type="button" class="note-icon-btn" data-note-target-type="circleRequest" data-note-target-id="${req.id}" data-note-title="${noteTitle}">📝</button>`
          : '<span style="color:#7b7f8f;">—</span>';

        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${userCell}</td>
          <td>${req.userId}</td>
          <td>${req.socialNetwork}</td>
          <td>${req.username}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${actions}</td>
          <td>${noteButton}</td>
        </tr>`;
      })
      .join('');
  };

  const renderRequests23 = (items, options = { error: false }) => {
    if (!requestsBody23) return;
    if (options.error) {
      showEmptyTable(requestsBody23, {
        title: 'No se pudieron cargar las solicitudes 2→3',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchRequests23, variant: 'primary' }],
        colSpan: 7,
      });
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      showEmptyTable(requestsBody23, {
        title: 'No hay resultados con estos filtros',
        message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
        actions: [{ label: 'Limpiar filtros', onClick: resetRequests23Filters, variant: 'primary' }],
        colSpan: 7,
      });
      return;
    }

    const canUseNotes = canAccess('notes');
    requestsBody23.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const userLabel = userName || '—';
        const userCell = req.userId
          ? `<a class="link-btn" href="admin-user.html?id=${encodeURIComponent(req.userId)}">${userLabel}</a>`
          : userLabel;
        const created = formatRelativeTime(req.createdAt);
        const remaining = typeof req.remainingMs === 'number' ? formatDuration(req.remainingMs) : '—';
        const attemptLabel = formatAttemptLabel(req.attempts ?? req.requestNumber);
        const noteTitle = escapeHtml(
          `Solicitud 2→3 · ${req.user?.email || req.userId || req.id}`,
        );
        const noteButton = canUseNotes
          ? `<button type="button" class="note-icon-btn" data-note-target-type="circleRequest" data-note-target-id="${req.id}" data-note-title="${noteTitle}">📝</button>`
          : '<span style="color:#7b7f8f;">—</span>';
        return `<tr>
          <td>
            <div class="time-label" title="${created.full}">${created.label}</div>
            <div class="time-sub">${created.full}</div>
          </td>
          <td>${userCell}</td>
          <td>${req.userId}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${remaining}</td>
          <td>${noteButton}</td>
        </tr>`;
      })
      .join('');
  };

  const fetchRequests = async () => {
    if (!canAccess('requests')) {
      showModuleError({
        container: messageBox || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.listCircleUpgradeRequests' },
        title: 'Sin permisos',
        isCritical: true,
        backLink: 'admin.html#usuarios',
      });
      return;
    }
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
      showModuleError({
        container: messageBox || statusArea,
        error,
        title: 'No se pudieron cargar las solicitudes',
        isCritical: true,
        retry: fetchRequests,
      });
      renderRequests([], { error: true });
    }
  };

  const fetchRequests23 = async () => {
    if (!canAccess('requests')) {
      showModuleError({
        container: messageBox23 || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.listAutoCircleRequests' },
        title: 'Sin permisos',
        isCritical: true,
      });
      return;
    }
    setLoading23(true);
    if (messageBox23) messageBox23.innerHTML = '';
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
      showModuleError({
        container: messageBox23 || statusArea,
        error,
        title: 'No se pudieron cargar las solicitudes 2→3',
        isCritical: true,
        retry: fetchRequests23,
      });
      renderRequests23([], { error: true });
    }
  };

  const setDashboardValue = (el, value) => {
    if (!el) return;
    el.textContent = value ?? '—';
  };

  const extractPendingCounts = (data) => {
    const requests = data?.requests || {};
    const byType = requests.pendingByType || requests.byType || {};
    const entries = Object.entries(byType || {});
    const findCount = (pattern) => {
      const match = entries.find(([key]) => pattern.test(String(key).toLowerCase()));
      if (!match) return 0;
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : 0;
    };
    const pending23 = Number(requests.pending23) || findCount(/2.*3/);
    const pending34 = Number(requests.pending34) || findCount(/3.*4/);
    return { pending23, pending34 };
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
    updateRequestBadges(extractPendingCounts(data));
  };

  const fetchDashboard = async () => {
    if (dashboardMessage) dashboardMessage.innerHTML = '';
    if (setUiLoading && dashboardMessage) {
      setUiLoading(dashboardMessage, true, { title: 'Cargando resumen…' });
    }
    if (totalUsers) totalUsers.textContent = '…';
    try {
      const data = await window.CRONOX_API?.admin?.getDashboard?.();
      if (!data && renderEmptyState && dashboardMessage) {
        renderEmptyState(dashboardMessage, {
          title: 'Sin datos en el resumen',
          message: 'No hay información disponible todavía.',
          actions: [{ label: 'Recargar', onClick: fetchDashboard, variant: 'primary' }],
        });
      }
      renderDashboard(data);
    } catch (error) {
      console.error('No se pudo cargar el dashboard', error);
      showModuleError({
        container: dashboardMessage || statusArea,
        error,
        title: 'No se pudieron cargar los datos del resumen',
        isCritical: true,
        retry: fetchDashboard,
      });
    }
  };

  const refreshPendingCounts = async () => {
    try {
      const data = await window.CRONOX_API?.admin?.getDashboard?.();
      updateRequestBadges(extractPendingCounts(data));
    } catch (error) {
      console.warn('[ADMIN] No se pudieron actualizar los badges de solicitudes', error);
    }
  };

  const fetchActivity = async () => {
    if (!activityBody) return;
    if (!canAccess('auditLog')) {
      showModuleError({
        container: activityMessage || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.getAuditLogs' },
        title: 'Sin permisos para auditoría',
        isCritical: false,
      });
      showEmptyTable(activityBody, {
        title: 'No autorizado',
        message: 'No tienes permisos para ver la actividad.',
        colSpan: 5,
      });
      return;
    }
    if (setUiLoading) setUiLoading(activityBody, true, { title: 'Cargando actividad…', colSpan: 5 });
    if (activityMessage) activityMessage.innerHTML = '';
    try {
      const data = await window.CRONOX_API?.admin?.getAuditLogs(
        buildActivityQuery(activityState),
      );
      const meta = normalizePaginated(data, activityState);
      activityState.page = meta.page;
      activityState.pageSize = meta.pageSize;
      if (!meta.items || !meta.items.length) {
        showEmptyTable(activityBody, {
          title: 'Sin actividad registrada',
          message: 'No hay movimientos con estos filtros.',
          actions: [{ label: 'Limpiar filtros', onClick: resetActivityFilters, variant: 'primary' }],
          colSpan: 5,
        });
      } else {
        renderActivity(meta.items || []);
      }
      updatePagination(meta, activityState, {
        info: activityPageInfo,
        prev: activityPrev,
        next: activityNext,
        size: activityPageSize,
      });
    } catch (error) {
      console.error('[ADMIN] Error cargando actividad', error);
      showModuleError({
        container: activityMessage || statusArea,
        error,
        title: 'No se pudo cargar la actividad',
        isCritical: false,
        retry: fetchActivity,
      });
      showEmptyTable(activityBody, {
        title: 'No se pudo cargar la actividad',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchActivity, variant: 'primary' }],
        colSpan: 5,
      });
      renderActivity([], { error: true });
    }
  };

  const normalizeUsersResponse = (payload) => {
    const payloadData = payload?.data;
    const dataContainer =
      payloadData && typeof payloadData === 'object' && !Array.isArray(payloadData)
        ? payloadData
        : null;
    const items = Array.isArray(payloadData)
      ? payloadData
      : Array.isArray(dataContainer?.data)
        ? dataContainer.data
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.users)
            ? payload.users
            : Array.isArray(payload)
              ? payload
              : [];
    const metaSource = payload?.meta ?? dataContainer?.meta ?? payloadData?.meta ?? payload?.data?.meta ?? {};
    const total = Number(metaSource.total ?? metaSource.count ?? payload?.total ?? items.length);
    const page = Number(metaSource.page ?? payload?.page ?? usersState.page);
    const pageSize = Number(
      metaSource.pageSize ?? metaSource.limit ?? payload?.pageSize ?? payload?.limit ?? usersState.pageSize,
    );
    const safePage = Number.isFinite(page) && page > 0 ? page : usersState.page;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : usersState.pageSize;
    const safeTotal = Number.isFinite(total) ? total : items.length;
    const totalPages = Math.max(1, Math.ceil((safeTotal || 0) / (safePageSize || 1)));
    return {
      items,
      meta: {
        page: safePage,
        pageSize: safePageSize,
        total: safeTotal,
        totalPages,
      },
    };
  };

  const mapUserRecord = (item = {}) => {
    const source = item && typeof item === 'object' ? item : {};
    const id = source.id ?? source.userId ?? source._id ?? source.uid ?? '';
    const email = source.email ?? source.mail ?? source.username ?? '';
    const phone = source.phone ?? source.phoneNumber ?? source.mobile ?? source.telefono ?? '';
    const firstName = source.firstName ?? source.first_name ?? '';
    const lastName = source.lastName ?? source.last_name ?? '';
    const displayName =
      [firstName, lastName].filter(Boolean).join(' ') || source.name || source.fullName || '';
    return {
      id,
      email,
      phone,
      displayName,
      role: source.role ?? source.userRole ?? source.type ?? '',
      circle:
        source.circle ?? source.circleLevel ?? source.userCircle ?? source.level ?? source.membershipCircle ?? '',
      createdAt: source.createdAt ?? source.created_at ?? source.created ?? source.createdOn ?? '',
    };
  };

  const updateUsersPagination = () => {
    if (!usersPageInfo) return;
    const totalPages = Math.max(1, Number(usersState.totalPages) || 1);
    const currentPage = Math.min(Math.max(usersState.page, 1), totalPages);
    const totalLabel = Number.isFinite(usersState.total) ? usersState.total : 0;
    usersPageInfo.textContent = `Página ${currentPage} de ${totalPages} · Total: ${totalLabel}`;
    if (usersPrev) usersPrev.disabled = currentPage <= 1;
    if (usersNext) usersNext.disabled = currentPage >= totalPages;
  };

  const getUsersColumnCount = () => (usersPhoneHeader && !usersPhoneHeader.hidden ? 8 : 7);

  const renderUsers = (items = []) => {
    if (!usersBody) return;
    const hasPhone = items.some((item) => {
      const user = mapUserRecord(item);
      return Boolean(user.phone);
    });
    if (usersPhoneHeader) {
      usersPhoneHeader.hidden = !hasPhone;
    }
    const columnCount = hasPhone ? 8 : 7;
    if (!items.length) {
      usersBody.innerHTML = `<tr><td colspan="${columnCount}" class="empty">No hay usuarios para mostrar.</td></tr>`;
      return;
    }
    usersBody.innerHTML = items
      .map((item) => {
        const user = mapUserRecord(item);
        const idLabel = user.id != null && user.id !== '' ? escapeHtml(String(user.id)) : '—';
        const emailLabel = user.email ? escapeHtml(user.email) : '—';
        const phoneLabel = user.phone ? escapeHtml(user.phone) : '—';
        const nameLabel = user.displayName ? escapeHtml(user.displayName) : '—';
        const roleLabel = user.role ? escapeHtml(String(user.role)) : '—';
        const circleLabel =
          user.circle != null && user.circle !== '' ? escapeHtml(String(user.circle)) : '—';
        const createdLabel = user.createdAt ? formatDateShort(user.createdAt) : '—';
        const actionLabel =
          user.id != null && user.id !== ''
            ? `<a class="btn" href="admin-user.html?id=${encodeURIComponent(user.id)}">Ver</a>`
            : '<button class="btn" type="button" disabled>Ver</button>';
        return `
          <tr>
            <td>${idLabel}</td>
            <td>${emailLabel}</td>
            ${hasPhone ? `<td>${phoneLabel}</td>` : ''}
            <td>${nameLabel}</td>
            <td>${roleLabel}</td>
            <td>${circleLabel}</td>
            <td>${createdLabel}</td>
            <td>${actionLabel}</td>
          </tr>
        `;
      })
      .join('');
  };

  const fetchUsers = async () => {
    if (!usersBody) return;
    if (!canAccess('users')) {
      showModuleError({
        container: usersMessage || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.listUsers' },
        title: 'Sin permisos para usuarios',
        isCritical: true,
        backLink: 'admin.html#usuarios',
      });
      showEmptyTable(usersBody, {
        title: 'No autorizado',
        message: 'No tienes permisos para ver usuarios.',
        colSpan: getUsersColumnCount(),
      });
      updateUsersPagination();
      return;
    }
    if (setUiLoading) setUiLoading(usersBody, true, { title: 'Cargando usuarios…', colSpan: getUsersColumnCount() });
    if (usersMessage) usersMessage.innerHTML = '';
    try {
      const listFn = window.CRONOX_API?.admin?.getUserList ?? window.CRONOX_API?.admin?.listUsers;
      if (!listFn) {
        showApiUnavailable('No se encontró el endpoint de usuarios.');
        throw new Error('API no disponible');
      }
      const data = await listFn(buildUsersQuery(usersState));
      const normalized = normalizeUsersResponse(data);
      usersState.page = normalized.meta.page;
      usersState.pageSize = normalized.meta.pageSize;
      usersState.total = normalized.meta.total;
      usersState.totalPages = normalized.meta.totalPages;
      if (!normalized.items || !normalized.items.length) {
        showEmptyTable(usersBody, {
          title: 'No hay resultados con estos filtros',
          message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
          actions: [{ label: 'Limpiar filtros', onClick: resetUsersFilters, variant: 'primary' }],
          colSpan: getUsersColumnCount(),
        });
      } else {
        renderUsers(normalized.items || []);
      }
      updateUsersQueryString();
      updateUsersPagination();
    } catch (error) {
      console.error('[ADMIN] Error cargando usuarios', error);
      showModuleError({
        container: usersMessage || statusArea,
        error,
        title: 'No se pudieron cargar los usuarios',
        isCritical: true,
        retry: fetchUsers,
        backLink: 'admin.html#usuarios',
      });
      showEmptyTable(usersBody, {
        title: 'No se pudieron cargar los usuarios',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchUsers, variant: 'primary' }],
        colSpan: getUsersColumnCount(),
      });
      updateUsersPagination();
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
    if (!canAccess('products')) {
      showModuleError({
        container: productsMessage || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.listAdminProducts' },
        title: 'Sin permisos para productos',
        isCritical: false,
      });
      showEmptyTable(productsBody, {
        title: 'No autorizado',
        message: 'No tienes permisos para ver productos.',
        colSpan: 7,
      });
      return;
    }
    if (setUiLoading) setUiLoading(productsBody, true, { title: 'Cargando productos…', colSpan: 7 });
    if (productsMessage) productsMessage.innerHTML = '';
    try {
      const data = await window.CRONOX_API?.admin?.listAdminProducts(
        buildProductQuery(productsState),
      );
      const meta = normalizePaginated(data, productsState);
      productsState.page = meta.page;
      productsState.pageSize = meta.pageSize;
      if (!meta.items || !meta.items.length) {
        showEmptyTable(productsBody, {
          title: 'No hay resultados con estos filtros',
          message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
          actions: [{ label: 'Limpiar filtros', onClick: resetProductsFilters, variant: 'primary' }],
          colSpan: 7,
        });
      } else {
        renderProducts(meta.items || []);
      }
      updatePagination(meta, productsState, {
        info: productsPageInfo,
        prev: productsPrev,
        next: productsNext,
        size: productsPageSize,
      });
    } catch (error) {
      console.error('[ADMIN] Error cargando productos', error);
      showModuleError({
        container: productsMessage || statusArea,
        error,
        title: 'No se pudieron cargar los productos',
        isCritical: false,
        retry: fetchProducts,
      });
      showEmptyTable(productsBody, {
        title: 'No se pudieron cargar los productos',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchProducts, variant: 'primary' }],
        colSpan: 7,
      });
    }
  };

  const renderProducts = (items = []) => {
    if (!productsBody) return;
    if (!items.length) {
      showEmptyTable(productsBody, {
        title: 'No hay resultados con estos filtros',
        message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
        actions: [{ label: 'Limpiar filtros', onClick: resetProductsFilters, variant: 'primary' }],
        colSpan: 7,
      });
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

  const onUsersTableClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.retryUsers) {
      fetchUsers();
      return;
    }
    if (target.dataset.usersLogin) {
      redirectToLogin();
    }
  };

  const resetCodeForm = () => {
    editingCodeId = null;
    codeForm?.reset();
    if (codeModalTitle) codeModalTitle.textContent = 'Crear código';
  };

  const resetCodesFilters = () => {
    if (codeSearch) codeSearch.value = '';
    if (codeStatusFilter) codeStatusFilter.value = '';
    codesState.page = 1;
    codesState.search = '';
    codesState.isActive = '';
    fetchCodes();
  };

  const fetchCodes = async () => {
    if (!codesBody) return;
    if (!canAccess('promoCodes')) {
      showModuleError({
        container: codesMessage || statusArea,
        error: { status: 403, message: 'No autorizado', endpoint: 'admin.listPromoCodes' },
        title: 'Sin permisos para códigos',
        isCritical: false,
      });
      showEmptyTable(codesBody, {
        title: 'No autorizado',
        message: 'No tienes permisos para ver códigos promocionales.',
        colSpan: 6,
      });
      return;
    }
    if (setUiLoading) setUiLoading(codesBody, true, { title: 'Cargando códigos…', colSpan: 6 });
    if (codesMessage) codesMessage.innerHTML = '';
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
      if (!items.length) {
        showEmptyTable(codesBody, {
          title: 'No hay resultados con estos filtros',
          message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
          actions: [{ label: 'Limpiar filtros', onClick: resetCodesFilters, variant: 'primary' }],
          colSpan: 6,
        });
      } else {
        renderCodes(items);
      }
    } catch (error) {
      console.error('[ADMIN] Error cargando códigos', error);
      showModuleError({
        container: codesMessage || statusArea,
        error,
        title: 'No se pudieron cargar los códigos',
        isCritical: false,
        retry: fetchCodes,
      });
      showEmptyTable(codesBody, {
        title: 'No se pudieron cargar los códigos',
        message: 'Intenta nuevamente en unos segundos.',
        actions: [{ label: 'Reintentar', onClick: fetchCodes, variant: 'primary' }],
        colSpan: 6,
      });
    }
  };

  const renderCodes = (items = []) => {
    if (!codesBody) return;
    if (!items.length) {
      showEmptyTable(codesBody, {
        title: 'No hay resultados con estos filtros',
        message: 'Prueba limpiando los filtros o ajustando la búsqueda.',
        actions: [{ label: 'Limpiar filtros', onClick: resetCodesFilters, variant: 'primary' }],
        colSpan: 6,
      });
      return;
    }

    codesBody.innerHTML = items
      .map((code) => {
        const typeLabel = code.type === 'PERCENT' ? `${code.value}%` : formatMoney(code.value);
        const usageLabel =
          code.usageLimit != null ? `${code.usageCount || 0} / ${code.usageLimit}` : `${code.usageCount || 0}`;
        const activeLabel = promoStatusChip(Boolean(code.isActive));
        const dateLabel = (value) => {
          if (!value) return '—';
          const relative = formatRelativeTime(value);
          return `<span title="${relative.full}">${relative.label}</span>`;
        };
        return `
          <tr>
            <td>
              <div style="font-weight:600;">${code.code}</div>
              <div style="margin-top:6px;">${activeLabel}</div>
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
        showToast('Código actualizado correctamente.', 'success', 'Códigos');
      } else {
        await window.CRONOX_API?.admin?.createPromoCode(payload);
        setScopedMessage(codesMessage, 'Código creado correctamente.', 'success');
        showToast('Código creado correctamente.', 'success', 'Códigos');
      }
      toggleModal(codeModal, false);
      fetchCodes();
    } catch (error) {
      console.error('[ADMIN] Error guardando código', error);
      setScopedMessage(codesMessage, error?.message || 'No se pudo guardar el código.', 'error');
      showToast(error?.message || 'No se pudo guardar el código.', 'error', 'Códigos');
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
    if (!canAccess('requests')) {
      setMessage('No autorizado.', 'error');
      showToast('No autorizado.', 'error', 'Solicitud');
      return;
    }
    const button = document.querySelector(`button[data-id="${id}"][data-action="${action}"]`);
    if (button) button.disabled = true;
    try {
      if (action === 'approve') {
        await window.CRONOX_API?.admin?.approveCircleUpgrade(id, {});
        setMessage('Solicitud aprobada correctamente.', 'success');
        showToast('Solicitud aprobada correctamente.', 'success', 'Solicitud');
      } else {
        await window.CRONOX_API?.admin?.denyCircleUpgrade(id, {});
        setMessage('Solicitud denegada.', 'success');
        showToast('Solicitud rechazada correctamente.', 'success', 'Solicitud');
      }
      await fetchRequests();
    } catch (error) {
      console.error('[ADMIN] Acción fallida', error);
      setMessage(error?.message || 'No se pudo completar la acción.', 'error');
      showToast(error?.message || 'No se pudo completar la acción.', 'error', 'Solicitud');
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

    if (activityFiltersReset) {
      activityFiltersReset.addEventListener('click', resetActivityFilters);
    }

    if (activitySearch) {
      activitySearch.addEventListener('input', () => {
        clearTimeout(activitySearchTimeout);
        activitySearchTimeout = setTimeout(() => {
          syncActivityStateFromInputs();
          activityState.page = 1;
          fetchActivity();
        }, 250);
      });
    }

    if (activityActionType) {
      activityActionType.addEventListener('change', () => {
        syncActivityStateFromInputs();
        activityState.page = 1;
        fetchActivity();
      });
    }

    if (activityTargetType) {
      activityTargetType.addEventListener('change', () => {
        syncActivityStateFromInputs();
        activityState.page = 1;
        fetchActivity();
      });
    }

    if (activityDateFrom) {
      activityDateFrom.addEventListener('change', () => {
        syncActivityStateFromInputs();
        activityState.page = 1;
        fetchActivity();
      });
    }

    if (activityDateTo) {
      activityDateTo.addEventListener('change', () => {
        syncActivityStateFromInputs();
        activityState.page = 1;
        fetchActivity();
      });
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

    if (activityPrev) {
      activityPrev.addEventListener('click', () => {
        if (activityState.page > 1) {
          activityState.page -= 1;
          fetchActivity();
        }
      });
    }

    if (activityNext) {
      activityNext.addEventListener('click', () => {
        activityState.page += 1;
        fetchActivity();
      });
    }

    if (activityPageSize) {
      activityPageSize.addEventListener('change', () => {
        activityState.pageSize = Number(activityPageSize.value || 10);
        activityState.page = 1;
        fetchActivity();
      });
    }

    if (usersSearch) {
      const triggerSearch = () => {
        syncUsersStateFromInputs();
        usersState.page = 1;
        fetchUsers();
      };
      usersSearch.addEventListener('input', () => {
        clearTimeout(usersSearchTimeout);
        usersSearchTimeout = setTimeout(triggerSearch, 300);
      });
      usersSearch.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          clearTimeout(usersSearchTimeout);
          triggerSearch();
        }
      });
    }

    if (usersEmail) {
      usersEmail.addEventListener('input', () => {
        clearTimeout(usersSearchTimeout);
        usersSearchTimeout = setTimeout(() => {
          syncUsersStateFromInputs();
          usersState.page = 1;
          fetchUsers();
        }, 300);
      });
    }

    if (usersPhone) {
      usersPhone.addEventListener('input', () => {
        clearTimeout(usersSearchTimeout);
        usersSearchTimeout = setTimeout(() => {
          syncUsersStateFromInputs();
          usersState.page = 1;
          fetchUsers();
        }, 300);
      });
    }

    if (usersRole) {
      usersRole.addEventListener('change', () => {
        syncUsersStateFromInputs();
        usersState.page = 1;
        fetchUsers();
      });
    }

    if (usersCircle) {
      usersCircle.addEventListener('change', () => {
        syncUsersStateFromInputs();
        usersState.page = 1;
        fetchUsers();
      });
    }

    if (usersSort) {
      usersSort.addEventListener('change', () => {
        syncUsersStateFromInputs();
        usersState.page = 1;
        fetchUsers();
      });
    }

    if (usersOrder) {
      usersOrder.addEventListener('change', () => {
        syncUsersStateFromInputs();
        usersState.page = 1;
        fetchUsers();
      });
    }

    if (usersFiltersReset) {
      usersFiltersReset.addEventListener('click', resetUsersFilters);
    }

    if (usersPrev) {
      usersPrev.addEventListener('click', () => {
        if (usersState.page > 1) {
          usersState.page -= 1;
          fetchUsers();
        }
      });
    }

    if (usersNext) {
      usersNext.addEventListener('click', () => {
        usersState.page += 1;
        fetchUsers();
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

    if (usersBody) {
      usersBody.addEventListener('click', onUsersTableClick);
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

    if (userNoteSubmit) {
      userNoteSubmit.addEventListener('click', () => {
        if (!userDetailState.userId || !userNoteInput) return;
        const content = userNoteInput.value || '';
        createNoteForTarget('user', String(userDetailState.userId), content, userNotesState, userNotesList, userNotesMessage)
          .then(() => {
            if (userNoteInput) userNoteInput.value = '';
          });
      });
    }

    if (userNotesList) {
      userNotesList.addEventListener('click', (event) => {
        handleNotesListClick(event, userNotesState, userNotesList, userNotesMessage);
      });
    }

    if (notesModalSubmit) {
      notesModalSubmit.addEventListener('click', () => {
        if (!requestNotesState.targetType || !requestNotesState.targetId || !notesModalTextarea) return;
        const content = notesModalTextarea.value || '';
        createNoteForTarget(
          requestNotesState.targetType,
          requestNotesState.targetId,
          content,
          requestNotesState,
          notesModalList,
          notesModalMessage,
        ).then(() => {
          if (notesModalTextarea) notesModalTextarea.value = '';
        });
      });
    }

    if (notesModalList) {
      notesModalList.addEventListener('click', (event) => {
        handleNotesListClick(event, requestNotesState, notesModalList, notesModalMessage);
      });
    }

    if (notesModalClose) {
      notesModalClose.addEventListener('click', () => toggleModal(notesModal, false));
    }

    if (requestsBody) {
      requestsBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const noteTarget = target.closest('[data-note-target-id]');
        if (noteTarget instanceof HTMLElement) {
          const noteType = noteTarget.dataset.noteTargetType;
          const noteId = noteTarget.dataset.noteTargetId;
          const noteTitle = noteTarget.dataset.noteTitle;
          if (noteType && noteId) {
            openNotesModal({ targetType: noteType, targetId: noteId, title: noteTitle });
            return;
          }
        }
        const userTarget = target.closest('[data-user-id]');
        if (userTarget instanceof HTMLElement) {
          const userId = Number(userTarget.dataset.userId);
          if (Number.isFinite(userId)) {
            openUserDetail(userId);
            return;
          }
        }
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
        const noteTarget = target.closest('[data-note-target-id]');
        if (noteTarget instanceof HTMLElement) {
          const noteType = noteTarget.dataset.noteTargetType;
          const noteId = noteTarget.dataset.noteTargetId;
          const noteTitle = noteTarget.dataset.noteTitle;
          if (noteType && noteId) {
            openNotesModal({ targetType: noteType, targetId: noteId, title: noteTitle });
            return;
          }
        }
        const userTarget = target.closest('[data-user-id]');
        if (userTarget instanceof HTMLElement) {
          const userId = Number(userTarget.dataset.userId);
          if (Number.isFinite(userId)) {
            openUserDetail(userId);
            return;
          }
        }
        if (target.dataset.retry23) {
          fetchRequests23();
        }
      });
    }

    if (activityBody) {
      activityBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const userTarget = target.closest('[data-user-id]');
        if (userTarget instanceof HTMLElement) {
          const userId = Number(userTarget.dataset.userId);
          if (Number.isFinite(userId)) {
            openUserDetail(userId);
            return;
          }
        }
        if (target.dataset.retryActivity) {
          fetchActivity();
        }
      });
    }

    if (tabs?.length) {
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const targetSection = tab.dataset.section;
          const allowed = showSection(targetSection || currentSectionId);
          if (!allowed) {
            currentSectionId = targetSection || currentSectionId;
            return;
          }
          if (targetSection === 'section-dashboard') {
            fetchDashboard();
          } else if (targetSection === 'section-34') {
            syncRequestsStateFromInputs();
            fetchRequests();
            markRequestsSeen();
          } else if (targetSection === 'section-23') {
            syncRequests23StateFromInputs();
            fetchRequests23();
            markRequestsSeen();
          } else if (targetSection === 'section-activity') {
            syncActivityStateFromInputs();
            fetchActivity();
          } else if (targetSection === 'section-users') {
            syncUsersStateFromInputs();
            fetchUsers();
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

    if (userDetailTabs?.length) {
      userDetailTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const tabId = tab.dataset.userTab;
          if (!tabId) return;
          setUserDetailTab(tabId);
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

    userDetailBackBtn?.addEventListener('click', () => {
      clearUserHash();
      showSection(lastSectionId || 'section-dashboard');
    });

    refreshDashboardBtn?.addEventListener('click', fetchDashboard);
  };

  const init = async () => {
    const user = await ensureAdmin();
    if (!user) return;
    setScopedMessage(apiUnavailable, '');
    applyRoleVisibility();
    bindEvents();
    syncRequestsStateFromInputs();
    syncRequests23StateFromInputs();
    syncProductsStateFromInputs();
    syncActivityStateFromInputs();
    readUsersStateFromQuery();
    applyUsersStateToInputs();
    syncUsersStateFromInputs();
    fetchDashboard();
    refreshPendingCounts();
    window.setInterval(refreshPendingCounts, 60000);
    handleHashChange();
  };

  window.addEventListener('hashchange', handleHashChange);
  document.addEventListener('DOMContentLoaded', init);
})();
