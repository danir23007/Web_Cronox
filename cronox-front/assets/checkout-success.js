(function () {
  const referenceEl = document.getElementById('checkout-success-reference');

  const params = new URLSearchParams(window.location.search);
  const API_BASE = window.CRONOX_API?.API_BASE || window.CRONOX_API_BASE || '';

  const POLL_INTERVAL_MS = 1500;
  const POLL_TIMEOUT_MS = 45000;

  const normalizeRef = (value) =>
    (value || '')
      .toString()
      .trim()
      .replace(/[^A-Za-z0-9_]/g, '')
      .toUpperCase();

  const makeShortRef = (source) => {
    const cleaned = normalizeRef(source);
    if (!cleaned) return '';

    if (/^PI[A-Z0-9_]+$/.test(cleaned)) {
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

  const resolveProviderRef = () => {
    const candidates = [
      params.get('payment_intent'),
      params.get('ref'),
      params.get('providerRef'),
      params.get('provider_ref'),
      params.get('orderId'),
      params.get('order_id'),
    ];

    const raw = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
    return raw ? raw.trim() : '';
  };

  const rawRef = resolveProviderRef();
  const displayRef = makeShortRef(rawRef);

  if (referenceEl && displayRef) {
    referenceEl.textContent = `Referencia: ${displayRef}`;
    referenceEl.hidden = false;
  }

  const clearGuestCartCache = () => {
    try {
      localStorage.removeItem('cronox_guest_cart');
    } catch (error) {
      console.warn('[CRONOX] No se pudo limpiar la caché del carrito guest', error);
    }
  };

  const syncCartUiWithBackend = async () => {
    const api = window.CRONOX_API || null;

    clearGuestCartCache();

    try {
      if (typeof api?.getCart === 'function') {
        const updatedCart = await api.getCart();
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: updatedCart }));
        return;
      }

      if (typeof window.initCartFromBackend === 'function') {
        await window.initCartFromBackend();
        return;
      }

      window.dispatchEvent(
        new CustomEvent('cart:updated', {
          detail: { items: [], itemsCount: 0, subtotalCents: 0, subtotalLabel: '0,00 €' },
        }),
      );
    } catch (error) {
      console.warn('[CRONOX] No se pudo sincronizar el carrito tras confirmar el pedido', error);
    }
  };

  const fetchPaymentStatus = async (providerRef) => {
    const endpoint = `${API_BASE}/api/orders/payment-status?providerRef=${encodeURIComponent(providerRef)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('AUTH_REQUIRED');
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.message || `API error ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  };

  const waitForOrderProcessing = async (providerRef) => {
    const startTime = Date.now();

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      const status = await fetchPaymentStatus(providerRef);

      if (status?.found && status?.isProcessed) {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    return null;
  };

  const initConfirmedCartCleanup = async () => {
    const redirectStatus = (params.get('redirect_status') || '').toLowerCase();
    if (redirectStatus && redirectStatus !== 'succeeded') return;

    if (!rawRef) {
      console.warn('[CRONOX] Success page sin referencia de pago: no se limpia carrito');
      return;
    }

    try {
      const status = await waitForOrderProcessing(rawRef);
      if (status?.isProcessed) {
        await syncCartUiWithBackend();
      } else {
        console.warn('[CRONOX] Timeout esperando confirmación del pedido. Reintentará al refrescar.');
      }
    } catch (error) {
      if (error?.message === 'AUTH_REQUIRED') {
        console.warn('[CRONOX] Sesión no disponible para verificar el estado del pedido');
        return;
      }
      console.warn('[CRONOX] Error verificando el estado del pedido', error);
    }
  };

  initConfirmedCartCleanup();
})();
