// ======================================================
// assets/products.js — Grid transparente + enlaces a página de producto
// ======================================================
(function () {
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");
  const filtersForm = document.getElementById("filtersForm");
  const btnClearFilters = document.getElementById("btnClearFilters");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");

  if (!productsGrid) {
    console.warn("[CRONOX] No se encontró #productsGrid.");
  }

  const norm = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const url = new URL(window.location);
  const initialQuery = norm(url.searchParams.get("q") || "");
  if (searchInput && initialQuery) searchInput.value = url.searchParams.get("q") || "";

  // === Datos de ejemplo (ajusta rutas/nombres a tus PNG) ===
  const products = [
    {
      id: "hoodie-acid-black",
      name: "Sudadera CRONOX Acid Black",
      price: 89,
      priceLabel: "89 €",
      image: "assets/products/sudadera1.png",
      categories: ["sudaderas"],
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      desc: "Sudadera premium con lavado acid y logo metalizado CRONOX."
    },
    {
      id: "tee-oversized",
      name: "Camiseta CRONOX Oversized",
      price: 49,
      priceLabel: "49 €",
      image: "assets/products/camiseta1.png",
      categories: ["camisetas"],
      sizes: ["xs", "s", "m", "l"],
      color: "negro",
      desc: "Camiseta oversize con gramaje alto y print tono sobre tono."
    },
    {
      id: "pants-dark",
      name: "Pantalón Dark Street",
      price: 79,
      priceLabel: "79 €",
      image: "assets/products/pantalon1.png",
      categories: ["pantalones"],
      sizes: ["s", "m", "l"],
      color: "gris",
      desc: "Pantalón corte straight, alta resistencia y acabado soft-touch."
    },
    {
      id: "cap-black",
      name: "Gorra Logo Metalizado",
      price: 39,
      priceLabel: "39 €",
      image: "assets/products/gorra1.png",
      categories: ["accesorios"],
      sizes: [],
      color: "negro",
      desc: "Gorra ajustable con emblema CRONOX efecto cromo oscuro."
    }
  ];

  // Tarjeta transparente con <a> hacia producto.html?id=...
  function createCard(p) {
    const a = document.createElement("a");
    a.href = `producto.html?id=${encodeURIComponent(p.id)}`;
    a.className = "product-card";
    a.setAttribute("data-id", p.id);

    const img = document.createElement("img");
    img.className = "product-img";
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = p.name || "Producto";
    img.src = p.image;

    const name = document.createElement("h3");
    name.className = "product-name";
    name.textContent = p.name;

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = p.priceLabel || `${p.price} €`;

    a.appendChild(img);
    a.appendChild(name);
    a.appendChild(price);
    return a;
  }

  function getActiveFilters() {
    const f = { categories: [], sizes: [], colors: [], q: "" };

    if (filtersForm) {
      f.categories = Array.from(filtersForm.querySelectorAll('input[name="cat"]:checked')).map(el => el.value);
      f.sizes = Array.from(filtersForm.querySelectorAll('input[name="size"]:checked')).map(el => el.value);
      f.colors = Array.from(filtersForm.querySelectorAll('input[name="color"]:checked')).map(el => el.value);
    }

    const qParam = url.searchParams.get("q");
    if (qParam && qParam.trim()) f.q = norm(qParam);
    else if (searchInput && searchInput.value) f.q = norm(searchInput.value);

    return f;
  }

  function matchProduct(p, f) {
    if (f.q) {
      const haystack = norm(p.name);
      if (!haystack.includes(f.q)) return false;
    }
    if (f.categories.length && !p.categories?.some(c => f.categories.includes(c))) return false;
    if (f.sizes.length && Array.isArray(p.sizes) && p.sizes.length) {
      if (!p.sizes.some(s => f.sizes.includes(s))) return false;
    }
    if (f.colors.length && !f.colors.includes(p.color)) return false;
    return true;
  }

  function renderProducts(list) {
    if (!productsGrid) return;
    productsGrid.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      if (productsFallback) {
        productsFallback.hidden = false;
        productsFallback.innerHTML = '<p>No hay productos que coincidan con los filtros o la búsqueda.</p>';
      }
      return;
    }

    if (productsFallback) productsFallback.hidden = true;
    const frag = document.createDocumentFragment();
    list.forEach(p => frag.appendChild(createCard(p)));
    productsGrid.appendChild(frag);
  }

  function apply() {
    try {
      const f = getActiveFilters();
      const filtered = products.filter(p => matchProduct(p, f));
      renderProducts(filtered);
    } catch (err) {
      console.error("[CRONOX] Error aplicando filtros:", err);
      if (productsFallback) {
        productsFallback.hidden = false;
        productsFallback.innerHTML = "<p>Ha ocurrido un error cargando los productos. Vuelve a intentarlo.</p>";
      }
    }
  }

  window.addEventListener("popstate", apply);
  window.addEventListener("hashchange", apply);
  if (searchForm) searchForm.addEventListener("submit", () => setTimeout(apply, 0));
  if (filtersForm) {
    filtersForm.addEventListener("submit", () => setTimeout(apply, 0));
    filtersForm.addEventListener("change", apply);
  }
  if (btnClearFilters) btnClearFilters.addEventListener("click", () => { filtersForm?.reset(); setTimeout(apply, 0); });

  // INIT
  renderProducts(products);
  if (initialQuery) apply();
})();

