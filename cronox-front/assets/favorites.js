(function () {
  const LOGIN_PAGE_URL = '/index.html';

  function formatPriceFromCents(priceInCents) {
    const euros = Number(priceInCents || 0) / 100;
    return euros.toFixed(2).replace('.', ',') + ' €';
  }

  const STAR_ICON = window.CRONOX_STAR_ICON || '<span class="icon-star"></span>';
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

  const setVisible = (el, visible) => {
    if (!el) return;
    el.hidden = !visible;
  };

  function showLoading(message) {
    if (refs.loading && message) {
      refs.loading.textContent = '';
      const p = document.createElement('p');
      p.textContent = message;
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

  async function fetchCurrentUser() {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
      });

      if (res.status === 401) return null;
      if (!res.ok) throw new Error('Error al comprobar la sesión');

      return await res.json();
    } catch (error) {
      console.error('[CRONOX] No se pudo comprobar la sesión', error);
      return null;
    }
  }

  async function fetchFavorites() {
    const res = await fetch('/api/favorites', {
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
      ? product.images.map((img) => (typeof img === 'string' ? img : img?.url || img?.imageUrl)).filter(Boolean)
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
      image: product.imageUrl || product.image || images[0] || '',
      images: images.length ? images : (product.image ? [product.image] : []),
      backendId: product.backendId ?? product.id ?? item?.productId,
    };
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

    const imgs = (Array.isArray(product.images) && product.images.length ? product.images : [product.image]).filter(Boolean);
    const imgEls = imgs.map((src, i) => {
      const im = document.createElement('img');
      im.className = 'product-img' + (i === 0 ? ' active' : '');
      im.loading = 'lazy';
      im.decoding = 'async';
      im.alt = product.name || 'Producto';
      im.src = src;
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
        window.CRONOX_openQuickAddById(product.id || product.backendId);
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

  function renderFavorites(list) {
    if (!refs.grid) return;
    refs.grid.innerHTML = '';

    const favorites = (Array.isArray(list) ? list : []).map(normalizeFavorite).filter((fav) => fav.id && (fav.image || fav.images.length));

    updateFavoriteIdsSet(favorites);

    if (!favorites.length) {
      showEmpty();
      return;
    }

    const frag = document.createDocumentFragment();
    favorites.forEach((fav) => frag.appendChild(createProductCard(fav)));
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

  async function loadFavoritesFlow() {
    if (isLoadingFavorites) return;
    isLoadingFavorites = true;

    try {
      showLoading();
      setupLoginLink();

      const user = await fetchCurrentUser();
      if (!user) {
        showLogin();
        return;
      }

      const favorites = await fetchFavorites();
      if (!Array.isArray(favorites) || !favorites.length) {
        showEmpty();
        return;
      }
      renderFavorites(favorites);
    } catch (error) {
      console.error('[CRONOX] Error al cargar favoritos', error);
      if (error?.status === 401) {
        showLogin();
        return;
      }
      showLoading('No se pudieron cargar tus favoritos. Inténtalo de nuevo más tarde.');
    } finally {
      isLoadingFavorites = false;
    }
  }

  const handleFavsChanged = () => {
    if (isLoadingFavorites) return;
    loadFavoritesFlow();
  };

  document.addEventListener('DOMContentLoaded', loadFavoritesFlow);
  window.addEventListener('cronox:favsChanged', handleFavsChanged);
})();
