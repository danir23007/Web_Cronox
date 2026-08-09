(function () {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const body = $('#ordersAdminBody');
  if (!body) return;

  const message = $('#ordersMessage');
  const refreshButton = $('#ordersRefreshBtn');
  const exportButton = $('#ordersExportBtn');
  const emailSearch = $('#ordersEmailSearch');
  const modal = $('#orderDetailModal');
  const closeButton = $('#orderDetailClose');
  const title = $('#orderDetailTitle');
  const detailMessage = $('#orderDetailMessage');
  const statusElement = $('#orderDetailStatus');
  const carrierInput = $('#orderCarrier');
  const trackingNumberInput = $('#orderTrackingNumber');
  const trackingUrlInput = $('#orderTrackingUrl');
  const internalNoteInput = $('#orderInternalNote');
  const saveButton = $('#orderSaveBtn');
  const shipButton = $('#orderMarkShippedBtn');
  const deliverButton = $('#orderMarkDeliveredBtn');
  const refundButton = $('#orderRefundBtn');

  let currentOrder = null;
  let busy = false;

  const text = (value, fallback = '—') => (value == null || value === '' ? fallback : String(value));
  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('es-ES');
  };
  const money = (value) =>
    window.CRONOX_API?.formatPrice
      ? window.CRONOX_API.formatPrice(Number(value || 0))
      : String(Number(value || 0).toFixed(2)) + ' EUR';
  const endpoint = (path) => (window.CRONOX_API?.API_BASE || '') + path;
  const getEmailFilter = () => emailSearch?.value?.trim() || '';
  const getCsrfHeaders = async () => {
    const provider = window.CRONOX_API?.getCsrfHeaders;
    return typeof provider === 'function' ? provider() : {};
  };
  const safeExternalUrl = (value) => {
    const helper = window.CRONOX_SECURITY?.externalHttpUrl;
    return typeof helper === 'function' ? helper(value) : '';
  };

  const statusClass = (status) => {
    if (status === 'DELIVERED') return 'chip--green';
    if (status === 'REFUNDED' || status === 'CANCELLED') return 'chip--red';
    if (status === 'SHIPPED') return 'chip--yellow';
    return 'chip--gray';
  };
  const createStatusChip = (status) => {
    const chip = document.createElement('span');
    chip.className = 'chip ' + statusClass(status);
    chip.textContent = text(status);
    return chip;
  };
  const createCell = (row, value, className = '') => {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text(value);
    row.appendChild(cell);
    return cell;
  };

  const renderEmpty = (value) => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.className = 'empty';
    cell.textContent = value;
    row.appendChild(cell);
    body.replaceChildren(row);
  };
  const renderLoading = () => renderEmpty('Cargando pedidos...');

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      Object.assign(headers, await getCsrfHeaders());
    }

    const response = await fetch(endpoint(path), {
      ...options,
      method,
      credentials: 'include',
      headers,
    });
    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      data = null;
    }
    if (!response.ok) throw new Error(data?.message || 'Error ' + response.status);
    return data;
  }

  const setMessage = (element, value, type = 'success') => {
    if (!element) return;
    element.textContent = value || '';
    element.className = value ? 'message show ' + type : 'message';
  };
  const setBusy = (value) => {
    busy = Boolean(value);
    [saveButton, shipButton, deliverButton, refundButton].forEach((button) => {
      if (button) button.disabled = busy;
    });
  };
  const toggleModal = (show) => {
    if (modal) modal.classList.toggle('show', Boolean(show));
  };
  const applyActions = () => {
    const status = currentOrder?.status;
    const blocked = status === 'DELIVERED' || status === 'REFUNDED' || status === 'CANCELLED';
    if (shipButton) shipButton.disabled = busy || blocked || status === 'SHIPPED';
    if (deliverButton) deliverButton.disabled = busy || blocked || status === 'DELIVERED';
    if (refundButton) refundButton.disabled = busy || status === 'REFUNDED';
  };
  const fill = (order) => {
    currentOrder = order || null;
    if (title) title.textContent = 'Pedido #' + text(order?.id);
    if (statusElement) statusElement.replaceChildren(createStatusChip(order?.status));
    if (carrierInput) carrierInput.value = text(order?.shippingCarrier, '');
    if (trackingNumberInput) trackingNumberInput.value = text(order?.trackingNumber, '');
    if (trackingUrlInput) trackingUrlInput.value = text(order?.trackingUrl, '');
    if (internalNoteInput) internalNoteInput.value = text(order?.internalNote, '');
    setMessage(detailMessage, '');
    applyActions();
  };
  const normalizeResponse = (response) => {
    if (Array.isArray(response)) return { items: response };
    if (Array.isArray(response?.data)) return { items: response.data };
    if (Array.isArray(response?.items)) return { items: response.items };
    if (Array.isArray(response?.data?.items)) return { items: response.data.items };
    return { items: [] };
  };
  const renderOrders = (items) => {
    if (!items.length) {
      const email = getEmailFilter();
      renderEmpty(email ? 'No hay pedidos para ' + email + '.' : 'Sin pedidos.');
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((order) => {
      const row = document.createElement('tr');
      createCell(row, order?.id);
      createCell(row, formatDate(order?.createdAt));
      const statusCell = document.createElement('td');
      statusCell.appendChild(createStatusChip(order?.status));
      row.appendChild(statusCell);
      createCell(row, money(order?.total));
      createCell(row, order?.userEmail || order?.user?.email || order?.email);
      createCell(row, order?.shippingCarrier);
      createCell(row, order?.trackingNumber || 'Sin tracking');
      createCell(row, order?.shippedAt ? formatDate(order.shippedAt) : 'No enviado todavia');
      createCell(row, order?.deliveredAt ? formatDate(order.deliveredAt) : 'No entregado todavia');
      const actionCell = document.createElement('td');
      const manageButton = document.createElement('button');
      manageButton.type = 'button';
      manageButton.className = 'btn';
      manageButton.dataset.orderId = text(order?.id, '');
      manageButton.textContent = 'Gestionar';
      actionCell.appendChild(manageButton);
      row.appendChild(actionCell);
      fragment.appendChild(row);
    });
    body.replaceChildren(fragment);
  };

  async function load() {
    renderLoading();
    setMessage(message, '');
    try {
      const email = getEmailFilter();
      const query = email ? '?email=' + encodeURIComponent(email) : '';
      const data = await request('/api/admin/orders' + query);
      renderOrders(normalizeResponse(data).items);
    } catch (error) {
      setMessage(message, error?.message || 'Error cargando pedidos', 'error');
      renderEmpty('No se pudo cargar.');
    }
  }
  async function openOrder(id) {
    setMessage(detailMessage, 'Cargando...');
    toggleModal(true);
    try {
      const order = await request('/api/admin/orders/' + encodeURIComponent(id));
      fill(order);
    } catch (error) {
      setMessage(detailMessage, error?.message || 'Error', 'error');
    }
  }
  async function action(fn) {
    if (!currentOrder?.id || busy) return;
    setBusy(true);
    try {
      await fn();
      setMessage(detailMessage, 'Accion completada', 'success');
      await openOrder(currentOrder.id);
      await load();
    } catch (error) {
      setMessage(detailMessage, error?.message || 'No se pudo completar', 'error');
    } finally {
      setBusy(false);
      applyActions();
    }
  }

  body.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button[data-order-id]') : null;
    if (target) openOrder(target.dataset.orderId);
  });
  emailSearch?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      load();
    }
  });
  emailSearch?.addEventListener('search', load);
  refreshButton?.addEventListener('click', load);
  closeButton?.addEventListener('click', () => toggleModal(false));
  saveButton?.addEventListener('click', () => {
    const requestedTrackingUrl = trackingUrlInput?.value.trim() || null;
    if (requestedTrackingUrl && !safeExternalUrl(requestedTrackingUrl)) {
      setMessage(detailMessage, 'La URL de seguimiento debe usar http o https.', 'error');
      return;
    }
    action(() =>
      request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/fulfillment', {
        method: 'PATCH',
        body: JSON.stringify({
          shippingCarrier: carrierInput?.value.trim() || null,
          trackingNumber: trackingNumberInput?.value.trim() || null,
          trackingUrl: requestedTrackingUrl,
          internalNote: internalNoteInput?.value.trim() || null,
        }),
      }),
    );
  });
  shipButton?.addEventListener('click', () =>
    action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/mark-shipped', { method: 'POST' })),
  );
  deliverButton?.addEventListener('click', () =>
    action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/mark-delivered', { method: 'POST' })),
  );
  refundButton?.addEventListener('click', () => {
    if (window.confirm('Confirmar reembolso?')) {
      action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/refund', { method: 'POST' }));
    }
  });
  exportButton?.addEventListener('click', (event) => {
    event.preventDefault();
    const popup = window.open(endpoint('/api/admin/orders/export.csv'), '_blank', 'noopener,noreferrer');
    if (popup) popup.opener = null;
  });
  window.fetchOrders = load;
})();
