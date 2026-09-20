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

  const mount = (root, initialConfig = {}) => {
    if (!root) return null;
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
    mount,
  });
})(typeof window !== "undefined" ? window : globalThis);
