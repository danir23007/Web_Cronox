/* ========== CRONOX — Interacciones principales (drawer lateral filtros) ========== */
(() => {
  "use strict";

  // Helpers
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Elements
  const topbar        = $("#topbar");
  const hero          = $("#hero");
  const overlay       = $("#overlay");

  const btnMenu       = $("#btnMenu");          // botón 3 líneas
  const filtersPanel  = $("#filtersPanel");     // <aside id="filtersPanel">
  const btnClose      = $("#btnCloseFilters");  // ✕ dentro del drawer

  const btnSearch     = $("#btnSearch");
  const searchBar     = $("#searchBar");
  const searchForm    = $("#searchForm");
  const searchInput   = $("#searchInput");

  // ===== Overlay control =======================================================
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

  // ===== Body scroll lock ======================================================
  function lockScroll()   { document.body.classList.add("no-scroll"); }
  function unlockScroll() { document.body.classList.remove("no-scroll"); }

  // ===== Drawer Filtros (lateral izquierdo) ===================================
  function openFilters() {
    if (!filtersPanel) return;
    filtersPanel.hidden = false;              // asegúrate de que entra en flujo
    filtersPanel.classList.add("is-open");    // CSS hace translateX(0)
    btnMenu?.setAttribute("aria-expanded", "true");
    showOverlay("page");
    lockScroll();

    // Enfocar primer control útil
    const firstFocusable = $("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])", filtersPanel) || btnClose;
    firstFocusable?.focus();
  }

  function closeFilters() {
    if (!filtersPanel) return;
    filtersPanel.classList.remove("is-open");
    btnMenu?.setAttribute("aria-expanded", "false");
    hideOverlay();
    unlockScroll();

    // Devolver foco al trigger por accesibilidad
    btnMenu?.focus();

    // Si quieres ocultar del árbol tras la transición, descomenta:
    // setTimeout(() => { filtersPanel.hidden = true; }, 250);
  }

  btnMenu?.addEventListener("click", () => {
    const open = filtersPanel?.classList.contains("is-open");
    open ? closeFilters() : openFilters();
  });

  btnClose?.addEventListener("click", closeFilters);

  // Cierre al clicar overlay
  overlay?.addEventListener("click", () => {
    if (filtersPanel?.classList.contains("is-open")) closeFilters();
    if (searchBar && !searchBar.hidden) toggleSearch(false);
  });

  // Cierre con Esc
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (filtersPanel?.classList.contains("is-open")) closeFilters();
      if (searchBar && !searchBar.hidden) toggleSearch(false);
    }
  });

  // ===== Buscador (barra superior) ============================================
  function toggleSearch(forceOpen = null) {
    if (!searchBar) return;
    const willOpen = forceOpen ?? searchBar.hidden;
    if (willOpen) {
      searchBar.hidden = false;
      showOverlay("page");
      lockScroll();
      btnSearch?.setAttribute("aria-expanded", "true");
      // focus diferido para móviles
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
    // Aquí podrías filtrar productos por q si lo necesitas.
    toggleSearch(false);
  });

  // ===== Topbar: transparente sobre héroe, opaca fuera ========================
  function setupTopbarObserver() {
    if (!topbar || !hero || !("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio > 0.15) {
          // En el área del héroe (parte alta): transparente
          topbar.classList.add("topbar--transparent");
          topbar.classList.remove("topbar--page");
        } else {
          // Fuera del héroe: opaca 100%
          topbar.classList.remove("topbar--transparent");
          topbar.classList.add("topbar--page");
        }
      },
      { threshold: [0, 0.15, 0.5, 1] }
    );
    io.observe(hero);
  }
  setupTopbarObserver();

  // ===== Preloader failsafe + scroll al inicio =================================
  (function preloaderAndScroll(){
    const preloader = $("#preloader");
    let tried = false;
    function hidePreloader(){
      if (tried) return;
      tried = true;
      if (preloader) preloader.style.display = "none";
    }

    // Evitar restauración del scroll
    try { window.history.scrollRestoration = "manual"; } catch(e){}

    window.addEventListener("load", () => {
      hidePreloader();
      // Arrancar arriba del todo para que se vea el vídeo héroe
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, { once: true });

    window.addEventListener("DOMContentLoaded", () => setTimeout(hidePreloader, 3500), { once: true });
    window.addEventListener("error", () => setTimeout(hidePreloader, 0));
  })();

})();
