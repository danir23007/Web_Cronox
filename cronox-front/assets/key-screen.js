(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $("keyGate"),
    loader: $("keyLoader"),
    frame: $("keyMediaFrame"),
    shade: $("keyShade"),
    content: $("keyContent"),
    unavailable: $("keyUnavailable"),
    title: $("keyTitle"),
    subtitle: $("keySubtitle"),
    form: $("keyRegister"),
    email: $("keyEmail"),
    submit: $("keySubmit"),
    message: $("keyFormMessage"),
    success: $("keySuccess"),
    privacy: $("keyPrivacy"),
  };
  const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
  const MEDIA_READY_TIMEOUT_MS = 8000;
  let screen = null;
  let media = null;
  let loaderRemovalTimer = 0;
  let mediaReadyTimer = 0;
  let fitFrame = 0;
  let expirationAtMs = null;
  let serverEpochMs = 0;
  let serverSyncMonotonicMs = 0;
  let expirationTimer = 0;
  let retryDelayMs = 15_000;
  let checkInFlight = false;
  let lastCheckMonotonicMs = 0;
  const requestFrame =
    window.requestAnimationFrame?.bind(window) ||
    ((callback) => window.setTimeout(callback, 0));
  const cancelFrame =
    window.cancelAnimationFrame?.bind(window) ||
    window.clearTimeout.bind(window);
  const monotonicNow = () => window.performance?.now?.() ?? Date.now();
  const estimatedServerNow = () =>
    serverEpochMs
      ? serverEpochMs + Math.max(0, monotonicNow() - serverSyncMonotonicMs)
      : Date.now();

  const syncServerClock = (serverTime, expiresAt) => {
    const parsedServerTime = Date.parse(serverTime || "");
    if (Number.isFinite(parsedServerTime)) {
      serverEpochMs = parsedServerTime;
      serverSyncMonotonicMs = monotonicNow();
    }
    const parsedExpiration = Date.parse(expiresAt || "");
    expirationAtMs = Number.isFinite(parsedExpiration)
      ? parsedExpiration
      : null;
  };
  const leaveGate = () => {
    if (typeof window.CRONOX_KEY_SCREEN_NAVIGATE === "function") {
      window.CRONOX_KEY_SCREEN_NAVIGATE("/");
      return;
    }
    location.replace("/");
  };

  const viewportSize = () => ({
    width: Math.max(
      1,
      document.documentElement.clientWidth || window.innerWidth,
    ),
    height: Math.max(1, window.visualViewport?.height || window.innerHeight),
  });

  const safeUrl = (value) => {
    try {
      const url = new URL(value, location.origin);
      return ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.href
        : "";
    } catch {
      return "";
    }
  };

  const privacyUrl = (value) => {
    const safe = safeUrl(value) || `${location.origin}/privacidad`;
    const url = new URL(safe);
    if (
      url.origin === location.origin &&
      ["/privacidad", "/privacy-policy.html"].includes(
        url.pathname.replace(/\/+$/, ""),
      )
    ) {
      url.pathname = "/privacidad";
      url.searchParams.set("source", "key-screen");
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return url.href;
  };

  const number = (value, min, max, fallback) =>
    Number.isFinite(Number(value))
      ? Math.min(max, Math.max(min, Number(value)))
      : fallback;
  const renderer = window.CRONOX_KEY_SCREEN_RENDERER;
  const device = () => renderer.deviceForWidth(viewportSize().width);

  const applyViewport = () => {
    const viewport = viewportSize();
    return renderer.applyViewport(el.gate, viewport.width, viewport.height);
  };

  const visibleCompositionRects = () =>
    [el.content, el.title, el.subtitle, el.form, el.success, el.privacy]
      .filter((element) => element && !element.hidden)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

  const fitComposition = () => {
    if (!screen || el.content.hidden) return;
    cancelFrame(fitFrame);
    fitFrame = requestFrame(() => {
      el.gate.style.removeProperty("height");
      delete el.content.dataset.fitOverflow;
      el.content.style.setProperty("--key-fit-shift-x", "0px");
      el.content.style.setProperty("--key-fit-shift-y", "0px");

      const viewport = window.visualViewport;
      const gateStyles = getComputedStyle(el.gate);
      const left =
        (viewport?.offsetLeft || 0) + (parseFloat(gateStyles.paddingLeft) || 0);
      const top =
        (viewport?.offsetTop || 0) + (parseFloat(gateStyles.paddingTop) || 0);
      const right =
        (viewport?.offsetLeft || 0) +
        (viewport?.width || window.innerWidth) -
        (parseFloat(gateStyles.paddingRight) || 0);
      const bottom =
        (viewport?.offsetTop || 0) +
        (viewport?.height || window.innerHeight) -
        (parseFloat(gateStyles.paddingBottom) || 0);
      let rects = visibleCompositionRects();
      if (!rects.length) return;
      let minX = Math.min(...rects.map((rect) => rect.left));
      let maxX = Math.max(...rects.map((rect) => rect.right));
      let minY = Math.min(...rects.map((rect) => rect.top));
      let maxY = Math.max(...rects.map((rect) => rect.bottom));
      const availableHeight = bottom - top;
      const compositionHeight = maxY - minY;

      if (compositionHeight > availableHeight) {
        el.content.dataset.fitOverflow = "true";
        el.gate.style.height = `${Math.ceil(compositionHeight + (parseFloat(gateStyles.paddingTop) || 0) + (parseFloat(gateStyles.paddingBottom) || 0))}px`;
        rects = visibleCompositionRects();
        minX = Math.min(...rects.map((rect) => rect.left));
        maxX = Math.max(...rects.map((rect) => rect.right));
        minY = Math.min(...rects.map((rect) => rect.top));
        maxY = Math.max(...rects.map((rect) => rect.bottom));
      }

      const shiftX =
        minX < left ? left - minX : maxX > right ? right - maxX : 0;
      const shiftY =
        minY < top
          ? top - minY
          : maxY > bottom && compositionHeight <= availableHeight
            ? bottom - maxY
            : compositionHeight > availableHeight
              ? top - minY
              : 0;
      el.content.style.setProperty(
        "--key-fit-shift-x",
        `${Math.round(shiftX)}px`,
      );
      el.content.style.setProperty(
        "--key-fit-shift-y",
        `${Math.round(shiftY)}px`,
      );
    });
  };

  const applyMedia = () => {
    if (!media || !screen) return;
    window.CRONOX_MEDIA_GEOMETRY?.apply(
      media,
      el.frame,
      renderer.resolve(screen, device()),
    );
  };

  const applyPosition = () => {
    renderer.applyContent(el.content, screen, device());
    renderer.applyInternalOffsets(el.form, el.privacy, screen, device());
    fitComposition();
  };

  const removeLoader = () => {
    if (!el.loader || el.loader.hidden) return;
    el.loader.classList.add("is-leaving");
    window.clearTimeout(loaderRemovalTimer);
    loaderRemovalTimer = window.setTimeout(
      () => {
        el.loader.hidden = true;
      },
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450,
    );
  };

  const revealConfiguredScreen = (mediaState) => {
    window.clearTimeout(mediaReadyTimer);
    el.unavailable.hidden = true;
    el.content.hidden = false;
    el.gate.setAttribute("aria-busy", "false");
    document.documentElement.dataset.keyScreenMediaState = mediaState;
    document.documentElement.dataset.keyScreenState = "ready";
    fitComposition();
    removeLoader();
  };

  const showEmergencyFallback = (error) => {
    window.clearTimeout(mediaReadyTimer);
    el.frame.replaceChildren();
    el.content.hidden = true;
    el.unavailable.hidden = false;
    el.gate.setAttribute("aria-busy", "false");
    document.documentElement.dataset.keyScreenState = "unavailable";
    console.error(
      "[CRONOX PANTALLA CLAVE] No se pudo hidratar la configuración pública; se muestra el fallback seguro.",
      error,
    );
    removeLoader();
  };

  const handleMediaFailure = (reason) => {
    window.clearTimeout(mediaReadyTimer);
    el.frame.replaceChildren();
    media = null;
    console.error(
      "[CRONOX PANTALLA CLAVE] La pantalla activa se cargó, pero el navegador no pudo mostrar su archivo multimedia.",
      reason,
    );
    revealConfiguredScreen(reason === "timeout" ? "timeout" : "error");
  };

  const prepareMedia = (source, mediaType) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };

    media = document.createElement(mediaType === "video" ? "video" : "img");
    media.setAttribute("aria-hidden", "true");
    if (media.tagName === "VIDEO") {
      media.autoplay = true;
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = "auto";
    }

    const readyEvent = media.tagName === "VIDEO" ? "loadeddata" : "load";
    media.addEventListener(
      readyEvent,
      () =>
        finish(() => {
          applyMedia();
          if (media.tagName === "VIDEO") {
            media.play().catch(() => undefined);
          }
          revealConfiguredScreen("ready");
        }),
      { once: true },
    );
    media.addEventListener(
      "error",
      () => finish(() => handleMediaFailure("error")),
      { once: true },
    );
    el.frame.replaceChildren(media);
    media.src = source;
    if (media.tagName === "VIDEO") media.load();

    mediaReadyTimer = window.setTimeout(
      () => finish(() => handleMediaFailure("timeout")),
      MEDIA_READY_TIMEOUT_MS,
    );
  };

  const render = (value) => {
    screen = value;
    applyViewport();
    const source = safeUrl(screen.media?.source);
    const mediaType = screen.media?.mediaType;
    el.shade.style.opacity = String(
      number(screen.overlayStrength, 0, 90, 25) / 100,
    );
    el.content.style.setProperty("--key-text", screen.textColor || "#fff");
    el.content.dataset.inputStyle = screen.inputStyle;
    el.content.dataset.buttonStyle = screen.buttonStyle;
    el.title.textContent = screen.title;
    el.subtitle.textContent = screen.subtitle;
    el.email.placeholder = screen.placeholder;
    el.submit.textContent = screen.buttonText;
    el.privacy.textContent = screen.privacyLabel;
    el.privacy.href = privacyUrl(screen.privacyUrl);
    el.success.querySelector("h2").textContent = screen.successTitle;
    el.success.querySelector("p").textContent = screen.successMessage;
    applyPosition();

    if (!source || !["image", "video"].includes(mediaType)) {
      console.error(
        "[CRONOX PANTALLA CLAVE] La configuración activa no contiene una URL multimedia pública válida. El formulario se muestra sobre el fondo seguro.",
      );
      el.frame.replaceChildren();
      revealConfiguredScreen("unavailable");
      return;
    }
    prepareMedia(source, mediaType);
  };

  const scheduleExpirationCheck = (callback, delayOverride) => {
    window.clearTimeout(expirationTimer);
    const remaining = expirationAtMs === null
      ? null
      : expirationAtMs - estimatedServerNow();
    if (remaining === null && delayOverride === undefined) return;
    const delay = delayOverride ?? Math.max(0, Math.min(300_000, remaining + 50));
    expirationTimer = window.setTimeout(callback, delay);
  };

  const load = async (initial = false) => {
    if (checkInFlight) return;
    checkInFlight = true;
    lastCheckMonotonicMs = monotonicNow();
    try {
      const endpoint = `${base}/api/key-screen`;
      const response = await fetch(endpoint, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok)
        throw new Error(`La API pública respondió HTTP ${response.status}.`);
      const payload = await response.json();
      syncServerClock(payload.serverTime, payload.expiresAt);
      if (!payload.enabled || !payload.screen) {
        console.error(
          "[CRONOX PANTALLA CLAVE] El servidor mostró la puerta, pero la API pública no devolvió una pantalla activa.",
          {
            enabled: payload.enabled,
            hasScreen: Boolean(payload.screen),
            endpoint,
          },
        );
        leaveGate();
        return;
      }
      retryDelayMs = 15_000;
      if (initial || !screen) render(payload.screen);
      scheduleExpirationCheck(() => load(false));
    } catch (error) {
      if (initial && !screen) showEmergencyFallback(error);
      else {
        console.error(
          "[CRONOX PANTALLA CLAVE] No se pudo verificar la caducidad; se mantiene la puerta y se reintentará.",
          error,
        );
        scheduleExpirationCheck(() => load(false), retryDelayMs);
        retryDelayMs = Math.min(60_000, retryDelayMs * 2);
      }
    } finally {
      checkInFlight = false;
    }
  };

  const refreshIfStale = () => {
    if (document.visibilityState === "hidden") return;
    if (monotonicNow() - lastCheckMonotonicMs < 5_000) return;
    load(false);
  };

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!el.email.checkValidity()) {
      el.email.reportValidity();
      return;
    }
    el.submit.disabled = true;
    el.message.textContent = "";
    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(await window.CRONOX_API.getCsrfHeaders()),
      };
      const response = await fetch(`${base}/api/key-screen/preregister`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ email: el.email.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? "Demasiados intentos. Espera un minuto."
            : Array.isArray(payload.message)
              ? payload.message.join(" ")
              : typeof payload.message === "string"
                ? payload.message
                : "No se pudo completar el preregistro.",
        );
      }
      el.form.hidden = true;
      el.success.hidden = false;
      el.success.focus();
      fitComposition();
    } catch (error) {
      el.message.textContent = error.message;
      el.submit.disabled = false;
      fitComposition();
    }
  });

  addEventListener(
    "resize",
    () => {
      applyViewport();
      applyMedia();
      if (screen) applyPosition();
    },
    { passive: true },
  );
  window.visualViewport?.addEventListener(
    "resize",
    () => {
      applyViewport();
      applyMedia();
      if (screen) applyPosition();
    },
    { passive: true },
  );
  window.visualViewport?.addEventListener("scroll", fitComposition, {
    passive: true,
  });
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("focus", refreshIfStale);
  if (window.ResizeObserver)
    new ResizeObserver(fitComposition).observe(el.content);
  window.CRONOX_KEY_SCREEN_EXPIRATION = Object.freeze({
    estimatedServerNow,
    refresh: () => load(false),
  });
  load(true);
})();
