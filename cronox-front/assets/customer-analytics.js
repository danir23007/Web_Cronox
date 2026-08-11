(function () {
  "use strict";

  const CONSENT_VERSION = "2";
  const SESSION_KEY = "cronox_analytics_session";
  const SESSION_COOKIE = "cronox_analytics_session";
  let sessionTimeoutMs;
  let heartbeatMs = 45 * 1000;
  const FLUSH_MS = 5 * 1000;
  let enabled = false;
  let userId = null;
  let session = null;
  let queue = [];
  let flushTimer = null;
  let heartbeatTimer = null;
  let lastVisibleAt = null;
  let currentProductId = null;
  let latestCatalogDetail = null;
  const emittedPageEvents = new Set();

  const apiBase = () => String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
  const endpoint = (path) => `${apiBase()}${path}`;
  const uuid = () => window.crypto?.randomUUID?.() ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.random() * 16 | 0;
      return (char === "x" ? value : (value & 3) | 8).toString(16);
    });

  const setSessionCookie = (id) => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=1800; SameSite=Lax${secure}`;
  };

  const clearSession = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    session = null;
  };

  const resolveSession = () => {
    const now = Date.now();
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (
        parsed && parsed.userId === userId && typeof parsed.id === "string" &&
        typeof parsed.lastActivityAt === "number" && now - parsed.lastActivityAt < sessionTimeoutMs
      ) session = parsed;
    } catch (_) {}
    if (!session) session = { id: uuid(), userId, lastActivityAt: now };
    session.lastActivityAt = now;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    setSessionCookie(session.id);
    return session;
  };

  const post = async (path, body, keepalive) => {
    const headers = {
      "Content-Type": "application/json",
      ...(await (window.CRONOX_API?.getCsrfHeaders?.() || Promise.resolve({}))),
    };
    return fetch(endpoint(path), {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(body),
      keepalive: Boolean(keepalive),
    });
  };

  const syncConsent = async (record) => {
    if (!userId || !record) return;
    try {
      await post("/api/analytics/consent", {
        granted: record.analytics === true,
        version: String(record.consentVersion || CONSENT_VERSION),
      });
    } catch (_) {}
  };

  const touchSession = () => {
    if (!session) return;
    session.lastActivityAt = Date.now();
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) {}
    setSessionCookie(session.id);
  };

  const flush = async (keepalive) => {
    if (!enabled || !userId || queue.length === 0) return;
    const batch = queue.splice(0, 20);
    touchSession();
    try {
      const response = await post("/api/analytics/events", {
        sessionId: resolveSession().id,
        events: batch,
      }, keepalive);
      if (!response.ok && response.status !== 401 && response.status !== 403) {
        queue = batch.concat(queue).slice(0, 40);
      }
      const payload = response.ok ? await response.json().catch(() => null) : null;
      if (payload?.sessionId && payload.sessionId !== session.id) {
        session.id = payload.sessionId;
        touchSession();
      }
    } catch (_) {
      queue = batch.concat(queue).slice(0, 40);
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush(false);
    }, FLUSH_MS);
  };

  const track = (eventType, fields, dedupeKey) => {
    if (!enabled || !userId) return;
    if (dedupeKey && emittedPageEvents.has(dedupeKey)) return;
    if (dedupeKey) emittedPageEvents.add(dedupeKey);
    resolveSession();
    queue.push({ clientEventId: uuid(), eventType, ...(fields || {}) });
    if (queue.length >= 10) void flush(false);
    else scheduleFlush();
  };

  const captureVisibleTime = () => {
    const now = Date.now();
    if (lastVisibleAt) {
      const seconds = Math.min(60, Math.floor((now - lastVisibleAt) / 1000));
      if (seconds > 0) {
        track("ACTIVE_TIME", {
          activeSeconds: seconds,
          ...(currentProductId ? { productId: currentProductId } : {}),
        });
      }
    }
    lastVisibleAt = document.visibilityState === "visible" ? now : null;
  };

  const captureCatalogContext = (detail) => {
    latestCatalogDetail = detail;
    const url = new URL(location.href);
    const searchQuery = String(url.searchParams.get("search") || url.searchParams.get("q") || "")
      .trim().replace(/\s+/g, " ").slice(0, 80);
    const categorySlug = String(url.searchParams.get("categorySlug") || "").trim().toLowerCase();
    const count = Array.isArray(detail?.products) ? detail.products.length : 0;
    if (searchQuery && detail?.source === "search-api") {
      track("SEARCH_PERFORMED", { searchQuery, resultCount: count }, `search:${searchQuery}:${count}`);
    }
    if (categorySlug && !searchQuery && detail?.source === "category-api") {
      track("CATEGORY_VIEWED", { categorySlug }, `category:${categorySlug}`);
    }
  };

  const start = async () => {
    if (enabled) return;
    const user = window.CRONOX_USER || await window.CRONOX_API?.getMe?.().catch(() => null);
    userId = Number(user?.id) || null;
    if (!userId) return;
    try {
      const configResponse = await fetch(endpoint("/api/analytics/config"), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const config = configResponse.ok ? await configResponse.json() : null;
      const sessionMinutes = Number(config?.sessionTimeoutMinutes);
      const heartbeatSeconds = Number(config?.heartbeatSeconds);
      if (!Number.isFinite(sessionMinutes) || sessionMinutes < 5) return;
      sessionTimeoutMs = sessionMinutes * 60 * 1000;
      if (Number.isFinite(heartbeatSeconds) && heartbeatSeconds >= 30 && heartbeatSeconds <= 60) {
        heartbeatMs = heartbeatSeconds * 1000;
      }
    } catch (_) { return; }
    enabled = true;
    resolveSession();
    lastVisibleAt = document.visibilityState === "visible" ? Date.now() : null;
    heartbeatTimer = setInterval(captureVisibleTime, heartbeatMs);
    await syncConsent(window.CRONOX_COOKIE_CONSENT?.getConsent?.());
    if (currentProductId) {
      track("PRODUCT_VIEWED", { productId: currentProductId }, `product:${currentProductId}`);
    }
    if (latestCatalogDetail) captureCatalogContext(latestCatalogDetail);
  };

  const stop = () => {
    enabled = false;
    queue = [];
    if (flushTimer) clearTimeout(flushTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    flushTimer = heartbeatTimer = null;
    lastVisibleAt = null;
    clearSession();
  };

  window.addEventListener("cronox:productViewed", (event) => {
    const productId = Number(event.detail?.productId);
    currentProductId = Number.isInteger(productId) && productId > 0 ? productId : null;
    if (currentProductId) track("PRODUCT_VIEWED", { productId: currentProductId }, `product:${currentProductId}`);
  });
  window.addEventListener("cronox:productsLoaded", (event) => captureCatalogContext(event.detail));
  window.addEventListener("cronox:userChanged", async (event) => {
    const nextUserId = Number(event.detail?.id) || null;
    if (userId && nextUserId !== userId) stop();
    userId = nextUserId;
    const consent = window.CRONOX_COOKIE_CONSENT?.getConsent?.();
    if (consent) await syncConsent(consent);
    if (consent?.analytics) await start();
  });
  window.addEventListener("cronox:consentchange", async (event) => {
    const user = window.CRONOX_USER;
    userId = Number(user?.id) || userId;
    await syncConsent(event.detail);
  });
  document.addEventListener("visibilitychange", () => {
    captureVisibleTime();
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("pagehide", () => {
    captureVisibleTime();
    void flush(true);
  });

  window.CRONOX_COOKIE_CONSENT?.registerService({
    id: "cronox-first-party-customer-analytics",
    category: "analytics",
    load: start,
    disable: stop,
  });
})();
