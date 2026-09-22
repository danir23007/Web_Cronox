// Download Stripe independently of page parsing and the checkout summary.
// Always load the official script directly; never proxy or bundle Stripe.js.
(function () {
  window.CRONOX_STRIPE_READY = new Promise((resolve) => {
    if (typeof window.Stripe === 'function') {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    script.async = true;
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(ready);
    };
    const timeout = window.setTimeout(() => finish(false), 15000);
    script.addEventListener('load', () => finish(typeof window.Stripe === 'function'), { once: true });
    script.addEventListener('error', () => finish(false), { once: true });
    document.head.appendChild(script);
  });
})();
