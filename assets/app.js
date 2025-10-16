// ==========================
// assets/app.js — CRONOX
// ==========================

// ===== Utils =====
function hidePreloaderSafely() {
  const p = document.getElementById('preloader');
  if (p) p.style.display = 'none';
}

// Evita que el navegador restaure el scroll (queremos empezar arriba del héroe)
try { window.history.scrollRestoration = 'manual'; } catch (e) {}

// ===== Preloader: tres vías para ocultarlo =====
window.addEventListener('load', hidePreloaderSafely, { once: true });
document.addEventListener('DOMContentLoaded', () => {
  // Failsafe por si 'load' tarda o no dispara (vídeo pesado, etc.)
  setTimeout(hidePreloaderSafely, 2000);
}, { once: true });
window.addEventListener('error', () => {
  // Si hay error en recursos, no bloquear en la pantalla de carga
  setTimeout(hidePreloaderSafely, 0);
});

// ===== Elements =====
const topbar = document.getElementById('topbar');
const hero = document.getElementById('hero');
const overlay = document.getElementById('overlay');

const btnMenu = document.getElementById('btnMenu');
const filtersPanel = document.getElementById('filtersPanel');
const btnCloseFilters = document.getElementById('btnCloseFilters');

const btnSearch = document.getElementById('btnSearch');
const searchBar = document.getElementById('searchBar');
const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');

const filtersForm = document.getElementById('filtersForm');
const btnClearFilters = document.getElementById('btnClearFilters');

const productsGrid = document.getElementById('productsGrid');
const productsFallback = document.getElementById('productsFallback');

// ===== State =====
let isOverHero = true;
let menuOpen = false;
let searchOpen = false;

// ===== Forzar arranque arriba del todo cuando cargue la página =====
window.addEventListener('load', () => {
  // scrollTo(0,0) es el más compatible y suficiente aquí
  try { window.scrollTo(0, 0); } catch(e) {}
}, { once: true });

// ===== Topbar modes (transparente → hero/translúcida → page/opaca) =====
function updateTopbarMode() {
  if (!topbar) return;
  const atTop = (window.scrollY || 0) < 4;

  topbar.classList.remove('topbar--transparent','topbar--hero','topbar--page');

  if (atTop && isOverHero) {
    topbar.classList.add('topbar--transparent');
  } else if (isOverHero) {
    topbar.classList.add('topbar--hero'); // (alias en CSS: --translucent)
  } else {
    topbar.classList.add('topbar--page'); // (alias en CSS: --opaque)
  }
}

window.addEventListener('scroll', updateTopbarMode, { passive: true });

// Usamos IntersectionObserver para saber si el héroe (vídeo) está en viewport
try {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        isOverHero = entry.isIntersecting && entry.intersectionRatio > 0.05;
        updateTopbarMode();
        if (menuOpen) updateOverlayMode();
      });
    },
    // 5% visible para considerarlo "sobre el héroe" y evitar parpadeos
    { root: null, threshold: [0, 0.05, 0.15, 0.5, 0.9] }
  );
  if (hero) io.observe(hero);
} catch (e) {
  // Si IO no existe, degradamos: opaca salvo en el top absoluto
  console.warn('IntersectionObserver not available, degrading behavior.');
  isOverHero = false;
  updateTopbarMode();
}

// ===== Overlay (filtros y otras capas) =====
function openOverlay() {
  if (!overlay) return;
  overlay.hidden = false;
  updateOverlayMode();
}
function closeOverlay() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.classList.remove('overlay--hero','overlay--page');
}
function updateOverlayMode() {
  if (!overlay) return;
  overlay.classList.toggle('overlay--hero', isOverHero);
  overlay.classList.toggle('overlay--page', !isOverHero);
}
overlay?.addEventListener('click', () => { if (menuOpen) toggleMenu(false); });

// ===== Filtros =====
function toggleMenu(force) {
  const next = (typeof force === 'boolean') ? force : !menuOpen;
  menuOpen = next;
  btnMenu?.setAttribute('aria-expanded', String(next));

  if (next) {
    if (filtersPanel) filtersPanel.hidden = false;
    openOverlay();
    const firstInput = filtersPanel?.querySelector('input,button,select,textarea');
    firstInput && firstInput.focus?.({ preventScroll: true });
  } else {
    if (filtersPanel) filtersPanel.hidden = true;
    closeOverlay();
    btnMenu?.focus?.({ preventScroll: true });
  }
}
btnMenu?.addEventListener('click', () => toggleMenu());
btnCloseFilters?.addEventListener('click', () => toggleMenu(false));

// Accesibilidad: ESC cierra menú y barra de búsqueda
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (menuOpen) toggleMenu(false);
    if (searchOpen) toggleSearch(false);
  }
});

// Placeholder de filtros (conecta con products.js si quieres)
filtersForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  toggleMenu(false);
});
btnClearFilters?.addEventListener('click', () => { filtersForm?.reset?.(); });

// ===== Búsqueda =====
function toggleSearch(force) {
  const next = (typeof force === 'boolean') ? force : !searchOpen;
  searchOpen = next;
  btnSearch?.setAttribute('aria-expanded', String(next));

  if (next) {
    if (searchBar) searchBar.hidden = false;
    requestAnimationFrame(() => { searchInput?.focus?.(); });
  } else {
    if (searchBar) searchBar.hidden = true;
    btnSearch?.focus?.({ preventScroll: true });
  }
}
btnSearch?.addEventListener('click', () => toggleSearch());

searchForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = (searchInput?.value || '').trim();
  if (!q) return;

  const url = new URL(window.location);
  url.searchParams.set('q', q);
  history.replaceState({}, '', url);

  toggleSearch(false);
  // TODO: conectar con filtrado real en products.js
});

// ===== Fallback productos si nadie pintó tarjetas =====
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (productsGrid && productsGrid.children.length === 0 && productsFallback) {
      productsFallback.hidden = false;
    }
  }, 1200);
});

// ===== Inicialización =====
updateTopbarMode();
