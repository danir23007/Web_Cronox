// ====================================================== 
// assets/product-page.js — Página de producto + carrito (versión final compatible con nuevo producto.html)
// CRONOX
// ======================================================
(function () {
  const CART_KEY = "cronox_cart";

  // --- Referencias de la PDP ---
  const pImage = document.getElementById("pImage");
  const pName  = document.getElementById("pName");
  const pPrice = document.getElementById("pPrice");
  const pDesc  = document.getElementById("pDesc");
  const pSize  = document.getElementById("pSize");
  const pQty   = document.getElementById("pQty");
  const pAdd   = document.getElementById("pAdd");
  const toast  = document.getElementById("toast");

  // --- Catálogo base (igual que en products.js) ---
  const PRODUCTS = window.CRONOX_PRODUCTS || [
    {
      id: "camiseta-washed-gris",
      name: "Camiseta Washed Gris",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      sizes: ["s", "m", "l", "xl"],
      color: "gris",
      desc: "Camiseta premium lavado gris, corte oversized y tacto suave."
    },
    {
      id: "camiseta-washed-negra",
      name: "Camiseta Washed Negra",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_negra.png",
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];

  // --- Utils ---
  function getId() {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get("id") || "";
    } catch {
      return "";
    }
  }

  function money(n) {
    const v = Number(n) || 0;
    try {
      return v.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
    } catch {
      return `${v} €`;
    }
  }

  function setPageTitle(p) {
    try {
      if (!p) return;
      document.title = `${p.name} — CRONOX`;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.setAttribute("content", `${p.name} · ${p.desc || "Producto CRONOX"}`);
      }
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

  // --- Render del producto ---
  function render(p) {
    if (!p) return;

    // Pintar imagen, texto, precio, descripción
    if (pImage) { pImage.src = p.image; pImage.alt = p.name || ""; }
    if (pName)  pName.textContent  = p.name || "";
    if (pPrice) pPrice.textContent = p.priceLabel || money(p.price);
    if (pDesc)  pDesc.textContent  = p.desc || "";

    // Tallas dinámicas
    if (pSize) {
      const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ["m"];
      pSize.innerHTML = sizes.map(s => `<option value="${s.toUpperCase()}">${s.toUpperCase()}</option>`).join("");
    }

    // Cantidad por defecto
    if (pQty) pQty.value = "1";

    // Título y meta
    setPageTitle(p);

    // Scroll arriba
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
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

      const item = {
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        priceLabel: p.priceLabel || money(p.price),
        image: p.image,
        size,
        qty
      };

      addToCart(item);
      showToast("Añadido al carrito ✓");
    });
  }

  init();
})();
