(function (global) {
  const g = global || {};

  const formatPrice = (value) => {
    const amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
      }).format(amount);
    } catch (error) {
      return `${amount} €`;
    }
  };

  const FALLBACK_SOURCE = [
    {
      id: 'camiseta-washed-gris',
      name: 'Grey Core Tee',
      price: 34.95,
      priceLabel: '34,95 €',
      image: 'assets/products/camiseta_washed_gris.png',
      images: [
        'assets/products/camiseta_washed_gris.png',
        'assets/products/camiseta_washed_gris_2.png',
      ],
      categories: ['camisetas'],
      sizes: ['s', 'm', 'l', 'xl', 'xxl'],
      color: 'gris',
      colors: ['gris'],
      desc: 'Camiseta premium lavado gris, corte oversized y tacto suave.',
    },
    {
      id: 'camiseta-washed-negra',
      name: 'Black Core Tee',
      price: 34.95,
      priceLabel: '34,95 €',
      image: 'assets/products/camiseta_washed_negra.png',
      images: [
        'assets/products/camiseta_washed_negra.png',
        'assets/products/camiseta_washed_negra_2.png',
      ],
      categories: ['camisetas'],
      sizes: ['s', 'm', 'l', 'xl', 'xxl'],
      color: 'negro',
      colors: ['negro'],
      desc: 'Camiseta premium lavado negro, corte oversized y tacto suave.',
    },
  ];

  const cloneProduct = (product = {}) => {
    const copy = { ...product };
    if (Array.isArray(product.images)) copy.images = [...product.images];
    if (Array.isArray(product.sizes)) copy.sizes = [...product.sizes];
    if (Array.isArray(product.colors)) copy.colors = [...product.colors];
    if (Array.isArray(product.categories)) copy.categories = [...product.categories];
    if (Array.isArray(product.variants)) copy.variants = product.variants.map((variant) => ({ ...variant }));
    if (product.variantMap && typeof product.variantMap === 'object') {
      copy.variantMap = Object.entries(product.variantMap).reduce((acc, [key, value]) => {
        acc[key] = { ...value };
        return acc;
      }, {});
    }
    return copy;
  };

  const getFallbackProducts = () => FALLBACK_SOURCE.map(cloneProduct);

  const readManualBase = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return '';

    const globalBase = typeof window.__CRONOX_API_BASE__ === 'string'
      ? window.__CRONOX_API_BASE__.trim()
      : '';
    if (globalBase) return globalBase;

    const doc = document.documentElement;
    if (doc && typeof doc.dataset?.cronoxApiBase === 'string' && doc.dataset.cronoxApiBase.trim()) {
      return doc.dataset.cronoxApiBase.trim();
    }

    const meta = document.querySelector('meta[name="cronox:api-base"]');
    if (meta && typeof meta.content === 'string' && meta.content.trim()) {
      return meta.content.trim();
    }

    const script = document.querySelector('script[data-cronox-api-base]');
    if (script && typeof script.dataset.cronoxApiBase === 'string' && script.dataset.cronoxApiBase.trim()) {
      return script.dataset.cronoxApiBase.trim();
    }

    return '';
  };

  const detectLocalhostPort = (fallbackPort = '3000') => {
    if (typeof window === 'undefined') return fallbackPort;
    const raw = window.__CRONOX_BACKEND_PORT__ != null
      ? String(window.__CRONOX_BACKEND_PORT__).trim()
      : '';
    if (raw) return raw;

    if (typeof document !== 'undefined') {
      const doc = document.documentElement;
      if (doc && typeof doc.dataset?.cronoxBackendPort === 'string') {
        const value = doc.dataset.cronoxBackendPort.trim();
        if (value) return value;
      }
    }

    return String(fallbackPort || '').trim() || '3000';
  };

  const detectApiBase = () => {
    if (typeof window === 'undefined') {
      return 'http://localhost:3000';
    }

    const manualBase = readManualBase();
    if (manualBase) return manualBase;

    const { protocol, hostname, port } = window.location;

    if (/\.app\.github\.dev$/i.test(hostname)) {
      const match = hostname.match(/^(.*)-(\d+)\.app\.github\.dev$/i);
      if (match && match[1]) {
        return `${protocol}//${match[1]}-3000.app.github.dev`;
      }
    }

    const normalizePort = (value) => {
      if (!value) return '';
      const raw = String(value).trim();
      if (!raw) return '';
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return '';
      const defaultPort = protocol === 'https:' ? 443 : 80;
      if (num === defaultPort) return '';
      return String(num);
    };

    const safeJoin = (baseProtocol, host, basePort = '') => {
      const p = normalizePort(basePort);
      return `${baseProtocol}//${host}${p ? `:${p}` : ''}`;
    };

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      const backendPort = normalizePort(detectLocalhostPort('3000')) || '3000';
      return safeJoin(protocol, hostname, backendPort);
    }

    if (/^192\.168\./.test(hostname) || /^10\./.test(hostname) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
      if (port) {
        return safeJoin(protocol, hostname, port);
      }
      return safeJoin(protocol, hostname, '3000');
    }

    if (port) {
      return safeJoin(protocol, hostname, port);
    }

    return `${protocol}//${hostname}`;
  };

  const normalizeBase = (base) => (base || '').replace(/\/$/, '');
  const API_BASE = normalizeBase(detectApiBase());

  const safeJsonParse = (text) => {
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  };

  const centsToUnits = (value) => (Number(value) || 0) / 100;
  const formatCents = (cents) => formatPrice(centsToUnits(cents));

  const pickPrimaryImage = (images = [], fallback = '') => {
    if (!Array.isArray(images)) {
      return fallback || '';
    }

    const byOrder = [...images].sort((a, b) => {
      const sortA = Number(a?.sortOrder ?? 0);
      const sortB = Number(b?.sortOrder ?? 0);
      return sortA - sortB;
    });

    const primary = byOrder.find((img) => img?.isPrimary)?.url;
    const first = byOrder.find((img) => img?.url)?.url;

    return primary || first || fallback || '';
  };

  const normalizeSizeKey = (value) => String(value || '').trim().toUpperCase();

  const mapVariant = (variant = {}, fallbackPriceCents = 0) => {
    const effectivePriceCents = Number(variant.effectivePrice ?? fallbackPriceCents ?? 0);
    const sizeKey = normalizeSizeKey(variant.size);
    const stockQty = Number(variant.stockQty ?? variant.stock ?? 0);

    return {
      id: variant.id,
      size: variant.size,
      sizeKey,
      sku: variant.sku,
      stock: stockQty,
      isActive: Boolean(variant.isActive ?? true),
      priceCents: effectivePriceCents,
      price: centsToUnits(effectivePriceCents),
      priceLabel: formatCents(effectivePriceCents),
      isAvailable: Boolean((variant.isActive ?? true) && stockQty > 0),
    };
  };

  const mapProduct = (product) => {
    if (!product) return null;

    const images = Array.isArray(product.images)
      ? product.images.map((img) => img?.url).filter(Boolean)
      : [];
    const primaryImage = pickPrimaryImage(product.images, product.imageUrl || images[0] || '');
    const rawVariants = Array.isArray(product.variants) ? product.variants : [];
    const variants = rawVariants.map((variant) => mapVariant(variant, product.price));
    const variantMap = variants.reduce((acc, variant) => {
      if (variant.sizeKey) {
        acc[variant.sizeKey] = variant;
      }
      return acc;
    }, {});

    const categories = Array.isArray(product.categories)
      ? product.categories
          .map((relation) => {
            if (relation?.category?.slug) return relation.category.slug;
            if (relation?.category?.name) return relation.category.name;
            if (relation?.slug) return relation.slug;
            if (relation?.name) return relation.name;
            return undefined;
          })
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      : [];

    const sizes = variants.length
      ? variants.map((variant) => variant.size).filter(Boolean)
      : Array.isArray(product.sizes)
        ? product.sizes
        : [];

    return {
      __fromBackend: true,
      id: String(product.slug ?? product.id ?? ''),
      backendId: product.id,
      slug: product.slug,
      name: product.name,
      priceCents: product.price,
      price: centsToUnits(product.price),
      priceLabel: formatCents(product.price),
      currency: product.currency || 'EUR',
      desc: product.description || product.desc || '',
      image: primaryImage,
      images: images.length ? images : primaryImage ? [primaryImage] : [],
      categories,
      sizes: sizes.map((size) => String(size || '').toLowerCase()),
      colors: product.colors || [],
      color: product.color || '',
      variants,
      variantMap,
    };
  };

  const mapCartItem = (item = {}) => {
    const variant = item.variant || {};
    const product = variant.product || {};
    const priceCents = Number(item.priceAtAdd ?? variant.price ?? product.price ?? 0);
    const productImages = Array.isArray(product.images)
      ? product.images
          .map((img) => (typeof img?.url === 'string' ? { url: img.url } : null))
          .filter(Boolean)
      : [];
    const productImage =
      product.imageUrl || pickPrimaryImage(product.images || []) || productImages[0]?.url || '';

    const itemImages = Array.isArray(item.images)
      ? item.images
          .map((img) => (typeof img?.url === 'string' ? { url: img.url } : null))
          .filter(Boolean)
      : [];

    return {
      id: item.id,
      variantId: item.variantId,
      qty: Number(item.qty) || 0,
      priceCents,
      price: centsToUnits(priceCents),
      priceLabel: formatCents(priceCents),
      size: variant.size,
      sku: variant.sku,
      imageUrl: productImage || null,
      images: itemImages,
      product: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        currency: product.currency || 'EUR',
        image: productImage,
        imageUrl: productImage || product.imageUrl,
        images: productImages,
      },
    };
  };

  const mapCart = (cart) => {
    if (!cart) {
      return { id: null, items: [], itemsCount: 0, subtotalCents: 0, subtotalLabel: formatCents(0) };
    }

    const items = Array.isArray(cart.items) ? cart.items.map(mapCartItem) : [];
    const itemsCount = typeof cart.itemsCount === 'number'
      ? cart.itemsCount
      : items.reduce((acc, item) => acc + (Number(item.qty) || 0), 0);
    const subtotalCents = Number(cart.subtotal ?? cart.subtotalCents ?? 0);
    const currency =
      cart.currency ||
      items.find((item) => item?.product?.currency)?.product?.currency ||
      'EUR';

    return {
      id: cart.id,
      items,
      itemsCount,
      subtotalCents,
      subtotalLabel: formatCents(subtotalCents),
      currency,
    };
  };

  const buildUrl = (path, query) => {
    const normalized = path.startsWith('http')
      ? path
      : `${API_BASE}/${path.replace(/^\//, '')}`;
    const url = new URL(normalized);
    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
          value.forEach((v) => {
            if (v !== undefined && v !== null && v !== '') {
              url.searchParams.append(key, v);
            }
          });
          return;
        }
        url.searchParams.append(key, value);
      });
    }
    return url.toString();
  };

  const buildRequestHeaders = (customHeaders) => {
    return {
      Accept: 'application/json',
      ...(customHeaders || {}),
    };
  };

  const request = async (path, options = {}) => {
    const url = buildUrl(path, options.query);
    const headers = buildRequestHeaders(options.headers);
    const config = {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
    };

    if (options.body !== undefined) {
      config.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, config);
    const text = await response.text();
    const data = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const error = new Error(data?.message || `API error ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  };

  const api = {
    API_BASE,
    formatPrice,
    getFallbackProducts,
  };

  // ===== AUTH =====
  api.register = async (payload) => {
    const data = await request('/api/auth/register', {
      method: 'POST',
      body: payload,
    });
    return data?.user || null;
  };

  api.login = async (credentials) => {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: credentials,
    });
    return data?.user || null;
  };

  api.logout = async () => {
    await request('/api/auth/logout', { method: 'POST' });
  };

  api.getMe = async () => {
    try {
      const data = await request('/api/me');
      // El backend devuelve directamente el usuario "seguro"
      // (id, email, firstName, lastName, etc.)
      return data || null;
    } catch (error) {
      // Si no hay sesión, devolvemos null sin montar error gordo
      if (error && (error.status === 401 || error.statusCode === 401 || error.status === 404)) {
        return null;
      }

      const message =
        (error && error.message) ||
        'Error obteniendo el usuario autenticado';
      console.error('[CRONOX_API.getMe]', message, error);
      throw new Error(message);
    }
  };

  api.getAccreditationStats = async () => {
    const data = await request('/api/membership/me/stats');
    return data || null;
  };

  api.getCircleUpgradeStatus = async () => {
    const data = await request('/api/upgrade/3-4/status');
    return data || null;
  };

  api.requestCirclePromotion = async () => {
    const data = await request('/api/account/circle/request', {
      method: 'POST',
    });
    return data || null;
  };

  api.requestCircleUpgrade = async (payload) => {
    const data = await request('/api/upgrade/3-4', {
      method: 'POST',
      body: payload,
    });
    return data || null;
  };

  api.updateMe = async (payload) => {
    const data = await request('/api/me', {
      method: 'PUT',
      body: payload,
    });
    return data || null;
  };

  api.getDefaultAddress = async () => {
    const data = await request('/api/me/address');
    return data || null;
  };

  api.upsertAddress = async (payload) => {
    const data = await request('/api/me/address', {
      method: 'PUT',
      body: payload,
    });
    return data || null;
  };

  api.getMyOrders = async () => {
    const data = await request('/api/me/orders');
    return Array.isArray(data) ? data : [];
  };

  // ===== ADMIN =====
  const ensureAdminNamespace = () => {
    if (!api.admin) {
      api.admin = {};
    }
    return api.admin;
  };

  const adminApi = ensureAdminNamespace();

  adminApi.listCircleUpgradeRequests = async (status = 'PENDING') => {
    const data = await request('/admin/circle-upgrades/3-4', {
      query: { status },
    });
    return Array.isArray(data) ? data : [];
  };

  adminApi.approveCircleUpgrade = async (id, payload = {}) => {
    return request(`/admin/circle-upgrades/3-4/${encodeURIComponent(id)}/approve`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.denyCircleUpgrade = async (id, payload = {}) => {
    return request(`/admin/circle-upgrades/3-4/${encodeURIComponent(id)}/deny`, {
      method: 'PATCH',
      body: payload,
    });
  };

  // ===== FAVORITES =====
  const normalizeProductId = (value) => { // [FAVORITES_FIX]
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const mapFavoriteProduct = (product) => {
    if (!product) return null;
    const images = Array.isArray(product.images)
      ? product.images.map((img) => img?.url || img?.imageUrl || img).filter(Boolean)
      : [];
    const priceValue = Number(product.price ?? product.priceCents ?? 0);

    return {
      id: product.id ?? product.productId,
      backendId: product.id ?? product.productId,
      slug: product.slug,
      name: product.name,
      price: priceValue,
      priceLabel: product.priceLabel || formatPrice(priceValue),
      image: product.imageUrl || product.image || images[0] || '',
      images,
    };
  };

  api.getFavorites = async () => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    const data = await request('/api/favorites');
    return Array.isArray(data)
      ? data.map((item) => ({
          id: item.id ?? item.productId,
          productId: item.productId ?? item.product?.id,
          createdAt: item.createdAt,
          product: mapFavoriteProduct(item.product),
        }))
      : [];
  };

  api.addFavorite = async (productId) => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    return request('/api/favorites', {
      method: 'POST',
      body: { productId: normalizedId },
    });
  };

  api.toggleFavorite = async (productId) => {
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    return request('/api/favorites/toggle', {
      method: 'POST',
      body: { productId: normalizedId },
    });
  };

  api.removeFavorite = async (productId) => { // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    await request(`/api/favorites/${normalizedId}`, { method: 'DELETE' });
  };

  // ===== CATÁLOGO / PRODUCTOS =====
  api.getProducts = async (query = {}) => {
    try {
      const data = await request('/api/products', { query });
      if (!data || !Array.isArray(data.items)) {
        throw new Error('Formato inesperado de productos');
      }
      return data.items.map((product) => mapProduct(product));
    } catch (error) {
      console.warn('[CRONOX] No se pudo cargar el catálogo desde la API', error);
      throw error;
    }
  };

  api.getProductBySlug = async (slug) => {
    if (!slug) return null;
    const data = await request(`/api/products/${slug}`);
    return mapProduct(data);
  };

  api.getCategories = async (query = {}) => {
    const data = await request('/api/categories', { query });
    return Array.isArray(data?.items) ? data.items : [];
  };

  // ===== CARRITO =====
  api.getCart = async () => {
    const data = await request('/api/cart');
    return mapCart(data);
  };

  api.addCartItem = async ({ variantId, qty }) => {
    const data = await request('/api/cart/items', {
      method: 'POST',
      body: { variantId, qty },
    });
    return mapCart(data);
  };

  api.updateCartItem = async (itemId, qty) => {
    const data = await request(`/api/cart/items/${itemId}`, {
      method: 'PATCH',
      body: { qty },
    });
    return mapCart(data);
  };

  api.removeCartItem = async (itemId) => {
    const data = await request(`/api/cart/items/${itemId}`, { method: 'DELETE' });
    return mapCart(data);
  };

  api.clearCart = async () => {
    const data = await request('/api/cart', { method: 'DELETE' });
    return mapCart(data);
  };

  // ===== ENVÍOS / CHECKOUT =====
  api.getShippingMethods = async (params = {}) => {
    const query = {};

    if (params.country) {
      query.country = params.country;
    }

    if (typeof params.itemsTotalCents === 'number') {
      query.itemsTotal = params.itemsTotalCents;
    }

    const data = await request('/api/shipping-methods', { query });
    return Array.isArray(data)
      ? data.map((method) => ({
          ...method,
          priceLabel: formatCents(
            method.priceCents ?? method.amountCents ?? method.price ?? 0,
          ),
        }))
      : [];
  };

  api.getCheckoutSummary = async (params = {}) => {
    const query = {};

    if (params.shippingMethod) {
      query.shippingMethod = params.shippingMethod;
    }

    const data = await request('/api/checkout/summary', { query });
    const cart = mapCart(data?.cart);
    const methods = Array.isArray(data?.shippingMethods)
      ? data.shippingMethods.map((method) => {
          const rawPrice = Number(method.price ?? 0);
          const priceCents = Number(
            method.priceCents ?? method.amountCents ?? rawPrice ?? 0,
          );
          const amountCents = Number(method.amountCents ?? method.priceCents ?? rawPrice ?? priceCents);
          return {
            ...method,
            priceCents,
            amountCents,
            priceLabel: formatCents(priceCents),
          };
        })
      : [];

    const selectedRaw = data?.selectedShippingMethod;
    const selectedShippingMethod =
      methods.find((method) => {
        if (selectedRaw?.id != null) {
          return method.id === selectedRaw.id;
        }
        if (selectedRaw?.code) {
          return method.code === selectedRaw.code;
        }
        return false;
      }) || selectedRaw || methods[0] || null;

    const totals = {
      subtotalCents: Number(data?.totals?.subtotalCents ?? 0),
      shippingCents: Number(data?.totals?.shippingCents ?? 0),
      totalCents: Number(data?.totals?.totalCents ?? 0),
    };

    return {
      cart,
      currency: data?.currency || 'EUR',
      shippingMethods: methods,
      selectedShippingMethod,
      totals,
    };
  };

  // ===== ADAPTADORES DE PRODUCTO (fallback) =====
  const ensureFallbackList = (list) => {
    if (Array.isArray(list) && list.length) {
      return list.map(cloneProduct);
    }
    return getFallbackProducts();
  };

  const adaptProducts = (rawList, fallbackList) => {
    if (!Array.isArray(rawList)) {
      return [];
    }

    const alreadyMapped = rawList.every((item) => item && item.__fromBackend);
    if (alreadyMapped) {
      return rawList.map(cloneProduct);
    }

    const fallback = ensureFallbackList(fallbackList);

    return rawList.map((item, index) => {
      const source = typeof item === 'object' && item ? item : {};
      const template = cloneProduct(fallback[index % fallback.length] || {});
      const priceValue = source.price != null ? Number(source.price) : Number(template.price) || 0;
      const basePriceLabel = source.priceLabel || template.priceLabel || formatPrice(priceValue);

      const templateImages = Array.isArray(template.images) ? [...template.images] : [];
      const sourceImages = Array.isArray(source.images) ? [...source.images] : [];
      const mergedImages = sourceImages.length ? sourceImages : templateImages;
      const candidateImage = source.image || mergedImages[0] || template.image || templateImages[0] || '';
      const uniqueImages = [];
      const pushImage = (value) => {
        const clean = typeof value === 'string' ? value.trim() : '';
        if (clean && !uniqueImages.includes(clean)) {
          uniqueImages.push(clean);
        }
      };
      pushImage(candidateImage);
      mergedImages.forEach(pushImage);

      return {
        ...template,
        ...source,
        id: source.id != null ? String(source.id) : template.id || `product-${index + 1}`,
        name: source.name || template.name || 'Producto CRONOX',
        price: priceValue,
        priceLabel: basePriceLabel || formatPrice(priceValue),
        image: candidateImage || uniqueImages[0] || template.image || '',
        images: uniqueImages,
        categories: Array.isArray(source.categories) && source.categories.length
          ? source.categories
          : template.categories || [],
        sizes: Array.isArray(source.sizes) && source.sizes.length
          ? source.sizes
          : template.sizes || [],
        colors: Array.isArray(source.colors) && source.colors.length
          ? source.colors
          : template.colors || [],
        color: source.color || template.color || '',
        desc: source.desc || template.desc || '',
      };
    });
  };

  api.adaptProducts = adaptProducts;
  api.ensureFallbackList = ensureFallbackList;
  api.cloneProduct = cloneProduct;

  g.CRONOX_API = api;
  g.CRONOX_API_BASE = API_BASE;
})(typeof window !== 'undefined' ? window : this);
