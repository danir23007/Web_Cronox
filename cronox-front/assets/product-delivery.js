// Shared by every product page. Calendar arithmetic is independent of device timezone.
(() => {
  const madrid = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const spanish = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC', day: 'numeric', month: 'long',
  });
  const calendar = (instant) => {
    const parts = Object.fromEntries(madrid.formatToParts(instant).map(p => [p.type, p.value]));
    return [Number(parts.year), Number(parts.month), Number(parts.day)];
  };
  const dayKey = (instant) => calendar(instant).join('-');
  const DAY = 24 * 60 * 60 * 1000;
  // Dispatch calendar: Comunidad de Madrid + municipality of Madrid, confirmed
  // by the business. Complete annual lists; never infer the buyer's destination.
  // 2026: Decreto 75/2025 (BOCM 25/09/2025) + madrid.es official calendar.
  // 2027: Decreto 82/2026 (BOCM 01/10/2026) + Pleno 29/09/2026, item 21.
  // Official source URLs and annual maintenance policy: docs/delivery-calendar-2026-10-05.md.
  const holidays = Object.freeze({
    2026: new Set([
      '2026-01-01', '2026-01-06', '2026-04-02', '2026-04-03',
      '2026-05-01', '2026-05-02', '2026-05-15', '2026-08-15',
      '2026-10-12', '2026-11-02', '2026-11-09', '2026-12-07',
      '2026-12-08', '2026-12-25',
    ]),
    2027: new Set([
      '2027-01-01', '2027-01-06', '2027-03-19', '2027-03-25',
      '2027-03-26', '2027-05-01', '2027-05-15', '2027-08-16',
      '2027-10-12', '2027-11-01', '2027-11-09', '2027-12-06',
      '2027-12-08', '2027-12-25',
    ]),
  });
  const estimateProduct = (instant = Date.now()) => {
    const [year, month, day] = calendar(instant);
    const orderDay = Date.UTC(year, month - 1, day);
    let end = orderDay + 3 * DAY;
    const weekends = new Set();
    // Scan the extended interval exactly once, excluding the order date and
    // including delivery. A holiday and a weekend contribute independently.
    for (let cursor = orderDay + DAY; cursor <= end; cursor += DAY) {
      const date = new Date(cursor);
      const annual = holidays[date.getUTCFullYear()];
      if (!annual) return null; // No incomplete or invented future calendar.
      const weekday = date.getUTCDay();
      if (weekday === 6 || weekday === 0) {
        const saturday = cursor - (weekday === 0 ? DAY : 0);
        if (!weekends.has(saturday)) {
          weekends.add(saturday);
          end += DAY;
        }
      }
      if (annual.has(date.toISOString().slice(0, 10))) end += DAY;
    }
    return spanish.format(new Date(end));
  };
  // The existing policy is uniform: there are no per-SKU lead times or
  // destination/cutoff calendars in the product or shipping-method schema.
  const estimateCart = (cart, instant = Date.now()) =>
    Array.isArray(cart?.items) && cart.items.length && cart.items.every(item => Number(item.qty) > 0)
      ? estimateProduct(instant) : null;
  const render = (notice, date) => {
    if (!notice) return;
    const target = notice.querySelector('[data-delivery-date]');
    if (target.textContent !== (date || '')) target.textContent = date || '';
    notice.hidden = !date;
  };
  const products = new WeakMap();
  const setProduct = (notice, product) => {
    if (!notice) return;
    products.set(notice, product);
    update();
  };
  window.CRONOX_DELIVERY = { estimateProduct, estimateCart, render, setProduct, refresh: update };
  let timer;
  function update() {
    clearTimeout(timer);
    const now = Date.now();
    // UTC is only a calendar carrier here, not the purchase timezone. This handles
    // month/year/leap-day rollover without treating three days as 72 elapsed hours.
    document.querySelectorAll('[data-delivery-notice]').forEach(notice => {
      const state = window.CRONOX_CART?.state;
      const status = window.CRONOX_STOCK?.productStockStatus(products.get(notice)?.variants, null);
      const purchasable = status === 'in_stock';
      render(notice, notice.hasAttribute('data-quick-delivery')
        ? (purchasable && notice.dataset.deliveryAvailable === 'true' ? estimateProduct(now) : null)
        : notice.hasAttribute('data-cart-delivery')
        ? estimateCart(['loading', 'error'].includes(state?.status) ? null : state?.data, now)
        : notice.hasAttribute('data-product-delivery') ? (purchasable ? estimateProduct(now) : null) : estimateProduct(now));
    });
    // Find the next Madrid date boundary, including 23/25-hour DST days.
    const today = dayKey(now);
    let low = now, high = now + 26 * 60 * 60 * 1000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (dayKey(mid) === today) low = mid;
      else high = mid;
    }
    timer = setTimeout(update, Math.max(1, high - Date.now()));
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
  window.addEventListener('focus', update);
  window.addEventListener('pageshow', update);
  update();
})();
