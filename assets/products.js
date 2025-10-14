// products.js — robusto: intenta varias extensiones y fallback a RAW GitHub
(function(){
  const productsGrid = document.getElementById("productsGrid");
  const productsFallback = document.getElementById("productsFallback");

  if (!productsGrid) {
    if (productsFallback) { productsFallback.hidden = false; }
    return;
  }

  // Define tus productos por "baseName" (sin extensión)
  const GH_USER = "danir23007";
  const GH_REPO = "Web_Cronox";
  const BASE_LOCAL = "assets/products/";
  const EXTS = ["jpg","jpeg","JPG","JPEG","png","PNG","webp","WEBP"];

  const products = [
    { name: "Camiseta Washed Negra", price: "49 €", baseName: "camiseta_washed_negra" },
    { name: "Camiseta Washed Gris",  price: "49 €", baseName: "camiseta_washed_gris"  }
  ];

  function buildCandidates(base){
    // prueba primero local, luego RAW GitHub, para cada extensión
    const cands = [];
    for (const ext of EXTS) {
      const local = `${BASE_LOCAL}${base}.${ext}`;
      const raw   = `https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/main/${BASE_LOCAL}${base}.${ext}`;
      cands.push(local, raw);
    }
    // último recurso: placeholder si lo pones algún día
    cands.push(`${BASE_LOCAL}placeholder.jpg`);
    return cands;
  }

  function createCard(p){
    const card = document.createElement("div");
    card.className = "product-card";

    const img = document.createElement("img");
    img.className = "product-img";
    img.alt = p.name;

    const candidates = buildCandidates(p.baseName);
    let idx = 0;

    function tryNext(){
      if (idx >= candidates.length) return;
      img.src = candidates[idx] + `?v=31`; // cache-busting
      idx++;
    }
    img.onerror = tryNext;
    tryNext(); // primer intento

    const h3 = document.createElement("h3");
    h3.className = "product-name";
    h3.textContent = p.name;

    const price = document.createElement("p");
    price.className = "product-price";
    price.textContent = p.price;

    card.appendChild(img);
    card.appendChild(h3);
    card.appendChild(price);
    return card;
  }

  try {
    productsGrid.innerHTML = "";
    products.forEach(p => productsGrid.appendChild(createCard(p)));
    if (productsFallback) productsFallback.hidden = true;
  } catch (e) {
    console.error(e);
    if (productsFallback) {
      productsFallback.hidden = false;
      productsFallback.innerHTML = "<p>No se han podido cargar los productos (error en products.js).</p>";
    }
  }
})();
