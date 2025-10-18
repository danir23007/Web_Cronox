// ====================================================== 
// assets/product-page.js — PDP + carrito + relacionados + back suave + marca de retorno
// CRONOX
// ======================================================
(function () {
  const CART_KEY = "cronox_cart";
  const RETURN_KEY = "cronox_scroll_to"; // <- aquí guardamos el id para volver

  // --- Referencias principales ---
  const pImage = document.getElementById("pImage");
  const pName  = document.getElementById("pName");
  const pPrice = document.getElementById("pPrice");
  const pDesc  = document.getElementById("pDesc");
  const pSize  = document.getElementById("pSize");
  const pQty   = document.getElementById("pQty");
  const pAdd   = document.getElementById("pAdd");
  const toast  = document.getElementById("toast");
  const relatedGrid = document.getElementById("relatedGrid");

  // --- Catálogo (inyectado desde index o fallback local del HTML) ---
  const PRODUCTS = Array.isArray(window.CRONOX_PRODUCTS) ? window.CRONOX_PRODUCTS : [];

  // --- Utils ---
  function getId() {
    try { return new URL(window.location.href).searchParams.get("id") || ""; }
    catch { return ""; }
  }
  function money(n) {
    const v = Number(n) || 0;
    try { return v.toLocaleString("es-ES", { style: "currency", currency: "EUR" }); }
    catch { return `${v} €`; }
  }
  function setPageTitle(p) {
    try {
      if (!p) return;
      document.title = `${p.name} — CRONOX`;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute("content", `${p.name} · ${p.desc || "Producto CRONOX"}`);
    } catch {}
  }

  // --- Carrito ---
  function addToCart(item) {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const cart = raw ? JSON.parse(raw) : [];
      const idx = cart.findIndex(x => x.id === item.id && x.size === item.size);
      if (idx >= 0) {
        cart[idx].qty = (Number(cart[idx].qty) || 0) + (Number(item.qty) || 1);
      } else {
        cart.push({ ...item, qty: Number(item.qty) || 1 });
      }
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      window.dispatchEvent(new Event("cart:updated"));
    } catch (e) {
      console.error("[CRONOX] Error guardando en carrito:", e);
      alert("No se pudo guardar el carrito en este navegador.");
    }
  }
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  // --- Relacionados ---
  function similarityScore(a, b) {
    let score = 0;
    if (a.color && b.color && a.color === b.color) score += 1;
    const ac = Array.isArray(a.categories) ? a.categories : [];
    const bc = Array.isArray(b.categories) ? b.categories : [];
    if (ac.length && bc.length && ac.some(c => bc.includes(c))) score += 2;
    return score;
  }
  function getRelated(current, max = 4) {
    const pool = PRODUCTS.filter(x => x.id !== current.id);
    return pool
      .map(x => ({ p: x, s: similarityScore(current, x) }))
      .sort((u, v) => v.s - u.s)
      .slice(0, max)
      .map(o => o.p);
  }
  function cardHTML(p) {
    return `
      <a class="product-card" href="producto.html?id=${encodeURIComponent(p.id)}" aria-label="${p.name}">
        <img class="product-img" src="${p.image}" alt="${p.name}" loading="lazy" decoding="async">
        <h3 class="product-name">${p.name}</h3>
        <p class="product-price">${p.priceLabel || money(p.price)}</p>
      </a>
    `;
  }
  function renderRelated(current) {
    if (!relatedGrid) return;
    const rel = getRelated(current, 4);
    relatedGrid.innerHTML = rel.map(cardHTML).join("");
  }

  // --- Render PDP ---
  function render(p) {
    if (!p) return;
    if (pImage) { pImage.src = p.image; pImage.alt = p.name || ""; }
    if (pName)  pName.textContent  = p.name || "";
    if (pPrice) pPrice.textContent = p.priceLabel || money(p.price);
    if (pDesc)  pDesc.textContent  = p.desc || "";

    if (pSize) {
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ["m"];
      pSize.innerHTML = sizes.map(s => `<option value="${s.toUpperCase()}">${s.toUpperCase()}</option>`).join("");
    }
    if (pQty) pQty.value = "1";

    setPageTitle(p);
    renderRelated(p);

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  // --- Back suave (fade-out) + guardar id para volver ---
  function setupBackLinks(currentId) {
    const links = document.querySelectorAll('a.js-back[href^="index.html#store"]');
    links.forEach(a => {
      a.addEventListener("click", (e) => {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        // Guarda el id para reposicionar en la tienda
        try { sessionStorage.setItem(RETURN_KEY, currentId); } catch {}
        if (prefersReduced) return; // navegación normal sin fade

        e.preventDefault();
        document.documentElement.classList.add("page-exit");
        document.body.classList.add("page-exit");
        const href = a.getAttribute("href");
        setTimeout(() => { window.location.href = href; }, 220);
      });
    });
  }

  // --- Init ---
  function init() {
    const id = getId();
    const p = PRODUCTS.find(x => x.id === id);
    if (!p) {
      window.location.replace("index.html#store");
      return;
    }

    render(p);

    pAdd?.addEventListener("click", () => {
      const size = pSize?.value || "M";
      const qty  = Math.max(1, parseInt(pQty?.value || "1", 10));
      addToCart({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        priceLabel: p.priceLabel || money(p.price),
        image: p.image,
        size,
        qty
      });
      showToast("Añadido al carrito ✓");
    });

    setupBackLinks(p.id);
  }

  init();
})();
