(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const date = value => new Date(value + 'T12:00:00Z');
  const iso = value => value.toISOString().slice(0, 10);
  const shift = (value, days) => { const d = date(value); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
  const label = value => date(value).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric', timeZone:'UTC' });
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date(value).getTime()) && iso(date(value)) === value;
  const presets = ['Personalizado', 'Hoy', 'Esta semana', 'Últimos 30 días', 'Últimos 90 días', 'Últimos 12 meses'];
  function presetRange(name) {
    const to = today(); let from = to;
    if (name === 'Esta semana') from = shift(to, -((date(to).getUTCDay() + 6) % 7));
    if (name === 'Últimos 30 días') from = shift(to, -29);
    if (name === 'Últimos 90 días') from = shift(to, -89);
    if (name === 'Últimos 12 meses') { const d = date(to); d.setUTCFullYear(d.getUTCFullYear() - 1); from = shift(iso(d), 1); }
    return { from, to };
  }
  let shared = { ...presetRange('Últimos 30 días'), aggregation:'days', sort:'revenue', direction:'desc', currency:'EUR', search:'', page:1 };
  const instances = new Map();
  const statusLabels = { PAID:'Pagado', PROCESSING:'En preparación', SHIPPED:'Enviado', DELIVERED:'Entregado', REFUNDED:'Reembolsado', DISPUTED:'En disputa', CANCELLED:'Anulado' };
  const currencyFormat = currency => value => value === null ? 'No disponible' : new Intl.NumberFormat('es-ES', { style:'currency', currency }).format(value / 100);
  const safeImage = url => { if (typeof url !== 'string' || !url.trim()) return null; try { const parsed = new URL(url, location.origin); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };
  const thumbnail = product => safeImage(product.imageUrl) ? `<img class="finance-thumb" src="${esc(safeImage(product.imageUrl))}" alt="" loading="lazy">` : '<span class="finance-thumb" aria-hidden="true">CR</span>';
  const amountCell = (value, money) => value === null ? '<span class="finance-unknown" title="Faltan datos históricos fiables">No disponible</span>' : esc(money(value));

  function urlFor(page, state) {
    const params = new URLSearchParams();
    Object.entries(state).forEach(([key, value]) => params.set(key, String(value)));
    return `#section-${page === 'money' ? 'money' : 'dashboard'}?${params}`;
  }
  function navigate(page, patch) {
    const next = { ...shared, ...patch };
    window.CRONOX_ADMIN_NAV?.navigate(urlFor(page, next));
  }

  class DatePicker {
    constructor(host, state, apply) {
      this.host = host; this.applied = { from:state.from, to:state.to }; this.apply = apply;
      this.host.innerHTML = '<button class="finance-range-button" type="button" aria-haspopup="dialog" aria-expanded="false"></button><div class="finance-picker" role="dialog" aria-label="Seleccionar intervalo de fechas" hidden></div>';
      this.button = host.querySelector('button'); this.panel = host.querySelector('.finance-picker');
      this.button.innerHTML = `<span>${esc(this.presetName(state))}</span>${esc(label(state.from))} – ${esc(label(state.to))} ⌄`;
      this.button.addEventListener('click', () => this.panel.hidden ? this.open() : this.close());
      this.outside = event => { if (!event.composedPath().includes(host)) this.close(false); };
      this.keyboard = event => { if (event.key === 'Escape' && !this.panel.hidden) { event.stopPropagation(); this.close(); } };
      this.focusout = event => { if (event.relatedTarget && !host.contains(event.relatedTarget)) this.close(false); };
      document.addEventListener('click', this.outside);
      host.addEventListener('keydown', this.keyboard);
      host.addEventListener('focusout', this.focusout);
    }
    destroy() { document.removeEventListener('click', this.outside); this.host.removeEventListener('keydown', this.keyboard); this.host.removeEventListener('focusout', this.focusout); }
    presetName(range) { return presets.slice(1).find(name => { const p = presetRange(name); return p.from === range.from && p.to === range.to; }) || 'Personalizado'; }
    open() {
      this.draft = { ...this.applied }; this.month = this.draft.to.slice(0, 7); this.anchor = null;
      this.panel.hidden = false; this.button.setAttribute('aria-expanded', 'true'); this.render(); this.panel.querySelector('input')?.focus();
    }
    close(focus = true) { this.panel.hidden = true; this.button.setAttribute('aria-expanded', 'false'); if (focus) this.button.focus(); }
    render() {
      const active = this.presetName(this.draft);
      this.panel.innerHTML = `<div class="finance-presets">${presets.map(name => `<button type="button" data-preset="${esc(name)}" aria-pressed="${name === active}">${esc(name)}</button>`).join('')}</div><div class="finance-calendar-panel"><div class="finance-date-fields"><label>Desde<input type="date" data-date="from" value="${esc(this.draft.from)}" min="2000-01-01" max="2100-12-31"></label><label>Hasta<input type="date" data-date="to" value="${esc(this.draft.to)}" min="2000-01-01" max="2100-12-31"></label></div><div class="finance-month-nav"><button type="button" data-month="-1" aria-label="Mes anterior">‹</button><strong>${date(this.month + '-01').toLocaleDateString('es-ES', { month:'long', year:'numeric', timeZone:'UTC' })}</strong><button type="button" data-month="1" aria-label="Mes siguiente">›</button></div><div class="finance-calendar" role="group" aria-label="Calendario"></div><div class="finance-picker-error" role="alert"></div><div class="finance-picker-actions"><button type="button" data-cancel>Cancelar</button><button type="button" class="apply" data-apply>Aplicar</button></div></div>`;
      this.renderCalendar();
      this.panel.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
        if (button.dataset.preset !== 'Personalizado') {
          this.draft = presetRange(button.dataset.preset); this.month = this.draft.to.slice(0, 7); this.anchor = null; this.render();
          [...this.panel.querySelectorAll('[data-preset]')].find(next => next.dataset.preset === button.dataset.preset)?.focus();
        }
        else this.panel.querySelector('input')?.focus();
      }));
      this.panel.querySelectorAll('[data-date]').forEach(input => input.addEventListener('change', () => {
        this.draft[input.dataset.date] = input.value;
        if (valid(input.value)) this.month = input.value.slice(0, 7);
        this.anchor = null; this.renderCalendar();
      }));
      this.panel.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => {
        const d = date(this.month + '-01'); d.setUTCMonth(d.getUTCMonth() + Number(button.dataset.month)); this.month = iso(d).slice(0, 7); this.render();
        this.panel.querySelector(`[data-month="${button.dataset.month}"]`)?.focus();
      }));
      this.panel.querySelector('[data-cancel]').addEventListener('click', () => this.close());
      this.panel.querySelector('[data-apply]').addEventListener('click', () => {
        if (!valid(this.draft.from) || !valid(this.draft.to) || this.draft.from > this.draft.to || this.draft.from < '2000-01-01' || this.draft.to > '2100-12-31') {
          this.panel.querySelector('[role="alert"]').textContent = 'Selecciona un intervalo válido: Desde debe ser anterior o igual a Hasta.'; return;
        }
        this.close(); this.apply(this.draft);
      });
    }
    renderCalendar() {
      const calendar = this.panel.querySelector('.finance-calendar');
      this.panel.querySelector('.finance-month-nav strong').textContent = date(this.month + '-01').toLocaleDateString('es-ES', { month:'long', year:'numeric', timeZone:'UTC' });
      this.panel.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.preset === this.presetName(this.draft))));
      const first = this.month + '-01', offset = (date(first).getUTCDay() + 6) % 7;
      calendar.innerHTML = ['L','M','X','J','V','S','D'].map(day => `<span aria-hidden="true">${day}</span>`).join('') + Array.from({ length:42 }, (_, i) => {
        const day = shift(first, i - offset), endpoint = day === this.draft.from || day === this.draft.to;
        return `<button type="button" data-day="${day}" aria-label="${esc(label(day))}" aria-pressed="${endpoint}" class="${day.slice(0,7) !== this.month ? 'outside ' : ''}${day >= this.draft.from && day <= this.draft.to ? 'in-range ' : ''}${endpoint ? 'endpoint' : ''}">${Number(day.slice(-2))}</button>`;
      }).join('');
      calendar.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
          const day = button.dataset.day;
          if (!this.anchor) { this.anchor = day; this.draft = { from:day, to:day }; }
          else { this.draft = { from:day < this.anchor ? day : this.anchor, to:day > this.anchor ? day : this.anchor }; this.anchor = null; }
          this.render(); this.panel.querySelector(`[data-day="${day}"]`)?.focus();
        });
        button.addEventListener('keydown', event => {
          const delta = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-7, ArrowDown:7 }[event.key];
          if (!delta) return; event.preventDefault();
          const next = shift(button.dataset.day, delta);
          if (!calendar.querySelector(`[data-day="${next}"]`)) { this.month = next.slice(0,7); this.render(); }
          this.panel.querySelector(`[data-day="${next}"]`)?.focus();
        });
      });
    }
  }

  function drawChart(host, report, money) {
    const data = report.buckets, width = host.clientWidth || 1000, height = host.clientHeight || 285;
    const right = 14, top = 20, bottom = 37, h = height - top - bottom;
    const values = data.flatMap(point => [point.revenueCents, point.profitCents]).filter(value => value !== null);
    let min = Math.min(0, ...values), max = Math.max(0, ...values);
    if (max === min) max = 100;
    const pad = (max - min) * .08; max += pad; if (min < 0) min -= pad;
    // Reserve space for the complete currency labels, including large/negative totals.
    const labelWidth = Math.max(money(Math.round(min)).length, money(Math.round(max)).length) * 6.5 + 16;
    const left = Math.min(width * .5, Math.max(width < 500 ? 55 : 72, labelWidth)), w = width - left - right;
    const x = index => left + index / Math.max(1, data.length - 1) * w;
    const y = value => top + (max - value) / (max - min) * h;
    const path = field => { let open = false; return data.map((point, i) => {
      if (point[field] === null) { open = false; return ''; }
      const command = `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(point[field]).toFixed(1)}`; open = true; return command;
    }).join(' '); };
    const pointDate = value => value.length === 7 ? date(value + '-01').toLocaleDateString('es-ES', { month:'short', year:'2-digit', timeZone:'UTC' }) : date(value).toLocaleDateString('es-ES', { day:'2-digit', month:'short', timeZone:'UTC' });
    const tickCount = Math.min(data.length, Math.max(2, Math.floor(w / 86) + 1));
    const tickIndices = new Set(Array.from({length:tickCount}, (_, i) => Math.round(i * (data.length - 1) / Math.max(1, tickCount - 1))));
    const grid = Array.from({ length:6 }, (_, i) => {
      const value = min + (max - min) * i / 5, py = y(value);
      return `<line x1="${left}" x2="${width-right}" y1="${py}" y2="${py}" stroke="#e9ecf1"/><text x="${left-9}" y="${py+4}" text-anchor="end">${esc(money(Math.round(value)))}</text>`;
    }).join('');
    const ticks = data.map((point, i) => tickIndices.has(i) ? `<text x="${x(i)}" y="${height-8}" text-anchor="${i === 0 ? 'start' : i === data.length-1 ? 'end' : 'middle'}">${esc(pointDate(point.date))}</text>` : '').join('');
    const singlePoints = data.flatMap((point, i) => [['revenueCents','#1bad68'],['profitCents','#3e72ed']].map(([field,color]) => point[field] !== null && (data[i-1]?.[field] == null && data[i+1]?.[field] == null) ? `<circle cx="${x(i)}" cy="${y(point[field])}" r="3" fill="${color}"/>` : '')).join('');
    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Facturación en verde y beneficio neto en azul. Usa las flechas para consultar cada periodo.">${grid}${ticks}<path d="${path('revenueCents')}" fill="none" stroke="#1bad68" stroke-width="2"/><path d="${path('profitCents')}" fill="none" stroke="#3e72ed" stroke-width="2"/>${singlePoints}<line data-crosshair x1="0" x2="0" y1="${top}" y2="${height-bottom}" stroke="#a5afbf" stroke-dasharray="3 4" visibility="hidden"/></svg><div class="finance-tooltip" role="status" hidden></div>`;
    host.tabIndex = 0; host.setAttribute('role', 'group'); host.setAttribute('aria-label', 'Gráfico financiero interactivo. Flechas izquierda y derecha para consultar los valores.');
    const tooltip = host.querySelector('.finance-tooltip'), crosshair = host.querySelector('[data-crosshair]'); let index = 0;
    const show = i => {
      index = Math.max(0, Math.min(data.length-1, i)); const point = data[index]; if (!point) return;
      tooltip.innerHTML = `<strong>${esc(pointDate(point.date))}</strong><br>Facturación: ${esc(money(point.revenueCents))}<br>Beneficio neto: ${esc(money(point.profitCents))}`;
      tooltip.hidden = false; tooltip.style.top = '8px'; tooltip.style.left = Math.max(0, Math.min(width-tooltip.offsetWidth, x(index)+12)) + 'px';
      crosshair.setAttribute('x1', x(index)); crosshair.setAttribute('x2', x(index)); crosshair.setAttribute('visibility', 'visible');
    };
    host.onpointermove = event => show(Math.round((event.clientX - host.getBoundingClientRect().left - left) / w * (data.length-1)));
    host.onpointerdown = host.onpointermove;
    host.onpointerleave = () => { tooltip.hidden = true; crosshair.setAttribute('visibility', 'hidden'); };
    host.onfocus = () => show(index);
    host.onblur = host.onpointerleave;
    host.onkeydown = event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); show(event.key === 'Home' ? 0 : event.key === 'End' ? data.length-1 : index + (event.key === 'ArrowLeft' ? -1 : 1)); } };
  }

  function create(page) {
    const root = document.querySelector(`[data-finance-page="${page}"]`);
    const instance = { root, page, revision:0, abort:null, picker:null, observer:null };
    root?.addEventListener('error', event => {
      if (event.target.matches('img.finance-thumb')) {
        const fallback = document.createElement('span'); fallback.className = 'finance-thumb'; fallback.textContent = 'CR'; fallback.setAttribute('aria-hidden','true'); event.target.replaceWith(fallback);
      }
    }, true);
    instances.set(page, instance); return instance;
  }
  function header(instance, state) {
    clearTimeout(instance.searchTimer);
    instance.picker?.destroy(); instance.observer?.disconnect();
    const { root, page } = instance;
    root.innerHTML = `<div class="finance-heading"><div><h1 id="${page === 'money' ? 'title-money' : 'finance-summary-title'}">${page === 'money' ? 'Dinero' : 'Home'}</h1><p>${page === 'money' ? 'Resultados por producto, con los importes de cada venta.' : 'Así evoluciona tu tienda.'}</p></div><div class="finance-controls"><select class="select finance-currency" aria-label="Moneda" style="width:80px"><option>${esc(state.currency)}</option></select><div class="finance-range"></div></div></div><div class="finance-content" aria-live="polite" aria-busy="true"><div class="finance-card finance-empty">Cargando datos financieros…</div></div>`;
    instance.picker = new DatePicker(root.querySelector('.finance-range'), state, range => navigate(page, { ...range, page:1 }));
  }
  function render(instance, report, state) {
    const { root, page } = instance, money = currencyFormat(report.currency), content = root.querySelector('.finance-content');
    root.querySelector('.finance-currency').innerHTML = report.currencies.map(currency => `<option ${currency === state.currency ? 'selected' : ''}>${esc(currency)}</option>`).join('');
    root.querySelector('.finance-currency').onchange = event => navigate(page, { currency:event.target.value, page:1 });
    const totals = `<div class="finance-totals"><div class="finance-total"><span>Facturación</span><strong>${esc(money(report.totals.revenueCents))}</strong></div><div class="finance-total profit"><span>Beneficio neto</span><strong>${esc(money(report.totals.profitCents))}</strong></div></div>`;
    const warning = report.warnings.length ? `<details class="finance-warning"><summary>Datos incompletos · Ver detalle (${report.warnings.length})</summary>${report.warnings.map(text => `<div>${esc(text)}</div>`).join('')}</details>` : '';
    if (page === 'dashboard') {
      content.innerHTML = `<div class="finance-card"><div class="finance-chart-head"><div><h2>Ventas y beneficio</h2><p>Resultados del periodo seleccionado</p></div><div class="finance-segment" aria-label="Agrupación temporal"><button data-aggregation="days" aria-pressed="${state.aggregation === 'days'}">Días</button><button data-aggregation="months" aria-pressed="${state.aggregation === 'months'}">Meses</button></div></div>${totals}<div class="finance-chart"></div><div class="finance-chart-status">${report.products.length ? (report.totals.profitCents === null ? 'Los periodos con beneficio desconocido se muestran como interrupciones.' : '') : 'No hay ventas ni ajustes en este periodo.'}</div></div>${warning}<div class="finance-overviews"><article class="finance-card"><h2>Top 5 productos por facturación</h2><p>Productos con mayor facturación en este periodo</p><div class="finance-list">${report.topProducts.length ? report.topProducts.map(product => `<div class="finance-row">${thumbnail(product)}<div class="finance-row-title"><strong>${esc(product.name)}</strong><small>${product.unitsSold} unidades vendidas${product.unitsReturned ? ` · ${product.unitsReturned} devueltas` : ''}</small></div><span class="finance-row-amount">${esc(money(product.revenueCents))}</span></div>`).join('') : '<div class="finance-empty">No hay productos con facturación positiva conocida en este periodo.</div>'}</div><a class="finance-card-action" href="${esc(urlFor('money', { ...state, sort:'revenue', direction:'desc', search:'', page:1 }))}">Ver todos los productos</a></article><article class="finance-card"><h2>Últimos 5 pedidos</h2><p>Total del pedido, incluido el envío</p><div class="finance-list">${report.recentOrders.length ? report.recentOrders.map(order => `<a class="finance-row" href="#section-orders?order=${order.id}"><span class="finance-thumb" aria-hidden="true">↗</span><div class="finance-row-title"><strong>Pedido #${order.id}</strong><small>${esc(new Date(order.paidAt).toLocaleDateString('es-ES', { timeZone:'Europe/Madrid', day:'2-digit', month:'short', year:'numeric' }))} · ${esc(order.refundedCents > 0 && order.status !== 'REFUNDED' ? 'Reembolso parcial' : statusLabels[order.status] || order.status)}</small></div><span class="finance-row-amount">${esc(money(order.totalCents))}</span></a>`).join('') : '<div class="finance-empty">No hay pedidos pagados en este periodo.</div>'}</div><a class="finance-card-action" href="#section-orders">Ver todos los pedidos</a></article></div><p class="finance-notice">${esc(report.basis)}</p>`;
      root.querySelectorAll('[data-aggregation]').forEach(button => button.addEventListener('click', () => navigate(page, { aggregation:button.dataset.aggregation })));
      const host = root.querySelector('.finance-chart');
      drawChart(host, report, money);
      if (typeof ResizeObserver === 'function') { let lastWidth = host.clientWidth; instance.observer = new ResizeObserver(() => { if (host.clientWidth !== lastWidth) { lastWidth = host.clientWidth; drawChart(host, report, money); } }); instance.observer.observe(host); }
    } else {
      const options = [['revenue','Facturación'],['profit','Beneficio neto'],['units','Unidades vendidas']].flatMap(([value,text]) => ['desc','asc'].map(direction => `<option value="${value}:${direction}" ${state.sort === value && state.direction === direction ? 'selected' : ''}>${text}: ${direction === 'desc' ? 'mayor a menor' : 'menor a mayor'}</option>`)).join('');
      content.innerHTML = `<div class="finance-card"><h2>Resultados del periodo</h2>${totals}<p>Costes registrados: ${esc(money(report.totals.costCents))} · ${report.totals.unitsSold} unidades vendidas · ${report.totals.unitsReturned} devueltas</p></div>${warning}<p class="finance-notice">${esc(report.basis)} Los totales corresponden a todos los productos del periodo; la búsqueda filtra únicamente la tabla.</p><div class="finance-card"><h2>Resultados por producto</h2><div class="finance-searchbar"><input class="input" type="search" data-search placeholder="Buscar producto o ID" aria-label="Buscar producto o ID" value="${esc(state.search)}"><select class="select" data-sort aria-label="Ordenar productos">${options}</select></div><div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>Producto</th><th>Unidades vendidas</th><th>Devueltas</th><th>Facturación</th><th>Coste registrado</th><th>Beneficio neto</th></tr></thead><tbody>${report.products.length ? report.products.map(product => `<tr><td><div class="finance-row">${thumbnail(product)}<div class="finance-row-title"><strong>${esc(product.name)}</strong><small>#${product.productId}</small></div></div></td><td>${product.unitsSold}</td><td>${product.unitsReturned}</td><td>${amountCell(product.revenueCents,money)}</td><td>${amountCell(product.costCents,money)}</td><td>${amountCell(product.profitCents,money)}</td></tr>`).join('') : '<tr><td colspan="6" class="finance-empty">No hay productos que coincidan con este periodo y búsqueda.</td></tr>'}</tbody></table></div><div class="pagination"><span>${report.pagination.total} productos · Página ${report.pagination.page} de ${report.pagination.pages}</span><div class="page-controls"><button class="btn" data-page="${report.pagination.page-1}" ${report.pagination.page === 1 ? 'disabled' : ''}>Anterior</button><button class="btn" data-page="${report.pagination.page+1}" ${report.pagination.page === report.pagination.pages ? 'disabled' : ''}>Siguiente</button></div></div></div>`;
      const search = root.querySelector('[data-search]');
      search.addEventListener('input', () => { clearTimeout(instance.searchTimer); instance.searchTimer = setTimeout(() => { if (root.closest('.admin-section').hidden) return; instance.restoreSearch = { position:search.selectionStart }; navigate(page, { search:search.value, page:1 }); }, 400); });
      root.querySelector('[data-sort]').addEventListener('change', event => { const [sort,direction] = event.target.value.split(':'); navigate(page, { sort, direction, page:1 }); });
      root.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(page, { page:Number(button.dataset.page) })));
      if (instance.restoreSearch) { search.focus(); try { search.setSelectionRange(instance.restoreSearch.position, instance.restoreSearch.position); } catch {} instance.restoreSearch = null; }
    }
    content.setAttribute('aria-busy','false');
  }

  async function load(page) {
    const instance = instances.get(page) || create(page);
    if (!instance.root) return;
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const next = { ...shared };
    for (const key of ['from','to','aggregation','sort','direction','currency','search']) if (params.has(key)) next[key] = params.get(key);
    next.page = Number(params.get('page')) || 1;
    // Product search belongs to Dinero's table, never to the dashboard's activity state.
    if (page === 'dashboard') { next.search = ''; next.page = 1; }
    if (!valid(next.from) || !valid(next.to) || next.from > next.to) Object.assign(next, presetRange('Últimos 30 días'));
    if (!['days','months'].includes(next.aggregation)) next.aggregation = 'days';
    if (!['revenue','profit','units'].includes(next.sort)) next.sort = 'revenue';
    if (!['asc','desc'].includes(next.direction)) next.direction = 'desc';
    if (!/^[A-Z]{3}$/.test(next.currency)) next.currency = 'EUR';
    shared = next; const state = { ...next };
    instance.abort?.abort(); instance.abort = new AbortController(); const revision = ++instance.revision;
    header(instance, state);
    try {
      const query = new URLSearchParams(Object.entries(state).map(([key,value]) => [key,String(value)]));
      const response = await fetch((window.CRONOX_API?.API_BASE || '') + '/api/admin/finance?' + query, { credentials:'include', headers:{ Accept:'application/json' }, signal:instance.abort.signal, cache:'no-store' });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'No tienes autorización para consultar estos datos.' : 'No se pudieron cargar los datos financieros.');
      const report = await response.json();
      if (revision !== instance.revision) return;
      render(instance, report, state);
    } catch (error) {
      if (error.name === 'AbortError' || revision !== instance.revision) return;
      const content = instance.root.querySelector('.finance-content'); content.setAttribute('aria-busy','false');
      content.innerHTML = `<div class="finance-error" role="alert">${esc(error.message)} <button class="btn" data-retry>Reintentar</button></div>`;
      content.querySelector('button').addEventListener('click', () => load(page));
    }
  }
  window.CRONOX_FINANCE = { load, DatePicker, drawChart };
})();
