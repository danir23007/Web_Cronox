(function () {
  "use strict";

  const galleryItems = [
    { key: "featured", color: "grey", featured: true },
    { key: "slot-01", color: "white" },
    { key: "slot-02", color: "red" },
    { key: "slot-03", color: "grey" },
    { key: "slot-04", color: "white" },
    { key: "slot-05", color: "grey" },
    { key: "slot-06", color: "white" },
    { key: "slot-07", color: "red" },
    { key: "slot-08", color: "grey" },
    { key: "slot-09", color: "red" },
    { key: "slot-10", color: "grey" },
    { key: "slot-11", color: "white" },
    { key: "slot-12", color: "red" },
  ];
  const placeholderColors = new Set(["white", "red", "grey"]);

  const getInstagramPostUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      const hostname = url.hostname.toLowerCase();
      const pathParts = url.pathname.split("/").filter(Boolean);
      const isInstagramHost = [
        "instagram.com",
        "www.instagram.com",
        "m.instagram.com",
      ].includes(hostname);
      const isPostPath =
        ["p", "reel", "tv"].includes(pathParts[0]) && Boolean(pathParts[1]);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !isInstagramHost ||
        !isPostPath
      ) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  };

  const getImageUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim(), window.location.origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return "";
      }
      return value.trim();
    } catch {
      return "";
    }
  };

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(max, Math.max(min, number))
      : fallback;
  };

  const createGalleryTile = (item = {}) => {
    const imageSource = getImageUrl(item.imageSrc);
    const featuredClass =
      item.featured === true ? " gallery__tile--featured" : "";

    if (imageSource) {
      const alt =
        typeof item.alt === "string" && item.alt.trim()
          ? item.alt.trim()
          : "Imagen de la galer\u00eda CRONOX";
      const instagramUrl = getInstagramPostUrl(item.instagramUrl);
      const tile = document.createElement(instagramUrl ? "a" : "div");
      tile.className = `gallery__tile gallery__tile--image${featuredClass}${instagramUrl ? " gallery__tile--link" : ""}`;
      tile.dataset.gallerySlot = item.key || "";
      tile.style.setProperty("--focal-x", `${clamp(item.focalX, 0, 100, 50)}%`);
      tile.style.setProperty("--focal-y", `${clamp(item.focalY, 0, 100, 50)}%`);
      tile.style.setProperty("--zoom", String(clamp(item.zoom, 1, 3, 1)));

      if (instagramUrl) {
        tile.href = instagramUrl;
        tile.target = "_blank";
        tile.rel = "noopener noreferrer";
        tile.setAttribute("aria-label", `Ver en Instagram: ${alt}`);
      }

      const image = document.createElement("img");
      image.src = imageSource;
      image.alt = alt;
      image.decoding = "async";
      tile.appendChild(image);
      return tile;
    }

    const color = placeholderColors.has(item.color) ? item.color : "grey";
    const tile = document.createElement("div");
    tile.className = `gallery__tile gallery__tile--placeholder gallery__tile--${color}${featuredClass}`;
    tile.dataset.gallerySlot = item.key || "";
    tile.setAttribute("aria-hidden", "true");
    return tile;
  };

  const renderGallery = (items = galleryItems, root) => {
    if (!root) {
      if (typeof document === "undefined") return;
      root = document.getElementById("galleryGrid");
    }
    if (!root) return;
    const fragment = document.createDocumentFragment();
    items.forEach((item) => fragment.appendChild(createGalleryTile(item)));
    root.replaceChildren(fragment);
  };

  const normalizeApiSlots = (slots) => {
    if (!Array.isArray(slots))
      throw new Error("Respuesta de galer\u00eda no v\u00e1lida");
    const byKey = new Map(slots.map((slot) => [slot?.key, slot]));
    return galleryItems.map((fallback) => {
      const slot = byKey.get(fallback.key);
      if (!slot) return { ...fallback };
      return {
        key: fallback.key,
        featured: fallback.featured === true,
        color: placeholderColors.has(slot.placeholderColor)
          ? slot.placeholderColor
          : fallback.color,
        imageSrc: getImageUrl(slot.imageSrc),
        alt: typeof slot.alt === "string" ? slot.alt : "",
        instagramUrl: getInstagramPostUrl(slot.instagramUrl),
        focalX: clamp(slot.focalX, 0, 100, 50),
        focalY: clamp(slot.focalY, 0, 100, 50),
        zoom: clamp(slot.zoom, 1, 3, 1),
      };
    });
  };

  const loadGallery = async () => {
    const base = String(window.CRONOX_API?.API_BASE || "").replace(/\/$/, "");
    const response = await fetch(`${base}/api/gallery`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok)
      throw new Error(`No se pudo cargar la galer\u00eda (${response.status})`);
    const payload = await response.json();
    const items = normalizeApiSlots(payload?.slots);
    window.CRONOX_GALLERY.items = items;
    renderGallery(items);
    return items;
  };

  window.CRONOX_GALLERY = {
    items: galleryItems,
    render: renderGallery,
    load: loadGallery,
  };

  renderGallery();
  loadGallery().catch(() => {
    window.CRONOX_GALLERY.items = galleryItems;
    renderGallery(galleryItems);
  });
})();
