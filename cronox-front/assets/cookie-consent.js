(function () {
  "use strict";

  const CONSENT_COOKIE_NAME = "cronox_cookie_consent";
  const COOKIE_CONSENT_VERSION = "2";
  const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
  const CATEGORIES = ["preferences", "analytics", "marketing"];
  const AVAILABLE_CATEGORIES = Object.freeze({
    preferences: true,
    analytics: true,
    marketing: false,
  });
  const OPTIONAL_STORAGE = Object.freeze({
    preferences: [
      "cronoxNewsletterShown",
      /^cronox_circle_request_modal_seen_/,
      /^cronox_circle4_request_success_/,
    ],
    analytics: ["cronox_analytics_session"],
    marketing: [],
  });
  const OPTIONAL_COOKIES = Object.freeze({
    preferences: [],
    analytics: ["cronox_analytics_session"],
    marketing: [],
  });

  const registeredServices = new Map();
  const changeListeners = new Set();
  let banner;
  let preferencesOverlay;
  let preferencesDialog;
  let lastFocusedElement;

  const defaultSelection = () => ({
    necessary: true,
    preferences: false,
    analytics: false,
    marketing: false,
  });

  const getCookie = (name) => {
    if (typeof document === "undefined") return null;
    const prefix = `${encodeURIComponent(name)}=`;
    const item = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    if (!item) return null;
    try {
      return decodeURIComponent(item.slice(prefix.length));
    } catch (_) {
      return null;
    }
  };

  const normalizeConsent = (candidate) => {
    if (!candidate || typeof candidate !== "object") return null;
    if (candidate.consentVersion !== COOKIE_CONSENT_VERSION) return null;
    if (candidate.necessary !== true) return null;
    if (
      typeof candidate.timestamp !== "string" ||
      Number.isNaN(Date.parse(candidate.timestamp))
    ) {
      return null;
    }

    return {
      necessary: true,
      preferences:
        AVAILABLE_CATEGORIES.preferences && candidate.preferences === true,
      analytics: AVAILABLE_CATEGORIES.analytics && candidate.analytics === true,
      marketing: AVAILABLE_CATEGORIES.marketing && candidate.marketing === true,
      consentVersion: COOKIE_CONSENT_VERSION,
      timestamp: candidate.timestamp,
    };
  };

  const getConsent = () => {
    const raw = getCookie(CONSENT_COOKIE_NAME);
    if (!raw) return null;
    try {
      return normalizeConsent(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  };

  const writeConsent = (selection) => {
    const record = {
      necessary: true,
      preferences:
        AVAILABLE_CATEGORIES.preferences && selection.preferences === true,
      analytics: AVAILABLE_CATEGORIES.analytics && selection.analytics === true,
      marketing: AVAILABLE_CATEGORIES.marketing && selection.marketing === true,
      consentVersion: COOKIE_CONSENT_VERSION,
      timestamp: new Date().toISOString(),
    };
    const secure =
      window.location && window.location.protocol === "https:"
        ? "; Secure"
        : "";
    document.cookie = `${encodeURIComponent(CONSENT_COOKIE_NAME)}=${encodeURIComponent(
      JSON.stringify(record),
    )}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
    return record;
  };

  const removeStorageEntries = (patterns) => {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        const storage = window[storageName];
        if (!storage) continue;
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key) keys.push(key);
        }
        keys.forEach((key) => {
          if (
            patterns.some((pattern) =>
              typeof pattern === "string" ? pattern === key : pattern.test(key),
            )
          ) {
            storage.removeItem(key);
          }
        });
      } catch (_) {
        // Storage can be unavailable in privacy modes. Consent still remains effective.
      }
    }
  };

  const expireFirstPartyCookie = (name) => {
    const encodedName = encodeURIComponent(name);
    const hostname = window.location && window.location.hostname;
    const domains = hostname ? ["", hostname, `.${hostname}`] : [""];
    const paths = [
      "/",
      window.location && window.location.pathname
        ? window.location.pathname
        : "/",
    ];
    domains.forEach((domain) => {
      paths.forEach((path) => {
        const domainPart = domain ? `; Domain=${domain}` : "";
        document.cookie = `${encodedName}=; Path=${path}${domainPart}; Max-Age=0; SameSite=Lax`;
      });
    });
  };

  const cleanCategory = (category) => {
    removeStorageEntries(OPTIONAL_STORAGE[category] || []);
    (OPTIONAL_COOKIES[category] || []).forEach(expireFirstPartyCookie);
  };

  const activateDeclarativeTechnologies = (category) => {
    document
      .querySelectorAll(
        `script[type="text/plain"][data-consent-category="${category}"]`,
      )
      .forEach((blockedScript) => {
        if (blockedScript.dataset.consentLoaded === "true") return;
        const script = document.createElement("script");
        for (const attribute of blockedScript.attributes) {
          if (
            !["type", "data-consent-category", "data-src"].includes(
              attribute.name,
            )
          ) {
            script.setAttribute(attribute.name, attribute.value);
          }
        }
        if (blockedScript.dataset.src) script.src = blockedScript.dataset.src;
        else script.textContent = blockedScript.textContent;
        blockedScript.dataset.consentLoaded = "true";
        blockedScript.after(script);
      });

    document
      .querySelectorAll(
        `[data-consent-src][data-consent-category="${category}"]`,
      )
      .forEach((element) => {
        if (!element.getAttribute("src"))
          element.setAttribute("src", element.dataset.consentSrc);
      });
  };

  const applyConsent = (current, previous) => {
    CATEGORIES.forEach((category) => {
      const enabled = current && current[category] === true;
      if (!enabled) cleanCategory(category);
      if (enabled) activateDeclarativeTechnologies(category);

      registeredServices.forEach((service) => {
        if (service.category !== category) return;
        if (enabled && !service.active) {
          service.active = true;
          Promise.resolve(service.load && service.load()).catch(() => {
            service.active = false;
          });
        } else if (!enabled && service.active) {
          service.active = false;
          if (typeof service.disable === "function") service.disable();
        }
      });

      if (previous && previous[category] && !enabled) cleanCategory(category);
    });
  };

  const emitChange = (record) => {
    changeListeners.forEach((listener) => listener(record));
    window.dispatchEvent(
      new CustomEvent("cronox:consentchange", { detail: record }),
    );
  };

  const saveConsent = (selection) => {
    const previous = getConsent();
    const record = writeConsent(selection || defaultSelection());
    applyConsent(record, previous);
    emitChange(record);
    hideBanner();
    closePreferences();
    return record;
  };

  const hasConsent = (category) => {
    if (category === "necessary") return true;
    if (!CATEGORIES.includes(category)) return false;
    return getConsent()?.[category] === true;
  };

  const registerService = (configuration) => {
    if (
      !configuration ||
      !configuration.id ||
      !CATEGORIES.includes(configuration.category)
    ) {
      throw new TypeError(
        "El servicio de consentimiento necesita id y una categoría opcional válida.",
      );
    }
    const service = { ...configuration, active: false };
    registeredServices.set(service.id, service);
    if (hasConsent(service.category)) applyConsent(getConsent(), null);
    return () => registeredServices.delete(service.id);
  };

  const focusableElements = () => {
    if (!preferencesDialog) return [];
    return Array.from(
      preferencesDialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hidden);
  };

  const trapFocus = (event) => {
    if (event.key !== "Tab") return;
    const focusable = focusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const syncForm = () => {
    const current = getConsent() || defaultSelection();
    CATEGORIES.forEach((category) => {
      const input = preferencesDialog?.querySelector(
        `[name="consent-${category}"]`,
      );
      if (input)
        input.checked =
          AVAILABLE_CATEGORIES[category] && current[category] === true;
    });
  };

  const showBanner = () => {
    if (banner) banner.hidden = false;
  };

  function hideBanner() {
    if (banner) banner.hidden = true;
  }

  const openPreferences = (trigger) => {
    if (!preferencesOverlay || !preferencesDialog) return;
    lastFocusedElement = trigger || document.activeElement;
    syncForm();
    hideBanner();
    preferencesOverlay.hidden = false;
    document.body.classList.add("cronox-consent-modal-open");
    preferencesDialog.addEventListener("keydown", trapFocus);
    const firstInput = preferencesDialog.querySelector(
      "input:not([disabled]), button:not([disabled])",
    );
    if (firstInput) firstInput.focus();
  };

  function closePreferences() {
    if (!preferencesOverlay || preferencesOverlay.hidden) return;
    preferencesOverlay.hidden = true;
    document.body.classList.remove("cronox-consent-modal-open");
    preferencesDialog.removeEventListener("keydown", trapFocus);
    if (!getConsent()) showBanner();
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function")
      lastFocusedElement.focus();
  }

  const categoryRow = ({
    id,
    title,
    description,
    required,
    available = true,
  }) => {
    const status = required
      ? '<span class="cronox-consent__always">Siempre activas</span>'
      : available
        ? `<label class="cronox-consent__switch">
            <span class="cronox-consent__sr-only">Activar ${title.toLowerCase()}</span>
            <input type="checkbox" name="consent-${id}" />
            <span aria-hidden="true"></span>
          </label>`
        : `<div class="cronox-consent__category-status">
            <span class="cronox-consent__unused">No utilizadas</span>
            <label class="cronox-consent__switch cronox-consent__switch--disabled">
              <span class="cronox-consent__sr-only">${title}: desactivadas porque CRONOX no las utiliza</span>
              <input type="checkbox" name="consent-${id}" disabled />
              <span aria-hidden="true"></span>
            </label>
          </div>`;
    return `<section class="cronox-consent__category" aria-labelledby="consent-category-${id}">
      <div class="cronox-consent__category-heading">
        <h3 id="consent-category-${id}">${title}</h3>
        ${status}
      </div>
      <p>${description}</p>
    </section>`;
  };

  const buildInterface = () => {
    banner = document.createElement("section");
    banner.className = "cronox-consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-modal", "false");
    banner.setAttribute("aria-labelledby", "cronox-consent-title");
    banner.setAttribute("aria-describedby", "cronox-consent-description");
    banner.hidden = true;
    banner.innerHTML = `<div class="cronox-consent__copy">
        <p class="cronox-consent__eyebrow">Tu privacidad</p>
        <h2 id="cronox-consent-title">Cookies en CRONOX</h2>
        <p id="cronox-consent-description">Usamos tecnologías necesarias para que la tienda funcione. Con tu permiso, recordamos preferencias y analizamos el uso para mejorarla; no usamos publicidad. <a href="cookie-policy.html">Política de cookies</a>.</p>
      </div>
      <div class="cronox-consent__actions" aria-label="Opciones de cookies">
        <button type="button" class="cronox-consent__button" data-consent-action="reject">Rechazar</button>
        <button type="button" class="cronox-consent__button" data-consent-action="configure">Configurar</button>
        <button type="button" class="cronox-consent__button" data-consent-action="accept">Aceptar</button>
      </div>`;

    preferencesOverlay = document.createElement("div");
    preferencesOverlay.className = "cronox-consent-panel";
    preferencesOverlay.hidden = true;
    preferencesOverlay.innerHTML = `<div class="cronox-consent-panel__backdrop" data-consent-action="backdrop"></div>
      <section class="cronox-consent-panel__dialog" role="dialog" aria-modal="true" aria-labelledby="cronox-preferences-title" aria-describedby="cronox-preferences-description">
        <header class="cronox-consent-panel__header">
          <div>
            <p class="cronox-consent__eyebrow">Centro de preferencias</p>
            <h2 id="cronox-preferences-title">Configurar cookies</h2>
          </div>
          <button type="button" class="cronox-consent-panel__close" data-consent-action="close" aria-label="Cerrar configuración de cookies">×</button>
        </header>
        <p id="cronox-preferences-description" class="cronox-consent-panel__intro">Puedes cambiar tu elección en cualquier momento. Las tecnologías necesarias permanecen activas porque permiten prestar los servicios que solicitas.</p>
        <form id="cronox-consent-form">
          <div class="cronox-consent-panel__categories">
            ${categoryRow({ id: "necessary", title: "Cookies necesarias", required: true, description: "Permiten proteger el sitio frente a solicitudes fraudulentas, mantener la sesión, conservar la cesta, aplicar promociones durante el checkout y procesar el pago con Stripe." })}
            ${categoryRow({ id: "preferences", title: "Cookies de preferencias", available: true, description: "Permiten recordar durante la sesión que has cerrado el aviso de newsletter y, en tu cuenta, qué avisos de círculo ya has visto." })}
            ${categoryRow({ id: "analytics", title: "Cookies de análisis", available: true, description: "Con tu permiso, CRONOX mide visitas, actividad, búsquedas y acciones sobre productos para entender y mejorar la tienda. Es un sistema propio, sin terceros, direcciones IP ni identificadores publicitarios." })}
            ${categoryRow({ id: "marketing", title: "Cookies de marketing", available: false, description: "CRONOX no utiliza actualmente píxeles publicitarios, perfiles de comportamiento ni cookies de publicidad." })}
          </div>
          <div class="cronox-consent__actions cronox-consent-panel__actions">
            <button type="button" class="cronox-consent__button" data-consent-action="reject">Rechazar todo</button>
            <button type="submit" class="cronox-consent__button">Guardar selección</button>
            <button type="button" class="cronox-consent__button" data-consent-action="accept">Aceptar todo</button>
          </div>
        </form>
      </section>`;
    preferencesDialog = preferencesOverlay.querySelector(
      ".cronox-consent-panel__dialog",
    );

    document.body.append(banner, preferencesOverlay);

    banner
      .querySelector('[data-consent-action="reject"]')
      .addEventListener("click", () => saveConsent(defaultSelection()));
    banner
      .querySelector('[data-consent-action="accept"]')
      .addEventListener("click", () =>
        saveConsent({ ...defaultSelection(), ...AVAILABLE_CATEGORIES }),
      );
    banner
      .querySelector('[data-consent-action="configure"]')
      .addEventListener("click", (event) =>
        openPreferences(event.currentTarget),
      );

    preferencesOverlay
      .querySelectorAll('[data-consent-action="reject"]')
      .forEach((button) =>
        button.addEventListener("click", () => saveConsent(defaultSelection())),
      );
    preferencesOverlay
      .querySelectorAll('[data-consent-action="accept"]')
      .forEach((button) =>
        button.addEventListener("click", () =>
          saveConsent({ ...defaultSelection(), ...AVAILABLE_CATEGORIES }),
        ),
      );
    preferencesOverlay
      .querySelectorAll('[data-consent-action="close"]')
      .forEach((button) => button.addEventListener("click", closePreferences));
    preferencesOverlay
      .querySelector('[data-consent-action="backdrop"]')
      .addEventListener("click", closePreferences);
    preferencesOverlay
      .querySelector("form")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        saveConsent({
          necessary: true,
          preferences: form.elements["consent-preferences"]?.checked === true,
          analytics: form.elements["consent-analytics"]?.checked === true,
          marketing: form.elements["consent-marketing"]?.checked === true,
        });
      });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        preferencesOverlay &&
        !preferencesOverlay.hidden
      ) {
        event.preventDefault();
        closePreferences();
      }
    });
  };

  const installPermanentControls = () => {
    document.querySelectorAll("a.footer-link").forEach((link) => {
      if (
        link.textContent.trim().toLowerCase().includes("política de cookies")
      ) {
        link.href = "cookie-policy.html";
      }
    });

    const existingControls = document.querySelectorAll(
      "[data-open-cookie-preferences]",
    );
    if (existingControls.length) {
      existingControls.forEach((control) => {
        if (control.dataset.cookiePreferencesBound === "true") return;
        control.dataset.cookiePreferencesBound = "true";
        control.addEventListener("click", (event) =>
          openPreferences(event.currentTarget),
        );
      });
    }
    const footer = document.querySelector(
      "footer.site-footer, body > footer.footer, body > footer",
    );
    if (footer?.querySelector("[data-open-cookie-preferences]")) return;
    if (!footer && existingControls.length) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cronox-cookie-settings";
    button.dataset.openCookiePreferences = "";
    button.textContent = "Configurar cookies";
    button.addEventListener("click", (event) =>
      openPreferences(event.currentTarget),
    );

    if (footer) footer.appendChild(button);
    else {
      button.classList.add("cronox-cookie-settings--fixed");
      document.body.appendChild(button);
    }
  };

  const initialize = () => {
    buildInterface();
    installPermanentControls();
    const current = getConsent();
    applyConsent(current || defaultSelection(), null);
    if (!current) showBanner();
  };

  const api = Object.freeze({
    COOKIE_CONSENT_VERSION,
    CONSENT_COOKIE_NAME,
    availableCategories: AVAILABLE_CATEGORIES,
    getConsent,
    hasConsent,
    save: saveConsent,
    acceptAll: () =>
      saveConsent({ ...defaultSelection(), ...AVAILABLE_CATEGORIES }),
    rejectAll: () => saveConsent(defaultSelection()),
    openPreferences,
    registerService,
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  });

  window.CRONOX_COOKIE_CONSENT = api;
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
