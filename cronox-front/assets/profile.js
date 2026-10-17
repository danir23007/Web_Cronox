(function () {
  const api = window.CRONOX_API || {};
  const Country = window.CRONOX_COUNTRY || {};
  const SPAIN = Country.SPAIN || 'España';
  const normalizeCountry = (value) => Country.normalizeCountry?.(value) || null;
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
  const accreditationBookArt = accreditationBook?.querySelector('.accreditation-book-art');
  const accreditationStatCircle = document.querySelector('[data-acc-stat="circle"]');
  const accreditationStatCreatedAt = document.querySelector('[data-acc-stat="createdAt"]');
  const accreditationStatOrders = document.querySelector('[data-acc-stat="orders"]');
  const accreditationStatItems = document.querySelector('[data-acc-stat="items"]');
  const accreditationStatProducts = document.querySelector('[data-acc-stat="products"]');
  const accreditationPrivilegesList = document.querySelector('[data-acc-privileges-list]');
  const presentation = window.CRONOX_METACRILATOS_PRESENTATION;
  const metacrilatosMember = presentation?.ensure(accreditationSection);
  const metacrilatosHistory = metacrilatosMember?.querySelector('[data-meta-history]');
  const metacrilatosRetry = metacrilatosMember?.querySelector('[data-meta-retry]');
  const getCircleUpgradeCta = () => document.querySelector('[data-circle4-cta]');
  const getCircleUpgradeBtn = () => document.querySelector('[data-circle4-request-btn]');
  const getCircleUpgradeStatusEl = () => document.querySelector('[data-circle4-status]');
  const getCircleUpgradeCooldownEl = () => document.querySelector('[data-circle4-cooldown]');

  let favoritesLoaded = false;
  let accreditationQrLoaded = false;
  let accreditationLoadSequence = 0;
  let accreditationStatsSequence = 0;
  const stopAccreditation = () => {
    accreditationLoadSequence++;
    window.clearTimeout(promotionTimer);
    promotionTimer = 0;
    circlePromotionStatus = null;
    circlePromotionLoading = true;
    promotionRefreshPromise = null;
    resetMetacrilatosMember();
    window.CRONOX_ACCREDITATION_DESIGNS?.destroy(accreditationSection);
    setAccreditationLoading(false);
  };
  const accreditationContext = () => {
    const sequence = accreditationLoadSequence;
    const identity = window.CRONOX_USER?.identityUid ?? window.CRONOX_USER?.id;
    return () => sequence === accreditationLoadSequence && identity === (window.CRONOX_USER?.identityUid ?? window.CRONOX_USER?.id);
  };
  const resetAccreditationIdentity = () => {
    stopAccreditation();
    accreditationQrLoaded = false;
    accreditationStatsLoaded = false;
    circleUpgradeStatusLoaded = false;
    circleUpgradeStatusLoading = false;
    circleUpgradeStatus = null;
    lastCircleUpgradeRequestId = null;
    window.CRONOX_ACCREDITATION_STATS = null;
    window.CRONOX_PROMOTION_STATUS = null;
    accreditationQr?.removeAttribute('src');
    for (const field of [accreditationName, accreditationCode, accreditationCircle]) if (field) field.textContent = '';
    accreditationSymbol?.replaceChildren();
    if (accreditationBook) accreditationBook.hidden = true;
  };
  window.addEventListener('pagehide', stopAccreditation);
  window.addEventListener('cronox:session-ended', resetAccreditationIdentity);
  window.addEventListener('cronox:userChanged', resetAccreditationIdentity);
  let accreditationStatsLoaded = false;
  let globalLoader = null;

  // Modal state (only open after successful request)
  let isCircleRequestModalOpen = false;
  let isCircleUpgradeModalOpen = false;
  let isCircleUpgradeSuccessModalOpen = false;
  let circleUpgradeJustSubmitted = false;
  let circleUpgradeStatusLoaded = false;
  let circleUpgradeStatusLoading = false;
  let circleUpgradeStatus = null;
  let lastCircleUpgradeRequestId = null;
  let circlePromotionStatus = null;
  let circlePromotionLoading = true;
  let circlePromotionSubmitting = false;
  let circleUpgradeSubmitting = false;
  let promotionTimer = 0;
  let promotionRefreshPromise = null;

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
  const ACCREDITATION_PRIVILEGES = presentation?.privileges || {};
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
    const userId = window.CRONOX_USER?.identityUid;
    if (!userId) return null;
    return `cronox_circle_request_modal_seen_${userId}`;
  };

  const persistCircleRequestModalSeen = () => {
    const storageKey = getCircleRequestModalStorageKey();
    if (!storageKey) return;
    if (window.CRONOX_COOKIE_CONSENT?.hasConsent('preferences') !== true) return;
    try {
      localStorage.setItem(storageKey, '1');
    } catch (_) {
      /* ignore storage errors */
    }
  };

  const getCircleUpgradeSuccessStorageKey = () => {
    const userId = window.CRONOX_USER?.identityUid;
    if (!userId) return null;
    return `cronox_circle4_request_success_${userId}`;
  };

  const markCircleUpgradeModalSeen = (requestId) => {
    const storageKey = getCircleUpgradeSuccessStorageKey();
    if (!storageKey || !requestId) return;
    if (window.CRONOX_COOKIE_CONSENT?.hasConsent('preferences') !== true) return;
    try {
      localStorage.setItem(storageKey, String(requestId));
    } catch (_) {
      /* ignore */
    }
  };

  const hasSeenCircleUpgradeSuccess = (requestId) => {
    const storageKey = getCircleUpgradeSuccessStorageKey();
    if (!storageKey || !requestId) return false;
    if (window.CRONOX_COOKIE_CONSENT?.hasConsent('preferences') !== true) return false;
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
  // Only server timestamps define eligibility. A monotonic clock advances the
  // display between responses; changing the device date cannot unlock a CTA.
  const clockedPromotionStatus = (status, receivedAt = performance.now()) => status && ({ ...status, receivedAt });
  const promotionRemaining = status => {
    const eligible = Date.parse(status?.eligibleAt);
    const server = Date.parse(status?.serverTime);
    if (!Number.isFinite(eligible) || !Number.isFinite(server)) return 0;
    return Math.max(0, eligible - server - Math.max(0, performance.now() - status.receivedAt));
  };
  const formatCooldownMessage = milliseconds => {
    // Round the last partial minute up, so a blocked button never shows zero.
    const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return `Podrás solicitar tu ascenso en ${days} día${days === 1 ? '' : 's'}, ${hours} hora${hours === 1 ? '' : 's'} y ${minutes} minuto${minutes === 1 ? '' : 's'}.`;
  };
  const displayedCircle = fallback => {
    const mounted = Number(accreditationSection?.querySelector('.metacrilatos-host')?.dataset.crxLevel);
    return isMetacrilatos() && mounted >= 1 && mounted <= 5 ? mounted
      : getNormalizedCircleLevel(fallback ?? window.CRONOX_USER?.circleLevel, 1);
  };
  // Match the existing registration/profile DTO policy for changed values.
  // Historical names are retained unchanged, including unsupported punctuation.
  const NAME_REGEX = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]+$/;
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

  const escapeHtml = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const safeExternalUrl = (value) => {
    const helper = window.CRONOX_SECURITY?.externalHttpUrl;
    return typeof helper === 'function' ? helper(value) : '';
  };
  const safeProductImage = (value, fallback = 'assets/product-image-unavailable.svg') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };

  const statusLabel = (status) => {
    const map = {
      PENDING: 'Pendiente',
      PAID: 'Pagado',
      PROCESSING: 'En preparación',
      SHIPPED: 'Enviado',
      DELIVERED: 'Entregado',
      CANCELLED: 'Cancelado',
      REFUNDED: 'Reembolsado',
    };
    const key = String(status || '').toUpperCase();
    return map[key] || key || '—';
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
      const trackingBits = [];
      let trackingUrl = safeExternalUrl(order.trackingUrl);
      if (trackingUrl && /^correos$/i.test(String(order.shippingCarrier || '').trim())) {
        try {
          const url = new URL(trackingUrl);
          if (url.protocol !== 'https:' || !['correos.es', 'www.correos.es'].includes(url.hostname)) trackingUrl = '';
        } catch { trackingUrl = ''; }
      }
      const orderId = escapeHtml(order.id);
      const createdAt = escapeHtml(formatDate(order.purchasedAt || order.createdAt));
      const orderStatus = escapeHtml(statusLabel(order.status)) + (order.excludedFromStatistics ? '<br><strong>Excluida de estadísticas</strong>' : '');
      const total = escapeHtml(order.total ?? '');
      const currency = escapeHtml(order.currency || '');
      if (order.shippingCarrier) {
        trackingBits.push(`Transportista: ${escapeHtml(order.shippingCarrier)}`);
      }
      if (order.trackingNumber) {
        trackingBits.push(`Seguimiento: ${escapeHtml(order.trackingNumber)}`);
      }
      if (order.trackingNumber && trackingUrl) {
        trackingBits.push(
          `<a href=\"${escapeHtml(trackingUrl)}\" target=\"_blank\" rel=\"noopener noreferrer\" referrerpolicy=\"no-referrer\">Ver seguimiento</a>`,
        );
      }
      if (order.shippedAt) {
        trackingBits.push(`Enviado el: ${escapeHtml(formatDate(order.shippedAt))}`);
      }
      if (order.deliveredAt) {
        trackingBits.push(`Entregado el: ${escapeHtml(formatDate(order.deliveredAt))}`);
      }
      if (!order.trackingNumber) {
        const method = String(order.shippingMethodCode || '').toUpperCase();
        const fallback = order.status === 'CANCELLED' ? 'Pedido cancelado'
          : order.status === 'REFUNDED' ? 'Pedido reembolsado'
          : ['LOCAL_PICKUP', 'PICKUP'].includes(method) ? 'Recogida local'
          : order.shippingRequired === false ? 'Sin envío'
          : order.status === 'DELIVERED' ? 'Entregado; sin número de seguimiento'
          : order.status === 'SHIPPED' ? 'Enviado; seguimiento no disponible'
          : 'Pendiente de enviar';
        trackingBits.unshift(escapeHtml(fallback));
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Pedido">#${orderId}</td>
        <td data-label="Fecha">${createdAt}</td>
        <td data-label="Estado">${orderStatus}</td>
        <td data-label="Seguimiento">${trackingBits.join('<br>')}</td>
        <td data-label="Total">${total} ${currency}</td>
      `;
      ordersBody.appendChild(tr);
    });
  };

  const fillAccount = (user) => {
    if (!user) return;
    const { firstName, lastName, email } = user;
    if ($('firstName')) $('firstName').value = firstName || '';
    if ($('lastName')) $('lastName').value = lastName || '';
    // Keep historical names intact. Changes still use 25/30 in the submit
    // validation; maxlength must not prevent retaining an existing long value.
    if ($('firstName')) $('firstName').maxLength = Math.max(25, (firstName || '').length);
    if ($('lastName')) $('lastName').maxLength = Math.max(30, (lastName || '').length);
    if ($('email')) $('email').value = email || '';
  };

  const fillAccreditation = (user) => {
    const fullName = buildDisplayName(user) || 'Miembro CRONOX';
    const normalizedCircle = applyCircleLevel(user?.circleLevel);
    if (accreditationName) accreditationName.textContent = formatAccreditationName(fullName);
    if (accreditationCircle) accreditationCircle.textContent = `Círculo ${toRomanNumeral(normalizedCircle)}`;
    if (accreditationCode) accreditationCode.textContent = `ID: ${window.CRONOX_USER_IDENTITY.format(user)}`;
  };

  const renderAccreditationPrivileges = (circleLevel, list = accreditationPrivilegesList) => {
    if (!list) return;
    const normalized = getNormalizedCircleLevel(circleLevel, NaN);
    const privileges =
      Number.isInteger(normalized) && normalized >= 1 && normalized <= 5
        ? ACCREDITATION_PRIVILEGES[normalized]
        : null;
    const items = Array.isArray(privileges) && privileges.length ? privileges : ['Privilegios no disponibles.'];

    list.replaceChildren();
    items.forEach((text) => {
      const li = document.createElement('li');
      li.className = 'accreditation-privileges__item';
      li.textContent = text;
      list.appendChild(li);
    });
  };

  // Both presentations consume the book's complete, authenticated stats response.
  const getAccreditationCounts = (stats) => ({
    orders: typeof stats?.pedidosRealizados === 'number' ? stats.pedidosRealizados : stats?.ordersCount,
    items: typeof stats?.articulosAdquiridos === 'number' ? stats.articulosAdquiridos : stats?.itemsNetCount,
    products: typeof stats?.productosDiferentes === 'number' ? stats.productosDiferentes : stats?.distinctProductsCount,
  });

  const isMetacrilatos = () => accreditationSection?.dataset.accreditationRenderer === 'metacrilatos-v1';

  const setMetacrilatosHistory = (state, counts) => presentation?.history(metacrilatosMember, state, counts);

  const resetMetacrilatosMember = () => {
    accreditationStatsSequence++;
    if (!metacrilatosMember) return;
    metacrilatosMember.hidden = true;
    delete metacrilatosMember.dataset.circleLevel;
    metacrilatosMember.querySelector('[data-meta-circle]').textContent = '';
    metacrilatosMember.querySelector('[data-meta-privileges]').replaceChildren();
    metacrilatosMember.querySelectorAll('[data-meta-circle-marker]').forEach(marker => marker.removeAttribute('aria-current'));
    setMetacrilatosHistory('loading');
  };

  const showMetacrilatosMember = () => {
    if (!metacrilatosMember) return;
    // This is the validated /me/accreditation circle used by the mounted renderer,
    // never a cached profile or a possibly older statistics response.
    const circle = Number(accreditationSection.querySelector('.metacrilatos-host')?.dataset.crxLevel);
    if (!Number.isInteger(circle) || circle < 1 || circle > 5) return;
    presentation.circle(metacrilatosMember, circle);
    setMetacrilatosHistory('loading');
    metacrilatosMember.hidden = false;
  };

  const fillAccreditationStats = (stats) => {
    const circleLevelRaw = stats?.circleLevel ?? window.CRONOX_USER?.circleLevel;
    const circleLevel = getNormalizedCircleLevel(circleLevelRaw, 1);
    const createdAt = stats?.createdAt ?? window.CRONOX_USER?.createdAt;
    const { orders: ordersCount, items: itemsNetCount, products: distinctProductsCount } = getAccreditationCounts(stats);

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

    if (accreditationStatProducts) {
      accreditationStatProducts.textContent =
        typeof distinctProductsCount === 'number' && Number.isFinite(distinctProductsCount)
          ? distinctProductsCount
          : '—';
    }

    renderAccreditationPrivileges(circleLevelRaw);
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
    img.sizes = '196px';
    img.srcset = 'assets/CRONOX-preloader-320.webp 320w, assets/CRONOX-preloader-640.webp 640w';
    img.src = 'assets/CRONOX-preloader-640.webp';
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
    // Selecting the initial Orders tab hides the loader. Do not download its
    // animation until an operation actually needs to display it.
    const loader = isVisible ? ensureGlobalLoader()
      : (globalLoader?.isConnected ? globalLoader : document.getElementById('preloader'));
    if (loader) {
      loader.hidden = !isVisible;
      loader.style.display = isVisible ? 'flex' : 'none';
    }
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
      accreditationBook.hidden = !!isLoading || accreditationSection?.dataset.accreditationRenderer === 'metacrilatos-v1';
    }
    setGlobalLoaderVisible(!!isLoading);
    // Resolve the exterior layout in this task, before the loader's removal
    // can paint a frame at the renderer's unscaled base size.
    if (!isLoading) {
      window.CRONOX_ACCREDITATION_LAYOUT?.refresh();
      window.CRONOX_METACRILATOS_FIT?.refresh();
      schedulePromotionCountdown();
    }
  };

  const waitForImageLoad = (img) =>
    new Promise((resolve) => {
      if (!img) return resolve(false);
      if (img.complete) {
        resolve(img.naturalWidth > 0);
        return;
      }
      const onLoad = () => resolve(true);
      const onError = () => resolve(false);
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });
    });

  const retryImage = async (img) => {
    if (!img?.src) return false;
    const retryUrl = new URL(img.src, window.location.href);
    retryUrl.searchParams.set('crx_retry', Date.now().toString());
    img.src = retryUrl.href;
    return waitForImageLoad(img);
  };

  const ensureAccreditationBook = async () => {
    if (!accreditationBookArt) return false;
    const loaded = await waitForImageLoad(accreditationBookArt);
    if (loaded) return true;
    return retryImage(accreditationBookArt);
  };

  const ensureAccreditationQr = async () => {
    const current = accreditationContext();
    if (!accreditationQr) return false;
    if (!accreditationQrLoaded || accreditationQr.naturalWidth === 0) {
      const base = typeof window.CRONOX_API_BASE === 'string' ? window.CRONOX_API_BASE : '';
      accreditationQr.src = `${base}/api/membership/me/qr`;
    }
    let loaded = await waitForImageLoad(accreditationQr);
    if (!current()) return false;
    if (!loaded) loaded = await retryImage(accreditationQr);
    if (!current()) return false;
    accreditationQrLoaded = loaded;
    return loaded;
  };

  const readAccreditationData = read => typeof read !== 'function' ? null
    : Promise.resolve().then(() => read({ signal: AbortSignal.timeout(15000) })).then(
      data => ({ ok: true, data, receivedAt: performance.now() }),
      error => ({ ok: false, error }),
    );

  const loadAccreditationData = async () => {
    const attempt = ++accreditationLoadSequence;
    const promotionReference = document.querySelector('[data-promotion-size-reference]');
    if (promotionReference) {
      delete promotionReference.dataset.ready;
      promotionReference.hidden = true;
    }
    resetMetacrilatosMember();
    setAccreditationLoading(true);
    // These are fresh authorized reads for this opening, never a persistent
    // cache. Settle them while the design, identity and artwork are loading.
    let pendingStats = readAccreditationData(api.getAccreditationStats);
    // Stats applies any due requested promotion before reading its circle.
    // The III status must follow that result, or it could still observe II.
    // If stats fails, the existing loader reads III status after the design.
    let pendingUpgrade = pendingStats?.then(result => result.ok && attempt === accreditationLoadSequence
      ? readAccreditationData(api.getCircleUpgradeStatus) : null);
    try {
      const design = await window.CRONOX_ACCREDITATION_DESIGNS.loadActive(accreditationSection);
      if (attempt !== accreditationLoadSequence || !design) return;
      if (design.renderer === 'metacrilatos-v1') {
        showMetacrilatosMember();
        // The personal-card read can cross a scheduled promotion after the
        // early reads completed. Revalidate that exceptional mismatch before
        // exposing controls; retain the parallel results for the usual case.
        const mountedCircle = Number(accreditationSection.querySelector('.metacrilatos-host')?.dataset.crxLevel);
        const earlyResults = await Promise.all([pendingStats, pendingUpgrade]);
        if (attempt !== accreditationLoadSequence) return;
        if (mountedCircle >= 1 && mountedCircle <= 5 && earlyResults.some(result =>
          result?.ok && Number.isInteger(result.data?.circleLevel) && result.data.circleLevel !== mountedCircle)) {
          pendingStats = readAccreditationData(api.getAccreditationStats);
          pendingUpgrade = pendingStats?.then(result => result.ok && attempt === accreditationLoadSequence
            ? readAccreditationData(api.getCircleUpgradeStatus) : null);
        }
        // History's loading message and the promotion controls change the
        // composition height used by the viewport fit. Settle their first
        // presentation before revealing the card, without a timed delay.
        // Later history retries still leave the existing instance interactive.
        await Promise.all([
          loadAccreditationStats({ force: true, pending: pendingStats }),
          loadCircleUpgradeStatus({ skipLoader: true, pending: pendingUpgrade, signal: AbortSignal.timeout(15000) }),
        ]);
        if (attempt === accreditationLoadSequence) setAccreditationLoading(false);
        return;
      }
    } catch (error) {
      if (attempt !== accreditationLoadSequence) return;
      window.CRONOX_ACCREDITATION_DESIGNS.destroy(accreditationSection);
      setAccreditationLoading(false);
      if (accreditationBook) accreditationBook.hidden = true;
      showProfileMessage(error.message, 'error');
      return;
    }
    window.CRONOX_PROMOTION_STATUS = 'loading';
    circleUpgradeStatusLoaded = false;
    circleUpgradeStatusLoading = true;
    const normalizedUserCircle = getNormalizedCircleLevel(window.CRONOX_USER?.circleLevel, window.CRONOX_USER?.circleLevel);
    fillAccreditation({ ...(window.CRONOX_USER || {}), circleLevel: normalizedUserCircle });
    renderAccreditationPrivileges(normalizedUserCircle);
    updatePromotionUi({
      circleLevel: normalizedUserCircle,
      promotionRequestStatus: 'loading',
    });
    renderCircleUpgradeUi({
      circleLevel: normalizedUserCircle,
    });

    try {
      await Promise.all([
        loadAccreditationStats({ force: true, pending: pendingStats }),
        ensureAccreditationBook(),
        ensureAccreditationQr(),
        document.fonts?.ready,
        loadCircleUpgradeStatus({ skipLoader: true, pending: pendingUpgrade, signal: AbortSignal.timeout(15000) }),
      ]);
    } finally {
      if (attempt === accreditationLoadSequence) setAccreditationLoading(false);
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
    if ($('addrCountry')) {
      $('addrCountry').value = normalizeCountry(address.country) || SPAIN;
    }
  };

  const handleAuthRedirect = (err) => {
    if (err?.status === 401 || err?.status === 403) {
      try { localStorage.setItem('cronox_open_auth_on_load', 'login'); } catch (_) {}
      window.location.href = '/';
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

  const syncPromotionContainer = () => {
    const container = document.querySelector('[data-accreditation-promotions]');
    if (!container) return;
    const visible = [...container.querySelectorAll('.accreditation-promotion-flow')].some(flow => !flow.hidden);
    container.hidden = !visible;
    accreditationSection?.classList.toggle('has-accreditation-promotion', visible);
    const retry = container.querySelector('[data-promotion-retry]');
    if (retry) retry.hidden = !visible || !(
      (displayedCircle() === 2 && circlePromotionStatus?.error) ||
      (displayedCircle() === 3 && circleUpgradeStatus?.error));
  };

  const renderPromotionFlow = ({ root, button, statusElement, cooldownElement, visible, status, loading, submitting, pending }) => {
    if (root) root.hidden = !visible;
    const remaining = promotionRemaining(status);
    const allowed = status?.canRequest === true && remaining <= 0 && !loading && !submitting && !pending && !status?.error;
    if (button) {
      button.hidden = !visible;
      button.disabled = !visible || !allowed;
      button.classList.remove('hidden');
      if (button.disabled && document.activeElement === button) button.blur();
    }
    let message = '';
    if (pending) message = 'Solicitud pendiente';
    else if (submitting) message = 'Enviando solicitud…';
    else if (status?.error) message = 'No se pudo comprobar la disponibilidad del ascenso.';
    else if (status?.blockedReason === 'promotion_date_unknown') message = 'La fecha de tu ascenso está pendiente de revisión.';
    else if (loading || (!allowed && remaining <= 0 && status?.eligibleAt)) message = 'Comprobando disponibilidad…';
    else if (!allowed && remaining <= 0) message = 'Solicitud no disponible por el momento.';
    if (statusElement) {
      statusElement.hidden = !visible || !message;
      statusElement.textContent = message;
      statusElement.classList.remove('hidden');
    }
    if (cooldownElement) {
      const show = visible && remaining > 0 && !pending && !submitting && !status?.error;
      cooldownElement.hidden = !show;
      cooldownElement.textContent = show ? formatCooldownMessage(remaining) : '';
      cooldownElement.classList.remove('hidden');
    }
    syncPromotionContainer();
  };

  const updatePromotionUi = ({ circleLevel, promotionRequestStatus } = {}) => {
    const requestState = promotionRequestStatus || window.CRONOX_PROMOTION_STATUS || 'none';
    window.CRONOX_PROMOTION_STATUS = requestState;
    renderPromotionFlow({
      root: document.querySelector('[data-circle-request-cta]'), button: getCircleRequestBtn(),
      statusElement: getCircleRequestStatusEl(), cooldownElement: document.querySelector('[data-circle-request-cooldown]'),
      visible: displayedCircle(circleLevel) === 2, status: circlePromotionStatus,
      loading: circlePromotionLoading, submitting: circlePromotionSubmitting,
      pending: circlePromotionStatus?.hasPending || requestState === 'pending',
    });
  };

  const renderCircleUpgradeUi = (status = circleUpgradeStatus) => {
    const level = displayedCircle(status?.circleLevel ?? window.CRONOX_ACCREDITATION_STATS?.circleLevel);
    const latest = String(status?.latestRequest?.status || status?.status || '').toUpperCase();
    const approved = status?.hasApproved || latest === 'APPROVED';
    const visible = level === 3 && !approved;
    // The former III CTA contributed to the approved card's fit. Capture its
    // original layout once per presentation; countdown updates must never
    // rescale the artwork, QR or identity as the real exterior action changes.
    const reference = document.querySelector('[data-promotion-size-reference]');
    if (reference && !reference.dataset.ready && !circleUpgradeStatusLoading && status) {
      reference.dataset.ready = 'true';
      reference.hidden = !visible;
      const days = Number(status.cooldownDaysRemaining ?? status.cooldownDays ?? 0);
      const pending = status.hasPending || ['PENDING', 'REQUESTED', 'SENT'].includes(latest);
      const denied = ['DENIED', 'REJECTED'].includes(latest);
      reference.querySelector('button').hidden = !visible || pending || !status.canRequest || (denied && days > 0);
      reference.querySelector('[data-size-reference-pending]').hidden = !visible || !pending;
      const cooldown = reference.querySelector('[data-size-reference-cooldown]');
      cooldown.hidden = !visible || !denied || days <= 0;
      cooldown.textContent = `Ya has enviado una solicitud recientemente. Podrás volver a solicitar el ascenso en ${days} día${days === 1 ? '' : 's'}.`;
    }
    renderPromotionFlow({
      root: getCircleUpgradeCta(), button: getCircleUpgradeBtn(), statusElement: getCircleUpgradeStatusEl(),
      cooldownElement: getCircleUpgradeCooldownEl(), visible, status,
      loading: circleUpgradeStatusLoading, submitting: circleUpgradeSubmitting,
      pending: status?.hasPending || ['PENDING', 'REQUESTED', 'SENT'].includes(latest),
    });
    if (!visible) { hideCircleUpgradeModal(); hideCircleUpgradeSuccessModal(); }
  };

  const promotionViewActive = () => accreditationSection?.classList.contains('is-active') && !document.hidden;
  const schedulePromotionCountdown = () => {
    window.clearTimeout(promotionTimer);
    promotionTimer = 0;
    if (!promotionViewActive() || accreditationSection.classList.contains('is-loading')) return;
    const status = displayedCircle() === 2 ? circlePromotionStatus : displayedCircle() === 3 ? circleUpgradeStatus : null;
    if (!status || status.hasPending || status.hasApproved || status.error || !status.eligibleAt) return;
    if (status.blockedReason && status.blockedReason !== 'cooldown') return;
    if (displayedCircle() === 3 && Number(status.circleLevel) !== 3) return;
    const remaining = promotionRemaining(status);
    if (remaining <= 0) {
      if (!status.canRequest && !status.expiryChecked && !promotionRefreshPromise) {
        status.expiryChecked = true;
        void refreshPromotionEligibility();
      }
      return;
    }
    promotionTimer = window.setTimeout(() => {
      updatePromotionUi();
      renderCircleUpgradeUi();
      schedulePromotionCountdown();
    }, Math.max(250, Math.min(60000, remaining % 60000 || 60000)));
  };

  const refreshPromotionEligibility = () => {
    if (promotionRefreshPromise) return promotionRefreshPromise;
    if (!promotionViewActive() || accreditationSection.classList.contains('is-loading')) return Promise.resolve();
    const current = accreditationContext();
    const signal = AbortSignal.timeout(15000);
    const refresh = Promise.all([
      loadAccreditationStats({ force: true, signal, preserveHistory: true }),
      loadCircleUpgradeStatus({ skipLoader: true, signal }),
    ]).finally(() => {
      if (promotionRefreshPromise === refresh) promotionRefreshPromise = null;
      if (!current()) return;
      updatePromotionUi();
      renderCircleUpgradeUi();
      schedulePromotionCountdown();
    });
    promotionRefreshPromise = refresh;
    return refresh;
  };

  const setCircleUpgradeState = (status, receivedAt) => {
    circleUpgradeStatus = clockedPromotionStatus(status, receivedAt) || null;
    lastCircleUpgradeRequestId = status?.latestRequest?.id || null;
    renderCircleUpgradeUi(circleUpgradeStatus);
  };

  const loadCircleUpgradeStatus = async ({ skipLoader = false, signal, pending } = {}) => {
    const current = accreditationContext();
    if (!api.getCircleUpgradeStatus) {
      circleUpgradeStatusLoading = false;
      renderCircleUpgradeUi(circleUpgradeStatus);
      return null;
    }
    try {
      circleUpgradeStatusLoading = true;
      renderCircleUpgradeUi(circleUpgradeStatus);
      if (!skipLoader) setAccreditationLoading(true);
      const early = pending ? await pending : null;
      if (!current()) return null;
      if (early && !early.ok) throw early.error;
      const status = early ? early.data : await api.getCircleUpgradeStatus({ signal });
      if (!current()) return null;
      circleUpgradeStatusLoaded = true;
      setCircleUpgradeState(status, early?.receivedAt);
      return status;
    } catch (err) {
      if (!current()) return null;
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
        canRequest: false,
        latestRequest: { status: 'ERROR' },
        error: true,
      });
      showProfileMessage('No se pudo cargar el estado de tu solicitud de Círculo 4.', 'error');
      return null;
    } finally {
      if (current()) {
        circleUpgradeStatusLoading = false;
        renderCircleUpgradeUi(circleUpgradeStatus);
        schedulePromotionCountdown();
        if (!skipLoader) setAccreditationLoading(false);
      }
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
    const eligible = circleLevel === 3 && circleUpgradeStatus?.canRequest === true
      && promotionRemaining(circleUpgradeStatus) <= 0 && !circleUpgradeStatusLoading
      && !hasPending && !hasApprovedRequest && !circleUpgradeSubmitting;

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

  const loadAccreditationStats = async ({ force = false, signal, preserveHistory = false, pending } = {}) => {
    const context = accreditationContext();
    const attempt = ++accreditationStatsSequence;
    const current = () => context() && attempt === accreditationStatsSequence;
    const memberHistory = isMetacrilatos();
    circlePromotionLoading = true;
    updatePromotionUi();
    if (memberHistory && !preserveHistory) setMetacrilatosHistory('loading');
    if (!api.getAccreditationStats) {
      const normalizedCircle = getNormalizedCircleLevel(window.CRONOX_USER?.circleLevel, window.CRONOX_USER?.circleLevel);
      fillAccreditationStats({ circleLevel: normalizedCircle });
      updatePromotionUi({ circleLevel: normalizedCircle });
      renderCircleUpgradeUi(circleUpgradeStatus || { circleLevel: normalizedCircle });
      if (memberHistory) setMetacrilatosHistory('error');
      circlePromotionLoading = false;
      circlePromotionStatus = { error: true, canRequest: false };
      updatePromotionUi();
      return;
    }

    if (!force && !memberHistory && accreditationStatsLoaded && window.CRONOX_ACCREDITATION_STATS) {
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
      // Re-entering accreditation must revalidate eligibility with server time.
      circlePromotionLoading = false;
      updatePromotionUi();
      void refreshPromotionEligibility();
      return;
    }

    try {
      const early = pending ? await pending : null;
      if (early && !early.ok) throw early.error;
      const stats = early ? early.data : await api.getAccreditationStats({ signal });
      if (!current()) return;
      circlePromotionStatus = clockedPromotionStatus(stats?.promotion, early?.receivedAt) || { canRequest: false, error: true };
      if (memberHistory) {
        const counts = getAccreditationCounts(stats);
        if (!Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error('Respuesta de historial incompleta');
        }
        setMetacrilatosHistory('ready', counts);
      }
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
      if (!current()) return;
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudieron cargar las estadísticas de acreditación', err);
      accreditationStatsLoaded = false;
      circlePromotionStatus = { error: true, canRequest: false };
      if (memberHistory && !preserveHistory) setMetacrilatosHistory('error');
      else if (!preserveHistory) showProfileMessage('No se pudieron cargar tus datos de acreditación.', 'error');
    } finally {
      if (current()) {
        circlePromotionLoading = false;
        updatePromotionUi();
        schedulePromotionCountdown();
      }
    }
  };

  const normalizeFavoriteProduct = (favorite) => {
    const product = favorite?.product || favorite || {};
    const images = Array.isArray(product.images)
      ? product.images
          .map((img) => (typeof img === 'string' ? img : img?.url || img?.imageUrl || img?.image))
          .map((image) => safeProductImage(image, ''))
          .filter(Boolean)
      : [];

    const priceInCents = normalizeCentsValue(
      product.price ?? product.priceCents ?? product.price_in_cents ?? product.priceInCents ?? 0
    );
    const priceLabel = formatPriceFromCents(priceInCents);
    const imageList = images.length
      ? images
      : product.image
        ? [safeProductImage(product.image, '')].filter(Boolean)
        : [];

    return {
      id: product.id ?? favorite?.id ?? favorite?.productId,
      backendId: product.backendId ?? product.id ?? favorite?.productId,
      variants: product.variants,
      lastUnitsThreshold: product.lastUnitsThreshold ?? null,
      slug: product.slug,
      name: product.name || 'Producto',
      priceInCents,
      priceLabel,
      price: priceInCents / 100,
      image: safeProductImage(product.imageUrl || product.image || images[0], ''),
      images: imageList,
      imageRecords: product.imageRecords || product.galleryImages || (Array.isArray(product.images) ? product.images : []),
    };
  };

  const updateFavoritesState = ({ loading = false, empty = false } = {}) => {
    if (favoritesLoading) favoritesLoading.hidden = !loading;
    if (favoritesEmpty) favoritesEmpty.hidden = !empty;
    if (favoritesList) favoritesList.hidden = loading || empty;
  };

  const renderFavorites = (favorites) => {
    if (!favoritesGrid) return;
    favoritesGrid.innerHTML = '';

    if (!Array.isArray(favorites) || !favorites.length) {
      updateFavoritesState({ loading: false, empty: true });
      return;
    }

    const cardBuilder = window.CRONOX_createProductCard;
    if (typeof cardBuilder !== 'function') {
      updateFavoritesState({ loading: false, empty: true });
      return;
    }

    const frag = document.createDocumentFragment();
    favorites.forEach((fav) => {
      const card = cardBuilder(fav);
      if (card) {
        card.querySelectorAll('img.product-img').forEach((image) => {
        });
        frag.appendChild(card);
      }
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
      if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.setIdsFromServer === 'function') {
        window.CRONOX_FAVORITES.setIdsFromServer(mapped);
      } else if (typeof window.CRONOX_setFavoriteIds === 'function') {
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
      refreshPasswordState(normalizedUser);
      fillAccreditation(normalizedUser);
      renderAccreditationPrivileges(normalizedUserCircle);
      await Promise.all([loadAddress(), loadOrders()]);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar el perfil', err);
      showProfileMessage('No se pudo cargar tu perfil. Inténtalo de nuevo más tarde.', 'error');
    }
  };

  let hasPassword = false;
  const refreshPasswordState = (user) => {
    hasPassword = Boolean(user.hasPassword);
    if (!$('passwordStatus')) return;
    $('passwordStatus').textContent = hasPassword ? 'Contrase\u00f1a establecida' : 'Sin contrase\u00f1a establecida';
    $('passwordAction').textContent = hasPassword ? 'Cambiar contrase\u00f1a' : 'Establecer contrase\u00f1a';
    $('passwordAction').disabled = false;
    $('currentPasswordLabel').hidden = !hasPassword;
    $('currentPassword').required = hasPassword;
  };
  const bindPasswordForm = () => {
    const form = $('passwordForm');
    if (!form) return;
    let saving = false;
    $('passwordAction').addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) $('newPassword').focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      const newPassword = $('newPassword').value;
      const message = $('passwordMessage');
      if (Array.from(newPassword).length < 7 || new TextEncoder().encode(newPassword).length > 72) {
        message.textContent = 'La contrase\u00f1a debe tener al menos 7 caracteres y no superar 72 bytes UTF-8.';
        return;
      }
      if (newPassword !== $('confirmPassword').value) {
        message.textContent = 'Las contrase\u00f1as no coinciden.';
        return;
      }
      saving = true;
      $('savePassword').disabled = true;
      $('passwordAction').disabled = true;
      try {
        await api.changePassword({ newPassword, ...(hasPassword ? { currentPassword: $('currentPassword').value } : {}) });
        window.CRONOX_USER.hasPassword = true;
        refreshPasswordState(window.CRONOX_USER);
        form.reset();
        form.hidden = true;
        message.textContent = 'Contrase\u00f1a guardada correctamente.';
      } catch (err) {
        message.textContent = err?.payload?.message || err?.message || 'No se pudo guardar la contrase\u00f1a. Int\u00e9ntalo de nuevo.';
      } finally {
        saving = false;
        $('savePassword').disabled = false;
        $('passwordAction').disabled = false;
      }
    });
  };

  const bindAccountForm = () => {
    const form = $('accountForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!api.updateMe) return;
      const firstName = optionalValue('firstName');
      const lastName = optionalValue('lastName');
      const previousFirst = window.CRONOX_USER?.firstName || undefined;
      const previousLast = window.CRONOX_USER?.lastName || undefined;
      if ((firstName !== previousFirst && firstName?.length > 25) ||
        (lastName !== previousLast && lastName?.length > 30)) {
        showProfileMessage('El nombre admite como máximo 25 caracteres y el apellido 30.', 'error');
        return;
      }

      const invalidName =
        (firstName !== previousFirst && firstName && !NAME_REGEX.test(firstName)) ||
        (lastName !== previousLast && lastName && !NAME_REGEX.test(lastName));

      if (invalidName) {
        showProfileMessage('El nombre y el apellido solo pueden contener letras y espacios.', 'error');
        return;
      }

      const payload = {
        ...(firstName !== previousFirst ? { firstName } : {}),
        ...(lastName !== previousLast ? { lastName } : {}),
      };
      try {
        const updated = await api.updateMe(payload);
        const normalizedUserCircle = getNormalizedCircleLevel(updated?.circleLevel, updated?.circleLevel);
        const normalizedUpdated = { ...updated, circleLevel: normalizedUserCircle };
        window.CRONOX_USER = normalizedUpdated;
        fillAccount(normalizedUpdated);
        refreshPasswordState(normalizedUpdated);
        fillAccreditation(normalizedUpdated);
        renderAccreditationPrivileges(normalizedUserCircle);
        showProfileMessage('Datos actualizados correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar cuenta', err);
        const msg = err?.payload?.message || err?.message || 'No se pudieron guardar los cambios.';
        showProfileMessage(msg, 'error');
      }
    });
  };

  const bindEmailChange = () => {
    const form = $('emailChangeForm');
    if (!form || !api.emailChangeStatus) return;
    const status = $('emailChangeStatus');
    let pending = false;
    const render = (data) => {
      const messages = {
        NONE: 'No hay un cambio pendiente.',
        PENDING_CURRENT: 'Falta autorizar el cambio desde tu email actual.',
        PENDING_NEW: 'Cambio autorizado. Falta verificar el nuevo email.',
        CANCELLED: 'Solicitud cancelada. Tu email actual se conserva.',
        EXPIRED: 'Solicitud caducada. Puedes iniciar una nueva.',
        COMPLETE: 'Email cambiado. Inicia sesión de nuevo con tu nuevo email.',
      };
      status.textContent = (messages[data.stage] || 'Consulta el estado de tu solicitud.') +
        (['PENDING_CURRENT', 'PENDING_NEW'].includes(data.stage) ? ` Nueva dirección: ${data.newEmail}.` : '') +
        (['FAILED', 'UNKNOWN', 'SENDING'].includes(data.delivery) && ['PENDING_CURRENT', 'PENDING_NEW'].includes(data.stage)
          ? ' No se ha confirmado la entrega; revisa el buzón y puedes reenviar el correo después de un minuto.' : '');
      $('emailChangeActions').hidden = !['PENDING_CURRENT', 'PENDING_NEW'].includes(data.stage);
      $('emailChangeResend').disabled = !data.canResend || Date.now() < new Date(data.resendAt).getTime();
    };
    const run = async (action) => {
      if (pending) return;
      pending = true;
      form.querySelector('button').disabled = true;
      try { render(await action()); }
      catch (error) {
        if (handleAuthRedirect(error)) return;
        status.textContent = error?.payload?.message || 'No hemos podido completar la operación. Actualiza el estado y vuelve a intentarlo.';
        $('emailChangeActions').hidden = false;
        $('emailChangeResend').disabled = false;
      } finally { pending = false; form.querySelector('button').disabled = false; }
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      run(() => api.requestEmailChange($('emailChangeAddress').value.trim()));
    });
    $('emailChangeRefresh').addEventListener('click', () => run(() => api.emailChangeStatus()));
    $('emailChangeResend').addEventListener('click', () => run(() => api.resendEmailChange()));
    $('emailChangeCancel').addEventListener('click', () => run(() => api.cancelEmailChange()));
    run(() => api.emailChangeStatus());
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
        country: normalizeCountry(requiredValue('addrCountry')) || SPAIN,
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
    stopAccreditation();
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
        showProfileMessage('No se ha podido cerrar la sesión. Inténtalo de nuevo.', 'error');
        return;
      }
    }
    try {
      if (api.logout) await api.logout();
    } catch (err) {
      showProfileMessage('No se ha podido cerrar la sesión. Inténtalo de nuevo.', 'error');
      return;
    }
    try {
      const key = window.CRONOX_NEWSLETTER_VISIT?.SESSION_KEY || 'cronoxNewsletterShown';
      const shown = sessionStorage.getItem(key) === 'true';
      sessionStorage.clear();
      if (shown) sessionStorage.setItem(key, 'true');
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
      if (target !== 'accreditation') {
        stopAccreditation();
        setAccreditationLoading(false);
      }
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
        window.location.href = '/';
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
        if (!api.requestCircleUpgrade || circleUpgradeSubmitting || btn?.disabled
          || circleUpgradeStatus?.canRequest !== true || promotionRemaining(circleUpgradeStatus) > 0) return;
        const socialNetwork = (socialField?.value || '').trim();
        const username = safeTrim(usernameField?.value || '');

        if (!socialNetwork || !username) {
          showProfileMessage('Selecciona una red social e introduce tu usuario.', 'error');
          return;
        }

        circleUpgradeSubmitting = true;
        if (submitBtn) submitBtn.disabled = true;
        setAccreditationLoading(true);
        try {
          const request = await api.requestCircleUpgrade({ socialNetwork, username });
          form.reset();
          hideCircleUpgradeModal();
          circleUpgradeStatusLoading = true;
          const optimisticStatus = {
            ...(circleUpgradeStatus || {}),
            circleLevel:
              getNormalizedCircleLevel(circleUpgradeStatus?.circleLevel, NaN) ||
              getNormalizedCircleLevel(window.CRONOX_ACCREDITATION_STATS?.circleLevel ?? window.CRONOX_USER?.circleLevel, 3),
            hasPending: true,
            latestRequest: { ...(circleUpgradeStatus?.latestRequest || {}), status: 'PENDING' },
          };
          setCircleUpgradeState(optimisticStatus);
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
          circleUpgradeSubmitting = false;
          if (submitBtn) submitBtn.disabled = false;
          setAccreditationLoading(false);
          renderCircleUpgradeUi();
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
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!api.requestCirclePromotion || btn.disabled || btn.hidden || circlePromotionSubmitting
          || circlePromotionStatus?.canRequest !== true || promotionRemaining(circlePromotionStatus) > 0) return;
        circlePromotionSubmitting = true;
        updatePromotionUi();
        const current = accreditationContext();
        try {
          const response = await api.requestCirclePromotion();
          if (!current()) return;
          const promotionStatus = response?.status || 'pending';
          circlePromotionStatus = { ...circlePromotionStatus, canRequest: false, hasPending: true };
          window.CRONOX_PROMOTION_STATUS = promotionStatus;
          updatePromotionUi({ promotionRequestStatus: promotionStatus });
          // Only show the confirmation after the server accepted the request.
          showCircleRequestModal();
          try { localStorage.setItem('cronox_circle_request_updated', JSON.stringify({ userId: window.CRONOX_USER?.id, nonce: Math.random() })); } catch {}
        } catch (err) {
          if (!current() || handleAuthRedirect(err)) return;
          const msg = err?.payload?.message || err?.message || 'No se pudo solicitar el ascenso.';
          showProfileMessage(msg, 'error');
          // A second tab may already have submitted, or eligibility may have
          // changed. Restore only the server-confirmed state after a failure.
          await refreshPromotionEligibility();
        } finally {
          circlePromotionSubmitting = false;
          if (current()) updatePromotionUi();
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
    bindEmailChange();
    bindPasswordForm();
    bindAddressForm();
    bindCircleUpgrade();
    bindCirclePromotion();
    document.querySelector('[data-promotion-retry]')?.addEventListener('click', () => { void refreshPromotionEligibility(); });
    const resumePromotions = () => {
      if (promotionViewActive()) void refreshPromotionEligibility();
      else window.clearTimeout(promotionTimer);
    };
    window.addEventListener('focus', resumePromotions);
    window.addEventListener('pageshow', resumePromotions);
    document.addEventListener('visibilitychange', resumePromotions);
    window.addEventListener('storage', event => {
      if (event.key !== 'cronox_circle_request_updated') return;
      try { if (JSON.parse(event.newValue)?.userId === window.CRONOX_USER?.id) resumePromotions(); } catch {}
    });
    metacrilatosRetry?.addEventListener('click', () => {
      if (isMetacrilatos() && !metacrilatosMember.hidden && metacrilatosHistory?.dataset.state === 'error') {
        loadAccreditationStats({ force: true });
      }
    });
    bindTabs();
    bindBackLinks();
    loadProfile();
  });
})();
