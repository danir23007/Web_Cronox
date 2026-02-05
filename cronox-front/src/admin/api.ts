(() => {
  type UnknownRecord = Record<string, unknown>;

  interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    query?: QueryRecord;
  }

  const g = typeof window !== 'undefined' ? window : (globalThis as Window);

  const formatPrice = (value: number): string => {
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

  const cloneProduct = (product: UnknownRecord = {}): UnknownRecord => {
    const copy: UnknownRecord = { ...product };
    if (Array.isArray(product.images)) copy.images = [...product.images];
    if (Array.isArray(product.sizes)) copy.sizes = [...product.sizes];
    if (Array.isArray(product.colors)) copy.colors = [...product.colors];
    if (Array.isArray(product.categories)) copy.categories = [...product.categories];
    if (Array.isArray(product.variants)) {
      copy.variants = product.variants.map((variant) => ({ ...(variant as UnknownRecord) }));
    }
    if (product.variantMap && typeof product.variantMap === 'object') {
      copy.variantMap = Object.entries(product.variantMap as Record<string, UnknownRecord>).reduce(
        (acc, [key, value]) => {
          acc[key] = { ...value };
          return acc;
        },
        {} as Record<string, UnknownRecord>,
      );
    }
    return copy;
  };

  const getFallbackProducts = () => FALLBACK_SOURCE.map((product) => cloneProduct(product));

  const readManualBase = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return '';

    const globalBase =
      typeof window.__CRONOX_API_BASE__ === 'string' ? window.__CRONOX_API_BASE__.trim() : '';
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
    if (
      script &&
      typeof script.dataset.cronoxApiBase === 'string' &&
      script.dataset.cronoxApiBase.trim()
    ) {
      return script.dataset.cronoxApiBase.trim();
    }

    return '';
  };

  const detectLocalhostPort = (fallbackPort = '3000') => {
    if (typeof window === 'undefined') return fallbackPort;
    const raw =
      window.__CRONOX_BACKEND_PORT__ != null ? String(window.__CRONOX_BACKEND_PORT__).trim() : '';
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

    const normalizePort = (value?: string | number) => {
      if (!value) return '';
      const raw = String(value).trim();
      if (!raw) return '';
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return '';
      const defaultPort = protocol === 'https:' ? 443 : 80;
      if (num === defaultPort) return '';
      return String(num);
    };

    const safeJoin = (baseProtocol: string, host: string, basePort = '') => {
      const p = normalizePort(basePort);
      return `${baseProtocol}//${host}${p ? `:${p}` : ''}`;
    };

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      const backendPort = normalizePort(detectLocalhostPort('3000')) || '3000';
      return safeJoin(protocol, hostname, backendPort);
    }

    if (
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
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

  const normalizeBase = (base: string) => (base || '').replace(/\/$/, '');
  const API_BASE = normalizeBase(detectApiBase());

  const safeJsonParse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  };

  const centsToUnits = (value: number) => (Number(value) || 0) / 100;
  const formatCents = (cents: number) => formatPrice(centsToUnits(cents));

  const pickPrimaryImage = (images: Array<{ url?: string; sortOrder?: number; isPrimary?: boolean }> = [], fallback = '') => {
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

  const normalizeSizeKey = (value?: string | number) => String(value || '').trim().toUpperCase();

  const mapVariant = (variant: UnknownRecord = {}, fallbackPriceCents = 0) => {
    const effectivePriceCents = Number(variant.effectivePrice ?? fallbackPriceCents ?? 0);
    const sizeKey = normalizeSizeKey(variant.size as string | number | undefined);
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

  const mapProduct = (product?: UnknownRecord | null) => {
    if (!product) return null;

    const images = Array.isArray(product.images)
      ? (product.images as Array<{ url?: string }>).map((img) => img?.url).filter(Boolean)
      : [];
    const primaryImage = pickPrimaryImage(
      (product.images as Array<{ url?: string; sortOrder?: number; isPrimary?: boolean }>) || [],
      (product.imageUrl as string) || images[0] || '',
    );
    const rawVariants = Array.isArray(product.variants) ? (product.variants as UnknownRecord[]) : [];
    const variants = rawVariants.map((variant) => mapVariant(variant, product.price as number));
    const variantMap = variants.reduce((acc, variant) => {
      if (variant.sizeKey) {
        acc[variant.sizeKey] = variant;
      }
      return acc;
    }, {} as Record<string, ReturnType<typeof mapVariant>>);

    const categories = Array.isArray(product.categories)
      ? (product.categories as UnknownRecord[])
          .map((relation) => {
            if (relation?.category && typeof relation.category === 'object') {
              const category = relation.category as UnknownRecord;
              if (category.slug) return category.slug as string;
              if (category.name) return category.name as string;
            }
            if (relation?.slug) return relation.slug as string;
            if (relation?.name) return relation.name as string;
            return undefined;
          })
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
      : [];

    const sizes = variants.length
      ? variants.map((variant) => variant.size).filter(Boolean)
      : Array.isArray(product.sizes)
        ? (product.sizes as unknown[])
        : [];

    return {
      __fromBackend: true,
      id: String(product.slug ?? product.id ?? ''),
      backendId: product.id,
      slug: product.slug,
      name: product.name,
      priceCents: product.price,
      price: centsToUnits(product.price as number),
      priceLabel: formatCents(product.price as number),
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

  const mapCartItem = (item: UnknownRecord = {}) => {
    const variant = (item.variant as UnknownRecord) || {};
    const product = (variant.product as UnknownRecord) || {};
    const priceCents = Number(item.priceAtAdd ?? variant.price ?? product.price ?? 0);
    const productImages = Array.isArray(product.images)
      ? (product.images as Array<{ url?: string }>).map((img) => (typeof img?.url === 'string' ? { url: img.url } : null)).filter(Boolean)
      : [];
    const productImage =
      (product.imageUrl as string) ||
      pickPrimaryImage((product.images as Array<{ url?: string; sortOrder?: number; isPrimary?: boolean }>) || []) ||
      productImages[0]?.url ||
      '';

    const itemImages = Array.isArray(item.images)
      ? (item.images as Array<{ url?: string }>).map((img) => (typeof img?.url === 'string' ? { url: img.url } : null)).filter(Boolean)
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

  const mapCart = (cart?: UnknownRecord | null) => {
    if (!cart) {
      return { id: null, items: [], itemsCount: 0, subtotalCents: 0, subtotalLabel: formatCents(0) };
    }

    const items = Array.isArray(cart.items) ? (cart.items as UnknownRecord[]).map(mapCartItem) : [];
    const itemsCount = typeof cart.itemsCount === 'number'
      ? cart.itemsCount
      : items.reduce((acc, item) => acc + (Number(item.qty) || 0), 0);
    const subtotalCents = Number(cart.subtotal ?? cart.subtotalCents ?? 0);
    const currency = cart.currency || items.find((item) => item?.product?.currency)?.product?.currency || 'EUR';

    return {
      id: cart.id,
      items,
      itemsCount,
      subtotalCents,
      subtotalLabel: formatCents(subtotalCents),
      currency,
    };
  };

  const buildUrl = (path: string, query?: QueryRecord) => {
    const normalized = path.startsWith('http') ? path : `${API_BASE}/${path.replace(/^\//, '')}`;
    const url = new URL(normalized);
    if (query && typeof query === 'object') {
      Object.entries(query).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) {
          value.forEach((v) => {
            if (v !== undefined && v !== null && v !== '') {
              url.searchParams.append(key, String(v));
            }
          });
          return;
        }
        url.searchParams.append(key, String(value));
      });
    }
    return url.toString();
  };

  const buildRequestHeaders = (customHeaders?: Record<string, string>) => {
    return {
      Accept: 'application/json',
      ...(customHeaders || {}),
    };
  };

  const request = async <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => {
    const url = buildUrl(path, options.query);
    const headers = buildRequestHeaders(options.headers);
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const config: RequestInit = {
      method: options.method || 'GET',
      headers,
      credentials: 'include',
    };

    if (options.body !== undefined) {
      if (isFormData) {
        config.body = options.body as BodyInit;
      } else {
        config.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    try {
      const response = await fetch(url, config);
      const text = await response.text();
      const data = text ? safeJsonParse(text) : null;

      if (!response.ok) {
        const error = new Error((data as { message?: string })?.message || `API error ${response.status}`) as CronoxApiError;
        error.status = response.status;
        error.endpoint = url;
        error.payload = data ?? null;
        throw error;
      }

      return data as T;
    } catch (error) {
      const err = error as CronoxApiError;
      if (err && typeof err === 'object') {
        if (err.status == null) err.status = 0;
        if (!err.endpoint) err.endpoint = url;
        if (err.payload === undefined) {
          err.payload = options.body && typeof options.body === 'object' ? options.body : null;
        }
        if (!err.message) {
          err.message = 'Error de red o de conexión';
        }
      }
      throw err;
    }
  };

  const classifyApiError = (error: CronoxApiError = {}) => {
    const status = Number(error.status || error.statusCode || 0);
    const message = (error && error.message) || '';
    const payloadMessage = (error as { payload?: { message?: string; error?: string } })?.payload?.message ||
      (error as { payload?: { message?: string; error?: string } })?.payload?.error;

    const base: CronoxApiErrorClassification = {
      kind: 'unknown',
      severity: 'error',
      userMessage: 'Ha ocurrido un error inesperado.',
      isRetryable: true,
    };

    if (!status || status === 0 || error?.name === 'TypeError') {
      return {
        ...base,
        kind: 'network',
        userMessage: 'No pudimos conectar con el servidor. Revisa tu conexión o la API.',
        isRetryable: true,
      };
    }

    if (status === 401 || status === 403) {
      return {
        ...base,
        kind: 'auth',
        userMessage: 'Tu sesión expiró o no tienes permisos para esta acción.',
        isRetryable: false,
      };
    }

    if (status === 404) {
      return {
        ...base,
        kind: 'not-found',
        userMessage: 'Este módulo aún no está disponible en backend.',
        isRetryable: false,
        severity: 'warning',
      };
    }

    if (status >= 500) {
      return {
        ...base,
        kind: 'server',
        userMessage: 'El servidor tuvo un error interno. Puedes reintentar.',
        isRetryable: true,
      };
    }

    if (status === 400 || status === 422) {
      return {
        ...base,
        kind: 'validation',
        userMessage: payloadMessage || 'Los datos enviados no son válidos.',
        isRetryable: false,
        severity: 'warning',
      };
    }

    if (message && /fetch|network|cors|dns/i.test(message)) {
      return {
        ...base,
        kind: 'network',
        userMessage: 'No pudimos conectar con el servidor. Revisa tu conexión o la API.',
        isRetryable: true,
      };
    }

    return base;
  };

  const api: CronoxApi = {
    API_BASE,
    formatPrice,
    getFallbackProducts,
    classifyApiError,
  };

  // ===== AUTH =====
  api.register = async (payload: UnknownRecord) => {
    const data = await request<UnknownRecord>('/api/auth/register', {
      method: 'POST',
      body: payload,
    });
    return (data as { user?: UnknownRecord })?.user || null;
  };

  api.login = async (credentials: UnknownRecord) => {
    const data = await request<UnknownRecord>('/api/auth/login', {
      method: 'POST',
      body: credentials,
    });
    return (data as { user?: UnknownRecord })?.user || null;
  };

  api.logout = async () => {
    await request('/api/auth/logout', { method: 'POST' });
  };

  api.getMe = async () => {
    try {
      const data = await request<UnknownRecord>('/api/me');
      return data || null;
    } catch (error) {
      const err = error as CronoxApiError;
      if (err && (err.status === 401 || err.statusCode === 401 || err.status === 404)) {
        return null;
      }
      const message = (err && err.message) || 'Error obteniendo el usuario autenticado';
      console.error('[CRONOX_API.getMe]', message, err);
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

  api.requestCircleUpgrade = async (payload: UnknownRecord) => {
    const data = await request('/api/upgrade/3-4', {
      method: 'POST',
      body: payload,
    });
    return data || null;
  };

  api.updateMe = async (payload: UnknownRecord) => {
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

  api.upsertAddress = async (payload: UnknownRecord) => {
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

  adminApi.getDashboard = async () => {
    return request('/api/admin/dashboard');
  };

  adminApi.listCircleUpgradeRequests = async (queryOrStatus: string | QueryRecord = 'PENDING', queryOverride: QueryRecord = {}) => {
    const query =
      typeof queryOrStatus === 'string'
        ? { status: queryOrStatus, ...queryOverride }
        : { ...queryOrStatus };
    return request('/api/admin/circle-upgrades/3-4', { query });
  };

  adminApi.approveCircleUpgrade = async (id: number | string, payload: UnknownRecord = {}) => {
    return request(`/api/admin/circle-upgrades/3-4/${encodeURIComponent(id)}/approve`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.denyCircleUpgrade = async (id: number | string, payload: UnknownRecord = {}) => {
    return request(`/api/admin/circle-upgrades/3-4/${encodeURIComponent(id)}/deny`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.listAutoCircleRequests = async (queryOrStatus: string | QueryRecord = 'PENDING', queryOverride: QueryRecord = {}) => {
    const query =
      typeof queryOrStatus === 'string'
        ? { status: queryOrStatus, ...queryOverride }
        : { ...queryOrStatus };
    return request('/api/admin/requests/2-3', { query });
  };

  adminApi.listAdminProducts = async (query: QueryRecord = {}) => {
    return request('/api/admin/products', { query });
  };

  adminApi.getAdminProduct = async (id: number | string) => {
    return request(`/api/admin/products/${encodeURIComponent(id)}`);
  };

  adminApi.createAdminProduct = async (payload: UnknownRecord) => {
    return request('/api/admin/products', {
      method: 'POST',
      body: payload,
    });
  };

  adminApi.updateAdminProduct = async (id: number | string, payload: UnknownRecord) => {
    return request(`/api/admin/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.deleteAdminProduct = async (id: number | string) => {
    return request(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
  };

  adminApi.uploadProductImages = async (files: File[] = []) => {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    return request('/api/admin/products/upload-images', {
      method: 'POST',
      body: formData,
    });
  };

  adminApi.listPromoCodes = async (query: QueryRecord = {}) => {
    return request('/api/admin/promo-codes', { query });
  };

  adminApi.getAuditLogs = async (query: QueryRecord = {}) => {
    return request('/api/admin/audit-logs', { query });
  };

  adminApi.getUserDetail = async (id: number | string) => {
    return request(`/api/admin/users/${encodeURIComponent(id)}`);
  };

  adminApi.getUserAuditLogs = async (id: number | string) => {
    return request(`/api/admin/users/${encodeURIComponent(id)}/audit-logs`);
  };

  // ✅ FIX: Endpoints por usuario (Solicitudes / Pedidos)
  adminApi.getUserRequests = async (id: number | string, query: QueryRecord = {}) => {
    if (id == null || id === '') {
      const error = new Error('userId requerido') as CronoxApiError;
      error.status = 400;
      error.endpoint = 'admin.getUserRequests';
      throw error;
    }
    return request<AdminUserRequestsResponse>(`/api/admin/users/${encodeURIComponent(id)}/requests`, { query });
  };

  adminApi.getUserOrders = async (id: number | string, query: QueryRecord = {}) => {
    if (id == null || id === '') {
      const error = new Error('userId requerido') as CronoxApiError;
      error.status = 400;
      error.endpoint = 'admin.getUserOrders';
      throw error;
    }
    return request<AdminUserOrdersResponse>(`/api/admin/users/${encodeURIComponent(id)}/orders`, { query });
  };

  adminApi.listAdminOrders = async (query: QueryRecord = {}) => {
    return request('/api/admin/orders', { query });
  };

  adminApi.listUsers = async (query: QueryRecord = {}) => {
    return request('/api/admin/users', { query });
  };

  adminApi.getUserList = async (query: QueryRecord = {}) => {
    return request('/api/admin/users', { query });
  };

  adminApi.listAdminNotes = async (query: QueryRecord = {}) => {
    return request('/api/admin/notes', { query });
  };

  adminApi.createAdminNote = async (payload: UnknownRecord) => {
    return request('/api/admin/notes', {
      method: 'POST',
      body: payload,
    });
  };

  adminApi.updateAdminNote = async (id: number | string, payload: UnknownRecord) => {
    return request(`/api/admin/notes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.deleteAdminNote = async (id: number | string) => {
    return request(`/api/admin/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  };

  adminApi.createPromoCode = async (payload: UnknownRecord) => {
    return request('/api/admin/promo-codes', {
      method: 'POST',
      body: payload,
    });
  };

  adminApi.updatePromoCode = async (id: number | string, payload: UnknownRecord) => {
    return request(`/api/admin/promo-codes/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload,
    });
  };

  adminApi.deletePromoCode = async (id: number | string) => {
    return request(`/api/admin/promo-codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  };

  // ===== FAVORITES =====
  const normalizeProductId = (value: unknown) => {
    // [FAVORITES_FIX]
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const mapFavoriteProduct = (product: UnknownRecord) => {
    if (!product) return null;
    const images = Array.isArray(product.images)
      ? (product.images as Array<{ url?: string; imageUrl?: string }>).map((img) => img?.url || img?.imageUrl || img).filter(Boolean)
      : [];
    const priceValue = Number(product.price ?? product.priceCents ?? 0);

    return {
      id: product.id ?? product.productId,
      backendId: product.id ?? product.productId,
      slug: product.slug,
      name: product.name,
      price: priceValue,
      priceLabel: (product.priceLabel as string) || formatPrice(priceValue),
      image: (product.imageUrl as string) || (product.image as string) || (images[0] as string) || '',
      images,
    };
  };

  api.getFavorites = async () => {
    // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
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

  api.addFavorite = async (productId: unknown) => {
    // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    return request('/api/favorites', {
      method: 'POST',
      body: { productId: normalizedId },
    });
  };

  api.toggleFavorite = async (productId: unknown) => {
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    return request('/api/favorites/toggle', {
      method: 'POST',
      body: { productId: normalizedId },
    });
  };

  api.removeFavorite = async (productId: unknown) => {
    // [FAVORITES_BACKEND_ONLY] [FAVORITES_FIX]
    const normalizedId = normalizeProductId(productId);
    if (normalizedId == null) throw new Error('productId inválido para favoritos');

    await request(`/api/favorites/${normalizedId}`, { method: 'DELETE' });
  };

  // ===== CATÁLOGO / PRODUCTOS =====
  api.getProducts = async (query: QueryRecord = {}) => {
    try {
      const data = await request('/api/products', { query });
      if (!data || !Array.isArray((data as { items?: unknown[] }).items)) {
        throw new Error('Formato inesperado de productos');
      }
      return (data as { items: UnknownRecord[] }).items.map((product) => mapProduct(product));
    } catch (error) {
      console.warn('[CRONOX] No se pudo cargar el catálogo desde la API', error);
      throw error;
    }
  };

  api.getProductBySlug = async (slug: string) => {
    if (!slug) return null;
    const data = await request(`/api/products/${slug}`);
    return mapProduct(data as UnknownRecord);
  };

  api.getCategories = async (query: QueryRecord = {}) => {
    const data = await request('/api/categories', { query });
    return Array.isArray((data as { items?: unknown[] })?.items) ? (data as { items: unknown[] }).items : [];
  };

  // ===== CARRITO =====
  api.getCart = async () => {
    const data = await request('/api/cart');
    return mapCart(data as UnknownRecord);
  };

  api.addCartItem = async ({ variantId, qty }: { variantId: number | string; qty: number }) => {
    const data = await request('/api/cart/items', {
      method: 'POST',
      body: { variantId, qty },
    });
    return mapCart(data as UnknownRecord);
  };

  api.updateCartItem = async (itemId: number | string, qty: number) => {
    const data = await request(`/api/cart/items/${itemId}`, {
      method: 'PATCH',
      body: { qty },
    });
    return mapCart(data as UnknownRecord);
  };

  api.removeCartItem = async (itemId: number | string) => {
    const data = await request(`/api/cart/items/${itemId}`, { method: 'DELETE' });
    return mapCart(data as UnknownRecord);
  };

  api.clearCart = async () => {
    const data = await request('/api/cart', { method: 'DELETE' });
    return mapCart(data as UnknownRecord);
  };

  // ===== ENVÍOS / CHECKOUT =====
  api.getShippingMethods = async (params: { country?: string; itemsTotalCents?: number } = {}) => {
    const query: QueryRecord = {};

    if (params.country) {
      query.country = params.country;
    }

    if (typeof params.itemsTotalCents === 'number') {
      query.itemsTotal = params.itemsTotalCents;
    }

    const data = await request('/api/shipping-methods', { query });
    return Array.isArray(data)
      ? data.map((method: UnknownRecord) => ({
          ...method,
          priceLabel: formatCents(Number(method.priceCents ?? method.amountCents ?? method.price ?? 0)),
        }))
      : [];
  };

  api.getCheckoutSummary = async (params: { shippingMethod?: string; promoCode?: string } = {}) => {
    const query: QueryRecord = {};

    if (params.shippingMethod) {
      query.shippingMethod = params.shippingMethod;
    }
    if (params.promoCode) {
      query.promoCode = params.promoCode;
    }

    const data = (await request('/api/checkout/summary', { query })) as UnknownRecord;
    const cart = mapCart(data?.cart as UnknownRecord);
    const methods = Array.isArray(data?.shippingMethods)
      ? (data.shippingMethods as UnknownRecord[]).map((method) => {
          const rawPrice = Number(method.price ?? 0);
          const priceCents = Number(method.priceCents ?? method.amountCents ?? rawPrice ?? 0);
          const amountCents = Number(method.amountCents ?? method.priceCents ?? rawPrice ?? priceCents);
          return {
            ...method,
            priceCents,
            amountCents,
            priceLabel: formatCents(priceCents),
          };
        })
      : [];

    const selectedRaw = data?.selectedShippingMethod as UnknownRecord | undefined;
    const selectedShippingMethod =
      methods.find((method: UnknownRecord) => {
        if (selectedRaw?.id != null) {
          return method.id === selectedRaw.id;
        }
        if (selectedRaw?.code) {
          return method.code === selectedRaw.code;
        }
        return false;
      }) ||
      selectedRaw ||
      methods[0] ||
      null;

    const totals = {
      subtotalCents: Number((data?.totals as UnknownRecord)?.subtotalCents ?? 0),
      shippingCents: Number((data?.totals as UnknownRecord)?.shippingCents ?? 0),
      discountCents: Number((data?.totals as UnknownRecord)?.discountCents ?? 0),
      totalCents: Number((data?.totals as UnknownRecord)?.totalCents ?? 0),
    };

    return {
      cart,
      currency: (data?.currency as string) || 'EUR',
      shippingMethods: methods,
      selectedShippingMethod,
      totals,
      appliedPromo: data?.appliedPromo ?? null,
    };
  };

  api.applyPromoCode = async (payload: { code?: string; shippingMethod?: string } = {}) => {
    const body: Record<string, unknown> = {
      code: payload.code,
    };

    if (payload.shippingMethod) {
      body.shippingMethod = payload.shippingMethod;
    }

    return request('/api/checkout/apply-promo', {
      method: 'POST',
      body,
    });
  };

  // ===== ADAPTADORES DE PRODUCTO (fallback) =====
  const ensureFallbackList = (list?: UnknownRecord[]) => {
    if (Array.isArray(list) && list.length) {
      return list.map(cloneProduct);
    }
    return getFallbackProducts();
  };

  const adaptProducts = (rawList: UnknownRecord[], fallbackList: UnknownRecord[]) => {
    if (!Array.isArray(rawList)) {
      return [];
    }

    const alreadyMapped = rawList.every((item) => item && (item as { __fromBackend?: boolean }).__fromBackend);
    if (alreadyMapped) {
      return rawList.map(cloneProduct);
    }

    const fallback = ensureFallbackList(fallbackList);

    return rawList.map((item, index) => {
      const source = typeof item === 'object' && item ? item : {};
      const template = cloneProduct((fallback[index % fallback.length] || {}) as UnknownRecord);
      const priceValue = source.price != null ? Number(source.price) : Number(template.price) || 0;
      const basePriceLabel = source.priceLabel || template.priceLabel || formatPrice(priceValue);

      const templateImages = Array.isArray(template.images) ? [...template.images] : [];
      const sourceImages = Array.isArray(source.images) ? [...source.images] : [];
      const mergedImages = sourceImages.length ? sourceImages : templateImages;
      const candidateImage = source.image || mergedImages[0] || template.image || templateImages[0] || '';
      const uniqueImages: string[] = [];
      const pushImage = (value: unknown) => {
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
        categories:
          Array.isArray(source.categories) && source.categories.length ? source.categories : template.categories || [],
        sizes: Array.isArray(source.sizes) && source.sizes.length ? source.sizes : template.sizes || [],
        colors: Array.isArray(source.colors) && source.colors.length ? source.colors : template.colors || [],
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
})();
