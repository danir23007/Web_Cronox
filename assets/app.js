/* ==========================================================
   CRONOX — app.js (v47)
   - Click en .fav-add abre Quick-Add (panel vertical)
   - El panel emite "cronox:addToCart" para añadir al carrito
   ========================================================== */

(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

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

  // ===== Favoritos (estrella) — opcional =====
  const favCountEl = $('.topbar__fav .fav-count');
  let favCount = Number(favCountEl?.textContent || 0);
  const bumpFavCount = (d) => {
    favCount = clamp(favCount + d, 0, 999);
    if (favCountEl) favCountEl.textContent = String(favCount);
  };
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.fav-toggle');
    if (!toggle) return;
    e.preventDefault(); e.stopPropagation();
    const active = toggle.classList.toggle('active');
    bumpFavCount(active ? 1 : -1);
  });

  // ===== Carrito (localStorage) =====
  const cartCountEl = $('.topbar__cart .cart-count');
  const readCart = () => { try { return JSON.parse(localStorage.getItem('cronox_cart')||'[]'); } catch { return []; } };
  const writeCart = (cart) => { try { localStorage.setItem('cronox_cart', JSON.stringify(cart)); } catch {} };
  const totalQty = (cart) => cart.reduce((a,it)=>a+(Number(it.qty)||0),0);
  function updateBadge(){ const t = totalQty(readCart()); if (cartCountEl) cartCountEl.textContent = String(clamp(t,0,999)); }
  window.updateCartBadge = (q)=>{ if (cartCountEl) cartCountEl.textContent = String(clamp(q,0,999)); };

  function addToCartLine(item){
    const cart = readCart();
    const i = cart.findIndex(x => x.id===item.id && x.size===item.size && x.color===item.color);
    if (i>=0) cart[i].qty = (Number(cart[i].qty)||0) + (Number(item.qty)||1);
    else cart.push({ ...item, qty: Number(item.qty)||1, addedAt: Date.now() });
    writeCart(cart);
    updateBadge();
    window.dispatchEvent(new Event('cart:updated'));
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
  document.addEventListener('DOMContentLoaded', updateBadge);
  window.addEventListener('storage', (e)=>{ if (e.key==='cronox_cart') updateBadge(); });

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
