// The controller owns cart reads; the badge only observes its current state.
(function () {
  const render = (cart) => {
    const count = Number(cart?.itemsCount) || 0;
    document.querySelectorAll('.cart-count').forEach((el) => {
      el.textContent = String(count);
      el.hidden = count <= 0;
    });
    document.querySelectorAll('.topbar__cart .icon-bag').forEach((icon) => {
      icon.classList.toggle('has-items', count > 0);
    });
  };
  const current = () => render(window.CRONOX_CART?.state.data);
  window.addEventListener('cart:state', current);
  window.addEventListener('cart:updated', (event) => {
    render(window.CRONOX_CART ? window.CRONOX_CART.state.data : event.detail);
  });
  const init = () => {
    if (window.CRONOX_CART) {
      current();
      Promise.resolve(window.CRONOX_CART_READY).then(current, current);
    } else if (window.CRONOX_CART_READY) {
      Promise.resolve(window.CRONOX_CART_READY).then(render, () => undefined);
    } else {
      window.CRONOX_API?.getCart?.().then(render).catch(() => undefined);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
