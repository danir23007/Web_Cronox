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
  const getCsrfHeaders = async () => {
    const provider = window.CRONOX_API?.getCsrfHeaders;
    return typeof provider === 'function' ? provider() : {};
  };
  const apiEndpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;

  const TOPBAR_STATES = ['topbar--transparent', 'topbar--hero', 'topbar--page'];

  // ===== Preloader =====
  const revealStorefront = () => {
    const body = document.body;
    const preloader = document.getElementById('preloader');
    if (preloader?.dataset.persistent === 'true') return;
    if (!body || body.classList.contains('is-loaded')) return;
    const shouldRemovePreloader = Boolean(preloader);
    body.classList.remove('is-loading');
    body.classList.add('is-loaded');
    try { window.dispatchEvent(new CustomEvent('cronox:storefront-ready')); } catch {}
    // Preserve the existing CSS transition before removing its overlay.
    if (shouldRemovePreloader) setTimeout(() => {
      // Removing an <img> from the DOM does not cancel its pending load.
      // Release only the finished loader's image so it cannot delay window.load.
      preloader.querySelectorAll('img').forEach((image) => {
        image.removeAttribute('srcset');
        image.removeAttribute('src');
      });
      preloader.remove();
    }, 600);
  };
  const scheduleStorefrontReveal = () => {
    // Deferred scripts and styles are ready at DOMContentLoaded. Allow the
    // browser to lay out the page without waiting for below-fold media.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(revealStorefront));
    } else revealStorefront();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleStorefrontReveal, { once: true });
  } else scheduleStorefrontReveal();
  window.addEventListener('load', revealStorefront, { once: true });

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
    if (document.documentElement.classList.contains('category-page')) {
      return 'topbar--page';
    }
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
  if (topbar && document.documentElement.classList.contains('category-page')) {
    applyTopbarState('topbar--page');
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
  const searchForm = searchBar ? $('#searchForm', searchBar) : null;
  const searchCloseBtn = searchBar ? $('.searchbar__close', searchBar) : null;
  let searchActive = false;
  let searchPrevTopbarState = '';
  let searchLockedTopbar = false;
  let searchHideTimer = 0;
  let searchSuggestionsPanel = null;
  let searchSuggestionsList = null;
  let searchSuggestionsStatus = null;
  let searchSuggestionItems = [];
  let highlightedSuggestion = -1;
  let searchDebounceTimer = 0;
  let searchRequestSequence = 0;

  const normalizeSearchQuery = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100);

  const ensureSearchSuggestions = () => {
    if (!searchForm || !searchInput || searchSuggestionsPanel) return;
    const panelId = 'searchSuggestions';
    const listId = `${panelId}List`;

    searchSuggestionsPanel = document.createElement('div');
    searchSuggestionsPanel.id = panelId;
    searchSuggestionsPanel.className = 'search-suggestions';
    searchSuggestionsPanel.hidden = true;

    searchSuggestionsList = document.createElement('div');
    searchSuggestionsList.id = listId;
    searchSuggestionsList.className = 'search-suggestions__list';
    searchSuggestionsList.setAttribute('role', 'listbox');
    searchSuggestionsList.setAttribute('aria-label', 'Sugerencias de productos');

    searchSuggestionsStatus = document.createElement('div');
    searchSuggestionsStatus.className = 'search-suggestions__status sr-only';
    searchSuggestionsStatus.setAttribute('role', 'status');
    searchSuggestionsStatus.setAttribute('aria-live', 'polite');
    searchSuggestionsStatus.setAttribute('aria-atomic', 'true');

    searchSuggestionsPanel.appendChild(searchSuggestionsList);
    searchForm.append(searchSuggestionsPanel, searchSuggestionsStatus);
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-haspopup', 'listbox');
    searchInput.setAttribute('aria-controls', listId);
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.setAttribute('maxlength', '100');
  };

  const announceSearchSuggestions = (message) => {
    if (!searchSuggestionsStatus) return;
    searchSuggestionsStatus.textContent = '';
    window.requestAnimationFrame(() => {
      if (searchSuggestionsStatus) searchSuggestionsStatus.textContent = message;
    });
  };

  const clearHighlightedSuggestion = () => {
    highlightedSuggestion = -1;
    searchInput?.removeAttribute('aria-activedescendant');
    searchSuggestionsList
      ?.querySelectorAll('[role="option"]')
      .forEach((option) => {
        option.classList.remove('is-highlighted');
        option.setAttribute('aria-selected', 'false');
      });
  };

  const hideSearchSuggestions = () => {
    clearHighlightedSuggestion();
    searchInput?.setAttribute('aria-expanded', 'false');
    if (searchSuggestionsPanel) searchSuggestionsPanel.hidden = true;
  };

  const showSuggestionState = (message, state) => {
    ensureSearchSuggestions();
    if (!searchSuggestionsList || !searchSuggestionsPanel) return;
    searchSuggestionItems = [];
    highlightedSuggestion = -1;
    searchInput?.removeAttribute('aria-activedescendant');
    searchSuggestionsList.replaceChildren();
    const status = document.createElement('div');
    status.className = `search-suggestions__state search-suggestions__state--${state}`;
    status.textContent = message;
    searchSuggestionsList.appendChild(status);
    searchSuggestionsPanel.hidden = false;
    searchInput?.setAttribute('aria-expanded', 'true');
    announceSearchSuggestions(message);
  };

  const getSuggestionHref = (product) => {
    if (product?.slug) return `/producto/${encodeURIComponent(product.slug)}`;
    return product?.id != null ? `/producto?id=${encodeURIComponent(product.id)}` : '#';
  };

  const setHighlightedSuggestion = (nextIndex) => {
    const options = Array.from(searchSuggestionsList?.querySelectorAll('[role="option"]') || []);
    if (!options.length) return;
    highlightedSuggestion = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      const isHighlighted = index === highlightedSuggestion;
      option.classList.toggle('is-highlighted', isHighlighted);
      option.setAttribute('aria-selected', String(isHighlighted));
      if (isHighlighted) {
        searchInput?.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const renderSearchSuggestions = (products) => {
    ensureSearchSuggestions();
    if (!searchSuggestionsList || !searchSuggestionsPanel) return;
    searchSuggestionItems = Array.isArray(products) ? products.slice(0, 8) : [];
    if (!searchSuggestionItems.length) {
      showSuggestionState('No se han encontrado productos.', 'empty');
      return;
    }

    highlightedSuggestion = -1;
    searchSuggestionsList.replaceChildren();
    searchSuggestionItems.forEach((product, index) => {
      const option = document.createElement('a');
      option.id = `searchSuggestion-${index}`;
      option.className = 'search-suggestions__option';
      option.href = getSuggestionHref(product);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const thumbnail = document.createElement('span');
      thumbnail.className = 'search-suggestions__thumbnail';
      if (product.image) {
        const image = document.createElement('img');
        if (window.CRONOX_IMAGES) window.CRONOX_IMAGES.applyProduct(image, product, 'small');
        else image.src = product.image;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          thumbnail.replaceChildren();
          const fallback = document.createElement('span');
          fallback.className = 'search-suggestions__image-fallback';
          fallback.textContent = 'Sin imagen';
          thumbnail.appendChild(fallback);
        }, { once: true });
        thumbnail.appendChild(image);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'search-suggestions__image-fallback';
        fallback.textContent = 'Sin imagen';
        thumbnail.appendChild(fallback);
      }

      const details = document.createElement('span');
      details.className = 'search-suggestions__details';
      const name = document.createElement('strong');
      name.className = 'search-suggestions__name';
      name.textContent = product.name || 'Producto CRONOX';
      const price = document.createElement('span');
      price.className = 'search-suggestions__price';
      price.textContent = product.priceLabel || '';
      details.append(name, price);
      option.append(thumbnail, details);
      // Hover is a transient CSS state. Clear any keyboard selection when the
      // pointer enters so leaving the row always restores its natural state.
      option.addEventListener('pointerenter', clearHighlightedSuggestion);
      option.addEventListener('click', hideSearchSuggestions);
      searchSuggestionsList.appendChild(option);
    });

    searchSuggestionsPanel.hidden = false;
    searchInput?.setAttribute('aria-expanded', 'true');
    announceSearchSuggestions(`${searchSuggestionItems.length} sugerencias disponibles.`);
  };

  const loadSearchSuggestions = async () => {
    ensureSearchSuggestions();
    const query = normalizeSearchQuery(searchInput?.value);
    if (!query) {
      searchRequestSequence += 1;
      searchSuggestionItems = [];
      hideSearchSuggestions();
      return;
    }

    const requestId = ++searchRequestSequence;
    showSuggestionState('Buscando productos…', 'loading');
    try {
      if (typeof API.getProductSuggestions !== 'function') {
        throw new Error('La búsqueda no está disponible.');
      }
      const products = await API.getProductSuggestions(query, {
        limit: 8,
      });
      if (requestId !== searchRequestSequence || query !== normalizeSearchQuery(searchInput?.value)) return;
      renderSearchSuggestions(products);
    } catch (error) {
      if (requestId !== searchRequestSequence) return;
      console.warn('[CRONOX] No se pudieron cargar las sugerencias.', error);
      showSuggestionState('No se pudieron cargar las sugerencias. Inténtalo de nuevo.', 'error');
    }
  };

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
    window.clearTimeout(searchDebounceTimer);
    searchRequestSequence += 1;
    hideSearchSuggestions();
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

  ensureSearchSuggestions();

  searchInput?.addEventListener('input', () => {
    window.clearTimeout(searchDebounceTimer);
    const query = normalizeSearchQuery(searchInput.value);
    if (!query) {
      searchRequestSequence += 1;
      searchSuggestionItems = [];
      hideSearchSuggestions();
      return;
    }
    searchDebounceTimer = window.setTimeout(loadSearchSuggestions, 250);
  });

  searchInput?.addEventListener('focus', () => {
    if (normalizeSearchQuery(searchInput.value) && searchSuggestionItems.length) {
      if (searchSuggestionsPanel) searchSuggestionsPanel.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
    }
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && searchSuggestionItems.length) {
      e.preventDefault();
      setHighlightedSuggestion(highlightedSuggestion + 1);
      return;
    }
    if (e.key === 'ArrowUp' && searchSuggestionItems.length) {
      e.preventDefault();
      setHighlightedSuggestion(highlightedSuggestion - 1);
      return;
    }
    if (e.key === 'Enter' && highlightedSuggestion >= 0) {
      const selected = searchSuggestionItems[highlightedSuggestion];
      if (!selected) return;
      e.preventDefault();
      window.location.href = getSuggestionHref(selected);
      return;
    }
    if (e.key === 'Escape' && searchSuggestionsPanel && !searchSuggestionsPanel.hidden) {
      e.preventDefault();
      e.stopPropagation();
      hideSearchSuggestions();
    }
  });

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = normalizeSearchQuery(searchInput?.value);
    if (!query) {
      hideSearchSuggestions();
      return;
    }
    hideSearchSuggestions();
    if (typeof window.CRONOX_handleStoreSearch === 'function') {
      window.CRONOX_handleStoreSearch(query);
      return;
    }

    const params = new URLSearchParams();
    params.set('search', query);
    window.location.href = `/tienda?${params.toString()}#store`;
  });

  document.addEventListener('click', (e) => {
    if (searchForm && !searchForm.contains(e.target)) hideSearchSuggestions();
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
    loadPromise: null,
    sessionEpoch: 0,
    revision: 0,
    anonymous: false,
    sessionObserved: false,
    serverFavorites: null,
    pendingProducts: new Set(),
    initDone: false,
    normalizeId(value) {
      const str = value == null ? '' : String(value).trim();
      return str || null;
    },
    init() {
      if (this.initDone) return;
      this.initDone = true;
    },
    invalidateSession() {
      this.sessionEpoch += 1;
      this.revision += 1;
      this.loadPromise = null;
      this.isLoading = false;
      this.ready = false;
      this.anonymous = false;
      this.serverFavorites = null;
      this.ids = new Set();
      this.pendingProducts.clear();
      window.CRONOX_FAVORITE_IDS = this.ids;
      this.updateDomState();
      this.updateTopbarCount();
    },
    loadFromServer({ force = false } = {}) {
      if (this.loadPromise) return this.loadPromise;
      if (this.ready && !force) return Promise.resolve(this.ids);
      const epoch = this.sessionEpoch;
      const revision = this.revision;
      this.isLoading = true;
      this.loadPromise = (async () => {
        try {
          // This endpoint is already protected by JwtAuthGuard. A separate /me
          // preflight duplicates session resolution and delays a trustworthy count.
          const res = await fetch(apiEndpoint('/api/favorites'), {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
          });
          if (epoch !== this.sessionEpoch || revision !== this.revision) return this.ids;
          if (res.status === 401) {
            this.anonymous = true;
            this.serverFavorites = [];
            this.setIdsFromServer([]);
            return this.ids;
          }
          if (!res.ok) throw new Error('Error al cargar favoritos');
          const favorites = await res.json();
          if (epoch !== this.sessionEpoch || revision !== this.revision) return this.ids;
          if (!Array.isArray(favorites)) throw new Error('Respuesta de favoritos inválida');
          this.anonymous = false;
          this.serverFavorites = favorites;
          this.setIdsFromServer(favorites);
          return this.ids;
        } catch (err) {
          console.error('[CRONOX] No se pudieron cargar favoritos', err);
          // Failure is not a trustworthy zero. Do not publish an invented count.
          if (epoch === this.sessionEpoch && revision === this.revision) {
            this.ready = false;
            this.updateTopbarCount();
          }
          return this.ids;
        } finally {
          if (epoch === this.sessionEpoch) {
            this.isLoading = false;
            this.loadPromise = null;
          }
        }
      })();
      return this.loadPromise;
    },
    setIdsFromServer(list) {
      const next = new Set();
      (Array.isArray(list) ? list : []).forEach((fav) => {
        const id = this.normalizeId(fav?.backendId ?? fav?.productId ?? fav?.id ?? fav?.product?.id ?? fav);
        if (id) next.add(id);
      });
      this.ids = next;
      this.revision += 1;
      this.ready = true;
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
      const epoch = this.sessionEpoch;
      await this.loadFromServer();
      if (epoch !== this.sessionEpoch || this.pendingProducts.has(normId)) return;
      if (!this.ready) return;

      try {
        const sessionRes = await fetch(apiEndpoint('/api/me'), { credentials: 'include' });
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
      if (epoch !== this.sessionEpoch || this.pendingProducts.has(normId)) return;
      this.pendingProducts.add(normId);
      this.revision += 1;
      this.serverFavorites = null;

      const currentlyFav = this.isFavorite(normId);
      const willBeFav = !currentlyFav;

      if (willBeFav) {
        this.ids.add(normId);
        btn.classList.add('is-favorite');
      } else {
        this.ids.delete(normId);
        btn.classList.remove('is-favorite');
      }
      this.updateDomState();
      this.updateTopbarCount();

      try {
        let res;
        if (willBeFav) {
          res = await fetch(apiEndpoint('/api/favorites'), {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) },
            body: JSON.stringify({ productId: normId }),
          });
        } else {
          res = await fetch(apiEndpoint('/api/favorites/' + encodeURIComponent(normId)), {
            method: 'DELETE',
            credentials: 'include',
            headers: await getCsrfHeaders(),
          });
        }

        if (!res.ok) {
          throw new Error('Error al sincronizar favorito');
        }
        if (epoch !== this.sessionEpoch) return;
        this.emitChange();
      } catch (err) {
        if (epoch !== this.sessionEpoch) return;
        console.error('[CRONOX] Error actualizando favorito', err);
        if (willBeFav) {
          this.ids.delete(normId);
          btn.classList.remove('is-favorite');
        } else {
          this.ids.add(normId);
          btn.classList.add('is-favorite');
        }
        this.updateDomState();
        this.updateTopbarCount();
        this.emitChange();
        if (typeof showToast === 'function') {
          showToast('No se pudo actualizar tu favorito. Inténtalo de nuevo.');
        } else if (typeof window.showToast === 'function') {
          window.showToast('No se pudo actualizar tu favorito. Inténtalo de nuevo.');
        }
      } finally {
        if (epoch === this.sessionEpoch) this.pendingProducts.delete(normId);
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
      const count = this.ready ? this.ids.size : 0;
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

  // Deferred app.js runs after the topbar has been parsed (including info-shell).
  // Start now, without waiting for later deferred scripts or the auth modal.
  void initFavoritesFromBackend();
  document.addEventListener('DOMContentLoaded', () => FavoritesManager.updateTopbarCount(), { once: true });
  window.addEventListener('cronox:userChanged', (event) => {
    if (event.initial && FavoritesManager.sessionObserved) return;
    FavoritesManager.sessionObserved = true;
    if (event.initial && event.detail && !FavoritesManager.anonymous) return;
    FavoritesManager.invalidateSession();
    if (event.detail) void FavoritesManager.loadFromServer();
    else {
      FavoritesManager.anonymous = true;
      FavoritesManager.ready = true;
      FavoritesManager.serverFavorites = [];
    }
  });
  window.addEventListener('cronox:session-ended', () => {
    FavoritesManager.sessionObserved = true;
    FavoritesManager.invalidateSession();
    FavoritesManager.anonymous = true;
    FavoritesManager.ready = true;
    FavoritesManager.serverFavorites = [];
  });
  // A restored bfcache page must not expose the previous session's badge.
  window.addEventListener('pagehide', () => FavoritesManager.invalidateSession());
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void FavoritesManager.loadFromServer();
  });

  // ===== Carrito (API + Drawer) =====
  const cartCountEl = $('.topbar__cart .cart-count');
  const toast = document.getElementById('toast');
  const CART_LOCK_KEY = 'cart-drawer';
  const FREE_SHIPPING_THRESHOLD = 65 * 100; // 65€ en céntimos
  const CHECKOUT_URL = '/checkout';
  const CONTINUE_SHOPPING_URL = '/tienda#store';
  const escapeHtml = (value) => {
    const helper = window.CRONOX_SECURITY?.escapeHtml;
    return typeof helper === 'function'
      ? helper(value)
      : String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  };
  const safeProductImage = (value, fallback = 'assets/product-image-unavailable.svg') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };

  const formatMoney = (() => {
    const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
    return (cents) => EUR.format((Number(cents) || 0) / 100);
  })();

  const formatCheckoutButtonMoney = (cents, currency = 'EUR') => {
    const normalizedCurrency = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase())
      ? String(currency).toUpperCase()
      : 'EUR';
    try {
      const parts = new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: normalizedCurrency,
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).formatToParts((Number(cents) || 0) / 100);
      const symbol = parts.find((part) => part.type === 'currency')?.value || normalizedCurrency;
      const amount = parts
        .filter((part) => part.type !== 'currency' && part.type !== 'literal')
        .map((part) => part.value)
        .join('');
      return `${amount} ${symbol}`;
    } catch (error) {
      return formatMoney(cents);
    }
  };

  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const cartState = { data: null, drawerOpen: false, status: 'loading', error: null, pending: 0 };
  // One queue for every entry point. In particular the first guest GET must
  // finish setting its ownership cookie before the first add is sent.
  let cartQueue = Promise.resolve();
  let cartRead = null;
  let cartVersion = 0;
  let cartOwner = 0;
  const pendingItemUpdates = new Map();
  const queuedItemQty = new Map();
  const cartItemErrors = new Map();

  const setCartUiState = (isOpen) => {
    const body = document.body;
    if (body) body.classList.toggle('cart-open', isOpen);
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

  const notifyCartState = () => {
    renderCartDrawer(cartState.data);
    window.dispatchEvent(new CustomEvent('cart:state', { detail: cartState }));
  };

  const publishCart = (cart) => {
    if (!cart || !Array.isArray(cart.items)) throw new Error('CART_RESPONSE_INVALID');
    cartState.data = cart;
    cartState.status = cart.items.length ? 'populated' : 'empty';
    cartState.error = null;
    updateBadge(cart);
    notifyCartState();
    window.dispatchEvent(Object.assign(new CustomEvent('cart:updated', { detail: cart }), { cartSource: true }));
    return cart;
  };

  const requestCart = (operation, mutation = false) => {
    const owner = cartOwner;
    if (mutation) cartRead = null;
    cartState.pending += 1;
    const task = cartQueue.then(async () => {
      if (owner !== cartOwner) return cartState.data;
      const version = cartVersion;
      cartState.status = 'loading';
      cartState.error = null;
      notifyCartState();
      try {
        const cart = await operation();
        if (owner === cartOwner && version === cartVersion) publishCart(cart);
        return cartState.data;
      } catch (error) {
        if (owner === cartOwner && version === cartVersion) {
          cartState.status = 'error';
          cartState.error = mutation
            ? 'No se pudo actualizar la cesta. Comprueba los artículos y vuelve a intentarlo.'
            : 'No se pudo cargar la cesta. Vuelve a intentarlo.';
          notifyCartState();
        }
        throw error;
      }
    }).finally(() => {
      cartState.pending -= 1;
      notifyCartState();
    });
    cartQueue = task.catch(() => undefined);
    return task;
  };

  const fetchCart = () => {
    if (cartRead) return cartRead;
    const task = requestCart(() => {
      if (!API?.getCart) throw new Error('CART_API_UNAVAILABLE');
      return API.getCart();
    });
    cartRead = task;
    task.finally(() => { if (cartRead === task) cartRead = null; }).catch(() => undefined);
    return task;
  };

  // Sincroniza el carrito desde el backend y refresca el badge
  const initCartFromBackend = async () => {
    return fetchCart();
  };

  const addCartItem = async ({ variantId, qty }) => {
    if (!API?.addCartItem) throw new Error('API de carrito no disponible');
    return requestCart(() => API.addCartItem({ variantId, qty }), true);
  };

  const updateCartItem = async (itemId, qty) => {
    if (!API?.updateCartItem) throw new Error('API de carrito no disponible');
    return requestCart(() => API.updateCartItem(itemId, qty), true);
  };

  const removeCartItem = async (itemId) => {
    if (!API?.removeCartItem) throw new Error('API de carrito no disponible');
    return requestCart(() => API.removeCartItem(itemId), true);
  };

  const clearCartItems = async () => {
    if (!API?.clearCart) throw new Error('API de carrito no disponible');
    return requestCart(() => API.clearCart(), true);
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
      return cart;
    } catch (error) {
      console.error('[CRONOX] Error añadiendo al carrito', error);
      showToast('No se pudo añadir al carrito');
      return null;
    }
  }

  const cartOverlayEl = $('#cart-overlay');
  const cartDrawerEl = $('#cart-drawer');
  const cartItemsContainer = $('#cart-items-container');
  const cartEmptyState = $('#cart-empty-state');
  const cartFreeShippingSection = cartDrawerEl ? $('.cart-free-shipping', cartDrawerEl) : null;
  const freeShippingTextEl = $('#free-shipping-text');
  const freeShippingBarFill = $('#free-shipping-bar-fill');
  const cartUpsellList = $('#cart-upsell-list');
  const cartUpsellSection = $('#cart-upsell-section');
  const checkoutBtn = $('#cart-checkout-btn');
  const cartCloseBtn = $('#cart-close-btn');
  const cartFooter = cartDrawerEl ? $('.cart-drawer__footer', cartDrawerEl) : null;
  const cartStatus = document.createElement('div');
  cartStatus.className = 'cart-status';
  cartStatus.setAttribute('role', 'status');
  cartStatus.hidden = true;
  cartItemsContainer?.before(cartStatus);
  const upsellProducts = new Map();
  const cartBackgroundInert = new Map();
  let cartAnimationFrame = 0;
  let cartReturnFocus = null;

  const setCartBackgroundInert = (isOpen) => {
    if (isOpen) {
      for (const element of document.body.children) {
        if (element === cartOverlayEl || element === cartDrawerEl || cartBackgroundInert.has(element)) continue;
        cartBackgroundInert.set(element, element.inert);
        element.inert = true;
      }
    } else {
      for (const [element, wasInert] of cartBackgroundInert) element.inert = wasInert;
      cartBackgroundInert.clear();
    }
  };

  const cartFocusable = () => Array.from(cartDrawerEl.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getClientRects().length);

  const toggleDrawer = (open) => {
    if (!cartOverlayEl || !cartDrawerEl) return;
    const nextOpen = Boolean(open);
    if (cartState.drawerOpen === nextOpen) return;
    cartState.drawerOpen = nextOpen;
    setCartUiState(nextOpen);
    if (cartAnimationFrame) cancelAnimationFrame(cartAnimationFrame);
    if (open) {
      cartReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      cartOverlayEl.hidden = false;
      cartDrawerEl.hidden = false;
      cartDrawerEl.inert = false;
      cartDrawerEl.setAttribute('role', 'dialog');
      cartDrawerEl.setAttribute('aria-modal', 'true');
      cartDrawerEl.setAttribute('aria-hidden', 'false');
      setCartBackgroundInert(true);
      cartAnimationFrame = requestAnimationFrame(() => {
        cartAnimationFrame = 0;
        cartOverlayEl.classList.add('is-visible');
        cartDrawerEl.classList.add('is-visible');
      });
      lockScroll(CART_LOCK_KEY);
      cartCloseBtn?.focus({ preventScroll: true });
    } else {
      cartOverlayEl.classList.remove('is-visible');
      cartDrawerEl.classList.remove('is-visible');
      cartOverlayEl.hidden = true;
      cartDrawerEl.hidden = true;
      cartDrawerEl.inert = true;
      cartDrawerEl.setAttribute('aria-hidden', 'true');
      cartDrawerEl.removeAttribute('aria-modal');
      setCartBackgroundInert(false);
      unlockScroll(CART_LOCK_KEY);
      const focusTarget = cartTopbarIcon || document.getElementById('cart-icon-btn') || cartReturnFocus;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      cartReturnFocus = null;
    }
  };

  const closeCartDrawer = () => {
    toggleDrawer(false);
  };

  const openCartDrawer = async () => {
    toggleDrawer(true);
    const panel = cartDrawerEl?.querySelector('.cart-drawer__panel');
    if (panel) panel.scrollTop = 0;
    renderCartDrawer(cartState.data);
    try { await fetchCart(); } catch { /* The shared error state provides retry. */ }
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
    upsellProducts.clear();
    const candidates = getUpsellCandidates(cart);
    cartUpsellList.innerHTML = '';
    if (!candidates.length) {
      cartUpsellSection.hidden = true;
      return;
    }
    cartUpsellSection.hidden = false;
    const frag = document.createDocumentFragment();
    candidates.forEach((product) => {
      const productKey = String(product.slug || product.backendId || product.id || '');
      if (!productKey) return;
      upsellProducts.set(productKey, product);
      const imageUrl = window.CRONOX_IMAGES?.resolveProduct(product, 'recommendation')?.src || safeProductImage(product.image || product.images?.[0]);
      const productName = escapeHtml(product.name || 'Producto CRONOX');
      const productPrice = escapeHtml(product.priceLabel || formatMoney(product.priceCents));
      const card = document.createElement('article');
      card.className = 'cart-upsell__item';
      card.dataset.upsellProduct = productKey;
      card.innerHTML = `
        <div class="cart-upsell__media">
          <div class="cart-upsell__image-frame">
            <img src="${escapeHtml(imageUrl)}" alt="${productName}" loading="lazy" referrerpolicy="no-referrer">
          </div>
        </div>
        <div class="cart-upsell__info">
          <p class="cart-upsell__name">${productName}</p>
          <p class="cart-upsell__price">${productPrice}</p>
        </div>
        <button class="cart-upsell__add" type="button" aria-label="Añadir rápidamente ${productName}">
          <span>Añadir</span>
          <span class="cart-upsell__add-icon" aria-hidden="true">+</span>
        </button>
      `;
      window.CRONOX_IMAGES?.applyProduct(
        card.querySelector('.cart-upsell__image-frame img'),
        product,
        'recommendation',
      );
      frag.appendChild(card);
    });
    cartUpsellList.appendChild(frag);
  };

  const getCartItemImage = (item) => {
    const canonical = window.CRONOX_IMAGES?.resolveProduct(item, 'cart');
    if (canonical?.src) return canonical.src;
    const fallbackImage = 'assets/product-image-unavailable.svg';
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
    return safeProductImage(imageUrl, fallbackImage);
  };

  const getCartItemImageRecord = (item) => {
    const canonical = window.CRONOX_IMAGES?.resolveProduct(item, 'cart');
    if (canonical?.record) return canonical.record;
    const selectedUrl = getCartItemImage(item);
    const records = [
      ...(Array.isArray(item?.product?.images) ? item.product.images : []),
      ...(Array.isArray(item?.images) ? item.images : []),
    ];
    return records.find((record) => (record?.url || record?.imageUrl) === selectedUrl) || { url: selectedUrl };
  };

  const renderCartEmptyState = (message = 'Tu cesta está vacía', { showCta = false } = {}) => {
    if (!cartEmptyState || !cartItemsContainer) return;

    cartEmptyState.innerHTML = '';

    const link = document.createElement('a');
    link.href = CONTINUE_SHOPPING_URL;
    link.textContent = message;
    link.className = 'cart-empty__message';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      closeCartDrawer();
      window.location.href = CONTINUE_SHOPPING_URL;
    });
    cartEmptyState.appendChild(link);

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
    cartItemsContainer.innerHTML = '';
    cartItemsContainer.appendChild(cartEmptyState);
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
      renderCartEmptyState('Tu cesta está vacía', { showCta: false });
      return;
    }

    if (cartEmptyState) {
      cartEmptyState.hidden = true;
      if (cartEmptyState.parentElement === cartItemsContainer) {
        cartEmptyState.remove();
      }
    }

    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const lineTotal = (Number(item.priceCents) || 0) * qty;
      const imageUrl = getCartItemImage(item);
      const article = document.createElement('article');
      article.className = 'cart-line';
      article.dataset.cartLine = String(item.id ?? '');

      const isPending = pendingItemUpdates.has(item.id);
      if (isPending) article.classList.add('is-updating');
      const itemError = cartItemErrors.get(item.id);
      const display = {
        id: escapeHtml(item.id ?? ''),
        qty,
        size: item.size ? escapeHtml(window.CRONOX_SIZES?.label?.(item.size) || String(item.size).toUpperCase()) : '',
        productName: escapeHtml(item.product?.name || 'Producto CRONOX'),
      };

      article.innerHTML = `
        <div class="cart-line__media">
          <div class="cart-line__image-frame">
            <img src="${escapeHtml(imageUrl)}" alt="${display.productName}" loading="lazy" referrerpolicy="no-referrer">
          </div>
        </div>
        <div class="cart-line__info">
          <div class="cart-line__title">
            <p class="cart-line__name">${display.productName}</p>
            <p class="cart-line__price">${formatMoney(lineTotal)}</p>
            ${display.size ? `<span class="cart-line__meta">Talla: ${display.size}</span>` : ''}
          </div>
          <div class="cart-line__actions">
            <div class="cart-qty" data-id="${display.id}">
              <button class="cart-qty__btn" data-action="dec" aria-label="Reducir cantidad" data-id="${display.id}" ${isPending ? 'disabled' : ''}>−</button>
              <input
                type="number"
                class="cart-qty__input"
                min="1"
                max="999"
                step="1"
                value="${display.qty}"
                data-id="${display.id}"
                data-last-commit="${display.qty}"
                aria-label="Cantidad"
                ${isPending ? 'disabled' : ''}
              />
              <button class="cart-qty__btn" data-action="inc" aria-label="Aumentar cantidad" data-id="${display.id}" ${isPending ? 'disabled' : ''}>+</button>
            </div>
            <button class="cart-line__remove" data-remove="${display.id}" aria-label="Eliminar artículo" ${isPending ? 'disabled' : ''}>🗑</button>
          </div>
        </div>
      `;
      window.CRONOX_IMAGES?.applyProduct(
        article.querySelector(".cart-line__image-frame img"),
        item,
        "cart",
      );
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
    // Callers never render an earlier request's return value over current data.
    cart = cartState.data;
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const hasItems = items.length > 0;
    const loading = cartState.status === 'loading';
    const failed = cartState.status === 'error';
    cartDrawerEl?.setAttribute('aria-busy', String(loading));
    cartStatus.hidden = !loading && !failed;
    cartStatus.replaceChildren();
    if (loading || failed) {
      const text = document.createElement('p');
      text.textContent = failed ? cartState.error : cart ? 'Actualizando cesta…' : 'Cargando cesta…';
      cartStatus.appendChild(text);
      if (failed) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Reintentar';
        retry.addEventListener('click', () => fetchCart().catch(() => undefined));
        cartStatus.appendChild(retry);
      }
    }

    if (checkoutBtn) {
      checkoutBtn.hidden = !hasItems;
      checkoutBtn.disabled = !hasItems || loading || failed || cartState.pending > 0;
    }

    if (cartFreeShippingSection) cartFreeShippingSection.hidden = !cart;
    if (cartUpsellSection) cartUpsellSection.hidden = false;
    if (cartFooter) cartFooter.hidden = false;

    if (cart) renderCartItems(cart);
    else cartItemsContainer?.replaceChildren();

    const subtotalCents = cart?.subtotalCents || 0;
    renderFreeShipping(hasItems ? subtotalCents : 0);
    if (cart) renderUpsell(cart);
    else if (cartUpsellSection) cartUpsellSection.hidden = true;
    if (checkoutBtn && hasItems) {
      checkoutBtn.textContent = `Finalizar compra · ${formatCheckoutButtonMoney(
        subtotalCents,
        cart?.currency,
      )}`;
    }
  };

  const syncCartLineUiState = (itemId) => {
    if (!cartItemsContainer || !itemId) return;
    const line = cartItemsContainer.querySelector(`[data-cart-line="${itemId}"]`);
    if (!line) return;
    const isPending = pendingItemUpdates.has(itemId);
    line.classList.toggle('is-updating', isPending);
    line.querySelectorAll('.cart-qty__btn, .cart-qty__input, .cart-line__remove').forEach((el) => {
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
    try { await fetchCart(); } catch { /* Preserve the last known cart and error. */ }
    renderCartDrawer(cartState.data);
  };

  const processQueuedUpdate = async (itemId) => {
    if (!queuedItemQty.has(itemId)) return;
    const targetQty = queuedItemQty.get(itemId);
    queuedItemQty.delete(itemId);

    pendingItemUpdates.set(itemId, true);
    setCartItemError(itemId, '');
    syncCartLineUiState(itemId);

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
            fetchCart().catch(() => undefined);
          })
          .finally(() => {
            pendingItemUpdates.delete(id);
            syncCartLineUiState(id);
          });
      }
    });

    const commitQtyInput = (input) => {
      const itemId = Number(input.dataset.id);
      let value = parseInt(input.value, 10);
      if (!Number.isFinite(value) || value < 1) value = 1;
      const lastCommit = Number(input.dataset.lastCommit);
      if (Number.isFinite(lastCommit) && lastCommit === value) {
        input.value = String(value);
        return;
      }
      input.value = String(value);
      input.dataset.lastCommit = String(value);
      queueCartUpdate(itemId, value);
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

    cartUpsellList?.addEventListener('click', (ev) => {
      const addButton = ev.target.closest('.cart-upsell__add');
      if (!addButton) return;
      ev.preventDefault();
      ev.stopPropagation();
      const card = addButton.closest('.cart-upsell__item');
      if (!card) return;
      const product = upsellProducts.get(card.dataset.upsellProduct || '');
      if (product && typeof window.CRONOX_openQuickAdd === 'function') {
        window.CRONOX_openQuickAdd(product);
      }
    });

    const cartIcon = cartTopbarIcon || document.getElementById('cart-icon-btn');
    if (cartIcon) {
      cartIcon.addEventListener('click', (ev) => {
        ev.preventDefault();
        openCartDrawer();
      });
    }

    document.addEventListener('keydown', (ev) => {
      if (!cartState.drawerOpen) return;
      if (document.getElementById('quickAdd')?.getAttribute('aria-hidden') === 'false') return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        closeCartDrawer();
        return;
      }
      if (ev.key !== 'Tab') return;
      const focusable = cartFocusable();
      if (!focusable.length) {
        ev.preventDefault();
        cartCloseBtn?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !cartDrawerEl.contains(document.activeElement))) {
        ev.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!ev.shiftKey && (document.activeElement === last || !cartDrawerEl.contains(document.activeElement))) {
        ev.preventDefault();
        first.focus({ preventScroll: true });
      }
    }, true);
    document.addEventListener('focusin', (ev) => {
      if (document.getElementById('quickAdd')?.getAttribute('aria-hidden') === 'false') return;
      if (cartState.drawerOpen && !cartDrawerEl.contains(ev.target)) {
        cartCloseBtn?.focus({ preventScroll: true });
      }
    });
  };

  const initCartDrawer = () => {
    if (!cartOverlayEl || !cartDrawerEl) return;
    bindCartDrawerEvents();
    const fitViewport = () => {
      const viewport = window.visualViewport;
      // Respect pinch zoom; use the visible height for browser bars/keyboards
      // only at the normal visual scale.
      if (viewport && viewport.scale === 1) {
        cartDrawerEl.style.setProperty('--cart-viewport-height', `${viewport.height}px`);
        cartDrawerEl.style.setProperty('--cart-viewport-top', `${viewport.offsetTop}px`);
      } else {
        cartDrawerEl.style.removeProperty('--cart-viewport-height');
        cartDrawerEl.style.removeProperty('--cart-viewport-top');
      }
    };
    fitViewport();
    window.visualViewport?.addEventListener('resize', fitViewport);
    window.visualViewport?.addEventListener('scroll', fitViewport);
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
    addToCartLine(item).then((cart) => item.onComplete?.(Boolean(cart)));
  });

  // Inicializar badge + drawer
  const startCart = () => {
    if (typeof window.initCartFromBackend === 'function') {
      window.CRONOX_CART_READY = window.initCartFromBackend();
      window.CRONOX_CART_READY.catch(() => undefined);
    }
    initCartDrawer();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCart, { once: true });
  else startCart();

  window.addEventListener('cart:updated', (event) => {
    if (event.cartSource) return;
    if (event.detail && Array.isArray(event.detail.items)) {
      cartVersion += 1;
      publishCart(event.detail);
    } else fetchCart().catch(() => undefined);
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) fetchCart().catch(() => undefined);
  });

  window.addEventListener('cronox:userChanged', (event) => {
    if (event.initial) return;
    // Login/register merge guest ownership atomically on the server; logout
    // transfers it back to a fresh opaque guest owner. Re-read that one source.
    cartOwner += 1;
    cartVersion += 1;
    cartRead = null;
    cartState.data = null;
    cartState.status = 'loading';
    cartState.error = null;
    pendingItemUpdates.clear();
    queuedItemQty.clear();
    cartItemErrors.clear();
    updateBadge();
    notifyCartState();
    fetchCart().catch(() => undefined);
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
window.CRONOX_AUTH_STATE = window.CRONOX_USER ? 'authenticated' : 'unknown';

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
  let authLoadPromise = null;
  let authReturnFocus = null;
  let currentView = 'login';
  let loginErrorMessage = '';
  let registerErrorMessage = '';

  const publishAuthState = (user, { initial = false } = {}) => {
    window.CRONOX_USER = user || null;
    window.CRONOX_AUTH_STATE = user ? 'authenticated' : 'anonymous';
    updateProfileIconUI();
    try {
      window.dispatchEvent(Object.assign(
        new CustomEvent('cronox:userChanged', { detail: user || null }),
        { initial },
      ));
      window.dispatchEvent(new CustomEvent('cronox:authResolved', {
        detail: { state: window.CRONOX_AUTH_STATE, user: user || null },
      }));
    } catch {}
    return user || null;
  };

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

  const openAuthModal = async (initialView = 'login') => {
    if (!authOverlay) {
      const ready = await prepareAuthExperience();
      if (!ready) return false;
    }

    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement !== document.body &&
      !authOverlay.contains(activeElement)
    ) {
      authReturnFocus = activeElement;
    }
    hideUserMenu();
    selectAuthView(initialView);
    authOverlay.classList.add('is-open');
    authOverlay.classList.remove('auth-hidden');
    authOverlay.setAttribute('aria-hidden', 'false');
    lockBody();
    const focusInput = initialView === 'register' ? registerEmail : loginEmail;
    if (focusInput) setTimeout(() => focusInput.focus({ preventScroll: true }), 60);
    return true;
  };

  const closeAuthModal = () => {
    if (!authOverlay) return;
    const returnFocus = authReturnFocus;
    authReturnFocus = null;
    authOverlay.classList.remove('is-open');
    authOverlay.classList.add('auth-hidden');
    authOverlay.setAttribute('aria-hidden', 'true');
    unlockBody();
    loginErrorMessage = '';
    registerErrorMessage = '';
    setAuthMessage('');
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
      window.requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    }
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
      publishAuthState(user);
      await refreshUserDependentUI();
      if (['ADMIN', 'SUPERADMIN'].includes(user?.role)) {
        window.location.href = 'admin.html';
        return;
      }
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
      publishAuthState(user);
      await refreshUserDependentUI();
      closeAuthModal();
    } catch (err) {
      console.error('[AUTH] register error', err);
      registerErrorMessage = parseAuthError(err) || 'No se ha podido crear la cuenta.';
      setAuthMessage(registerErrorMessage, 'error');
    }
  };

  const getHomePath = () => {
    const logoHref = document.querySelector('.topbar__logo')?.getAttribute('href');
    if (logoHref && logoHref !== '#') return logoHref;
    return '/';
  };

  const getHomeUrl = () => {
    const homePath = getHomePath() || '/';
    try {
      return new URL(homePath, window.location.origin).toString();
    } catch {
      return homePath;
    }
  };

  const clearWebStorage = () => {
    try { sessionStorage.clear(); } catch (err) { console.warn('[AUTH] No se pudo limpiar sessionStorage', err); }
    try { localStorage.clear(); } catch (err) { console.warn('[AUTH] No se pudo limpiar localStorage', err); }
  };

  const clearCookies = () => {
    try {
      if (typeof document === 'undefined' || !document.cookie) return;
      const consentCookieName = window.CRONOX_COOKIE_CONSENT?.CONSENT_COOKIE_NAME;
      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=');
        const name = (eqPos > -1 ? cookie.substr(0, eqPos) : cookie).trim();
        if (!name) return;
        if (name === consentCookieName) return;
        const paths = ['/', window.location.pathname || '/'];
        paths.forEach((path) => {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path}`;
        });
      });
    } catch (err) {
      console.warn('[AUTH] No se pudieron limpiar las cookies', err);
    }
  };

  const resetClientSessionState = () => {
    window.CRONOX_AUTH_STATE = 'anonymous';
    window.CRONOX_USER = null;
    if (window.CRONOX_FAVORITES && typeof window.CRONOX_FAVORITES.setIdsFromServer === 'function') {
      window.CRONOX_FAVORITES.setIdsFromServer([]);
    } else {
      window.CRONOX_FAVORITE_IDS = new Set();
    }
    updateProfileIconUI();
    try { window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: null })); } catch {}
  };

  const redirectToHomeAndReload = () => {
    const homeUrl = getHomeUrl();
    const goHome = () => {
      try { window.location.replace(homeUrl); }
      catch { window.location.href = homeUrl; }
    };

    const isAlreadyHome = (() => {
      try {
        const current = new URL(window.location.href);
        const target = new URL(homeUrl, window.location.origin);
        return current.pathname === target.pathname && current.search === target.search && current.hash === target.hash;
      } catch {
        return window.location.href === homeUrl || window.location.pathname === homeUrl;
      }
    })();

    if (!isAlreadyHome) {
      goHome();
    }

    setTimeout(() => {
      try { window.location.reload(); }
      catch { goHome(); }
    }, 120);
  };

  const logoutAndReload = async () => {
    hideUserMenu();
    if (window.CRONOX_API?.logout) {
      try { await window.CRONOX_API.logout(); }
      catch (err) { console.warn('[AUTH] logout error', err); }
    }
    resetClientSessionState();
    clearWebStorage();
    clearCookies();
    redirectToHomeAndReload();
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

    authDialog?.addEventListener('click', (ev) => ev.stopPropagation());
    document.querySelectorAll('[data-auth-switch]').forEach((btn) => {
      btn.addEventListener('click', () => selectAuthView(btn.dataset.authSwitch));
    });

    // [AUTH] Abrir página de recuperar contraseña -> redirigir a forgot-password.html
    document.querySelectorAll('[data-auth-forgot]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        window.location.href = '/recuperar-contrasena';
      });
    });

    loginForm?.addEventListener('submit', handleLoginSubmit);
    registerForm?.addEventListener('submit', handleRegisterSubmit);
    document.getElementById('authCloseBtn')?.addEventListener('click', closeAuthModal);

    if (userMenu) {
      userMenu.addEventListener('click', (ev) => {
        const action = ev.target.closest('[data-user-action]')?.dataset.userAction;
        if (action === 'logout') {
          if (typeof window.CRONOX_logout === 'function') window.CRONOX_logout();
          else logoutAndReload();
        }
        if (action === 'account') {
          hideUserMenu();
          window.location.href = '/cuenta';
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
    if (authLoadPromise) return authLoadPromise;

    authLoadPromise = (async () => {
      try {
        const res = await fetch(AUTH_HTML_PATH, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`AUTH_MODAL_LOAD_${res.status}`);
        const html = await res.text();
        const temp = document.createElement('div');
        temp.innerHTML = html;

        const overlay = temp.querySelector('#authOverlay');
        const menu = temp.querySelector('#authUserMenu');
        if (!overlay) throw new Error('AUTH_MODAL_MARKUP_MISSING');

        document.querySelectorAll('#authOverlay').forEach((el) => el.remove());
        document.querySelectorAll('#authUserMenu').forEach((el) => el.remove());
        document.body.appendChild(overlay);
        if (menu) document.body.appendChild(menu);
        authLoaded = true;
        return true;
      } catch (err) {
        console.error('[AUTH] No se pudo cargar auth-modal.html', err);
        return false;
      }
    })();

    try {
      return await authLoadPromise;
    } finally {
      authLoadPromise = null;
    }
  };

  const prepareAuthExperience = async () => {
    const ready = await ensureAuthModal();
    if (!ready) return false;

    cacheElements();
    bindAuthEvents();
    if (authOverlay && !authOverlay.classList.contains('is-open')) {
      authOverlay.classList.add('auth-hidden');
    }
    updateProfileIconUI();
    return Boolean(authOverlay);
  };

  const initAuthState = async () => {
    if (!window.CRONOX_API?.getMe) return;
    try {
      const user = await window.CRONOX_API.getMe();
      // Initial reads already use the same session cookies. Only an actual
      // login/logout needs to reload the cart and checkout a second time.
      return publishAuthState(user, { initial: true });
    } catch (err) {
      // A transport/session recovery error is not proof of anonymity. Keep
      // the state unknown so authenticated visitors never see a popup flash.
      window.CRONOX_AUTH_STATE = 'unknown';
      console.warn('[AUTH] No se pudo obtener el usuario actual', err);
    }
  };

  // Exponer funciones globales por compatibilidad
  window.CRONOX_openAuthModal = openAuthModal;
  window.CRONOX_closeAuthModal = closeAuthModal;
  window.CRONOX_redirectHome = redirectToHomeAndReload;
  window.CRONOX_logout = logoutAndReload;

  // ===== Newsletter Popup =====
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
    loginLink: null,
    renderer: null,
    retryTimer: 0,
    initialized: false,
    listenersBound: false,
    shownInMemory: false,
    previousFocus: null,
    storefrontReady: false,
  };

  const hasPreferenceConsent = () =>
    window.CRONOX_COOKIE_CONSENT?.hasConsent('preferences') === true;

  const newsletterVisit = window.CRONOX_NEWSLETTER_VISIT?.create({ hasConsent: hasPreferenceConsent });

  const markNewsletterShown = () => {
    newsletterState.shownInMemory = true;
    newsletterVisit?.markShown();
  };

  const persistNewsletterDismiss = () => {
    newsletterVisit?.dismiss();
  };

  const clearNewsletterTimers = () => {
    newsletterVisit?.cancel();
    if (newsletterState.retryTimer) clearTimeout(newsletterState.retryTimer);
    newsletterState.retryTimer = 0;
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

  const closeNewsletterModal = ({ dismiss = true, restoreFocus = true } = {}) => {
    clearNewsletterTimers();
    if (newsletterState.overlay) {
      newsletterState.overlay.classList.remove('newsletter-modal-overlay--visible');
      newsletterState.overlay.setAttribute('aria-hidden', 'true');
    }
    if (typeof window.CRONOX_unlockScroll === 'function') window.CRONOX_unlockScroll('newsletter');
    if (dismiss) persistNewsletterDismiss();
    if (restoreFocus && newsletterState.previousFocus?.isConnected) {
      requestAnimationFrame(() => newsletterState.previousFocus.focus({ preventScroll: true }));
    }
    newsletterState.previousFocus = null;
  };

  const hasBlockingModal = () => Boolean(
    document.querySelector('#authOverlay.is-open, .cronox-consent:not([hidden]), .cronox-consent-panel:not([hidden])') ||
    document.body?.classList.contains('cart-open')
  );

  const openNewsletterModal = () => {
    if (
      !newsletterState.overlay ||
      newsletterState.shownInMemory ||
      window.CRONOX_AUTH_STATE !== 'anonymous'
    ) return false;
    if (hasBlockingModal()) {
      if (!newsletterState.retryTimer) {
        newsletterState.retryTimer = setTimeout(() => {
          newsletterState.retryTimer = 0;
          openNewsletterModal();
        }, 500);
      }
      return false;
    }
    newsletterState.previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    markNewsletterShown();
    newsletterState.overlay.classList.add('newsletter-modal-overlay--visible');
    newsletterState.overlay.setAttribute('aria-hidden', 'false');
    if (typeof window.CRONOX_lockScroll === 'function') window.CRONOX_lockScroll('newsletter');
    newsletterState.renderer?.reflow?.();
    setTimeout(() => newsletterState.closeBtn?.focus({ preventScroll: true }), 40);
    return true;
  };

  const shouldShowNewsletter = (now = Date.now()) => {
    if (newsletterState.shownInMemory || newsletterVisit?.wasShown()) return false;
    if (window.CRONOX_AUTH_STATE !== 'anonymous' || window.CRONOX_USER) return false;
    return newsletterVisit?.eligible(now) ?? true;
  };

  const suppressNewsletterForAuthentication = () => {
    clearNewsletterTimers();
    if (newsletterState.overlay?.classList.contains('newsletter-modal-overlay--visible')) {
      closeNewsletterModal({ dismiss: false, restoreFocus: false });
    }
  };

  const loadNewsletterConfiguration = async () => {
    try {
      const response = await fetch(apiEndpoint('/api/newsletter/config'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`NEWSLETTER_CONFIG_${response.status}`);
      newsletterState.renderer?.update?.(await response.json());
    } catch (error) {
      console.warn('[CRONOX] Configuración newsletter no disponible; usando fallback.', error);
      newsletterState.renderer?.update?.(window.CRONOX_NEWSLETTER_RENDERER?.DEFAULT_CONFIG || {});
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
      const res = await fetch(apiEndpoint('/api/newsletter/subscribe'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await getCsrfHeaders()) },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setNewsletterFeedback(
          'Si la direccion es elegible, revisa tu correo para confirmar la suscripcion.',
          'success',
        );
        persistNewsletterDismiss();
        setTimeout(() => closeNewsletterModal({ dismiss: false }), 1200);
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
    if (newsletterState.listenersBound) return;
    newsletterState.listenersBound = true;
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
    newsletterState.loginLink?.addEventListener('click', async () => {
      const returnFocus = newsletterState.previousFocus;
      closeNewsletterModal({ dismiss: true, restoreFocus: false });
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else newsletterState.loginLink?.blur();
      await window.CRONOX_openAuthModal?.('login');
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        newsletterState.overlay?.classList.contains('newsletter-modal-overlay--visible')
      ) closeNewsletterModal();
    });
  };

  const cacheNewsletterElements = () => {
    newsletterState.overlay = document.querySelector('.newsletter-modal-overlay');
    newsletterState.modal = newsletterState.overlay?.querySelector('.newsletter-modal') || null;
    newsletterState.closeBtn = newsletterState.overlay?.querySelector('.newsletter-modal-close') || null;
    newsletterState.form = newsletterState.overlay?.querySelector('.newsletter-modal-form') || null;
    newsletterState.emailInput = newsletterState.overlay?.querySelector('.newsletter-modal-input') || null;
    newsletterState.submitBtn = newsletterState.overlay?.querySelector('.newsletter-modal-button') || null;
    newsletterState.loginLink = newsletterState.overlay?.querySelector('.newsletter-login-link') || null;
    if (newsletterState.submitBtn) {
      newsletterState.submitBtn.textContent = BTN_LABEL_IDLE;
    }
    newsletterState.feedback = newsletterState.overlay?.querySelector('.newsletter-modal-feedback') || null;
  };

  const initNewsletterModal = () => {
    if (newsletterState.initialized) return;
    newsletterState.initialized = true;
    newsletterState.overlay = document.querySelector('.newsletter-modal-overlay');
    newsletterState.modal = newsletterState.overlay?.querySelector('.newsletter-modal') || null;
    if (!newsletterState.overlay || !newsletterState.modal) return;
    newsletterState.renderer = window.CRONOX_NEWSLETTER_RENDERER?.mount?.(
      newsletterState.modal,
      window.CRONOX_NEWSLETTER_RENDERER?.DEFAULT_CONFIG || {},
    );
    cacheNewsletterElements();
    bindNewsletterEvents();
    void loadNewsletterConfiguration();

    const schedule = () => {
      if (!newsletterState.storefrontReady) return;
      if (newsletterState.shownInMemory || !shouldShowNewsletter()) return;
      newsletterVisit?.schedule(() => {
        if (shouldShowNewsletter()) openNewsletterModal();
      });
    };
    window.addEventListener('cronox:storefront-ready', () => {
      newsletterState.storefrontReady = true;
      schedule();
    }, { once: true });
    window.addEventListener('cronox:authResolved', (event) => {
      if (event.detail?.state === 'authenticated') suppressNewsletterForAuthentication();
      else if (event.detail?.state === 'anonymous') schedule();
    });
    window.addEventListener('cronox:userChanged', (event) => {
      if (event.detail) suppressNewsletterForAuthentication();
    });
    window.addEventListener('cronox:session-ended', suppressNewsletterForAuthentication);
    if (document.body?.classList.contains('is-loaded') || !document.getElementById('preloader')) {
      newsletterState.storefrontReady = true;
      schedule();
    }
  };

  const initFooterAccordion = () => {
    const accordion = document.getElementById('footerAccordion');
    if (!accordion) return;

    const items = Array.from(accordion.querySelectorAll('.footer-acc-item'));
    if (!items.length) return;

    const mobileQuery = window.matchMedia('(max-width: 480px)');

    const setIcon = (item, symbol) => {
      const icon = item.querySelector('.footer-acc-icon');
      if (icon) {
        icon.textContent = symbol;
      }
    };

    const closeItem = (item) => {
      const trigger = item.querySelector('.footer-acc-trigger');
      const panel = item.querySelector('.footer-acc-panel');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (panel) {
        panel.style.maxHeight = '0px';
        panel.setAttribute('aria-hidden', 'true');
      }
      item.classList.remove('is-open');
      setIcon(item, '+');
    };

    const openItem = (item) => {
      const trigger = item.querySelector('.footer-acc-trigger');
      const panel = item.querySelector('.footer-acc-panel');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      if (panel) {
        panel.style.maxHeight = `${panel.scrollHeight}px`;
        panel.setAttribute('aria-hidden', 'false');
      }
      item.classList.add('is-open');
      setIcon(item, '–');
    };

    const collapseAll = () => {
      items.forEach((item) => closeItem(item));
    };

    const recalcOpenPanels = () => {
      if (!mobileQuery.matches) return;
      items.forEach((item) => {
        if (!item.classList.contains('is-open')) return;
        const panel = item.querySelector('.footer-acc-panel');
        if (panel) {
          panel.style.maxHeight = `${panel.scrollHeight}px`;
        }
      });
    };

    const applyDesktopState = () => {
      items.forEach((item) => {
        const trigger = item.querySelector('.footer-acc-trigger');
        const panel = item.querySelector('.footer-acc-panel');
        item.classList.remove('is-open');
        setIcon(item, '+');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        if (panel) {
          panel.style.maxHeight = '';
          panel.setAttribute('aria-hidden', 'false');
        }
      });
    };

    const onTriggerClick = (item) => {
      if (!mobileQuery.matches) return;
      const isOpen = item.classList.contains('is-open');
      collapseAll();
      if (!isOpen) {
        openItem(item);
      }
    };

    items.forEach((item) => {
      const trigger = item.querySelector('.footer-acc-trigger');
      if (!trigger) return;
      trigger.addEventListener('click', () => onTriggerClick(item));
    });

    const handleMatchChange = (event) => {
      if (event.matches) {
        collapseAll();
      } else {
        applyDesktopState();
      }
    };

    if (mobileQuery.matches) {
      collapseAll();
    } else {
      applyDesktopState();
    }

    mobileQuery.addEventListener('change', handleMatchChange);
    window.addEventListener('resize', recalcOpenPanels);
  };

  document.addEventListener('DOMContentLoaded', () => {
    initNewsletterModal();
    initFooterAccordion();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    // Session resolution must not wait for the optional login modal download.
    window.CRONOX_AUTH_READY = initAuthState();
    const ready = await prepareAuthExperience();
    if (!ready) return;
    await window.CRONOX_AUTH_READY;

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
