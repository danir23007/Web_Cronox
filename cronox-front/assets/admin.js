(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const requestsBody = $('#requestsBody');
  const messageBox = $('#messageBox');
  const filterStatus = $('#filterStatus');
  const requestsBody23 = $('#requestsBody23');
  const messageBox23 = $('#messageBox23');
  const filterStatus23 = $('#filterStatus23');
  const tabs = document.querySelectorAll('#adminTabs button');
  const logoutBtn = $('#logoutBtn');
  const backBtn = $('#backBtn');
  const loadingRow = '<tr><td colspan="8" class="empty">Cargando solicitudes…</td></tr>';
  const productsBody = $('#productsBody');
  const productsMessage = $('#productsMessage');
  const productSearch = $('#productSearch');
  const productStatusFilter = $('#productStatusFilter');
  const createProductBtn = $('#createProductBtn');
  const productModal = $('#productModal');
  const productModalTitle = $('#productModalTitle');
  const productForm = $('#productForm');
  const productImagesInput = $('#productImages');
  const productImagesPreview = $('#productImagesPreview');
  const productCancelBtn = $('#productCancelBtn');
  const productSubmitBtn = $('#productSubmitBtn');
  const codesBody = $('#codesBody');
  const codesMessage = $('#codesMessage');
  const codeSearch = $('#codeSearch');
  const codeStatusFilter = $('#codeStatusFilter');
  const createCodeBtn = $('#createCodeBtn');
  const codeModal = $('#codeModal');
  const codeModalTitle = $('#codeModalTitle');
  const codeForm = $('#codeForm');
  const codeCancelBtn = $('#codeCancelBtn');
  const codeSubmitBtn = $('#codeSubmitBtn');
  const productsState = { page: 1, limit: 20, search: '', isActive: '' };
  const codesState = { page: 1, limit: 20, search: '', isActive: '' };
  let editingProductId = null;
  let editingCodeId = null;
  let cachedProductImages = [];
  let codesCache = [];
  let productSearchTimeout = null;
  let codeSearchTimeout = null;

  const setMessage = (text = '', type = 'success') => {
    if (!messageBox) return;
    if (!text) {
      messageBox.className = 'message';
      messageBox.textContent = '';
      return;
    }
    messageBox.textContent = text;
    messageBox.className = `message show ${type === 'error' ? 'error' : 'success'}`;
  };

  const setScopedMessage = (el, text = '', type = 'success') => {
    if (!el) return;
    if (!text) {
      el.className = 'message';
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.className = `message show ${type === 'error' ? 'error' : 'success'}`;
  };

  const redirectToHome = () => {
    window.location.href = 'index.html';
  };

  const ensureAdmin = async () => {
    if (!window.CRONOX_API?.getMe) {
      redirectToHome();
      return null;
    }
    const user = await window.CRONOX_API.getMe();
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPERADMIN')) {
      redirectToHome();
      return null;
    }
    return user;
  };

  const statusBadge = (status) => {
    const normalized = String(status || '').toUpperCase();
    const cls = normalized === 'APPROVED' ? 'approved' : normalized === 'DENIED' ? 'denied' : 'pending';
    const label = normalized === 'APPROVED' ? 'APPROVED' : normalized === 'DENIED' ? 'DENIED' : 'PENDING';
    return `<span class="status ${cls}">${label}</span>`;
  };

  const formatDate = (value) => {
    if (!value) return '';
    try {
      const date = new Date(value);
      return date.toLocaleString('es-ES');
    } catch (e) {
      return value;
    }
  };

  const formatDuration = (ms) => {
    if (ms <= 0) return 'Expirado';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const formatMoney = (cents) => {
    const value = Number(cents || 0) / 100;
    if (window.CRONOX_API?.formatPrice) {
      try {
        return window.CRONOX_API.formatPrice(value);
      } catch (e) {
        // ignore
      }
    }
    return `${value.toFixed(2)} €`;
  };

  const setLoading = (isLoading) => {
    if (!requestsBody) return;
    if (isLoading) {
      requestsBody.innerHTML = loadingRow;
    }
  };

  const setLoading23 = (isLoading) => {
    if (!requestsBody23) return;
    if (isLoading) {
      requestsBody23.innerHTML = '<tr><td colspan="6" class="empty">Cargando solicitudes…</td></tr>';
    }
  };

  const toggleModal = (modalEl, open) => {
    if (!modalEl) return;
    if (open) {
      modalEl.classList.add('show');
    } else {
      modalEl.classList.remove('show');
    }
  };

  const renderRequests = (items, options = { error: false }) => {
    if (!requestsBody) return;
    if (options.error) {
      requestsBody.innerHTML = `
        <tr>
          <td colspan="8" class="empty">
            No se pudieron cargar las solicitudes.
            <button type="button" class="btn" data-retry="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>
      `;
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      requestsBody.innerHTML = '<tr><td colspan="8" class="empty">No hay solicitudes con ese estado.</td></tr>';
      return;
    }

    requestsBody.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const isPending = req.status === 'PENDING';
        const actions = isPending
          ? `<div class="actions">
              <button class="btn primary" data-action="approve" data-id="${req.id}">APROBAR</button>
              <button class="btn danger" data-action="deny" data-id="${req.id}">DENEGAR</button>
            </div>`
          : '<span style="color:#7b7f8f;">—</span>';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;

        return `<tr>
          <td>${formatDate(req.createdAt)}</td>
          <td>${userName || '—'}</td>
          <td>${req.userId}</td>
          <td>${req.socialNetwork}</td>
          <td>${req.username}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join('');
  };

  const renderRequests23 = (items, options = { error: false }) => {
    if (!requestsBody23) return;
    if (options.error) {
      requestsBody23.innerHTML = `
        <tr>
          <td colspan="6" class="empty">
            No se pudieron cargar las solicitudes.
            <button type="button" class="btn" data-retry-23="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>
      `;
      return;
    }
    if (!Array.isArray(items) || !items.length) {
      requestsBody23.innerHTML = '<tr><td colspan="6" class="empty">No hay solicitudes con ese estado.</td></tr>';
      return;
    }

    requestsBody23.innerHTML = items
      .map((req) => {
        const userName = req.user?.firstName || req.user?.lastName
          ? `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim()
          : req.user?.email || '';
        const remaining = typeof req.remainingMs === 'number' ? formatDuration(req.remainingMs) : '—';
        const attemptLabel = req.requestNumber == null ? '—' : `#${req.requestNumber}`;
        return `<tr>
          <td>${formatDate(req.createdAt)}</td>
          <td>${userName || '—'}</td>
          <td>${req.userId}</td>
          <td>${statusBadge(req.status)}</td>
          <td>${attemptLabel}</td>
          <td>${remaining}</td>
        </tr>`;
      })
      .join('');
  };

  const fetchRequests = async () => {
    setLoading(true);
    setMessage('');
    const status = filterStatus?.value || 'PENDING';
    try {
      const data = await window.CRONOX_API?.admin?.listCircleUpgradeRequests(status);
      renderRequests(data || []);
    } catch (error) {
      console.error('[ADMIN] Error cargando solicitudes', error);
      setMessage('No se pudieron cargar las solicitudes.', 'error');
      renderRequests([], { error: true });
    }
  };

  const fetchRequests23 = async () => {
    setLoading23(true);
    if (messageBox23) {
      messageBox23.textContent = '';
      messageBox23.className = 'message';
    }
    const status = filterStatus23?.value || 'PENDING';
    try {
      const data = await window.CRONOX_API?.admin?.listAutoCircleRequests(status);
      renderRequests23(data || []);
    } catch (error) {
      console.error('[ADMIN] Error cargando solicitudes 2->3', error);
      if (messageBox23) {
        messageBox23.textContent = 'No se pudieron cargar las solicitudes 2→3.';
        messageBox23.className = 'message show error';
      }
      renderRequests23([], { error: true });
    }
  };

  const renderProductImagesPreview = (urls = []) => {
    if (!productImagesPreview) return;
    if (!urls.length) {
      productImagesPreview.innerHTML = '<p class="empty" style="margin:0;">Sin imágenes seleccionadas.</p>';
      return;
    }

    productImagesPreview.innerHTML = urls
      .map(
        (url) => `
          <div class="image-thumb">
            <img src="${url}" alt="preview" />
          </div>
        `,
      )
      .join('');
  };

  const collectVariantPayload = () => {
    const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    return sizes.map((size) => {
      const input = document.getElementById(`stock${size}`);
      const stock = Number(input?.value || 0);
      return { size, stockQty: Number.isFinite(stock) ? stock : 0 };
    });
  };

  const resetProductForm = () => {
    editingProductId = null;
    cachedProductImages = [];
    productForm?.reset();
    renderProductImagesPreview([]);
    if (productModalTitle) productModalTitle.textContent = 'Crear producto';
    if (productSubmitBtn) productSubmitBtn.disabled = false;
  };

  const fetchProducts = async () => {
    if (!productsBody) return;
    productsBody.innerHTML = '<tr><td colspan="6" class="empty">Cargando productos…</td></tr>';
    setScopedMessage(productsMessage, '');
    const query = {
      page: productsState.page,
      limit: productsState.limit,
      search: productsState.search || undefined,
      isActive: productsState.isActive || undefined,
    };
    try {
      const data = await window.CRONOX_API?.admin?.listAdminProducts(query);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      renderProducts(items);
    } catch (error) {
      console.error('[ADMIN] Error cargando productos', error);
      setScopedMessage(productsMessage, 'No se pudieron cargar los productos.', 'error');
      productsBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty">
            Error al cargar productos.
            <button type="button" class="btn" data-retry-products="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>`;
    }
  };

  const renderProducts = (items = []) => {
    if (!productsBody) return;
    if (!items.length) {
      productsBody.innerHTML = '<tr><td colspan="6" class="empty">No hay productos con esos filtros.</td></tr>';
      return;
    }

    productsBody.innerHTML = items
      .map((product) => {
        const totalStock = Array.isArray(product.variants)
          ? product.variants.reduce((acc, variant) => acc + (Number(variant.stockQty ?? variant.stock ?? 0) || 0), 0)
          : 0;
        const primaryImage =
          product.imageUrl ||
          (Array.isArray(product.images) && product.images.length ? product.images[0].url : '');
        const activeLabel = product.isActive ? 'Activo' : 'Inactivo';
        return `
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:10px;">
                ${primaryImage ? `<img src="${primaryImage}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid #1d1d26;" />` : ''}
                <div>
                  <div style="font-weight:600;">${product.name}</div>
                  <div style="color:#8e93a4; font-size:0.9rem;">${product.slug || ''}</div>
                </div>
              </div>
            </td>
            <td>${formatMoney(product.price)}</td>
            <td>${product.collection || '—'}</td>
            <td>${activeLabel}</td>
            <td>${totalStock}</td>
            <td>
              <div class="actions">
                <button class="btn" data-edit-product="${product.id}">Editar</button>
                <button class="btn danger" data-disable-product="${product.id}">${product.isActive ? 'Desactivar' : 'Inactivar'}</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const openProductModal = async (productId = null) => {
    resetProductForm();
    editingProductId = productId;
    if (!productModal) return;

    if (productId) {
      if (productModalTitle) productModalTitle.textContent = 'Editar producto';
      try {
        const product = await window.CRONOX_API?.admin?.getAdminProduct(productId);
        if (product) {
          const priceInput = document.getElementById('productPrice');
          const nameInput = document.getElementById('productName');
          const descInput = document.getElementById('productDescription');
          const collectionInput = document.getElementById('productCollection');
          const isActiveInput = document.getElementById('productIsActive');

          if (nameInput) nameInput.value = product.name || '';
          if (descInput) descInput.value = product.description || '';
          if (collectionInput) collectionInput.value = product.collection || '';
          if (priceInput) priceInput.value = Number(product.price || 0) / 100;
          if (isActiveInput) isActiveInput.checked = Boolean(product.isActive);

          cachedProductImages = Array.isArray(product.images)
            ? product.images.map((img) => img?.url).filter(Boolean)
            : [];
          renderProductImagesPreview(cachedProductImages);

          const variantMap = Array.isArray(product.variants)
            ? product.variants.reduce((acc, variant) => {
                if (variant.size) acc[String(variant.size).toUpperCase()] = variant;
                return acc;
              }, {})
            : {};
          ['XS', 'S', 'M', 'L', 'XL', 'XXL'].forEach((size) => {
            const input = document.getElementById(`stock${size}`);
            if (input) {
              input.value = variantMap[size]?.stockQty ?? variantMap[size]?.stock ?? 0;
            }
          });
        }
      } catch (error) {
        console.error('[ADMIN] Error obteniendo producto', error);
        setScopedMessage(productsMessage, 'No se pudo cargar el producto.', 'error');
        return;
      }
    }

    toggleModal(productModal, true);
  };

  const uploadProductImages = async (files) => {
    if (!files || !files.length) return [];
    try {
      const response = await window.CRONOX_API?.admin?.uploadProductImages(files);
      if (Array.isArray(response?.urls)) {
        return response.urls;
      }
    } catch (error) {
      console.error('[ADMIN] Error subiendo imágenes', error);
      throw new Error(error?.message || 'No se pudieron subir las imágenes');
    }
    return [];
  };

  const submitProduct = async (event) => {
    event?.preventDefault();
    if (!productForm) return;

    const formData = new FormData(productForm);
    const priceValue = Number(formData.get('price') || 0);
    const priceCents = Number.isFinite(priceValue) ? Math.round(priceValue * 100) : 0;
    const payload = {
      name: formData.get('name') || '',
      description: formData.get('description') || '',
      collection: formData.get('collection') || '',
      price: priceCents,
      isActive: productForm.querySelector('#productIsActive')?.checked ?? true,
      variants: collectVariantPayload(),
    };

    let imageUrls = [];
    const files = productImagesInput?.files ? Array.from(productImagesInput.files) : [];

    try {
      if (files.length) {
        imageUrls = await uploadProductImages(files);
      } else if (!editingProductId) {
        imageUrls = cachedProductImages;
      }

      if (imageUrls.length) {
        payload.imageUrls = imageUrls;
      }

      if (editingProductId) {
        await window.CRONOX_API?.admin?.updateAdminProduct(editingProductId, payload);
        setScopedMessage(productsMessage, 'Producto actualizado correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.createAdminProduct(payload);
        setScopedMessage(productsMessage, 'Producto creado correctamente.', 'success');
      }

      toggleModal(productModal, false);
      await fetchProducts();
    } catch (error) {
      console.error('[ADMIN] Error guardando producto', error);
      const message = error?.message || 'No se pudo guardar el producto.';
      setScopedMessage(productsMessage, message, 'error');
    } finally {
      if (productSubmitBtn) productSubmitBtn.disabled = false;
    }
  };

  const disableProduct = async (productId) => {
    if (!productId) return;
    if (!window.confirm('¿Desactivar este producto?')) return;
    try {
      await window.CRONOX_API?.admin?.deleteAdminProduct(productId);
      setScopedMessage(productsMessage, 'Producto desactivado.', 'success');
      fetchProducts();
    } catch (error) {
      console.error('[ADMIN] Error al desactivar producto', error);
      setScopedMessage(productsMessage, error?.message || 'No se pudo desactivar.', 'error');
    }
  };

  const onProductTableClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editId = target.dataset.editProduct;
    const disableId = target.dataset.disableProduct;
    if (target.dataset.retryProducts) {
      fetchProducts();
      return;
    }
    if (editId) {
      openProductModal(Number(editId));
      return;
    }
    if (disableId) {
      disableProduct(Number(disableId));
    }
  };

  const resetCodeForm = () => {
    editingCodeId = null;
    codeForm?.reset();
    if (codeModalTitle) codeModalTitle.textContent = 'Crear código';
  };

  const fetchCodes = async () => {
    if (!codesBody) return;
    codesBody.innerHTML = '<tr><td colspan="6" class="empty">Cargando códigos…</td></tr>';
    setScopedMessage(codesMessage, '');
    const query = {
      page: codesState.page,
      limit: codesState.limit,
      search: codesState.search || undefined,
      isActive: codesState.isActive || undefined,
    };
    try {
      const data = await window.CRONOX_API?.admin?.listPromoCodes(query);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      codesCache = items;
      renderCodes(items);
    } catch (error) {
      console.error('[ADMIN] Error cargando códigos', error);
      setScopedMessage(codesMessage, 'No se pudieron cargar los códigos.', 'error');
      codesBody.innerHTML = `
        <tr>
          <td colspan="6" class="empty">
            Error al cargar códigos.
            <button type="button" class="btn" data-retry-codes="1" style="margin-left:8px;">Reintentar</button>
          </td>
        </tr>`;
    }
  };

  const renderCodes = (items = []) => {
    if (!codesBody) return;
    if (!items.length) {
      codesBody.innerHTML = '<tr><td colspan="6" class="empty">No hay códigos con esos filtros.</td></tr>';
      return;
    }

    codesBody.innerHTML = items
      .map((code) => {
        const typeLabel = code.type === 'PERCENT' ? `${code.value}%` : formatMoney(code.value);
        const usageLabel =
          code.usageLimit != null ? `${code.usageCount || 0} / ${code.usageLimit}` : `${code.usageCount || 0}`;
        const activeLabel = code.isActive ? 'Activo' : 'Inactivo';
        const dateLabel = (value) => (value ? formatDate(value) : '—');
        return `
          <tr>
            <td>
              <div style="font-weight:600;">${code.code}</div>
              <div style="color:#8e93a4; font-size:0.9rem;">${activeLabel}</div>
            </td>
            <td>${code.type}</td>
            <td>${typeLabel}</td>
            <td>${usageLabel}</td>
            <td>
              <div style="display:flex; flex-direction:column; gap:4px; color:#8e93a4; font-size:0.9rem;">
                <span>Inicio: ${dateLabel(code.startsAt)}</span>
                <span>Expira: ${dateLabel(code.expiresAt)}</span>
              </div>
            </td>
            <td>
              <div class="actions">
                <button class="btn" data-edit-code="${code.id}">Editar</button>
                <button class="btn danger" data-disable-code="${code.id}">${code.isActive ? 'Desactivar' : 'Inactivar'}</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const openCodeModal = (code = null) => {
    resetCodeForm();
    editingCodeId = code?.id ?? null;
      if (code) {
        if (codeModalTitle) codeModalTitle.textContent = 'Editar código';
        const codeInput = document.getElementById('codeCode');
        const typeInput = document.getElementById('codeType');
        const valueInput = document.getElementById('codeValue');
        const minCartInput = document.getElementById('codeMinCart');
        const usageLimitInput = document.getElementById('codeUsageLimit');
        const startsAtInput = document.getElementById('codeStartsAt');
        const expiresAtInput = document.getElementById('codeExpiresAt');
        const isActiveInput = document.getElementById('codeIsActive');

        if (codeInput) codeInput.value = code.code || '';
        const typeValue = code.type || 'PERCENT';
        if (typeInput) typeInput.value = typeValue;
        if (valueInput) {
          const isPercent = String(typeValue).toUpperCase() === 'PERCENT';
          valueInput.value = isPercent ? code.value ?? '' : Number(code.value || 0) / 100;
        }
        if (minCartInput) minCartInput.value = code.minCartValue != null ? Number(code.minCartValue) / 100 : '';
        if (usageLimitInput) usageLimitInput.value = code.usageLimit ?? '';
        if (startsAtInput && code.startsAt) {
          startsAtInput.value = new Date(code.startsAt).toISOString().slice(0, 16);
        }
      if (expiresAtInput && code.expiresAt) {
        expiresAtInput.value = new Date(code.expiresAt).toISOString().slice(0, 16);
      }
      if (isActiveInput) isActiveInput.checked = Boolean(code.isActive);
    }

    toggleModal(codeModal, true);
  };

  const submitCode = async (event) => {
    event?.preventDefault();
    if (!codeForm) return;

    const formData = new FormData(codeForm);
    const codeValue = (formData.get('code') || '').toString().replace(/\s+/g, '').toUpperCase();
    const payload = {
      code: codeValue,
      type: formData.get('type') || 'PERCENT',
      value: Number(formData.get('value') || 0),
      minCartValue: formData.get('minCartValue') ? Math.round(Number(formData.get('minCartValue')) * 100) : undefined,
      usageLimit: formData.get('usageLimit') ? Number(formData.get('usageLimit')) : undefined,
      startsAt: formData.get('startsAt')
        ? new Date(formData.get('startsAt')).toISOString()
        : undefined,
      expiresAt: formData.get('expiresAt')
        ? new Date(formData.get('expiresAt')).toISOString()
        : undefined,
      isActive: codeForm.querySelector('#codeIsActive')?.checked ?? true,
    };

    const isPercent = String(payload.type).toUpperCase() === 'PERCENT';
    payload.value = isPercent ? Math.round(payload.value) : Math.round(payload.value * 100);

    try {
      if (editingCodeId) {
        await window.CRONOX_API?.admin?.updatePromoCode(editingCodeId, payload);
        setScopedMessage(codesMessage, 'Código actualizado correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.createPromoCode(payload);
        setScopedMessage(codesMessage, 'Código creado correctamente.', 'success');
      }
      toggleModal(codeModal, false);
      fetchCodes();
    } catch (error) {
      console.error('[ADMIN] Error guardando código', error);
      setScopedMessage(codesMessage, error?.message || 'No se pudo guardar el código.', 'error');
    }
  };

  const disableCode = async (id) => {
    if (!id) return;
    if (!window.confirm('¿Desactivar este código?')) return;
    try {
      await window.CRONOX_API?.admin?.deletePromoCode(id);
      setScopedMessage(codesMessage, 'Código desactivado.', 'success');
      fetchCodes();
    } catch (error) {
      console.error('[ADMIN] Error desactivando código', error);
      setScopedMessage(codesMessage, error?.message || 'No se pudo desactivar.', 'error');
    }
  };

  const onCodesTableClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.retryCodes) {
      fetchCodes();
      return;
    }
    const editId = target.dataset.editCode;
    const disableId = target.dataset.disableCode;
    if (editId) {
      const parsedId = Number(editId);
      const found = codesCache.find((item) => item.id === parsedId);
      openCodeModal(found || { id: parsedId });
      return;
    }
    if (disableId) {
      disableCode(Number(disableId));
    }
  };

  const handleAction = async (action, id) => {
    if (!id) return;
    const button = document.querySelector(`button[data-id="${id}"][data-action="${action}"]`);
    if (button) button.disabled = true;
    try {
      if (action === 'approve') {
        await window.CRONOX_API?.admin?.approveCircleUpgrade(id, {});
        setMessage('Solicitud aprobada correctamente.', 'success');
      } else {
        await window.CRONOX_API?.admin?.denyCircleUpgrade(id, {});
        setMessage('Solicitud denegada.', 'success');
      }
      await fetchRequests();
    } catch (error) {
      console.error('[ADMIN] Acción fallida', error);
      setMessage(error?.message || 'No se pudo completar la acción.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  };

  const bindEvents = () => {
    if (filterStatus) {
      filterStatus.addEventListener('change', fetchRequests);
    }
    if (filterStatus23) {
      filterStatus23.addEventListener('change', fetchRequests23);
    }

    if (productStatusFilter) {
      productStatusFilter.addEventListener('change', () => {
        productsState.isActive = productStatusFilter.value;
        fetchProducts();
      });
    }

    if (productSearch) {
      productSearch.addEventListener('input', () => {
        clearTimeout(productSearchTimeout);
        productSearchTimeout = setTimeout(() => {
          productsState.search = productSearch.value.trim();
          fetchProducts();
        }, 250);
      });
    }

    if (productImagesInput) {
      productImagesInput.addEventListener('change', () => {
        const files = productImagesInput.files ? Array.from(productImagesInput.files) : [];
        const urls = files.map((file) => URL.createObjectURL(file));
        renderProductImagesPreview(urls);
      });
    }

    if (productForm) {
      productForm.addEventListener('submit', submitProduct);
    }

    if (productCancelBtn) {
      productCancelBtn.addEventListener('click', () => toggleModal(productModal, false));
    }

    if (createProductBtn) {
      createProductBtn.addEventListener('click', () => openProductModal(null));
    }

    if (productsBody) {
      productsBody.addEventListener('click', onProductTableClick);
    }

    if (codeStatusFilter) {
      codeStatusFilter.addEventListener('change', () => {
        codesState.isActive = codeStatusFilter.value;
        fetchCodes();
      });
    }

    if (codeSearch) {
      codeSearch.addEventListener('input', () => {
        clearTimeout(codeSearchTimeout);
        codeSearchTimeout = setTimeout(() => {
          codesState.search = codeSearch.value.trim();
          fetchCodes();
        }, 250);
      });
    }

    if (codeForm) {
      codeForm.addEventListener('submit', submitCode);
    }

    const codeCodeInput = document.getElementById('codeCode');
    if (codeCodeInput) {
      codeCodeInput.addEventListener('input', () => {
        codeCodeInput.value = codeCodeInput.value.replace(/\s+/g, '').toUpperCase();
      });
    }

    if (codeCancelBtn) {
      codeCancelBtn.addEventListener('click', () => toggleModal(codeModal, false));
    }

    if (createCodeBtn) {
      createCodeBtn.addEventListener('click', () => openCodeModal());
    }

    if (codesBody) {
      codesBody.addEventListener('click', onCodesTableClick);
    }

    if (requestsBody) {
      requestsBody.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (target.dataset.retry) {
          fetchRequests();
          return;
        }
        if (!action || !id) return;
        handleAction(action, id);
      });
    }

    if (requestsBody23) {
      requestsBody23.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.retry23) {
          fetchRequests23();
        }
      });
    }

    if (tabs?.length) {
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const targetSection = tab.dataset.section;
          document.querySelectorAll('.admin-section').forEach((section) => {
            section.hidden = section.id !== targetSection;
          });
          tabs.forEach((btn) => btn.classList.toggle('primary', btn === tab));
          if (targetSection === 'section-34') {
            fetchRequests();
          } else if (targetSection === 'section-23') {
            fetchRequests23();
          } else if (targetSection === 'section-products') {
            fetchProducts();
          } else if (targetSection === 'section-codes') {
            fetchCodes();
          }
        });
      });
    }

    logoutBtn?.addEventListener('click', async () => {
      try {
        await window.CRONOX_API?.logout?.();
      } catch (e) {
        console.warn('No se pudo cerrar sesión', e);
      }
      redirectToHome();
    });

    backBtn?.addEventListener('click', redirectToHome);
  };

  const init = async () => {
    const user = await ensureAdmin();
    if (!user) return;
    bindEvents();
    fetchRequests();
    fetchRequests23();
  };

  document.addEventListener('DOMContentLoaded', init);
})();
