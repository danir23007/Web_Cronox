(function () {
  const LOGIN_PAGE_URL = '/';

  function formatPriceFromCents(priceInCents) {
    const euros = Number(priceInCents || 0) / 100;
    return euros.toFixed(2).replace('.', ',') + ' €';
  }

  const apiEndpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;
  const safeProductImage = (value, fallback = 'assets/product-image-unavailable.svg') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };
  let favoriteIdsSet = new Set();

  const syncFavoritesDom = () => {
    if (typeof window.CRONOX_syncFavoritesDom === 'function') {
      window.CRONOX_syncFavoritesDom();
    }
  };

  window.formatPriceFromCents = window.formatPriceFromCents || formatPriceFromCents;

  const refs = {
    loading: document.getElementById('favorites-loading'),
    login: document.getElementById('favorites-login'),
    empty: document.getElementById('favorites-empty'),
    list: document.getElementById('favorites-list'),
    grid: document.getElementById('favorites-grid'),
    loginLink: document.getElementById('favorites-login-link'),
  };

  let isLoadingFavorites = false;
  let isRefreshingFavorites = false;
  let favoritesLoaded = false;
  let lastFavoriteIdsSignature = '';

  const setVisible = (el, visible) => {
    if (!el) return;
    el.hidden = !visible;
  };

  function showLoading(message) {
    if (refs.loading) {
      refs.loading.textContent = '';
      const p = document.createElement('p');
      p.textContent = message || 'Cargando productos favoritos...';
      if (!message) {
        p.className = 'favorites-loading-text';
      }
      refs.loading.appendChild(p);
    }
    setVisible(refs.loading, true);
    setVisible(refs.login, false);
    setVisible(refs.empty, false);
    setVisible(refs.list, false);
  }

  function showLogin() {
    setVisible(refs.loading, false);
    setVisible(refs.empty, false);
    setVisible(refs.list, false);
    setVisible(refs.login, true);
    updateFavoriteIdsSet([]);
  }

  function showEmpty() {
    setVisible(refs.loading, false);
    setVisible(refs.login, false);
    setVisible(refs.list, false);
    setVisible(refs.empty, true);
    updateFavoriteIdsSet([]);
  }

  function showList() {
    setVisible(refs.loading, false);
    setVisible(refs.login, false);
    setVisible(refs.empty, false);
    setVisible(refs.list, true);
  }

  async function fetchFavoriteProducts(force = false) {
    const manager = window.CRONOX_FAVORITES;
    if (manager) {
      // /api/favorites already includes the full product records. Share that
      // request instead of waiting for the catalogue and requesting them again.
      await manager.loadFromServer({ force: force || !manager.serverFavorites });
      if (!manager.ready || manager.anonymous) {
        const error = new Error('No se pudieron cargar los favoritos');
        error.status = manager.anonymous ? 401 : 503;
        throw error;
      }
      return (manager.serverFavorites || []).map(item => item.product || item);
    }
    const res = await fetch(apiEndpoint('/api/favorites/products'), {
      method: 'GET',
      credentials: 'include',
    });

    if (!res.ok) {
      const error = new Error('No se pudieron cargar los favoritos');
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  function normalizeFavorite(item) {
    const product = item?.product || item || {};
    const images = Array.isArray(product.images)
      ? product.images
          .map((img) => (typeof img === 'string' ? img : img?.url || img?.imageUrl))
          .map((image) => safeProductImage(image, ''))
          .filter(Boolean)
      : [];

    const priceRaw = product.priceCents ?? product.price ?? product.price_in_cents;
    let priceInCents = Number(priceRaw || 0);
    if (priceInCents > 0 && priceInCents < 100) {
      priceInCents = Math.round(priceInCents * 100);
    }

    return {
      id: product.id ?? item?.productId ?? item?.id ?? '',
      slug: product.slug,
      name: product.name || 'Producto',
      priceInCents,
      image: safeProductImage(product.imageUrl || product.image || images[0], ''),
      images: images.length
        ? images
        : (product.image ? [safeProductImage(product.image, '')].filter(Boolean) : []),
      backendId: product.backendId ?? product.id ?? item?.productId,
      variants: product.variants,
      imageRecords: product.imageRecords || product.galleryImages || (Array.isArray(product.images) ? product.images : []),
    };
  }

  function findCatalogProduct(fav) {
    const catalog = Array.isArray(window.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : [];
    if (!catalog.length) return null;

    const id = (fav?.backendId ?? fav?.id ?? fav?.productId ?? '').toString();
    const slug = fav?.slug;

    const bySlug = slug ? catalog.find((p) => p.slug === slug) : null;
    if (bySlug) return bySlug;

    if (id) {
      const byId = catalog.find((p) => p.id === id || (p.backendId != null && String(p.backendId) === id));
      if (byId) return byId;
    }

    return null;
  }

  const updateFavoriteIdsSet = (list) => {
    const ids = new Set();
    (Array.isArray(list) ? list : []).forEach((fav) => {
      const id = String(fav.backendId ?? fav.id ?? fav.productId ?? '').trim();
      if (id) ids.add(id);
    });
    favoriteIdsSet = ids;
    if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.setIdsFromServer === 'function') {
      const manager = window.CRONOX_FAVORITES;
      const unchanged = manager.ready && manager.ids.size === ids.size && [...ids].every(id => manager.ids.has(id));
      if (!unchanged) manager.setIdsFromServer(list);
      favoriteIdsSet = window.CRONOX_FAVORITES.ids;
    } else if (typeof window.CRONOX_setFavoriteIds === 'function') {
      favoriteIdsSet = window.CRONOX_setFavoriteIds(ids);
    } else {
      window.CRONOX_FAVORITE_IDS = ids;
    }
    syncFavoritesDom();
  };

  const normalizeFavoritesList = (list) =>
    (Array.isArray(list) ? list : [])
      .map(normalizeFavorite)
      .filter((fav) => fav.id);

  const signatureFromIds = (idsLike) => {
    const ids = idsLike instanceof Set ? Array.from(idsLike) : Array.from(idsLike || []);
    return ids
      .map((id) => (id == null ? '' : String(id).trim()))
      .filter(Boolean)
      .sort()
      .join('|');
  };

  const signatureFromFavorites = (list) => {
    const ids = [];
    (Array.isArray(list) ? list : []).forEach((fav) => {
      const id = fav?.backendId ?? fav?.id ?? fav?.productId;
      if (id != null) ids.push(id);
    });
    return signatureFromIds(ids);
  };

  function renderFavorites(list, { preNormalized = false } = {}) {
    if (!refs.grid) return;
    refs.grid.innerHTML = '';

    const favorites = preNormalized ? (Array.isArray(list) ? list : []) : normalizeFavoritesList(list);

    updateFavoriteIdsSet(favorites);

    if (!favorites.length) {
      showEmpty();
      return;
    }

    const cardBuilder = window.CRONOX_createProductCard;
    if (typeof cardBuilder !== 'function') {
      showLoading('No se ha podido cargar el catálogo.');
      return;
    }

    const frag = document.createDocumentFragment();
    favorites.forEach((fav) => {
      const catalogProduct = findCatalogProduct(fav);
      const cardData = catalogProduct ? { ...catalogProduct, variants: fav.variants } : {
        ...fav,
        id: String(fav.id || fav.backendId || ''),
        backendId: fav.backendId,
        price: Number(fav.priceInCents || 0) / 100,
        priceLabel: formatPriceFromCents(fav.priceInCents),
        images: Array.isArray(fav.images) && fav.images.length ? fav.images : (fav.image ? [fav.image] : []),
        imageRecords: fav.imageRecords || [],
        galleryImages: fav.imageRecords || [],
      };
      const card = cardBuilder(cardData);
      frag.appendChild(card);
    });
    refs.grid.appendChild(frag);
    syncFavoritesDom();
    showList();
  }

  let loginLinkBound = false;
  function setupLoginLink() {
    if (!refs.loginLink || loginLinkBound) return;
    refs.loginLink.addEventListener('click', (ev) => {
      ev.preventDefault();
      window.location.href = LOGIN_PAGE_URL;
    });
    loginLinkBound = true;
  }

  let favoriteFlowId = 0;
  async function loadFavoritesFlow({ force = false } = {}) {
    if (isLoadingFavorites || isRefreshingFavorites) return;
    if (favoritesLoaded && !force) return;
    const flowId = ++favoriteFlowId;

    const useLoadingState = !favoritesLoaded;
    if (useLoadingState) {
      isLoadingFavorites = true;
      showLoading();
    } else {
      isRefreshingFavorites = true;
    }

    try {
      setupLoginLink();
      const epoch = window.CRONOX_FAVORITES?.sessionEpoch;
      const favorites = await fetchFavoriteProducts(force);
      const revision = window.CRONOX_FAVORITES?.revision;

      if (window.CRONOX_catalogReady instanceof Promise) {
        try {
          await window.CRONOX_catalogReady;
        } catch {}
      }

      if (flowId !== favoriteFlowId || epoch !== window.CRONOX_FAVORITES?.sessionEpoch || revision !== window.CRONOX_FAVORITES?.revision) return;
      const normalized = normalizeFavoritesList(favorites);
      lastFavoriteIdsSignature = signatureFromFavorites(normalized);
      favoritesLoaded = true;

      if (!normalized.length) {
        showEmpty();
        return;
      }
      renderFavorites(normalized, { preNormalized: true });
    } catch (error) {
      if (flowId !== favoriteFlowId) return;
      console.error('[CRONOX] Error al cargar favoritos', error);
      if (error?.status === 401) {
        favoritesLoaded = true;
        lastFavoriteIdsSignature = '';
        showLogin();
        return;
      }
      showLoading('No se pudieron cargar tus favoritos. Inténtalo de nuevo más tarde.');
    } finally {
      if (flowId === favoriteFlowId) {
        if (useLoadingState) isLoadingFavorites = false;
        else isRefreshingFavorites = false;
      }
    }
  }

  const handleFavsChanged = () => {
    if (isLoadingFavorites || isRefreshingFavorites) return;
    const managerIds = window.CRONOX_FAVORITES?.ids;
    const incomingSignature = signatureFromIds(managerIds);

    if (favoritesLoaded && incomingSignature && incomingSignature === lastFavoriteIdsSignature) {
      return;
    }

    loadFavoritesFlow({ force: true });
  };

  document.addEventListener('DOMContentLoaded', loadFavoritesFlow);
  window.addEventListener('cronox:favsChanged', handleFavsChanged);
  const handleSessionChange = event => {
    if (event.initial && event.detail) return;
    favoriteFlowId += 1;
    isLoadingFavorites = false;
    isRefreshingFavorites = false;
    favoritesLoaded = false;
    if (!event.detail) showLogin();
    else loadFavoritesFlow({ force: true });
  };
  window.addEventListener('cronox:userChanged', handleSessionChange);
  window.addEventListener('cronox:session-ended', () => handleSessionChange({ detail: null }));
})();
