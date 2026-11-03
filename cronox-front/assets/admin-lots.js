(() => {
  'use strict';
  const root = document.getElementById('productLots');
  if (!root) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = v => v == null ? 'Pendiente' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v / 100);
  let productId, version = 0, current, busy = false;
  const api = async (suffix = '', data, key, method = 'POST') => {
    const response = await fetch((window.CRONOX_API?.API_BASE || '') + `/api/admin/products/${productId}/lots${suffix}`, {
      method: data ? method : 'GET', credentials: 'include', cache: 'no-store',
      headers: { Accept: 'application/json', ...(data ? { ...(await window.CRONOX_API.getCsrfHeaders()), 'Content-Type': 'application/json', 'Idempotency-Key': key || crypto.randomUUID() } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message.join(' · ') : result.message || 'No se pudo completar la operación.');
    return result;
  };
  const input = (name, label, type = 'text', value = '', extra = '') => `<label>${esc(label)}<input class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const cents = (form, name) => {
    const value = String(form.get(name) || '').trim();
    if (!value) return null;
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) throw new Error('Utiliza importes positivos con un máximo de dos decimales.');
    const [whole, fraction = ''] = value.replace(',', '.').split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amount) || amount > 1000000000) throw new Error('Importe fuera de rango.');
    return amount;
  };
  function draw() {
    const { product, lots } = current;
    root.innerHTML = `<h4>Lotes</h4><p>Precio público vigente: ${money(product.price)}. Se cambia en «Precio» al editar el producto; registrar una tirada no lo modifica.</p><p>El transporte de aprovisionamiento pertenece al lote. El envío al cliente se registra en el pedido.</p><p data-lot-message role="status"></p><div data-lot-content></div>`;
    const content = root.querySelector('[data-lot-content]');
    if (!product.lotManaged) {
      content.innerHTML = '<p>Revisa el saldo y las incidencias antes de activar los lotes. No se asignarán costes actuales a ventas antiguas.</p><button type="button" class="btn" data-lot-preview>Previsualizar conciliación inicial</button><div data-lot-preview-result></div>';
      content.querySelector('[data-lot-preview]').onclick = () => operate(async () => {
        const preview = await api('/preview');
        content.querySelector('[data-lot-preview-result]').innerHTML = `<ul>${preview.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul><p>${preview.historical.length} líneas históricas conservadas. Reservas activas: ${preview.reserved}.</p><ul>${preview.variants.map(v => `<li>${esc(v.size)}: ${v.stockQty} disponibles; coste y fecha de recepción pendientes.</li>`).join('')}</ul><button class="btn" type="button" data-lot-activate ${preview.reserved ? 'disabled' : ''}>Aceptar este saldo inicial</button>`;
        content.querySelector('[data-lot-activate]').onclick = () => operate(async () => { await api('/activate', { previewHash: preview.previewHash }); await refresh(); });
      });
      return;
    }
    content.innerHTML = `<div style="overflow-x:auto"><table class="table"><thead><tr><th>Lote</th><th>Recepción</th><th>Recibidas / saldo inicial</th><th>Disponibles</th><th>Reservadas</th><th>Vendidas</th><th>Devueltas</th><th>Repuestas</th><th>Coste recibido</th><th>Calidad del coste</th><th>Detalle</th></tr></thead><tbody>${lots.map(l => {
      const sum = fn => l.allocations.reduce((s, a) => s + fn(a), 0);
      const receivedCost = l.slices.some(s => [s.productionCents,s.freightCents,s.otherCents].some(v => v == null)) ? null : l.slices.reduce((total,s) => total+s.received*(s.productionCents+s.freightCents+s.otherCents),0);
      return `<tr><td>${esc(l.name)}${l.archived ? ' (archivado)' : ''}</td><td>${l.receivedAt ? esc(l.receivedAt.slice(0, 10)) : 'Pendiente'}</td><td>${l.slices.reduce((s,x) => s+x.received,0)}</td><td>${l.slices.reduce((s, x) => s + x.available, 0)}</td><td>${sum(a => a.state === 'RESERVED' ? a.quantity - a.returned : 0)}</td><td>${sum(a => a.state === 'SOLD' ? a.quantity : 0)}</td><td>${sum(a => a.state === 'SOLD' ? a.returned + (a.retired || 0) : 0)}</td><td>${sum(a => a.state === 'SOLD' ? a.returned : 0)}</td><td>${money(receivedCost)}</td><td>${({ CONFIRMED: 'Confirmados', ESTIMATED: 'Estimados', UNKNOWN: 'Pendientes' })[l.costQuality]}</td><td><button class="btn" type="button" data-lot-detail="${esc(l.id)}">Ver / corregir</button></td></tr>`;
    }).join('')}</tbody></table></div><div data-lot-detail-panel></div><details><summary>Registrar nuevo lote</summary><form data-lot-create><div class="form-grid">${input('name', 'Nombre del lote', 'text', '', 'required maxlength="160"')}${input('receivedAt', 'Fecha de recepción', 'date', '', 'required')}${input('referencePrice', 'Precio previsto de referencia (€)', 'number', '', 'min="0" step="0.01"')}${input('freight', 'Transporte de aprovisionamiento total (€)', 'number', '', 'min="0" step="0.01"')}${input('other', 'Otros gastos del lote (€)', 'number', '', 'min="0" step="0.01"')}<label>Estado de los costes<select class="input" name="costQuality"><option value="CONFIRMED">Confirmados</option><option value="ESTIMATED">Estimados</option><option value="UNKNOWN">Pendientes</option></select></label></div><p>Reparto por unidades recibidas, conservando cada céntimo. Un importe vacío es desconocido; 0 significa coste cero.</p>${product.variants.map(v => `<fieldset><legend>${esc(v.size)}</legend><div class="form-grid">${input('qty-' + v.id, 'Unidades recibidas', 'number', '0', 'min="0" max="100000" step="1"')}${input('cost-' + v.id, 'Producción por unidad (€)', 'number', '', 'min="0" step="0.01"')}</div></fieldset>`).join('')}<label>Notas<textarea class="input" name="notes" maxlength="2000"></textarea></label><button type="submit" class="btn primary">Registrar lote</button></form></details>`;
    content.insertAdjacentHTML('afterbegin', `<details><summary>Rentabilidad por lote</summary><form data-lot-report><div class="form-grid">${input('from', 'Desde', 'date', '2000-01-01', 'required')}${input('to', 'Hasta', 'date', new Date().toISOString().slice(0,10), 'required')}</div><button class="btn" type="submit">Consultar informe</button></form><div data-lot-report-result></div></details>`);
    content.querySelector('[data-lot-report]').onsubmit = event => { event.preventDefault(); const values = new FormData(event.target); operate(async () => {
      const report = await api('/report?' + new URLSearchParams({ from: values.get('from'), to: values.get('to') }));
      content.querySelector('[data-lot-report-result]').innerHTML = `<p>${esc(report.definition)}</p><div style="overflow-x:auto"><table class="table"><thead><tr><th>Lote</th><th>Vendidas</th><th>Devueltas</th><th>Ingresos</th><th>Costes</th><th>Calidad del coste</th><th>Beneficio</th><th>Margen</th><th>Stock</th><th>Valoración</th></tr></thead><tbody>${report.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.unitsSold}</td><td>${r.unitsReturned}</td><td>${money(r.revenueCents)}</td><td>${money(r.costCents)}</td><td>${({ CONFIRMED: 'Confirmado', ESTIMATED: 'Estimado', UNKNOWN: 'Pendiente' })[r.quality]}</td><td>${money(r.profitCents)}</td><td>${r.marginPercent == null ? 'Pendiente' : r.marginPercent.toFixed(2) + '%'}</td><td>${r.available}</td><td>${money(r.stockValueCents)}</td></tr>`).join('')}</tbody></table></div><ul>${report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
    }); };
    content.insertAdjacentHTML('beforeend', '<details><summary>Conciliar costes y lotes de ventas anteriores</summary><p>Esta corrección es explícita y auditada. No cambia precios cobrados ni stock. Introduce únicamente datos respaldados por la venta y sus justificantes.</p><button class="btn" type="button" data-history-load>Cargar ventas</button><div data-history></div></details>');
    let historyPage = 1;
    content.querySelector('[data-history-load]').onclick = () => operate(async () => {
      const [orders, points] = await Promise.all([api('/historical?page=' + historyPage), api('/point-history?page=' + historyPage)]);
      const sales = [...orders, ...points.map(p => ({ ...p, title: p.line.name, financialSnapshot: null }))], host = content.querySelector('[data-history]');
      host.innerHTML = `<label>Venta<select class="input" data-history-select><option value="">Selecciona una línea</option>${sales.map((sale,i) => `<option value="${i}">${sale.entryId ? 'Venta física · ' + esc(sale.description) : 'Pedido #' + sale.orderId} · ${esc(sale.title)} · ${sale.quantity} unidades</option>`).join('')}</select></label><div data-history-editor></div><small>Se muestran hasta 200 pedidos y 200 movimientos físicos con este producto. Cada corrección conserva su registro original. Página ${historyPage}.</small><button class="btn" type="button" data-history-prev ${historyPage === 1 ? 'disabled' : ''}>Más recientes</button><button class="btn" type="button" data-history-next>Más antiguos</button>`;
      host.querySelector('[data-history-prev]').onclick = () => { historyPage--; content.querySelector('[data-history-load]').click(); };
      host.querySelector('[data-history-next]').onclick = () => { historyPage++; content.querySelector('[data-history-load]').click(); };
      host.querySelector('select').onchange = event => {
        const target = host.querySelector('[data-history-editor]');
        if (event.target.value === '') { target.innerHTML = ''; return; }
        const sale = sales[Number(event.target.value)];
        target.innerHTML = `<form data-history-form><p>Coste unitario antiguo: ${money(sale.financialSnapshot?.unitCostCents)}. Cantidad total que debe justificarse: ${sale.quantity}.</p><div data-history-parts></div><button type="button" class="btn" data-history-add>Añadir otro lote</button>${input('reason', 'Motivo y justificantes', 'text', '', 'required maxlength="500"')}<button type="submit" class="btn primary">Guardar conciliación histórica</button></form>`;
        const form = target.querySelector('form'), parts = form.querySelector('[data-history-parts]');
        const add = () => { const index = parts.children.length; parts.insertAdjacentHTML('beforeend', `<fieldset data-part="${index}"><legend>Asignación ${index+1}</legend><label>Lote<select class="input" name="lot-${index}" required>${lots.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label><label>Salida de stock ya registrada (opcional)<select class="input" name="withdrawal-${index}"><option value="">Sin salida verificable / solo conciliar costes</option>${lots.flatMap(l => l.allocations.filter(a => a.state === 'ADJUSTED' && a.quantity-a.returned-(a.retired || 0)>0).map(a => `<option value="${esc(a.sourceKey)}">${esc(l.name)} · ${a.quantity-a.returned-(a.retired || 0)} unidades · ${esc(a.sourceKey)}</option>`)).join('')}</select></label>${input('qty-'+index,'Unidades','number',index === 0 ? sale.quantity : '', 'required min="1" step="1"')}${input('production-'+index,'Producción por unidad (€)','number','','required min="0" step="0.01"')}${input('freight-'+index,'Aprovisionamiento por unidad (€)','number','','required min="0" step="0.01"')}${input('other-'+index,'Otros costes por unidad (€)','number','','required min="0" step="0.01"')}<label>Calidad<select class="input" name="quality-${index}"><option value="CONFIRMED">Confirmados</option><option value="ESTIMATED">Estimados</option></select></label></fieldset>`); };
        add(); form.querySelector('[data-history-add]').onclick = add;
        form.onsubmit = event => { event.preventDefault(); const values = new FormData(form); operate(async () => {
          await api(sale.entryId ? '/point-history' : '/historical', { ...(sale.entryId ? { entryId: sale.entryId, lineIndex: sale.lineIndex } : { orderId: sale.orderId, itemId: sale.itemId }), revision: sale.revision, reason: values.get('reason'), parts: [...parts.children].map((_, i) => ({ lotId: values.get('lot-'+i), ...(values.get('withdrawal-'+i) ? { adjustmentSourceKey: values.get('withdrawal-'+i) } : {}), quantity: Number(values.get('qty-'+i)), productionCents: cents(values,'production-'+i), freightCents: cents(values,'freight-'+i), otherCents: cents(values,'other-'+i), quality: values.get('quality-'+i) })) });
          await refresh();
        }); };
      };
    });
    const form = content.querySelector('[data-lot-create]');
    let requestKey = crypto.randomUUID(), previousPayload;
    form.onsubmit = event => { event.preventDefault(); operate(async () => {
      const values = new FormData(form);
      const payload = { name: values.get('name'), receivedAt: values.get('receivedAt'), notes: values.get('notes'), costQuality: values.get('costQuality'), referencePriceCents: cents(values, 'referencePrice'), freightTotalCents: cents(values, 'freight'), otherTotalCents: cents(values, 'other'), lines: product.variants.map(v => ({ variantId: v.id, quantity: Number(values.get('qty-' + v.id)), productionCents: cents(values, 'cost-' + v.id) })).filter(l => l.quantity > 0) };
      if (previousPayload && previousPayload !== JSON.stringify(payload)) requestKey = crypto.randomUUID();
      previousPayload = JSON.stringify(payload);
      await api('', payload, requestKey); await refresh();
    }); };
    content.querySelectorAll('[data-lot-detail]').forEach(button => { button.onclick = () => {
      const lot = lots.find(l => l.id === button.dataset.lotDetail);
      const panel = content.querySelector('[data-lot-detail-panel]');
      panel.innerHTML = `<h5>${esc(lot.name)}</h5><p>${lot.openingBalance ? 'Saldo observado; no acredita fabricación ni fecha de recepción.' : 'Recepción documentada.'} Los costes ya asignados a ventas quedan congelados.</p><ul>${lot.slices.map(s => `<li>Variante #${s.variantId}: ${s.received} unidades · disponibles ${s.available} · producción ${money(s.productionCents)} + transporte ${money(s.freightCents)} + otros ${money(s.otherCents)} por unidad. Total unitario: ${money([s.productionCents,s.freightCents,s.otherCents].some(v => v == null) ? null : s.productionCents+s.freightCents+s.otherCents)}.</li>`).join('')}</ul><details><summary>Asignaciones y movimientos</summary><ul>${lot.allocations.map(a => `<li>${esc(a.createdAt || '')} · ${esc(a.sourceKey || '')} · ${esc(({ RESERVED: 'Reservado', SOLD: 'Vendido', RELEASED: 'Liberado', ADJUSTED: 'Ajuste de inventario' })[a.state] || a.state)} · ${a.quantity} unidades · repuestas ${a.returned} · ${a.state === 'ADJUSTED' ? 'vinculadas a venta' : 'devueltas sin reposición'} ${a.retired || 0}</li>`).join('')}</ul></details><form data-lot-edit>${input('receivedAt', 'Fecha de recepción (vacía si se desconoce)', 'date', lot.receivedAt?.slice(0,10) || '')}${input('referencePrice', 'Precio previsto de referencia (€)', 'number', lot.referencePriceCents == null ? '' : lot.referencePriceCents / 100, 'min="0" step="0.01"')}${input('name', 'Nombre', 'text', lot.name, 'required maxlength="160"')}<label>Notas<textarea class="input" name="notes" maxlength="2000">${esc(lot.notes)}</textarea></label><label><input name="archived" type="checkbox" ${lot.archived ? 'checked' : ''}>Archivado (conserva saldo e histórico)</label>${input('reason', 'Motivo de la corrección', 'text', '', 'required maxlength="500"')}<button class="btn" type="submit">Guardar corrección</button></form><details><summary>Historial</summary><ul>${lot.history.map(h => `<li>${esc(h.createdAt)} · ${esc(h.reason)} · administrador #${h.actorId ?? '—'}</li>`).join('')}</ul></details>`;
      if (!lot.allocations.length && lot.slices.length) {
        const variants = [...new Set(lot.slices.map(s => s.variantId))];
        panel.insertAdjacentHTML('beforeend', `<details><summary>Completar o corregir costes sin movimientos</summary><form data-lot-costs><p>Conserva las cantidades del lote. En saldos iniciales, imputa solo los gastos verificables de estas unidades. Vacío = desconocido; 0 = coste cero.</p>${input('freight', 'Transporte total (€)', 'number', lot.freightTotalCents == null ? '' : lot.freightTotalCents / 100, 'min="0" step="0.01"')}${input('other', 'Otros gastos (€)', 'number', lot.otherTotalCents == null ? '' : lot.otherTotalCents / 100, 'min="0" step="0.01"')}${variants.map(id => input('cost-' + id, 'Producción por unidad · variante #' + id + ' (€)', 'number', lot.slices.find(s => s.variantId === id).productionCents == null ? '' : lot.slices.find(s => s.variantId === id).productionCents / 100, 'min="0" step="0.01"')).join('')}<label>Estado<select class="input" name="costQuality"><option value="CONFIRMED">Confirmados</option><option value="ESTIMATED">Estimados</option><option value="UNKNOWN">Pendientes</option></select></label>${input('reason', 'Motivo y evidencia de la corrección', 'text', '', 'required maxlength="500"')}<button class="btn" type="submit">Guardar costes</button></form></details>`);
        panel.querySelector('[data-lot-costs]').onsubmit = event => { event.preventDefault(); const values = new FormData(event.target); operate(async () => { await api('/' + lot.id + '/costs', { revision: lot.revision, reason: values.get('reason'), costQuality: values.get('costQuality'), freightTotalCents: cents(values, 'freight'), otherTotalCents: cents(values, 'other'), lines: variants.map(id => ({ variantId: id, quantity: lot.slices.filter(s => s.variantId === id).reduce((n,s) => n+s.received,0), productionCents: cents(values, 'cost-' + id) })) }); await refresh(); }); };
      }
      panel.querySelector('form').onsubmit = event => { event.preventDefault(); const values = new FormData(event.target); operate(async () => { await api('/' + lot.id, { revision: lot.revision, receivedAt: values.get('receivedAt') || null, referencePriceCents: cents(values, 'referencePrice'), name: values.get('name'), notes: values.get('notes'), archived: values.has('archived'), reason: values.get('reason') }, undefined, 'PATCH'); await refresh(); }); };
    }; });
  }
  async function operate(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (error) { const box = root.querySelector('[data-lot-message]'); if (box) box.textContent = error.message; }
    finally { busy = false; }
  }
  async function refresh() {
    const expected = version;
    const data = await api();
    if (expected !== version) return;
    current = data; draw();
  }
  window.CRONOX_LOTS = { load(id) { productId = id; version++; root.hidden = !id; root.innerHTML = '<h4>Lotes</h4><p data-lot-message role="status">Cargando…</p>'; if (id) void refresh().catch(error => { const box = root.querySelector('[data-lot-message]'); if (box) box.textContent = error.message; }); } };
})();
