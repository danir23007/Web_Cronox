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
  let ordersPage = 1;
  let ordersPageCount = 1;
  let listRequest = 0;
  let bulkBusy = false;
  const selectedOrders = new Set();
  let visibleOrders = [];
  let bulkPreview = null;
  const selectPage = $('#ordersSelectPage');
  const bulkSyncButton = $('#ordersBulkSyncBtn');
  const bulkRows = $('#ordersBulkRows');
  const bulkSave = $('#ordersBulkSaveBtn');
  const bulkEditor = $('#ordersBulkEditor');
  const selectionChanged = () => {
    setText($('#ordersSelectedCount'), selectedOrders.size + ' seleccionados de esta página');
    if (bulkSyncButton) bulkSyncButton.disabled = bulkBusy || !selectedOrders.size;
    if (selectPage) {
      selectPage.checked = visibleOrders.length > 0 && selectedOrders.size === visibleOrders.length;
      selectPage.indeterminate = selectedOrders.size > 0 && selectedOrders.size < visibleOrders.length;
    }
  };

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
    cell.colSpan = 11;
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
    setText(trackingState, (state || (number ? 'Pendiente de entregar a Correos · admisión no confirmada' : 'Sin número asignado')) +
      (data?.notificationReview ? ' · Aviso retenido para revisión: ' + data.notificationReview : '') +
      (data?.admissionLocalAt ? ' · Admisión (hora local de Correos): ' + data.admissionLocalAt : '') +
      (data?.deliveryLocalAt ? ' · Entrega (hora local de Correos): ' + data.deliveryLocalAt : '') +
      ((data?.notifications || []).length ? ' · Aviso de envío: ' + data.notifications.map(job => job.status + ' (' + job.attempts + ' intentos)').join(', ') : ''));
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
      text: (entry.action ? entry.action + ' · ' : '') +
        (entry.previousStatus ? statusLabel(entry.previousStatus) + ' → ' + statusLabel(entry.nextStatus) + ' · ' : '') +
        text(entry.previousNumber, 'Sin número') + ' → ' + text(entry.nextNumber, 'Sin número') + ' · Revisión ' + text(entry.revision) +
        (entry.actorId ? ' · Administrador #' + entry.actorId : ' · Sistema'),
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
    visibleOrders = items;
    selectedOrders.clear();
    selectionChanged();
    if (!items.length) {
      const email = getEmailFilter();
      renderEmpty(email ? 'No hay pedidos para ' + email + '.' : 'Sin pedidos.');
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((order) => {
      const row = document.createElement('tr');
      const selectionCell = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.selectOrder = String(order.id);
      checkbox.setAttribute('aria-label', 'Seleccionar pedido CRONOX #' + order.id);
      checkbox.disabled = bulkBusy;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedOrders.add(order.id); else selectedOrders.delete(order.id);
        selectionChanged();
      });
      selectionCell.appendChild(checkbox); row.appendChild(selectionCell);
      createCell(row, order?.id);
      createCell(row, formatDate(order?.createdAt));
      const statusCell = document.createElement('td');
      statusCell.appendChild(createStatusChip(order?.status));
      if (order?.trackingNotificationReview) statusCell.append(' · Aviso retenido para revisión');
      if (order?.excludedFromStatistics) statusCell.append(' · Excluida de estadísticas');
      row.appendChild(statusCell);
      createCell(row, money(order?.total));
      createCell(row, [window.CRONOX_USER_IDENTITY.format({ memberCode: order?.userMemberCode || order?.user?.memberCode }), order?.userEmail || order?.user?.email || order?.email].filter(Boolean).join(" · "));
      createCell(row, order?.shippingCarrier);
      createCell(row, order?.trackingNumber || 'Sin tracking');
      createCell(row, order?.trackingAdmissionLocalAt ? order.trackingAdmissionLocalAt + ' (hora Correos)' : order?.shippedAt ? formatDate(order.shippedAt) : ['SHIPPED', 'DELIVERED'].includes(order.status) ? 'Confirmado · fecha de admisión no disponible' : order?.trackingNumber ? 'Pendiente de entregar a Correos' : 'No enviado todavía');
      createCell(row, order?.trackingDeliveryLocalAt ? order.trackingDeliveryLocalAt + ' (hora Correos)' : order?.deliveredAt ? formatDate(order.deliveredAt) : order.status === 'DELIVERED' ? 'Confirmada · fecha no disponible' : 'No entregado todavía');
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
    const sequence = ++listRequest;
    selectedOrders.clear(); visibleOrders = []; selectionChanged();
    renderLoading();
    setMessage(message, '');
    try {
      const email = getEmailFilter();
      const query = '?page=' + ordersPage + (email ? '&email=' + encodeURIComponent(email) : '');
      const data = await request('/api/admin/orders' + query);
      if (sequence !== listRequest) return;
      ordersPageCount = data?.meta?.pageCount || 1;
      setText($('#ordersPageInfo'), 'Página ' + ordersPage + ' de ' + ordersPageCount);
      if ($('#ordersPrevBtn')) $('#ordersPrevBtn').disabled = bulkBusy || ordersPage <= 1;
      if ($('#ordersNextBtn')) $('#ordersNextBtn').disabled = bulkBusy || ordersPage >= ordersPageCount;
      renderOrders(normalizeResponse(data).items);
    } catch (error) {
      if (sequence !== listRequest) return;
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
    if (!currentOrder?.id || busy || trackingBusy || bulkBusy) return;
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
    const replaces = currentOrder?.trackingNumber && trackingIsEdited();
    if (replaces && !window.confirm('Sustituir o quitar el seguimiento del pedido #' + currentOrder.id + '? El cambio quedará auditado.')) return;
    action(() =>
      request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/fulfillment', {
        method: 'PATCH',
        body: JSON.stringify({
          trackingRevision: currentOrder.trackingRevision,
          replaceTracking: Boolean(replaces),
          shippingCarrier: carrierInput?.value.trim() || null,
          trackingNumber: trackingNumberInput?.value.trim() || null,
          trackingUrl: requestedTrackingUrl,
          internalNote: internalNoteInput?.value.trim() || null,
        }),
      }),
    );
  });
  shipButton?.addEventListener('click', () => {
    if (window.confirm('Confirmar envío manual sin consultar Correos. Se registrará tu intervención y puede enviarse el aviso al cliente.'))
      action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/mark-shipped', { method: 'POST' }));
  });
  deliverButton?.addEventListener('click', () =>
    action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/mark-delivered', { method: 'POST' })),
  );
  refundButton?.addEventListener('click', () => {
    if (window.confirm('Confirmar reembolso?')) {
      action(() => request('/api/admin/orders/' + encodeURIComponent(currentOrder.id) + '/refund', { method: 'POST' }));
    }
  });
  const invalidateBulkPreview = () => { bulkPreview = null; if (bulkSave) bulkSave.disabled = true; };
  const setBulkBusy = (value) => {
    bulkBusy = value;
    document.querySelectorAll('#section-orders button, #section-orders input, #section-orders textarea').forEach(el => { el.disabled = value; });
    selectionChanged();
    if (bulkSave) bulkSave.disabled = value || !bulkPreview?.length;
    if ($('#ordersPrevBtn')) $('#ordersPrevBtn').disabled = value || ordersPage <= 1;
    if ($('#ordersNextBtn')) $('#ordersNextBtn').disabled = value || ordersPage >= ordersPageCount;
  };
  const resultLabel = result => ({ updated: 'Actualizado', unchanged: 'Sin cambios', valid: 'Válido para guardar', error: 'Error' }[result.status] || result.status) +
    (result.error ? ': ' + result.error : '') + (result.orderStatus ? ' · ' + statusLabel(result.orderStatus) : '') +
    (result.notificationReview ? ' · Aviso retenido: ' + result.notificationReview : '');
  const addBulkRow = (id = '', code = '') => {
    if (!bulkRows || bulkRows.children.length >= 100) return;
    invalidateBulkPreview();
    const row = document.createElement('tr');
    [id, code].forEach((value, index) => {
      const input = document.createElement('input'); input.className = 'input'; input.value = value;
      input.setAttribute('aria-label', index ? 'Código de Correos' : 'ID de pedido CRONOX');
      input.dataset.bulkField = index ? 'code' : 'id';
      input.addEventListener('input', invalidateBulkPreview);
      const cell = document.createElement('td'); cell.appendChild(input); row.appendChild(cell);
    });
    const result = createCell(row, 'Pendiente de validar'); result.dataset.bulkResult = '';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn'; remove.textContent = 'Quitar';
    remove.addEventListener('click', () => { row.remove(); invalidateBulkPreview(); });
    const cell = document.createElement('td'); cell.appendChild(remove); row.appendChild(cell);
    bulkRows.appendChild(row);
  };
  const runBulk = async work => {
    if (bulkBusy || busy || trackingBusy) return;
    setBulkBusy(true); setMessage(message, '');
    try { await work(); }
    catch (error) { setMessage(message, error?.message || 'No se pudo completar el lote. Revalida antes de reintentar.', 'error'); }
    finally { setBulkBusy(false); }
  };
  selectPage?.addEventListener('change', () => {
    selectedOrders.clear();
    if (selectPage.checked) visibleOrders.forEach(order => selectedOrders.add(order.id));
    body.querySelectorAll('[data-select-order]').forEach(input => { input.checked = selectedOrders.has(Number(input.dataset.selectOrder)); });
    selectionChanged();
  });
  bulkSyncButton?.addEventListener('click', () => {
    const ids = [...selectedOrders]; if (!ids.length) return;
    runBulk(async () => {
      const container = $('#ordersBulkResults');
      container?.replaceChildren();
      // Keep each HTTP request bounded; selected IDs stay frozen for this batch.
      for (const id of ids) {
        let results;
        try { results = (await request('/api/admin/orders/tracking-bulk/sync', { method: 'POST', body: JSON.stringify({ orderIds: [id] }) })).results; }
        catch (error) { results = [{ orderId: id, status: 'error', error: error?.message || 'Error de conexión; vuelve a consultar el pedido.' }]; }
        results.forEach(result => { if (container) {
          const line = document.createElement('p'); line.textContent = 'Pedido #' + result.orderId + ': ' + resultLabel(result); container.appendChild(line);
        } });
      }
      await load();
    });
  });
  $('#ordersBulkAssignBtn')?.addEventListener('click', () => { if (bulkEditor) bulkEditor.hidden = !bulkEditor.hidden; });
  $('#ordersBulkAddRowBtn')?.addEventListener('click', () => addBulkRow());
  $('#ordersBulkPaste')?.addEventListener('input', invalidateBulkPreview);
  $('#ordersBulkFile')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    invalidateBulkPreview();
    if (file.size > 65536) { setMessage(message, 'El archivo supera 64 KiB.', 'error'); return; }
    try { $('#ordersBulkPaste').value = await file.text(); }
    catch { setMessage(message, 'No se pudo leer el archivo.', 'error'); }
  });
  $('#ordersBulkParseBtn')?.addEventListener('click', () => {
    const lines = ($('#ordersBulkPaste')?.value || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(line => line.trim());
    if (/^(orderId|ID de pedido CRONOX|ID pedido)[;,\t]/i.test(lines[0] || '')) lines.shift();
    if (!lines.length || lines.length > 100) { setMessage(message, 'Introduce entre 1 y 100 filas.', 'error'); return; }
    const pairs = lines.map(line => line.split(/[;,\t]/));
    if (pairs.some(pair => pair.length !== 2)) { setMessage(message, 'Cada fila debe contener exactamente ID de pedido y código, separados por coma, punto y coma o tabulador.', 'error'); return; }
    bulkRows?.replaceChildren(); pairs.forEach(([id, code]) => addBulkRow(id.trim(), code.trim()));
    setMessage(message, 'Filas cargadas. Revisa los IDs de pedido y valida antes de guardar.');
  });
  $('#ordersBulkPreviewBtn')?.addEventListener('click', () => runBulk(async () => {
    invalidateBulkPreview();
    const rows = [...(bulkRows?.querySelectorAll('tr') || [])].map(row => ({
      orderId: /^\d+$/.test(row.querySelector('[data-bulk-field="id"]').value.trim()) ? Number(row.querySelector('[data-bulk-field="id"]').value.trim()) : null,
      trackingNumber: row.querySelector('[data-bulk-field="code"]').value.trim(),
    }));
    if (!rows.length) throw Error('Añade o carga al menos una fila.');
    const response = await request('/api/admin/orders/tracking-bulk/assign', { method: 'POST', body: JSON.stringify({ rows, preview: true }) });
    response.results.forEach(result => { const cell = bulkRows.children[result.index]?.querySelector('[data-bulk-result]'); if (cell) cell.textContent = resultLabel(result); });
    bulkPreview = response.results.filter(result => result.status === 'valid').map(result => ({ orderId: result.orderId, trackingNumber: result.trackingNumber, revision: result.revision, index: result.index }));
    setMessage(message, bulkPreview.length + ' filas válidas para guardar. Asociar códigos no marca los pedidos como enviados.');
  }));
  bulkSave?.addEventListener('click', () => {
    if (!bulkPreview?.length) return;
    const snapshot = bulkPreview.map(row => ({ ...row }));
    runBulk(async () => {
      invalidateBulkPreview();
      const response = await request('/api/admin/orders/tracking-bulk/assign', { method: 'POST', body: JSON.stringify({ rows: snapshot.map(({ index, ...row }) => row), preview: false }) });
      response.results.forEach(result => { const cell = bulkRows.children[snapshot[result.index].index]?.querySelector('[data-bulk-result]'); if (cell) cell.textContent = resultLabel(result); });
      await load();
    });
  });
  $('#ordersPrevBtn')?.addEventListener('click', () => { if (ordersPage > 1 && !bulkBusy) { ordersPage--; load(); } });
  $('#ordersNextBtn')?.addEventListener('click', () => { if (ordersPage < ordersPageCount && !bulkBusy) { ordersPage++; load(); } });
  emailSearch?.addEventListener('input', () => { ordersPage = 1; });
  window.fetchOrders = load;
  window.CRONOX_ADMIN_ORDERS = { open: openOrder };
})();
