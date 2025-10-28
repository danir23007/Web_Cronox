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

  const cloneProduct = (product = {}) => {
    const copy = { ...product };
    if (Array.isArray(product.images)) copy.images = [...product.images];
    if (Array.isArray(product.sizes)) copy.sizes = [...product.sizes];
    if (Array.isArray(product.colors)) copy.colors = [...product.colors];
    if (Array.isArray(product.categories)) copy.categories = [...product.categories];
    return copy;
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

  const getFallbackProducts = () => FALLBACK_SOURCE.map(cloneProduct);

  const detectApiBase = () => {
    if (typeof window === 'undefined') {
      return 'http://localhost:3000';
    }

    const { protocol, hostname } = window.location;
    if (/\.app\.github\.dev$/i.test(hostname)) {
      const match = hostname.match(/^(.*)-(\d+)\.app\.github\.dev$/i);
      if (match && match[1]) {
        return `${protocol}//${match[1]}-3000.app.github.dev`;
      }
    }

    return 'http://localhost:3000';
  };

  const normalizeBase = (base) => base.replace(/\/$/, '');

  const API_BASE = normalizeBase(detectApiBase());

  async function getProducts() {
    const endpoint = `${normalizeBase(API_BASE)}/products`;
    let response;
    try {
      response = await fetch(endpoint, {
        headers: {
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new Error(`No se pudo conectar con la API de productos: ${error?.message || error}`);
    }

    if (!response.ok) {
      throw new Error(`La API de productos respondió con ${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error('No se pudo interpretar la respuesta de la API de productos.');
    }

    if (!Array.isArray(data)) {
      throw new Error('La API de productos devolvió un formato inesperado.');
    }

    return data;
  }

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

  const api = {
    API_BASE,
    getProducts,
    adaptProducts,
    getFallbackProducts,
    formatPrice,
  };

  g.CRONOX_API = api;
  g.CRONOX_API_BASE = API_BASE;
})(typeof window !== 'undefined' ? window : this);
