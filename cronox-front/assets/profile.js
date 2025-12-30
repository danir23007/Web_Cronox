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
  const accreditationName = document.querySelector('.accreditation-name');
  const accreditationCode = document.querySelector('.accreditation-id');
  const accreditationCircle = document.querySelector('.accreditation-circle');
  const accreditationSymbol = document.querySelector('[data-accreditation-rings]');
  const accreditationQr = $('cronox-member-qr');

  let favoritesLoaded = false;
  let accreditationQrLoaded = false;

  const RING_COLORS = {
    1: ['#000000'],
    2: ['#000000', '#000000'],
    3: ['#000000', '#000000', '#7C7C7C'],
    4: ['#000000', '#000000', '#7C7C7C', '#EDE7DB'],
    5: ['#000000', '#000000', '#7C7C7C', '#EDE7DB', '#B1001A'],
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

    const level = Number(circleLevel);
    const palette = RING_COLORS[level] || RING_COLORS[1];
    const svgNS = 'http://www.w3.org/2000/svg';
    const size = 220;
    const center = size / 2;
    let currentRadius = 84;

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Círculo ${level || 1}`);

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
    const level = Number(circleLevel);
    const normalized = level >= 1 && level <= 5 ? level : 1;

    if (accreditationSymbol) {
      accreditationSymbol.dataset.circleLevel = String(normalized);
    }

    if (accreditationCircle) {
      accreditationCircle.textContent = `Círculo ${normalized}`;
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
    if (accreditationCircle) accreditationCircle.textContent = `Círculo ${normalizedCircle}`;
    if (accreditationCode) accreditationCode.textContent = user?.memberCode ? `ID: ${user.memberCode}` : 'ID: —';
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

  const normalizeFavoriteProduct = (favorite) => {
    const product = favorite?.product || favorite || {};
    const images = Array.isArray(product.images)
      ? product.images.map((img) => (typeof img === 'string' ? img : img?.url || img?.imageUrl || img?.image)).filter(Boolean)
      : [];

    const priceInCents = normalizeCentsValue(product.price ?? product.priceCents ?? product.price_in_cents ?? product.priceInCents ?? 0);
    const priceLabel = formatPriceFromCents(priceInCents);
    const imageList = images.length ? images : (product.image ? [product.image] : []);

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

    const imgs = (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean);
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
        const key = product.slug || product.id || product.backendId;
        window.CRONOX_openQuickAddById(key != null ? String(key) : '');
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

    const cardBuilder = typeof window.CRONOX_buildFavoriteCard === 'function'
      ? window.CRONOX_buildFavoriteCard
      : (typeof window.CRONOX_createProductCard === 'function'
        ? window.CRONOX_createProductCard
        : createFallbackProductCard);

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
      window.CRONOX_USER = user;
      fillAccount(user);
      fillAccreditation(user);
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
      const payload = {
        firstName: optionalValue('firstName'),
        lastName: optionalValue('lastName'),
        email: optionalValue('email'),
      };
      try {
        const updated = await api.updateMe(payload);
        window.CRONOX_USER = updated;
        fillAccount(updated);
        fillAccreditation(updated);
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
      const payload = {
        name: requiredValue('addrName'),
        phone: optionalValue('addrPhone'),
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
    try {
      if (api.logout) await api.logout();
    } catch (err) {
      console.warn('[PROFILE] logout error', err);
    }
    window.CRONOX_USER = null;
    window.location.href = 'index.html';
  };

  const bindTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.profile-tab'));
    const sections = Array.from(document.querySelectorAll('.profile-section'));

    const activate = (target) => {
      tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.profileTab === target));
      sections.forEach((section) => section.classList.toggle('is-active', section.dataset.profileSection === target));

      if (target === 'favorites') loadFavorites();
      if (target === 'accreditation') {
        fillAccreditation(window.CRONOX_USER);
        if (accreditationQr && !accreditationQrLoaded) {
          const base = typeof window.CRONOX_API_BASE === 'string' ? window.CRONOX_API_BASE : '';
          accreditationQr.src = `${base}/api/membership/me/qr`;
          accreditationQrLoaded = true;
        }
      }
    };

    tabs.forEach((tab) => {
      tab.addEventListener('click', async () => {
        const target = tab.dataset.profileTab;
        if (!target) return;
        if (target === 'logout') {
          await handleLogout();
          return;
        }
        activate(target);
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

  document.addEventListener('DOMContentLoaded', () => {
    bindAccountForm();
    bindAddressForm();
    bindTabs();
    bindBackLinks();
    loadProfile();
  });
})();
