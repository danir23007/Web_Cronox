// ===== Utilidades =====
const formatEUR = n => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

function getCart() {
  try { return JSON.parse(localStorage.getItem("CRONOX_CART") || "[]"); }
  catch { return []; }
}
function saveCart(cart) { localStorage.setItem("CRONOX_CART", JSON.stringify(cart)); }
function cartCount() { return getCart().reduce((a,i)=>a+i.qty,0); }
function setCartBadge() {
  const el = document.getElementById("cart-count");
  if (el) el.textContent = cartCount();
}

// Añadir al carrito
function addToCart(productId, size, qty=1) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return alert("Producto no encontrado");
  if (!size) return alert("Elige una talla");

  const cart = getCart();
  const key = `${productId}|${size}`;
  const existing = cart.find(i => i.key === key);
  if (existing) existing.qty += qty;
  else cart.push({ key, productId, size, qty, price: product.price, name: product.name });
  saveCart(cart);
  setCartBadge();
  alert("Añadido al carrito 🛒");
}

// ===== Render del catálogo en index.html =====
function renderGrid() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;
  grid.innerHTML = PRODUCTS.map(p => `
    <article class="card product">
      <div class="p-img">
        <img src="${p.images[0]}" alt="${p.name}" loading="lazy" />
        ${p.badges?.length ? `<span class="badge">${p.badges[0]}</span>` : ""}
      </div>
      <h3>${p.name}</h3>
      <p class="price">${formatEUR(p.price)}</p>
      <div class="p-actions">
        <a class="cta secondary" href="product.html?id=${encodeURIComponent(p.id)}">Ver</a>
        <button class="cta" onclick="location.href='product.html?id=${encodeURIComponent(p.id)}'">Comprar</button>
      </div>
    </article>
  `).join("");
}

// ===== Página de producto product.html =====
function renderProductPage() {
  const wrap = document.getElementById("product-detail");
  if (!wrap) return;
  const id = new URLSearchParams(location.search).get("id");
  const p = PRODUCTS.find(x => x.id === id) || PRODUCTS[0];

  wrap.innerHTML = `
    <div class="p-detail">
      <div class="p-gallery">
        <img src="${p.images[0]}" alt="${p.name}" />
      </div>
      <div class="p-info">
        <h1>${p.name}</h1>
        <p class="price big">${formatEUR(p.price)}</p>
        <p class="desc">${p.description}</p>
        <label>Talla</label>
        <div class="sizes">
          ${p.sizes.map(s => `<button class="size-btn" data-size="${s}" onclick="selectSize(this)">${s}</button>`).join("")}
        </div>
        <div class="detail-actions">
          <button class="cta" id="btn-add">Añadir al carrito</button>
          <a class="cta secondary" href="cart.html">Ver carrito</a>
        </div>
      </div>
    </div>
  `;
  let selected = null;
  window.selectSize = (btn) => {
    document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selected = btn.dataset.size;
  };
  document.getElementById("btn-add").addEventListener("click", () => addToCart(p.id, selected || p.sizes[0], 1));
}

// ===== Página de carrito cart.html =====
function renderCartPage() {
  const wrap = document.getElementById("cart-page");
  if (!wrap) return;
  const cart = getCart();
  if (cart.length === 0) {
    wrap.innerHTML = `<p>Tu carrito está vacío.</p><p><a class="cta" href="index.html">Volver a la tienda</a></p>`;
    return;
  }
  const rows = cart.map(i => {
    const p = PRODUCTS.find(x => x.id === i.productId);
    return `
      <tr>
        <td>${p ? p.name : i.productId}<br><small>Talla: ${i.size}</small></td>
        <td>${i.qty}</td>
        <td>${formatEUR(i.price)}</td>
        <td>${formatEUR(i.price * i.qty)}</td>
        <td><button class="link danger" onclick="removeItem('${i.key}')">Eliminar</button></td>
      </tr>
    `;
  }).join("");

  const total = cart.reduce((a,i)=>a + i.price * i.qty, 0);

  wrap.innerHTML = `
    <table class="cart">
      <thead><tr><th>Producto</th><th>Ud.</th><th>Precio</th><th>Subtotal</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="cart-total">
      <div>Total</div>
      <div class="price big">${formatEUR(total)}</div>
    </div>
    <div class="checkout">
      <button class="cta" id="checkout-btn">Checkout (demo)</button>
      <a class="cta secondary" href="index.html">Seguir comprando</a>
    </div>
  `;
  document.getElementById("checkout-btn").addEventListener("click", () => {
    alert("Demo checkout ✅ — más adelante conectamos Stripe/Shopify.");
  });

  window.removeItem = (key) => {
    const next = getCart().filter(i => i.key !== key);
    saveCart(next);
    location.reload();
  };
}

// ===== init común =====
function initCommon() { setCartBadge(); }
document.addEventListener("DOMContentLoaded", () => {
  initCommon();
  renderGrid();
  renderProductPage();
  renderCartPage();
});
