(function (globalScope) {
  "use strict";

  const DEFAULTS = Object.freeze({
    focalX: 50,
    focalY: 50,
    zoom: 1,
    minZoom: 0.5,
    maxZoom: 3,
    fit: "CONTAIN",
  });

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  const resolve = (product = {}) => ({
    ...DEFAULTS,
    focalX: clamp(product.cardImagePositionX, 0, 100, DEFAULTS.focalX),
    focalY: clamp(product.cardImagePositionY, 0, 100, DEFAULTS.focalY),
    zoom: clamp(product.cardImageZoom, DEFAULTS.minZoom, DEFAULTS.maxZoom, DEFAULTS.zoom),
  });

  const apply = (image, frame, product, dimensions) => {
    const geometry = globalScope.CRONOX_MEDIA_GEOMETRY;
    if (!geometry?.apply || !image || !frame) return { valid: false };
    return geometry.apply(image, frame, resolve(product), dimensions);
  };

  const bind = (image, frame, product) => {
    if (!image || !frame) return () => {};
    image.dataset.cardPrimaryImage = "true";
    const render = () => apply(image, frame, product);
    image.addEventListener("load", render);
    if (image.complete) render();
    const animationFrame = typeof globalScope.requestAnimationFrame === "function"
      ? globalScope.requestAnimationFrame(render)
      : null;
    const observer = typeof globalScope.ResizeObserver === "function"
      ? new globalScope.ResizeObserver(render)
      : null;
    observer?.observe(frame);
    return () => {
      image.removeEventListener("load", render);
      if (animationFrame !== null && typeof globalScope.cancelAnimationFrame === "function") {
        globalScope.cancelAnimationFrame(animationFrame);
      }
      observer?.disconnect();
    };
  };

  const api = Object.freeze({ version: 1, DEFAULTS, resolve, apply, bind });
  globalScope.CRONOX_PRODUCT_CARD_FRAMING = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
