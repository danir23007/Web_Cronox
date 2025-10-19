/* ========== CRONOX — Interacciones principales (black menu + search + topbar) ========== */
(() => {
  "use strict";

  // Helpers
  const $  = (s, r = document) => r.querySelector(s);

  // Elements
  const topbar        = $("#topbar");
  const hero          = $("#hero");
  const overlay       = $("#overlay");

  const btnMenu       = $("#btnMenu");          // botón 3 líneas
  const filtersPanel  = $("#filtersPanel");     // <aside id="filtersPanel"> (black-menu)

  const btnSearch     = $("#btnSearch");
  const searchBar     = $("#searchBar");
  const searchForm    = $("#searchForm");
  const searchInput   = $("#searchInput");

  // ===== 0) Asegurar estilos del black-menu (override con !important) =========
  (function ensureBlackMenuStyles(){
    if (!filtersPanel) return;

    // Garantiza clase .black-menu y elimina restos antiguos de .filters
    filtersPanel.classList.add("black-menu");
    filtersPanel.classList.remove("filters");

    // Si ya hemos inyectado estilos, no repetir
    if (document.getElementById("cronox-blackmenu-style")) return;

    const css = `
#filtersPanel.black-menu{
  position: fixed !important;
  inset: 0 !important;
  background: #000 !important;
  color: #fff !important;
  z-index: 9999 !important;
  display: grid !important;
  place-items: center !important;
  opacity: 0 !important;
  transform: translateY(-2%) !important;
  pointer-events: none !important;
  transition: opacity .18s ease, transform .22s ease !important;
}
#filtersPanel.black-menu.is-open{
  opacity: 1 !important;
  transform: translateY(0) !important;
  pointer-events: auto !important;
}
#filtersPanel.black-menu .black-menu__list{
  display: grid;
  gap: 18px;
  width: min(92vw, 520px);
  padding: 24px 0;
}
#filtersPanel.black-menu .black-menu__link{
  display: block;
  width: 100%;
  text-decoration: none;
  color: #fff;
  background: #0b0b0b;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 14px;
  padding: 18px 20px;
  font-size: clamp(18px, 2.6vw, 22px);
  letter-spacing: .04em;
  text-transform: uppercase;
  text-align: center;
  transition: transform .12s ease, background .18s ease, border-color .18s ease;
}
#filtersPanel.black-menu .black-menu__link:hover{
  background: #111;
  border-color: rgba(255,255,255,.24);
  transform: translateY(-1px);
}
body.no-scroll{ overflow: hidden !important; }
    `.trim();

    const style = document.createElement("style");
    style.id = "cronox-blackmenu-style";
    style.textContent = css;
    document.head.appendChild(style);
  })();

  // ===== Overlay control (para la búsqueda; el black-menu NO usa overlay) =====
  function showOverlay(mode = "page") {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.remove("overlay--hero", "overlay--page");
    overlay.classList.add(mode === "hero" ? "overlay--hero" : "overlay--page");
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.remove("overlay--hero", "overlay--page");
  }

  // ===== Body scroll lock + compensador de scroll =============================
  let _bodyPadRightPrev = "";
  function getScrollbarW(){
    return window.innerWidth - document.documentElement.clientWidth;
  }
  function lockScroll(){
    document.body.classList.add("no-scroll");
    const sw = getScrollbarW();
    if (sw > 0){
      _bodyPadRightPrev = document.body.style.paddingRight || "";
      document.body.style.paddingRight = sw + "px";
    }
  }
  function unlockScroll(){
    document.body.classList.remove("no-scroll");
    document.body.style.paddingRight = _bodyPadRightPrev;
    _bodyPadRightPrev = "";
  }

  // ===== Menú negro de categorías (pantalla completa) =========================
  function isFiltersOpen(){ return !!filtersPanel && filtersPanel.classList.contains("is-open"); }

  function openFilters() {
    if (!filtersPanel) return;

    // 1) quitar hidden y asegurar display/visibility saneados
    filtersPanel.hidden = false;
    filtersPanel.style.display = "grid";
    filtersPanel.style.visibility = "visible";
    // limpiar posibles restos de CSS legacy inline
    filtersPanel.style.opacity = "";
    filtersPanel.style.pointerEvents = "";
    filtersPanel.style.transform = "";

    // 2) forzar reflow para que la transición arranque desde base
    void filtersPanel.offsetWidth;

    // 3) abrir
    filtersPanel.classList.add("is-open");
    btnMenu?.setAttribute("aria-expanded", "true");
    lockScroll();

    // Enfocar el primer enlace
    const firstLink = $(".black-menu__link", filtersPanel);
    firstLink?.focus();
  }

  function closeFilters() {
    if (!filtersPanel) return;

    filtersPanel.classList.remove("is-open");
    btnMenu?.setAttribute("aria-expanded", "false");

    // 4) Espera transición y oculta/limpia
    setTimeout(() => {
      filtersPanel.hidden = true;
      // Limpieza por si quedara algo de inline
      filtersPanel.style.display = "";
      filtersPanel.style.visibility = "";
      unlockScroll();
      btnMenu?.focus();
    }, 260); // > .22s por seguridad
  }

  // Exponer helpers de test en consola
  window.__testOpen = openFilters;
  window.__testClose = closeFilters;

  // Toggle desde el botón hamburguesa
  btnMenu?.addEventListener("click", (e) => {
    e.preventDefault();
    isFiltersOpen() ? closeFilters() : openFilters();
  });

  // Cerrar con ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (isFiltersOpen()) closeFilters();
      if (searchBar && !searchBar.hidden) toggleSearch(false);
    }
  });

  // Cerrar al hacer clic en cualquier enlace del menú (dejar navegar)
  filtersPanel?.addEventListener("click", (e) => {
    const a = e.target.closest("a.black-menu__link");
    if (a) closeFilters();
  });

  // Cerrar si se hace clic en el fondo negro (fuera de la lista)
  filtersPanel?.addEventListener("click", (e) => {
    const list = $(".black-menu__list", filtersPanel);
    if (list && !list.contains(e.target)) closeFilters();
  });

  // ===== Buscador (barra superior, este SÍ usa overlay) ========================
  function toggleSearch(forceOpen = null) {
    if (!searchBar) return;
    const willOpen = forceOpen ?? searchBar.hidden;
    if (willOpen) {
      searchBar.hidden = false;
      showOverlay("page");
      lockScroll();
      btnSearch?.setAttribute("aria-expanded", "true");
      setTimeout(() => searchInput?.focus(), 0);
    } else {
      searchBar.hidden = true;
      hideOverlay();
      unlockScroll();
      btnSearch?.setAttribute("aria-expanded", "false");
      btnSearch?.focus();
    }
  }

  btnSearch?.addEventListener("click", () => toggleSearch());

  searchForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (searchInput?.value || "").trim();
    // TODO: filtrar productos por q si lo necesitas.
    toggleSearch(false);
  });

  // Cierre al clicar overlay (solo afecta a búsqueda)
  overlay?.addEventListener("click", () => {
    if (searchBar && !searchBar.hidden) toggleSearch(false);
  });

  // ===== Topbar states (transparente / translúcida / opaca) ====================
  // Reglas:
  // - Transparente: en la parte más alta del documento (scroll <= 2px)
  // - Translúcida (.topbar--hero): mientras el topbar solape el hero (vídeo)
  // - Opaca (.topbar--page): al salir del hero
  function getTopbarHeight() {
    const cs = getComputedStyle(document.documentElement);
    const v = cs.getPropertyValue("--topbar-h").trim() || "64px";
    const n = parseFloat(v);
    return isNaN(n) ? 64 : n;
  }

  function setTopbarState(state) {
    if (!topbar) return;
    topbar.classList.remove("topbar--transparent", "topbar--hero", "topbar--page");
    topbar.classList.add(state);
  }

  function updateTopbarState() {
    if (!topbar || !hero) return;

    const y = window.scrollY || window.pageYOffset || 0;
    const topbarH = getTopbarHeight();

    // Transparente si estás literalmente arriba del todo (sensibilidad 2px)
    if (y <= 2) {
      setTopbarState("topbar--transparent");
      return;
    }

    // ¿Sigue el hero por debajo del topbar?
    const heroRect = hero.getBoundingClientRect();
    const heroBottomFromTopbar = heroRect.bottom - topbarH;

    // Si la parte inferior del hero aún está por debajo del borde inferior del topbar,
    // seguimos sobre el video -> estado translúcido.
    if (heroBottomFromTopbar > 0) {
      setTopbarState("topbar--hero");
    } else {
      // Ya hemos pasado el hero -> opaca
      setTopbarState("topbar--page");
    }
  }

  window.addEventListener("scroll", updateTopbarState, { passive: true });
  window.addEventListener("resize", updateTopbarState);
  window.addEventListener("orientationchange", updateTopbarState);

  // ===== Preloader + FORZAR HERO AL ENTRAR =====================================
  (function preloaderAndScroll(){
    const preloader = $("#preloader");
    let tried = false;
    function hidePreloader(){
      if (tried) return;
      tried = true;
      if (preloader) preloader.style.display = "none";
    }

    // Evitar restauración del scroll por el navegador
    try { window.history.scrollRestoration = "manual"; } catch(e){}

    window.addEventListener("load", () => {
      hidePreloader();

      // >>> IMP: siempre que se entra, limpiar #store para no saltar a la tienda
      if (location.hash) {
        const clean = location.pathname + location.search; // sin hash
        history.replaceState(null, "", clean);
      }

      // Arrancar arriba del todo para que se vea el vídeo héroe
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });

      // Recalcula estado del topbar una vez que todo pintó
      updateTopbarState();
      // Ajuste por si el video tarda en calcular tamaño
      setTimeout(updateTopbarState, 100);
    }, { once: true });

    window.addEventListener("DOMContentLoaded", () => {
      // Estado inicial por si hay reflow antes del load
      updateTopbarState();
      setTimeout(updateTopbarState, 50);
    }, { once: true });

    window.addEventListener("error", () => setTimeout(hidePreloader, 0));
  })();

})();
