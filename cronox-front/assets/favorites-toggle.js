(function () {
  const getCsrfHeaders = async () => {
    const provider = window.CRONOX_API?.getCsrfHeaders;
    return typeof provider === 'function' ? provider() : {};
  };
  const apiEndpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;

  const ensureGlobalSet = () => {
    if (!(window.CRONOX_FAVORITE_IDS instanceof Set)) {
      window.CRONOX_FAVORITE_IDS = new Set();
    }
    return window.CRONOX_FAVORITE_IDS;
  };

  const normalizeId = (value) => {
    const str = String(value ?? '').trim();
    return str || null;
  };

  const collectIds = (idsLike) => {
    const result = [];
    if (idsLike instanceof Set) {
      idsLike.forEach((value) => {
        const id = normalizeId(value);
        if (id) result.push(id);
      });
      return result;
    }

    if (Array.isArray(idsLike)) {
      idsLike.forEach((item) => {
        if (item && typeof item === 'object') {
          const id = normalizeId(item.backendId ?? item.id ?? item.productId);
          if (id) result.push(id);
          return;
        }
        const id = normalizeId(item);
        if (id) result.push(id);
      });
    }
    return result;
  };

  function syncFavoritesDom() {
    const set = ensureGlobalSet();

    const buttons = document.querySelectorAll('.favorite-toggle');
    buttons.forEach((btn) => {
      const pid = btn.dataset.productId || btn.getAttribute('data-product-id') || '';
      const id = normalizeId(pid) || '';
      const isFav = Boolean(id && set.has(id));

      btn.classList.toggle('is-favorite', isFav);
      btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
      btn.setAttribute('aria-label', isFav ? 'Quitar de favoritos' : 'Marcar como favorito');
    });

    const count = set.size;
    const badge = document.querySelector('.topbar__fav .favorites-count, .topbar__fav .fav-count');
    if (badge) {
      if (!count) {
        badge.textContent = '';
        badge.hidden = true;
      } else {
        badge.textContent = String(count);
        badge.hidden = false;
      }
    }
  }

  const setFavoriteIds = (idsLike) => {
    const target = ensureGlobalSet();
    target.clear();
    collectIds(idsLike).forEach((id) => target.add(id));
    window.CRONOX_FAVORITE_IDS = target;
    syncFavoritesDom();
    dispatchFavsChanged();
    return target;
  };

  window.CRONOX_FAVORITE_IDS = ensureGlobalSet();
  window.CRONOX_setFavoriteIds = setFavoriteIds;
  window.CRONOX_syncFavoritesDom = syncFavoritesDom;

  function dispatchFavsChanged() {
    try {
      window.dispatchEvent(new CustomEvent('cronox:favsChanged', { detail: Array.from(ensureGlobalSet()) }));
    } catch {}
  }

  function handleNotLoggedIn() {
    if (typeof window.CRONOX_openAuthModal === 'function') {
      window.CRONOX_openAuthModal();
      return;
    }
    window.location.href = '/index.html';
  }

  async function toggleFavorite(btn, id) {
    const set = ensureGlobalSet();
    const isCurrentlyFav = set.has(id);
    const wantFav = !isCurrentlyFav;

    btn.disabled = true;
    if (wantFav) {
      set.add(id);
    } else {
      set.delete(id);
    }
    syncFavoritesDom();

    const payload = {};
    const numericId = Number(id);
    if (Number.isFinite(numericId)) {
      payload.productId = numericId;
    } else if (btn.dataset.slug) {
      payload.slug = btn.dataset.slug;
    }

    if (!payload.productId && !payload.slug) {
      payload.slug = id;
    }

    try {
      let res;
      if (wantFav) {
        res = await fetch(apiEndpoint('/api/favorites'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) },
          body: JSON.stringify(payload),
        });
      } else {
        const deleteId = payload.productId ?? payload.slug ?? id;
        res = await fetch(apiEndpoint('/api/favorites/' + encodeURIComponent(String(deleteId))), {
          method: 'DELETE',
          credentials: 'include',
          headers: await getCsrfHeaders(),
        });
      }

      if (res.status === 401 || res.status === 403) {
        if (wantFav) set.delete(id);
        else set.add(id);
        syncFavoritesDom();
        dispatchFavsChanged();
        handleNotLoggedIn();
        return;
      }

      if (!res.ok) {
        if (wantFav) set.delete(id);
        else set.add(id);
        syncFavoritesDom();
        console.error('Error al actualizar favorito', await res.text());
        dispatchFavsChanged();
        return;
      }

      try {
        const body = await res.json();
        if (body && Array.isArray(body)) {
          setFavoriteIds(body.map((item) => item.productId ?? item.id ?? item.backendId));
          return;
        }
      } catch {}

      syncFavoritesDom();
      dispatchFavsChanged();
    } catch (error) {
      if (wantFav) set.delete(id);
      else set.add(id);
      syncFavoritesDom();
      console.error('Error de red al actualizar favorito', error);
      dispatchFavsChanged();
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener('click', async (event) => {
    const btn = event.target.closest('.favorite-toggle');
    if (!btn) return;

    event.preventDefault();
    event.stopPropagation();

    const pid = btn.dataset.productId || btn.getAttribute('data-product-id') || '';
    const id = normalizeId(pid);
    if (!id) return;

    await toggleFavorite(btn, id);
  });

  document.addEventListener('DOMContentLoaded', syncFavoritesDom);
  window.addEventListener('cronox:productsLoaded', syncFavoritesDom);
  window.addEventListener('cronox:favsChanged', syncFavoritesDom);
})();
