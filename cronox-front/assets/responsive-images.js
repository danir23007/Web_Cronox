(function (globalScope) {
  "use strict";

  const CONTEXTS = Object.freeze({
    card: { roles: ["card"], sizes: "(max-width: 640px) 50vw, 33vw", loading: "lazy" },
    quick: { roles: ["quick"], sizes: "(max-width: 640px) 100vw, 720px", loading: "lazy" },
    pdp: { roles: ["pdp"], sizes: "(max-width: 900px) 100vw, 62vw", loading: "eager" },
    small: { roles: ["small"], sizes: "600px", loading: "lazy" },
    cart: { roles: ["small"], sizes: "600px", loading: "lazy" },
    checkout: { roles: ["small"], sizes: "600px", loading: "lazy" },
    recommendation: { roles: ["small"], sizes: "600px", loading: "lazy" },
    galleryGrid: { roles: ["grid"], sizes: "(max-width: 700px) 100vw, 50vw", loading: "lazy" },
    galleryLarge: { roles: ["large"], sizes: "100vw", loading: "eager" },
    hero: { roles: ["mobile", "tablet", "desktop"], sizes: "100vw", loading: "eager" },
  });
  const DEFAULT_PLACEHOLDER = globalScope.CRONOX_PRODUCT_PLACEHOLDER || "assets/logo_browser.png";

  const validUrl = (value) => {
    if (typeof value !== "string" || !value.trim() || value.trim() === "[object Object]") return "";
    return globalScope.CRONOX_SECURITY?.productImageUrl?.(value, "") || "";
  };
  const variantsOf = (image) => image && typeof image === "object" && image.variants && typeof image.variants === "object"
    ? image.variants
    : {};
  const originalUrl = (image) => validUrl(typeof image === "string" ? image : image?.url || image?.imageUrl || image?.publicUrl || image?.source);
  const candidate = (image, role) => {
    const variant = variantsOf(image)[role];
    const url = validUrl(variant?.url);
    return url ? { url, width: Number(variant.width) || 0, height: Number(variant.height) || 0 } : null;
  };
  const isPlaceholder = (url) => /\/(?:logo_banner|logo_browser)\.png(?:$|[?#])/i.test(url || "");
  const asRecord = (value) => {
    if (typeof value === "string") return originalUrl(value) ? { url: originalUrl(value) } : null;
    if (!value || typeof value !== "object") return null;
    const url = originalUrl(value);
    if (!url) return null;
    return { ...value, url };
  };
  const orderedImages = (images) => [...(Array.isArray(images) ? images : [])].sort((left, right) => {
    const primary = Number(Boolean(right?.isPrimary)) - Number(Boolean(left?.isPrimary));
    return primary || Number(left?.sortOrder ?? 0) - Number(right?.sortOrder ?? 0);
  });
  const productRecords = (subject, options = {}) => {
    const result = [];
    const seenUrls = new Set();
    const seenObjects = new Set();
    const push = (value) => {
      const record = asRecord(value);
      const url = originalUrl(record);
      if (!record || !url || isPlaceholder(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      result.push(record);
    };
    const addProduct = (product) => {
      if (!product || typeof product !== "object" || seenObjects.has(product)) return;
      seenObjects.add(product);
      const imageList = [product.imageRecords, product.galleryImages, product.images]
        .find((images) => Array.isArray(images) && images.length > 0) || [];
      orderedImages(imageList).forEach(push);
      push(product.imageRecord);
      push(product.image);
      push(product.imageUrl);
    };
    // Accept an already-selected canonical image record as well as a product.
    // This prevents a valid managed URL from falling through to the logo.
    if (subject && typeof subject === "object" && (subject.url || subject.publicUrl || subject.source)) {
      push(subject);
    }
    if (options.preferSnapshot) {
      push(subject?.imageRecord);
      push(subject?.image);
      push(subject?.imageUrl);
      orderedImages(subject?.images).forEach(push);
    }
    addProduct(subject?.product);
    addProduct(subject?.variant?.product);
    addProduct(subject);
    if (!options.preferSnapshot) {
      push(subject?.imageUrl);
      push(subject?.image);
    }
    return result;
  };

  const resolve = (image, context) => {
    const config = CONTEXTS[context] || CONTEXTS.card;
    const candidates = config.roles.map((role) => candidate(image, role)).filter(Boolean);
    const preferred = candidates[candidates.length - 1];
    const fallback = originalUrl(image);
    return {
      src: preferred?.url || fallback,
      srcset: candidates.filter((item) => item.width > 0).sort((left, right) => left.width - right.width).map((item) => `${item.url} ${item.width}w`).join(", "),
      sizes: config.sizes,
      width: preferred?.width || Number(image?.width) || null,
      height: preferred?.height || Number(image?.height) || null,
      loading: config.loading,
    };
  };
  const resolveProduct = (subject, context = "card", options = {}) => {
    const records = productRecords(subject, options);
    const realCandidates = [];
    records.forEach((record) => {
      const optimized = resolve(record, context);
      [optimized.src, originalUrl(record)].forEach((url) => {
        if (url && !realCandidates.includes(url)) realCandidates.push(url);
      });
    });
    const firstRecord = records[0] || null;
    const first = firstRecord ? resolve(firstRecord, context) : resolve(null, context);
    const placeholder = validUrl(options.placeholder === false ? "" : options.placeholder || DEFAULT_PLACEHOLDER);
    return {
      ...first,
      src: realCandidates[0] || placeholder,
      record: firstRecord,
      candidates: placeholder ? [...realCandidates, placeholder] : realCandidates,
      isPlaceholder: realCandidates.length === 0,
    };
  };
  const recordFor = (product, source) => {
    if (source && typeof source === "object") return source;
    const url = originalUrl(source);
    return productRecords(product).find((item) => originalUrl(item) === url) || asRecord(source) || { url: "" };
  };
  const applyResolved = (element, resolved, options) => {
    if (!element) return resolved;
    if (resolved.srcset) {
      if (element.getAttribute("sizes") !== resolved.sizes) {
        element.sizes = resolved.sizes;
      }
      if (element.getAttribute("srcset") !== resolved.srcset) {
        element.srcset = resolved.srcset;
      }
    } else {
      element.removeAttribute("srcset");
      element.removeAttribute("sizes");
    }
    if (resolved.src && element.getAttribute("src") !== resolved.src) {
      element.src = resolved.src;
    }
    if (resolved.width && resolved.height) {
      element.width = resolved.width;
      element.height = resolved.height;
    }
    element.loading = options?.loading || resolved.loading;
    element.decoding = "async";
    if (options?.fetchPriority) element.setAttribute("fetchpriority", options.fetchPriority);
    return resolved;
  };
  const apply = (element, image, context, options) => applyResolved(element, resolve(image, context), options);
  const applyProduct = (element, subject, context, options = {}) => {
    const resolved = resolveProduct(subject, context, options);
    applyResolved(element, resolved, options);
    if (!element) return resolved;
    let index = 0;
    element.onerror = () => {
      index += 1;
      const next = resolved.candidates[index];
      element.removeAttribute("srcset");
      element.removeAttribute("sizes");
      if (!next) {
        element.onerror = null;
        return;
      }
      if (index === resolved.candidates.length - 1) element.onerror = null;
      element.src = next;
    };
    return resolved;
  };

  globalScope.CRONOX_IMAGES = { CONTEXTS, apply, applyProduct, candidate, originalUrl, productRecords, recordFor, resolve, resolveProduct };
})(window);
