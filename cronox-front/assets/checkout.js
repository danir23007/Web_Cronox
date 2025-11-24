(function () {
  const API = window.CRONOX_API || {};
  const API_BASE = API.API_BASE || '';
  const STRIPE_PUBLISHABLE_KEY =
    window.CRONOX_STRIPE_PUBLISHABLE_KEY || 'pk_test_xxx_replace_with_real_key';

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

  let stripe;
  let elements;
  let paymentElement;
  let paymentClientSecret;
  let isInitializing = false;

  const state = {
    cart: null,
    shippingMethods: [],
    shippingMethod: 'STANDARD',
  };

  const setPayButtonState = (loading) => {
    if (!payButton) return;
    payButton.disabled = loading || !paymentClientSecret;
    payButton.textContent = loading ? 'Procesando…' : 'Pagar ahora';
  };

  const renderEmptyCart = () => {
    if (!cartItemsEl || !emptyCartEl) return;
    cartItemsEl.innerHTML = '';
    emptyCartEl.hidden = false;
    setPayButtonState(true);
    if (helpText) {
      helpText.textContent = 'Añade productos al carrito para continuar.';
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
      const article = document.createElement('article');
      article.className = 'checkout-item';
      article.innerHTML = `
        <div class="checkout-item__media">
          <img src="${item.product?.image || 'assets/logo_banner.png'}" alt="${item.product?.name || ''}" loading="lazy">
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
        <span class="shipping-option__price ${method.amountCents === 0 ? 'is-free' : ''}">${
          method.priceLabel || formatMoney((method.amountCents || 0) / 100)
        }</span>
      `;
      shippingOptionsEl.appendChild(wrapper);
    });
  };

  const renderSummary = (summary, shippingMethod) => {
    if (!summary) return;
    subtotalEl && (subtotalEl.textContent = formatMoney(summary.subtotal));
    if (shippingEl) {
      const amount = shippingMethod?.amount ?? summary.shippingCost;
      shippingEl.textContent = shippingMethod
        ? `${shippingMethod.label} · ${formatMoney(amount)}`
        : formatMoney(amount);
    }
    totalEl && (totalEl.textContent = formatMoney(summary.total));
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
    setPayButtonState(true);
    errorDiv.textContent = '';

    const hasItems = Array.isArray(state.cart?.items) && state.cart.items.length > 0;
    if (!hasItems) {
      setPayButtonState(true);
      isInitializing = false;
      return;
    }

    if (!state.shippingMethod) {
      errorDiv.textContent = 'Selecciona un método de envío.';
      setPayButtonState(true);
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
      renderSummary(data.summary, data.shippingMethod);
      setPayButtonState(false);
    } catch (error) {
      errorDiv.textContent = error.message || 'Error preparando el pago.';
      setPayButtonState(true);
    } finally {
      isInitializing = false;
    }
  };

  const loadShippingMethods = async () => {
    try {
      const subtotalCents = Number(state.cart?.subtotalCents || 0);
      const methods = await API.getShippingMethods({ itemsTotalCents: subtotalCents });
      state.shippingMethods = Array.isArray(methods) ? methods : [];
      if (!state.shippingMethods.length) {
        state.shippingMethod = '';
        setPayButtonState(true);
        return;
      }
      const preferred = state.shippingMethods.find((m) => m.code === 'STANDARD') || state.shippingMethods[0];
      if (preferred) {
        state.shippingMethod = preferred.code;
      }
      renderShippingOptions();
    } catch (error) {
      console.warn('[CRONOX] No se pudieron cargar los métodos de envío', error);
    }
  };

  const initStripe = () => {
    if (!stripe && typeof Stripe === 'function') {
      stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    }
  };

  const syncCart = async () => {
    try {
      state.cart = await API.getCart();
      renderCart();
    } catch (error) {
      console.error('[CRONOX] No se pudo cargar el carrito', error);
      renderEmptyCart();
    }
  };

  const bindEvents = () => {
    shippingOptionsEl?.addEventListener('change', (event) => {
      const input = event.target.closest('input[name="shippingMethod"]');
      if (!input) return;
      state.shippingMethod = input.value;
      preparePaymentIntent();
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
    await syncCart();
    await loadShippingMethods();
    renderSummary({ subtotal: 0, shippingCost: 0, total: 0 });
    bindEvents();
    await preparePaymentIntent();
  });
})();
