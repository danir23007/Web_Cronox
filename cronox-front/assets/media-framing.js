(function () {
  "use strict";

  if (window.CRONOX_MEDIA_FRAMING?.initialized) return;

  const CACHE_KEY = "cronox.mediaFraming.web.v5";
  const HERO_KEY = "home.hero.video";
  const DEFAULT_FRAME = Object.freeze({
    focalX: 50,
    focalY: 50,
    zoom: 1,
    fit: "COVER",
  });
  const DEFAULT_CONFIGURATION = Object.freeze({
    version: 5,
    placements: {
      [HERO_KEY]: Object.freeze({
        desktop: DEFAULT_FRAME,
        tablet: null,
        mobile: null,
        source: "/assets/VIDEO_LOGO_CRONOX.mp4",
        poster: "/assets/logo_banner.png",
        mediaType: "video",
        heroText: Object.freeze({
          enabled: false,
          content: "",
          desktop: Object.freeze({ x: 50, y: 50, align: "CENTER", color: "#ffffff", fontSize: 42, fontWeight: 800, letterSpacing: 1.5, uppercase: false, maxWidth: 90 }),
          tablet: Object.freeze({ x: 50, y: 50, align: "CENTER", color: "#ffffff", fontSize: 42, fontWeight: 800, letterSpacing: 1.5, uppercase: false, maxWidth: 90 }),
          mobile: Object.freeze({ x: 50, y: 50, align: "CENTER", color: "#ffffff", fontSize: 30, fontWeight: 800, letterSpacing: 1.5, uppercase: false, maxWidth: 90 }),
        }),
      }),
    },
  });
  const geometry = window.CRONOX_MEDIA_GEOMETRY;
  const pageDocument = window.document;
  const mobileQuery = window.matchMedia?.("(max-width: 767px)");
  const tabletQuery = window.matchMedia?.("(max-width: 1023px)");
  const observedFrames = new WeakSet();
  const observedMedia = new WeakSet();
  let configuration = DEFAULT_CONFIGURATION;
  let requestPromise = null;

  const safeMediaUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim(), window.location.origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  };

  const validFrame = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const { focalX, focalY, zoom } = value;
    const fit = String(value.fit || "").toUpperCase();
    if (
      typeof focalX !== "number" ||
      !Number.isFinite(focalX) ||
      focalX < 0 ||
      focalX > 100 ||
      typeof focalY !== "number" ||
      !Number.isFinite(focalY) ||
      focalY < 0 ||
      focalY > 100 ||
      typeof zoom !== "number" ||
      !Number.isFinite(zoom) ||
      zoom < 1 ||
      zoom > 3 ||
      !["COVER", "CONTAIN"].includes(fit)
    ) {
      return null;
    }
    return { focalX, focalY, zoom, fit };
  };

  const normalizeHeroText = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { enabled: false, content: "" };
    }
    const content = typeof value.content === "string" ? value.content.trim().slice(0, 160) : "";
    const number = (candidate, fallback, min, max) =>
      typeof candidate === "number" && Number.isFinite(candidate)
        ? Math.min(max, Math.max(min, candidate))
        : fallback;
    const viewport = (candidate, fallback) => ({
      x: number(candidate?.x, fallback.x, 0, 100),
      y: number(candidate?.y, fallback.y, 0, 100),
      align: ["LEFT", "CENTER", "RIGHT"].includes(candidate?.align) ? candidate.align : fallback.align,
      color: /^#[0-9a-f]{6}$/i.test(candidate?.color || "") ? candidate.color : fallback.color,
      fontSize: number(candidate?.fontSize, fallback.fontSize, 12, 120),
      fontWeight: [300, 400, 500, 600, 700, 800, 900].includes(candidate?.fontWeight) ? candidate.fontWeight : fallback.fontWeight,
      letterSpacing: number(candidate?.letterSpacing, fallback.letterSpacing, -2, 20),
      uppercase:
        candidate?.uppercase === undefined
          ? fallback.uppercase
          : candidate.uppercase === true,
      maxWidth: number(candidate?.maxWidth, fallback.maxWidth, 10, 100),
    });
    const legacyDesktop = viewport(value, {
      x: 50, y: 50, align: "CENTER", color: "#ffffff", fontSize: 42,
      fontWeight: 800, letterSpacing: 1.5, uppercase: false, maxWidth: 90,
    });
    const legacyMobile = viewport({
      ...value,
      x: value.mobileX,
      y: value.mobileY,
      fontSize: value.mobileFontSize,
    }, { ...legacyDesktop, fontSize: 30 });
    return {
      enabled: value.enabled === true && Boolean(content),
      content,
      desktop: viewport(value.desktop, legacyDesktop),
      tablet: viewport(value.tablet, legacyDesktop),
      mobile: viewport(value.mobile, legacyMobile),
    };
  };

  const normalizeConfiguration = (payload) => {
    const value = payload?.placements?.[HERO_KEY];
    const desktop = validFrame(value?.desktop);
    const source = safeMediaUrl(value?.source);
    const mediaType = value?.mediaType;
    if (!desktop || !source || !["image", "video"].includes(mediaType)) {
      return null;
    }
    return {
      version: 5,
      placements: {
        [HERO_KEY]: {
          desktop,
          tablet: validFrame(value?.tablet),
          mobile: validFrame(value?.mobile),
          source,
          poster: safeMediaUrl(value?.poster),
          mediaType,
          heroText: normalizeHeroText(value?.heroText),
        },
      },
    };
  };

  const currentDevice = () =>
    mobileQuery?.matches
      ? "mobile"
      : tabletQuery?.matches
        ? "tablet"
        : "desktop";

  const currentFrame = () => {
    const responsive = configuration.placements[HERO_KEY];
    return responsive[currentDevice()] || responsive.desktop;
  };

  const ensureHeroText = () => {
    const heroText = configuration.placements[HERO_KEY]?.heroText;
    const section = pageDocument.querySelector(".hero-video-section");
    let node = section?.querySelector(".hero-overlay-text");
    if (!section || !heroText?.enabled || !heroText.content) {
      node?.remove();
      return;
    }
    if (!node) {
      node = pageDocument.createElement("p");
      node.className = "hero-overlay-text";
      section.appendChild(node);
    }
    const device = currentDevice();
    const selected = geometry?.heroTextViewport?.(heroText, device) || heroText[device];
    node.textContent = selected?.uppercase
      ? heroText.content.toUpperCase()
      : heroText.content;
    geometry?.applyHeroText?.(node, section, heroText, device);
  };

  const ensureHeroElement = () => {
    const configured = configuration.placements[HERO_KEY];
    let element = pageDocument.querySelector(
      `[data-media-placement="${HERO_KEY}"]`,
    );
    if (!element) return null;
    const expectedTag = configured.mediaType === "video" ? "VIDEO" : "IMG";
    if (element.tagName !== expectedTag) {
      const replacement = pageDocument.createElement(
        configured.mediaType === "video" ? "video" : "img",
      );
      replacement.className = element.className || "hero-video";
      replacement.dataset.mediaPlacement = HERO_KEY;
      replacement.setAttribute("draggable", "false");
      if (configured.mediaType === "video") {
        replacement.autoplay = true;
        replacement.muted = true;
        replacement.loop = true;
        replacement.playsInline = true;
        replacement.preload = "auto";
      } else {
        replacement.alt = "";
        replacement.decoding = "async";
      }
      element.replaceWith(replacement);
      element = replacement;
    }
    const source = configured.source;
    if (element.getAttribute("src") !== source) {
      element.setAttribute("src", source);
    }
    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.playsInline = true;
      if (configured.poster) element.poster = configured.poster;
      else element.removeAttribute("poster");
    }
    return element;
  };

  const applyHero = (element) => {
    if (!geometry || !element) return null;
    const frameElement =
      element.closest(".hero-video-section") || element.parentElement;
    if (!frameElement) return null;
    const result = geometry.apply(element, frameElement, currentFrame());
    if (!observedFrames.has(frameElement)) {
      observedFrames.add(frameElement);
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(applyAll);
        observer.observe(frameElement);
      }
    }
    if (!observedMedia.has(element)) {
      observedMedia.add(element);
      element.addEventListener("loadedmetadata", applyAll);
      element.addEventListener("load", applyAll);
    }
    return result;
  };

  const applyAll = () => {
    const element = ensureHeroElement();
    if (element) applyHero(element);
    ensureHeroText();
    pageDocument.documentElement.dataset.mediaFramingState =
      configuration === DEFAULT_CONFIGURATION ? "default" : "ready";
  };

  const readCache = () => {
    try {
      return normalizeConfiguration(
        JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null"),
      );
    } catch {
      return null;
    }
  };

  const writeCache = (payload) => {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be unavailable in hardened/private browsing contexts.
    }
  };

  const clearCache = () => {
    try {
      window.localStorage.removeItem(CACHE_KEY);
      window.localStorage.removeItem("cronox.mediaFraming.web.v4");
      window.localStorage.removeItem("cronox.mediaFraming.web.v2");
      window.localStorage.removeItem("cronox.mediaFraming.web.v3");
      window.localStorage.removeItem("cronox.mediaFraming.v1");
    } catch {
      // Storage can be unavailable in hardened/private browsing contexts.
    }
  };

  const load = () => {
    if (requestPromise) return requestPromise;
    const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
    requestPromise = fetch(`${base}/api/media-framing`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Media framing ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const normalized = normalizeConfiguration(payload);
        if (!normalized) throw new Error("Invalid media framing response");
        configuration = normalized;
        writeCache(normalized);
        applyAll();
        pageDocument.dispatchEvent(
          new CustomEvent("cronox:media-framing-ready"),
        );
        return normalized;
      })
      .catch(() => {
        configuration = DEFAULT_CONFIGURATION;
        clearCache();
        applyAll();
        pageDocument.dispatchEvent(
          new CustomEvent("cronox:media-framing-error"),
        );
        return configuration;
      });
    return requestPromise;
  };

  configuration = readCache() || DEFAULT_CONFIGURATION;
  applyAll();

  [mobileQuery, tabletQuery].forEach((query) => {
    const reapply = () => applyAll();
    if (typeof query?.addEventListener === "function") {
      query.addEventListener("change", reapply);
    } else if (typeof query?.addListener === "function") {
      query.addListener(reapply);
    }
  });
  window.addEventListener("resize", applyAll, { passive: true });

  load();
  window.CRONOX_MEDIA_FRAMING = {
    initialized: true,
    load,
    applyAll,
    defaults: DEFAULT_CONFIGURATION,
  };
})();
