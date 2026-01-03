(function () {
  const api = window.CRONOX_API || {};
  const $ = (id) => document.getElementById(id);

  const messageEl = $('profileMessage');
  const ordersBody = $('ordersBody');
  const ordersEmpty = $('ordersEmpty');
  const favoritesGrid = $('profileFavoritesGrid');
  const favoritesLoading = $('profileFavoritesLoading');
  const favoritesEmpty = $('profileFavoritesEmpty');
  const favoritesList = $('profileFavoritesList');
  const accreditationSection = document.querySelector('[data-profile-section="accreditation"]');
  const accreditationName = document.querySelector('.accreditation-name');
  const accreditationCode = document.querySelector('.accreditation-id');
  const accreditationCircle = document.querySelector('.accreditation-circle');
  const accreditationSymbol = document.querySelector('[data-accreditation-rings]');
  const accreditationQr = $('cronox-member-qr');
  const accreditationBook = accreditationSection?.querySelector('.crx-accreditation-book');
  const accreditationStatCircle = document.querySelector('[data-acc-stat="circle"]');
  const accreditationStatCreatedAt = document.querySelector('[data-acc-stat="createdAt"]');
  const accreditationStatOrders = document.querySelector('[data-acc-stat="orders"]');
  const accreditationStatItems = document.querySelector('[data-acc-stat="items"]');
  const getCircleUpgradeCta = () => document.querySelector('[data-circle4-cta]');
  const getCircleUpgradeBtn = () => document.querySelector('[data-circle4-request-btn]');
  const getCircleUpgradeStatusEl = () => document.querySelector('[data-circle4-status]');
  const getCircleUpgradeCooldownEl = () => document.querySelector('[data-circle4-cooldown]');

  let favoritesLoaded = false;
  let accreditationQrLoaded = false;
  let accreditationStatsLoaded = false;
  let globalLoader = null;

  // Modal state (only open after successful request)
  let isCircleRequestModalOpen = false;
  let isCircleUpgradeModalOpen = false;
  let isCircleUpgradeSuccessModalOpen = false;
  let circleUpgradeJustSubmitted = false;
  let circleUpgradeStatusLoaded = false;
  let circleUpgradeStatus = null;
  let lastCircleUpgradeRequestId = null;

  const RING_COLORS = {
    1: ['#000000'],
    2: ['#000000', '#000000'],
    3: ['#000000', '#000000', '#7C7C7C'],
    4: ['#000000', '#000000', '#7C7C7C', '#EDE7DB'],
    5: ['#000000', '#000000', '#7C7C7C', '#EDE7DB', '#B1001A'],
  };
  const ROMAN_TO_NUMBER = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
  };
  const IS_DEV_ENV =
    (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development') ||
    (typeof window !== 'undefined' && window?.location?.hostname === 'localhost');
  const DEBUG_ACCREDITATION = Boolean(window?.CRONOX_DEBUG_ACCREDITATION || IS_DEV_ENV);
  const debugAccreditationLog = (...args) => {
    if (!DEBUG_ACCREDITATION) return;
    console.debug('[PROFILE][ACCREDITATION]', ...args);
  };

  // -----------------------------
  // Robust DOM getters (IMPORTANT)
  // -----------------------------
  const getCircleRequestBtn = () => document.querySelector('[data-circle-request-btn]');
  const getCircleRequestStatusEl = () => document.querySelector('[data-circle-request-status]');
  const getCircleUpgradeModal = () => document.getElementById('circleUpgradeModal');
  const getCircleUpgradeSuccessModal = () => document.getElementById('circleUpgradeSuccessModal');

  // Modal can be identified by:
  // 1) id="circleRequestModal" (expected)
  // 2) [data-circle-request-modal] (fallback)
  // 3) .circle-request-modal (fallback)
  const getCircleRequestModal = () =>
    document.getElementById('circleRequestModal') ||
    document.querySelector('[data-circle-request-modal]') ||
    document.querySelector('.circle-request-modal');

  // Close button can be:
  // 1) [data-circle-modal-close] (expected)
  // 2) inside modal: button with aria-label "Close" or class "modal-close" etc.
  const getCircleRequestModalCloseBtn = (modalEl) => {
    if (!modalEl) return null;
    return (
      modalEl.querySelector('[data-circle-modal-close]') ||
      modalEl.querySelector('.modal-close') ||
      modalEl.querySelector('button[aria-label="Cerrar"]') ||
      modalEl.querySelector('button[aria-label="Close"]') ||
      modalEl.querySelector('button[data-close]')
    );
  };

  const getCircleRequestModalStorageKey = () => {
    const userId =
      window.CRONOX_USER?.id ||
      window.CRONOX_USER?._id ||
      window.CRONOX_USER?.userId ||
      window.CRONOX_USER?.uid ||
      window.CRONOX_USER?.memberCode ||
      window.CRONOX_USER?.email;
    if (!userId) return null;
    return `cronox_circle_request_modal_seen_${userId}`;
  };

  const persistCircleRequestModalSeen = () => {
    const storageKey = getCircleRequestModalStorageKey();
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, '1');
    } catch (_) {
      /* ignore storage errors */
    }
  };

  const getCircleUpgradeSuccessStorageKey = () => {
    const userId =
      window.CRONOX_USER?.id ||
      window.CRONOX_USER?._id ||
      window.CRONOX_USER?.userId ||
      window.CRONOX_USER?.uid ||
      window.CRONOX_USER?.memberCode ||
      window.CRONOX_USER?.email;
    if (!userId) return null;
    return `cronox_circle4_request_success_${userId}`;
  };

  const markCircleUpgradeModalSeen = (requestId) => {
    const storageKey = getCircleUpgradeSuccessStorageKey();
    if (!storageKey || !requestId) return;
    try {
      localStorage.setItem(storageKey, String(requestId));
    } catch (_) {
      /* ignore */
    }
  };

  const hasSeenCircleUpgradeSuccess = (requestId) => {
    const storageKey = getCircleUpgradeSuccessStorageKey();
    if (!storageKey || !requestId) return false;
    try {
      return localStorage.getItem(storageKey) === String(requestId);
    } catch (_) {
      return false;
    }
  };

  const showProfileMessage = (text, type = 'success') => {
    if (!messageEl) return;

    messageEl.textContent = text || '';
    messageEl.classList.remove('is-error', 'is-success', 'is-hiding');
    if (type === 'error') messageEl.classList.add('is-error');
    if (type === 'success') messageEl.classList.add('is-success');

    if (messageEl._hideTimeout) {
      clearTimeout(messageEl._hideTimeout);
    }

    messageEl.hidden = false;
    messageEl.classList.add('is-visible');

    if (type === 'success') {
      messageEl._hideTimeout = setTimeout(() => {
        messageEl.classList.add('is-hiding');
        messageEl.classList.remove('is-visible');

        setTimeout(() => {
          messageEl.hidden = true;
        }, 400);
      }, 2000);
    } else {
      messageEl._hideTimeout = null;
    }
  };

  const safeTrim = (value) => (typeof value === 'string' ? value.trim() : '');
  const normalizeCircleLevelValue = (value) => {
    const raw = value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { raw, normalized: value };
    }
    const trimmed = safeTrim(typeof value === 'string' ? value : `${value ?? ''}`);
    if (trimmed) {
      const roman = ROMAN_TO_NUMBER[trimmed.toUpperCase()];
      if (Number.isFinite(roman)) return { raw, normalized: roman };
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed)) return { raw, normalized: parsed };
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return { raw, normalized: numeric };
    return { raw, normalized: NaN };
  };
  const getNormalizedCircleLevel = (value, fallback = NaN) => {
    const { normalized } = normalizeCircleLevelValue(value);
    return Number.isFinite(normalized) ? normalized : fallback;
  };
  const formatCooldownMessage = (days) => {
    const remaining = Number(days) || 0;
    if (remaining <= 0) return '';
    return `Ya has enviado una solicitud recientemente. Podrás volver a solicitar el ascenso en ${remaining} día${remaining === 1 ? '' : 's'}.`;
  };
  const NAME_REGEX = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]+$/;
  const LETTERS_REGEX = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/;
  const optionalValue = (id) => {
    const v = safeTrim($(id)?.value || '');
    return v || undefined;
  };
  const requiredValue = (id) => safeTrim($(id)?.value || '');

  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  };

  const formatAccreditationDate = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const toRomanNumeral = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return '—';
    const entries = [
      { value: 10, symbol: 'X' },
      { value: 9, symbol: 'IX' },
      { value: 5, symbol: 'V' },
      { value: 4, symbol: 'IV' },
      { value: 1, symbol: 'I' },
    ];
    let n = Math.round(num);
    let result = '';
    entries.forEach(({ value: v, symbol }) => {
      while (n >= v) {
        result += symbol;
        n -= v;
      }
    });
    return result || '—';
  };

  const normalizeCentsValue = (value) => {
    let cents = Number(value ?? 0);
    if (cents > 0 && cents < 100) cents = Math.round(cents * 100);
    return cents;
  };

  const buildDisplayName = (user) => {
    if (!user) return '';
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (user.name) return user.name;
    if (user.email) return user.email;
    return '';
  };

  const formatAccreditationName = (name) => {
    const safeName = safeTrim(name);
    if (!safeName) return '—';
    const parts = safeName.split(/\s+/);
    const first = parts.shift() || '';
    const rest = parts.join(' ');
    return `${first}\n${rest}`;
  };

  const renderCircleSymbol = (circleLevel) => {
    if (!accreditationSymbol) return;

    const level = getNormalizedCircleLevel(circleLevel, 1);
    const palette = RING_COLORS[level] || RING_COLORS[1];
    const svgNS = 'http://www.w3.org/2000/svg';
    const size = 220;
    const center = size / 2;
    let currentRadius = 84;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Círculo ${toRomanNumeral(level || 1)}`);

    palette.forEach((color, index) => {
      const stroke = Math.max(7, 12 - index);
      const radius = Math.max(10, currentRadius - stroke / 2);
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', center);
      circle.setAttribute('cy', center);
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', stroke);
      circle.setAttribute('stroke-linecap', 'round');
      svg.appendChild(circle);
      currentRadius -= stroke + 6;
    });

    accreditationSymbol.innerHTML = '';
    accreditationSymbol.appendChild(svg);
  };

  const applyCircleLevel = (circleLevel) => {
    const level = getNormalizedCircleLevel(circleLevel, 1);
    const normalized = level >= 1 && level <= 5 ? level : 1;

    if (accreditationSymbol) {
      accreditationSymbol.dataset.circleLevel = String(normalized);
    }

    if (accreditationCircle) {
      accreditationCircle.textContent = `Círculo ${toRomanNumeral(normalized)}`;
    }

    renderCircleSymbol(normalized);

    return normalized;
  };

  const formatPriceFromCents = (valueInCents) => {
    const cents = normalizeCentsValue(valueInCents);
    if (typeof window.formatPriceFromCents === 'function') {
      return window.formatPriceFromCents(cents);
    }

    const amount = (Number(cents) || 0) / 100;
    if (typeof api.formatPrice === 'function') {
      return api.formatPrice(amount);
    }

    try {
      return amount.toLocaleString('es-ES', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch (error) {
      return `${amount.toFixed(2)} €`;
    }
  };

  const renderOrders = (orders) => {
    if (!ordersBody || !ordersEmpty) return;
    ordersBody.innerHTML = '';

    if (!Array.isArray(orders) || !orders.length) {
      ordersEmpty.hidden = false;
      return;
    }

    ordersEmpty.hidden = true;
    orders.forEach((order) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${order.id}</td>
        <td>${formatDate(order.createdAt)}</td>
        <td>${order.status}</td>
        <td>${order.total ?? ''} ${order.currency || ''}</td>
      `;
      ordersBody.appendChild(tr);
    });
  };

  const fillAccount = (user) => {
    if (!user) return;
    const { firstName, lastName, email } = user;
    if ($('firstName')) $('firstName').value = firstName || '';
    if ($('lastName')) $('lastName').value = lastName || '';
    if ($('email')) $('email').value = email || '';
  };

  const fillAccreditation = (user) => {
    const fullName = buildDisplayName(user) || 'Miembro CRONOX';
    const normalizedCircle = applyCircleLevel(user?.circleLevel);
    if (accreditationName) accreditationName.textContent = formatAccreditationName(fullName);
    if (accreditationCircle) accreditationCircle.textContent = `Círculo ${toRomanNumeral(normalizedCircle)}`;
    if (accreditationCode) accreditationCode.textContent = user?.memberCode ? `ID: ${user.memberCode}` : 'ID: —';
  };

  const fillAccreditationStats = (stats) => {
    const circleLevel = getNormalizedCircleLevel(stats?.circleLevel ?? window.CRONOX_USER?.circleLevel, 1);
    const createdAt = stats?.createdAt ?? window.CRONOX_USER?.createdAt;
    const ordersCount = typeof stats?.pedidosRealizados === 'number' ? stats.pedidosRealizados : stats?.ordersCount;
    const itemsNetCount =
      typeof stats?.articulosAdquiridos === 'number'
        ? stats.articulosAdquiridos
        : stats?.itemsNetCount;

    if (accreditationStatCircle) {
      const normalized = applyCircleLevel(circleLevel);
      accreditationStatCircle.textContent =
        Number.isFinite(normalized) && normalized > 0 ? toRomanNumeral(normalized) : '—';
    }

    if (accreditationStatCreatedAt) {
      accreditationStatCreatedAt.textContent = formatAccreditationDate(createdAt);
    }

    if (accreditationStatOrders) {
      accreditationStatOrders.textContent =
        typeof ordersCount === 'number' && Number.isFinite(ordersCount) ? ordersCount : '—';
    }

    if (accreditationStatItems) {
      accreditationStatItems.textContent =
        typeof itemsNetCount === 'number' && Number.isFinite(itemsNetCount) ? itemsNetCount : '—';
    }
  };

  const ensureGlobalLoader = () => {
    if (globalLoader && globalLoader.isConnected) return globalLoader;

    const existing = document.getElementById('preloader');
    if (existing) {
      existing.dataset.persistent = 'true';
      existing.hidden = true;
      existing.style.display = 'none';
      globalLoader = existing;
      return globalLoader;
    }

    const loader = document.createElement('div');
    loader.id = 'preloader';
    loader.className = 'preloader';
    loader.dataset.persistent = 'true';
    loader.setAttribute('aria-hidden', 'true');
    loader.setAttribute('aria-live', 'polite');
    loader.hidden = true;
    loader.style.display = 'none';

    const inner = document.createElement('div');
    inner.className = 'preloader-inner';

    const img = document.createElement('img');
    img.src = 'assets/CRONOX-GIF.gif';
    img.alt = 'CRONOX';
    img.className = 'preloader__logo';
    img.decoding = 'async';

    inner.appendChild(img);
    loader.appendChild(inner);
    document.body.appendChild(loader);
    globalLoader = loader;
    return loader;
  };

  const setGlobalLoaderVisible = (isVisible) => {
    const loader = ensureGlobalLoader();
    if (!loader) return;

    loader.hidden = !isVisible;
    loader.style.display = isVisible ? 'flex' : 'none';
    if (isVisible) {
      document.body.classList.add('is-loading');
      document.body.classList.remove('is-loaded');
    } else {
      document.body.classList.remove('is-loading');
      document.body.classList.add('is-loaded');
    }
  };

  const setAccreditationLoading = (isLoading) => {
    if (accreditationSection) {
      accreditationSection.classList.toggle('is-loading', !!isLoading);
    }
    if (accreditationBook) {
      accreditationBook.hidden = !!isLoading;
    }
    setGlobalLoaderVisible(!!isLoading);
  };

  const waitForImageLoad = (img) =>
    new Promise((resolve) => {
      if (!img) return resolve();
      if (img.complete && img.naturalWidth > 0) {
        resolve();
        return;
      }
      const onDone = () => resolve();
      img.addEventListener('load', onDone, { once: true });
      img.addEventListener('error', onDone, { once: true });
    });

  const ensureAccreditationQr = () => {
    if (!accreditationQr) return Promise.resolve();
    if (!accreditationQrLoaded) {
      const base = typeof window.CRONOX_API_BASE === 'string' ? window.CRONOX_API_BASE : '';
      accreditationQr.src = `${base}/api/membership/me/qr`;
      accreditationQrLoaded = true;
    }
    return waitForImageLoad(accreditationQr);
  };

  const loadAccreditationData = async () => {
    setAccreditationLoading(true);
    window.CRONOX_PROMOTION_STATUS = 'loading';
    circleUpgradeStatusLoaded = false;
    const normalizedUserCircle = getNormalizedCircleLevel(window.CRONOX_USER?.circleLevel, window.CRONOX_USER?.circleLevel);
    fillAccreditation({ ...(window.CRONOX_USER || {}), circleLevel: normalizedUserCircle });
    updatePromotionUi({
      circleLevel: normalizedUserCircle,
      promotionRequestStatus: 'loading',
    });
    renderCircleUpgradeUi({
      circleLevel: normalizedUserCircle,
    });

    try {
      await Promise.all([
        loadAccreditationStats(),
        ensureAccreditationQr(),
        loadCircleUpgradeStatus({ skipLoader: true }),
      ]);
    } finally {
      setAccreditationLoading(false);
    }
  };

  const fillAddress = (address) => {
    if (!address) return;
    if ($('addrName')) $('addrName').value = address.name || '';
    if ($('addrPhone')) $('addrPhone').value = address.phone || '';
    if ($('addrLine1')) $('addrLine1').value = address.line1 || '';
    if ($('addrLine2')) $('addrLine2').value = address.line2 || '';
    if ($('addrCity')) $('addrCity').value = address.city || '';
    if ($('addrState')) $('addrState').value = address.state || '';
    if ($('addrZip')) $('addrZip').value = address.zip || '';
    if ($('addrCountry')) $('addrCountry').value = address.country || '';
  };

  const handleAuthRedirect = (err) => {
    if (err?.status === 401 || err?.status === 403) {
      try { localStorage.setItem('cronox_open_auth_on_load', 'login'); } catch (_) {}
      window.location.href = 'index.html';
      return true;
    }
    return false;
  };

  const loadOrders = async () => {
    if (!api.getMyOrders) return;
    try {
      const orders = await api.getMyOrders();
      renderOrders(orders);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudieron cargar los pedidos', err);
      renderOrders([]);
    }
  };

  const updatePromotionUi = ({ circleLevel, promotionRequestStatus } = {}) => {
    const normalizedLevel = getNormalizedCircleLevel(circleLevel ?? window.CRONOX_USER?.circleLevel, 1);
    const status = promotionRequestStatus || window.CRONOX_PROMOTION_STATUS || 'none';
    window.CRONOX_PROMOTION_STATUS = status;
    const isLoading = status === 'loading';

    const circleRequestBtn = getCircleRequestBtn();
    const circleRequestStatus = getCircleRequestStatusEl();

    if (circleRequestBtn) {
      const showBtn = !isLoading && normalizedLevel === 2 && status !== 'pending' && normalizedLevel < 3;
      circleRequestBtn.hidden = !showBtn;
      circleRequestBtn.disabled = !showBtn;
    }

    if (circleRequestStatus) {
      const showStatus = !isLoading && status === 'pending' && normalizedLevel === 2;
      if (showStatus) {
        circleRequestStatus.textContent = 'Solicitud de ascenso enviada';
      }
      circleRequestStatus.hidden = !showStatus;
    }
  };

  const renderCircleUpgradeUi = (status = circleUpgradeStatus) => {
    const circleLevelRaw =
      status?.circleLevel ?? window.CRONOX_ACCREDITATION_STATS?.circleLevel ?? window.CRONOX_USER?.circleLevel ?? 1;
    const circleLevel = getNormalizedCircleLevel(circleLevelRaw, 1);
    const circleUpgradeCta = getCircleUpgradeCta();
    const circleUpgradeBtn = getCircleUpgradeBtn();
    const circleUpgradeStatusEl = getCircleUpgradeStatusEl();
    const circleUpgradeCooldown = getCircleUpgradeCooldownEl();

    const latestStatus = (status?.latestRequest?.status || '').toString().toUpperCase();
    const hasPending = Boolean(status?.hasPending || latestStatus === 'PENDING');
    const hasApprovedRequest = Boolean(status?.hasApproved || latestStatus === 'APPROVED');
    const cooldownDays = Number(status?.cooldownDaysRemaining ?? status?.cooldownDays ?? 0);
    const isCircleThree = circleLevel === 3;
    const canRequest =
      status?.canRequest ?? (isCircleThree && !hasPending && !hasApprovedRequest && cooldownDays <= 0);
    const shouldShowFlow = isCircleThree;
    const shouldShowBtn = shouldShowFlow && !!canRequest && !hasApprovedRequest;
    const shouldShowStatus = shouldShowFlow && (hasPending || hasApprovedRequest);
    const shouldShowCooldown = shouldShowFlow && !shouldShowBtn && !shouldShowStatus && cooldownDays > 0;
    debugAccreditationLog('Circle 4 UI state', {
      circleRaw: circleLevelRaw,
      circleNormalized: circleLevel,
      latestStatus,
      hasPending,
      hasApprovedRequest,
      cooldownDays,
      canRequest,
      shouldShowBtn,
      shouldShowStatus,
      shouldShowCooldown,
    });

    if (circleUpgradeCta) {
      circleUpgradeCta.hidden = !shouldShowFlow;
    }

    if (circleUpgradeBtn) {
      circleUpgradeBtn.hidden = !shouldShowBtn;
      circleUpgradeBtn.disabled = !shouldShowBtn;
    }

    if (circleUpgradeStatusEl) {
      circleUpgradeStatusEl.hidden = !shouldShowStatus;
      if (shouldShowStatus) {
        circleUpgradeStatusEl.textContent = 'La solicitud de ascenso ha sido enviada.';
      }
    }

    if (circleUpgradeCooldown) {
      circleUpgradeCooldown.hidden = !shouldShowCooldown;
      if (shouldShowCooldown) {
        circleUpgradeCooldown.textContent = formatCooldownMessage(cooldownDays);
      }
    }

    if (!shouldShowFlow || circleLevel >= 4) {
      hideCircleUpgradeModal();
      hideCircleUpgradeSuccessModal();
    }
  };

  const setCircleUpgradeState = (status) => {
    circleUpgradeStatus = status || null;
    lastCircleUpgradeRequestId = status?.latestRequest?.id || null;
    renderCircleUpgradeUi(circleUpgradeStatus);
  };

  const loadCircleUpgradeStatus = async ({ skipLoader = false } = {}) => {
    if (!api.getCircleUpgradeStatus) return null;
    try {
      if (!skipLoader) setAccreditationLoading(true);
      const status = await api.getCircleUpgradeStatus();
      circleUpgradeStatusLoaded = true;
      setCircleUpgradeState(status);
      return status;
    } catch (err) {
      if (handleAuthRedirect(err)) return null;
      console.warn('[PROFILE] No se pudo cargar el estado de ascenso 3→4', err);
      circleUpgradeStatusLoaded = false;
      const fallbackCircle = getNormalizedCircleLevel(
        window.CRONOX_ACCREDITATION_STATS?.circleLevel ?? window.CRONOX_USER?.circleLevel,
        NaN,
      );
      setCircleUpgradeState({
        circleLevel: fallbackCircle,
        hasPending: false,
        hasApproved: false,
        cooldownDaysRemaining: 0,
        canRequest: fallbackCircle === 3,
        latestRequest: { status: 'ERROR' },
        error: true,
      });
      showProfileMessage('No se pudo cargar el estado de tu solicitud de Círculo 4.', 'error');
      return null;
    } finally {
      if (!skipLoader) setAccreditationLoading(false);
    }
  };

  // -----------------------------
  // Modal show/hide (bulletproof)
  // -----------------------------
  const hideCircleRequestModal = () => {
    const modal = getCircleRequestModal();
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    isCircleRequestModalOpen = false;
  };

  const showCircleRequestModal = () => {
    const modal = getCircleRequestModal();
    if (!modal || isCircleRequestModalOpen) return;

    // IMPORTANT: modal ONLY opens after successful click (we never open it on load)
    modal.hidden = false;
    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');
    isCircleRequestModalOpen = true;

    // Keep as “seen” just in case some other code tries to auto-open
    persistCircleRequestModalSeen();
  };

  const hideCircleUpgradeModal = () => {
    const modal = getCircleUpgradeModal();
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    isCircleUpgradeModalOpen = false;
  };

  const showCircleUpgradeModal = () => {
    const modal = getCircleUpgradeModal();
    const btn = getCircleUpgradeBtn();
    const circleLevel = getNormalizedCircleLevel(
      circleUpgradeStatus?.circleLevel ?? window.CRONOX_ACCREDITATION_STATS?.circleLevel ?? window.CRONOX_USER?.circleLevel,
      1,
    );
    const latestStatus = (circleUpgradeStatus?.latestRequest?.status || '').toString().toUpperCase();
    const hasPending = Boolean(circleUpgradeStatus?.hasPending || latestStatus === 'PENDING');
    const hasApprovedRequest = Boolean(circleUpgradeStatus?.hasApproved || latestStatus === 'APPROVED');
    const cooldownDays = Number(circleUpgradeStatus?.cooldownDaysRemaining ?? circleUpgradeStatus?.cooldownDays ?? 0);
    const canRequest =
      circleUpgradeStatus?.canRequest ??
      (circleLevel === 3 && !hasPending && !hasApprovedRequest && cooldownDays <= 0);
    const eligible = circleLevel === 3 && canRequest && !hasApprovedRequest;

    if (!modal || isCircleUpgradeModalOpen || !eligible || (btn && (btn.hidden || btn.disabled))) return;
    modal.hidden = false;
    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');
    isCircleUpgradeModalOpen = true;
  };

  const hideCircleUpgradeSuccessModal = () => {
    const modal = getCircleUpgradeSuccessModal();
    if (!modal) return;
    modal.hidden = true;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    isCircleUpgradeSuccessModalOpen = false;
    circleUpgradeJustSubmitted = false;
  };

  const showCircleUpgradeSuccessModal = (requestId) => {
    const modal = getCircleUpgradeSuccessModal();
    if (!circleUpgradeJustSubmitted) {
      return;
    }

    if (!modal) {
      markCircleUpgradeModalSeen(requestId);
      circleUpgradeJustSubmitted = false;
      return;
    }

    if (isCircleUpgradeSuccessModalOpen || hasSeenCircleUpgradeSuccess(requestId)) {
      markCircleUpgradeModalSeen(requestId);
      circleUpgradeJustSubmitted = false;
      return;
    }

    modal.hidden = false;
    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'false');
    isCircleUpgradeSuccessModalOpen = true;
    circleUpgradeJustSubmitted = false;
    markCircleUpgradeModalSeen(requestId);
  };

  const loadAccreditationStats = async () => {
    if (!api.getAccreditationStats) {
      const normalizedCircle = getNormalizedCircleLevel(window.CRONOX_USER?.circleLevel, window.CRONOX_USER?.circleLevel);
      fillAccreditationStats({ circleLevel: normalizedCircle });
      updatePromotionUi({ circleLevel: normalizedCircle });
      renderCircleUpgradeUi(circleUpgradeStatus || { circleLevel: normalizedCircle });
      return;
    }

    if (accreditationStatsLoaded && window.CRONOX_ACCREDITATION_STATS) {
      const normalizedCircle = getNormalizedCircleLevel(
        window.CRONOX_ACCREDITATION_STATS?.circleLevel ?? window.CRONOX_USER?.circleLevel,
        window.CRONOX_USER?.circleLevel,
      );
      fillAccreditation({ ...(window.CRONOX_USER || {}), circleLevel: normalizedCircle });
      fillAccreditationStats({ ...window.CRONOX_ACCREDITATION_STATS, circleLevel: normalizedCircle });
      updatePromotionUi({
        circleLevel: normalizedCircle,
        promotionRequestStatus: window.CRONOX_ACCREDITATION_STATS?.promotionRequestStatus,
      });
      renderCircleUpgradeUi(circleUpgradeStatus || { circleLevel: normalizedCircle });
      return;
    }

    try {
      const stats = await api.getAccreditationStats();
      window.CRONOX_ACCREDITATION_STATS = stats;
      accreditationStatsLoaded = true;
      const normalizedStatsCircle = getNormalizedCircleLevel(stats?.circleLevel, stats?.circleLevel);
      if (stats?.circleLevel != null) {
        window.CRONOX_USER = { ...(window.CRONOX_USER || {}), circleLevel: normalizedStatsCircle };
      }
      fillAccreditation({ ...(window.CRONOX_USER || {}), circleLevel: normalizedStatsCircle });
      fillAccreditationStats({ ...stats, circleLevel: normalizedStatsCircle });
      updatePromotionUi({
        circleLevel: normalizedStatsCircle,
        promotionRequestStatus: stats?.promotionRequestStatus,
      });
      renderCircleUpgradeUi(circleUpgradeStatus || { circleLevel: normalizedStatsCircle });
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudieron cargar las estadísticas de acreditación', err);
      accreditationStatsLoaded = false;
      showProfileMessage('No se pudieron cargar tus datos de acreditación.', 'error');
    }
  };

  const normalizeFavoriteProduct = (favorite) => {
    const product = favorite?.product || favorite || {};
    const images = Array.isArray(product.images)
      ? product.images
          .map((img) => (typeof img === 'string' ? img : img?.url || img?.imageUrl || img?.image))
          .filter(Boolean)
      : [];

    const priceInCents = normalizeCentsValue(
      product.price ?? product.priceCents ?? product.price_in_cents ?? product.priceInCents ?? 0
    );
    const priceLabel = formatPriceFromCents(priceInCents);
    const imageList = images.length ? images : product.image ? [product.image] : [];

    return {
      id: product.id ?? favorite?.id ?? favorite?.productId,
      backendId: product.backendId ?? product.id ?? favorite?.productId,
      slug: product.slug,
      name: product.name || 'Producto',
      priceInCents,
      priceLabel,
      price: priceInCents / 100,
      image: product.imageUrl || product.image || images[0] || '',
      images: imageList,
    };
  };

  const updateFavoritesState = ({ loading = false, empty = false } = {}) => {
    if (favoritesLoading) favoritesLoading.hidden = !loading;
    if (favoritesEmpty) favoritesEmpty.hidden = !empty;
    if (favoritesList) favoritesList.hidden = loading || empty;
  };

  const createFallbackProductCard = (product) => {
    const key = product.slug || product.backendId || product.id || '';
    const link = document.createElement('a');
    link.className = 'product-card';
    if (key) link.dataset.id = key;
    if (product.slug) link.dataset.slug = product.slug;
    if (product.backendId != null) link.dataset.backendId = String(product.backendId);
    link.href = product.slug
      ? `/producto.html?slug=${encodeURIComponent(product.slug)}`
      : `/producto.html?id=${encodeURIComponent(key)}`;

    const media = document.createElement('div');
    media.className = 'product-media';

    const gallery = document.createElement('div');
    gallery.className = 'product-images';

    const imgs = (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(
      Boolean
    );
    const imgEls = imgs.map((src, i) => {
      const img = document.createElement('img');
      img.className = `product-img${i === 0 ? ' active' : ''}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = product.name || 'Producto';
      img.src = src;
      return img;
    });
    imgEls.forEach((img) => gallery.appendChild(img));

    if (imgEls.length > 1) {
      const prev = document.createElement('button');
      prev.className = 'product-arrow prev';
      prev.type = 'button';
      prev.setAttribute('aria-label', 'Imagen anterior');
      prev.textContent = '‹';

      const next = document.createElement('button');
      next.className = 'product-arrow next';
      next.type = 'button';
      next.setAttribute('aria-label', 'Imagen siguiente');
      next.textContent = '›';

      let index = 0;
      const show = (i) => imgEls.forEach((el, j) => el.classList.toggle('active', j === i));
      prev.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        index = (index - 1 + imgEls.length) % imgEls.length;
        show(index);
      });
      next.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        index = (index + 1) % imgEls.length;
        show(index);
      });

      gallery.appendChild(prev);
      gallery.appendChild(next);
    }

    const favBtn = document.createElement('button');
    favBtn.className = 'favorite-toggle';
    favBtn.type = 'button';
    favBtn.setAttribute('aria-label', 'Marcar como favorito');
    favBtn.dataset.productId = String(product.backendId ?? product.id ?? '');
    favBtn.dataset.slug = product.slug || '';
    favBtn.dataset.name = product.name || 'Producto';
    favBtn.dataset.price = product.priceLabel || formatPriceFromCents(product.priceInCents);
    favBtn.dataset.image = imgs[0] || product.image || '';
    favBtn.innerHTML = window.CRONOX_STAR_ICON || '<span class="icon-star"></span>';
    favBtn.dataset.favBound = '1';
    favBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.toggleFromButton === 'function') {
        window.CRONOX_FAVORITES.toggleFromButton(favBtn);
      }
    });

    const plus = document.createElement('button');
    plus.className = 'fav-add';
    plus.type = 'button';
    plus.setAttribute('aria-label', `Añadir rápido ${product.name}`);
    plus.textContent = '+';
    plus.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.CRONOX_openQuickAddById === 'function') {
        const key2 = product.slug || product.id || product.backendId;
        window.CRONOX_openQuickAddById(key2 != null ? String(key2) : '');
      }
    });

    media.appendChild(gallery);
    media.appendChild(favBtn);
    media.appendChild(plus);

    const nameEl = document.createElement('h3');
    nameEl.className = 'product-name';
    nameEl.textContent = product.name || 'Producto';

    const priceEl = document.createElement('p');
    priceEl.className = 'product-price';
    priceEl.textContent = product.priceLabel || formatPriceFromCents(product.priceInCents ?? product.price ?? 0);

    link.appendChild(media);
    link.appendChild(nameEl);
    link.appendChild(priceEl);

    return link;
  };

  const renderFavorites = (favorites) => {
    if (!favoritesGrid) return;
    favoritesGrid.innerHTML = '';

    if (!Array.isArray(favorites) || !favorites.length) {
      updateFavoritesState({ loading: false, empty: true });
      return;
    }

    const cardBuilder =
      typeof window.CRONOX_buildFavoriteCard === 'function'
        ? window.CRONOX_buildFavoriteCard
        : typeof window.CRONOX_createProductCard === 'function'
          ? window.CRONOX_createProductCard
          : createFallbackProductCard;

    const frag = document.createDocumentFragment();
    favorites.forEach((fav) => {
      const card = cardBuilder(fav);
      if (card) frag.appendChild(card);
    });
    favoritesGrid.appendChild(frag);
    updateFavoritesState({ loading: false, empty: false });

    if (typeof window.CRONOX_syncFavoritesDom === 'function') {
      window.CRONOX_syncFavoritesDom();
    }
  };

  const loadFavorites = async () => {
    if (!api.getFavorites || favoritesLoaded) return;
    favoritesLoaded = true;
    updateFavoritesState({ loading: true, empty: false });

    try {
      const data = await api.getFavorites();
      const mapped = Array.isArray(data) ? data.map((fav) => normalizeFavoriteProduct(fav)) : [];

      const favoriteIds = mapped.map((item) => item.backendId ?? item.id).filter(Boolean);
      if (typeof window.CRONOX_setFavoriteIds === 'function') {
        window.CRONOX_setFavoriteIds(favoriteIds);
      }

      renderFavorites(mapped);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudieron cargar los favoritos', err);
      favoritesLoaded = false;
      updateFavoritesState({ loading: false, empty: true });
    }
  };

  const loadAddress = async () => {
    if (!api.getDefaultAddress) return;
    try {
      const address = await api.getDefaultAddress();
      if (address) fillAddress(address);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar la dirección', err);
    }
  };

  const loadProfile = async () => {
    if (!api.getMe) return;
    try {
      const user = await api.getMe();
      if (!user) throw new Error('Usuario no autenticado');
      const normalizedUserCircle = getNormalizedCircleLevel(user?.circleLevel, user?.circleLevel);
      const normalizedUser = { ...user, circleLevel: normalizedUserCircle };
      window.CRONOX_USER = normalizedUser;
      fillAccount(normalizedUser);
      fillAccreditation(normalizedUser);
      await Promise.all([loadAddress(), loadOrders()]);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar el perfil', err);
      showProfileMessage('No se pudo cargar tu perfil. Inténtalo de nuevo más tarde.', 'error');
    }
  };

  const bindAccountForm = () => {
    const form = $('accountForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!api.updateMe) return;
      const firstName = optionalValue('firstName');
      const lastName = optionalValue('lastName');

      const invalidName =
        (firstName && (!NAME_REGEX.test(firstName) || /\d/.test(firstName))) ||
        (lastName && (!NAME_REGEX.test(lastName) || /\d/.test(lastName)));

      if (invalidName) {
        showProfileMessage('El nombre y el apellido no pueden contener números.', 'error');
        return;
      }

      const payload = {
        firstName,
        lastName,
        email: optionalValue('email'),
      };
      try {
        const updated = await api.updateMe(payload);
        const normalizedUserCircle = getNormalizedCircleLevel(updated?.circleLevel, updated?.circleLevel);
        const normalizedUpdated = { ...updated, circleLevel: normalizedUserCircle };
        window.CRONOX_USER = normalizedUpdated;
        fillAccount(normalizedUpdated);
        fillAccreditation(normalizedUpdated);
        showProfileMessage('Datos actualizados correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar cuenta', err);
        const msg = err?.payload?.message || err?.message || 'No se pudieron guardar los cambios.';
        showProfileMessage(msg, 'error');
      }
    });
  };

  const bindAddressForm = () => {
    const form = $('addressForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!api.upsertAddress) return;
      let phone = optionalValue('addrPhone');
      if (phone && LETTERS_REGEX.test(phone)) {
        showProfileMessage('El teléfono solo puede contener números.', 'error');
        return;
      }
      if (phone) {
        phone = phone.replace(/[^\d+]/g, '');
        if (!phone) {
          phone = undefined;
        }
      }
      const payload = {
        name: requiredValue('addrName'),
        phone,
        line1: requiredValue('addrLine1'),
        line2: optionalValue('addrLine2'),
        city: requiredValue('addrCity'),
        state: optionalValue('addrState'),
        zip: requiredValue('addrZip'),
        country: requiredValue('addrCountry'),
      };

      if (!payload.name || !payload.line1 || !payload.city || !payload.zip || !payload.country) {
        showProfileMessage('Completa los campos obligatorios de la dirección.', 'error');
        return;
      }

      try {
        const address = await api.upsertAddress(payload);
        fillAddress(address);
        showProfileMessage('Dirección guardada correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar dirección', err);
        const msg = err?.payload?.message || err?.message || 'No se pudo guardar la dirección.';
        showProfileMessage(msg, 'error');
      }
    });
  };

  const handleLogout = async () => {
    const forceHome = () => {
      if (typeof window.CRONOX_redirectHome === 'function') {
        window.CRONOX_redirectHome();
        return;
      }
      const logoHref = document.querySelector('.topbar__logo')?.getAttribute('href') || '/';
      try {
        window.location.replace(logoHref);
      } catch {
        window.location.href = logoHref;
      }
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {}
      }, 120);
    };

    if (typeof window.CRONOX_logout === 'function') {
      try {
        await window.CRONOX_logout();
        return;
      } catch (err) {
        console.warn('[PROFILE] logout error', err);
        forceHome();
        return;
      }
    }
    try {
      if (api.logout) await api.logout();
    } catch (err) {
      console.warn('[PROFILE] logout error', err);
    }
    try {
      sessionStorage.clear();
    } catch {}
    try {
      localStorage.clear();
    } catch {}
    window.CRONOX_USER = null;
    try {
      window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: null }));
    } catch {}
    forceHome();
  };

  const bindTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.profile-tab'));
    const sections = Array.from(document.querySelectorAll('.profile-section'));

    const activate = async (target) => {
      tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.profileTab === target));
      sections.forEach((section) =>
        section.classList.toggle('is-active', section.dataset.profileSection === target)
      );

      if (target === 'favorites') loadFavorites();
      if (target === 'accreditation') await loadAccreditationData();
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', async () => {
        const target = tab.dataset.profileTab;
        if (!target) return;
        if (target === 'logout') {
          await handleLogout();
          return;
        }
        await activate(target);
      });
    });

    activate('orders');
  };

  const bindBackLinks = () => {
    document.querySelectorAll('[data-profile-back="store"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.location.href = 'index.html';
      });
    });
  };

  // -----------------------------
  // Circle 3 → 4 upgrade binding
  // -----------------------------
  const bindCircleUpgrade = () => {
    hideCircleUpgradeModal();
    hideCircleUpgradeSuccessModal();

    const btn = getCircleUpgradeBtn();
    const modal = getCircleUpgradeModal();
    const successModal = getCircleUpgradeSuccessModal();
    const form = document.getElementById('circleUpgradeForm');
    const socialField = modal?.querySelector('[data-circle-upgrade-social]');
    const usernameField = modal?.querySelector('[data-circle-upgrade-username]');
    const submitBtn = form?.querySelector('[type="submit"]');

    if (btn) {
      btn.addEventListener('click', () => {
        showCircleUpgradeModal();
      });
    }

    if (modal) {
      const closeBtn = modal.querySelector('[data-circle-upgrade-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          hideCircleUpgradeModal();
        });
      }
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) {
          hideCircleUpgradeModal();
        }
      });
    }

    if (successModal) {
      const closeBtn = successModal.querySelector('[data-circle-upgrade-success-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          hideCircleUpgradeSuccessModal();
        });
      }
      successModal.addEventListener('click', (ev) => {
        if (ev.target === successModal) {
          hideCircleUpgradeSuccessModal();
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!api.requestCircleUpgrade) return;
        const socialNetwork = (socialField?.value || '').trim();
        const username = safeTrim(usernameField?.value || '');

        if (!socialNetwork || !username) {
          showProfileMessage('Selecciona una red social e introduce tu usuario.', 'error');
          return;
        }

        if (submitBtn) submitBtn.disabled = true;
        setAccreditationLoading(true);
        try {
          const request = await api.requestCircleUpgrade({ socialNetwork, username });
          form.reset();
          hideCircleUpgradeModal();
          await loadCircleUpgradeStatus({ skipLoader: true });
          renderCircleUpgradeUi(circleUpgradeStatus);
          circleUpgradeJustSubmitted = true;
          lastCircleUpgradeRequestId = request?.id || lastCircleUpgradeRequestId;
          showCircleUpgradeSuccessModal(request?.id);
        } catch (err) {
          if (handleAuthRedirect(err)) return;
          console.error('[PROFILE] Error al solicitar ascenso 3→4', err);
          const msg =
            err?.payload?.message ||
            err?.message ||
            'No se pudo enviar la solicitud de ascenso al Círculo 4.';
          showProfileMessage(msg, 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
          setAccreditationLoading(false);
        }
      });
    }
  };

  // -----------------------------
  // Promotion binding (fixed)
  // -----------------------------
  const bindCirclePromotion = () => {
    // HARD RULE: modal must NEVER appear on load
    hideCircleRequestModal();

    const btn = getCircleRequestBtn();
    const circleRequestStatus = getCircleRequestStatusEl();
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!api.requestCirclePromotion) return;

        window.CRONOX_PROMOTION_STATUS = 'pending';
        btn.hidden = true;
        btn.disabled = true;

        if (circleRequestStatus) {
          circleRequestStatus.hidden = false;
          circleRequestStatus.textContent = 'Solicitud de ascenso enviada';
        }

        updatePromotionUi({ promotionRequestStatus: 'pending' });

        try {
          const response = await api.requestCirclePromotion();
          const promotionStatus = response?.status || 'pending';

          window.CRONOX_PROMOTION_STATUS = promotionStatus;
          updatePromotionUi({
            circleLevel: 2,
            promotionRequestStatus: promotionStatus,
          });
          // Only show after successful request
          showCircleRequestModal();
        } catch (err) {
          if (handleAuthRedirect(err)) return;
          console.error('[PROFILE] Error al solicitar ascenso de círculo', err);
          const msg = err?.payload?.message || err?.message || 'No se pudo solicitar el ascenso.';
          showProfileMessage(msg, 'error');
          window.CRONOX_PROMOTION_STATUS = 'none';
          if (circleRequestStatus) {
            circleRequestStatus.hidden = true;
          }
          updatePromotionUi({
            circleLevel: window.CRONOX_USER?.circleLevel,
            promotionRequestStatus: 'none',
          });
          btn.hidden = false;
          btn.disabled = false;
        }
      });
    }

    const modal = getCircleRequestModal();
    if (modal) {
      // Bind close button inside modal
      const closeBtn = getCircleRequestModalCloseBtn(modal);
      if (closeBtn) {
        closeBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          hideCircleRequestModal();
        });
      }

      // Click outside to close (only if clicking the overlay itself)
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) {
          hideCircleRequestModal();
        }
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAccountForm();
    bindAddressForm();
    bindCircleUpgrade();
    bindCirclePromotion();
    bindTabs();
    bindBackLinks();
    loadProfile();
  });
})();
