(function () {
  const API = window.CRONOX_API || {};
  const Country = window.CRONOX_COUNTRY || {};
  const SPAIN = Country.SPAIN || 'España';
  const normalizeCountry = (value) => Country.normalizeCountry?.(value) || null;
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
  const taxNoteEl = document.getElementById('summary-tax-note');
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
  const expressCheckoutRegion = document.getElementById('express-checkout-region');
  const expressCheckoutContainer = document.getElementById('express-checkout-element');
  const loginCallout = document.getElementById('checkout-login-callout');
  const loginCalloutLink = document.getElementById('checkout-login-link');
  const loginHeaderLink = document.getElementById('checkout-login-header-link');
  const guestContact = document.getElementById('checkout-guest-contact');
  const guestEmailInput = document.getElementById('checkout-guest-email');
  const newsletterConsent = document.getElementById('checkout-newsletter-consent');
  const customerContact = document.getElementById('checkout-customer');
  const customerInitialEl = document.getElementById('checkout-customer-initial');
  const customerEmailEl = document.getElementById('checkout-customer-email');
  const accountMenuButton = document.getElementById('checkout-account-menu-button');
  const accountMenu = document.getElementById('checkout-account-menu');
  const logoutButton = document.getElementById('checkout-logout-button');
  const addressDetails = document.getElementById('address-details');
  const addressSummaryEl = document.getElementById('address-summary');
  const addressLoadingEl = document.getElementById('address-loading');
  const defaultAddressCard = document.getElementById('default-address-card');
  const savedAddressSelectButton = document.getElementById('saved-address-select-button');
  const defaultAddressNameEl = document.getElementById('default-address-name');
  const defaultAddressLinesEl = document.getElementById('default-address-lines');
  const differentAddressButton = document.getElementById('different-address-button');
  const addressMenuButton = document.getElementById('address-menu-button');
  const addressMenu = document.getElementById('address-menu');
  const editAddressButton = document.getElementById('edit-address-button');
  const shippingMethodSummaryEl = document.getElementById('shipping-method-summary');
  const recommendationsSection = document.getElementById('checkout-recommendations');
  const recommendationsList = document.getElementById('recommendations-list');
  const recommendationsStatus = document.getElementById('recommendations-status');
  const shippingForm = document.getElementById('shipping-form');
  const addressModal = document.getElementById('address-modal');
  const addressEditForm = document.getElementById('address-edit-form');
  const addressModalClose = document.getElementById('address-modal-close');
  const addressModalCancel = document.getElementById('address-modal-cancel');
  const addressModalSave = document.getElementById('address-modal-save');
  const addressModalError = document.getElementById('address-modal-error');
  const shippingFields = shippingForm
    ? {
        firstName: shippingForm.querySelector('input[name="firstName"]'),
        lastName: shippingForm.querySelector('input[name="lastName"]'),
        country: shippingForm.querySelector('[name="country"]'),
        address: shippingForm.querySelector('input[name="address"]'),
        addressLine2: shippingForm.querySelector('input[name="addressLine2"]'),
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
    variables: {
      colorPrimary: '#ffffff',
      colorBackground: '#080808',
      colorText: '#f5f5f3',
      colorTextSecondary: '#a4a4a0',
      colorDanger: '#ff8c8c',
      borderRadius: '0px',
      spacingUnit: '4px',
      fontSizeBase: '14px',
    },
    rules: {
      '.Input': {
        border: '1px solid #3a3a3a',
        boxShadow: 'none',
        padding: '12px',
      },
      '.Input:focus': {
        border: '1px solid #ffffff',
        boxShadow: '0 0 0 1px #ffffff',
      },
      '.Label': {
        color: '#d0d0cc',
        fontSize: '12px',
        fontWeight: '600',
      },
      '.AccordionItem': {
        border: '1px solid #303030',
        boxShadow: 'none',
      },
      '.AccordionItem--selected': {
        borderColor: '#ffffff',
      },
    },
  };

  const paymentElementOptions = {
    layout: {
      type: 'accordion',
      defaultCollapsed: false,
      radios: true,
      spacedAccordionItems: false,
      visibleAccordionItemsCount: 3,
    },
    paymentMethodOrder: ['card', 'klarna', 'amazon_pay', 'paypal'],
    wallets: {
      applePay: 'auto',
      googlePay: 'never',
    },
  };

  const expressCheckoutOptions = {
    buttonHeight: 48,
    buttonType: {
      paypal: 'paypal',
      googlePay: 'checkout',
    },
    buttonTheme: {
      paypal: 'gold',
      googlePay: 'white',
    },
    layout: {
      maxColumns: 2,
      maxRows: 1,
      overflow: 'auto',
    },
    paymentMethodOrder: ['paypal', 'google_pay'],
    paymentMethods: {
      applePay: 'never',
      googlePay: 'auto',
      amazonPay: 'never',
      klarna: 'never',
      link: 'never',
      paypal: 'auto',
    },
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

  const formatShippingPrice = (cents) => {
    const amount = Number(cents);
    return Number.isFinite(amount) && amount === 0 ? 'GRATIS' : formatEuro(cents);
  };

  const sanitizePromoCode = (value) => (value || '').replace(/\s+/g, '').toUpperCase();

  const cleanText = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return '';
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
    const getDefaults =
      window.CRONOX_CHECKOUT_LIFECYCLE?.getShippingDefaultValues;
    if (typeof getDefaults !== 'function') return;
    const defaults = getDefaults({ profile, address });

    Object.entries(defaults).forEach(([field, value]) => {
      applyShippingValue(shippingFields[field], value);
    });
  };

  let activeProfile = null;
  let savedDefaultAddress = null;
  let newsletterSubmittedFor = '';

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText(value));
  const getCheckoutEmail = () =>
    state.isAuthenticated
      ? cleanText(activeProfile?.email || window.CRONOX_USER?.email)
      : cleanText(guestEmailInput?.value).toLowerCase();

  const hasCompleteShippingAddress = () =>
    Boolean(
      cleanText(shippingFields.firstName?.value) &&
        cleanText(shippingFields.lastName?.value) &&
        cleanText(shippingFields.address?.value) &&
        cleanText(shippingFields.zip?.value) &&
        cleanText(shippingFields.city?.value) &&
        cleanText(shippingFields.country?.value),
    );

  const isCheckoutContactAndShippingReady = () =>
    (state.isAuthenticated || isValidEmail(getCheckoutEmail())) &&
    hasCompleteShippingAddress();

  const renderCustomerContact = (profile) => {
    activeProfile = profile || null;
    const email = cleanText(profile?.email);
    const displayName = cleanText(profile?.firstName || profile?.name || email);
    if (customerEmailEl) {
      customerEmailEl.textContent = email || 'Identifica tu cuenta para continuar';
    }
    if (customerInitialEl) {
      customerInitialEl.textContent = (displayName.charAt(0) || 'C').toUpperCase();
    }
    const authenticated = Boolean(profile && email);
    if (customerContact) customerContact.hidden = !authenticated;
    if (guestContact) guestContact.hidden = authenticated;
    if (loginHeaderLink) loginHeaderLink.hidden = authenticated;
  };

  const getAddressDisplay = (address = {}) => {
    const name = cleanText(address.name) ||
      [cleanText(address.firstName), cleanText(address.lastName)].filter(Boolean).join(' ');
    const lines = [
      cleanText(address.line1 || address.address),
      cleanText(address.line2 || address.addressLine2),
      [cleanText(address.zip || address.postalCode), cleanText(address.city)].filter(Boolean).join(' '),
      cleanText(address.state),
      normalizeCountry(address.country) || cleanText(address.country),
      cleanText(address.phone),
    ].filter(Boolean);
    return { name, lines };
  };

  const getCurrentAddressDisplay = () =>
    getAddressDisplay({
      firstName: shippingFields.firstName?.value,
      lastName: shippingFields.lastName?.value,
      line1: shippingFields.address?.value,
      line2: shippingFields.addressLine2?.value,
      zip: shippingFields.zip?.value,
      city: shippingFields.city?.value,
      state: shippingFields.state?.value,
      country: shippingFields.country?.value,
      phone: shippingFields.phone?.value,
    });

  const updateAddressSummary = () => {
    if (!addressSummaryEl) return;
    const display = getCurrentAddressDisplay();
    const destination = [
      cleanText(shippingFields.address?.value),
      cleanText(shippingFields.city?.value),
    ].filter(Boolean).join(', ');
    addressSummaryEl.textContent = destination || display.name || 'Añade una dirección';
    const street = [
      cleanText(shippingFields.address?.value),
      cleanText(shippingFields.addressLine2?.value),
    ].filter(Boolean).join(', ');
    const locality = [
      cleanText(shippingFields.zip?.value),
      cleanText(shippingFields.city?.value),
    ].filter(Boolean).join(' ');
    const addressLine = [street, locality].filter(Boolean).join(', ');
    const region = [
      cleanText(shippingFields.state?.value),
      normalizeCountry(shippingFields.country?.value) || SPAIN,
    ].filter(Boolean).join(', ');
    const lines = [display.name, addressLine, region].filter(Boolean);
    addressSummaryEl.classList.toggle('is-address', lines.length > 1);
    addressSummaryEl.replaceChildren(
      ...((lines.length ? lines : ['Add a shipping address']).map((line, index) => {
        const span = document.createElement('span');
        span.className = display.name && index === 0
          ? 'address-summary__name'
          : 'address-summary__line';
        span.textContent = line;
        return span;
      })),
    );
  };

  const hasUsableAddress = (address) =>
    Boolean(
      address &&
        cleanText(address.line1 || address.address) &&
        cleanText(address.city) &&
        cleanText(address.zip || address.postalCode) &&
        cleanText(address.country),
    );

  const setSavedAddressSelected = (selected) => {
    if (savedAddressSelectButton) {
      savedAddressSelectButton.setAttribute('aria-pressed', String(selected));
    }
    defaultAddressCard?.classList.toggle('is-selectable', !selected);
  };

  const showSavedAddress = ({ refreshPayment = false } = {}) => {
    if (!hasUsableAddress(savedDefaultAddress)) return;
    userEditedShippingFields.clear();
    hydrateShippingFormFromProfile(activeProfile || {}, savedDefaultAddress);
    if (addressLoadingEl) addressLoadingEl.hidden = true;
    if (defaultAddressCard) defaultAddressCard.hidden = false;
    setSavedAddressSelected(true);
    if (differentAddressButton) differentAddressButton.hidden = false;
    if (shippingForm) shippingForm.hidden = true;
    if (addressDetails) addressDetails.open = false;
    updateAddressSummary();
    if (refreshPayment) schedulePaymentIntentRefreshFromShipping(0);
  };

  const showAlternativeAddress = () => {
    const preserved = {
      firstName: cleanText(activeProfile?.firstName),
      lastName: cleanText(activeProfile?.lastName),
      country: SPAIN,
      phone: cleanText(activeProfile?.phone),
    };
    Object.values(shippingFields).forEach((input) => {
      if (input) input.value = '';
    });
    Object.entries(preserved).forEach(([field, value]) => {
      const input = shippingFields[field];
      if (input) input.value = value;
    });
    userEditedShippingFields.clear();
    if (defaultAddressCard) defaultAddressCard.hidden = !savedDefaultAddress;
    setSavedAddressSelected(false);
    if (differentAddressButton) differentAddressButton.hidden = true;
    if (shippingForm) shippingForm.hidden = false;
    if (addressDetails) addressDetails.open = true;
    updateAddressSummary();
    schedulePaymentIntentRefreshFromShipping(0);
    shippingFields.address?.focus();
  };

  const renderAddressChoice = (profile = {}, address = null) => {
    activeProfile = profile || null;
    savedDefaultAddress = hasUsableAddress(address) ? address : null;
    if (addressLoadingEl) addressLoadingEl.hidden = true;

    if (!savedDefaultAddress) {
      hydrateShippingFormFromProfile(profile || {}, {});
      if (defaultAddressCard) defaultAddressCard.hidden = true;
      setSavedAddressSelected(false);
      if (differentAddressButton) differentAddressButton.hidden = true;
      if (shippingForm) shippingForm.hidden = false;
      if (addressDetails) addressDetails.open = true;
      updateAddressSummary();
      return;
    }

    const display = getAddressDisplay(savedDefaultAddress);
    if (defaultAddressNameEl) defaultAddressNameEl.textContent = display.name || 'Dirección de envío';
    if (defaultAddressLinesEl) defaultAddressLinesEl.textContent = display.lines.join('\n');
    showSavedAddress();
  };

  const markShippingFieldEdited = (input) => {
    if (input?.name) userEditedShippingFields.add(input.name);
  };

  let shippingIntentRefreshTimer = null;
  const schedulePaymentIntentRefreshFromShipping = (delayMs = 450) => {
    const revision = invalidateCheckoutPayment();
    if (!isCheckoutContactAndShippingReady()) {
      setPayButtonState(false);
      return;
    }
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
    const line2 = read(shippingFields.addressLine2);
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
      line2,
      address: line1,
      city,
      state,
      zip,
      postalCode: zip,
      phone,
      email: getCheckoutEmail(),
      country: normalizeCountry(read(shippingFields.country)) || SPAIN,
    };

    const hasAnyValue = [
      firstName,
      lastName,
      line1,
      line2,
      city,
      state,
      zip,
      phone,
    ].some((value) => cleanText(value));
    if (!hasAnyValue) return undefined;

    return Object.fromEntries(Object.entries(payload).filter(([, value]) => cleanText(value)));
  };

  Object.values(shippingFields).forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
      markShippingFieldEdited(input);
      updateAddressSummary();
      schedulePaymentIntentRefreshFromShipping();
    });
    input.addEventListener('change', () => {
      markShippingFieldEdited(input);
      updateAddressSummary();
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
    if (paymentSection) paymentSection.classList.remove('is-disabled');
    if (applyPromoBtn) applyPromoBtn.disabled = false;
    if (removePromoBtn) removePromoBtn.disabled = false;
    if (promoInput && !state.promo) promoInput.disabled = false;
    if (guestContact) guestContact.hidden = !isGuest;
    if (loginHeaderLink) loginHeaderLink.hidden = !isGuest;
    setPayButtonState(false);
  };

  let stripe;
  let elements;
  let paymentElement;
  let expressCheckoutElement;
  let currentClientSecret = null;
  let currentPaymentIntentId = null;
  let paymentElementMounted = false;
  let expressCheckoutMounted = false;
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
      renderCustomerContact(window.CRONOX_USER);
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
        renderCustomerContact(me);
        return true;
      }
    } catch (error) {
      console.warn('[CRONOX] No se pudo resolver la sesión', error);
    }

    state.isAuthenticated = false;
    renderCustomerContact(null);
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
        renderCustomerContact(profile);

        let address = null;
        if (typeof API.getDefaultAddress === 'function') {
          try {
            address = await API.getDefaultAddress();
          } catch (error) {
            console.warn('[CRONOX] No se pudo cargar la dirección por defecto', error);
          }
        }

        hydrateShippingFormFromProfile(profile || {}, address || {});
        renderAddressChoice(profile || {}, address || null);
      } catch (error) {
        console.warn('[CRONOX] No se pudieron cargar los datos de envío guardados', error);
        renderAddressChoice(window.CRONOX_USER || {}, null);
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
    const buttonState = window.CRONOX_CHECKOUT_LIFECYCLE?.getPaymentButtonState?.({
      loading,
      authenticated: !guestMode,
      checkoutReady: isCheckoutContactAndShippingReady(),
      hasItems: Array.isArray(state.cart?.items) && state.cart.items.length > 0,
      shippingMethod: state.shippingMethod,
      clientSecret: currentClientSecret,
      paymentElementMounted,
    });
    payButton.disabled = buttonState?.disabled ?? true;
    if (forcedLabel) {
      payButton.textContent = forcedLabel;
      return;
    }
    payButton.textContent = buttonState?.label ?? (guestMode ? 'Inicia sesión para pagar' : 'Pago no disponible');
  };

  const setLoadingState = (loading) => {
    if (!payButton) return;
    payButton.classList.toggle('is-loading', loading);
    setPayButtonState(loading);
  };

  const setExpressCheckoutVisibility = (availablePaymentMethods) => {
    if (!expressCheckoutRegion) return;
    const hasWallet = Boolean(
      window.CRONOX_CHECKOUT_LIFECYCLE?.hasAvailableExpressWallet?.(
        availablePaymentMethods,
      ),
    );
    expressCheckoutRegion.hidden = !hasWallet;
  };

  const resetExpressCheckoutElement = () => {
    expressCheckoutMounted = false;
    setExpressCheckoutVisibility(null);
    if (expressCheckoutElement) {
      try {
        expressCheckoutElement.unmount();
      } catch {
        // Stripe can detach an unavailable wallet element before cleanup.
      }
    }
    expressCheckoutElement = null;
  };

  const resetPaymentElement = () => {
    currentClientSecret = null;
    currentPaymentIntentId = null;
    paymentElementMounted = false;
    resetExpressCheckoutElement();
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

  let invalidSessionRecoveryInFlight = false;

  const recoverInvalidCheckoutSession = async (event) => {
    if (invalidSessionRecoveryInFlight) return;

    const button = event?.currentTarget;
    const statusCopy = emptyCartEl?.querySelector('p');
    invalidSessionRecoveryInFlight = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Recuperando…';
    }

    try {
      if (typeof API.logout !== 'function') {
        throw new Error('AUTH_RECOVERY_UNAVAILABLE');
      }

      // The existing logout endpoint validates either auth cookie, transfers
      // the account cart/checkout snapshot to a fresh guest owner when safe,
      // and clears both HttpOnly auth cookies before this page is reloaded.
      await API.logout();
      window.CRONOX_USER = null;
      state.isAuthenticated = false;
      window.location.reload();
    } catch (error) {
      invalidSessionRecoveryInFlight = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Recargar';
      }
      if (statusCopy) {
        statusCopy.textContent =
          'No pudimos recuperar la sesión. Comprueba tu conexión y vuelve a intentarlo.';
      }
      console.warn('[CRONOX checkout auth recovery]', {
        event: 'checkout_auth_recovery_failed',
        type: error instanceof Error ? error.message : 'unexpected',
      });
    }
  };

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
      options.onAction = recoverInvalidCheckoutSession;
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
          <span class="checkout-item__qty" aria-label="Cantidad ${qty}">${qty}</span>
        </div>
        <div class="checkout-item__body">
          <div class="checkout-item__copy">
          <h3 class="checkout-item__title">${productName}</h3>
          ${size ? `<p class="checkout-item__meta">Talla ${size}</p>` : ''}
          </div>
          <div class="checkout-item__price">${priceLabel}</div>
        </div>
      `;
      frag.appendChild(article);
    });
    cartItemsEl.innerHTML = '';
    cartItemsEl.appendChild(frag);
  };

  const recommendationProducts = new Map();
  const pendingRecommendationAdds = new Set();
  let activeRecommendationCard = null;
  let recommendationSequence = 0;
  let recommendationLoadRevision = 0;
  let recommendationCatalog = null;
  let authoritativeRecommendationCart = null;
  let authoritativeRecommendationCartRevision = 0;

  const setRecommendationsStatus = (message) => {
    if (recommendationsStatus) recommendationsStatus.textContent = message || '';
  };

  const getAvailableRecommendationVariants = (product) =>
    window.CRONOX_CHECKOUT_LIFECYCLE?.getAvailableProductVariants?.(product) || [];

  const getRecommendationVariants = (product) =>
    window.CRONOX_CHECKOUT_LIFECYCLE?.getProductVariants?.(product) || [];

  const isRecommendationVariantAvailable = (variant) =>
    Boolean(
      window.CRONOX_CHECKOUT_LIFECYCLE?.isProductVariantAvailable?.(variant),
    );

  const getRecommendationSizeMarkup = (product) => {
    const variants = getRecommendationVariants(product);
    return variants.map((variant) => {
      const size = cleanText(variant.size).toUpperCase() || 'Única';
      const isAvailable = isRecommendationVariantAvailable(variant);
      return `<button type="button" class="checkout-recommendation__size${isAvailable ? '' : ' is-unavailable'}" data-recommendation-variant="${escapeHtml(String(variant.id))}" data-recommendation-unavailable="${isAvailable ? 'false' : 'true'}" aria-label="${escapeHtml(isAvailable ? `Talla ${size}` : `Talla ${size}, agotada`)}" aria-pressed="false" aria-disabled="${isAvailable ? 'false' : 'true'}"${isAvailable ? '' : ' disabled tabindex="-1"'}>${escapeHtml(size)}</button>`;
    }).join('');
  };

  const closeRecommendationSelector = ({ restoreFocus = false } = {}) => {
    const card = activeRecommendationCard;
    if (!card) return;
    const addButton = card.querySelector('.checkout-recommendation__action');
    const selector = card.querySelector('.checkout-recommendation__sizes');
    card.classList.remove('is-selecting-size');
    card.dataset.recommendationVariant = '';
    card.querySelectorAll('[data-recommendation-variant]').forEach((button) => {
      button.classList.remove('is-selected');
      button.setAttribute('aria-pressed', 'false');
    });
    addButton?.setAttribute('aria-expanded', 'false');
    if (selector) selector.hidden = true;
    activeRecommendationCard = null;
    if (restoreFocus && addButton?.isConnected) addButton.focus();
  };

  const openRecommendationSelector = (card, { focusFirst = false } = {}) => {
    if (!card) return false;
    if (activeRecommendationCard && activeRecommendationCard !== card) {
      closeRecommendationSelector();
    }
    const addButton = card.querySelector('.checkout-recommendation__action');
    const selector = card.querySelector('.checkout-recommendation__sizes');
    if (!addButton || !selector) return false;
    activeRecommendationCard = card;
    card.classList.add('is-selecting-size');
    addButton.setAttribute('aria-expanded', 'true');
    selector.hidden = false;
    setRecommendationsStatus('');
    if (focusFirst) {
      selector.querySelector('.checkout-recommendation__size:not(:disabled)')?.focus();
    }
    return true;
  };

  const hideRecommendations = () => {
    closeRecommendationSelector();
    recommendationProducts.clear();
    if (recommendationsList) recommendationsList.innerHTML = '';
    if (recommendationsSection) recommendationsSection.hidden = true;
    setRecommendationsStatus('');
  };

  const hasAuthoritativeRecommendationCart = () =>
    Boolean(
      authoritativeRecommendationCart &&
      Array.isArray(authoritativeRecommendationCart.items),
    );

  const commitAuthoritativeRecommendationCart = (cart) => {
    authoritativeRecommendationCart =
      cart && Array.isArray(cart.items) ? cart : null;
    authoritativeRecommendationCartRevision += 1;
  };

  const renderRecommendations = (products = []) => {
    if (!recommendationsSection || !recommendationsList) return;
    closeRecommendationSelector();
    recommendationProducts.clear();
    recommendationsList.innerHTML = '';

    if (!products.length) {
      recommendationsSection.hidden = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    products.forEach((product) => {
      const productKey = String(product?.slug || '');
      if (!productKey) return;
      recommendationProducts.set(productKey, product);
      const productName = escapeHtml(product.name || 'Producto CRONOX');
      const imageUrl = safeProductImage(product.image || product.images?.[0]);
      const price = escapeHtml(product.priceLabel || formatMoney(product.price || 0));
      const selectorId = `checkout-recommendation-sizes-${++recommendationSequence}`;
      const sizeMarkup = getRecommendationSizeMarkup(product);
      const article = document.createElement('article');
      article.className = 'checkout-recommendation';
      article.dataset.recommendationProduct = productKey;
      article.dataset.recommendationVariant = '';
      article.innerHTML = `
        <img class="checkout-recommendation__image" src="${escapeHtml(imageUrl)}" alt="${productName}" loading="lazy" referrerpolicy="no-referrer">
        <div class="checkout-recommendation__copy">
          <h3 class="checkout-recommendation__name">${productName}</h3>
          <p class="checkout-recommendation__price">${price}</p>
          <div id="${selectorId}" class="checkout-recommendation__sizes" role="group" aria-label="Tallas para ${productName}" hidden>${sizeMarkup}</div>
        </div>
        <button class="checkout-recommendation__action" type="button" aria-controls="${selectorId}" aria-expanded="false">Añadir</button>
      `;
      fragment.appendChild(article);
    });
    recommendationsList.appendChild(fragment);
    recommendationsSection.hidden = recommendationsList.children.length === 0;
    setRecommendationsStatus('');
  };

  const reconcileRecommendationsWithCart = () => {
    if (
      !hasAuthoritativeRecommendationCart() ||
      !Array.isArray(recommendationCatalog) ||
      typeof window.CRONOX_CHECKOUT_LIFECYCLE?.getRecommendationCandidates !== 'function'
    ) {
      hideRecommendations();
      return false;
    }
    const candidates = window.CRONOX_CHECKOUT_LIFECYCLE.getRecommendationCandidates({
      products: recommendationCatalog,
      cartItems: authoritativeRecommendationCart.items,
      limit: 3,
    }).filter((product) => cleanText(product?.slug));
    renderRecommendations(candidates);
    return true;
  };

  const loadRecommendations = async ({ force = false } = {}) => {
    const loadRevision = ++recommendationLoadRevision;
    hideRecommendations();
    if (
      !recommendationsSection ||
      !hasAuthoritativeRecommendationCart() ||
      typeof API.getProducts !== 'function' ||
      typeof window.CRONOX_CHECKOUT_LIFECYCLE?.getRecommendationCandidates !== 'function'
    ) {
      return false;
    }

    try {
      if (force || !Array.isArray(recommendationCatalog)) {
        const products = await API.getProducts({
          limit: 12,
          sortBy: 'createdAt',
          order: 'desc',
        });
        if (loadRevision !== recommendationLoadRevision) return false;
        recommendationCatalog = Array.isArray(products) ? products : [];
      }
      if (loadRevision !== recommendationLoadRevision) return false;
      return reconcileRecommendationsWithCart();
    } catch (error) {
      if (loadRevision !== recommendationLoadRevision) return false;
      hideRecommendations();
      console.warn('[CRONOX checkout recommendations]', {
        event: 'checkout_recommendations_load_failed',
        type: error instanceof Error ? error.name : 'unexpected',
      });
      return false;
    }
  };

  const setRecommendationBusy = (card, busy) => {
    if (!card) return;
    card.setAttribute('aria-busy', busy ? 'true' : 'false');
    card.querySelectorAll('button').forEach((button) => {
      const unavailable = button.dataset.recommendationUnavailable === 'true';
      button.disabled = busy || unavailable;
      if (unavailable) button.setAttribute('aria-disabled', 'true');
    });
  };

  const selectRecommendationVariant = (card, selectedButton) => {
    if (
      !card ||
      !selectedButton ||
      selectedButton.disabled ||
      selectedButton.dataset.recommendationUnavailable === 'true'
    ) {
      return false;
    }
    card.querySelectorAll('[data-recommendation-variant]').forEach((button) => {
      const selected = button === selectedButton;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    card.dataset.recommendationVariant =
      selectedButton.dataset.recommendationVariant || '';
    setRecommendationsStatus('');
    return true;
  };

  const fetchFreshRecommendation = async (product) => {
    const slug = cleanText(product?.slug);
    if (!slug || typeof API.getProductBySlug !== 'function') {
      throw new Error('RECOMMENDATION_PRODUCT_UNAVAILABLE');
    }
    const fresh = await API.getProductBySlug(slug, { cache: 'no-store' });
    if (!fresh || fresh.isActive === false) {
      throw new Error('RECOMMENDATION_PRODUCT_UNAVAILABLE');
    }
    return fresh;
  };

  const addRecommendationVariant = async (card, product, requestedVariantId) => {
    const productKey = card?.dataset.recommendationProduct || '';
    if (!productKey || pendingRecommendationAdds.has(productKey)) return false;
    pendingRecommendationAdds.add(productKey);
    setRecommendationBusy(card, true);
    setRecommendationsStatus('');
    try {
      const fresh = await fetchFreshRecommendation(product);
      const variants = getAvailableRecommendationVariants(fresh);
      const variant = variants.find(
        (candidate) => String(candidate.id) === String(requestedVariantId),
      );
      if (!variant) {
        throw new Error('RECOMMENDATION_VARIANT_OUT_OF_STOCK');
      }

      const addCartItem = window.CRONOX_CART?.addCartItem || API.addCartItem;
      if (typeof addCartItem !== 'function') throw new Error('CART_API_UNAVAILABLE');
      state.cart = await addCartItem({ variantId: variant.id, qty: 1 });
      card.dataset.recommendationVariant = '';
      closeRecommendationSelector();
      commitAuthoritativeRecommendationCart(state.cart);
      reconcileRecommendationsWithCart();
      await queueCheckoutUpdate();
      await loadRecommendations({ force: true });
      setRecommendationsStatus('Producto añadido.');
      return true;
    } catch (error) {
      console.warn('[CRONOX checkout recommendation add]', {
        event: 'checkout_recommendation_add_failed',
        type: error instanceof Error ? error.message : 'unexpected',
      });
      setRecommendationsStatus('Esa opción ya no está disponible. Vuelve a intentarlo.');
      return false;
    } finally {
      pendingRecommendationAdds.delete(productKey);
      if (card?.isConnected) setRecommendationBusy(card, false);
    }
  };

  const handleRecommendationAdd = async (card, { focusFirst = false } = {}) => {
    if (!card) return;
    const product = recommendationProducts.get(card.dataset.recommendationProduct || '');
    const addButton = card.querySelector('.checkout-recommendation__action');
    if (!product || !addButton) return;

    const selector = card.querySelector('.checkout-recommendation__sizes');
    if (activeRecommendationCard !== card || selector?.hidden) {
      openRecommendationSelector(card, { focusFirst });
      return;
    }

    const selectedVariantId = cleanText(card.dataset.recommendationVariant);
    if (!selectedVariantId) {
      setRecommendationsStatus('Selecciona una talla.');
      card.querySelector('.checkout-recommendation__size:not(:disabled)')?.focus();
      return;
    }
    await addRecommendationVariant(card, product, selectedVariantId);
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
        <span class="shipping-option__price ${Number(priceCents) === 0 ? 'is-free' : ''}">${formatShippingPrice(priceCents)}</span>
      `;
      shippingOptionsEl.appendChild(wrapper);
    });

    const selected = state.shippingMethods.find(
      (method) => String(method.code ?? '') === String(state.shippingMethod ?? ''),
    );
    if (shippingMethodSummaryEl) {
      const priceCents = selected?.amountCents ?? selected?.priceCents ?? 0;
      shippingMethodSummaryEl.textContent = selected
        ? [selected.label, selected.description, formatShippingPrice(priceCents)].filter(Boolean).join(' · ')
        : 'Selecciona un método';
    }
  };

  const renderTaxSummary = (summary) => {
    if (!taxNoteEl) return;
    const hasTaxAmount =
      summary &&
      summary.taxAmount !== '' &&
      summary.taxAmount !== null &&
      summary.taxAmount !== undefined;
    const taxAmount = hasTaxAmount ? Number(summary.taxAmount) : Number.NaN;
    if (!Number.isFinite(taxAmount) || taxAmount < 0) {
      taxNoteEl.textContent = '';
      taxNoteEl.hidden = true;
      return;
    }
    taxNoteEl.textContent = `Incluye ${formatMoney(taxAmount)} de impuestos`;
    taxNoteEl.hidden = false;
  };

  const renderSummary = (totals, shippingMethod, summary) => {
    if (!totals) return;
    subtotalEl && (subtotalEl.textContent = formatEuro(totals.subtotalCents));
    if (shippingEl) {
      const shippingPrice = formatShippingPrice(totals.shippingCents);
      shippingEl.textContent = shippingMethod
        ? `${shippingMethod.label} · ${shippingPrice}`
        : shippingPrice;
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
    renderTaxSummary(summary);
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
    resetPaymentElement();
    renderCustomerContact(null);
    userEditedShippingFields.clear();
    Object.values(shippingFields).forEach((input) => {
      if (input) input.value = input.name === 'country' ? SPAIN : '';
    });
    renderAddressChoice({}, null);
    setGuestUiState(true);
    const loaded = await refreshCheckoutSummary(state.shippingMethod, checkoutRevision);
    if (loaded) ensureStripeReady();
    if (helpText) helpText.textContent = 'Stripe procesa tus datos de pago de forma cifrada.';
    return loaded;
  };

  const findShippingMethod = (code) => state.shippingMethods.find((method) => method.code === code) || null;

  const refreshCheckoutSummary = async (
    shippingMethodCode = state.shippingMethod,
    revision = checkoutRevision,
  ) => {
    const recommendationCartRevisionAtRequest =
      authoritativeRecommendationCartRevision;
    recommendationLoadRevision += 1;
    hideRecommendations();
    setLoadingState(true);
    errorDiv.textContent = '';
    try {
      const data = await API.getCheckoutSummary({
        shippingMethod: shippingMethodCode,
        promoCode: state.promo?.code,
      });

      if (revision !== checkoutRevision) return false;

      state.cart = data.cart;
      if (
        recommendationCartRevisionAtRequest ===
        authoritativeRecommendationCartRevision
      ) {
        commitAuthoritativeRecommendationCart(data.cart);
      }
      reconcileRecommendationsWithCart();
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
      setGuestUiState(!state.isAuthenticated);
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

  const buildPaymentReturnUrl = () => {
    const successUrl = new URL('/checkout-success.html', window.location.origin);
    if (currentPaymentIntentId) {
      successUrl.searchParams.set('ref', currentPaymentIntentId);
    }
    return successUrl.toString();
  };

  const subscribeNewsletterIfRequested = async () => {
    const email = getCheckoutEmail();
    if (
      state.isAuthenticated ||
      !newsletterConsent?.checked ||
      !isValidEmail(email) ||
      newsletterSubmittedFor === email
    ) {
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/newsletter/subscribe`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(await getCsrfHeaders()),
        },
        body: JSON.stringify({ email }),
      });
      if (response.ok || response.status === 409) newsletterSubmittedFor = email;
    } catch (error) {
      console.warn('[CRONOX checkout newsletter]', {
        event: 'checkout_newsletter_subscription_failed',
        type: error instanceof Error ? error.name : 'unexpected',
      });
    }
  };

  const confirmExpressCheckoutPayment = async (event, expectedElement) => {
    if (
      expressCheckoutElement !== expectedElement ||
      !currentClientSecret ||
      !isCheckoutContactAndShippingReady()
    ) {
      event?.paymentFailed?.({ reason: 'fail' });
      return;
    }

    const confirmExpressPayment =
      window.CRONOX_CHECKOUT_LIFECYCLE?.confirmExpressPayment;
    if (typeof confirmExpressPayment !== 'function') {
      event?.paymentFailed?.({ reason: 'fail' });
      errorDiv.textContent = 'No hemos podido iniciar el pago rápido. Utiliza otro método de pago.';
      return;
    }

    setPayButtonState(true);
    errorDiv.textContent = '';
    await subscribeNewsletterIfRequested();
    const result = await confirmExpressPayment({
      stripe,
      elements,
      expressCheckoutMounted,
      confirmParams: { return_url: buildPaymentReturnUrl() },
      onFailure: (error) => {
        event?.paymentFailed?.({ reason: 'fail' });
        console.error('[CRONOX checkout express payment]', {
          event: 'checkout_express_payment_confirmation_failed',
          type: typeof error?.type === 'string' ? error.type : 'unexpected',
        });
        errorDiv.textContent =
          typeof error?.type === 'string' && error?.message
            ? error.message
            : 'No se pudo completar el pago rápido. Inténtalo de nuevo o utiliza otro método.';
        setPayButtonState(false);
      },
    });

    if (!result.attempted) {
      event?.paymentFailed?.({ reason: 'fail' });
      errorDiv.textContent = 'No hemos podido iniciar el pago rápido. Utiliza otro método de pago.';
      setPayButtonState(false);
    }
  };

  const mountExpressCheckoutElement = () => {
    resetExpressCheckoutElement();
    if (!elements || !expressCheckoutContainer) return;

    try {
      const nextExpressCheckoutElement = elements.create(
        'expressCheckout',
        expressCheckoutOptions,
      );
      expressCheckoutElement = nextExpressCheckoutElement;
      nextExpressCheckoutElement.on('ready', (event) => {
        if (expressCheckoutElement !== nextExpressCheckoutElement) return;
        expressCheckoutMounted = true;
        setExpressCheckoutVisibility(event?.availablePaymentMethods);
      });
      nextExpressCheckoutElement.on(
        'availablepaymentmethodschange',
        (event) => {
          if (expressCheckoutElement !== nextExpressCheckoutElement) return;
          setExpressCheckoutVisibility(event?.paymentMethods);
        },
      );
      nextExpressCheckoutElement.on('loaderror', (event) => {
        if (expressCheckoutElement !== nextExpressCheckoutElement) return;
        setExpressCheckoutVisibility(null);
        console.error('[CRONOX checkout Express Checkout Element]', {
          event: 'checkout_express_element_load_failed',
          type:
            typeof event?.error?.type === 'string'
              ? event.error.type
              : 'unexpected',
          code:
            typeof event?.error?.code === 'string'
              ? event.error.code
              : undefined,
        });
      });
      nextExpressCheckoutElement.on('confirm', (event) => {
        void confirmExpressCheckoutPayment(event, nextExpressCheckoutElement);
      });
      nextExpressCheckoutElement.mount(expressCheckoutContainer);
      expressCheckoutMounted = true;
    } catch (error) {
      resetExpressCheckoutElement();
      console.warn('[CRONOX checkout Express Checkout Element]', {
        event: 'checkout_express_element_mount_skipped',
        type: error instanceof Error ? error.name : 'unexpected',
      });
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
    mountExpressCheckoutElement();
    const nextPaymentElement = elements.create('payment', paymentElementOptions);
    paymentElement = nextPaymentElement;
    currentClientSecret = clientSecret;
    let loadSettled = false;
    let loadTimeoutId = null;
    const clearLoadTimeout = () => {
      if (loadTimeoutId !== null) {
        window.clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
    };
    const handleReady = () => {
      if (paymentElement !== nextPaymentElement || loadSettled) return;
      loadSettled = true;
      clearLoadTimeout();
      paymentElementMounted = true;
      setPayButtonState(false);
    };
    const handleLoadError = (event) => {
      if (paymentElement !== nextPaymentElement || loadSettled) return;
      loadSettled = true;
      clearLoadTimeout();
      paymentElementMounted = false;
      try {
        nextPaymentElement.unmount();
      } catch {
        // A failed or timed-out Stripe Element may already be detached.
      }
      currentClientSecret = null;
      currentPaymentIntentId = null;
      resetExpressCheckoutElement();
      paymentElement = null;
      elements = null;
      console.error('[CRONOX checkout Payment Element]', {
        event: 'checkout_payment_element_load_failed',
        type: typeof event?.error?.type === 'string' ? event.error.type : 'unexpected',
        code: typeof event?.error?.code === 'string' ? event.error.code : undefined,
      });
      errorDiv.textContent = 'No hemos podido preparar el pago. Inténtalo de nuevo.';
      setPayButtonState(false);
    };
    const observesLoad =
      window.CRONOX_CHECKOUT_LIFECYCLE?.observePaymentElementLoad?.({
        paymentElement: nextPaymentElement,
        onReady: handleReady,
        onLoadError: handleLoadError,
      }) ?? false;
    const container = document.getElementById('payment-element');
    if (!container) {
      resetPaymentElement();
      throw new Error('PAYMENT_ELEMENT_CONTAINER_NOT_FOUND');
    }
    try {
      loadTimeoutId = window.setTimeout(() => handleLoadError({ error: { type: 'load_timeout' } }), 15_000);
      nextPaymentElement.mount(container);
      if (!observesLoad) handleReady();
    } catch (error) {
      clearLoadTimeout();
      console.error('[CRONOX checkout Payment Element]', {
        event: 'checkout_payment_element_mount_failed',
        type: error instanceof Error ? error.name : 'unexpected',
      });
      resetPaymentElement();
      throw new Error('PAYMENT_ELEMENT_MOUNT_FAILED');
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
      details.code === 'CHECKOUT_PAYMENT_INTENT_RECOVERY_BLOCKED' ||
      details.code === 'CHECKOUT_PAYMENT_INTENT_IN_PROGRESS'
    ) {
      return 'No hemos podido preparar el pago. Inténtalo de nuevo.';
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
    return 'No hemos podido preparar el pago. Inténtalo de nuevo.';
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
          if (state.isAuthenticated && Number.isSafeInteger(orderId) && orderId > 0) {
            window.location.assign(
              `/checkout-success.html?orderId=${encodeURIComponent(orderId)}`,
            );
          } else if (currentPaymentIntentId) {
            window.location.assign(
              `/checkout-success.html?ref=${encodeURIComponent(currentPaymentIntentId)}`,
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

      if (!isCheckoutContactAndShippingReady()) {
        errorDiv.textContent = state.isAuthenticated
          ? 'Completa la direccion de envio.'
          : 'Introduce un email valido y completa la direccion de envio.';
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
          guestEmail: state.isAuthenticated ? undefined : getCheckoutEmail(),
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
      renderSummary(
        state.totals,
        findShippingMethod(state.shippingMethod) || data.shippingMethod,
        data.summary,
      );
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

  const closeCheckoutMenus = (except = null) => {
    [
      [accountMenuButton, accountMenu],
      [addressMenuButton, addressMenu],
    ].forEach(([button, menu]) => {
      if (!menu || menu === except) return;
      menu.hidden = true;
      button?.setAttribute('aria-expanded', 'false');
    });
  };

  const toggleCheckoutMenu = (button, menu) => {
    if (!button || !menu) return;
    const willOpen = menu.hidden;
    closeCheckoutMenus(willOpen ? menu : null);
    menu.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) menu.querySelector('[role="menuitem"]')?.focus();
  };

  let modalReturnFocus = null;
  const closeAddressModal = () => {
    if (!addressModal || addressModal.hidden) return;
    addressModal.hidden = true;
    document.body.classList.remove('checkout-modal-open');
    if (addressModalError) addressModalError.textContent = '';
    modalReturnFocus?.focus?.();
    modalReturnFocus = null;
  };

  const openAddressModal = () => {
    if (!addressModal || !addressEditForm || !savedDefaultAddress?.id) return;
    closeCheckoutMenus();
    modalReturnFocus = document.activeElement;
    ['line1', 'line2', 'zip', 'city', 'state', 'country', 'phone'].forEach((field) => {
      const input = addressEditForm.elements.namedItem(field);
      if (input) {
        input.value = field === 'country'
          ? normalizeCountry(savedDefaultAddress[field]) || SPAIN
          : cleanText(savedDefaultAddress[field]);
      }
    });
    const fullName = cleanText(savedDefaultAddress.name);
    const [parsedFirstName = '', ...parsedLastName] = fullName.split(/\s+/);
    addressEditForm.elements.namedItem('firstName').value =
      cleanText(savedDefaultAddress.firstName) || parsedFirstName;
    addressEditForm.elements.namedItem('lastName').value =
      cleanText(savedDefaultAddress.lastName) || parsedLastName.join(' ');
    addressEditForm.elements.namedItem('isDefault').checked =
      Boolean(savedDefaultAddress.isDefault);
    const countryInput = addressEditForm.elements.namedItem('country');
    if (countryInput && !countryInput.value) countryInput.value = SPAIN;
    if (addressModalError) addressModalError.textContent = '';
    addressModal.hidden = false;
    document.body.classList.add('checkout-modal-open');
    addressEditForm.elements.namedItem('country')?.focus();
  };

  const saveEditedAddress = async () => {
    if (!addressEditForm || !savedDefaultAddress?.id) return;
    if (!addressEditForm.reportValidity()) return;
    const readField = (name) => cleanText(addressEditForm.elements.namedItem(name)?.value);
    const payload = {
      name: [readField('firstName'), readField('lastName')].filter(Boolean).join(' '),
      line1: readField('line1'),
      line2: readField('line2') || undefined,
      zip: readField('zip'),
      city: readField('city'),
      state: readField('state') || undefined,
      country: normalizeCountry(readField('country')) || SPAIN,
      phone: readField('phone') || undefined,
      isDefault: Boolean(addressEditForm.elements.namedItem('isDefault')?.checked),
    };
    if (addressModalSave) addressModalSave.disabled = true;
    if (addressModalError) addressModalError.textContent = '';
    try {
      const response = await fetch(
        `${API_BASE}/api/me/addresses/${encodeURIComponent(savedDefaultAddress.id)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(await getCsrfHeaders()),
          },
          body: JSON.stringify(payload),
        },
      );
      const updated = await response.json().catch(() => null);
      if (!response.ok) throw new Error(updated?.message || 'ADDRESS_UPDATE_FAILED');
      const refreshed =
        typeof API.getDefaultAddress === 'function'
          ? await API.getDefaultAddress().catch(() => updated)
          : updated;
      renderAddressChoice(activeProfile || {}, refreshed || updated);
      closeAddressModal();
      await queueCheckoutUpdate();
    } catch (error) {
      if (addressModalError) {
        addressModalError.textContent = 'No se pudo guardar la direccion. Revisa los datos e intentalo de nuevo.';
      }
    } finally {
      if (addressModalSave) addressModalSave.disabled = false;
    }
  };

  const logoutFromCheckout = async () => {
    closeCheckoutMenus();
    invalidateCheckoutPayment();
    try {
      await API.logout?.();
      window.CRONOX_USER = null;
      savedDefaultAddress = null;
      activeProfile = null;
      window.dispatchEvent(new CustomEvent('cronox:userChanged', { detail: null }));
    } catch (error) {
      errorDiv.textContent = 'No se pudo cerrar la sesion. Intentalo de nuevo.';
    }
  };

  const bindEvents = () => {
    const sanitizePromoInputValue = () => {
      if (!promoInput) return '';
      const cleaned = sanitizePromoCode(promoInput.value);
      promoInput.value = cleaned;
      return cleaned;
    };

    const openLogin = async (event) => {
      event.preventDefault();
      if (typeof window.CRONOX_openAuthModal === 'function') {
        const opened = await window.CRONOX_openAuthModal('login');
        if (opened === false) {
          errorDiv.textContent = 'No se pudo abrir el acceso. Inténtalo de nuevo.';
        }
      } else {
        errorDiv.textContent = 'No se pudo abrir el acceso. Inténtalo de nuevo.';
      }
    };
    loginCalloutLink?.addEventListener('click', openLogin);
    loginHeaderLink?.addEventListener('click', openLogin);

    guestEmailInput?.addEventListener('input', () => {
      newsletterSubmittedFor = '';
      schedulePaymentIntentRefreshFromShipping();
    });
    guestEmailInput?.addEventListener('change', () => {
      schedulePaymentIntentRefreshFromShipping(0);
    });

    accountMenuButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCheckoutMenu(accountMenuButton, accountMenu);
    });
    addressMenuButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCheckoutMenu(addressMenuButton, addressMenu);
    });
    logoutButton?.addEventListener('click', () => void logoutFromCheckout());
    editAddressButton?.addEventListener('click', openAddressModal);

    addressModalClose?.addEventListener('click', closeAddressModal);
    addressModalCancel?.addEventListener('click', closeAddressModal);
    addressModal?.querySelector('[data-address-modal-close]')?.addEventListener('click', closeAddressModal);
    addressEditForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveEditedAddress();
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.checkout-menu')) closeCheckoutMenus();
      if (
        activeRecommendationCard &&
        !activeRecommendationCard.contains(event.target)
      ) {
        closeRecommendationSelector();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (addressModal && !addressModal.hidden) closeAddressModal();
        else if (activeRecommendationCard) {
          event.preventDefault();
          closeRecommendationSelector({ restoreFocus: true });
        }
        else closeCheckoutMenus();
        return;
      }
      if (event.key !== 'Tab' || !addressModal || addressModal.hidden) return;
      const focusable = Array.from(
        addressModal.querySelectorAll('button:not([disabled]), input:not([disabled])'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    differentAddressButton?.addEventListener('click', () => {
      showAlternativeAddress();
    });

    savedAddressSelectButton?.addEventListener('click', () => {
      showSavedAddress({ refreshPayment: true });
    });

    defaultAddressCard?.addEventListener('click', (event) => {
      if (!defaultAddressCard.classList.contains('is-selectable')) return;
      if (event.target.closest('button, [role="menu"]')) return;
      showSavedAddress({ refreshPayment: true });
    });

    recommendationsList?.addEventListener('click', async (event) => {
      const card = event.target.closest('.checkout-recommendation');
      if (!card) return;
      const product = recommendationProducts.get(card.dataset.recommendationProduct || '');
      const sizeButton = event.target.closest('[data-recommendation-variant]');
      if (sizeButton && product) {
        selectRecommendationVariant(card, sizeButton);
        return;
      }
      if (event.target.closest('.checkout-recommendation__action')) {
        await handleRecommendationAdd(card, { focusFirst: event.detail === 0 });
      }
    });

    shippingOptionsEl?.addEventListener('change', async (event) => {
      const input = event.target.closest('input[name="shippingMethod"]');
      if (!input) return;
      state.shippingMethod = input.value;
      await queueCheckoutUpdate();
    });

    payButton?.addEventListener('click', async () => {
      if (!isCheckoutContactAndShippingReady()) {
        errorDiv.textContent = state.isAuthenticated
          ? 'Completa la direccion de envio.'
          : 'Introduce un email valido y completa la direccion de envio.';
        if (!state.isAuthenticated && !isValidEmail(getCheckoutEmail())) {
          guestEmailInput?.focus();
        }
        return;
      }
      if (!stripe || !elements || !paymentElement || !paymentElementMounted || !currentClientSecret) {
        errorDiv.textContent = 'No hemos podido preparar el pago. Inténtalo de nuevo.';
        await queueCheckoutUpdate();
        return;
      }
      setPayButtonState(true);
      errorDiv.textContent = '';
      await subscribeNewsletterIfRequested();

      const confirmMountedPayment = window.CRONOX_CHECKOUT_LIFECYCLE?.confirmMountedPayment;
      if (typeof confirmMountedPayment !== 'function') {
        errorDiv.textContent = 'No se pudo iniciar el pago. Refresca la página e inténtalo de nuevo.';
        setPayButtonState(false);
        return;
      }

      await confirmMountedPayment({
        stripe,
        elements,
        paymentElementMounted,
        confirmParams: {
          return_url: buildPaymentReturnUrl(),
        },
        onFailure: (error) => {
          console.error('[CRONOX checkout payment confirmation]', {
            event: 'checkout_payment_confirmation_failed',
            type: typeof error?.type === 'string' ? error.type : 'unexpected',
          });
          errorDiv.textContent =
            typeof error?.type === 'string' && error?.message
              ? error.message
              : 'No se pudo completar el pago. Inténtalo de nuevo.';
          setPayButtonState(false);
        },
      });
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
      renderCustomerContact(user);
      shippingDefaultsLoaded = false;
      await loadUserShippingDefaults();
      hideLoginCallout();
      setGuestUiState(false);
      const stripeReady = ensureStripeReady();
      if (stripeReady && currentClientSecret && !paymentElementMounted) {
        await ensurePaymentElement(currentClientSecret);
      }
      if (stripeReady) await queueCheckoutUpdate();
      await loadRecommendations();
    } else {
      savedDefaultAddress = null;
      activeProfile = null;
      shippingDefaultsLoaded = false;
      shippingDefaultsPromise = null;
      await renderGuestCheckout();
      await loadRecommendations();
    }
  });

  window.addEventListener('cart:updated', (event) => {
    const cart = event?.detail;
    recommendationLoadRevision += 1;
    if (!cart || !Array.isArray(cart.items)) {
      state.cart = null;
      commitAuthoritativeRecommendationCart(null);
      hideRecommendations();
      return;
    }
    state.cart = cart;
    commitAuthoritativeRecommendationCart(cart);
    if (!reconcileRecommendationsWithCart()) {
      void loadRecommendations();
    }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    clearPromoInputOnLoad();
    clearStoredPromo();
    setPromoState(null);
    renderPromoUI();
    bindEvents();
    await resolveAuthStatus();
    if (!state.isAuthenticated) {
      await renderGuestCheckout();
      await loadRecommendations();
      return;
    }

    await loadUserShippingDefaults();
    ensureStripeReady();
    await queueCheckoutUpdate();
    await loadRecommendations();
  });
})();
