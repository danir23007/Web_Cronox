// ===== products.js =====
// Genera dinámicamente el grid con tus productos reales

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

    // === TUS PRODUCTOS REALES ===
    const products = [
      {
        name: "Camiseta Washed Negra",
        price: "34,95€",
        image: "assets/products/camiseta_washed_negra.jpg",
        color: "negro",
        category: "camisetas"
      },
      {
        name: "Camiseta Washed Gris",
        price: "34,95€",
        image: "assets/products/camiseta_washed_gris.jpg",
        color: "gris",
        category: "camisetas"
      }
    ];

    // Renderizado
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

    if (products.length === 0) showFallback("No hay productos disponibles.");
    else if (productsFallback) productsFallback.hidden = true;

  } catch (err) {
    console.error("Error al cargar productos:", err);
    showFallback("No se han podido cargar los productos. (Error en products.js)");
  }
})();
