// Shared by every product page. Calendar arithmetic is independent of device timezone.
(() => {
  const notices = document.querySelectorAll('[data-delivery-notice]');
  if (!notices.length) return;
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
  let timer;
  function update() {
    clearTimeout(timer);
    const now = Date.now();
    const [year, month, day] = calendar(now);
    // UTC is only a calendar carrier here, not the purchase timezone. This handles
    // month/year/leap-day rollover without treating three days as 72 elapsed hours.
    const date = spanish.format(new Date(Date.UTC(year, month - 1, day + 3)));
    notices.forEach(notice => {
      const target = notice.querySelector('[data-delivery-date]');
      if (target.textContent !== date) target.textContent = date;
      notice.hidden = false;
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
