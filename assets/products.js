// ===== products.js =====
// Genera dinámicamente el grid de productos en la tienda

const productsGrid = document.getElementById("productsGrid");
const productsFallback = document.getElementById("productsFallback");

// Lista de productos base (ejemplo — reemplázalos por los tuyos)
const products = [
  {
    name: "Sudadera CRONOX Acid Black",
    price: "89 €",
    image: "assets/products/sudadera1.jpg"
  },
  {
    name: "Camiseta CRONOX Oversized",
    price: "49 €",
    image: "assets/products/camiseta1.jpg"
  },
  {
    name: "Pantalón Darkwave CRX",
    price: "99 €",
    image: "assets/products/pantalon1.jpg"
  },
  {
    name: "Gorra Midnight Logo",
    price: "39 €",
    image: "assets/products/gorra1.jpg"
  }
];

// Renderiza el grid
function renderProducts(list) {
  if (!productsGrid) return;

  productsGrid.innerHTML = "";

  list.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <img src="${product.image}" alt="${product.name}" class="product-img">
      <h3 class="product-name">${product.name}</h3>
      <p class="product-price">${product.price}</p>
    `;
    productsGrid.appendChild(card);
  });

  // Ocultamos el mensaje de error si se cargaron productos
  if (list.length > 0 && productsFallback) {
    productsFallback.hidden = true;
  }
}

// Inicializa al cargar
document.addEventListener("DOMContentLoaded", () => {
  renderProducts(products);
});
