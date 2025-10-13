// ===== Preloader =====
window.addEventListener('load', () => {
  const preloader = document.getElementById('preloader');
  if (preloader) preloader.style.display = 'none';
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
let isOverHero = true;     // topbar sobre vídeo
let menuOpen = false;
let searchOpen = false;

// ===== Topbar mode =====
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    isOverHero = entry.isIntersecting && entry.intersectionRatio > 0;
    updateTopbarMode();
    if (menuOpen) updateOverlayMode();
  });
}, { root: null, threshold: [0, 0.01] });

if (hero) io.observe(hero);

function updateTopbarMode() {
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
  overlay.hidden = false;
  updateOverlayMode();
}
function closeOverlay() {
  overlay.hidden = true;
  overlay.classList.remove('overlay--hero','overlay--page');
}
function updateOverlayMode() {
  overlay.classList.toggle('overlay--hero', isOverHero);
  overlay.classList.toggle('overlay--page', !isOverHero);
}
overlay?.addEventListener('click', () => {
  if (menuOpen) toggleMenu(false);
});

// ===== Menú de filtros =====
function toggleMenu(force) {
  const next = typeof force === 'boolean' ? force : !menuOpen;
  menuOpen = next;
  btnMenu.setAttribute('aria-expanded', String(next));
  if (next) {
    filtersPanel.hidden = false;
    openOverlay();
    const firstInput = filtersPanel.querySelector('input,button,select,textarea');
    firstInput && firstInput.focus({preventScroll:true});
  } else {
    filtersPanel.hidden = true;
    closeOverlay();
    btnMenu?.focus({preventScroll:true});
  }
}
btnMenu?.addEventListener('click', () => toggleMenu());
btnCloseFilters?.addEventListener('click', () => toggleMenu(false));

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
btnClearFilters?.addEventListener('click', () => {
  filtersForm.reset();
});

// ===== Barra de búsqueda =====
function toggleSearch(force) {
  const next = typeof force === 'boolean' ? force : !searchOpen;
  searchOpen = next;
  btnSearch.setAttribute('aria-expanded', String(next));
  if (next) {
    searchBar.hidden = false;
    requestAnimationFrame(() => { searchInput?.focus(); });
  } else {
    searchBar.hidden = true;
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
  // TODO: llamar a tu función de filtrado en products.js con 'q'
});

// ===== Fallback de productos =====
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (productsGrid && productsGrid.children.length === 0 && productsFallback) {
      productsFallback.hidden = false;
    }
  }, 1000);
});
