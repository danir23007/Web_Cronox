/* ==========================================================
   CRONOX — app.js (v47 -> v48 newsletter sessionStorage)
   - Click en .fav-add abre Quick-Add (panel vertical)
   - El panel emite "cronox:addToCart" para añadir al carrito
   ========================================================== */

(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const API = window.CRONOX_API || {};
  const STAR_ICON = '<span class="icon-star"></span>';
  window.CRONOX_STAR_ICON = STAR_ICON;

  const TOPBAR_STATES = ['topbar--transparent', 'topbar--hero', 'topbar--page'];

  // ===== Preloader =====
  window.addEventListener('load', () => {
    const body = document.body;
    const preloader = document.getElementById('preloader');
    // Retraso aleatorio del preloader entre 1s y 2s para mostrar la animación
    const randomDelay = Math.floor(Math.random() * (2000 - 1000 + 1)) + 1000;

    setTimeout(() => {
      if (body) {
        body.classList.remove('is-loading');
        body.classList.add('is-loaded');
      }

      if (preloader) {
        // Espera ligeramente más que la transición CSS y elimina el nodo para evitar parpadeos
        setTimeout(() => preloader.remove(), 600);
      }
    }, randomDelay);
  });

  // ===== Topbar =====
  const topbar = $('.topbar');
  const hero = $('.hero-video-section');
  const favoritesIcon = document.querySelector('.topbar-icon-favorites');
  const cartTopbarIcon = document.querySelector('.topbar-icon-cart');
  const userTopbarIcon = document.querySelector('.topbar-icon-user');
  const TOPBAR_ICON_MAP = {
    account: userTopbarIcon,
    favorites: favoritesIcon,
    cart: cartTopbarIcon,
  };

  const getPageActiveIconType = () => {
    const body = document.body;
    if (!body) return null;
    if (body.classList.contains('page-profile')) return 'account';
    if (body.classList.contains('page-favorites')) return 'favorites';
    if (body.classList.contains('page-cart')) return 'cart';
    return null;
  };

  const setActiveTopbarIcon = (type) => {
    const activeType = type && TOPBAR_ICON_MAP[type] ? type : null;
    Object.entries(TOPBAR_ICON_MAP).forEach(([key, el]) => {
      if (!el) return;
      const isActive = key === activeType;
      el.classList.toggle('active', isActive);
      el.classList.toggle('topbar-icon--glow', isActive);
      if (isActive) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  };

  const syncTopbarActiveIcon = () => setActiveTopbarIcon(getPageActiveIconType());

  const setIconGlowState = (iconEl, isActive, stateClass) => {
    if (!iconEl) return;
    if (stateClass) iconEl.classList.toggle(stateClass, isActive);
    const mapped = Object.entries(TOPBAR_ICON_MAP).find(([, node]) => node === iconEl);
    if (mapped) {
      setActiveTopbarIcon(isActive ? mapped[0] : getPageActiveIconType());
    } else {
      iconEl.classList.toggle('topbar-icon--glow', Boolean(isActive));
    }
  };

  // Expose helper globally to avoid undefined references from inline handlers
  window.setIconGlowState = setIconGlowState;
  window.setActiveTopbarIcon = setActiveTopbarIcon;
  window.syncTopbarActiveIcon = syncTopbarActiveIcon;

  const getLockedTopbarState = () => {
    if (!document.body) return '';
    const ds = document.body.dataset || {};
    const lock = typeof ds.topbarLock === 'string' ? ds.topbarLock.trim() : '';
    return lock || '';
  };

  function applyTopbarState(state) {
    if (!topbar) return;
    const locked = getLockedTopbarState();
    const targetState = locked || state;
    topbar.classList.remove(...TOPBAR_STATES);
    if (targetState) topbar.classList.add(targetState);
  }
  function updateTopbarOnScroll() {
    if (!topbar || !hero) return;
    const rect = hero.getBoundingClientRect();
    const atTop = window.scrollY <= 0;
    if (atTop && rect.top >= 0) applyTopbarState('topbar--transparent');
    else if (rect.bottom > 0)   applyTopbarState('topbar--hero');
    else                        applyTopbarState('topbar--page');
  }
  if (hero && topbar) {
    try {
      const io = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          if (window.scrollY <= 0) applyTopbarState('topbar--transparent');
          else applyTopbarState('topbar--hero');
        } else applyTopbarState('topbar--page');
      }, { threshold: [0, 0.01, 0.1] });
      io.observe(hero);
    } catch {}
    window.addEventListener('scroll', updateTopbarOnScroll, { passive: true });
    window.addEventListener('resize', updateTopbarOnScroll);
    document.addEventListener('DOMContentLoaded', updateTopbarOnScroll);
    window.addEventListener('load', updateTopbarOnScroll);
  }

  document.addEventListener('DOMContentLoaded', syncTopbarActiveIcon);

  // ===== Drawer Lateral (si lo usas) =====
  const overlay = $('.overlay');
  const overlayUsers = new Map();
  const OVERLAY_CLASSES = ['overlay--hero', 'overlay--page', 'overlay--search'];
  const refreshOverlay = () => {
    if (!overlay) return;
    if (!overlayUsers.size) {
      overlay.hidden = true;
      overlay.classList.remove(...OVERLAY_CLASSES);
      return;
    }
    const activeKinds = Array.from(overlayUsers.values());
    const currentKind = activeKinds[activeKinds.length - 1] || 'overlay--page';
    overlay.hidden = false;
    overlay.classList.remove(...OVERLAY_CLASSES);
    overlay.classList.add(currentKind);
  };
  const showOverlay = (kind = 'overlay--page', key = 'default') => {
    if (!overlay) return key;
    overlayUsers.delete(key);
    overlayUsers.set(key, kind);
    refreshOverlay();
    return key;
  };
  const hideOverlay = (key = 'default') => {
    if (!overlay) return;
    overlayUsers.delete(key);
    refreshOverlay();
  };

  const scrollLocks = new Set();
  function lockScroll(key = 'default') {
    const body = document.body;
    if (!body) return;
    scrollLocks.add(key);
    body.classList.add('no-scroll');
  }
  function unlockScroll(key = 'default') {
    const body = document.body;
    if (!body) return;
    scrollLocks.delete(key);
    if (!scrollLocks.size) body.classList.remove('no-scroll');
  }
  window.CRONOX_lockScroll = lockScroll;
  window.CRONOX_unlockScroll = unlockScroll;

  const filtersPanel = $('#filtersPanel');
  const menuBtn = $('#btnMenu');
  const filtersCloseBtn = filtersPanel ? $('.filters-close', filtersPanel) : null;
  const FILTERS_KEY = 'filters';
  const FILTERS_TRANSITION_MS = 220;

  const isFiltersOpen = () => Boolean(filtersPanel?.classList.contains('is-open'));

  function openFilters(){
    if (!filtersPanel) return;
    filtersPanel.hidden = false;
    requestAnimationFrame(() => {
      filtersPanel?.classList.add('is-open');
    });
    showOverlay('overlay--page', FILTERS_KEY);
    lockScroll(FILTERS_KEY);
    menuBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeFilters(){
    if (!filtersPanel) return;
    filtersPanel.classList.remove('is-open');
    menuBtn?.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      if (!filtersPanel) return;
      if (!isFiltersOpen()) {
        filtersPanel.hidden = true;
        hideOverlay(FILTERS_KEY);
        unlockScroll(FILTERS_KEY);
      }
    }, FILTERS_TRANSITION_MS);
  }

  if (filtersPanel) {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-filters]')) {
        e.preventDefault();
        openFilters();
      }
      if (e.target.closest('[data-close-filters]')) {
        e.preventDefault();
        closeFilters();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isFiltersOpen()) closeFilters();
    });

    menuBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      isFiltersOpen() ? closeFilters() : openFilters();
    });

    filtersCloseBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      closeFilters();
    });

    filtersPanel.addEventListener('click', (e) => {
      const list = $('.black-menu__list', filtersPanel);
      if (!list) return;
      const link = e.target.closest('a.black-menu__link');
      if (link) {
        closeFilters();
        return;
      }
      if (!list.contains(e.target) && !e.target.closest('.filters-close')) {
        closeFilters();
      }
    });
  }

  // ===== Searchbar =====
  const searchBar = $('#searchBar');
  const btnSearch = $('#btnSearch');
  const searchInput = $('#searchInput');
  const searchCloseBtn = searchBar ? $('.searchbar__close', searchBar) : null;
  let searchActive = false;
  let searchPrevTopbarState = '';
  let searchLockedTopbar = false;
  let searchHideTimer = 0;

  const lockTopbarForSearch = () => {
    if (!topbar) return;
    searchPrevTopbarState = TOPBAR_STATES.find((cls) => topbar.classList.contains(cls)) || '';
    const body = document.body;
    if (body) {
      body.dataset.topbarLock = 'topbar--page';
      searchLockedTopbar = true;
    }
    topbar.classList.remove(...TOPBAR_STATES);
    topbar.classList.add('topbar--page');
  };

  const unlockTopbarForSearch = () => {
    if (!topbar || !searchLockedTopbar) return;
    const body = document.body;
    if (body && body.dataset.topbarLock === 'topbar--page') {
      delete body.dataset.topbarLock;
    }
    searchLockedTopbar = false;
    topbar.classList.remove(...TOPBAR_STATES);
    if (searchPrevTopbarState) {
      topbar.classList.add(searchPrevTopbarState);
    } else {
      updateTopbarOnScroll();
    }
    searchPrevTopbarState = '';
    window.requestAnimationFrame(updateTopbarOnScroll);
  };

  const openSearch = () => {
    if (!searchBar || searchActive) return;
    if (searchHideTimer) {
      clearTimeout(searchHideTimer);
      searchHideTimer = 0;
    }
    searchActive = true;
    searchBar.hidden = false;
    searchBar.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => searchBar.classList.add('is-open'));
    showOverlay('overlay--search', 'search');
    lockScroll('search');
    lockTopbarForSearch();
    btnSearch?.setAttribute('aria-expanded', 'true');
    window.setTimeout(() => {
      if (searchInput) {
        try { searchInput.focus({ preventScroll: true }); }
        catch { searchInput.focus(); }
      }
    }, 60);
  };

  const closeSearch = () => {
    if (!searchBar || !searchActive) return;
    searchActive = false;
    searchBar.classList.remove('is-open');
    searchBar.setAttribute('aria-hidden', 'true');
    btnSearch?.setAttribute('aria-expanded', 'false');
    hideOverlay('search');
    unlockScroll('search');
    unlockTopbarForSearch();
    if (searchHideTimer) clearTimeout(searchHideTimer);
    searchHideTimer = window.setTimeout(() => {
      if (!searchActive && searchBar) {
        searchBar.hidden = true;
      }
    }, 220);
  };

  const toggleSearch = () => {
    if (!searchBar) return;
    searchActive ? closeSearch() : openSearch();
  };

  btnSearch?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSearch();
  });

  searchCloseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeSearch();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchActive) closeSearch();
  });

  overlay?.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (searchActive) closeSearch();
    if (isFiltersOpen()) closeFilters();
  });

  // ===== Mini-galería (flechas) =====
  function moveGallery(cardEl, dir = 1) {
    const wrap = $('.product-images', cardEl);
    if (!wrap) return;
    const imgs = $$('.product-img', wrap);
    if (!imgs.length) return;
    let idx = imgs.findIndex((im) => im.classList.contains('active'));
    if (idx < 0) idx = 0;
    const next = (idx + dir + imgs.length) % imgs.length;
    imgs.forEach((im, i) => im.classList.toggle('active', i === next));
  }
  document.addEventListener('click', (e) => {
    const prevBtn = e.target.closest('.product-arrow.prev');
    const nextBtn = e.target.closest('.product-arrow.next');
    if (prevBtn || nextBtn) {
      e.preventDefault(); e.stopPropagation();
      const card = e.target.closest('.product-card');
      moveGallery(card, prevBtn ? -1 : 1);
    }
  });

  // ===== Favoritos globales =====
  const FavoritesManager = {
    ready: false,
    ids: new Set(),
    isLoading: false,
    initDone: false,
    normalizeId(value) {
      const str = value == null ? '' : String(value).trim();
      return str || null;
    },
    init() {
      if (this.initDone) return;
      this.initDone = true;
      const run = async () => {
        await this.loadFromServer();
        this.updateDomState();
        this.ready = true;
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
      } else {
        run();
      }
    },
    async loadFromServer() {
      if (this.isLoading) return this.ids;
      this.isLoading = true;
      try {
        const meRes = await fetch('/api/me', { credentials: 'include' });
        if (meRes.status === 401) {
          this.setIdsFromServer([]);
          return this.ids;
        }
        if (!meRes.ok) {
          throw new Error('Error comprobando sesión');
        }

        const res = await fetch('/api/favorites', {
          method: 'GET',
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error('Error al cargar favoritos');
        }

        const favorites = await res.json();
        this.setIdsFromServer(Array.isArray(favorites) ? favorites : []);
        return this.ids;
      } catch (err) {
        console.error('[CRONOX] No se pudieron cargar favoritos', err);
        this.setIdsFromServer([]);
        return this.ids;
      } finally {
        this.isLoading = false;
      }
    },
    setIdsFromServer(list) {
      const next = new Set();
      (Array.isArray(list) ? list : []).forEach((fav) => {
        const id = this.normalizeId(fav?.backendId ?? fav?.productId ?? fav?.id ?? fav?.product?.id ?? fav);
        if (id) next.add(id);
      });
      this.ids = next;
      window.CRONOX_FAVORITE_IDS = this.ids;
      if (typeof window.CRONOX_setFavoriteIds === 'function') {
        try { window.CRONOX_setFavoriteIds(new Set(next)); } catch {}
      }
      this.updateDomState();
      this.updateTopbarCount();
      this.emitChange();
      return this.ids;
    },
    isFavorite(productId) {
      const id = this.normalizeId(productId);
      return id ? this.ids.has(id) : false;
    },
    async toggleFromButton(btn) {
      if (!btn) return;
      const productId = btn.dataset.productId || btn.getAttribute('data-product-id') || '';
      const normId = this.normalizeId(productId);
      if (!normId) return;
      if (!this.initDone) this.init();

      try {
        const sessionRes = await fetch('/api/me', { credentials: 'include' });
        if (sessionRes.status === 401) {
          window.dispatchEvent(new CustomEvent('cronox:authRequired', { detail: { reason: 'favorites' } }));
          return;
        }
        if (!sessionRes.ok) {
          throw new Error('No se pudo verificar la sesión');
        }
      } catch (err) {
        console.error('[CRONOX] No se pudo verificar la sesión', err);
        return;
      }

      const currentlyFav = this.isFavorite(normId);
      const willBeFav = !currentlyFav;

      if (willBeFav) {
        this.ids.add(normId);
        btn.classList.add('is-favorite');
      } else {
        this.ids.delete(normId);
        btn.classList.remove('is-favorite');
      }
      this.updateTopbarCount();
      this.emitChange();

      try {
        let res;
        if (willBeFav) {
          res = await fetch('/api/favorites', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: normId }),
          });
        } else {
          res = await fetch(`/api/favorites/${encodeURIComponent(normId)}`, {
            method: 'DELETE',
            credentials: 'include',
          });
        }

        if (!res.ok) {
          throw new Error('Error al sincronizar favorito');
        }
      } catch (err) {
        console.error('[CRONOX] Error actualizando favorito', err);
        if (willBeFav) {
          this.ids.delete(normId);
          btn.classList.remove('is-favorite');
        } else {
          this.ids.add(normId);
          btn.classList.add('is-favorite');
        }
        this.updateTopbarCount();
        this.emitChange();
        if (typeof showToast === 'function') {
          showToast('No se pudo actualizar tu favorito. Inténtalo de nuevo.');
        } else if (typeof window.showToast === 'function') {
          window.showToast('No se pudo actualizar tu favorito. Inténtalo de nuevo.');
        }
      }
    },
    updateDomState() {
      const buttons = document.querySelectorAll('.favorite-toggle[data-product-id]');
      buttons.forEach((btn) => {
        const productId = btn.dataset.productId || btn.getAttribute('data-product-id');
        const normId = this.normalizeId(productId);
        if (!btn.dataset.favBound) {
          btn.dataset.favBound = '1';
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.toggleFromButton === 'function') {
              window.CRONOX_FAVORITES.toggleFromButton(btn);
            }
          });
        }
        if (normId && this.isFavorite(normId)) btn.classList.add('is-favorite');
        else btn.classList.remove('is-favorite');
      });
    },
    updateTopbarCount() {
      const topbarFav = document.querySelector('.topbar__fav');
      const badge = topbarFav?.querySelector('.favorites-count, .fav-count');
      const count = this.ids.size;
      let target = badge || null;
      if (!target && topbarFav && count > 0) {
        target = document.createElement('span');
        target.className = 'fav-count';
        topbarFav.appendChild(target);
      }

      if (!target) return;

      if (count > 0) {
        target.textContent = String(count);
        target.style.display = 'inline-block';
        target.hidden = false;
      } else {
        target.textContent = '';
        target.style.display = 'none';
        target.hidden = true;
      }
    },
    emitChange() {
      window.dispatchEvent(new CustomEvent('cronox:favsChanged', {
        detail: { ids: new Set(this.ids) },
      }));
    },
  };

  window.CRONOX_FAVORITES = FavoritesManager;

  window.fetchFavoritesIds = async () => {
    if (!window.CRONOX_FAVORITES) return new Set();
    if (!window.CRONOX_FAVORITES.initDone) window.CRONOX_FAVORITES.init();
    await window.CRONOX_FAVORITES.loadFromServer();
    return window.CRONOX_FAVORITES.ids;
  };

  window.updateFavoritesBadge = () => {
    if (!window.CRONOX_FAVORITES) return;
    window.CRONOX_FAVORITES.updateTopbarCount();
  };

  // Sincroniza favoritos desde el backend y refresca la UI
  const initFavoritesFromBackend = async () => {
    if (!window.CRONOX_FAVORITES) return new Set();
    if (!window.CRONOX_FAVORITES.initDone) window.CRONOX_FAVORITES.init();
    const ids = await window.CRONOX_FAVORITES.loadFromServer();
    window.CRONOX_FAVORITES.updateDomState();
    window.CRONOX_FAVORITES.updateTopbarCount();
    return ids;
  };

  window.initFavoritesFromBackend = initFavoritesFromBackend;

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.initFavoritesFromBackend === 'function') window.initFavoritesFromBackend();
  });

  // ===== Carrito (API + Drawer) =====
  const cartCountEl = $('.topbar__cart .cart-count');
  const toast = document.getElementById('toast');
  const CART_LOCK_KEY = 'cart-drawer';
  const FREE_SHIPPING_THRESHOLD = 65 * 100; // 65€ en céntimos
  const CHECKOUT_URL = '/checkout.html';
  const CONTINUE_SHOPPING_URL = '/index.html#store';

  const formatMoney = (() => {
    const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
    return (cents) => EUR.format((Number(cents) || 0) / 100);
  })();

  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const cartState = { data: null, drawerOpen: false };
  const pendingItemUpdates = new Map();
  const queuedItemQty = new Map();
  const qtyInputTimers = new Map();
  const cartItemErrors = new Map();
  const ITEM_DEBOUNCE_MS = 320;

  const setCartUiState = (isOpen) => {
    const body = document.body;
    if (body) body.classList.toggle('cart-open', isOpen);
    if (topbar) topbar.classList.toggle('topbar--cart-open', isOpen);
    setActiveTopbarIcon(isOpen ? 'cart' : getPageActiveIconType());
  };

  function updateBadge(cart) {
    const source = cart || cartState.data;
    const count = source?.itemsCount ?? 0;
    if (cartCountEl) {
      cartCountEl.textContent = String(clamp(count, 0, 999));
      cartCountEl.hidden = count <= 0;
    }
  }
  window.updateCartBadge = (q) => {
    if (cartCountEl) {
      cartCountEl.textContent = String(clamp(q, 0, 999));
      cartCountEl.hidden = q <= 0;
    }
  };

  const fetchCart = async () => {
    if (!API || typeof API.getCart !== 'function') {
      console.warn('[CRONOX] La API de carrito no está disponible');
      updateBadge();
      return null;
    }
    try {
      const cart = await API.getCart();
      cartState.data = cart;
      updateBadge(cart);
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
      return cart;
    } catch (error) {
      console.warn('[CRONOX] No se pudo sincronizar el carrito con la API', error);
      updateBadge();
      return null;
    }
  };

  // Sincroniza el carrito desde el backend y refresca el badge
  const initCartFromBackend = async () => {
    const cart = await fetchCart();
    updateBadge(cart);
    return cart;
  };

  const addCartItem = async ({ variantId, qty }) => {
    if (!API?.addCartItem) throw new Error('API de carrito no disponible');
    const cart = await API.addCartItem({ variantId, qty });
    cartState.data = cart;
    updateBadge(cart);
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    return cart;
  };

  const updateCartItem = async (itemId, qty) => {
    if (!API?.updateCartItem) throw new Error('API de carrito no disponible');
    const cart = await API.updateCartItem(itemId, qty);
    cartState.data = cart;
    updateBadge(cart);
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    return cart;
  };

  const removeCartItem = async (itemId) => {
    if (!API?.removeCartItem) throw new Error('API de carrito no disponible');
    const cart = await API.removeCartItem(itemId);
    cartState.data = cart;
    updateBadge(cart);
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    return cart;
  };

  const clearCartItems = async () => {
    if (!API?.clearCart) throw new Error('API de carrito no disponible');
    const cart = await API.clearCart();
    cartState.data = cart;
    updateBadge(cart);
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
    return cart;
  };

  async function addToCartLine(item) {
    const qty = Math.max(1, Number(item.qty) || 1);
    if (!item.variantId) {
      console.error('[CRONOX] Falta variantId para añadir al carrito');
      return;
    }
    try {
      const cart = await addCartItem({ variantId: item.variantId, qty });
      showToast('Añadido al carrito ✓');
      if (cartState.drawerOpen) renderCartDrawer(cart);
    } catch (error) {
      console.error('[CRONOX] Error añadiendo al carrito', error);
      showToast('No se pudo añadir al carrito');
    }
  }

  const cartOverlayEl = $('#cart-overlay');
  const cartDrawerEl = $('#cart-drawer');
  const cartItemsContainer = $('#cart-items-container');
  const cartEmptyState = $('#cart-empty-state');
  const cartSubtotalEl = $('#cart-subtotal');
  const cartFreeShippingSection = cartDrawerEl ? $('.cart-free-shipping', cartDrawerEl) : null;
  const freeShippingTextEl = $('#free-shipping-text');
  const freeShippingBarFill = $('#free-shipping-bar-fill');
  const cartUpsellList = $('#cart-upsell-list');
  const cartUpsellSection = $('#cart-upsell-section');
  const checkoutBtn = $('#cart-checkout-btn');
  const cartCloseBtn = $('#cart-close-btn');
  const cartFooter = cartDrawerEl ? $('.cart-drawer__footer', cartDrawerEl) : null;

  const toggleDrawer = (open) => {
    if (!cartOverlayEl || !cartDrawerEl) return;
    cartState.drawerOpen = Boolean(open);
    setCartUiState(cartState.drawerOpen);
    if (open) {
      cartOverlayEl.hidden = false;
      cartDrawerEl.hidden = false;
      requestAnimationFrame(() => {
        cartOverlayEl.classList.add('is-visible');
        cartDrawerEl.classList.add('is-visible');
      });
      lockScroll(CART_LOCK_KEY);
    } else {
      cartOverlayEl.classList.remove('is-visible');
      cartDrawerEl.classList.remove('is-visible');
      setTimeout(() => {
        cartOverlayEl.hidden = true;
        cartDrawerEl.hidden = true;
      }, 260);
      unlockScroll(CART_LOCK_KEY);
    }
  };

  const closeCartDrawer = () => toggleDrawer(false);

  const openCartDrawer = async () => {
    toggleDrawer(true);
    const cart = await fetchCart();
    renderCartDrawer(cart);
  };

  const renderFreeShipping = (subtotalCents = 0) => {
    if (!freeShippingBarFill || !freeShippingTextEl) return;
    const progress = clamp(subtotalCents / FREE_SHIPPING_THRESHOLD, 0, 1);
    freeShippingBarFill.style.width = `${progress * 100}%`;

    if (subtotalCents >= FREE_SHIPPING_THRESHOLD) {
      freeShippingTextEl.textContent = '¡Envío gratuito conseguido!';
      freeShippingBarFill.dataset.state = 'complete';
    } else {
      const remaining = FREE_SHIPPING_THRESHOLD - subtotalCents;
      freeShippingTextEl.textContent = `Te faltan ${formatMoney(remaining)} para conseguir envío gratuito`;
      delete freeShippingBarFill.dataset.state;
    }
  };

  const getUpsellCandidates = (cart) => {
    const catalog = Array.isArray(window.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : [];
    if (!catalog.length) return [];
    const cartIds = new Set((cart?.items || []).map((it) => it.product?.id));
    return catalog.filter((p) => !cartIds.has(p.backendId || p.id)).slice(0, 6);
  };

  const renderUpsell = (cart) => {
    if (!cartUpsellList || !cartUpsellSection) return;
    const candidates = getUpsellCandidates(cart);
    cartUpsellList.innerHTML = '';
    if (!candidates.length) {
      cartUpsellSection.hidden = true;
      return;
    }
    cartUpsellSection.hidden = false;
    const frag = document.createDocumentFragment();
    candidates.forEach((product) => {
      const variant = Array.isArray(product.variants) ? product.variants[0] : null;
      if (!variant) return;
      const card = document.createElement('article');
      card.className = 'cart-upsell__item';
      card.innerHTML = `
        <div class="cart-upsell__media">
          <div class="cart-upsell__image-frame">
            <img src="${product.image || product.images?.[0] || 'assets/logo_banner.png'}" alt="${product.name}" loading="lazy">
          </div>
        </div>
        <div class="cart-upsell__info">
          <p class="cart-upsell__name">${product.name}</p>
          <p class="cart-upsell__price">${product.priceLabel || formatMoney(product.priceCents)}</p>
          <button class="cart-upsell__add" data-variant="${variant.id}" type="button">Añadir</button>
        </div>
      `;
      frag.appendChild(card);
    });
    cartUpsellList.appendChild(frag);
  };

  const getCartItemImage = (item) => {
    const fallbackLogo = 'assets/logo_banner.png';
    const normalizeImage = (img) => {
      if (!img) return '';
      if (typeof img === 'string') return img;
      if (typeof img?.url === 'string') return img.url;
      return '';
    };

    const product = item?.product || {};
    const productImages = Array.isArray(product.images)
      ? product.images.map(normalizeImage).filter(Boolean)
      : [];
    const itemImages = Array.isArray(item?.images)
      ? item.images.map(normalizeImage).filter(Boolean)
      : [];

    const candidates = [
      normalizeImage(item?.imageUrl),
      normalizeImage(product.image || product.imageUrl),
      productImages[0],
      normalizeImage(item?.image),
      itemImages[0],
    ];

    const imageUrl = candidates.find(Boolean);
    return imageUrl || fallbackLogo;
  };

  const renderCartEmptyState = (message = 'Tu cesta está vacía.', { showCta = false } = {}) => {
    if (!cartEmptyState) return;

    cartEmptyState.innerHTML = '';
    const text = document.createElement('p');
    text.textContent = message;
    cartEmptyState.appendChild(text);

    if (showCta) {
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'btn-primary cart-empty__cta';
      cta.textContent = 'Seguir comprando';
      cta.addEventListener('click', () => {
        closeCartDrawer();
        window.location.href = CONTINUE_SHOPPING_URL;
      });
      cartEmptyState.appendChild(cta);
    }

    cartEmptyState.hidden = false;
  };

  const renderCartItems = (cart) => {
    if (!cartItemsContainer) return;
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const hasItems = items.length > 0;

    const validIds = new Set(items.map((item) => item.id));
    Array.from(cartItemErrors.keys()).forEach((id) => {
      if (!validIds.has(id)) cartItemErrors.delete(id);
    });

    cartItemsContainer.classList.toggle('is-empty', !hasItems);

    if (!hasItems) {
      cartItemsContainer.innerHTML = '';
      renderCartEmptyState('No tienes productos en tu carrito todavía.', { showCta: true });
      return;
    }

    if (cartEmptyState) cartEmptyState.hidden = true;

    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const lineTotal = (Number(item.priceCents) || 0) * (Number(item.qty) || 0);
      const imageUrl = getCartItemImage(item);
      const article = document.createElement('article');
      article.className = 'cart-line';
      article.dataset.cartLine = item.id;

      const isPending = pendingItemUpdates.has(item.id);
      if (isPending) article.classList.add('is-updating');
      const itemError = cartItemErrors.get(item.id);

      article.innerHTML = `
        <div class="cart-line__media">
          <div class="cart-line__image-frame">
            <img src="${imageUrl}" alt="${item.product?.name || ''}" loading="lazy">
          </div>
        </div>
        <div class="cart-line__info">
          <div class="cart-line__title">
            <p class="cart-line__name">${item.product?.name || 'Producto CRONOX'}</p>
            ${item.size ? `<span class="cart-line__meta">Talla: ${String(item.size).toUpperCase()}</span>` : ''}
          </div>
          <div class="cart-line__actions">
            <div class="cart-qty" data-id="${item.id}">
              <button class="cart-qty__btn" data-action="dec" aria-label="Reducir cantidad" data-id="${item.id}" ${isPending ? 'disabled' : ''}>−</button>
              <input
                type="number"
                class="cart-qty__input"
                min="1"
                max="999"
                step="1"
                value="${item.qty}"
                data-id="${item.id}"
                data-last-commit="${item.qty}"
                aria-label="Cantidad"
                ${isPending ? 'disabled' : ''}
              />
              <button class="cart-qty__btn" data-action="inc" aria-label="Aumentar cantidad" data-id="${item.id}" ${isPending ? 'disabled' : ''}>+</button>
            </div>
            <div class="cart-line__price">${formatMoney(lineTotal)}</div>
            <button class="cart-line__remove" data-remove="${item.id}" aria-label="Eliminar artículo">🗑</button>
          </div>
        </div>
      `;
      if (itemError) {
        const errorEl = document.createElement('p');
        errorEl.className = 'cart-line__error';
        errorEl.textContent = itemError;
        article.appendChild(errorEl);
      }
      frag.appendChild(article);
    });
    cartItemsContainer.innerHTML = '';
    cartItemsContainer.appendChild(frag);
  };

  const renderCartDrawer = (cart) => {
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const hasItems = items.length > 0;

    if (cartFreeShippingSection) cartFreeShippingSection.hidden = !hasItems;
    if (cartUpsellSection) cartUpsellSection.hidden = !hasItems;
    if (cartFooter) cartFooter.hidden = !hasItems;

    renderCartItems(cart);

    if (!hasItems) {
      if (cartSubtotalEl) cartSubtotalEl.textContent = '—';
      if (freeShippingBarFill) freeShippingBarFill.style.width = '0%';
      return;
    }

    const subtotalCents = cart?.subtotalCents || 0;
    renderFreeShipping(subtotalCents);
    renderUpsell(cart);
    if (cartSubtotalEl) cartSubtotalEl.textContent = formatMoney(subtotalCents);
  };

  const applyOptimisticQty = (itemId, nextQty) => {
    if (!cartState.data || !Array.isArray(cartState.data.items)) return null;
    const desiredQty = Math.max(1, Number(nextQty) || 1);
    let touched = false;

    const nextItems = cartState.data.items.map((item) => {
      if (item.id !== itemId) return item;
      touched = true;
      return { ...item, qty: desiredQty };
    });

    if (!touched) return null;

    const subtotalCents = nextItems.reduce(
      (sum, item) => sum + (Number(item.priceCents) || 0) * (Number(item.qty) || 0),
      0,
    );
    const itemsCount = nextItems.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);

    const nextCart = { ...cartState.data, items: nextItems, subtotalCents, itemsCount };
    cartState.data = nextCart;
    renderCartDrawer(nextCart);
    return nextCart;
  };

  const syncCartLineUiState = (itemId) => {
    if (!cartItemsContainer || !itemId) return;
    const line = cartItemsContainer.querySelector(`[data-cart-line="${itemId}"]`);
    if (!line) return;
    const isPending = pendingItemUpdates.has(itemId);
    line.classList.toggle('is-updating', isPending);
    line.querySelectorAll('.cart-qty__btn, .cart-qty__input').forEach((el) => {
      el.disabled = isPending;
    });
  };

  const setCartItemError = (itemId, message) => {
    if (!itemId) return;
    if (message) cartItemErrors.set(itemId, message);
    else cartItemErrors.delete(itemId);
  };

  const parseCartErrorMessage = (error) => {
    const rawMessage = error?.payload?.message || error?.message || '';
    if (typeof rawMessage === 'string' && rawMessage.toUpperCase().includes('INSUFFICIENT_STOCK')) {
      return 'No hay stock suficiente para esta cantidad.';
    }
    return 'No se pudo actualizar el carrito en este momento.';
  };

  const handleCartUpdateError = async (itemId, error) => {
    console.error('[CRONOX] No se pudo actualizar la cantidad', error);
    setCartItemError(itemId, parseCartErrorMessage(error));
    const refreshed = await fetchCart();
    if (refreshed) renderCartDrawer(refreshed);
    else renderCartDrawer(cartState.data);
  };

  const processQueuedUpdate = async (itemId) => {
    if (!queuedItemQty.has(itemId)) return;
    const targetQty = queuedItemQty.get(itemId);
    queuedItemQty.delete(itemId);

    pendingItemUpdates.set(itemId, true);
    setCartItemError(itemId, '');
    syncCartLineUiState(itemId);
    applyOptimisticQty(itemId, targetQty);

    try {
      const cart = await updateCartItem(itemId, targetQty);
      setCartItemError(itemId, '');
      renderCartDrawer(cart);
    } catch (error) {
      await handleCartUpdateError(itemId, error);
    } finally {
      pendingItemUpdates.delete(itemId);
      syncCartLineUiState(itemId);
      if (queuedItemQty.has(itemId)) {
        await processQueuedUpdate(itemId);
      }
    }
  };

  const queueCartUpdate = (itemId, qty) => {
    if (!itemId) return;
    const normalizedQty = Math.max(1, Number(qty) || 1);
    queuedItemQty.set(itemId, normalizedQty);
    applyOptimisticQty(itemId, normalizedQty);
    if (!pendingItemUpdates.has(itemId)) {
      processQueuedUpdate(itemId);
    }
  };

  const handleQty = (itemId, dir) => {
    if (!itemId) return;
    const current = cartState.data?.items?.find((it) => it.id === itemId);
    const currentQty = Math.max(1, Number(current?.qty) || 1);
    const nextQty = dir === 'inc' ? currentQty + 1 : currentQty - 1;
    if (nextQty <= 0) {
      pendingItemUpdates.set(itemId, true);
      syncCartLineUiState(itemId);
      removeCartItem(itemId)
        .then((cart) => {
          setCartItemError(itemId, '');
          renderCartDrawer(cart);
        })
        .catch((error) => handleCartUpdateError(itemId, error))
        .finally(() => {
          pendingItemUpdates.delete(itemId);
          syncCartLineUiState(itemId);
        });
      return;
    }
    queueCartUpdate(itemId, nextQty);
  };

  const bindCartDrawerEvents = () => {
    if (cartOverlayEl) {
      cartOverlayEl.addEventListener('click', (ev) => {
        if (ev.target === cartOverlayEl) closeCartDrawer();
      });
    }
    cartCloseBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeCartDrawer();
    });

    checkoutBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();

      const itemsCount = cartState.data?.itemsCount ?? 0;
      if (!itemsCount) {
        renderCartEmptyState('No tienes productos en tu carrito todavía.', { showCta: true });
        return;
      }

      window.location.href = CHECKOUT_URL;
    });

    cartItemsContainer?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.cart-qty__btn');
      if (btn) {
        ev.preventDefault();
        const dir = btn.dataset.action === 'dec' ? 'dec' : 'inc';
        const id = Number(btn.dataset.id);
        handleQty(id, dir);
        return;
      }
      const removeBtn = ev.target.closest('[data-remove]');
      if (removeBtn) {
        ev.preventDefault();
        const id = Number(removeBtn.dataset.remove);
        pendingItemUpdates.set(id, true);
        syncCartLineUiState(id);
        removeCartItem(id)
          .then((cart) => {
            setCartItemError(id, '');
            renderCartDrawer(cart);
          })
          .catch((error) => {
            console.error('[CRONOX] No se pudo eliminar el artículo', error);
            setCartItemError(id, parseCartErrorMessage(error));
            fetchCart().then(renderCartDrawer);
          })
          .finally(() => {
            pendingItemUpdates.delete(id);
            syncCartLineUiState(id);
          });
      }
    });

    const scheduleQtyCommit = (itemId, value, immediate = false) => {
      const normalized = Math.max(1, Number(value) || 1);
      const existing = qtyInputTimers.get(itemId);
      if (existing) clearTimeout(existing);
      if (immediate) {
        qtyInputTimers.delete(itemId);
        queueCartUpdate(itemId, normalized);
        return;
      }
      const timer = window.setTimeout(() => {
        qtyInputTimers.delete(itemId);
        queueCartUpdate(itemId, normalized);
      }, ITEM_DEBOUNCE_MS);
      qtyInputTimers.set(itemId, timer);
    };

    const commitQtyInput = (input, immediate = false) => {
      const itemId = Number(input.dataset.id);
      let value = parseInt(input.value, 10);
      if (!Number.isFinite(value) || value < 1) value = 1;
      const lastCommit = Number(input.dataset.lastCommit);
      if (Number.isFinite(lastCommit) && lastCommit === value && !immediate) {
        input.value = String(value);
        return;
      }
      input.value = String(value);
      input.dataset.lastCommit = String(value);
      applyOptimisticQty(itemId, value);
      scheduleQtyCommit(itemId, value, immediate);
    };

    cartItemsContainer?.addEventListener('change', (ev) => {
      const qtyInput = ev.target.closest('.cart-qty__input');
      if (!qtyInput) return;
      commitQtyInput(qtyInput);
    });

    cartItemsContainer?.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const qtyInput = ev.target.closest('.cart-qty__input');
      if (!qtyInput) return;
      ev.preventDefault();
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    cartItemsContainer?.addEventListener('blur', (ev) => {
      const qtyInput = ev.target.closest('.cart-qty__input');
      if (!qtyInput) return;
      let value = parseInt(qtyInput.value, 10);
      if (!Number.isFinite(value) || value < 1) value = 1;
      qtyInput.value = String(value);
      commitQtyInput(qtyInput, true);
    }, true);

    cartUpsellList?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.cart-upsell__add');
      if (!btn) return;
      ev.preventDefault();
      const variantId = Number(btn.dataset.variant) || btn.dataset.variant;
      addCartItem({ variantId, qty: 1 })
        .then((cart) => {
          showToast('Añadido al carrito ✓');
          renderCartDrawer(cart);
        })
        .catch((error) => {
          console.error('[CRONOX] No se pudo añadir sugerido', error);
          showToast('No se pudo añadir el producto');
        });
    });

    const cartIcon = cartTopbarIcon || document.getElementById('cart-icon-btn');
    if (cartIcon) {
      cartIcon.addEventListener('click', (ev) => {
        ev.preventDefault();
        openCartDrawer();
      });
    }

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && cartState.drawerOpen) {
        closeCartDrawer();
      }
    });
  };

  const initCartDrawer = () => {
    if (!cartOverlayEl || !cartDrawerEl) return;
    bindCartDrawerEvents();
  };

  window.CRONOX_CART = {
    fetchCart,
    addCartItem,
    updateCartItem,
    removeCartItem,
    clearCartItems,
    openCartDrawer,
    closeCartDrawer,
    renderCartDrawer,
    get state() { return cartState; },
  };

  window.initCartFromBackend = initCartFromBackend;

  // 1) Click en “+” abre Quick-Add (no añade directamente)
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.fav-add');
    if (!addBtn) return;
    e.preventDefault(); e.stopPropagation();
    const card = addBtn.closest('.product-card');
    const pid = card?.getAttribute('data-id') || card?.dataset?.id;
    if (pid && typeof window.CRONOX_openQuickAddById === 'function') {
      window.CRONOX_openQuickAddById(pid);
    }
  });

  // 2) El panel Quick-Add manda este evento para añadir
  window.addEventListener('cronox:addToCart', (ev) => {
    const item = ev?.detail;
    if (!item) return;
    addToCartLine(item);
  });

  // Inicializar badge + drawer
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.initCartFromBackend === 'function') window.initCartFromBackend();
    initCartDrawer();
  });

  // Saneado: eliminar cualquier .card-plus heredado
  $$('.card-plus').forEach((el)=>el.remove());
  try{
    const mo=new MutationObserver((muts)=>{
      muts.forEach((m)=>m.addedNodes&&m.addedNodes.forEach((n)=>{
        if(!(n instanceof HTMLElement)) return;
        if(n.matches?.('.card-plus')) n.remove();
        $$('.card-plus', n).forEach((x)=>x.remove());
      }));
    });
    mo.observe(document.documentElement,{childList:true,subtree:true});
  }catch{}
})();

