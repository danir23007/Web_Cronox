(function () {
  const referenceEl = document.getElementById('checkout-success-reference');

  const params = new URLSearchParams(window.location.search);

  const STRIPE_PUBLISHABLE_KEY =
    window.CRONOX_STRIPE_PUBLISHABLE_KEY ||
    'pk_test_51SPoYpCGnUu9AYNraxWTDgTkSpqK4ikadITkNAExPeMgFiw7pX6AbyHh7UZHrRlL0G9A3zR6qwSVW8ALJTQtx2pw00WB7kkSyS';

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

  const clearConfirmedCart = async () => {
    const cart = window.CRONOX_CART || null;
    const api = window.CRONOX_API || null;

    try {
      if (cart?.clearCartItems) {
        const updatedCart = await cart.clearCartItems();
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: updatedCart }));
        clearGuestCartCache();
        return;
      }

      if (api?.clearCart) {
        const updatedCart = await api.clearCart();
        window.dispatchEvent(new CustomEvent('cart:updated', { detail: updatedCart }));
        clearGuestCartCache();
      }
    } catch (error) {
      console.warn('[CRONOX] No se pudo vaciar el carrito tras confirmar el pedido', error);
    }
  };

  const resolvePaymentIntentStatus = async () => {
    const clientSecret = params.get('payment_intent_client_secret');
    if (!clientSecret || typeof window.Stripe !== 'function') return null;

    try {
      const stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
      if (!stripe || typeof stripe.retrievePaymentIntent !== 'function') return null;
      const result = await stripe.retrievePaymentIntent(clientSecret);
      if (result?.error) {
        console.warn('[CRONOX] No se pudo verificar el estado del PaymentIntent', result.error);
        return null;
      }
      return result?.paymentIntent?.status || null;
    } catch (error) {
      console.warn('[CRONOX] Error consultando el estado del PaymentIntent', error);
      return null;
    }
  };

  const initConfirmedCartCleanup = async () => {
    const redirectStatus = (params.get('redirect_status') || '').toLowerCase();
    if (redirectStatus && redirectStatus !== 'succeeded') return;

    const paymentStatus = await resolvePaymentIntentStatus();
    if (paymentStatus === 'succeeded') {
      await clearConfirmedCart();
    }
  };

  initConfirmedCartCleanup();
})();
