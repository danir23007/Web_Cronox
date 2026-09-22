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
  const DEFAULT_ASCII_FRAME = Object.freeze({ x: 50, y: 50, scale: 1 });
  const DEFAULT_CONFIG = Object.freeze({
    version: 1,
    source: FALLBACK_SOURCE,
    desktop: DEFAULT_FRAME,
    mobile: DEFAULT_FRAME,
    desktopAscii: DEFAULT_ASCII_FRAME,
    mobileAscii: DEFAULT_ASCII_FRAME,
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
  const VIEWPORTS = Object.freeze({
    desktop: Object.freeze({ width: 1280, height: 720 }),
    mobile: Object.freeze({ width: 390, height: 844 }),
  });
  const validFrame = (value) =>
    value &&
    Number.isFinite(Number(value.focalX)) && Number(value.focalX) >= 0 && Number(value.focalX) <= 100 &&
    Number.isFinite(Number(value.focalY)) && Number(value.focalY) >= 0 && Number(value.focalY) <= 100 &&
    Number.isFinite(Number(value.zoom)) && Number(value.zoom) >= 1 && Number(value.zoom) <= 3 &&
    ["COVER", "CONTAIN"].includes(String(value.fit || "").toUpperCase());
  const validAsciiFrame = (value) =>
    value &&
    Number.isFinite(Number(value.x)) && Number(value.x) >= 5 && Number(value.x) <= 95 &&
    Number.isFinite(Number(value.y)) && Number(value.y) >= 5 && Number(value.y) <= 95 &&
    Number.isFinite(Number(value.scale)) && Number(value.scale) >= 0.5 && Number(value.scale) <= 2;
  const previewFit = (availableWidth, designWidth, designHeight) => {
    const available = Math.max(0, Number(availableWidth) || 0);
    const width = Math.max(0, Number(designWidth) || 0);
    const height = Math.max(0, Number(designHeight) || 0);
    const scale = available && width ? Math.min(1, available / width) : 0;
    return Object.freeze({
      availableWidth: available,
      designWidth: width,
      designHeight: height,
      scale,
      renderedWidth: width * scale,
      renderedHeight: height * scale,
    });
  };
  const asciiFrame = (value) => ({
    x: number(value?.x, 5, 95, 50),
    y: number(value?.y, 5, 95, 50),
    scale: number(value?.scale, 0.5, 2, 1),
  });
  const normalize = (value = {}) => {
    const desktop = frame(value.desktop);
    const desktopAscii = asciiFrame(value.desktopAscii);
    return {
      version: 1,
      source: String(value.source || FALLBACK_SOURCE),
      desktop,
      mobile: frame(validFrame(value.mobile) ? value.mobile : desktop),
      desktopAscii,
      mobileAscii: asciiFrame(validAsciiFrame(value.mobileAscii) ? value.mobileAscii : desktopAscii),
      mediaOpacity: number(value.mediaOpacity, 0, 1, 1),
      asciiEnabled: value.asciiEnabled !== false,
      asciiOpacity: number(value.asciiOpacity, 0, 1, 1),
    };
  };
  const deviceFor = (root) =>
    root?.dataset?.newsletterDevice ||
    (globalScope.matchMedia?.("(max-width: 860px)")?.matches ? "mobile" : "desktop");

  const scaleAscii = (overlay, pre, selected = DEFAULT_ASCII_FRAME) => {
    if (!overlay || !pre || pre.hidden) return 0;
    pre.style.transform = "none";
    const width = Math.max(pre.scrollWidth, pre.getBoundingClientRect?.().width || 0);
    const height = Math.max(pre.scrollHeight, pre.getBoundingClientRect?.().height || 0);
    const availableWidth = Math.max(0, overlay.clientWidth - 24);
    const availableHeight = Math.max(0, overlay.clientHeight - 24);
    if (!width || !height || !availableWidth || !availableHeight) return 0;
    const fitScale = Math.min(availableWidth / width, availableHeight / height);
    const scale = fitScale * selected.scale;
    pre.style.left = `${selected.x}%`;
    pre.style.top = `${selected.y}%`;
    pre.style.setProperty("--newsletter-ascii-scale", String(scale));
    pre.style.transform = `translate(-50%, -50%) scale(${scale})`;
    return scale;
  };

  const renderStructure = (root, { preview = false } = {}) => {
    if (!root || root.querySelector('.newsletter-modal-grid')) return root;
    const id = (value) => preview ? '' : ` id="${value}"`;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    if (!preview) root.setAttribute('aria-labelledby', 'newsletterTitle');
    root.innerHTML = `
      <button type="button" class="newsletter-modal-close" aria-label="Cerrar newsletter"${preview ? ' tabindex="-1"' : ''}>×</button>
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
      const mobile = deviceFor(root) === "mobile";
      if (image && wrapper) {
        const selected = mobile ? config.mobile : config.desktop;
        globalScope.CRONOX_MEDIA_GEOMETRY?.apply?.(image, wrapper, selected);
      }
      scaleAscii(
        overlay,
        pre,
        mobile ? config.mobileAscii : config.desktopAscii,
      );
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
    DEFAULT_ASCII_FRAME,
    VIEWPORTS,
    previewFit,
    normalize,
    scaleAscii,
    renderStructure,
    mount,
  });
})(typeof window !== "undefined" ? window : globalThis);
