(function () {
  const API = window.CRONOX_API || {};
  const API_BASE = API.API_BASE || '';
  const STRIPE_PUBLISHABLE_KEY =
    window.CRONOX_STRIPE_PUBLISHABLE_KEY || 'pk_test_xxx_replace_with_real_key';
  const CONTINUE_SHOPPING_URL = '/index.html#store';
  const PROMO_STORAGE_KEY = 'cronox_checkout_promo';

  const cartItemsEl = document.getElementById('checkout-cart-items');
  const emptyCartEl = document.querySelector('[data-empty]');
  const shippingOptionsEl = document.getElementById('shipping-options');
  const subtotalEl = document.getElementById('summary-subtotal');
  const shippingEl = document.getElementById('summary-shipping');
  const discountEl = document.getElementById('summary-discount');
  const totalEl = document.getElementById('summary-total');
  const payButton = document.getElementById('pay-button');
  const errorDiv = document.getElementById('payment-error');
  const helpText = document.getElementById('checkout-help');
  const promoInput = document.getElementById('promo-code-input');
  const applyPromoBtn = document.getElementById('apply-promo-button');
  const removePromoBtn = document.getElementById('remove-promo-button');
  const promoStatus = document.getElementById('promo-status');
  const promoMessage = document.getElementById('promo-message');
  const promoAppliedLabel = document.getElementById('promo-applied-label');

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

  const readStoredPromo = () => {
    try {
      const raw = sessionStorage.getItem(PROMO_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.code) {
        return parsed;
      }
      return null;
    } catch (error) {
      console.warn('[CRONOX] No se pudo leer el código guardado', error);
      return null;
    }
  };

  const persistPromo = (promo) => {
    if (!promo || !promo.code) {
      sessionStorage.removeItem(PROMO_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      PROMO_STORAGE_KEY,
      JSON.stringify({ code: promo.code, discountCents: promo.discountCents ?? 0 }),
    );
  };

  const clearStoredPromo = () => {
    sessionStorage.removeItem(PROMO_STORAGE_KEY);
  };

  const setPromoState = (promo) => {
    state.promo = promo ? { code: promo.code, discountCents: promo.discountCents ?? 0 } : null;
    if (state.promo) {
      persistPromo(state.promo);
    } else {
      clearStoredPromo();
    }
  };

  const setPromoMessage = (message, isError = false) => {
    if (!promoMessage) return;
    promoMessage.textContent = message || '';
    promoMessage.classList.toggle('is-error', isError);
  };

  const setPromoStatus = (text) => {
    if (!promoStatus) return;
    promoStatus.textContent = text || '';
    promoStatus.hidden = !text;
  };

  const setPromoControlsLoading = (loading) => {
    if (applyPromoBtn) applyPromoBtn.disabled = loading;
    if (removePromoBtn) removePromoBtn.disabled = loading;
    if (promoInput) promoInput.disabled = loading && !!state.promo;
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
    totals: { subtotalCents: 0, shippingCents: 0, discountCents: 0, totalCents: 0 },
    promo: null,
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

    setPromoState(null);
    renderPromoUI();
    setPayButtonState(false);
    renderSummary({ subtotalCents: 0, shippingCents: 0, discountCents: 0, totalCents: 0 });
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
    const discountRow = discountEl?.closest('.summary-row');
    if (discountEl && discountRow) {
      if (totals.discountCents > 0) {
        discountEl.textContent = `- ${formatEuro(totals.discountCents)}`;
        discountRow.hidden = false;
      } else {
        discountEl.textContent = '';
        discountRow.hidden = true;
      }
    }
    totalEl && (totalEl.textContent = formatEuro(totals.totalCents));
  };

  const renderPromoUI = () => {
    const hasPromo = Boolean(state.promo?.code && state.totals.discountCents > 0);
    if (promoAppliedLabel) {
      promoAppliedLabel.textContent = hasPromo && state.promo?.code ? `Aplicado: ${state.promo.code}` : '';
      promoAppliedLabel.hidden = !hasPromo;
    }
    if (removePromoBtn) {
      removePromoBtn.hidden = !hasPromo;
    }
    if (applyPromoBtn) {
      applyPromoBtn.hidden = hasPromo;
    }
    if (promoInput) {
      if (!hasPromo && state.promo?.code) {
        promoInput.value = state.promo.code;
      }
      promoInput.disabled = hasPromo;
    }
    setPromoStatus(hasPromo ? 'Código aplicado' : '');
    if (!hasPromo && !state.promo) {
      setPromoMessage('');
    }
  };

  const findShippingMethod = (code) =>
    state.shippingMethods.find((method) => method.code === code) || null;

  const refreshCheckoutSummary = async (shippingMethodCode = state.shippingMethod) => {
    setLoadingState(true);
    errorDiv.textContent = '';
    try {
      const data = await API.getCheckoutSummary({
        shippingMethod: shippingMethodCode,
        promoCode: state.promo?.code,
      });

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

      const appliedPromo = data.appliedPromo;
      if (appliedPromo?.valid) {
        setPromoState({
          code: appliedPromo.code,
          discountCents: appliedPromo.discountCents,
        });
        setPromoStatus('Código aplicado');
        setPromoMessage(appliedPromo.message || '');
      } else if (state.promo?.code && state.promo.code !== appliedPromo?.code) {
        setPromoState(null);
        setPromoMessage(appliedPromo?.message || 'Código inválido o expirado', true);
      }

      if (!state.cart?.items?.length) {
        renderEmptyCart();
        state.cart = { items: [] };
        state.totals = { subtotalCents: 0, shippingCents: 0, discountCents: 0, totalCents: 0 };
        setLoadingState(false);
        return false;
      }

      renderCart();
      renderShippingOptions();
      renderSummary(state.totals, findShippingMethod(state.shippingMethod));
      renderPromoUI();
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
        body: JSON.stringify({
          shippingMethod: state.shippingMethod,
          promoCode: state.promo?.code || undefined,
        }),
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

  const applyPromoCode = async () => {
    if (!promoInput) return;
    const code = promoInput.value.trim();
    if (!code) {
      setPromoMessage('Introduce tu código de descuento.', true);
      return;
    }
    setPromoControlsLoading(true);
    setPromoMessage('');

    try {
      const result = await API.applyPromoCode({
        code,
        shippingMethod: state.shippingMethod,
      });

      state.totals = result.totals || state.totals;
      if (result.shippingMethod?.code) {
        state.shippingMethod = result.shippingMethod.code;
      }

      if (result.valid) {
        setPromoState({
          code: result.code || code,
          discountCents: result.discountAmount ?? result.totals?.discountCents ?? 0,
        });
        setPromoStatus('Código aplicado');
        setPromoMessage(result.message || 'Código aplicado');
      } else {
        setPromoState(null);
        setPromoStatus('');
        setPromoMessage(result.message || 'Código inválido o expirado', true);
      }

      renderSummary(state.totals, findShippingMethod(state.shippingMethod) || result.shippingMethod);
      renderPromoUI();
      await preparePaymentIntent();
    } catch (error) {
      console.error('[CRONOX] Error aplicando código', error);
      setPromoMessage(error?.message || 'No se pudo validar el código.', true);
    } finally {
      setPromoControlsLoading(false);
    }
  };

  const removePromoCode = async () => {
    if (promoInput) promoInput.value = '';
    setPromoState(null);
    setPromoStatus('');
    setPromoMessage('Código eliminado');
    renderPromoUI();
    await refreshCheckoutSummary(state.shippingMethod);
    await preparePaymentIntent();
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

    applyPromoBtn?.addEventListener('click', async (event) => {
      event.preventDefault();
      await applyPromoCode();
    });

    promoInput?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await applyPromoCode();
      }
    });

    removePromoBtn?.addEventListener('click', async (event) => {
      event.preventDefault();
      await removePromoCode();
    });
  };

  document.addEventListener('DOMContentLoaded', async () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    initStripe();
    bindEvents();
    const storedPromo = readStoredPromo();
    if (storedPromo) {
      setPromoState(storedPromo);
      renderPromoUI();
    }
    const loaded = await refreshCheckoutSummary();
    if (loaded) {
      await preparePaymentIntent();
    } else {
      setLoadingState(false);
    }
  });
})();
