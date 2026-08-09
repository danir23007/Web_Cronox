(function () {
  const referenceEl = document.getElementById('checkout-success-reference');
  const eyebrowEl = document.getElementById('checkout-success-eyebrow');
  const titleEl = document.getElementById('checkout-success-title');
  const messageEl = document.getElementById('checkout-success-message');

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

  const setUiState = ({ eyebrow, title, message }) => {
    if (eyebrowEl && typeof eyebrow === 'string') eyebrowEl.textContent = eyebrow;
    if (titleEl && typeof title === 'string') titleEl.textContent = title;
    if (messageEl && typeof message === 'string') messageEl.textContent = message;
  };

  const rawRef = resolveProviderRef();

  const clearGuestCartCache = () => {
    try {
      localStorage.removeItem('cronox_guest_cart');
    } catch (error) {
      console.warn('[CRONOX] No se pudo limpiar la caché del carrito guest', error);
    }
  };

  const syncCartUiWithBackend = async () => {
    const api = window.CRONOX_API || null;
    const cartController = window.CRONOX_CART || null;

    clearGuestCartCache();

    try {
      if (typeof cartController?.fetchCart === 'function') {
        const updatedCart = await cartController.fetchCart();
        if (cartController.state?.drawerOpen && typeof cartController.renderCartDrawer === 'function') {
          cartController.renderCartDrawer(updatedCart);
        }
        return updatedCart;
      }

      if (typeof api?.getCart === 'function') {
        const updatedCart = await api.getCart();
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: updatedCart }));
        return updatedCart;
      }

      if (typeof window.initCartFromBackend === 'function') {
        return window.initCartFromBackend();
      }

      throw new Error('CART_API_UNAVAILABLE');
    } catch (error) {
      console.warn('[CRONOX checkout success cart sync]', {
        event: 'confirmed_order_cart_sync_failed',
        code: error?.message === 'CART_API_UNAVAILABLE' ? 'CART_API_UNAVAILABLE' : 'CART_SYNC_FAILED',
      });
      return null;
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

  const renderConfirmedState = (status) => {
    const orderId = status?.orderId;
    const displaySource = orderId ? String(orderId) : rawRef;
    const displayRef = makeShortRef(displaySource);

    setUiState({
      eyebrow: 'Compra completada',
      title: 'Pedido confirmado',
      message: 'Tu pedido ha sido guardado correctamente. Te hemos enviado un correo de confirmación.',
    });

    if (referenceEl && displayRef) {
      const prefix = orderId ? 'Pedido' : 'Referencia';
      referenceEl.textContent = `${prefix}: ${displayRef}`;
      referenceEl.hidden = false;
    }
  };

  const renderPendingState = () => {
    setUiState({
      eyebrow: 'Pago recibido',
      title: 'Validando pedido…',
      message: 'Estamos confirmando tu compra con nuestro sistema. Esto puede tardar unos segundos.',
    });
  };

  const renderFallbackState = () => {
    setUiState({
      eyebrow: 'Pago en revisión',
      title: 'Estamos procesando tu pedido',
      message:
        'Stripe confirmó el pago, pero la confirmación del pedido aún no terminó. Recarga esta página en unos segundos o revisa “Mi cuenta”.',
    });
  };

  const initConfirmedCartCleanup = async () => {
    const redirectStatus = (params.get('redirect_status') || '').toLowerCase();
    if (redirectStatus && redirectStatus !== 'succeeded') return;

    if (!rawRef) {
      setUiState({
        eyebrow: 'Pago recibido',
        title: 'Procesando pedido',
        message: 'Falta la referencia del pago en la URL. Puedes revisar el estado desde tu cuenta.',
      });
      console.warn('[CRONOX] Success page sin referencia de pago: no se limpia carrito');
      return;
    }

    renderPendingState();

    try {
      const status = await waitForOrderProcessing(rawRef);
      if (status?.isProcessed) {
        renderConfirmedState(status);
        await syncCartUiWithBackend();
      } else {
        renderFallbackState();
        console.warn('[CRONOX] Timeout esperando confirmación del pedido. Reintentará al refrescar.');
      }
    } catch (error) {
      if (error?.message === 'AUTH_REQUIRED') {
        setUiState({
          eyebrow: 'Sesión requerida',
          title: 'No se pudo validar el pedido automáticamente',
          message: 'Inicia sesión para verificar el estado de tu pedido en “Mi cuenta”.',
        });
        console.warn('[CRONOX] Sesión no disponible para verificar el estado del pedido');
        return;
      }
      renderFallbackState();
      console.warn('[CRONOX] Error verificando el estado del pedido', error);
    }
  };

  initConfirmedCartCleanup();
})();
