(function () {
  const API = window.CRONOX_API || {};
  const API_BASE = API.API_BASE || '';
  const STRIPE_PUBLISHABLE_KEY = String(
    window.CRONOX_STRIPE_PUBLISHABLE_KEY || '',
  ).trim();
  const CONTINUE_SHOPPING_URL = '/index.html#store';
  const PROMO_STORAGE_KEY = 'cronox_checkout_promo';
  const escapeHtml = (value) => {
    const helper = window.CRONOX_SECURITY?.escapeHtml;
    return typeof helper === 'function'
      ? helper(value)
      : String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  };
  const safeProductImage = (value, fallback = 'assets/logo_banner.png') => {
    const helper = window.CRONOX_SECURITY?.productImageUrl;
    return typeof helper === 'function' ? helper(value, fallback) : fallback;
  };
  const getCsrfHeaders = async () => {
    const provider = window.CRONOX_API?.getCsrfHeaders;
    return typeof provider === 'function' ? provider() : {};
  };

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
  const paymentSection = document.getElementById('payment-section');
  const loginCallout = document.getElementById('checkout-login-callout');
  const loginCalloutLink = document.getElementById('checkout-login-link');
  const shippingForm = document.getElementById('shipping-form');
  const shippingFields = shippingForm
    ? {
        firstName: shippingForm.querySelector('input[name="firstName"]'),
        lastName: shippingForm.querySelector('input[name="lastName"]'),
        address: shippingForm.querySelector('input[name="address"]'),
        city: shippingForm.querySelector('input[name="city"]'),
        state: shippingForm.querySelector('input[name="state"]'),
        zip: shippingForm.querySelector('input[name="zip"]'),
        phone: shippingForm.querySelector('input[name="phone"]'),
      }
    : {};
  const userEditedShippingFields = new Set();

  const formatter = new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  });

  const appearance = {
    theme: 'night',
  };

  const formatMoney = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return '—';
    return formatter.format(num);
  };

  const formatEuro = (cents) => {
    const amount = Number(cents) || 0;
    return (amount / 100).toFixed(2).replace('.', ',') + ' €';
  };

  const sanitizePromoCode = (value) => (value || '').replace(/\s+/g, '').toUpperCase();

  const cleanText = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
  };

  const splitFullName = (fullName) => {
    const normalized = cleanText(fullName);
    if (!normalized) return { firstName: '', lastName: '' };
    const [first, ...rest] = normalized.split(/\s+/);
    return { firstName: first || '', lastName: rest.join(' ') };
  };

  const applyShippingValue = (input, value) => {
    if (!input) return;
    const nextValue = cleanText(value);
    if (!nextValue) return;
    if (input.name && userEditedShippingFields.has(input.name)) return;
    input.value = nextValue;
  };

  const hydrateShippingFormFromProfile = (profile = {}, address = {}) => {
    if (!shippingForm) return;
    const addressNameParts = splitFullName(address.name);
    const profileAddress = profile.address && typeof profile.address === 'object' ? profile.address : null;

    applyShippingValue(shippingFields.firstName, profile.firstName || addressNameParts.firstName);
    applyShippingValue(shippingFields.lastName, profile.lastName || addressNameParts.lastName);

    const addressLine =
      cleanText([address.line1, address.line2].filter(Boolean).join(' ')) ||
      cleanText([profileAddress?.line1, profileAddress?.line2].filter(Boolean).join(' ')) ||
      cleanText(profile.address || '');
    applyShippingValue(shippingFields.address, addressLine);
    applyShippingValue(shippingFields.city, address.city || profileAddress?.city || profile.city);
    applyShippingValue(shippingFields.state, address.state || profileAddress?.state || profile.state);
    applyShippingValue(shippingFields.zip, address.zip || profileAddress?.zip || profile.zip);
    applyShippingValue(shippingFields.phone, profile.phone || address.phone || profileAddress?.phone);
  };

  const markShippingFieldEdited = (input) => {
    if (input?.name) userEditedShippingFields.add(input.name);
  };

  let shippingIntentRefreshTimer = null;
  const schedulePaymentIntentRefreshFromShipping = (delayMs = 450) => {
    if (!state.isAuthenticated) return;
    const revision = invalidateCheckoutPayment();
    if (shippingIntentRefreshTimer) {
      window.clearTimeout(shippingIntentRefreshTimer);
    }
    shippingIntentRefreshTimer = window.setTimeout(async () => {
      shippingIntentRefreshTimer = null;
      await queueCheckoutUpdate({ revision, refreshSummary: false });
    }, delayMs);
  };

  const buildShippingAddressPayload = () => {
    if (!shippingForm) return undefined;
    const read = (input) => cleanText(input?.value || '');

    const firstName = read(shippingFields.firstName);
    const lastName = read(shippingFields.lastName);
    const line1 = read(shippingFields.address);
    const city = read(shippingFields.city);
    const state = read(shippingFields.state);
    const zip = read(shippingFields.zip);
    const phone = read(shippingFields.phone);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const payload = {
      firstName,
      lastName,
      name: fullName,
      fullName,
      line1,
      address: line1,
      city,
      state,
      zip,
      postalCode: zip,
      phone,
      country: 'España',
    };

    const hasAnyValue = Object.values(payload).some((value) => cleanText(value));
    if (!hasAnyValue) return undefined;

    return Object.fromEntries(Object.entries(payload).filter(([, value]) => cleanText(value)));
  };

  Object.values(shippingFields).forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      markShippingFieldEdited(input);
      schedulePaymentIntentRefreshFromShipping();
    });
    input.addEventListener('change', () => {
      markShippingFieldEdited(input);
      schedulePaymentIntentRefreshFromShipping(0);
    });
  });

  const readStoredPromo = () => {
    try {
      const raw = sessionStorage.getItem(PROMO_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.code) {
        return { ...parsed, code: sanitizePromoCode(parsed.code) };
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
      JSON.stringify({
        code: sanitizePromoCode(promo.code),
        discountCents: promo.discountCents ?? 0,
      }),
    );
  };

  const clearStoredPromo = () => {
    sessionStorage.removeItem(PROMO_STORAGE_KEY);
  };

  const setPromoState = (promo) => {
    state.promo = promo
      ? {
          code: sanitizePromoCode(promo.code),
          discountCents: promo.discountCents ?? 0,
        }
      : null;
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
    if (applyPromoBtn) {
      if (loading) {
        if (!applyPromoBtn.dataset.originalLabel) {
          applyPromoBtn.dataset.originalLabel = applyPromoBtn.textContent;
        }
        applyPromoBtn.textContent = 'Procesando…';
      } else if (applyPromoBtn.dataset.originalLabel) {
        applyPromoBtn.textContent = applyPromoBtn.dataset.originalLabel;
        delete applyPromoBtn.dataset.originalLabel;
      }
      applyPromoBtn.disabled = loading;
    }
    if (removePromoBtn) removePromoBtn.disabled = loading;
    if (promoInput) promoInput.disabled = loading && !!state.promo;
  };

  const showLoginCallout = () => {
    if (loginCallout) loginCallout.hidden = false;
  };

  const hideLoginCallout = () => {
    if (loginCallout) loginCallout.hidden = true;
  };

  const setGuestUiState = (enabled) => {
    const isGuest = Boolean(enabled);
    if (paymentSection) paymentSection.classList.toggle('is-disabled', isGuest);
    if (applyPromoBtn) applyPromoBtn.disabled = isGuest;
    if (removePromoBtn) removePromoBtn.disabled = isGuest && !state.promo;
    if (promoInput && !state.promo) {
      promoInput.disabled = isGuest;
    }
    setPayButtonState(false);
  };

  let stripe;
  let elements;
  let paymentElement;
  let currentClientSecret = null;
  let currentPaymentIntentId = null;
  let paymentElementMounted = false;
  let hasClearedPromoOnLoad = false;
  const checkoutCoordinator = window.CRONOX_CHECKOUT_LIFECYCLE?.createCoordinator();
  let checkoutRevision = checkoutCoordinator?.current() ?? 0;

  const state = {
    cart: null,
    shippingMethods: [],
    shippingMethod: 'STANDARD',
    totals: {
      subtotalCents: 0,
      shippingCents: 0,
      discountCents: 0,
      totalCents: 0,
    },
    promo: null,
    isAuthenticated: false,
  };

  let shippingDefaultsLoaded = false;
  let shippingDefaultsPromise = null;

  const resolveAuthStatus = async () => {
    if (window.CRONOX_USER) {
      state.isAuthenticated = true;
      return true;
    }

    if (typeof API.getMe !== 'function') {
      state.isAuthenticated = false;
      return false;
    }

    try {
      const me = await API.getMe();
      if (me) {
        window.CRONOX_USER = me;
        state.isAuthenticated = true;
        return true;
      }
    } catch (error) {
      console.warn('[CRONOX] No se pudo resolver la sesión', error);
    }

    state.isAuthenticated = false;
    return false;
  };

  const clearPromoInputOnLoad = () => {
    if (!promoInput || hasClearedPromoOnLoad) return;
    promoInput.value = '';
    promoInput.setAttribute('autocomplete', 'off');
    hasClearedPromoOnLoad = true;
  };

  const loadUserShippingDefaults = async () => {
    if (!state.isAuthenticated || !shippingForm) return null;
    if (shippingDefaultsPromise) return shippingDefaultsPromise;
    if (shippingDefaultsLoaded) return null;

    shippingDefaultsPromise = (async () => {
      try {
        const profile = window.CRONOX_USER || (typeof API.getMe === 'function' ? await API.getMe() : null);
        if (profile) window.CRONOX_USER = profile;

        let address = null;
        if (typeof API.getDefaultAddress === 'function') {
          try {
            address = await API.getDefaultAddress();
          } catch (error) {
            console.warn('[CRONOX] No se pudo cargar la dirección por defecto', error);
          }
        }

        hydrateShippingFormFromProfile(profile || {}, address || {});
      } catch (error) {
        console.warn('[CRONOX] No se pudieron cargar los datos de envío guardados', error);
      } finally {
        shippingDefaultsLoaded = true;
        shippingDefaultsPromise = null;
      }
    })();

    return shippingDefaultsPromise;
  };

  const setPayButtonState = (loading) => {
    if (!payButton) return;
    const guestMode = !state.isAuthenticated;
    const forcedLabel = payButton.dataset.forcedLabel;
    payButton.disabled = loading || !currentClientSecret || guestMode;
    if (forcedLabel) {
      payButton.textContent = forcedLabel;
      return;
    }
    payButton.textContent = guestMode ? 'Inicia sesión para pagar' : loading ? 'Procesando…' : 'Pagar ahora';
  };

  const setLoadingState = (loading) => {
    if (!payButton) return;
    payButton.classList.toggle('is-loading', loading);
    setPayButtonState(loading);
  };

  const resetPaymentElement = () => {
    currentClientSecret = null;
    currentPaymentIntentId = null;
    paymentElementMounted = false;
    if (paymentElement) {
      try {
        paymentElement.unmount();
      } catch (error) {
        console.warn('[CRONOX] Error desmontando Payment Element', error);
      }
    }
    paymentElement = null;
    elements = null;
    setPayButtonState(false);
  };

  const renderCartStatus = (options = {}) => {
    if (!cartItemsEl || !emptyCartEl) return;
    resetPaymentElement();
    cartItemsEl.innerHTML = '';
    if (shippingOptionsEl) shippingOptionsEl.innerHTML = '';

    const title = options.title || 'Tu carrito está vacío';
    const description = options.description || 'Añade productos a tu carrito antes de finalizar la compra.';
    const actionLabel = options.actionLabel || 'Seguir comprando';

    emptyCartEl.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <button type="button" class="btn-primary" data-cart-status-action>${escapeHtml(actionLabel)}</button>
    `;
    emptyCartEl.hidden = false;

    const cta = emptyCartEl.querySelector('[data-cart-status-action]');
    if (cta) {
      cta.addEventListener(
        'click',
        typeof options.onAction === 'function'
          ? options.onAction
          : () => {
              window.location.href = CONTINUE_SHOPPING_URL;
            },
      );
    }

    setPromoState(null);
    renderPromoUI();
    setPayButtonState(false);
    renderSummary({
      subtotalCents: 0,
      shippingCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
    if (helpText) {
      helpText.textContent = description;
    }
  };

  const renderEmptyCart = (
    options = {
      title: 'Tu carrito está vacío',
      description: 'Añade productos a tu carrito antes de finalizar la compra.',
    },
  ) => renderCartStatus(options);

  const classifyCheckoutError = (error) => {
    const classification =
      typeof API.classifyApiError === 'function' ? API.classifyApiError(error) : { kind: 'unknown', isRetryable: true };
    const status = Number(error?.status || error?.statusCode || 0);
    const payloadMessage = cleanText(error?.payload?.message);
    const messageCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(payloadMessage) ? payloadMessage : '';
    const code = cleanText(error?.payload?.code || error?.code || messageCode) || 'UNKNOWN';
    let endpoint = '/api/checkout/summary';

    try {
      endpoint = new URL(error?.endpoint || endpoint, window.location.origin).pathname;
    } catch {
      // Keep the known endpoint; never log raw URLs or query values.
    }

    return {
      kind: classification.kind || 'unknown',
      isRetryable: classification.isRetryable !== false,
      status,
      code,
      endpoint,
    };
  };

  const renderCheckoutLoadError = (details) => {
    const retry = async () => {
      await queueCheckoutUpdate();
    };
    const options = {
      title: 'No pudimos cargar tu carrito',
      description: 'Ha ocurrido un problema. Reinténtalo en unos instantes.',
      actionLabel: 'Reintentar',
      onAction: retry,
    };

    if (details.kind === 'auth') {
      options.title = 'Tu sesión ya no es válida';
      options.description = 'Vuelve a iniciar sesión y reintenta el checkout.';
      options.actionLabel = 'Recargar';
      options.onAction = () => window.location.reload();
    } else if (details.kind === 'validation') {
      options.title = 'No pudimos validar el carrito';
      options.description = 'Revisa el carrito o reinténtalo antes de continuar con el pago.';
    } else if (details.kind === 'network') {
      options.title = 'No pudimos conectar con el servidor';
      options.description = 'Comprueba tu conexión y vuelve a intentarlo.';
    } else if (details.kind === 'server') {
      options.description = 'El servidor no pudo cargarlo. Reinténtalo en unos instantes.';
    }

    renderCartStatus(options);
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
      const imageUrl = safeProductImage(
        item.imageUrl ||
          item.product?.imageUrl ||
          (Array.isArray(item.product?.images) ? item.product.images[0]?.url : '') ||
          item.product?.image,
      );
      const qty = Math.max(1, Math.min(999, Number(item.qty) || 1));
      const productName = escapeHtml(item.product?.name || 'Producto CRONOX');
      const size = item.size ? escapeHtml(String(item.size).toUpperCase()) : '';
      const priceLabel = escapeHtml(item.priceLabel || formatMoney((item.priceCents || 0) / 100));
      const article = document.createElement('article');
      article.className = 'checkout-item';
      article.innerHTML = `
        <div class="checkout-item__media">
          <img src="${escapeHtml(imageUrl)}" alt="${productName}" loading="lazy" referrerpolicy="no-referrer">
        </div>
        <div class="checkout-item__body">
          <h3 class="checkout-item__title">${productName}</h3>
          <p class="checkout-item__meta">${size ? `Talla ${size}` : ''} · Cant. ${qty}</p>
          <div class="checkout-item__price">${priceLabel}</div>
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
      const priceCents = method.amountCents ?? method.priceCents ?? 0;
      const checked = String(method.code ?? '') === String(state.shippingMethod ?? '');
      method = {
        ...method,
        code: escapeHtml(method.code ?? ''),
        label: escapeHtml(method.label ?? ''),
        description: method.description ? escapeHtml(method.description) : '',
      };
      const wrapper = document.createElement('label');
      wrapper.className = 'shipping-option';
      wrapper.innerHTML = `
        <input type="radio" name="shippingMethod" value="${method.code}" ${checked ? 'checked' : ''}>
        <div class="shipping-option__info">
          <span class="shipping-option__label">${method.label}</span>
          ${method.description ? `<small class="shipping-option__helper">${method.description}</small>` : ''}
        </div>
        <span class="shipping-option__price ${priceCents === 0 ? 'is-free' : ''}">${formatEuro(priceCents)}</span>
      `;
      shippingOptionsEl.appendChild(wrapper);
    });
  };

  const renderGuestShippingOptions = () => {
    if (!shippingOptionsEl) return;
    shippingOptionsEl.innerHTML =
      '<p class="checkout-guest-note">Inicia sesión para ver y seleccionar métodos de envío.</p>';
  };

  const renderSummary = (totals, shippingMethod) => {
    if (!totals) return;
    subtotalEl && (subtotalEl.textContent = formatEuro(totals.subtotalCents));
    if (shippingEl) {
      if (shippingMethod && shippingMethod.code === 'GUEST') {
        shippingEl.textContent = shippingMethod.label || 'Inicia sesión para calcular el envío';
      } else {
        shippingEl.textContent = shippingMethod
          ? `${shippingMethod.label} · ${formatEuro(totals.shippingCents)}`
          : formatEuro(totals.shippingCents);
      }
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
      clearPromoInputOnLoad();
      if (!hasPromo && state.promo?.code && !hasClearedPromoOnLoad) {
        promoInput.value = state.promo.code;
      }
      promoInput.disabled = hasPromo;
    }
    setPromoStatus(hasPromo ? 'Código aplicado' : '');
    if (!hasPromo && !state.promo) {
      setPromoMessage('');
    }
  };

  const renderGuestCheckout = async () => {
    setLoadingState(true);
    resetPaymentElement();
    setPromoState(null);
    setPromoMessage('');
    setPromoStatus('');
    showLoginCallout();
    setGuestUiState(true);

    try {
      const guestCart = typeof API.getCart === 'function' ? await API.getCart() : null;
      state.cart = guestCart;
      const totals = {
        subtotalCents: Number(guestCart?.subtotalCents ?? 0),
        shippingCents: 0,
        discountCents: 0,
        totalCents: Number(guestCart?.subtotalCents ?? 0),
      };
      state.totals = totals;

      if (!state.cart?.items?.length) {
        renderEmptyCart({
          title: 'Tu cesta está vacía',
          description: 'Añade productos a tu carrito y luego inicia sesión para pagarlos.',
        });
      } else {
        renderCart();
        emptyCartEl && (emptyCartEl.hidden = true);
      }

      renderGuestShippingOptions();
      renderSummary(totals, {
        label: 'Elige envío tras iniciar sesión',
        code: 'GUEST',
      });
      renderPromoUI();
      if (helpText) {
        helpText.textContent = 'Inicia sesión para continuar con tu compra.';
      }
    } catch (error) {
      const details = classifyCheckoutError(error);
      console.warn('[CRONOX checkout guest cart]', {
        event: 'checkout_guest_cart_load_failed',
        ...details,
      });
      renderCheckoutLoadError(details);
    } finally {
      setLoadingState(false);
    }
  };

  const findShippingMethod = (code) => state.shippingMethods.find((method) => method.code === code) || null;

  const refreshCheckoutSummary = async (
    shippingMethodCode = state.shippingMethod,
    revision = checkoutRevision,
  ) => {
    if (!state.isAuthenticated) {
      await renderGuestCheckout();
      return false;
    }

    setLoadingState(true);
    errorDiv.textContent = '';
    try {
      const data = await API.getCheckoutSummary({
        shippingMethod: shippingMethodCode,
        promoCode: state.promo?.code,
      });

      if (revision !== checkoutRevision) return false;

      state.cart = data.cart;
      state.shippingMethods = Array.isArray(data.shippingMethods) ? data.shippingMethods : [];
      if (!state.shippingMethods.length) {
        state.shippingMethod = '';
        resetPaymentElement();
        setLoadingState(false);
        return false;
      }
      state.shippingMethod =
        data.selectedShippingMethod?.code || shippingMethodCode || state.shippingMethods[0]?.code || '';
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
        state.totals = {
          subtotalCents: 0,
          shippingCents: 0,
          discountCents: 0,
          totalCents: 0,
        };
        setLoadingState(false);
        return false;
      }

      renderCart();
      renderShippingOptions();
      renderSummary(state.totals, findShippingMethod(state.shippingMethod));
      renderPromoUI();
      hideLoginCallout();
      setGuestUiState(false);
      setLoadingState(false);
      return true;
    } catch (error) {
      if (revision !== checkoutRevision) return false;
      const details = classifyCheckoutError(error);
      console.error('[CRONOX checkout summary]', {
        event: 'checkout_summary_load_failed',
        ...details,
      });
      resetPaymentElement();
      state.cart = null;
      state.totals = {
        subtotalCents: 0,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 0,
      };

      if (details.code === 'EMPTY_CART') {
        renderEmptyCart();
      } else {
        renderCheckoutLoadError(details);
      }

      setLoadingState(false);
      return false;
    }
  };

  const ensurePaymentElement = async (clientSecret) => {
    if (!clientSecret || !stripe) return;

    if (currentClientSecret === clientSecret && paymentElementMounted) {
      return;
    }

    if (paymentElement) {
      try {
        paymentElement.unmount();
      } catch (error) {
        console.warn('[CRONOX] Error desmontando Payment Element previo', error);
      }
    }
    paymentElementMounted = false;

    elements = stripe.elements({ clientSecret, appearance });
    paymentElement = elements.create('payment');
    const container = document.getElementById('payment-element');
    if (container) {
      paymentElement.mount(container);
      paymentElementMounted = true;
      currentClientSecret = clientSecret;
      setPayButtonState(false);
    }
  };

  const getPaymentPreparationMessage = (details) => {
    if (details.code === 'CHECKOUT_PAYMENT_CONFIRMATION_PENDING') {
      return 'Ya existe un pago anterior que se está confirmando. No vuelvas a pagar; actualizaremos el pedido automáticamente.';
    }
    if (details.code === 'CHECKOUT_REPLACEMENT_IN_PROGRESS') {
      return 'Estamos actualizando el pago con los nuevos datos. Inténtalo de nuevo en un momento.';
    }
    if (
      details.code === 'STRIPE_PAYMENT_INTENT_NOT_CANCELLABLE' ||
      details.code === 'STRIPE_PAYMENT_INTENT_NOT_REUSABLE'
    ) {
      return 'Este pago ya se está procesando. Espera la confirmación antes de volver a intentarlo.';
    }
    if (details.kind === 'auth') {
      return 'Tu sesión ha caducado. Inicia sesión de nuevo para continuar.';
    }
    if (details.kind === 'network') {
      return 'No pudimos conectar con el servidor de pagos. Comprueba tu conexión y reinténtalo.';
    }
    if (details.kind === 'validation') {
      return 'No pudimos validar los datos actuales del checkout. Revísalos y vuelve a intentarlo.';
    }
    return 'No se pudo actualizar el pago. Inténtalo de nuevo en unos instantes.';
  };

  const synchronizeCanonicalCart = async () => {
    const cartController = window.CRONOX_CART || null;
    if (typeof cartController?.fetchCart === 'function') {
      const cart = await cartController.fetchCart();
      if (
        cartController.state?.drawerOpen &&
        typeof cartController.renderCartDrawer === 'function'
      ) {
        cartController.renderCartDrawer(cart);
      }
      return cart;
    }
    if (typeof API.getCart === 'function') {
      const cart = await API.getCart();
      window.dispatchEvent(new CustomEvent('cart:updated', { detail: cart }));
      return cart;
    }
    return null;
  };

  const waitForPreviousPaymentConfirmation = async (revision) => {
    const poll = window.CRONOX_CHECKOUT_LIFECYCLE?.pollUntilProcessed;
    if (typeof poll !== 'function') return;

    try {
      const result = await poll({
        shouldContinue: () => revision === checkoutRevision,
        fetchStatus: async () => {
          const response = await fetch(
            `${API_BASE}/api/orders/current-checkout-payment-status`,
            {
              method: 'GET',
              credentials: 'include',
              headers: { Accept: 'application/json' },
            },
          );
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            const statusError = new Error(
              payload?.message || 'No se pudo consultar el estado del pedido.',
            );
            statusError.status = response.status;
            statusError.payload = payload;
            throw statusError;
          }
          return payload;
        },
        onProcessed: async (status) => {
          if (revision !== checkoutRevision) return;
          await synchronizeCanonicalCart();
          if (revision !== checkoutRevision) return;
          const orderId = Number(status?.orderId);
          if (Number.isSafeInteger(orderId) && orderId > 0) {
            window.location.assign(
              `/checkout-success.html?orderId=${encodeURIComponent(orderId)}`,
            );
          }
        },
      });
      if (revision !== checkoutRevision || result.outcome === 'processed') return;
      errorDiv.textContent =
        'El pago anterior sigue pendiente de confirmación. No vuelvas a pagar; mantén esta página abierta o recárgala en unos segundos.';
    } catch (error) {
      if (revision !== checkoutRevision) return;
      const details = classifyCheckoutError(error);
      console.warn('[CRONOX checkout payment confirmation]', {
        event: 'checkout_payment_confirmation_poll_failed',
        revision,
        ...details,
      });
      errorDiv.textContent =
        'No pudimos comprobar todavía el pago anterior. No vuelvas a pagar; recarga la página en unos segundos.';
    }
  };

  const preparePaymentIntent = async (revision = checkoutRevision) => {
    if (!state.isAuthenticated) return;
    if (revision !== checkoutRevision) return false;
    setLoadingState(true);
    errorDiv.textContent = '';

    try {
      const hasItems = Array.isArray(state.cart?.items) && state.cart.items.length > 0;
      if (!hasItems) {
        renderEmptyCart();
        return;
      }

      if (!state.shippingMethod) {
        errorDiv.textContent = 'Selecciona un método de envío.';
        return;
      }

      if (!ensureStripeReady()) {
        return false;
      }

      const requestedShippingMethod = state.shippingMethod;
      const requestedPromoCode = state.promo?.code || undefined;
      const requestedShippingAddress = buildShippingAddressPayload();

      const response = await fetch(`${API_BASE}/api/payments/create-payment-intent`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(await getCsrfHeaders()),
        },
        body: JSON.stringify({
          shippingMethod: requestedShippingMethod,
          promoCode: requestedPromoCode,
          shippingAddress: requestedShippingAddress,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (revision !== checkoutRevision) return false;
      if (!response.ok) {
        const requestError = new Error(payload?.message || 'No se pudo preparar el pago.');
        requestError.status = response.status;
        requestError.payload = payload;
        requestError.endpoint = '/api/payments/create-payment-intent';
        throw requestError;
      }

      const data = payload;
      const nextClientSecret = typeof data.clientSecret === 'string' ? data.clientSecret : null;
      const nextPaymentIntentId = typeof data.paymentIntentId === 'string' ? data.paymentIntentId : null;

      if (!nextClientSecret || !nextPaymentIntentId) {
        throw new Error('No se recibió un client secret válido para el pago.');
      }
      if (data.shippingMethod?.code !== requestedShippingMethod) {
        throw new Error('CHECKOUT_SHIPPING_METHOD_MISMATCH');
      }
      if (revision !== checkoutRevision) return false;

      currentPaymentIntentId = nextPaymentIntentId;
      state.shippingMethod = requestedShippingMethod;
      state.totals = data.totals || state.totals;
      await ensurePaymentElement(nextClientSecret);
      renderSummary(state.totals, findShippingMethod(state.shippingMethod) || data.shippingMethod);
      errorDiv.textContent = '';
      return true;
    } catch (error) {
      if (revision !== checkoutRevision) return false;
      const details = classifyCheckoutError(error);
      console.error('[CRONOX checkout payment intent]', {
        event: 'checkout_payment_intent_update_failed',
        revision,
        shippingMethod: state.shippingMethod,
        ...details,
      });
      resetPaymentElement();
      errorDiv.textContent = getPaymentPreparationMessage(details);
      if (details.code === 'CHECKOUT_PAYMENT_CONFIRMATION_PENDING') {
        void waitForPreviousPaymentConfirmation(revision);
      }
      return false;
    } finally {
      if (revision === checkoutRevision) setLoadingState(false);
    }
  };

  const invalidateCheckoutPayment = () => {
    checkoutRevision = checkoutCoordinator?.invalidate() ?? checkoutRevision + 1;
    resetPaymentElement();
    errorDiv.textContent = '';
    return checkoutRevision;
  };

  const queueCheckoutUpdate = ({
    revision = invalidateCheckoutPayment(),
    refreshSummary = true,
  } = {}) => {
    const requestedShippingMethod = state.shippingMethod;
    const run = async () => {
      if (revision !== checkoutRevision) return false;
      if (refreshSummary) {
        const loaded = await refreshCheckoutSummary(
          requestedShippingMethod,
          revision,
        );
        if (!loaded || revision !== checkoutRevision) return false;
      }
      return preparePaymentIntent(revision);
    };

    return checkoutCoordinator?.enqueue(revision, run) ?? run();
  };

  const applyPromoCode = async () => {
    if (!promoInput) return;
    if (!state.isAuthenticated) {
      setPromoMessage('Inicia sesión para aplicar un código de descuento.', true);
      showLoginCallout();
      return;
    }
    const code = sanitizePromoCode(promoInput.value);
    promoInput.value = code;
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
      await queueCheckoutUpdate();
    } catch (error) {
      console.error('[CRONOX] Error aplicando código', error);
      if (error?.status === 400 && error?.payload?.message) {
        setPromoState(null);
        setPromoStatus('');
        setPromoMessage(error.payload.message, true);
        renderPromoUI();
        await queueCheckoutUpdate();
      } else {
        setPromoMessage('No se pudo validar el código. Inténtalo de nuevo.', true);
      }
    } finally {
      setPromoControlsLoading(false);
    }
  };

  const removePromoCode = async () => {
    if (promoInput) promoInput.value = '';
    setPromoState(null);
    setPromoStatus('');
    setPromoMessage('');
    renderPromoUI();
    await queueCheckoutUpdate();
  };

  const initStripe = () => {
    if (!STRIPE_PUBLISHABLE_KEY) {
      throw new Error('STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED');
    }
    if (!stripe && typeof Stripe === 'function') {
      stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    }
  };

  const ensureStripeReady = () => {
    try {
      initStripe();
    } catch (error) {
      console.error('[CRONOX] No se pudo inicializar Stripe', error);
    }

    if (!stripe) {
      errorDiv.textContent = STRIPE_PUBLISHABLE_KEY
        ? 'No se pudo inicializar el pago. Refresca la página e inténtalo de nuevo.'
        : 'El pago no está configurado en este entorno. Contacta con soporte antes de continuar.';
      currentClientSecret = null;
      resetPaymentElement();
      if (payButton) {
        payButton.disabled = true;
        payButton.dataset.forcedLabel = 'Pago no disponible';
        payButton.textContent = 'Pago no disponible';
      }
      return false;
    }

    if (payButton && payButton.dataset.forcedLabel) {
      delete payButton.dataset.forcedLabel;
      setPayButtonState(false);
    }

    return true;
  };

  const bindEvents = () => {
    const sanitizePromoInputValue = () => {
      if (!promoInput) return '';
      const cleaned = sanitizePromoCode(promoInput.value);
      promoInput.value = cleaned;
      return cleaned;
    };

    loginCalloutLink?.addEventListener('click', (event) => {
      event.preventDefault();
      if (typeof window.CRONOX_openAuthModal === 'function') {
        window.CRONOX_openAuthModal('login');
      } else {
        window.location.href = '/index.html#store';
      }
    });

    shippingOptionsEl?.addEventListener('change', async (event) => {
      const input = event.target.closest('input[name="shippingMethod"]');
      if (!input) return;
      state.shippingMethod = input.value;
      await queueCheckoutUpdate();
    });

    payButton?.addEventListener('click', async () => {
      if (!state.isAuthenticated) {
        errorDiv.textContent = 'Inicia sesión para pagar tu pedido.';
        showLoginCallout();
        return;
      }
      if (!stripe || !elements || !paymentElement || !currentClientSecret) {
        errorDiv.textContent = 'No se pudo iniciar el pago. Refresca la página e inténtalo de nuevo.';
        return;
      }
      setPayButtonState(true);
      errorDiv.textContent = '';

      const successUrl = new URL('/checkout-success.html', window.location.origin);
      if (currentPaymentIntentId) {
        successUrl.searchParams.set('ref', currentPaymentIntentId);
      }

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: successUrl.toString(),
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
      if (event.key === ' ') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        sanitizePromoInputValue();
        await applyPromoCode();
      }
    });

    promoInput?.addEventListener('input', () => {
      sanitizePromoInputValue();
      setPromoMessage('');
      setPromoStatus('');
    });

    promoInput?.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text') || '';
      promoInput.value = sanitizePromoCode(text);
      setPromoMessage('');
      setPromoStatus('');
    });

    promoInput?.addEventListener('blur', () => {
      sanitizePromoInputValue();
    });

    removePromoBtn?.addEventListener('click', async (event) => {
      event.preventDefault();
      await removePromoCode();
    });
  };

  window.addEventListener('cronox:userChanged', async (ev) => {
    const user = ev?.detail;
    state.isAuthenticated = Boolean(user);
    if (state.isAuthenticated) {
      if (user) window.CRONOX_USER = user;
      shippingDefaultsLoaded = false;
      await loadUserShippingDefaults();
      hideLoginCallout();
      setGuestUiState(false);
      const stripeReady = ensureStripeReady();
      if (stripeReady && currentClientSecret && !paymentElementMounted) {
        await ensurePaymentElement(currentClientSecret);
      }
      if (stripeReady) await queueCheckoutUpdate();
    } else {
      shippingDefaultsLoaded = false;
      shippingDefaultsPromise = null;
      await renderGuestCheckout();
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const yearEl = document.getElementById('anio');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    clearPromoInputOnLoad();
    clearStoredPromo();
    setPromoState(null);
    renderPromoUI();
    bindEvents();
    await resolveAuthStatus();
    if (!state.isAuthenticated) {
      await renderGuestCheckout();
      return;
    }

    await loadUserShippingDefaults();
    ensureStripeReady();
    await queueCheckoutUpdate();
  });
})();
