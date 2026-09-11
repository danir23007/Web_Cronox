(function () {
  'use strict';

  const section = document.getElementById('section-inventory');
  if (!section) return;
  const byId = (id) => document.getElementById(id);
  const list = byId('inventoryList');
  const message = byId('inventoryMessage');
  const search = byId('inventorySearch');
  const activeFilter = byId('inventoryActiveFilter');
  const stockFilter = byId('inventoryStockFilter');
  const pageInfo = byId('inventoryPageInfo');
  const previous = byId('inventoryPrev');
  const next = byId('inventoryNext');
  const pageSize = byId('inventoryPageSize');
  const refresh = byId('inventoryRefresh');
  const state = {
    page: 1, pageSize: 20, totalPages: 1, items: [],
    expanded: new Set(), edits: new Map(), saving: new Set(), history: new Map(), loaded: false,
  };
  let searchTimer = null;

  const escapeHtml = (value) => window.CRONOX_SECURITY?.escapeHtml
    ? window.CRONOX_SECURITY.escapeHtml(value)
    : String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeImage = (value) => window.CRONOX_SECURITY?.productImageUrl?.(value) || '';
  const formatNumber = (value) => new Intl.NumberFormat('es-ES').format(Number(value) || 0);
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : date.toLocaleString('es-ES');
  };
  const stockLabel = (status) => status === 'out_of_stock' ? 'Agotado' : status === 'low' ? 'Poco stock' : 'Disponible';
  const stockChip = (status) => status === 'out_of_stock' ? 'chip--red' : status === 'low' ? 'chip--yellow' : 'chip--green';
  const productEdits = (productId) => state.edits.get(productId) || new Map();

  const setMessage = (text = '', type = 'success') => {
    if (!message) return;
    message.textContent = text;
    message.className = text ? `message show ${type}` : 'message';
  };

  const renderSummary = (summary) => {
    byId('inventoryTotalUnits').textContent = formatNumber(summary?.totalUnits);
    byId('inventoryProductsWithStock').textContent = formatNumber(summary?.productsWithStock);
    byId('inventorySoldOutProducts').textContent = formatNumber(summary?.soldOutProducts);
    byId('inventoryLowStockVariants').textContent = formatNumber(summary?.lowStockVariants);
    byId('inventorySummary')?.setAttribute('aria-busy', 'false');
  };

  const renderHistory = (productId) => {
    const container = list?.querySelector(`[data-inventory-history-list="${productId}"]`);
    if (!container) return;
    const history = state.history.get(productId);
    if (!history) {
      container.innerHTML = '<p class="empty">Cargando historial&hellip;</p>';
      return;
    }
    if (!history.length) {
      container.innerHTML = '<p class="empty">No hay ajustes manuales registrados.</p>';
      return;
    }
    container.innerHTML = history.map((item) => {
      const delta = Number(item.delta) || 0;
      const admin = item.admin?.name || item.admin?.email || 'Administrador';
      return `<div class="inventory-history-item">
        <div><strong>${escapeHtml(formatDate(item.createdAt))}</strong><br><small>${escapeHtml(admin)}</small></div>
        <div><strong>${delta > 0 ? '+' : ''}${delta}</strong><br><small>${escapeHtml(item.size || item.sku || `Variante ${item.variantId}`)}</small></div>
        <div><strong>${formatNumber(item.previousStock)} &rarr; ${formatNumber(item.newStock)}</strong><br><small>${escapeHtml(item.reason || 'Ajuste manual')}</small></div>
      </div>`;
    }).join('');
  };

  const renderDetail = (product) => {
    const edits = productEdits(product.id);
    const saving = state.saving.has(product.id);
    if (!product.variants?.length) return '<div class="inventory-product__detail"><p class="inventory-empty-variants">Este producto no tiene variantes asociadas.</p></div>';
    const rows = product.variants.map((variant) => {
      const edit = edits.get(variant.id);
      const value = edit ? edit.value : variant.stockQty;
      const dirty = Boolean(edit && edit.value !== edit.expectedStock);
      return `<tr class="inventory-row${dirty ? ' is-dirty' : ''}" data-inventory-row="${variant.id}">
        <td><strong>${escapeHtml(variant.size || 'Única')}</strong>${variant.isActive ? '' : '<br><small>Variante inactiva</small>'}</td>
        <td>${escapeHtml(variant.sku || '—')}</td><td>${formatNumber(variant.stockQty)}</td>
        <td><span class="chip ${stockChip(variant.status)}">${stockLabel(variant.status)}</span></td>
        <td><label class="inventory-visually-hidden" for="inventory-stock-${variant.id}">Nuevo stock para ${escapeHtml(variant.size || variant.sku)}</label>
          <input id="inventory-stock-${variant.id}" class="input inventory-stock-input${dirty ? ' is-dirty' : ''}" data-inventory-stock="${variant.id}" data-product-id="${product.id}" type="number" min="0" max="2147483647" step="1" inputmode="numeric" value="${escapeHtml(Number.isNaN(value) ? '' : value)}" ${saving ? 'disabled' : ''}></td>
      </tr>`;
    }).join('');
    const dirtyCount = Array.from(edits.values()).filter((edit) => edit.value !== edit.expectedStock).length;
    return `<div class="inventory-product__detail">
      <div class="inventory-table-wrap"><table class="inventory-table"><thead><tr><th scope="col">Talla</th><th scope="col">SKU</th><th scope="col">Stock actual</th><th scope="col">Estado</th><th scope="col">Nuevo stock</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="inventory-detail-actions"><span class="inventory-unsaved" role="status">${dirtyCount ? `${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'} sin guardar` : ''}</span>
        <button class="btn primary" type="button" data-save-inventory="${product.id}" ${!dirtyCount || saving ? 'disabled' : ''}>${saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
      <div class="inventory-history"><button class="btn" type="button" data-toggle-inventory-history="${product.id}" aria-expanded="false">Historial de inventario</button>
        <div data-inventory-history="${product.id}" hidden><div class="inventory-history-list" data-inventory-history-list="${product.id}"></div></div></div>
    </div>`;
  };

  const render = () => {
    if (!list) return;
    if (!state.items.length) {
      list.innerHTML = '<div class="empty-state"><strong>No hay productos que coincidan</strong><span>Prueba con otros filtros o términos de búsqueda.</span></div>';
      return;
    }
    list.innerHTML = state.items.map((product) => {
      const expanded = state.expanded.has(product.id);
      const image = safeImage(product.imageUrl);
      const status = window.CRONOX_STOCK?.classifyStock(product.totalStock) || product.stockStatus;
      const statusClass = status === 'low' ? 'low-stock' : status.replace(/_/g, '-');
      return `<article class="inventory-product inventory-product--${statusClass}" aria-label="${escapeHtml(product.name)}: ${stockLabel(status)}" data-inventory-product="${product.id}"><div class="inventory-product__overview">
        <div class="inventory-product__identity"><div class="inventory-product__image">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : 'Sin imagen'}</div>
          <div><h3 class="inventory-product__name">${escapeHtml(product.name)}</h3><div class="inventory-product__meta">ID ${product.id} · ${escapeHtml(product.slug)}</div></div></div>
        <div class="inventory-metric"><span>Estado</span><strong>${product.isActive ? 'Activo' : 'Inactivo'}</strong></div>
        <div class="inventory-metric"><span>Stock total</span><strong>${formatNumber(product.totalStock)} · ${stockLabel(product.stockStatus)}</strong></div>
        <div class="inventory-metric"><span>Variantes</span><strong>${formatNumber(product.variantCount)}</strong></div>
        <button class="btn inventory-expand" type="button" data-toggle-inventory="${product.id}" aria-expanded="${expanded}">${expanded ? 'Cerrar detalle' : 'Gestionar stock'}</button>
      </div>${expanded ? renderDetail(product) : ''}</article>`;
    }).join('');
    state.items.forEach((product) => { if (state.history.has(product.id)) renderHistory(product.id); });
  };

  const query = () => ({ page: state.page, pageSize: state.pageSize, search: search?.value.trim() || undefined, isActive: activeFilter?.value || undefined, stockStatus: stockFilter?.value || undefined });

  const load = async () => {
    if (!window.CRONOX_API?.admin?.listInventory) return;
    list?.setAttribute('aria-busy', 'true');
    if (list) list.innerHTML = '<div class="empty-state"><strong>Cargando inventario&hellip;</strong></div>';
    setMessage();
    try {
      const [response, summary] = await Promise.all([window.CRONOX_API.admin.listInventory(query()), window.CRONOX_API.admin.getInventorySummary()]);
      state.items = Array.isArray(response?.items) ? response.items : [];
      state.page = Number(response?.meta?.page) || 1;
      state.totalPages = Number(response?.meta?.totalPages) || 1;
      const total = Number(response?.meta?.totalItems) || 0;
      if (pageInfo) pageInfo.textContent = `Página ${state.page} de ${state.totalPages} · ${total} resultados`;
      if (previous) previous.disabled = state.page <= 1;
      if (next) next.disabled = state.page >= state.totalPages;
      renderSummary(summary); render(); state.loaded = true;
    } catch (error) {
      console.error('[INVENTARIO] Error al cargar', error);
      setMessage(error?.message || 'No se ha podido cargar el inventario.', 'error');
      if (list) list.innerHTML = '<div class="empty-state"><strong>No se ha podido cargar el inventario</strong><span>Inténtalo de nuevo.</span></div>';
    } finally { list?.setAttribute('aria-busy', 'false'); }
  };

  const save = async (productId) => {
    if (state.saving.has(productId)) return;
    const edits = productEdits(productId);
    const changes = Array.from(edits.entries()).filter(([, edit]) => edit.value !== edit.expectedStock).map(([variantId, edit]) => ({ variantId, stock: edit.value, expectedStock: edit.expectedStock }));
    if (!changes.length) return;
    if (changes.some((change) => !Number.isInteger(change.stock) || change.stock < 0 || change.stock > 2147483647)) {
      setMessage('Introduce números enteros entre 0 y 2.147.483.647.', 'error'); return;
    }
    state.saving.add(productId); render();
    try {
      const updated = await window.CRONOX_API.admin.updateInventory(productId, { updates: changes });
      const index = state.items.findIndex((product) => product.id === productId);
      if (index >= 0) state.items[index] = updated;
      state.edits.delete(productId); state.history.delete(productId);
      setMessage('Inventario actualizado correctamente.', 'success');
      await window.CRONOX_API.admin.getInventorySummary().then(renderSummary);
    } catch (error) {
      console.error('[INVENTARIO] Error al guardar', error);
      setMessage(error?.message || 'No se ha podido actualizar el inventario. Revisa los valores e inténtalo de nuevo.', 'error');
    } finally {
      state.saving.delete(productId); render();
      list?.querySelector(`[data-inventory-product="${productId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const loadHistory = async (productId) => {
    if (state.history.has(productId)) return renderHistory(productId);
    renderHistory(productId);
    try {
      const response = await window.CRONOX_API.admin.getInventoryHistory(productId, { page: 1, pageSize: 20 });
      state.history.set(productId, Array.isArray(response?.items) ? response.items : []); renderHistory(productId);
    } catch (error) {
      const container = list?.querySelector(`[data-inventory-history-list="${productId}"]`);
      if (container) container.innerHTML = '<p class="empty">No se ha podido cargar el historial.</p>';
    }
  };

  list?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-inventory-stock]');
    if (!(input instanceof HTMLInputElement)) return;
    const productId = Number(input.dataset.productId); const variantId = Number(input.dataset.inventoryStock);
    const product = state.items.find((item) => item.id === productId); const variant = product?.variants?.find((item) => item.id === variantId);
    if (!variant) return;
    const value = input.value === '' ? Number.NaN : Number(input.value);
    const edits = productEdits(productId); edits.set(variantId, { value, expectedStock: variant.stockQty }); state.edits.set(productId, edits);
    const dirty = value !== variant.stockQty;
    input.classList.toggle('is-dirty', dirty);
    input.closest('.inventory-row')?.classList.toggle('is-dirty', dirty);
    const detail = input.closest('.inventory-product__detail');
    const dirtyCount = Array.from(edits.values()).filter((edit) => edit.value !== edit.expectedStock).length;
    const unsaved = detail?.querySelector('.inventory-unsaved');
    const saveButton = detail?.querySelector('[data-save-inventory]');
    if (unsaved) unsaved.textContent = dirtyCount ? `${dirtyCount} cambio${dirtyCount === 1 ? '' : 's'} sin guardar` : '';
    if (saveButton instanceof HTMLButtonElement) saveButton.disabled = dirtyCount === 0;
  });

  list?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle-inventory]');
    if (toggle) { const productId = Number(toggle.dataset.toggleInventory); state.expanded.has(productId) ? state.expanded.delete(productId) : state.expanded.add(productId); render(); return; }
    const saveButton = event.target.closest('[data-save-inventory]');
    if (saveButton) return void save(Number(saveButton.dataset.saveInventory));
    const historyButton = event.target.closest('[data-toggle-inventory-history]');
    if (historyButton) {
      const productId = Number(historyButton.dataset.toggleInventoryHistory); const panel = list.querySelector(`[data-inventory-history="${productId}"]`); const opens = Boolean(panel?.hidden);
      if (panel) panel.hidden = !opens; historyButton.setAttribute('aria-expanded', String(opens)); if (opens) void loadHistory(productId);
    }
  });

  const resetAndLoad = () => { state.page = 1; void load(); };
  search?.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(resetAndLoad, 300); });
  activeFilter?.addEventListener('change', resetAndLoad); stockFilter?.addEventListener('change', resetAndLoad);
  pageSize?.addEventListener('change', () => { state.pageSize = Number(pageSize.value) || 20; resetAndLoad(); });
  previous?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; void load(); } });
  next?.addEventListener('click', () => { if (state.page < state.totalPages) { state.page += 1; void load(); } });
  refresh?.addEventListener('click', () => void load());
  window.CRONOX_INVENTORY = { load };
})();
