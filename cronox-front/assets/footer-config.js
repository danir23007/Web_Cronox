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
    tiktokUrl: "",
    youtubeUrl: "",
  });

  const safeText = (value, fallback) =>
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const safeExternalUrl = (value, fallback) => {
    try {
      const url = new URL(String(value || "").trim());
      return ["http:", "https:"].includes(url.protocol) &&
        !url.pathname.includes('@tu_cuenta') &&
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
      const url = safeExternalUrl(settings[key], DEFAULTS[key]);
      link.style.display = url ? '' : 'none';
      if (url) link.href = url;
      else link.removeAttribute('href');
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

  // CSS distributes the four spaces; these measurements only tighten each
  // column to its longest rendered line, retaining its existing line breaks.
  // Intrinsic CSS widths alone include unused space after wrapped text.
  const links = document.querySelector('.footer-links-block');
  if (links && window.ResizeObserver && window.requestAnimationFrame && window.matchMedia && document.fonts) {
    const desktop = window.matchMedia('(min-width: 1101px)');
    const items = [...links.querySelectorAll('.footer-acc-item')];
    let frame = 0;
    const measure = () => {
      frame = 0;
      items.forEach(item => item.style.removeProperty('--footer-content-width'));
      if (!desktop.matches) return;
      const widths = items.map(item => {
        const rects = [...item.querySelectorAll('.footer-title, .footer-link')].flatMap(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()];
        });
        return Math.ceil(Math.max(0, ...rects.map(rect => rect.width)) * 64) / 64;
      });
      items.forEach((item, index) => {
        if (widths[index]) item.style.setProperty('--footer-content-width', `${widths[index]}px`);
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    let previousSize = '';
    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const size = `${width}:${height}`;
      if (size !== previousSize) { previousSize = size; schedule(); }
    }).observe(links);
    new MutationObserver(schedule).observe(links, { subtree: true, childList: true, characterData: true });
    desktop.addEventListener('change', schedule);
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    schedule();
  }

  window.CRONOX_FOOTER = { DEFAULTS, apply, load };
  void load();
})();
