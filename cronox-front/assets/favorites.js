(function () {
  const LOGIN_PAGE_URL = '/';

  const apiEndpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;
  let favoriteIdsSet = new Set();

  const syncFavoritesDom = () => {
    if (typeof window.CRONOX_syncFavoritesDom === 'function') {
      window.CRONOX_syncFavoritesDom();
    }
  };

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
      cache: 'no-store',
    });

    if (!res.ok) {
      const error = new Error('No se pudieron cargar los favoritos');
      error.status = res.status;
      throw error;
    }

    return res.json();
  }

  function normalizeFavorite(item) {
    // FavoritesManager and /favorites/products contain wire Product records:
    // price is integer cents, exactly like /products. Use the same mapper.
    const product = item?.product || item || {};
    return window.CRONOX_API.normalizeProductResponse(product);
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
      .filter((fav) => fav?.id);

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
      const card = cardBuilder(fav);
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
  window.addEventListener('pageshow', event => { if (event.persisted) void loadFavoritesFlow({ force: true }); });
  window.addEventListener('focus', () => { if (favoritesLoaded) void loadFavoritesFlow({ force: true }); });
  window.addEventListener('cronox:priceBoundary', () => { if (favoritesLoaded) void loadFavoritesFlow({ force: true }); });
  document.addEventListener('visibilitychange', () => { if (favoritesLoaded && document.visibilityState === 'visible') void loadFavoritesFlow({ force: true }); });
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
