// ======================================================
// assets/fav-toggle.js — botón de favoritos en tarjetas
// ======================================================
(function(){
  const SELECTOR = '.fav-toggle';

  const getApi = () => (typeof window !== 'undefined' ? window.CRONOX_API : null); // [FAVORITES_BACKEND_ONLY]
  const hasUser = () => Boolean(typeof window !== 'undefined' && window.CRONOX_USER); // [FAVORITES_BACKEND_ONLY]
  const openAuthModal = () => { // [FAVORITES_BACKEND_ONLY]
    if (typeof window !== 'undefined' && typeof window.CRONOX_openAuthModal === 'function') {
      window.CRONOX_openAuthModal();
    }
  };

  const getCatalog = () => (Array.isArray(window?.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : []); // [FAVORITES_FIX]

  let favoriteIds = new Set(); // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]

  const setFavorites = (ids) => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    favoriteIds = new Set(Array.from(ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)));
    window.CRONOX_FAVORITES = { ids: favoriteIds, list: Array.from(favoriteIds) };
    try {
      const detail = Array.from(favoriteIds);
      window.dispatchEvent(new CustomEvent('cronox:favsChanged', { detail }));
    } catch {}
  };

  const resolveProduct = (btn) => { // [FAVORITES_FIX]
    const card = btn.closest('.product-card');
    const datasetId = String(btn.dataset.id || card?.dataset.id || card?.dataset.slug || '').trim();
    const slug = String(btn.dataset.slug || card?.dataset.slug || '').trim();
    const backendAttr = btn.dataset.backendId || card?.dataset.backendId;
    const catalog = getCatalog();

    const match = catalog.find((p) => {
      if (!p || typeof p !== 'object') return false;
      const backend = p.backendId != null ? String(p.backendId) : '';
      const pid = p.id != null ? String(p.id) : '';
      if (backend && (backend === backendAttr || backend === datasetId)) return true;
      if (slug && p.slug && p.slug === slug) return true;
      if (pid && datasetId && pid === datasetId) return true;
      return false;
    }) || {};

    const backendId = backendAttr != null ? backendAttr : match.backendId;
    const numericBackend = Number(backendId);
    const numericDataset = Number(datasetId);
    const productId = Number.isFinite(numericBackend)
      ? numericBackend
      : (Number.isFinite(numericDataset) ? numericDataset : null);

    const product = { // [FAVORITES_FIX]
      key: datasetId || slug || (match.slug ? match.slug : (match.id != null ? String(match.id) : '')),
      productId,
      name: btn.dataset.name || match.name || card?.querySelector('.product-name')?.textContent?.trim() || 'Producto',
      price: btn.dataset.price
        || match.priceLabel
        || match.price
        || card?.querySelector('.product-price')?.textContent?.trim()
        || '',
      image: btn.dataset.image
        || match.image
        || (Array.isArray(match.images) ? match.images[0] : card?.querySelector('img')?.src)
        || '',
    };
    return product;
  };

  const isFav = (productId) => favoriteIds.has(Number(productId)); // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]

  const syncActiveState = () => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    document.querySelectorAll(SELECTOR).forEach((btn) => {
      const product = resolveProduct(btn);
      if (!product.productId) return;
      btn.classList.toggle('active', isFav(product.productId));
    });
  };

  const refreshFromBackend = async () => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    if (!hasUser()) {
      setFavorites([]);
      syncActiveState();
      return;
    }
    const api = getApi();
    if (!api || typeof api.getFavorites !== 'function') return;
    try {
      const data = await api.getFavorites();
      const ids = Array.isArray(data)
        ? data.map((item) => Number(item?.productId)).filter((id) => Number.isFinite(id))
        : [];
      setFavorites(ids);
      syncActiveState();
    } catch (error) {
      console.warn('[CRONOX] No se pudieron cargar los favoritos', error);
    }
  };

  const handleClick = async (btn) => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    if (!hasUser()) {
      openAuthModal();
      return;
    }

    const product = resolveProduct(btn);
    if (!product.productId) {
      console.warn('[CRONOX] No se pudo resolver el productId para favoritos');
      return;
    }

    const api = getApi();
    if (!api) return;

    const currentlyFav = isFav(product.productId);
    const nextActive = !currentlyFav;
    btn.classList.toggle('active', nextActive);
    const nextIds = new Set(favoriteIds);
    if (nextActive) {
      nextIds.add(product.productId);
    } else {
      nextIds.delete(product.productId);
    }
    setFavorites(nextIds);

    try {
      if (nextActive) {
        await api.addFavorite(product.productId);
      } else {
        await api.removeFavorite(product.productId);
      }
    } catch (error) {
      console.warn('[CRONOX] Error al actualizar favorito', error);
      if (nextActive) {
        nextIds.delete(product.productId);
      } else {
        nextIds.add(product.productId);
      }
      setFavorites(nextIds);
      syncActiveState();
    }
  };

  const initBtn = (btn) => { // [FAVORITES_FIX]
    if (!btn || btn.dataset.favReady === '1') return;
    btn.dataset.favReady = '1';
    const product = resolveProduct(btn);
    if (product.productId && isFav(product.productId)) btn.classList.add('active');
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleClick(btn);
    });
  };

  const initAll = () => {
    document.querySelectorAll(SELECTOR).forEach(initBtn);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.(SELECTOR)) initBtn(node);
        node.querySelectorAll?.(SELECTOR).forEach(initBtn);
      });
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    setFavorites(favoriteIds);
    initAll();
    refreshFromBackend();
    try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
  });

  window.addEventListener('cronox:favsChanged', syncActiveState);
})();
