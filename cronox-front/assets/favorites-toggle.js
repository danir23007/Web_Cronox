(function () {
  const normalizeId = (value) => {
    const id = String(value ?? '').trim();
    return id || null;
  };

  const collectIds = (idsLike) => {
    const values = idsLike instanceof Set ? Array.from(idsLike) : (Array.isArray(idsLike) ? idsLike : []);
    return values.map((value) => normalizeId(
      value?.backendId ?? value?.productId ?? value?.id ?? value?.product?.id ?? value,
    )).filter(Boolean);
  };

  const syncDom = () => {
    const ids = window.CRONOX_FAVORITES?.ids instanceof Set
      ? window.CRONOX_FAVORITES.ids
      : (window.CRONOX_FAVORITE_IDS instanceof Set ? window.CRONOX_FAVORITE_IDS : new Set());
    document.querySelectorAll('.favorite-toggle[data-product-id]').forEach((button) => {
      const active = ids.has(normalizeId(button.dataset.productId));
      button.classList.toggle('is-favorite', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('aria-label', active ? 'Quitar de favoritos' : 'Marcar como favorito');
    });
  };

  // Compatibility entry points mirror the one authoritative manager in
  // app.js. This module deliberately performs no network mutation of its own.
  window.CRONOX_setFavoriteIds = (idsLike) => {
    const next = new Set(collectIds(idsLike));
    window.CRONOX_FAVORITE_IDS = window.CRONOX_FAVORITES?.ids instanceof Set
      ? window.CRONOX_FAVORITES.ids
      : next;
    syncDom();
    return window.CRONOX_FAVORITE_IDS;
  };
  window.CRONOX_syncFavoritesDom = syncDom;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.favorite-toggle[data-product-id]');
    if (!button || button.dataset.favBound === '1') return;
    event.preventDefault();
    event.stopPropagation();
    window.CRONOX_FAVORITES?.toggleFromButton?.(button);
  });

  window.addEventListener('cronox:favoritesChanged', syncDom);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncDom, { once: true });
  else syncDom();
})();
