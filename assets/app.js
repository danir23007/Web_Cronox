/* ==========================================================
   CRONOX — app.js (clean quick-add; keep legacy .fav-add)
   ========================================================== */

(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ===== Utilidades mínimas =====
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // ===== Topbar: transparente (en el tope del héroe) → hero (sobre el vídeo) → page (resto) =====
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
    const heroInView = rect.bottom > 0 && rect.top < (topbar.offsetHeight + 1) + window.innerHeight;

    if (atTop && rect.top >= 0) {
      applyTopbarState('topbar--transparent');
    } else if (heroInView && rect.bottom > topbar.offsetHeight) {
      applyTopbarState('topbar--hero');
    } else {
      applyTopbarState('topbar--page');
    }
  }

  if (hero && topbar) {
    // Primera pintura
    updateTopbarOnScroll();
    // Observa al héroe para cambios finos
    try {
      const io = new IntersectionObserver(
        ([entry]) => {
          // entry.isIntersecting = topbar “hero”, si además estamos en y=0 y borde superior del héroe está visible, “transparent”
          if (entry.isIntersecting) {
            if (window.scrollY <= 0) applyTopbarState('topbar--transparent');
            else applyTopbarState('topbar--hero');
          } else {
            applyTopbarState('topbar--page');
          }
        },
        { root: null, threshold: [0, 0.01, 0.1, 0.5, 1] }
      );
      io.observe(hero);
    } catch {
      // Fallback sin IO
      window.addEventListener('scroll', updateTopbarOnScroll, { passive: true });
      window.addEventListener('resize', updateTopbarOnScroll);
    }
    window.addEventListener('scroll', updateTopbarOnScroll, { passive: true });
    window.addEventListener('resize', updateTopbarOnScroll);
  }

  // ===== Overlay genérico (si lo usas para búsqueda u otros) =====
  const overlay = $('.overlay');
  function showOverlay(kind = 'overlay--page') {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.remove('overlay--hero', 'overlay--page');
    overlay.classList.add(kind);
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
  }

  // ===== Drawer lateral (filtros/categorías) =====
  const filtersPanel = $('#filtersPanel');
  function openFilters() {
    if (!filtersPanel) return;
    filtersPanel.classList.add('is-open');
    showOverlay('overlay--page');
    document.body.classList.add('no-scroll');
  }
  function closeFilters() {
    if (!filtersPanel) return;
    filtersPanel.classList.remove('is-open');
    hideOverlay();
    document.body.classList.remove('no-scroll');
  }

  document.addEventListener('click', (e) => {
    const t = e.target;

    // Botones de abrir/cerrar filtros (usa data-attrs para no depender de IDs concretos)
    if (t.closest('[data-open-filters]')) {
      e.preventDefault();
      openFilters();
      return;
    }
    if (t.closest('[data-close-filters]') || (overlay && t === overlay)) {
      e.preventDefault();
      closeFilters();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilters();
  });

  // ===== Galería de imágenes en tarjeta (flechas ‹ ›) =====
  function moveGallery(cardEl, dir = 1) {
    const imagesWrap = $('.product-images', cardEl);
    if (!imagesWrap) return;

    const imgs = $$('.product-img', imagesWrap);
    if (!imgs.length) return;

    let activeIndex = imgs.findIndex((im) => im.classList.contains('active'));
    if (activeIndex < 0) activeIndex = 0;

    const nextIndex = (activeIndex + dir + imgs.length) % imgs.length;
    imgs.forEach((im, idx) => im.classList.toggle('active', idx === nextIndex));
  }

  document.addEventListener('click', (e) => {
    const prevBtn = e.target.closest('.product-arrow.prev');
    const nextBtn = e.target.closest('.product-arrow.next');
    if (prevBtn || nextBtn) {
      e.preventDefault();
      const card = e.target.closest('.product-card');
      moveGallery(card, prevBtn ? -1 : 1);
    }
  });

  // ===== Favoritos (icono estrella en card) =====
  const favCountEl = $('.topbar__fav .fav-count');
  let favCount = Number(favCountEl?.textContent || 0);

  function bumpFavCount(delta) {
    favCount = clamp(favCount + delta, 0, 999);
    if (favCountEl) favCountEl.textContent = String(favCount);
  }

  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.fav-toggle');
    if (!toggle) return;
    e.preventDefault();

    const active = toggle.classList.toggle('active');
    bumpFavCount(active ? 1 : -1);
  });

  // ===== Carrito: solo con el “+” clásico (.fav-add) =====
  // Importante: eliminamos cualquier creación/uso de ".card-plus".
  // Este bloque NO genera ningún botón; únicamente maneja clicks del "+" ya existente en el HTML.
  const cartCountEl = $('.topbar__cart .cart-count');
  let cartCount = Number(cartCountEl?.textContent || 0);

  function bumpCartCount(delta) {
    cartCount = clamp(cartCount + delta, 0, 999);
    if (cartCountEl) cartCountEl.textContent = String(cartCount);
  }

  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.fav-add'); // el “+” clásico
    if (!addBtn) return;

    e.preventDefault();
    const card = addBtn.closest('.product-card');
    const productId = card?.getAttribute('data-product-id') || null;

    // Aquí puedes integrar tu lógica real de carrito (localStorage / fetch / Shopify / etc.)
    // Por ahora, solo incrementamos el contador visualmente.
    bumpCartCount(1);

    // Feedback mínimo
    addBtn.style.transform = 'scale(1.12)';
    addBtn.style.opacity = '1';
    setTimeout(() => {
      addBtn.style.transform = '';
      addBtn.style.opacity = '';
    }, 150);
  });

  // ===== Limpieza defensiva: elimina cualquier “.card-plus” ya pintado por HTML heredado =====
  $$('.card-plus').forEach((el) => el.remove());

  // ===== Prevención: si algún script externo intenta inyectar .card-plus en el futuro =====
  try {
    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes && m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches && node.matches('.card-plus')) node.remove();
          // Si entra dentro de un card:
          $$('.card-plus', node).forEach((n) => n.remove());
        });
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* noop */ }

  // ===== Ajuste inicial de estados =====
  document.addEventListener('DOMContentLoaded', updateTopbarOnScroll);
  window.addEventListener('load', () => {
    // Asegura estado correcto tras carga completa
    updateTopbarOnScroll();
  });
})();
