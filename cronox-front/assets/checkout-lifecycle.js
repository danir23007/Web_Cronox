(function (root, factory) {
  const countryApi =
    typeof module === 'object' && module.exports
      ? require('./country.js')
      : root?.CRONOX_COUNTRY;
  const api = factory(countryApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CRONOX_CHECKOUT_LIFECYCLE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (countryApi) {
  const createCoordinator = () => {
    let revision = 0;
    let queue = Promise.resolve(false);

    return {
      current: () => revision,
      invalidate: () => {
        revision += 1;
        return revision;
      },
      isCurrent: (candidate) => candidate === revision,
      enqueue: (candidate, task) => {
        const run = async () => {
          if (candidate !== revision) return false;
          return task(() => candidate === revision);
        };
        queue = queue.catch(() => false).then(run);
        return queue;
      },
    };
  };

  const pollUntilProcessed = async ({
    fetchStatus,
    onProcessed,
    shouldContinue = () => true,
    delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    intervalMs = 1500,
    maxAttempts = 40,
  }) => {
    let lastStatus = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!shouldContinue()) return { outcome: 'cancelled', status: lastStatus };
      lastStatus = await fetchStatus();
      if (!shouldContinue()) return { outcome: 'cancelled', status: lastStatus };
      if (lastStatus?.isProcessed) {
        if (typeof onProcessed === 'function') await onProcessed(lastStatus);
        return { outcome: 'processed', status: lastStatus };
      }
      if (attempt + 1 < maxAttempts) await delay(intervalMs);
    }
    return { outcome: 'timeout', status: lastStatus };
  };

  const confirmMountedPayment = async ({
    stripe,
    elements,
    paymentElementMounted,
    confirmParams,
    onFailure = () => undefined,
  }) => {
    if (!stripe || !elements || !paymentElementMounted) {
      return { attempted: false, error: null };
    }

    try {
      const result = await stripe.confirmPayment({ elements, confirmParams });
      const error = result?.error ?? null;
      if (error) await onFailure(error);
      return { attempted: true, error };
    } catch (error) {
      await onFailure(error);
      return { attempted: true, error };
    }
  };

  const confirmExpressPayment = async ({
    stripe,
    elements,
    expressCheckoutMounted,
    confirmParams,
    onFailure = () => undefined,
  }) => {
    if (!stripe || !elements || !expressCheckoutMounted) {
      return { attempted: false, error: null };
    }

    try {
      const result = await stripe.confirmPayment({ elements, confirmParams });
      const error = result?.error ?? null;
      if (error) await onFailure(error);
      return { attempted: true, error };
    } catch (error) {
      await onFailure(error);
      return { attempted: true, error };
    }
  };

  const observePaymentElementLoad = ({ paymentElement, onReady, onLoadError }) => {
    if (!paymentElement || typeof paymentElement.on !== 'function') {
      return false;
    }
    paymentElement.on('ready', onReady);
    paymentElement.on('loaderror', onLoadError);
    return true;
  };

  const getShippingDefaultValues = ({ profile = {}, address = {} } = {}) => {
    const clean = (value) =>
      typeof value === 'string'
        ? value.trim()
        : typeof value === 'number'
          ? String(value)
          : '';
    const profileAddress =
      profile.address && typeof profile.address === 'object'
        ? profile.address
        : {};
    const fullName = clean(address.name);
    const [addressFirstName = '', ...addressLastNameParts] = fullName.split(/\s+/);

    return {
      firstName: clean(profile.firstName) || addressFirstName,
      lastName: clean(profile.lastName) || addressLastNameParts.join(' '),
      country:
        countryApi?.normalizeCountry(
          address.country || profileAddress.country || countryApi.SPAIN,
        ) || countryApi?.SPAIN || 'España',
      address: clean(address.line1 || profileAddress.line1 || profile.address),
      addressLine2: clean(address.line2 || profileAddress.line2),
      city: clean(address.city || profileAddress.city || profile.city),
      state: clean(address.state || profileAddress.state || profile.state),
      zip: clean(address.zip || profileAddress.zip || profile.zip),
      phone: clean(profile.phone || address.phone || profileAddress.phone),
    };
  };

  const hasAvailableExpressWallet = (availablePaymentMethods) => {
    if (!availablePaymentMethods || typeof availablePaymentMethods !== 'object') {
      return false;
    }
    const isAvailable = (method) =>
      method === true || method?.available === true;
    return Boolean(
      isAvailable(availablePaymentMethods.paypal) ||
        isAvailable(availablePaymentMethods.googlePay) ||
        isAvailable(availablePaymentMethods.google_pay),
    );
  };

  const getProductVariants = (product = {}) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    return variants.filter((variant) => variant?.id != null);
  };

  const isProductVariantAvailable = (variant) => {
    const stock = Number(variant?.stock ?? variant?.stockQty ?? 0);
    return Boolean(
      variant?.id != null &&
        variant?.isActive !== false &&
        variant?.isAvailable !== false &&
        Number.isFinite(stock) &&
        stock > 0,
    );
  };

  const getAvailableProductVariants = (product = {}) =>
    getProductVariants(product).filter(isProductVariantAvailable);

  const getProductIdentityKeys = (source = {}) => {
    const normalize = (value) => String(value ?? '').trim().toLowerCase();
    const product = source?.product || source?.variant?.product || source;
    return [
      ['id', product?.backendId],
      ['id', product?.productId],
      ['id', product?.id],
      ['slug', product?.slug],
    ]
      .map(([type, value]) => {
        const normalized = normalize(value);
        return normalized ? `${type}:${normalized}` : '';
      })
      .filter(Boolean);
  };

  const getCartProductExclusionKeys = (cartItems) => {
    if (!Array.isArray(cartItems)) return null;
    const keys = new Set();
    cartItems.forEach((item) => {
      getProductIdentityKeys(item).forEach((key) => keys.add(key));
    });
    return keys;
  };

  const getRecommendationCandidates = ({
    products = [],
    cartItems,
    limit = 3,
  } = {}) => {
    const cartKeys = getCartProductExclusionKeys(cartItems);
    if (!cartKeys) return [];

    const safeLimit = Math.max(0, Math.min(3, Number(limit) || 0));
    return (Array.isArray(products) ? products : [])
      .filter(
        (product) =>
          product?.isActive !== false &&
          getAvailableProductVariants(product).length > 0 &&
          !getProductIdentityKeys(product).some((key) => cartKeys.has(key)),
      )
      .slice(0, safeLimit);
  };

  const getDirectAddVariant = (product = {}) => {
    const available = getAvailableProductVariants(product);
    return available.length === 1 ? available[0] : null;
  };

  const getPaymentButtonState = ({
    loading,
    authenticated,
    checkoutReady = authenticated,
    hasItems,
    shippingMethod,
    clientSecret,
    paymentElementMounted,
  }) => {
    const canPreparePayment = checkoutReady && hasItems && Boolean(shippingMethod);
    const waitingForPaymentElement = Boolean(clientSecret) && !paymentElementMounted;
    if (!checkoutReady) {
      return { disabled: true, label: 'Completa tus datos' };
    }
    return {
      disabled: loading || !canPreparePayment || waitingForPaymentElement,
      label: !checkoutReady
        ? 'Inicia sesión para pagar'
        : loading || waitingForPaymentElement
          ? 'Procesando…'
          : !clientSecret && canPreparePayment
            ? 'Reintentar pago'
            : 'Pagar ahora',
    };
  };

  return Object.freeze({
    createCoordinator,
    pollUntilProcessed,
    confirmMountedPayment,
    confirmExpressPayment,
    observePaymentElementLoad,
    getShippingDefaultValues,
    hasAvailableExpressWallet,
    getProductVariants,
    isProductVariantAvailable,
    getAvailableProductVariants,
    getProductIdentityKeys,
    getCartProductExclusionKeys,
    getRecommendationCandidates,
    getDirectAddVariant,
    getPaymentButtonState,
  });
});
