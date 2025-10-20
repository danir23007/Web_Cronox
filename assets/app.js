/* ==========================================================
   CRONOX — app.js (v44)  —  “+” clásico añade al carrito
   ========================================================== */

(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ===== Util =====
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const getProducts = () => Array.isArray(window.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : [];

  // ===== Topbar states (transparente → hero → page) =====
  const topbar = $('.topbar');
  const hero = $('.hero-video-section');

  function applyTopbarState(state) {
    if (!topbar) return;
    topbar.classList.remove('topbar--transparent', 'topbar--hero', 'topbar--page');
    topbar.classList.add(state);
  }

  function updateTopbarOnScroll() {
    if (!topbar || !hero) return;
    const rect = hero.getBoundingClientRect();
    const atTop = window.scrollY <= 0;

    if (atTop && rect.top >= 0) {
      applyTopbarState('topbar--transparent');
    } else if (rect.bottom > 0) {
      applyTopbarState('topbar--hero');
    } else {
      applyTopbarState('topbar--page');
    }
  }

  if (hero && topbar) {
    try {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            if (window.scrollY <= 0) applyTopbarState('topbar--transparent');
            else applyTopbarState('topbar--hero');
          } else {
            applyTopbarState('topbar--page');
          }
        },
        { threshold: [0, 0.01, 0.1] }
      );
      io.observe(hero);
    } catch {}
    window.addEventListener('scroll', updateTopbarOnScroll, { passive: true });
    window.addEventListener('resize', updateTopbarOnScroll);
    document.addEventListener('DOMContentLoaded', updateTopbarOnScroll);
    window.addEventListener('load', updateTopbarOnScroll);
  }

  // ===== Drawer Lateral (si lo usas) =====
  const overlay = $('.overlay');
  const filtersPanel = $('#filtersPanel');
  const showOverlay = (kind = 'overlay--page') => {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.remove('overlay--hero', 'overlay--page');
    overlay.classList.add(kind);
  };
  const hideOverlay = () => { if (overlay) overlay.hidden = true; };

  function openFilters(){ if (filtersPanel){ filtersPanel.classList.add('is-open'); showOverlay('overlay--page'); document.body.classList.add('no-scroll'); } }
  function closeFilters(){ if (filtersPanel){ filtersPanel.classList.remove('is-open'); hideOverlay(); document.body.classList.remove('no-scroll'); } }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-filters]')) { e.preventDefault(); openFilters(); }
    if (e.target.closest('[data-close-filters]') || (overlay && e.target === overlay)) { e.preventDefault(); closeFilters(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilters(); });

  // ===== Mini-galería en cards (flechas ‹ ›) =====
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

  // ===== Carrito =====
  const cartCountEl = $('.topbar__cart .cart-count');

  function readCart() {
    try {
      const raw = localStorage.getItem('cronox_cart');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function writeCart(cart) {
    try { localStorage.setItem('cronox_cart', JSON.stringify(cart)); } catch {}
    window.dispatchEvent(new Event('cart:updated'));
  }

  function cartTotalQty(cart) {
    return cart.reduce((acc, it) => acc + (Number(it.qty) || 0), 0);
  }

  function updateCartBadgeExplicit(qty) {
    if (cartCountEl) cartCountEl.textContent = String(clamp(qty, 0, 999));
  }

  function updateCartBadgeFromStorage() {
    const cart = readCart();
    updateCartBadgeExplicit(cartTotalQty(cart));
  }

  // expone por si otros scripts lo usan
  window.updateCartBadge = updateCartBadgeExplicit;

  function addToCartLine(item) {
    const cart = readCart();
    // misma línea = mismo id + talla + color
    const idx = cart.findIndex(x => x.id === item.id && x.size === item.size && x.color === item.color);
    if (idx >= 0) {
      cart[idx].qty = (Number(cart[idx].qty) || 0) + (Number(item.qty) || 1);
    } else {
      cart.push({ ...item, qty: Number(item.qty) || 1, addedAt: Date.now() });
    }
    writeCart(cart);
    updateCartBadgeExplicit(cartTotalQty(cart));
  }

  // Click en el “+” clásico dentro de la card
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.fav-add');
    if (!addBtn) return;

    // Evita navegar (el botón está dentro del <a.product-card>)
    e.preventDefault();
    e.stopPropagation();

    const card = addBtn.closest('.product-card');
    const pid = card?.getAttribute('data-id') || card?.dataset?.id;
    if (!pid) return;

    const product = getProducts().find(p => p.id === pid);
    if (!product) return;

    // Defaults rápidos (si no hay opciones)
    const size  = (product.sizes && product.sizes[0]) ? String(product.sizes[0]).toUpperCase() : 'M';
    const color = (product.colors && product.colors[0]) ? String(product.colors[0]) : (product.color || 'Único');

    addToCartLine({
      id: product.id,
      name: product.name,
      price: Number(product.price) || 0,
      priceLabel: product.priceLabel || new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(product.price),
      image: (Array.isArray(product.images) && product.images[0]) ? product.images[0] : product.image,
      size,
      color,
      qty: 1
    });

    // Feedback visual rápido
    addBtn.style.transform = 'scale(1.12)';
    addBtn.style.opacity = '1';
    setTimeout(() => {
      addBtn.style.transform = '';
      addBtn.style.opacity = '';
    }, 160);
  });

  // Inicializa badge al cargar
  document.addEventListener('DOMContentLoaded', updateCartBadgeFromStorage);
  window.addEventListener('storage', (e) => { if (e.key === 'cronox_cart') updateCartBadgeFromStorage(); });

  // ===== Saneado: si algún HTML viejo mete .card-plus, lo quitamos =====
  $$('.card-plus').forEach((el) => el.remove());
  try {
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches?.('.card-plus')) n.remove();
          $$('.card-plus', n).forEach((x) => x.remove());
        });
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
})();
