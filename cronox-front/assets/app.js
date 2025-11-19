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

  // ===== Favoritos (estrella) — backend =====
  const favCountEl = $('.topbar__fav .fav-count');
  let favCount = Number(favCountEl?.textContent || 0);
  const renderFavCount = (value) => { // [FAVORITES_BACKEND_ONLY]
    if (!favCountEl) return;
    if (value > 0) {
      favCountEl.hidden = false;
      favCountEl.textContent = String(value);
    } else {
      favCountEl.hidden = true;
    }
  };
  const readFavCount = (detail) => { // [FAVORITES_BACKEND_ONLY]
    if (Array.isArray(detail)) return detail.length;
    const favs = window.CRONOX_FAVORITES;
    if (favs?.ids instanceof Set) return favs.ids.size;
    if (Array.isArray(favs?.list)) return favs.list.length;
    if (Array.isArray(favs)) return favs.length;
    if (typeof favs?.count === 'number') return favs.count;
    return 0;
  };
  const syncFavCount = (detail) => { // [FAVORITES_BACKEND_ONLY]
    favCount = clamp(readFavCount(detail), 0, 999);
    renderFavCount(favCount);
  };
  document.addEventListener('DOMContentLoaded', () => syncFavCount(), { once: true });
  window.addEventListener('cronox:favsChanged', (e) => syncFavCount(e?.detail));

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
  function selectAuthTab(tab) {
    const tabs = document.querySelectorAll('.auth-tab');
    const views = document.querySelectorAll('.auth-view');

    tabs.forEach((t) => {
      t.classList.toggle('auth-tab--active', t.dataset.authTab === tab);
    });

    views.forEach((v) => {
      v.classList.toggle('auth-view--active', v.dataset.authView === tab);
    });
  }

  function setAuthMessage(msg) {
    const el = document.getElementById('authMessage');
    if (el) el.textContent = msg || '';
  }

  function openAuthModal(initialTab) {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return;
    overlay.classList.remove('auth-hidden');
    document.body.classList.add('CRONOX_lockScroll'); // si ya usas esto para otros overlays
    selectAuthTab(initialTab || 'login');
    setAuthMessage('');
  }

  function closeAuthModal() {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return;
    overlay.classList.add('auth-hidden');
    document.body.classList.remove('CRONOX_lockScroll');
    setAuthMessage('');
  }

  async function initAuthState() {
    if (!window.CRONOX_API || !window.CRONOX_API.getMe) return;

    const user = await window.CRONOX_API.getMe();
    window.CRONOX_USER = user;

    updateProfileIconUI();
  }

  function updateProfileIconUI() {
    const profileBtn = document.getElementById('profileBtn');
    if (!profileBtn) return;

    if (window.CRONOX_USER) {
      profileBtn.setAttribute('data-auth-state', 'logged');
      profileBtn.title = window.CRONOX_USER.email || 'Mi cuenta';
    } else {
      profileBtn.setAttribute('data-auth-state', 'guest');
      profileBtn.title = 'Iniciar sesión';
    }
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    if (!window.CRONOX_API || !window.CRONOX_API.login) return;

    const emailInput = document.getElementById('authLoginEmail');
    const passInput = document.getElementById('authLoginPassword');

    const email = emailInput?.value.trim();
    const password = passInput?.value;

    if (!email || !password) {
      setAuthMessage('Rellena email y contraseña.');
      return;
    }

    try {
      setAuthMessage('Iniciando sesión...');
      const user = await window.CRONOX_API.login({ email, password });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] login error', err);
      setAuthMessage('No se ha podido iniciar sesión. Revisa tus datos.');
    }
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    if (!window.CRONOX_API || !window.CRONOX_API.register) return;

    const nameInput = document.getElementById('authRegisterName');
    const emailInput = document.getElementById('authRegisterEmail');
    const passInput = document.getElementById('authRegisterPassword');

    const name = nameInput?.value.trim() || undefined;
    const email = emailInput?.value.trim();
    const password = passInput?.value;

    if (!email || !password) {
      setAuthMessage('Rellena email y contraseña.');
      return;
    }

    try {
      setAuthMessage('Creando cuenta...');
      const user = await window.CRONOX_API.register({ email, password, name });
      window.CRONOX_USER = user;
      updateProfileIconUI();
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] register error', err);
      setAuthMessage('No se ha podido crear la cuenta.');
    }
  }

  async function handleLogout() {
    if (!window.CRONOX_API || !window.CRONOX_API.logout) return;
    try {
      await window.CRONOX_API.logout();
    } catch (err) {
      console.warn('[AUTH] logout error', err);
    }
    window.CRONOX_USER = null;
    updateProfileIconUI();
  }

  // Exponer funciones globales por si las necesitas
  window.CRONOX_openAuthModal = openAuthModal;
  window.CRONOX_closeAuthModal = closeAuthModal;
  window.CRONOX_logout = handleLogout;

  document.addEventListener('DOMContentLoaded', () => {
    const profileBtn = document.getElementById('profileBtn');
    const overlay = document.getElementById('authOverlay');
    const closeBtn = document.getElementById('authCloseBtn');
    const loginForm = document.getElementById('authLoginForm');
    const registerForm = document.getElementById('authRegisterForm');
    const tabs = document.querySelectorAll('.auth-tab');

    if (profileBtn) {
      profileBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (window.CRONOX_USER) {
          // De momento, si estás logueado, mostramos opción de logout directa
          const confirmed = confirm('¿Cerrar sesión?');
          if (confirmed) {
            handleLogout();
          }
        } else {
          openAuthModal('login');
        }
      });
    }

    if (overlay && closeBtn) {
      closeBtn.addEventListener('click', closeAuthModal);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          closeAuthModal();
        }
      });
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        selectAuthTab(tab.dataset.authTab);
        setAuthMessage('');
      });
    });

    if (loginForm) {
      loginForm.addEventListener('submit', handleLoginSubmit);
    }

    if (registerForm) {
      registerForm.addEventListener('submit', handleRegisterSubmit);
    }

    // [AUTH] Asegurar modal oculto al cargar y estado de sesión inicial
    if (overlay) {
      overlay.classList.add('auth-hidden');
    }

    // Inicializar estado de sesión
    initAuthState();
  });
})();
