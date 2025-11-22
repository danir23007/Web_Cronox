/* ==========================================================
   CRONOX — app.js (v47)
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

  // ===== Topbar =====
  const topbar = $('.topbar');
  const hero = $('.hero-video-section');

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

  function activateTopbarIcon() {
    const body = document.body;
    if (!body) return;

    const favoritesIcon = document.querySelector('.topbar-icon-favorites');
    const cartIcon = document.querySelector('.topbar-icon-cart');
    const userIcon = document.querySelector('.topbar-icon-user');

    const markActive = (el) => {
      if (!el) return;
      el.classList.add('active');
      el.setAttribute('aria-current', 'page');
    };

    if (body.classList.contains('page-favorites')) markActive(favoritesIcon);
    if (body.classList.contains('page-cart')) markActive(cartIcon);
    if (body.classList.contains('page-login')) markActive(userIcon);
  }

  document.addEventListener('DOMContentLoaded', activateTopbarIcon);

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
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
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
        const sessionRes = await fetch('/api/auth/me', { credentials: 'include' });
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

  document.addEventListener('DOMContentLoaded', () => {
    if (window.CRONOX_FAVORITES && !window.CRONOX_FAVORITES.initDone) {
      window.CRONOX_FAVORITES.init();
    }
  });

  // ===== Carrito (API + fallback local) =====
  const cartCountEl = $('.topbar__cart .cart-count');
  const cartFallbackKey = 'cronox_cart';
  const toast = document.getElementById('toast');
  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const readFallbackCart = () => {
    try {
      const raw = localStorage.getItem(cartFallbackKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const writeFallbackCart = (cart) => {
    try { localStorage.setItem(cartFallbackKey, JSON.stringify(cart)); }
    catch {}
  };
  const totalQtyFallback = (cart) => cart.reduce((a, it) => a + (Number(it.qty) || 0), 0);

  const cartState = { data: null };

  function updateBadge(cart) {
    const source = cart || cartState.data;
    const count = source?.itemsCount ?? totalQtyFallback(readFallbackCart());
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

  const refreshCartFromApi = async () => {
    if (!API || typeof API.getCart !== 'function') {
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

  async function addToCartLine(item) {
    const qty = Math.max(1, Number(item.qty) || 1);
    if (API && typeof API.addCartItem === 'function' && item.variantId) {
      try {
        const cart = await API.addCartItem({ variantId: item.variantId, qty });
        cartState.data = cart;
        updateBadge(cart);
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
        showToast('Añadido al carrito ✓');
        return;
      } catch (error) {
        console.error('[CRONOX] Error añadiendo al carrito remoto', error);
      }
    }

    const cart = readFallbackCart();
    const idx = cart.findIndex((x) => x.id === item.id && x.size === item.size && x.color === item.color);
    if (idx >= 0) {
      cart[idx].qty = (Number(cart[idx].qty) || 0) + qty;
    } else {
      cart.push({ ...item, qty, addedAt: Date.now() });
    }
    writeFallbackCart(cart);
    const fallbackCart = { itemsCount: totalQtyFallback(cart) };
    updateBadge();
    window.dispatchEvent(new CustomEvent('cart:updated', { detail: fallbackCart }));
    showToast('Añadido al carrito ✓');
  }

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

  // Inicializar badge
  document.addEventListener('DOMContentLoaded', () => {
    refreshCartFromApi();
    updateBadge();
  });
  window.addEventListener('storage', (e)=>{ if (e.key===cartFallbackKey) updateBadge(); });

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
  let registerName;
  let registerEmail;
  let registerPassword;
  let listenersBound = false;
  let authLoaded = false;
  let currentView = 'login';

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

  const selectAuthView = (view) => {
    currentView = view === 'register' ? 'register' : 'login';
    document.querySelectorAll('.cronox-auth__view').forEach((v) => {
      v.classList.toggle('is-active', v.dataset.authView === currentView);
    });
    if (authTitle) authTitle.textContent = currentView === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    setAuthMessage('');
  };

  const positionUserMenu = () => {
    if (!userMenu || !profileBtn) return;
    const rect = profileBtn.getBoundingClientRect();
    userMenu.style.top = `${rect.bottom + window.scrollY + 12}px`;
    userMenu.style.left = `${rect.left + window.scrollX - 30}px`;
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
  };

  const parseAuthError = (err) => {
    if (!err) return 'Ha ocurrido un error. Inténtalo de nuevo.';
    if (typeof err === 'string') return err;
    if (err?.message) return err.message;
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
      setAuthMessage('Rellena email y contraseña.', 'error');
      return;
    }

    try {
      setAuthMessage('Iniciando sesión...');
      const user = await window.CRONOX_API.login({ email, password });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user })); } catch {}
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] login error', err);
      setAuthMessage(parseAuthError(err) || 'No se ha podido iniciar sesión.', 'error');
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    if (!window.CRONOX_API?.register) {
      setAuthMessage('Servicio de registro no disponible.', 'error');
      return;
    }

    const name = registerName?.value.trim() || undefined;
    const email = registerEmail?.value.trim();
    const password = registerPassword?.value;

    if (!email || !password) {
      setAuthMessage('Rellena email y contraseña.', 'error');
      return;
    }

    try {
      setAuthMessage('Creando cuenta...');
      const user = await window.CRONOX_API.register({ email, password, name });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: user })); } catch {}
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] register error', err);
      setAuthMessage(parseAuthError(err) || 'No se ha podido crear la cuenta.', 'error');
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
    document.querySelectorAll('[data-auth-forgot]').forEach((btn) => {
      btn.addEventListener('click', handleForgot);
    });
    loginForm?.addEventListener('submit', handleLoginSubmit);
    registerForm?.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('authCloseBtn')?.addEventListener('click', closeAuthModal);

    if (userMenu) {
      userMenu.addEventListener('click', (ev) => {
        const action = ev.target.closest('[data-user-action]')?.dataset.userAction;
        if (action === 'logout') handleLogout();
        if (action === 'account') hideUserMenu();
      });
      window.addEventListener('resize', () => { if (!userMenu.hidden) positionUserMenu(); });
      window.addEventListener('scroll', () => { if (!userMenu.hidden) positionUserMenu(); }, { passive: true });
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
    registerName = document.getElementById('authRegisterName');
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
    } catch (err) {
      console.warn('[AUTH] No se pudo obtener el usuario actual', err);
    }
  };

  // Exponer funciones globales por compatibilidad
  window.CRONOX_openAuthModal = openAuthModal;
  window.CRONOX_closeAuthModal = closeAuthModal;
  window.CRONOX_logout = handleLogout;

  document.addEventListener('DOMContentLoaded', async () => {
    const ready = await ensureAuthModal();
    if (!ready) return;
    cacheElements();
    bindAuthEvents();
    if (authOverlay) authOverlay.classList.add('auth-hidden');
    updateProfileIconUI();
    initAuthState();
  });
})();
