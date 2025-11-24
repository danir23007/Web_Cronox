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

  let favoritesLoaded = false;

  const showMessage = (text, type = 'info') => {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.classList.remove('is-error', 'is-success');
    if (type === 'error') messageEl.classList.add('is-error');
    if (type === 'success') messageEl.classList.add('is-success');
    messageEl.style.display = text ? 'block' : 'none';
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

    const priceValue = Number(product.price ?? product.priceCents ?? product.price_in_cents ?? product.priceInCents ?? 0);
    const priceLabel = product.priceLabel
      || (typeof api.formatPrice === 'function' ? api.formatPrice(priceValue) : `${priceValue} €`);

    return {
      id: product.id ?? favorite?.id ?? favorite?.productId,
      backendId: product.backendId ?? product.id ?? favorite?.productId,
      slug: product.slug,
      name: product.name || 'Producto',
      priceLabel,
      image: product.imageUrl || product.image || images[0] || '',
    };
  };

  const updateFavoritesState = ({ loading = false, empty = false } = {}) => {
    if (favoritesLoading) favoritesLoading.hidden = !loading;
    if (favoritesEmpty) favoritesEmpty.hidden = !empty;
    if (favoritesList) favoritesList.hidden = loading || empty;
  };

  const createFavoriteCard = (product) => {
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

    const img = document.createElement('img');
    img.className = 'product-img active';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = product.name || 'Producto';
    img.src = product.image || 'assets/logo_banner.png';

    const favBtn = document.createElement('button');
    favBtn.className = 'favorite-toggle';
    favBtn.type = 'button';
    favBtn.setAttribute('aria-label', 'Marcar como favorito');
    favBtn.dataset.productId = String(product.backendId ?? product.id ?? '');
    favBtn.dataset.slug = product.slug || '';
    favBtn.innerHTML = window.CRONOX_STAR_ICON || '<span class="icon-star"></span>';

    media.appendChild(img);
    media.appendChild(favBtn);

    const nameEl = document.createElement('span');
    nameEl.className = 'product-name';
    nameEl.textContent = product.name || 'Producto';

    const priceEl = document.createElement('span');
    priceEl.className = 'product-price';
    priceEl.textContent = product.priceLabel || '';

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

    favorites.forEach((fav) => favoritesGrid.appendChild(createFavoriteCard(fav)));
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
      await Promise.all([loadAddress(), loadOrders()]);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar el perfil', err);
      showMessage('No se pudo cargar tu perfil. Inténtalo de nuevo más tarde.', 'error');
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
        showMessage('Datos actualizados correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar cuenta', err);
        const msg = err?.payload?.message || err?.message || 'No se pudieron guardar los cambios.';
        showMessage(msg, 'error');
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
        showMessage('Completa los campos obligatorios de la dirección.', 'error');
        return;
      }

      try {
        const address = await api.upsertAddress(payload);
        fillAddress(address);
        showMessage('Dirección guardada correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar dirección', err);
        const msg = err?.payload?.message || err?.message || 'No se pudo guardar la dirección.';
        showMessage(msg, 'error');
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
