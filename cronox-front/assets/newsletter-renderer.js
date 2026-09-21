(function (globalScope) {
  "use strict";

  const FALLBACK_SOURCE =
    "https://frqlgocxnyppzdgxxjuq.supabase.co/storage/v1/object/public/newsletter/chains-newsletter.jpg";
  const ASCII_ART = `


                        #@@@@@@@@@.
                     @@@@@@@@@@@@@@@@-
                   @@@@@@@@@@@@@@@@@@@@:
                 -@@@@@@@@@@@@@%.    +@@@
                +@@@@@@@@@@@@            %
                @@@@@@@@@@@         =                :
               @@@@@@@@@@@           .@@          @@
               @@@@@@@@@@@             @@@@-   @@@@
               @@@@@@@@@@*              @@@@@@@@@@:
               @@@@@@@@@@@               @@@@@@@@+
               @@@@@@@@@@@               *@@@@@@@
                @@@@@@@@@@@              @@@@@@@@@
                @@@@@@@@@@@@=           @@@@@@@@@@@#
                 @@@@@@@@@@@@@@       #@@@      *@@@@
                   @@@@@@@@@@@@@@@@@@@@@           #@@@
                    :@@@@@@@@@@@@@@@@@                @@
                       +@@@@@@@@@@@                      @



                `;
  const DEFAULT_FRAME = Object.freeze({ focalX: 50, focalY: 50, zoom: 1, fit: "COVER" });
  const DEFAULT_CONFIG = Object.freeze({
    version: 1,
    source: FALLBACK_SOURCE,
    desktop: DEFAULT_FRAME,
    mobile: DEFAULT_FRAME,
    mediaOpacity: 1,
    asciiEnabled: true,
    asciiOpacity: 1,
  });
  const controllers = new WeakMap();

  const number = (value, min, max, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const frame = (value) => ({
    focalX: number(value?.focalX, 0, 100, 50),
    focalY: number(value?.focalY, 0, 100, 50),
    zoom: number(value?.zoom, 1, 3, 1),
    fit: String(value?.fit || "COVER").toUpperCase() === "CONTAIN" ? "CONTAIN" : "COVER",
  });
  const normalize = (value = {}) => ({
    version: 1,
    source: String(value.source || FALLBACK_SOURCE),
    desktop: frame(value.desktop),
    mobile: frame(value.mobile || value.desktop),
    mediaOpacity: number(value.mediaOpacity, 0, 1, 1),
    asciiEnabled: value.asciiEnabled !== false,
    asciiOpacity: number(value.asciiOpacity, 0, 1, 1),
  });
  const deviceFor = (root) =>
    root?.dataset?.newsletterDevice ||
    (globalScope.matchMedia?.("(max-width: 860px)")?.matches ? "mobile" : "desktop");

  const scaleAscii = (overlay, pre) => {
    if (!overlay || !pre || pre.hidden) return 0;
    pre.style.transform = "none";
    const width = Math.max(pre.scrollWidth, pre.getBoundingClientRect?.().width || 0);
    const height = Math.max(pre.scrollHeight, pre.getBoundingClientRect?.().height || 0);
    const availableWidth = Math.max(0, overlay.clientWidth - 24);
    const availableHeight = Math.max(0, overlay.clientHeight - 24);
    if (!width || !height || !availableWidth || !availableHeight) return 0;
    const scale = Math.min(availableWidth / width, availableHeight / height);
    pre.style.setProperty("--newsletter-ascii-scale", String(scale));
    pre.style.transform = `scale(${scale})`;
    return scale;
  };

  const renderStructure = (root, { preview = false } = {}) => {
    if (!root || root.querySelector('.newsletter-modal-grid')) return root;
    const id = (value) => preview ? '' : ` id="${value}"`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    if (!preview) root.setAttribute('aria-labelledby', 'newsletterTitle');
    root.innerHTML = `
      <button type="button" class="newsletter-modal-close" aria-label="Cerrar"${preview ? ' tabindex="-1"' : ''}>×</button>
      <div class="newsletter-modal-grid">
        <div class="newsletter-modal-image" role="presentation">
          <div class="popup-image-wrapper">
            <img alt="" class="popup-image" draggable="false" referrerpolicy="no-referrer">
            <div class="ascii-overlay"><pre aria-hidden="true"></pre></div>
          </div>
        </div>
        <div class="newsletter-modal-content">
          <p class="newsletter-modal-kicker">CRONOX</p>
          <h3${id('newsletterTitle')} class="newsletter-modal-title">INÍCIATE CON UN 10% DE DESCUENTO</h3>
          <p class="newsletter-modal-subtitle">Suscríbete para drops, descuentos y acceso anticipado.</p>
          <form${id('newsletterForm')} class="newsletter-modal-form" novalidate>
            <input${id('newsletterEmail')} class="newsletter-modal-input" type="email" name="email" placeholder="Email" autocomplete="email" required${preview ? ' tabindex="-1"' : ''}>
            <button type="submit" class="newsletter-modal-button"${preview ? ' tabindex="-1"' : ''}>UNIRSE</button>
            <p class="newsletter-login-prompt">O si ya tienes cuenta, <button type="button" class="newsletter-login-link"${preview ? ' tabindex="-1"' : ''}>inicia sesión</button></p>
            <p${id('newsletterFeedback')} class="newsletter-modal-feedback" role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>`;
    if (preview) root.querySelector('.newsletter-modal-form')?.addEventListener('submit', (event) => event.preventDefault());
    return root;
  };

  const mount = (root, initialConfig = {}) => {
    if (!root) return null;
    renderStructure(root, { preview: root.hasAttribute('data-newsletter-preview') });
    const existing = controllers.get(root);
    if (existing) {
      existing.update(initialConfig);
      return existing;
    }
    const wrapper = root.querySelector(".popup-image-wrapper");
    const image = root.querySelector(".popup-image");
    const overlay = root.querySelector(".ascii-overlay");
    const pre = overlay?.querySelector("pre");
    if (pre) pre.textContent = ASCII_ART;
    let config = normalize(initialConfig);
    let observer = null;

    const reflow = () => {
      if (image && wrapper) {
        const selected = deviceFor(root) === "mobile" ? config.mobile : config.desktop;
        globalScope.CRONOX_MEDIA_GEOMETRY?.apply?.(image, wrapper, selected);
      }
      scaleAscii(overlay, pre);
    };
    const update = (next) => {
      config = normalize(next);
      if (overlay) {
        overlay.hidden = !config.asciiEnabled;
        overlay.style.opacity = String(config.asciiOpacity);
      }
      if (image && image.src !== config.source) image.src = config.source;
      if (image) image.style.opacity = String(config.mediaOpacity);
      globalScope.requestAnimationFrame?.(reflow) || reflow();
    };
    const onImageError = () => {
      if (image && image.src !== FALLBACK_SOURCE) image.src = FALLBACK_SOURCE;
    };
    image?.addEventListener("load", reflow);
    image?.addEventListener("error", onImageError);
    if (typeof globalScope.ResizeObserver === "function") {
      observer = new globalScope.ResizeObserver(reflow);
      if (wrapper) observer.observe(wrapper);
      if (overlay) observer.observe(overlay);
    } else {
      globalScope.addEventListener?.("resize", reflow);
    }
    const controller = {
      update,
      reflow,
      getConfig: () => config,
      destroy: () => {
        observer?.disconnect();
        globalScope.removeEventListener?.("resize", reflow);
        image?.removeEventListener("load", reflow);
        image?.removeEventListener("error", onImageError);
        controllers.delete(root);
      },
    };
    controllers.set(root, controller);
    update(initialConfig);
    return controller;
  };

  globalScope.CRONOX_NEWSLETTER_RENDERER = Object.freeze({
    FALLBACK_SOURCE,
    ASCII_ART,
    DEFAULT_CONFIG,
    normalize,
    scaleAscii,
    renderStructure,
    mount,
  });
})(typeof window !== "undefined" ? window : globalThis);
