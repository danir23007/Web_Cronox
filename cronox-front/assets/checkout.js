(function () {
  const API = window.CRONOX_API || {};
  const API_BASE = API.API_BASE || '';
  const STRIPE_PUBLISHABLE_KEY =
    window.CRONOX_STRIPE_PUBLISHABLE_KEY || 'pk_test_xxx_replace_with_real_key';
  const CONTINUE_SHOPPING_URL = '/index.html#store';

  const cartItemsEl = document.getElementById('checkout-cart-items');
  const emptyCartEl = document.querySelector('[data-empty]');
  const shippingOptionsEl = document.getElementById('shipping-options');
  const subtotalEl = document.getElementById('summary-subtotal');
  const shippingEl = document.getElementById('summary-shipping');
  const totalEl = document.getElementById('summary-total');
  const payButton = document.getElementById('pay-button');
  const errorDiv = document.getElementById('payment-error');
  const helpText = document.getElementById('checkout-help');

  const formatter = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  });

  const formatMoney = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return '—';
    return formatter.format(num);
  };

  const formatEuro = (cents) => {
    const amount = Number(cents) || 0;
    return (amount / 100).toFixed(2).replace('.', ',') + ' €';
  };

  let stripe;
  let elements;
  let paymentElement;
  let paymentClientSecret;
  let isInitializing = false;

  const state = {
    cart: null,
    shippingMethods: [],
    shippingMethod: 'STANDARD',
    totals: { subtotalCents: 0, shippingCents: 0, totalCents: 0 },
  };

  const setPayButtonState = (loading) => {
    if (!payButton) return;
    payButton.disabled = loading || !paymentClientSecret;
    payButton.textContent = loading ? 'Procesando…' : 'Pagar ahora';
  };

  const setLoadingState = (loading) => {
    if (!payButton) return;
    payButton.classList.toggle('is-loading', loading);
    setPayButtonState(loading);
  };

  const resetPaymentElement = () => {
    paymentClientSecret = null;
    if (paymentElement) {
      paymentElement.unmount();
      paymentElement = null;
    }
    elements = null;
    setPayButtonState(false);
  };

  const renderEmptyCart = (
    options = {
      title: 'Tu carrito está vacío',
      description: 'Añade productos a tu carrito antes de finalizar la compra.',
    },
  ) => {
    if (!cartItemsEl || !emptyCartEl) return;
    resetPaymentElement();
    cartItemsEl.innerHTML = '';
    if (shippingOptionsEl) shippingOptionsEl.innerHTML = '';

    const title = options.title || 'Tu carrito está vacío';
    const description =
      options.description || 'Añade productos a tu carrito antes de finalizar la compra.';

    emptyCartEl.innerHTML = `
      <h3>${title}</h3>
      <p>${description}</p>
      <button type="button" class="btn-primary" data-continue-shopping>Seguir comprando</button>
    `;
    emptyCartEl.hidden = false;

    const cta = emptyCartEl.querySelector('[data-continue-shopping]');
    if (cta) {
      cta.addEventListener('click', () => {
        window.location.href = CONTINUE_SHOPPING_URL;
      });
    }

    setPayButtonState(false);
    renderSummary({ subtotalCents: 0, shippingCents: 0, totalCents: 0 });
    if (helpText) {
      helpText.textContent = description;
    }
  };

  const renderCart = () => {
    if (!cartItemsEl || !emptyCartEl) return;
    const items = Array.isArray(state.cart?.items) ? state.cart.items : [];
    if (!items.length) {
      renderEmptyCart();
      return;
    }

    emptyCartEl.hidden = true;
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
      const imageUrl =
        item.imageUrl ||
        item.product?.imageUrl ||
        (Array.isArray(item.product?.images) ? item.product.images[0]?.url : '') ||
        item.product?.image ||
        'assets/logo_banner.png';
      const article = document.createElement('article');
      article.className = 'checkout-item';
      article.innerHTML = `
        <div class="checkout-item__media">
          <img src="${imageUrl}" alt="${item.product?.name || ''}" loading="lazy">
        </div>
        <div class="checkout-item__body">
          <h3 class="checkout-item__title">${item.product?.name || 'Producto CRONOX'}</h3>
          <p class="checkout-item__meta">${item.size ? `Talla ${String(item.size).toUpperCase()}` : ''} · Cant. ${item.qty}</p>
          <div class="checkout-item__price">${item.priceLabel || formatMoney((item.priceCents || 0) / 100)}</div>
        </div>
      `;
      frag.appendChild(article);
    });
    cartItemsEl.innerHTML = '';
    cartItemsEl.appendChild(frag);
  };

  const renderShippingOptions = () => {
    if (!shippingOptionsEl) return;
    shippingOptionsEl.innerHTML = '';

    state.shippingMethods.forEach((method) => {
      const priceCents = method.priceCents ?? method.amountCents ?? 0;
      const wrapper = document.createElement('label');
      wrapper.className = 'shipping-option';
      wrapper.innerHTML = `
        <input type="radio" name="shippingMethod" value="${method.code}" ${
          method.code === state.shippingMethod ? 'checked' : ''
        }>
        <div class="shipping-option__info">
          <span class="shipping-option__label">${method.label}</span>
          ${method.description ? `<small class="shipping-option__helper">${method.description}</small>` : ''}
        </div>
        <span class="shipping-option__price ${priceCents === 0 ? 'is-free' : ''}">${formatEuro(
          priceCents,
        )}</span>
      `;
      shippingOptionsEl.appendChild(wrapper);
    });
  };

  const renderSummary = (totals, shippingMethod) => {
    if (!totals) return;
    subtotalEl && (subtotalEl.textContent = formatEuro(totals.subtotalCents));
    if (shippingEl) {
      shippingEl.textContent = shippingMethod
        ? `${shippingMethod.label} · ${formatEuro(totals.shippingCents)}`
        : formatEuro(totals.shippingCents);
    }
    totalEl && (totalEl.textContent = formatEuro(totals.totalCents));
  };

  const findShippingMethod = (code) =>
    state.shippingMethods.find((method) => method.code === code) || null;

  const refreshCheckoutSummary = async (shippingMethodCode = state.shippingMethod) => {
    setLoadingState(true);
    errorDiv.textContent = '';
    try {
      const data = await API.getCheckoutSummary({ shippingMethod: shippingMethodCode });

      state.cart = data.cart;
      state.shippingMethods = Array.isArray(data.shippingMethods) ? data.shippingMethods : [];
      if (!state.shippingMethods.length) {
        state.shippingMethod = '';
        resetPaymentElement();
        setLoadingState(false);
        return false;
      }
      state.shippingMethod =
        data.selectedShippingMethod?.code ||
        shippingMethodCode ||
        state.shippingMethods[0]?.code ||
        '';
      state.totals = data.totals || state.totals;

      if (!state.cart?.items?.length) {
        renderEmptyCart();
        state.cart = { items: [] };
        state.totals = { subtotalCents: 0, shippingCents: 0, totalCents: 0 };
        setLoadingState(false);
        return false;
      }

      renderCart();
      renderShippingOptions();
      renderSummary(state.totals, findShippingMethod(state.shippingMethod));
      setLoadingState(false);
      return true;
    } catch (error) {
      console.error('[CRONOX] No se pudo cargar el resumen de checkout', error);
      resetPaymentElement();
      state.cart = { items: [] };
      state.totals = { subtotalCents: 0, shippingCents: 0, totalCents: 0 };

      const errorCode = error?.payload?.code || error?.code;
      if (errorCode === 'EMPTY_CART') {
        renderEmptyCart();
      } else {
        renderEmptyCart({
          title: 'No se pudo cargar el carrito',
          description: 'Vuelve a la tienda y añade productos para continuar con el pago.',
        });
      }

      setLoadingState(false);
      return false;
    }
  };

  const mountPaymentElement = (clientSecret) => {
    if (!stripe || !clientSecret) return;

    if (paymentElement) {
      paymentElement.unmount();
    }

    elements = stripe.elements({ clientSecret });
    paymentElement = elements.create('payment');
    paymentElement.mount('#payment-element');
  };

  const preparePaymentIntent = async () => {
    if (isInitializing) return;
    isInitializing = true;
    setLoadingState(true);
    errorDiv.textContent = '';

    const hasItems = Array.isArray(state.cart?.items) && state.cart.items.length > 0;
    if (!hasItems) {
      renderEmptyCart();
      setLoadingState(false);
      isInitializing = false;
      return;
    }

    if (!state.shippingMethod) {
      errorDiv.textContent = 'Selecciona un método de envío.';
      setLoadingState(false);
      isInitializing = false;
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/payments/create-payment-intent`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shippingMethod: state.shippingMethod }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || 'No se pudo preparar el pago.');
      }

      const data = await response.json();
      paymentClientSecret = data.clientSecret;
      mountPaymentElement(paymentClientSecret);
      state.shippingMethod = data.shippingMethod?.code || state.shippingMethod;
      state.totals = data.totals || state.totals;
      renderSummary(state.totals, findShippingMethod(state.shippingMethod) || data.shippingMethod);
      setLoadingState(false);
    } catch (error) {
      errorDiv.textContent = error.message || 'Error preparando el pago.';
      setLoadingState(false);
    } finally {
      isInitializing = false;
    }
  };

  const initStripe = () => {
    if (!stripe && typeof Stripe === 'function') {
      stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    }
  };

  const bindEvents = () => {
    shippingOptionsEl?.addEventListener('change', async (event) => {
      const input = event.target.closest('input[name="shippingMethod"]');
      if (!input) return;
      state.shippingMethod = input.value;
      await refreshCheckoutSummary(state.shippingMethod);
      await preparePaymentIntent();
    });

    payButton?.addEventListener('click', async () => {
      if (!stripe || !elements || !paymentClientSecret) return;
      setPayButtonState(true);
      errorDiv.textContent = '';

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success`,
        },
      });

      if (error) {
        errorDiv.textContent = error.message || 'Ha ocurrido un error al procesar el pago.';
        setPayButtonState(false);
      }
    });
  };

  document.addEventListener('DOMContentLoaded', async () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initStripe();
    bindEvents();
    const loaded = await refreshCheckoutSummary();
    if (loaded) {
      await preparePaymentIntent();
    } else {
      setLoadingState(false);
    }
  });
})();