// [AUTH] Lógica de sesión y modal
window.CRONOX_USER = window.CRONOX_USER || null;

(function () {
  const AUTH_HTML_PATH = 'auth-modal.html';
  const AUTH_LOCK_KEY = 'auth-modal';
  let authOverlay;
  let authDialog;
  let loginForm;
  let registerForm;
  let messageEl;
  let profileBtn;
  let userMenu;
  let authTitle;
  let loginEmail;
  let loginPassword;
  let registerFirstName;
  let registerLastName;
  let registerEmail;
  let registerPassword;
  let listenersBound = false;
  let authLoaded = false;
  let currentView = 'login';
  let loginErrorMessage = '';
  let registerErrorMessage = '';

  const lockBody = () => {
    if (typeof window.CRONOX_lockScroll === 'function') window.CRONOX_lockScroll(AUTH_LOCK_KEY);
    else document.body.classList.add('CRONOX_lockScroll');
  };

  const unlockBody = () => {
    if (typeof window.CRONOX_unlockScroll === 'function') window.CRONOX_unlockScroll(AUTH_LOCK_KEY);
    else document.body.classList.remove('CRONOX_lockScroll');
  };

  const setAuthMessage = (msg, type = 'info') => {
    if (!messageEl) return;
    messageEl.textContent = msg || '';
    if (msg) messageEl.dataset.state = type;
    else delete messageEl.dataset.state;
  };

  // Re-sincroniza datos dependientes de usuario tras login/registro
  const refreshUserDependentUI = async () => {
    const safeCalls = [];
    if (typeof window.initFavoritesFromBackend === 'function') {
      safeCalls.push(Promise.resolve()
        .then(() => window.initFavoritesFromBackend())
        .catch((err) => console.warn('[AUTH] No se pudieron sincronizar favoritos tras login', err)));
    }
    if (typeof window.initCartFromBackend === 'function') {
      safeCalls.push(Promise.resolve()
        .then(() => window.initCartFromBackend())
        .catch((err) => console.warn('[AUTH] No se pudo sincronizar carrito tras login', err)));
    }
    await Promise.all(safeCalls);
  };

  const selectAuthView = (view) => {
    currentView = view === 'register' ? 'register' : 'login';
    document.querySelectorAll('.cronox-auth__view').forEach((v) => {
      v.classList.toggle('is-active', v.dataset.authView === currentView);
    });
    if (authTitle) authTitle.textContent = currentView === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    const storedMessage = currentView === 'login' ? loginErrorMessage : registerErrorMessage;
    setAuthMessage(storedMessage, storedMessage ? 'error' : 'info');
  };

  const positionUserMenu = () => {
    if (!userMenu || !profileBtn) return;

    const rect = profileBtn.getBoundingClientRect();
    const menuWidth = userMenu.offsetWidth;
    const padding = 20; // margen lateral mínimo

    let left = rect.left + window.scrollX - 30;

    // Si se sale por la derecha → reajusta
    if (left + menuWidth + padding > window.innerWidth) {
      left = window.innerWidth - menuWidth - padding;
    }

    // Si se va demasiado a la izquierda → empuja hacia dentro
    if (left < padding) {
      left = padding;
    }

    userMenu.style.left = `${left}px`;
    userMenu.style.top = `${rect.bottom + window.scrollY + 12}px`;
  };

  const hideUserMenu = () => {
    if (!userMenu) return;
    userMenu.classList.remove('is-open');
    userMenu.hidden = true;
    document.removeEventListener('click', handleOutsideMenu, true);
  };

  const showUserMenu = () => {
    if (!userMenu || !profileBtn) return;
    positionUserMenu();
    const label = userMenu.querySelector('[data-auth-user-label]');
    if (label) label.textContent = window.CRONOX_USER?.email || 'Mi cuenta';
    userMenu.hidden = false;
    requestAnimationFrame(() => userMenu.classList.add('is-open'));
    document.addEventListener('click', handleOutsideMenu, true);
  };

  const toggleUserMenu = () => {
    if (!userMenu) return;
    if (userMenu.hidden || !userMenu.classList.contains('is-open')) showUserMenu();
    else hideUserMenu();
  };

  const handleOutsideMenu = (ev) => {
    if (!userMenu || userMenu.hidden) return;
    if (userMenu.contains(ev.target) || profileBtn?.contains(ev.target)) return;
    hideUserMenu();
  };

  const openAuthModal = (initialView = 'login') => {
    if (!authOverlay) return;
    hideUserMenu();
    selectAuthView(initialView);
    authOverlay.classList.add('is-open');
    authOverlay.classList.remove('auth-hidden');
    authOverlay.setAttribute('aria-hidden', 'false');
    lockBody();
    const focusInput = initialView === 'register' ? registerEmail : loginEmail;
    if (focusInput) setTimeout(() => focusInput.focus({ preventScroll: true }), 60);
  };

  const closeAuthModal = () => {
    if (!authOverlay) return;
    authOverlay.classList.remove('is-open');
    authOverlay.classList.add('auth-hidden');
    authOverlay.setAttribute('aria-hidden', 'true');
    unlockBody();
    loginErrorMessage = '';
    registerErrorMessage = '';
    setAuthMessage('');
  };

  const updateProfileIconUI = () => {
    if (!profileBtn) return;
    if (window.CRONOX_USER) {
      profileBtn.setAttribute('data-auth-state', 'logged');
      profileBtn.title = window.CRONOX_USER.email || 'Mi cuenta';
    } else {
      hideUserMenu();
      profileBtn.setAttribute('data-auth-state', 'guest');
      profileBtn.title = 'Iniciar sesión';
    }
    syncTopbarActiveIcon();
  };

  const parseAuthError = (err) => {
    if (!err) return 'Ha ocurrido un error. Inténtalo de nuevo.';
    if (typeof err === 'string') return err;
    if (err?.message) {
      if (String(err.message).toUpperCase().includes('INSUFFICIENT_STOCK')) {
        return 'No se ha podido iniciar sesión. Revisa tus credenciales.';
      }
      return err.message;
    }
    return 'No se ha podido completar la acción.';
  };

  const handleForgot = () => {
    setAuthMessage('Revisa tu correo o contacta con soporte para recuperar tu acceso.', 'info');
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    if (!window.CRONOX_API?.login) {
      setAuthMessage('Servicio de login no disponible.', 'error');
      return;
    }

    const email = loginEmail?.value.trim();
    const password = loginPassword?.value;

    if (!email || !password) {
      loginErrorMessage = 'Rellena email y contraseña.';
      setAuthMessage(loginErrorMessage, 'error');
      return;
    }

    try {
      loginErrorMessage = '';
      setAuthMessage('Iniciando sesión...');
      const user = await window.CRONOX_API.login({ email, password });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user })); } catch {}
      await refreshUserDependentUI();
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] login error', err);
      loginErrorMessage = parseAuthError(err) || 'No se ha podido iniciar sesión.';
      setAuthMessage(loginErrorMessage, 'error');
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    if (!window.CRONOX_API?.register) {
      setAuthMessage('Servicio de registro no disponible.', 'error');
      return;
    }

    const firstName = registerFirstName?.value.trim();
    const lastName = registerLastName?.value.trim();
    const email = registerEmail?.value.trim();
    const password = registerPassword?.value;

    if (!firstName || !lastName || !email || !password) {
      registerErrorMessage = 'Rellena todos los campos.';
      setAuthMessage(registerErrorMessage, 'error');
      return;
    }

    try {
      registerErrorMessage = '';
      setAuthMessage('Creando cuenta...');
      const user = await window.CRONOX_API.register({ firstName, lastName, email, password });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user })); } catch {}
      await refreshUserDependentUI();
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] register error', err);
      registerErrorMessage = parseAuthError(err) || 'No se ha podido crear la cuenta.';
      setAuthMessage(registerErrorMessage, 'error');
    }
  };

  const handleLogout = async () => {
    hideUserMenu();
    if (window.CRONOX_API?.logout) {
      try { await window.CRONOX_API.logout(); }
      catch (err) { console.warn('[AUTH] logout error', err); }
    }
    window.CRONOX_USER = null;
    updateProfileIconUI();
    await refreshUserDependentUI();
    try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: null })); } catch {}
  };

  const handleOverlayClick = (ev) => {
    if (ev.target === authOverlay) closeAuthModal();
  };

  const handleEsc = (ev) => {
    if (ev.key === 'Escape' && authOverlay?.classList.contains('is-open')) closeAuthModal();
  };

  const bindAuthEvents = () => {
    if (listenersBound) return;
    listenersBound = true;

    profileBtn = document.getElementById('profileBtn');
    if (profileBtn) {
      profileBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (window.CRONOX_USER) toggleUserMenu();
        else openAuthModal('login');
      });
    }

    authOverlay?.addEventListener('click', handleOverlayClick);
    authDialog?.addEventListener('click', (ev) => ev.stopPropagation());
    document.addEventListener('keydown', handleEsc);
    document.querySelectorAll('[data-auth-switch]').forEach((btn) => {
      btn.addEventListener('click', () => selectAuthView(btn.dataset.authSwitch));
    });

    // [AUTH] Abrir página de recuperar contraseña -> redirigir a forgot-password.html
    document.querySelectorAll('[data-auth-forgot]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        window.location.href = 'forgot-password.html';
      });
    });

    loginForm?.addEventListener('submit', handleLoginSubmit);
    registerForm?.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('authCloseBtn')?.addEventListener('click', closeAuthModal);

    if (userMenu) {
      userMenu.addEventListener('click', (ev) => {
        const action = ev.target.closest('[data-user-action]')?.dataset.userAction;
        if (action === 'logout') handleLogout();
        if (action === 'account') {
          hideUserMenu();
          window.location.href = 'profile.html';
        }
      });
      window.addEventListener('resize', () => {
        if (!userMenu || userMenu.hidden) return;
        positionUserMenu();
      });

      window.addEventListener('scroll', () => {
        if (!userMenu || userMenu.hidden) return;
        positionUserMenu();
      }, { passive: true });
    }
  };

  const cacheElements = () => {
    authOverlay = document.getElementById('authOverlay');
    authDialog = authOverlay?.querySelector('.cronox-auth__dialog') || null;
    loginForm = document.getElementById('authLoginForm');
    registerForm = document.getElementById('authRegisterForm');
    messageEl = document.getElementById('authMessage');
    authTitle = document.getElementById('authTitle');
    loginEmail = document.getElementById('authLoginEmail');
    loginPassword = document.getElementById('authLoginPassword');
    registerFirstName = document.getElementById('authRegisterFirstName');
    registerLastName = document.getElementById('authRegisterLastName');
    registerEmail = document.getElementById('authRegisterEmail');
    registerPassword = document.getElementById('authRegisterPassword');
    userMenu = document.getElementById('authUserMenu');
  };

  const ensureAuthModal = async () => {
    if (authLoaded) return true;
    try {
      const res = await fetch(AUTH_HTML_PATH, { cache: 'no-cache' });
      const html = await res.text();
      const temp = document.createElement('div');
      temp.innerHTML = html;

      document.querySelectorAll('#authOverlay').forEach((el) => el.remove());
      document.querySelectorAll('#authUserMenu').forEach((el) => el.remove());

      const overlay = temp.querySelector('#authOverlay');
      const menu = temp.querySelector('#authUserMenu');
      if (overlay) document.body.appendChild(overlay);
      if (menu) document.body.appendChild(menu);
      authLoaded = true;
      return true;
    } catch (err) {
      console.error('[AUTH] No se pudo cargar auth-modal.html', err);
      return false;
    }
  };

  const initAuthState = async () => {
    if (!window.CRONOX_API?.getMe) return;
    try {
      const user = await window.CRONOX_API.getMe();
      window.CRONOX_USER = user;
      updateProfileIconUI();
      try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user })); } catch {}
      await refreshUserDependentUI();
    } catch (err) {
      console.warn('[AUTH] No se pudo obtener el usuario actual', err);
    }
  };

  // Exponer funciones globales por compatibilidad
  window.CRONOX_openAuthModal = openAuthModal;
  window.CRONOX_closeAuthModal = closeAuthModal;
  window.CRONOX_logout = handleLogout;

  // ===== Newsletter Popup =====
  const NEWSLETTER_STORAGE_KEY = 'cronoxNewsletterShown';
  const BTN_LABEL_IDLE = 'UNIRSE';
  const BTN_LABEL_LOADING = 'ENVIANDO…';
  const newsletterState = {
    overlay: null,
    modal: null,
    closeBtn: null,
    form: null,
    emailInput: null,
    submitBtn: null,
    feedback: null,
  };

  const persistNewsletterDismiss = () => {
    try {
      sessionStorage.setItem(NEWSLETTER_STORAGE_KEY, 'true');
    } catch (error) {
      console.warn('[CRONOX] No se pudo persistir la preferencia de newsletter', error);
    }
  };

  const setNewsletterFeedback = (message, kind = '') => {
    if (!newsletterState.feedback) return;
    newsletterState.feedback.textContent = message || '';
    newsletterState.feedback.classList.remove(
      'newsletter-modal-feedback--error',
      'newsletter-modal-feedback--success',
    );
    if (kind === 'error') {
      newsletterState.feedback.classList.add('newsletter-modal-feedback--error');
    }
    if (kind === 'success') {
      newsletterState.feedback.classList.add('newsletter-modal-feedback--success');
    }
  };

  const setNewsletterLoading = (isLoading) => {
    if (newsletterState.submitBtn) {
      newsletterState.submitBtn.disabled = Boolean(isLoading);
      newsletterState.submitBtn.textContent = isLoading
        ? BTN_LABEL_LOADING
        : BTN_LABEL_IDLE;
    }
    if (newsletterState.emailInput) {
      newsletterState.emailInput.disabled = Boolean(isLoading);
    }
  };

  const closeNewsletterModal = () => {
    if (newsletterState.overlay) {
      newsletterState.overlay.classList.remove('newsletter-modal-overlay--visible');
    }
    unlockScroll('newsletter');
    persistNewsletterDismiss();
  };

  const openNewsletterModal = () => {
    if (!newsletterState.overlay) return;
    newsletterState.overlay.classList.add('newsletter-modal-overlay--visible');
    lockScroll('newsletter');
  };

  const shouldShowNewsletter = () => {
    if (typeof window === 'undefined') return false;
    if (window.CRONOX_USER) return false;
    try {
      const dismissed = sessionStorage.getItem(NEWSLETTER_STORAGE_KEY);
      if (dismissed === 'true') return false;
    } catch (error) {
      console.warn('[CRONOX] No se pudo leer el estado de newsletter', error);
    }

    return true;
  };

  const parseNewsletterResponse = async (response) => {
    try {
      return await response.json();
    } catch (error) {
      console.warn('[CRONOX] Respuesta inesperada de newsletter', error);
      return {};
    }
  };

  const handleNewsletterSubmit = async (event) => {
    event.preventDefault();
    if (!newsletterState.emailInput) return;

    const email = newsletterState.emailInput.value.trim();
    const emailRegex = /[^@\s]+@[^@\s]+\.[^@\s]+/;

    if (!emailRegex.test(email)) {
      setNewsletterFeedback('Introduce un email válido.', 'error');
      return;
    }

    if (typeof fetch !== 'function') {
      setNewsletterFeedback('Servicio no disponible en este navegador.', 'error');
      return;
    }

    setNewsletterLoading(true);
    setNewsletterFeedback('Enviando...');

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await parseNewsletterResponse(res);

      if (res.status === 201 || data.status === 'ok') {
        setNewsletterFeedback(
          'Te hemos enviado un correo con tu código de -10% en tu primera compra.',
          'success',
        );
        persistNewsletterDismiss();
        setTimeout(closeNewsletterModal, 1200);
        return;
      }

      if (res.status === 200 && data.status === 'already_subscribed') {
        setNewsletterFeedback('Ya estabas dentro. Revisa tu bandeja para el código.', 'success');
        persistNewsletterDismiss();
        return;
      }

      if (res.status === 409 || data.status === 'already_registered') {
        setNewsletterFeedback(
          'Este correo ya tiene cuenta en CRONOX. Inicia sesión para usar tus beneficios.',
          'error',
        );
        persistNewsletterDismiss();
        return;
      }

      setNewsletterFeedback('Ha habido un problema, inténtalo de nuevo.', 'error');
    } catch (error) {
      console.error('[CRONOX] Error al enviar newsletter', error);
      setNewsletterFeedback('Ha habido un problema, inténtalo de nuevo.', 'error');
    } finally {
      setNewsletterLoading(false);
    }
  };

  const bindNewsletterEvents = () => {
    if (newsletterState.overlay) {
      newsletterState.overlay.addEventListener('click', (ev) => {
        if (ev.target === newsletterState.overlay) closeNewsletterModal();
      });
    }

    newsletterState.closeBtn?.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeNewsletterModal();
    });

    newsletterState.form?.addEventListener('submit', handleNewsletterSubmit);
  };

  const cacheNewsletterElements = () => {
    newsletterState.overlay = document.querySelector('.newsletter-modal-overlay');
    newsletterState.modal = newsletterState.overlay?.querySelector('.newsletter-modal') || null;
    newsletterState.closeBtn = newsletterState.overlay?.querySelector('.newsletter-modal-close') || null;
    newsletterState.form = document.getElementById('newsletterForm');
    newsletterState.emailInput = document.getElementById('newsletterEmail');
    newsletterState.submitBtn = newsletterState.overlay?.querySelector('.newsletter-modal-button') || null;
    if (newsletterState.submitBtn) {
      newsletterState.submitBtn.textContent = BTN_LABEL_IDLE;
    }
    newsletterState.feedback = document.getElementById('newsletterFeedback');
  };

  const initNewsletterModal = () => {
    cacheNewsletterElements();
    if (!newsletterState.overlay || !newsletterState.modal) return;

    bindNewsletterEvents();

    try {
      if (sessionStorage.getItem(NEWSLETTER_STORAGE_KEY) === 'true') return;
    } catch (error) {
      console.warn('[CRONOX] No se pudo leer el estado de newsletter', error);
    }

    setTimeout(() => {
      try {
        if (sessionStorage.getItem(NEWSLETTER_STORAGE_KEY) === 'true') return;
      } catch (error) {
        console.warn('[CRONOX] No se pudo leer el estado de newsletter', error);
      }

      if (shouldShowNewsletter()) {
        openNewsletterModal();
      }
    }, 3000);
  };

  document.addEventListener('DOMContentLoaded', () => {
    initNewsletterModal();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const ready = await ensureAuthModal();
    if (!ready) return;

    cacheElements();
    bindAuthEvents();

    if (authOverlay) {
      authOverlay.classList.add('auth-hidden');
    }

    updateProfileIconUI();
    await initAuthState();

    // [AUTH] Abrir automáticamente el modal de login
    // si venimos de la página de "Recuperar contraseña"
    try {
      const flag = localStorage.getItem('cronox_open_auth_on_load');
      if (flag === 'login') {
        localStorage.removeItem('cronox_open_auth_on_load');
        openAuthModal('login');
      }
    } catch (err) {
      console.warn('[AUTH] No se pudo leer cronox_open_auth_on_load', err);
    }
  });
})();
