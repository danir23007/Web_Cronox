(function () {
  const referenceEl = document.getElementById('checkout-success-reference');
  if (!referenceEl) return;

  const params = new URLSearchParams(window.location.search);

  const normalizeRef = (value) =>
    (value || '')
      .toString()
      .trim()
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase();

  const makeShortRef = (source) => {
    const cleaned = normalizeRef(source);
    if (!cleaned) return '';

    if (/^PI[A-Z0-9]+$/.test(cleaned)) {
      return cleaned.slice(-6);
    }

    if (/^ORDER/.test(cleaned) && cleaned.length >= 6) {
      return cleaned.slice(-6);
    }

    if (/^[0-9]{1,6}$/.test(cleaned)) {
      return cleaned.padStart(6, '0');
    }

    if (cleaned.length <= 6) {
      return cleaned;
    }

    return cleaned.slice(-6);
  };

  const candidateRefs = [
    params.get('orderId'),
    params.get('order_id'),
    params.get('order'),
    params.get('reference'),
    params.get('ref'),
    params.get('payment_intent'),
  ];

  const rawRef = candidateRefs.find((value) => typeof value === 'string' && value.trim().length > 0);
  const displayRef = makeShortRef(rawRef);

  if (displayRef) {
    referenceEl.textContent = `Referencia: ${displayRef}`;
    referenceEl.hidden = false;
  }
})();
