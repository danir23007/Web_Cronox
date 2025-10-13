// products.js — Pinta productos en #productsGrid con manejo de errores
(function(){
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");

  function showFallback(msg){
    if (productsFallback) {
      productsFallback.hidden = false;
      if (msg) productsFallback.innerHTML = `<p>${msg}</p>`;
    }
  }

  try {
    if (!productsGrid) {
      showFallback("No se ha encontrado el contenedor de productos (#productsGrid).");
      return;
    }

    // === EJEMPLO de datos locales (sustituye por los tuyos) ===
    const products = [
      { name: "Sudadera CRONOX Acid Black", price: "89 €", image: "assets/products/sudadera1.jpg" },
      { name: "Camiseta CRONOX Oversized",  price: "49 €", image: "assets/products/camiseta1.jpg" },
      { name: "Pantalón Darkwave CRX",      price: "99 €", image: "assets/products/pantalon1.jpg" },
      { name: "Gorra Midnight Logo",        price: "39 €", image: "assets/products/gorra1.jpg" }
    ];

    // Render
    productsGrid.innerHTML = "";
    products.forEach(p => {
      const card = document.createElement("div");
      card.className = "product-card";
      card.innerHTML = `
        <img src="${p.image}" alt="${p.name}" class="product-img" onerror="this.src='assets/products/placeholder.jpg'">
        <h3 class="product-name">${p.name}</h3>
        <p class="product-price">${p.price}</p>
      `;
      productsGrid.appendChild(card);
    });

    if (products.length === 0) showFallback("No hay productos disponibles en este momento.");
    else if (productsFallback) productsFallback.hidden = true;

  } catch (err) {
    console.error("Error al cargar productos:", err);
    showFallback("No se han podido cargar los productos. (Error en products.js)");
    // Importante: no relanzamos el error para no bloquear app.js / preloader
  }
})();
