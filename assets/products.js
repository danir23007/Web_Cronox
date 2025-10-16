// ======================================================
// assets/products.js — CRONOX STORE (solo dos camisetas actuales)
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

  // === Tus productos actuales ===
  const products = [
    {
      id: "camiseta-washed-gris",
      name: "Camiseta Washed Gris",
      price: 34.95,
      priceLabel: "34,95 €",
      image: "assets/products/camiseta_washed_gris.png",
      categories: ["camisetas"],
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
      categories: ["camisetas"],
      sizes: ["s", "m", "l", "xl"],
      color: "negro",
      desc: "Camiseta premium lavado negro, corte oversized y tacto suave."
    }
  ];

  // Crea tarjeta transparente con enlace al producto
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

  function renderProducts(list) {
    if (!productsGrid) return;
    productsGrid.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      if (productsFallback) {
        productsFallback.hidden = false;
        productsFallback.innerHTML = '<p>No hay productos que mostrar.</p>';
      }
      return;
    }

    if (productsFallback) productsFallback.hidden = true;
    const frag = document.createDocumentFragment();
    list.forEach((p) => frag.appendChild(createCard(p)));
    productsGrid.appendChild(frag);
  }

  renderProducts(products);
})();
