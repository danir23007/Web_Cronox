(function () {
  "use strict";

  const root = document.querySelector("[data-footer-content][data-footer-page-slug]");
  if (!root) return;
  const slug = root.dataset.footerPageSlug;
  const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");

  fetch(`${base}/api/footer/pages/${encodeURIComponent(slug)}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Page content ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      if (typeof payload?.html !== "string" || !payload.html.trim()) return;
      root.innerHTML = payload.html;
      document.dispatchEvent(
        new CustomEvent("cronox:page-content-applied", { detail: { slug } }),
      );
    })
    .catch(() => {
      // The static server-rendered content is the intentional safe fallback.
    });
})();
