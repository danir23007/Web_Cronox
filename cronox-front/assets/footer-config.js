(function () {
  "use strict";

  const DEFAULTS = Object.freeze({
    supportTitle: "SOPORTE",
    supportFaqLabel: "FAQS",
    supportShippingLabel: "POLÍTICA DE ENVÍOS",
    supportReturnsLabel: "DEVOLUCIONES Y CAMBIOS",
    collabTitle: "COLABORA",
    collabDevelopLabel: "DESARROLLA",
    collabEventsLabel: "EVENTOS",
    legalTitle: "LEGAL",
    legalPrivacyLabel: "POLÍTICA DE PRIVACIDAD",
    legalCookiesLabel: "POLÍTICA DE COOKIES",
    legalTermsLabel: "TÉRMINOS DE SERVICIO",
    legalNoticeLabel: "AVISO LEGAL",
    instagramUrl: "https://www.instagram.com/cronox.es/",
    tiktokUrl: "https://tiktok.com/@tu_cuenta",
    youtubeUrl: "https://youtube.com/@tu_cuenta",
  });

  const safeText = (value, fallback) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const safeExternalUrl = (value, fallback) => {
    try {
      const url = new URL(String(value || "").trim());
      return ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
        ? url.toString()
        : fallback;
    } catch {
      return fallback;
    }
  };

  const apply = (settings = {}) => {
    document.querySelectorAll("[data-footer-label]").forEach((element) => {
      const key = element.dataset.footerLabel;
      element.textContent = safeText(DEFAULTS[key], "");
    });
    document.querySelectorAll("[data-footer-social]").forEach((link) => {
      const key = link.dataset.footerSocial;
      link.href = safeExternalUrl(settings[key], DEFAULTS[key]);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  };

  const load = async () => {
    apply(DEFAULTS);
    try {
      const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
      const response = await fetch(`${base}/api/footer`, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Footer ${response.status}`);
      const settings = await response.json();
      apply(settings);
      return settings;
    } catch {
      return DEFAULTS;
    }
  };

  window.CRONOX_FOOTER = { DEFAULTS, apply, load };
  void load();
})();
