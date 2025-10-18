// ======================================================
// assets/fav-toggle.js — botón de favoritos en tarjetas
// ======================================================
(function(){
  const KEY = 'cronox:favs';

  function getFavs(){
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function setFavs(arr){
    try { localStorage.setItem(KEY, JSON.stringify(arr)); }
    catch(e){}
    window.dispatchEvent(new Event('storage')); // para sincronizar
  }

  function isFav(id){
    return getFavs().some(x => x && x.id === id);
  }

  function toggleFav(product){
    const favs = getFavs();
    const exists = favs.some(x => x && x.id === product.id);
    const next = exists ? favs.filter(x => x.id !== product.id) : [...favs, product];
    setFavs(next);
  }

  // Inicializa en las tarjetas visibles
  window.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.product-card').forEach(card => {
      const id = card.dataset.id || card.querySelector('.product-name')?.textContent.trim();
      if (!id) return;

      // Crear botón estrella
      const btn = document.createElement('div');
      btn.className = 'fav-toggle';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polygon points="12 2 15.09 8.26 22 9.27 17.3 13.97 18.18 21
            12 17.77 5.82 21 6.7 13.97 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
      `;
      card.style.position = 'relative';
      card.appendChild(btn);

      // Estado inicial
      const productData = {
        id,
        name: card.querySelector('.product-name')?.textContent.trim() || 'Producto',
        price: card.querySelector('.product-price')?.textContent.trim() || '',
        image: card.querySelector('img')?.src || ''
      };
      if (isFav(id)) btn.classList.add('active');

      // Evento de clic
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        btn.classList.toggle('active');
        toggleFav(productData);
      });
    });
  });
})();
