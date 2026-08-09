(function () {
  const LOGIN_PAGE_URL = '/index.html';

  function formatPriceFromCents(priceInCents) {
    const euros = Number(priceInCents || 0) / 100;
    return euros.toFixed(2).replace('.', ',') + ' €';
  }

  const STAR_ICON = window.CRONOX_STAR_ICON || '<span class="icon-star"></span>';
  const apiEndpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;
  const safeProductImage = (value, fallback = 'assets/logo_banner.png') => {
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

  async function fetchFavoriteProducts() {
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
      window.CRONOX_FAVORITES.setIdsFromServer(list);
      favoriteIdsSet = window.CRONOX_FAVORITES.ids;
    } else if (typeof window.CRONOX_setFavoriteIds === 'function') {
      favoriteIdsSet = window.CRONOX_setFavoriteIds(ids);
    } else {
      window.CRONOX_FAVORITE_IDS = ids;
    }
    syncFavoritesDom();
  };

  function createProductCard(product) {
    const key = product.slug || String(product.id || product.backendId || '');
    const a = document.createElement('a');
    a.className = 'product-card';
    a.href = product.slug
      ? `/producto.html?slug=${encodeURIComponent(product.slug)}`
      : `/producto.html?id=${encodeURIComponent(key)}`;
    if (key) a.setAttribute('data-id', key);
    if (product.slug) a.setAttribute('data-slug', product.slug);
    if (product.backendId != null) a.setAttribute('data-backend-id', String(product.backendId));

    const media = document.createElement('div');
    media.className = 'product-media';

    const gallery = document.createElement('div');
    gallery.className = 'product-images';

    const imgs = (Array.isArray(product.images) && product.images.length ? product.images : [product.image])
      .map((image) => safeProductImage(image, ''))
      .filter(Boolean);
    const imgEls = imgs.map((src, i) => {
      const im = document.createElement('img');
      im.className = 'product-img' + (i === 0 ? ' active' : '');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.alt = product.name || 'Producto';
      im.src = src;
      im.referrerPolicy = 'no-referrer';
      return im;
    });
    imgEls.forEach((im) => gallery.appendChild(im));

    const favBtn = document.createElement('button');
    favBtn.className = 'favorite-toggle';
    favBtn.type = 'button';
    favBtn.setAttribute('aria-label', 'Marcar como favorito');
    favBtn.dataset.productId = String(product.backendId ?? product.id ?? '');
    favBtn.dataset.slug = product.slug || '';
    favBtn.dataset.name = product.name || 'Producto';
    favBtn.dataset.price = formatPriceFromCents(product.priceInCents);
    favBtn.dataset.image = imgs[0] || product.image || '';
    favBtn.innerHTML = STAR_ICON;
    favBtn.dataset.favBound = '1';
    favBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.toggleFromButton === 'function') {
        window.CRONOX_FAVORITES.toggleFromButton(favBtn);
      }
    });

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

    const name = document.createElement('h3');
    name.className = 'product-name';
    name.textContent = product.name || '';

    const price = document.createElement('p');
    price.className = 'product-price';
    price.textContent = formatPriceFromCents(product.priceInCents);

    a.appendChild(media);
    a.appendChild(name);
    a.appendChild(price);
    return a;
  }

  const normalizeFavoritesList = (list) =>
    (Array.isArray(list) ? list : [])
      .map(normalizeFavorite)
      .filter((fav) => fav.id && (fav.image || fav.images.length));

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

    const cardBuilder = typeof window.CRONOX_buildFavoriteCard === 'function'
      ? window.CRONOX_buildFavoriteCard
      : (typeof window.CRONOX_createProductCard === 'function'
        ? window.CRONOX_createProductCard
        : createProductCard);

    const frag = document.createDocumentFragment();
    favorites.forEach((fav) => {
      const catalogProduct = findCatalogProduct(fav);
      const cardData = catalogProduct || {
        ...fav,
        id: String(fav.id || fav.backendId || ''),
        backendId: fav.backendId,
        price: Number(fav.priceInCents || 0) / 100,
        priceLabel: formatPriceFromCents(fav.priceInCents),
        images: Array.isArray(fav.images) && fav.images.length ? fav.images : (fav.image ? [fav.image] : []),
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

  async function loadFavoritesFlow({ force = false } = {}) {
    if (isLoadingFavorites || isRefreshingFavorites) return;
    if (favoritesLoaded && !force) return;

    const useLoadingState = !favoritesLoaded;
    if (useLoadingState) {
      isLoadingFavorites = true;
      showLoading();
    } else {
      isRefreshingFavorites = true;
    }

    try {
      setupLoginLink();

      if (window.CRONOX_catalogReady instanceof Promise) {
        try {
          await window.CRONOX_catalogReady;
        } catch {}
      }

      const favorites = await fetchFavoriteProducts();
      const normalized = normalizeFavoritesList(favorites);
      lastFavoriteIdsSignature = signatureFromFavorites(normalized);
      favoritesLoaded = true;

      if (!normalized.length) {
        showEmpty();
        return;
      }
      renderFavorites(normalized, { preNormalized: true });
    } catch (error) {
      console.error('[CRONOX] Error al cargar favoritos', error);
      if (error?.status === 401) {
        favoritesLoaded = true;
        lastFavoriteIdsSignature = '';
        showLogin();
        return;
      }
      showLoading('No se pudieron cargar tus favoritos. Inténtalo de nuevo más tarde.');
    } finally {
      if (useLoadingState) {
        isLoadingFavorites = false;
      } else {
        isRefreshingFavorites = false;
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
})();
