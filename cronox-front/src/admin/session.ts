/** Shared by all pages through api.js, including modules using fetch directly.
 * No tokens are read by JS. Storage/channel messages are hints, never authority.
 */
export function installSessionTransport(
  apiBase: string,
  csrfHeaders: () => Promise<Record<string, string>>,
) {
  if (typeof window === "undefined" || typeof window.fetch !== "function")
    return;
  const rawFetch = window.fetch.bind(window);
  const origin = new URL(
    apiBase || window.location.origin,
    window.location.href,
  ).origin;
  const endpoint = (path: string) => new URL(path, origin).href;
  const THROTTLE = 3 * 60_000;
  const KEY = "cronox.session.event";
  const LOCK = "cronox.session.refresh-lock";
  const tab = `${Date.now()}-${Math.random()}`;
  let deadline = 0;
  let lastReport = 0;
  let dirty = false;
  let ended = false;
  let authenticated = false;
  let refreshPromise: Promise<boolean> | null = null;
  let activityPromise: Promise<void> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let activityTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshedAt = 0;
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel("cronox.session")
      : null;
  type SessionEvent = {
    kind: "activity" | "refresh" | "logout";
    at: number;
    deadline?: number;
    idle?: boolean;
    tab: string;
  };
  const read = (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* privacy mode */
    }
  };
  const announce = (kind: SessionEvent["kind"], idle = false) => {
    const event: SessionEvent = { kind, at: Date.now(), deadline, idle, tab };
    write(KEY, JSON.stringify(event));
    channel?.postMessage(event);
  };

  function terminate(idle: boolean, broadcast = true, navigate = true) {
    if (ended) return;
    ended = true;
    authenticated = false;
    deadline = 0;
    clearTimeout(idleTimer);
    clearTimeout(activityTimer);
    if (broadcast) announce("logout", idle);
    // Do not call the storefront's storage-clearing manual-logout helper:
    // cart/preferences are not authentication state.
    (window as Window & { CRONOX_USER?: unknown }).CRONOX_USER = null;
    window.dispatchEvent(
      new CustomEvent("cronox:session-ended", { detail: { idle } }),
    );
    if (!navigate) return;
    try {
      sessionStorage.setItem(
        "cronox.session.message",
        idle
          ? "Tu sesión se ha cerrado por inactividad."
          : "Inicia sesión de nuevo.",
      );
    } catch {
      /* optional UI hint */
    }
    const admin = /^\/admin(?:[/.\-]|$)/.test(location.pathname);
    if (!admin) {
      try {
        localStorage.setItem("cronox_open_auth_on_load", "1");
      } catch {
        /* optional login-modal hint */
      }
    }
    document.documentElement.dataset.adminAuthState = "expired";
    if (document.body) document.body.hidden = true; // never leave protected data visible
    location.replace(admin ? "/admin-login.html" : "/index.html?login=1");
  }

  function acceptDeadline(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    deadline = value;
    ended = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => {
        void verifyDeadline();
      },
      Math.max(0, deadline - Date.now()) + 100,
    );
  }

  function observe(response: Response, authResponse = false) {
    if (response.ok) {
      const value = Number(response.headers.get("X-Session-Idle-Expires"));
      if (value) acceptDeadline(value);
      if (authResponse) {
        authenticated = true;
        if (!value) {
          deadline = 0;
          clearTimeout(idleTimer);
        }
      }
    }
    return response;
  }

  async function verifyDeadline() {
    if (ended || !deadline) return;
    // Other tabs may have advanced the server timestamp. Never expire the
    // session based solely on this tab's clock/storage. This read does not touch.
    try {
      const response = await sessionFetch(endpoint("/api/me"), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok && deadline <= Date.now()) {
        idleTimer = setTimeout(() => {
          void verifyDeadline();
        }, 30_000);
      }
    } catch {
      idleTimer = setTimeout(() => {
        void verifyDeadline();
      }, 30_000);
    }
  }

  async function errorCode(response: Response) {
    try {
      const payload = (await response.clone().json()) as {
        code?: string;
        message?: { code?: string } | string;
      };
      return payload.code ??
        (typeof payload.message === "object" ? payload.message?.code : undefined);
    } catch {
      return undefined;
    }
  }

  async function doRefresh(started: number): Promise<boolean> {
    // A tab waiting for the lock first tries the new shared access cookie.
    if (refreshedAt >= started) return true;
    const probe = observe(
      await rawFetch(endpoint("/api/me"), {
        credentials: "include",
        cache: "no-store",
      }),
      true,
    );
    if (probe.ok) return true;
    const response = observe(
      await rawFetch(endpoint("/api/auth/refresh"), {
        method: "POST",
        credentials: "include",
        headers: await csrfHeaders(),
        cache: "no-store",
      }),
      true,
    );
    if (response.ok) {
      refreshedAt = Date.now();
      announce("refresh");
      return true;
    }
    if (response.status === 401) {
      const code = await errorCode(response);
      // Anonymous visits do not redirect. Previously authenticated pages do.
      const known =
        authenticated || Boolean(deadline) || Boolean(code?.startsWith("SESSION_"));
      terminate(code === "SESSION_IDLE", true, known);
      return false;
    }
    // Network/CSRF/rate-limit errors are not a successful logout.
    throw new Error("No se pudo renovar la sesión. Inténtalo de nuevo.");
  }

  async function withRefreshLock(started: number) {
    if (navigator.locks?.request)
      return navigator.locks.request("cronox-session-refresh", () =>
        doRefresh(started),
      );
    // Bounded best-effort storage lease for browsers without Web Locks.
    // The server's atomic rotation/grace remains authoritative if tabs race.
    for (let attempt = 0; attempt < 40; attempt++) {
      let lease: { tab: string; until: number } | null = null;
      try {
        lease = JSON.parse(read(LOCK) || "null") as {
          tab: string;
          until: number;
        } | null;
      } catch {
        /* ignore */
      }
      if (!lease || lease.until <= Date.now() || lease.tab === tab) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (refreshedAt >= started) return true;
    }
    write(LOCK, JSON.stringify({ tab, until: Date.now() + 5000 }));
    try {
      return await doRefresh(started);
    } finally {
      try {
        if (
          (JSON.parse(read(LOCK) || "null") as { tab?: string } | null)?.tab ===
          tab
        )
          localStorage.removeItem(LOCK);
      } catch {
        /* optional coordination */
      }
    }
  }

  function refresh() {
    if (!refreshPromise)
      refreshPromise = withRefreshLock(Date.now()).finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  const noRetry =
    /^\/api\/auth\/(?:login|register|logout|refresh|csrf|forgot-password|reset-password)$/;
  async function sessionFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      location.href,
    );
    const eligible =
      url.origin === origin &&
      url.pathname.startsWith("/api/") &&
      init?.credentials !== "omit";
    if (!eligible) return rawFetch(input, init);
    // Clone before the first attempt, preserving uploads and request bodies.
    const retryInput =
      typeof Request !== "undefined" && input instanceof Request
        ? input.clone()
        : input;
    const authResponse =
      url.pathname === "/api/me" ||
      /^\/api\/auth\/(?:login|register|refresh)$/.test(url.pathname);
    let response = observe(await rawFetch(input, init), authResponse);
    if (response.status === 401 && !noRetry.test(url.pathname)) {
      const code = await errorCode(response);
      if (code?.startsWith("SESSION_")) {
        terminate(code === "SESSION_IDLE");
        return response;
      }
      if (!ended && (await refresh()))
        response = observe(await rawFetch(retryInput, init), authResponse);
      if (response.status === 401 && deadline)
        terminate((await errorCode(response)) === "SESSION_IDLE");
    }
    if (response.ok && /\/auth\/(login|register)$/.test(url.pathname)) {
      ended = false;
      announce("activity");
    }
    if (response.ok && url.pathname === "/api/auth/logout")
      terminate(false, true, false);
    return response;
  }
  window.fetch = sessionFetch;

  async function report() {
    if (
      activityPromise ||
      ended ||
      !deadline ||
      !dirty ||
      document.visibilityState !== "visible"
    )
      return;
    dirty = false;
    lastReport = Date.now();
    activityPromise = (async () => {
      try {
        const response = await sessionFetch(endpoint("/api/auth/activity"), {
          method: "POST",
          credentials: "include",
          headers: await csrfHeaders(),
        });
        if (response.ok) {
          const result = (await response.json()) as { idleExpiresAt: number };
          acceptDeadline(result.idleExpiresAt);
          announce("activity");
        }
      } catch {
        dirty = true; /* retry only after another genuine interaction */
      }
    })().finally(() => {
      activityPromise = null;
    });
    await activityPromise;
  }

  function activity(event: Event) {
    if (
      !event.isTrusted ||
      document.visibilityState !== "visible" ||
      ended ||
      !deadline
    )
      return;
    dirty = true;
    clearTimeout(activityTimer);
    const wait = Math.max(0, lastReport + THROTTLE - Date.now());
    activityTimer = setTimeout(() => {
      void report();
    }, wait);
  }
  for (const name of [
    "pointerdown",
    "keydown",
    "touchstart",
    "scroll",
  ]) {
    window.addEventListener(name, activity, { passive: true, capture: true });
  }

  function receive(event: SessionEvent) {
    if (!event || event.tab === tab) return;
    if (event.kind === "logout") {
      terminate(Boolean(event.idle), false, Boolean(deadline));
      return;
    }
    if (event.kind === "refresh") refreshedAt = Math.max(refreshedAt, event.at);
    if (event.kind === "activity") lastReport = Math.max(lastReport, event.at);
    if (event.deadline && event.deadline > deadline)
      acceptDeadline(event.deadline);
  }
  if (channel)
    channel.onmessage = (event: MessageEvent<SessionEvent>) =>
      receive(event.data);
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY || !event.newValue) return;
    try {
      receive(JSON.parse(event.newValue) as SessionEvent);
    } catch {
      /* ignore malformed hints */
    }
  });

  function showMessage() {
    let message: string | null = null;
    try {
      message = sessionStorage.getItem("cronox.session.message");
      sessionStorage.removeItem("cronox.session.message");
    } catch {
      /* optional */
    }
    if (!message) return;
    const banner = document.createElement("p");
    banner.setAttribute("role", "alert");
    banner.textContent = message;
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:99999;background:#171717;color:white;padding:16px;text-align:center;margin:0";
    document.body.prepend(banner);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", showMessage, { once: true });
  else showMessage();
}
