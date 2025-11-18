// ======================================================
// assets/fav-toggle.js — botón de favoritos en tarjetas
// ======================================================
(function(){
  const KEY = 'cronox:favs';

  const SELECTOR = '.fav-toggle';

  function getFavs(){
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function dispatchChange(arr){
    try {
      const detail = Array.isArray(arr) ? arr.map((item) => ({ ...item })) : [];
      window.dispatchEvent(new CustomEvent('cronox:favsChanged', { detail }));
    } catch {}
  }

  function setFavs(arr){
    try { localStorage.setItem(KEY, JSON.stringify(arr)); }
    catch(e){}
    dispatchChange(arr);
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

  const getProductData = (btn) => {
    const card = btn.closest('.product-card');
    const product = {
      id: btn.dataset.id || card?.dataset.id || card?.dataset.slug || '',
      name: btn.dataset.name || card?.querySelector('.product-name')?.textContent?.trim() || 'Producto',
      price: btn.dataset.price || card?.querySelector('.product-price')?.textContent?.trim() || '',
      image: btn.dataset.image || card?.querySelector('img')?.src || ''
    };
    product.id = String(product.id || '').trim();
    return product;
  };

  const syncActiveState = () => {
    const favs = getFavs();
    const ids = new Set(favs.map((f) => f && f.id).filter(Boolean));
    document.querySelectorAll(SELECTOR).forEach((btn) => {
      const { id } = getProductData(btn);
      if (!id) return;
      btn.classList.toggle('active', ids.has(id));
    });
  };

  const handleClick = (btn) => {
    const product = getProductData(btn);
    if (!product.id) return;
    btn.classList.toggle('active');
    toggleFav(product);
  };

  const initBtn = (btn) => {
    if (!btn || btn.dataset.favReady === '1') return;
    btn.dataset.favReady = '1';
    const product = getProductData(btn);
    if (product.id && isFav(product.id)) btn.classList.add('active');
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleClick(btn);
    });
  };

  const initAll = () => {
    document.querySelectorAll(SELECTOR).forEach(initBtn);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.(SELECTOR)) initBtn(node);
        node.querySelectorAll?.(SELECTOR).forEach(initBtn);
      });
    }
  });

  window.addEventListener('DOMContentLoaded', () => {
    initAll();
    try { observer.observe(document.body, { childList: true, subtree: true }); } catch {}
  });

  window.addEventListener('cronox:favsChanged', syncActiveState);
  window.addEventListener('storage', (e) => { if (e.key === KEY) syncActiveState(); });
})();
