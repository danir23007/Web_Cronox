/* ========== CRONOX — Interacciones principales (black menu + search + topbar) ========== */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);

  const topbar       = $("#topbar");
  const hero         = $("#hero");
  const overlay      = $("#overlay");

  const btnMenu      = $("#btnMenu");
  const filtersPanel = $("#filtersPanel");

  const btnSearch    = $("#btnSearch");
  const searchBar    = $("#searchBar");
  const searchForm   = $("#searchForm");
  const searchInput  = $("#searchInput");

  console.log("[CRONOX] app.js cargado — init");

  // ===== Asegurar estilos/estado del black-menu ==================================
  (function ensureBlackMenuStyles(){
    if (!filtersPanel) { console.warn("[CRONOX] No existe #filtersPanel"); return; }
    // forzar clases correctas
    filtersPanel.classList.add("black-menu");
    filtersPanel.classList.remove("filters");

    // limpiar estados heredados
    filtersPanel.classList.remove("is-open");
    document.body.classList.remove("filters-open");

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

  // ===== Overlay (solo búsqueda) =================================================
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

  // ===== Scroll lock con compensación ===========================================
  let _bodyPadRightPrev = "";
  function getScrollbarW(){ return window.innerWidth - document.documentElement.clientWidth; }
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

  // ===== Black menu ==============================================================
  let _openingGuard = false;
  function openFilters() {
    if (!filtersPanel) return;

    // visible + transición fiable
    filtersPanel.hidden = false;
    void filtersPanel.offsetWidth;

    filtersPanel.classList.add("is-open");
    document.body.classList.add("filters-open");
    btnMenu?.setAttribute("aria-expanded", "true");
    lockScroll();

    _openingGuard = true;
    setTimeout(() => { _openingGuard = false; }, 300);

    // foco
    const firstLink = filtersPanel.querySelector(".black-menu__link");
    firstLink?.focus();

    console.log("[CRONOX] Black menu -> OPEN");
  }
  function closeFilters() {
    if (!filtersPanel) return;

    filtersPanel.classList.remove("is-open");
    document.body.classList.remove("filters-open");
    btnMenu?.setAttribute("aria-expanded", "false");

    setTimeout(() => {
      filtersPanel.hidden = true;
      unlockScroll();
      btnMenu?.focus();
      console.log("[CRONOX] Black menu -> CLOSE");
    }, 260);
  }

  // 👇 Cambiamos el comportamiento: la hamburguesa **siempre abre**.
  // (para descartar cualquier estado fantasma que haga creer que ya está abierto)
  btnMenu?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openFilters();
  });

  // Cerrar con ESC
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFilters();
  });

  // Cerrar al hacer clic en enlaces
  filtersPanel?.addEventListener("click", (e) => {
    if (_openingGuard) return;
    const a = e.target.closest("a.black-menu__link");
    if (a) closeFilters();
  });

  // Cerrar si clicas en el fondo negro (fuera de la lista)
  filtersPanel?.addEventListener("click", (e) => {
    if (_openingGuard) return;
    const list = filtersPanel.querySelector(".black-menu__list");
    if (list && !list.contains(e.target)) closeFilters();
  });

  // ===== Búsqueda ================================================================
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
    // TODO: usar 'q' para filtrar si quieres
    toggleSearch(false);
  });
  overlay?.addEventListener("click", () => {
    if (searchBar && !searchBar.hidden) toggleSearch(false);
  });

  // ===== Topbar states ===========================================================
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
    if (y <= 2) { setTopbarState("topbar--transparent"); return; }
    const heroRect = hero.getBoundingClientRect();
    const heroBottomFromTopbar = heroRect.bottom - topbarH;
    if (heroBottomFromTopbar > 0) setTopbarState("topbar--hero");
    else setTopbarState("topbar--page");
  }
  window.addEventListener("scroll", updateTopbarState, { passive: true });
  window.addEventListener("resize", updateTopbarState);
  window.addEventListener("orientationchange", updateTopbarState);

  // ===== Preloader + estado inicial =============================================
  (function preloaderAndScroll(){
    const preloader = $("#preloader");
    let tried = false;
    function hidePreloader(){ if (tried) return; tried = true; if (preloader) preloader.style.display = "none"; }
    try { window.history.scrollRestoration = "manual"; } catch(e){}
    window.addEventListener("load", () => {
      hidePreloader();
      if (location.hash) {
        const clean = location.pathname + location.search;
        history.replaceState(null, "", clean);
      }
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      // asegurar estado limpio
      filtersPanel?.classList.remove("is-open");
      document.body.classList.remove("filters-open");
      filtersPanel && (filtersPanel.hidden = true);
      updateTopbarState();
      setTimeout(updateTopbarState, 100);
    }, { once: true });
    window.addEventListener("DOMContentLoaded", () => {
      updateTopbarState();
      setTimeout(updateTopbarState, 50);
    }, { once: true });
    window.addEventListener("error", () => setTimeout(hidePreloader, 0));
  })();

})();
document.addEventListener("click", (e) => {
  if (e.target.matches(".filters-close")) {
    e.preventDefault();
    const panel = document.querySelector("#filtersPanel");
    if (panel) panel.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
  }
});
