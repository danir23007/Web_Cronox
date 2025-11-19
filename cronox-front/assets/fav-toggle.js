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

  let favoriteIds = new Set(); // [FAVORITES_BACKEND_ONLY]

  const setFavorites = (ids) => { // [FAVORITES_BACKEND_ONLY]
    favoriteIds = new Set(Array.from(ids || []).filter(Boolean).map((id) => String(id)));
    window.CRONOX_FAVORITES = { ids: favoriteIds, list: Array.from(favoriteIds) };
    try {
      const detail = Array.from(favoriteIds);
      window.dispatchEvent(new CustomEvent('cronox:favsChanged', { detail }));
    } catch {}
  };

  const getProductData = (btn) => {
    const card = btn.closest('.product-card');
    const product = {
      id: btn.dataset.id || card?.dataset.id || card?.dataset.slug || '',
      name: btn.dataset.name || card?.querySelector('.product-name')?.textContent?.trim() || 'Producto',
      price: btn.dataset.price || card?.querySelector('.product-price')?.textContent?.trim() || '',
      image: btn.dataset.image || card?.querySelector('img')?.src || ''
    };
    product.id = String(product.id || '').trim();
    return product;
  };

  const isFav = (id) => favoriteIds.has(String(id || '')); // [FAVORITES_BACKEND_ONLY]

  const syncActiveState = () => { // [FAVORITES_BACKEND_ONLY]
    document.querySelectorAll(SELECTOR).forEach((btn) => {
      const { id } = getProductData(btn);
      if (!id) return;
      btn.classList.toggle('active', isFav(id));
    });
  };

  const refreshFromBackend = async () => { // [FAVORITES_BACKEND_ONLY]
    if (!hasUser()) {
      setFavorites([]);
      syncActiveState();
      return;
    }
    const api = getApi();
    if (!api || typeof api.getFavorites !== 'function') return;
    try {
      const data = await api.getFavorites();
      const ids = Array.isArray(data) ? data.map((item) => String(item?.productId ?? item?.id ?? '')).filter(Boolean) : [];
      setFavorites(ids);
      syncActiveState();
    } catch (error) {
      console.warn('[CRONOX] No se pudieron cargar los favoritos', error);
    }
  };

  const handleClick = async (btn) => { // [FAVORITES_BACKEND_ONLY]
    const product = getProductData(btn);
    if (!product.id) return;
    if (!hasUser()) {
      openAuthModal();
      return;
    }
    const api = getApi();
    if (!api) return;

    const currentlyFav = isFav(product.id);
    const nextActive = !currentlyFav;
    btn.classList.toggle('active', nextActive);
    const nextIds = new Set(favoriteIds);
    if (nextActive) {
      nextIds.add(product.id);
    } else {
      nextIds.delete(product.id);
    }
    setFavorites(nextIds);

    try {
      if (nextActive) {
        await api.addFavorite(product.id);
      } else {
        await api.removeFavorite(product.id);
      }
    } catch (error) {
      console.warn('[CRONOX] Error al actualizar favorito', error);
      if (nextActive) {
        nextIds.delete(product.id);
      } else {
        nextIds.add(product.id);
      }
      setFavorites(nextIds);
      syncActiveState();
    }
  };

  const initBtn = (btn) => {
    if (!btn || btn.dataset.favReady === '1') return;
    btn.dataset.favReady = '1';
    const product = getProductData(btn);
    if (product.id && isFav(product.id)) btn.classList.add('active');
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
