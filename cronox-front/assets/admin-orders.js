(function () {
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const body = $('#ordersAdminBody');
  if (!body) return;

  const message = $('#ordersMessage');
  const refreshButton = $('#ordersRefreshBtn');
  const emailSearch = $('#ordersEmailSearch');
  const modal = $('#orderDetailModal');
  const closeButton = $('#orderDetailClose');
  const title = $('#orderDetailTitle');
  const detailMessage = $('#orderDetailMessage');
  const statusElement = $('#orderDetailStatus');
  const orderNumber = $('#orderDetailNumber');
  const paymentStatus = $('#orderPaymentStatus');
  const fulfillmentStatus = $('#orderFulfillmentStatus');
  const customerName = $('#orderCustomerName');
  const customerEmail = $('#orderCustomerEmail');
  const customerPhone = $('#orderCustomerPhone');
  const addressRecipient = $('#orderAddressRecipient');
  const addressLine1 = $('#orderAddressLine1');
  const addressLine2 = $('#orderAddressLine2');
  const addressPostcode = $('#orderAddressPostcode');
  const addressCity = $('#orderAddressCity');
  const addressProvince = $('#orderAddressProvince');
  const addressCountry = $('#orderAddressCountry');
  const itemsBody = $('#orderItemsBody');
  const shippingMethod = $('#orderShippingMethod');
  const shippingCost = $('#orderShippingCost');
  const carrierInput = $('#orderCarrier');
  const trackingNumberInput = $('#orderTrackingNumber');
  const trackingUrlInput = $('#orderTrackingUrl');
  const internalNoteInput = $('#orderInternalNote');
  const saveButton = $('#orderSaveBtn');
  const shipButton = $('#orderMarkShippedBtn');
  const deliverButton = $('#orderMarkDeliveredBtn');
  const refundButton = $('#orderRefundBtn');
  const trackingMessage = $('#orderTrackingMessage');
  const trackingState = $('#orderTrackingState');
  const trackingSuccess = $('#orderTrackingLastSuccess');
  const trackingError = $('#orderTrackingError');
  const trackingNext = $('#orderTrackingNextSync');
  const trackingNextManual = $('#orderTrackingNextManual');
  const trackingPublicLink = $('#orderTrackingPublicLink');
  const trackingSyncButton = $('#orderTrackingSyncBtn');
  const trackingContract = $('#orderTrackingContract');
  const trackingApi = $('#orderTrackingApi');
  const trackingEvents = $('#orderTrackingEvents');
  const trackingAudit = $('#orderTrackingAudit');
  const labelMetadata = $('#orderLabelMetadata');
  const labelStale = $('#orderLabelStale');
  const labelFile = $('#orderLabelFile');
  const labelUploadButton = $('#orderLabelUploadBtn');
  const labelDownloadButton = $('#orderLabelDownloadBtn');

  let currentOrder = null;
  let currentTracking = null;
  let detailRequest = 0;
  let trackingTimer = null;
  let trackingBusy = false;
  let busy = false;

  const text = (value, fallback = 'No disponible') =>
    value == null || value === '' ? fallback : String(value);
  const setText = (element, value, fallback) => {
    if (element) element.textContent = text(value, fallback);
  };
  const statusLabel = (value) => {
    const labels = {
      PENDING: 'Pendiente',
      PAID: 'Pagado',
      PROCESSING: 'En preparación',
      NOT_SHIPPED: 'No enviado',
      SHIPPED: 'Enviado',
      DELIVERED: 'Entregado',
      REFUNDED: 'Reembolsado',
      DISPUTED: 'En disputa',
      CANCELLED: 'Cancelado',
    };
    return labels[value] || text(value);
  };
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
  const safeCorreosUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['correos.es', 'www.correos.es'].includes(url.hostname) && !url.username && !url.password
        ? url.href : '';
    } catch { return ''; }
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
    chip.textContent = statusLabel(status);
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
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
    }).catch(() => { throw new Error('No se pudo conectar con el servidor. Inténtalo de nuevo.'); });
    const responseText = await response.text();
    let data = null;
    try {
      data = responseText ? JSON.parse(responseText) : null;
    } catch (error) {
      data = null;
    }
    if (!response.ok) {
      // Internal exceptions remain in Nest logs; never expose SQL or English 5xx text.
      const message = response.status >= 500 ? 'No se pudieron cargar o actualizar los pedidos. Inténtalo de nuevo.'
        : response.status === 401 ? 'Tu sesión ha caducado. Inicia sesión de nuevo.'
        : response.status === 403 ? 'No tienes permiso para realizar esta operación.'
        : response.status === 404 ? 'No se encontró el pedido solicitado.'
        : typeof data?.message === 'string' && data.message !== 'Internal server error' ? data.message
        : 'No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.';
      throw new Error(message);
    }
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
    applyTrackingActions();
  };
  const toggleModal = (show) => {
    if (modal) modal.classList.toggle('show', Boolean(show));
  };
  const applyActions = () => {
    const status = currentOrder?.status;
    const missingOrder = !currentOrder?.id;
    const blocked = status === 'DELIVERED' || status === 'REFUNDED' || status === 'CANCELLED';
    if (saveButton) saveButton.disabled = busy || trackingBusy || missingOrder;
    if (shipButton) shipButton.disabled = busy || trackingBusy || missingOrder || blocked || status === 'SHIPPED';
    if (deliverButton) deliverButton.disabled = busy || trackingBusy || missingOrder || blocked || status === 'DELIVERED';
    if (refundButton) refundButton.disabled = busy || trackingBusy || missingOrder || status === 'REFUNDED';
    applyTrackingActions();
  };
  const trackingIsEdited = () => Boolean(currentOrder) && (
    (trackingNumberInput?.value.trim() || '') !== (currentOrder.trackingNumber || '') ||
    (carrierInput?.value.trim() || '') !== (currentOrder.shippingCarrier || '')
  );
  const applyTrackingActions = () => {
    const blocked = busy || trackingBusy || !currentOrder?.id;
    const cooldown = new Date(currentTracking?.manualAvailableAt ?? currentTracking?.nextSyncAt ?? 0).getTime() > Date.now();
    if (trackingSyncButton) trackingSyncButton.disabled = blocked || !currentTracking?.number || currentTracking?.apiEnabled === false || currentTracking?.apiReady === false || currentTracking?.apiEligible === false || currentTracking?.eligible === false || cooldown || trackingIsEdited();
    if (labelUploadButton) labelUploadButton.disabled = blocked || !currentTracking || !labelFile?.files?.length || trackingIsEdited();
    if (labelDownloadButton) labelDownloadButton.disabled = blocked || !currentTracking?.label;
  };
  const replaceList = (list, values, empty) => {
    if (!list) return;
    list.replaceChildren();
    (values.length ? values : [empty]).forEach((value) => {
      const item = document.createElement('li');
      if (typeof value === 'string') item.textContent = value;
      else {
        const time = document.createElement(value.at ? 'time' : 'span');
        time.className = 'order-tracking__date';
        if (value.at && !Number.isNaN(new Date(value.at).getTime())) time.dateTime = new Date(value.at).toISOString();
        time.textContent = value.at ? formatDate(value.at) : text(value.localAt, 'Fecha no disponible');
        item.append(time, document.createTextNode(value.text));
      }
      list.appendChild(item);
    });
  };
  const renderTracking = (data) => {
    currentTracking = data || null;
    clearTimeout(trackingTimer);
    const number = data?.number;
    const state = typeof data?.state === 'object' ? data.state?.label || data.state?.code : data?.state;
    setText(trackingState, state || (number ? 'Número asignado; admisión no confirmada' : 'Sin número asignado'));
    setText(trackingSuccess, data?.lastSuccessAt ? formatDate(data.lastSuccessAt) : 'Sin sincronización correcta');
    setText(trackingError, data?.lastError ? text(data.lastError.code) + ' · ' + formatDate(data.lastError.at) : 'Ninguno');
    setText(trackingNext, data?.nextSyncAt ? formatDate(data.nextSyncAt) : '—');
    setText(trackingNextManual, data?.manualAvailableAt ? formatDate(data.manualAvailableAt) : '—');
    if (trackingContract) trackingContract.hidden = !number || data?.contractReady !== false;
    if (trackingApi) {
      trackingApi.hidden = data?.apiEnabled !== false && data?.apiReady !== false && data?.apiEligible !== false && data?.eligible !== false;
      trackingApi.textContent = data?.apiEnabled === false ? 'Las consultas a Correos están desactivadas. El enlace público y la etiqueta siguen disponibles.'
        : data?.apiReady === false ? 'Falta completar la configuración privada de Correos en el servidor. El enlace público y la etiqueta siguen disponibles.'
        : 'Este pedido no admite consultas automáticas de transporte. El enlace público y la etiqueta siguen disponibles.';
    }
    const url = number ? safeCorreosUrl(data?.publicUrl) : '';
    if (trackingPublicLink) {
      trackingPublicLink.hidden = !url;
      if (url) trackingPublicLink.href = url;
      else trackingPublicLink.removeAttribute('href');
    }
    replaceList(trackingEvents, (Array.isArray(data?.events) ? data.events : []).map((event) => ({
      at: event.occurredAt,
      localAt: event.occurredLocalAt,
      text: [event.code, event.description, event.category].filter(Boolean).join(' · '),
    })), 'Sin eventos confirmados por Correos.');
    replaceList(trackingAudit, (Array.isArray(data?.audit) ? data.audit : []).map((entry) => ({
      at: entry.createdAt,
      text: text(entry.previousNumber, 'Sin número') + ' → ' + text(entry.nextNumber, 'Sin número') + ' · Revisión ' + text(entry.revision),
    })), 'Sin cambios registrados.');
    setText(labelMetadata, data?.label ? data.label.fileName + ' · ' + formatDate(data.label.updatedAt) : 'Sin etiqueta guardada.');
    if (labelStale) labelStale.hidden = !data?.label || data.label.trackingRevision === data.revision;
    const wait = new Date(data?.manualAvailableAt ?? data?.nextSyncAt ?? 0).getTime() - Date.now();
    if (wait > 0) trackingTimer = setTimeout(applyTrackingActions, Math.min(wait + 50, 2147483647));
    applyTrackingActions();
  };
  async function loadTracking(orderId, sequence = detailRequest) {
    try {
      const data = await request('/api/admin/orders/' + encodeURIComponent(orderId) + '/tracking');
      if (sequence !== detailRequest || currentOrder?.id !== orderId) return;
      renderTracking(data);
      setMessage(trackingMessage, '');
    } catch (error) {
      if (sequence !== detailRequest || currentOrder?.id !== orderId) return;
      setMessage(trackingMessage, error?.message || 'No se pudo consultar el seguimiento.', 'error');
    }
  }
  const fill = (order) => {
    currentOrder = order || null;
    if (title) title.textContent = 'Pedido #' + text(order?.id);
    if (statusElement) {
      statusElement.replaceChildren(createStatusChip(order?.status));
      if (order?.excludedFromStatistics) statusElement.append(' · Excluida de estadísticas');
    }
    setText(orderNumber, order?.id);
    setText(paymentStatus, statusLabel(order?.paymentStatus));
    setText(fulfillmentStatus, statusLabel(order?.fulfillmentStatus));
    setText(customerName, order?.customer?.name);
    setText(customerEmail, order?.customer?.email || order?.userEmail);
    setText(customerPhone, order?.customer?.phone);
    setText(addressRecipient, order?.shippingAddress?.recipient);
    setText(addressLine1, order?.shippingAddress?.line1);
    setText(addressLine2, order?.shippingAddress?.line2);
    setText(addressPostcode, order?.shippingAddress?.postalCode);
    setText(addressCity, order?.shippingAddress?.city);
    setText(addressProvince, order?.shippingAddress?.province);
    setText(addressCountry, order?.shippingAddress?.country);
    const methodLabel = order?.shippingMethod?.label;
    const methodCode = order?.shippingMethod?.code;
    setText(
      shippingMethod,
      methodLabel && methodCode && methodLabel !== methodCode
        ? methodLabel + ' (' + methodCode + ')'
        : methodLabel || methodCode,
    );
    setText(shippingCost, order?.shippingCost == null ? null : money(order.shippingCost));
    renderOrderItems(order?.items);
    if (carrierInput) carrierInput.value = text(order?.shippingCarrier, '');
    if (trackingNumberInput) trackingNumberInput.value = text(order?.trackingNumber, '');
    if (trackingUrlInput) trackingUrlInput.value = text(order?.trackingUrl, '');
    if (internalNoteInput) internalNoteInput.value = text(order?.internalNote, '');
    if (labelFile) labelFile.value = '';
    renderTracking(null);
    setMessage(trackingMessage, '');
    setMessage(detailMessage, '');
    applyActions();
  };
  const renderOrderItems = (items) => {
    if (!itemsBody) return;
    if (!Array.isArray(items) || !items.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = 'No hay productos disponibles en este pedido.';
      row.appendChild(cell);
      itemsBody.replaceChildren(row);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const row = document.createElement('tr');
      createCell(row, item?.title);
      createCell(row, item?.variant);
      createCell(row, item?.quantity);
      createCell(row, item?.lineTotal == null ? null : money(item.lineTotal));
      fragment.appendChild(row);
    });
    itemsBody.replaceChildren(fragment);
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
      if (order?.excludedFromStatistics) statusCell.append(' · Excluida de estadísticas');
      row.appendChild(statusCell);
      createCell(row, money(order?.total));
      createCell(row, [window.CRONOX_USER_IDENTITY.format({ memberCode: order?.userMemberCode || order?.user?.memberCode }), order?.userEmail || order?.user?.email || order?.email].filter(Boolean).join(" · "));
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
    const sequence = ++detailRequest;
    fill(null);
    if (title) title.textContent = 'Pedido #' + text(id);
    setText(orderNumber, id);
    setMessage(detailMessage, 'Cargando...');
    toggleModal(true);
    try {
      const order = await request('/api/admin/orders/' + encodeURIComponent(id));
      if (sequence !== detailRequest) return;
      fill(order);
      await loadTracking(order.id, sequence);
    } catch (error) {
      if (sequence === detailRequest) setMessage(detailMessage, error?.message || 'Error', 'error');
    }
  }
  async function action(fn) {
    if (!currentOrder?.id || busy || trackingBusy) return;
    const id = currentOrder.id;
    const sequence = detailRequest;
    setBusy(true);
    try {
      await fn();
      if (sequence === detailRequest) {
        await openOrder(id);
        setMessage(detailMessage, 'Acción completada', 'success');
      }
      await load();
    } catch (error) {
      if (sequence === detailRequest) setMessage(detailMessage, error?.message || 'No se pudo completar', 'error');
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
  closeButton?.addEventListener('click', () => {
    detailRequest += 1;
    clearTimeout(trackingTimer);
    toggleModal(false);
  });
  [trackingNumberInput, carrierInput].forEach((input) => input?.addEventListener('input', () => {
    applyTrackingActions();
    setMessage(trackingMessage, trackingIsEdited() ? 'Guarda los cambios del seguimiento antes de consultar o adjuntar una etiqueta.' : '', 'error');
  }));
  labelFile?.addEventListener('change', applyTrackingActions);
  const trackingAction = async (operation) => {
    if (busy || trackingBusy || !currentOrder?.id || trackingIsEdited()) return;
    const id = currentOrder.id;
    const sequence = detailRequest;
    trackingBusy = true;
    applyActions();
    try {
      await operation(id);
      if (sequence === detailRequest) await loadTracking(id, sequence);
    } catch (error) {
      if (sequence === detailRequest) {
        await loadTracking(id, sequence);
        setMessage(trackingMessage, error?.message || 'No se pudo completar la operación.', 'error');
      }
    } finally {
      trackingBusy = false;
      applyActions();
    }
  };
  trackingSyncButton?.addEventListener('click', () => {
    if (trackingSyncButton.disabled) return;
    trackingAction((id) => request('/api/admin/orders/' + encodeURIComponent(id) + '/tracking/sync', { method: 'POST' }));
  });
  labelUploadButton?.addEventListener('click', () => {
    const file = labelFile?.files?.[0];
    if (!file || labelUploadButton.disabled) return;
    if (file.size > 10 * 1024 * 1024 || !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      setMessage(trackingMessage, 'La etiqueta debe ser un PDF de hasta 10 MiB.', 'error');
      return;
    }
    trackingAction(async (id) => {
      const revision = currentTracking.revision;
      const sequence = detailRequest;
      const data = new FormData();
      data.append('file', file);
      data.append('revision', String(revision));
      await request('/api/admin/orders/' + encodeURIComponent(id) + '/label', { method: 'POST', body: data });
      if (sequence === detailRequest && labelFile) labelFile.value = '';
    });
  });
  labelDownloadButton?.addEventListener('click', () => {
    if (labelDownloadButton.disabled) return;
    trackingAction(async (id) => {
      const fileName = currentTracking?.label?.fileName || 'etiqueta.pdf';
      const response = await fetch(endpoint('/api/admin/orders/' + encodeURIComponent(id) + '/label'), { credentials: 'include' });
      if (!response.ok) throw new Error('No se pudo descargar la etiqueta privada. Revisa tu sesión e inténtalo de nuevo.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  });
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
          trackingRevision: currentOrder.trackingRevision,
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
  window.fetchOrders = load;
  window.CRONOX_ADMIN_ORDERS = { open: openOrder };
})();
