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

// ===== State =====
let isOverHero = true;     // indica si la topbar está sobre la sección de vídeo
let menuOpen = false;
let searchOpen = false;

// ===== Topbar style according to scroll/hero =====
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    // Consideramos "sobre el vídeo" si el top de la hero está dentro del viewport
    isOverHero = entry.isIntersecting && entry.intersectionRatio > 0;

    // Actualiza estilo de topbar
    updateTopbarMode();

    // Si el menú está abierto, ajusta overlay
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

// ===== Overlay handling =====
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

// Close on overlay click
overlay?.addEventListener('click', () => {
  if (menuOpen) toggleMenu(false);
});

// ===== Menu (filters) =====
function toggleMenu(force) {
  const next = typeof force === 'boolean' ? force : !menuOpen;
  menuOpen = next;
  btnMenu.setAttribute('aria-expanded', String(next));
  if (next) {
    filtersPanel.hidden = false;
    openOverlay();
    // focus first control
    const firstInput = filtersPanel.querySelector('input,button,select,textarea');
    firstInput && firstInput.focus({preventScroll:true});
  } else {
    filtersPanel.hidden = true;
    closeOverlay();
    btnMenu.focus({preventScroll:true});
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

// Apply / Clear actions (ejemplo – conecta con tu lógica real de products.js)
filtersForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  // Aquí puedes leer los filtros y actualizar el grid de productos
  // Ejemplo:
  // const data = new FormData(filtersForm);
  // const selectedCats = data.getAll('cat');
  toggleMenu(false);
});
btnClearFilters?.addEventListener('click', () => {
  filtersForm.reset();
});

// ===== Search bar =====
function toggleSearch(force) {
  const next = typeof force === 'boolean' ? force : !searchOpen;
  searchOpen = next;
  btnSearch.setAttribute('aria-expanded', String(next));
  if (next) {
    searchBar.hidden = false;
    // pequeña animación (CSS ya es sticky)
    requestAnimationFrame(() => { searchInput?.focus(); });
  } else {
    searchBar.hidden = true;
    btnSearch.focus({preventScroll:true});
  }
}
btnSearch?.addEventListener('click', () => toggleSearch());

// demo submit
searchForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = (searchInput?.value || '').trim();
  if (!q) return;
  // Conecta aquí con tu buscador real (filtrar grid o redirigir)
  // Por ahora, hacemos una pequeña marca en la URL para SPA:
  const url = new URL(window.location);
  url.searchParams.set('q', q);
  history.replaceState({}, '', url);
  // cierra barra
  toggleSearch(false);
});

// ===== Initial pass =====
updateTopbarMode();
