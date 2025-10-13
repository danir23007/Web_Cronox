// ===== Utils =====
function hidePreloaderSafely() {
  const p = document.getElementById('preloader');
  if (p) p.style.display = 'none';
}

// ===== Preloader: tres vías para ocultarlo =====
window.addEventListener('load', hidePreloaderSafely, { once: true });
document.addEventListener('DOMContentLoaded', () => {
  // Si por lo que sea 'load' no dispara (vídeo muy pesado, error en otro script), lo ocultamos igual
  setTimeout(hidePreloaderSafely, 2000);
}, { once: true });
window.addEventListener('error', () => {
  // Si hay un error en algún recurso/script, no nos quedamos bloqueados en la pantalla de carga
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

// ===== Topbar modes =====
try {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      isOverHero = entry.isIntersecting && entry.intersectionRatio > 0;
      updateTopbarMode();
      if (menuOpen) updateOverlayMode();
    });
  }, { root: null, threshold: [0, 0.01] });

  if (hero) io.observe(hero);
} catch (e) {
  // Si IntersectionObserver no está, degradamos a opaco fuera del top
  console.error('IntersectionObserver error:', e);
}

function updateTopbarMode() {
  if (!topbar) return;
  const atTop = window.scrollY < 4;
  topbar.classList.remove('topbar--transparent','topbar--hero','topbar--page');

  if (atTop && isOverHero) {
    topbar.classList.add('topbar--transparent');
  } else if (isOverHero) {
    topbar.classList.add('topbar--hero');
  } else {
    topbar.classList.add('topbar--page');
  }
}
window.addEventListener('scroll', updateTopbarMode);
updateTopbarMode();

// ===== Overlay =====
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
  const next = typeof force === 'boolean' ? force : !menuOpen;
  menuOpen = next;
  btnMenu?.setAttribute('aria-expanded', String(next));
  if (next) {
    if (filtersPanel) filtersPanel.hidden = false;
    openOverlay();
    const firstInput = filtersPanel?.querySelector('input,button,select,textarea');
    firstInput && firstInput.focus({preventScroll:true});
  } else {
    if (filtersPanel) filtersPanel.hidden = true;
    closeOverlay();
    btnMenu?.focus({preventScroll:true});
  }
}
btnMenu?.addEventListener('click', () => toggleMenu());
btnCloseFilters?.addEventListener('click', () => toggleMenu(false));

// Accesibilidad: ESC cierra
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (menuOpen) toggleMenu(false);
    if (searchOpen) toggleSearch(false);
  }
});

// Placeholder de filtros (conectar con products.js si quieres)
filtersForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  toggleMenu(false);
});
btnClearFilters?.addEventListener('click', () => { filtersForm?.reset(); });

// ===== Búsqueda =====
function toggleSearch(force) {
  const next = typeof force === 'boolean' ? force : !searchOpen;
  searchOpen = next;
  btnSearch?.setAttribute('aria-expanded', String(next));
  if (next) {
    if (searchBar) searchBar.hidden = false;
    requestAnimationFrame(() => { searchInput?.focus(); });
  } else {
    if (searchBar) searchBar.hidden = true;
    btnSearch?.focus({preventScroll:true});
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
