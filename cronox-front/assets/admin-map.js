(() => {
  'use strict';
  const root = document.getElementById('adminMap');
  if (!root) return;
  const assetBase = document.currentScript?.src || new URL('assets/admin-map.js', location.href);
  const assets = new Map();
  let graphicDivision = '', cartographyVersion = 0;
  const territories = () => state.division === 'provinces' ? data.provinces : data.regions;
  const territoryLabel = () => state.division === 'provinces' ? 'provincia' : 'comunidad';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number = v => v === null ? 'No disponible' : new Intl.NumberFormat('es-ES').format(v);
  const money = v => v === null ? 'No disponible' : new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR' }).format(v / 100);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const metricNames = { orders:'Pedidos', units:'Unidades vendidas netas', revenueCents:'Facturación' };
  let state = { from:today().slice(0,7) + '-01', to:today(), metric:'orders', division:'communities', preset:'month', region:'', page:1 };
  let data, abort, version = 0, svgPromise, svgReady = false, sort = 'orders', direction = -1;
  let salesState = 'loading', exploredRegion = '';
  const regionNames = new Map();
  let zoom = 1;
  const $ = selector => root.querySelector(selector);
  const valueLabel = v => state.metric === 'revenueCents' ? money(v) : number(v);
  const percent = r => {
    const denominator = data?.identified[state.metric];
    return denominator === null || r[state.metric] === null ? 'No disponible' : denominator === 0 ? '0 %' : new Intl.NumberFormat('es-ES', { style:'percent', maximumFractionDigits:1 }).format(r[state.metric] / denominator);
  };
  root.innerHTML = `<header><span class="map-eyebrow">DISTRIBUCIÓN DE VENTAS</span><h1 id="title-map">Mapa</h1><p>El destino de los pedidos pagados, por comunidades autónomas o provincias.</p></header>
    <form class="map-filters"><label>Período<select name="preset"><option value="today">Hoy</option><option value="month" selected>Este mes</option><option value="year">Este año</option><option value="all">Todo el histórico</option><option value="custom">Intervalo personalizado</option></select></label>
    <label>Desde<input name="from" type="date" min="2000-01-01" max="2100-12-31" required></label><label>Hasta<input name="to" type="date" min="2000-01-01" max="2100-12-31" required></label>
    <label>División territorial<select name="division"><option value="communities">Comunidades autónomas</option><option value="provinces">Provincias</option></select></label><label>Métrica<select name="metric"><option value="orders">Pedidos</option><option value="units">Unidades vendidas</option><option value="revenueCents">Facturación</option></select></label><button type="submit">Aplicar fechas</button></form>
    <div class="map-status" role="status" aria-live="polite"></div><button type="button" data-retry hidden>Reintentar</button>
    <div class="map-panel map-cartography"><h2>España por comunidades autónomas</h2><div class="map-layout"><div><div class="map-cartography-status" role="status">Cargando cartografía…</div><button type="button" data-map-retry hidden>Reintentar cartografía</button><div class="map-zoom" aria-label="Ampliación del mapa"><button type="button" data-zoom="1" aria-label="Ampliar mapa">+</button><button type="button" data-zoom="-1" aria-label="Reducir mapa" disabled>−</button><button type="button" data-zoom="0">Restablecer mapa</button></div><div class="map-viewport" tabindex="0" aria-label="Mapa desplazable al ampliar"><div class="map-graphic"></div></div><div class="map-legend" aria-label="Escala de valores"></div></div><aside><h2>Explora una comunidad</h2><p class="map-note">Pasa el cursor, enfoca con el teclado o toca una región. Pulsa para ver sus provincias y pedidos.</p><div class="map-tooltip" role="status" aria-live="polite">Selecciona una comunidad.</div></aside></div>
    <p class="map-note map-projection-note"></p><p class="map-note">Cartografía: IGN (comunidades) · INE (provincias) / <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries</a> · <a href="assets/maps/README.md" target="_blank" rel="noopener">Licencias y procedencia</a>.</p></div>
    <div class="map-results" hidden><div class="map-cards"></div><div class="map-panel map-detail" hidden></div>
    <div class="map-panel map-table-panel"><h2>Comunidades y ciudades autónomas</h2><div class="map-scroll"><table class="map-regions-table"><caption>España identificada · tabla equivalente al mapa</caption><thead><tr>${[['name','Comunidad'],['orders','Pedidos'],['units','Unidades netas'],['revenueCents','Facturación'],['percent','Porcentaje']].map(([key,label]) => `<th scope="col" data-column="${key}"><button type="button" data-sort="${key}">${label}</button></th>`).join('')}</tr></thead><tbody></tbody></table></div></div>
    <div class="map-panel map-exceptions"><h2>Otros destinos y provincias sin identificar</h2><p class="map-note">Los destinos desconocidos y extranjeros están excluidos del denominador. Las comunidades identificadas sin provincia conservan sus ventas en España identificada y se desglosan aquí en modo Provincias.</p><div class="map-exceptions-list"></div></div>
    <div class="map-panel map-table-panel"><h2>Criterios y conciliación</h2><p class="map-basis map-note"></p><p class="map-reconciliation map-note"></p><p class="map-exclusions map-note"></p><ul class="map-warnings map-note"></ul></div></div>`;

  function syncInputs() {
    for (const key of ['from','to','metric','preset','division']) $(`[name="${key}"]`).value = state[key];
  }
  function saveHash() {
    if (location.hash.startsWith('#section-map')) history.replaceState(null, '', '#section-map?' + new URLSearchParams(state));
  }
  function color(value, max) {
    if (value === null) return 'url(#map-unknown)';
    if (value <= 0) return '#44444d';
    const t = max ? value / max : 1;
    return `rgb(${Math.round(104 + 135 * t)},${Math.round(27 + 34 * t)},${Math.round(49 + 32 * t)})`;
  }
  async function ensureSvg(division) {
    if (svgReady && graphicDivision === division) return;
    const assetUrl = new URL('maps/spain-' + (division === 'provinces' ? 'provinces' : 'communities') + '.svg?v=3', assetBase).href;
    if (!assets.has(division)) assets.set(division, fetch(assetUrl).then(r => { if (!r.ok) throw Error('No se pudo cargar la cartografía.'); return r.text(); }).catch(e => { assets.delete(division); throw e; }));
    const svg = await assets.get(division);
    if (division !== state.division || (svgReady && graphicDivision === division)) return;
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const graphic = parsed.documentElement;
    const regions = [...graphic.querySelectorAll('[data-region]')];
    const count = division === 'provinces' ? 52 : 19;
    const ids = new Set(regions.map(node => node.getAttribute('data-region')));
    const viewBox = (graphic.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (graphic.localName !== 'svg' || parsed.querySelector('parsererror') || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0 || regions.length !== count || ids.size !== count || Array.from({length:count}, (_,i) => String(i+1).padStart(2,'0')).some(id => !ids.has(id))) {
      assets.delete(division);
      throw Error('La cartografía local no contiene las ' + count + ' unidades territoriales.');
    }
    $('.map-graphic').replaceChildren(document.importNode(graphic, true));
    $('.map-graphic svg').insertAdjacentHTML('afterbegin', '<defs><pattern id="map-unknown" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#35353d"/><path d="M0 0L6 6" stroke="#babac5" stroke-width="2"/></pattern></defs>');
    regionNames.clear();
    root.querySelectorAll('.map-graphic [data-region]').forEach(node => {
      const id = node.dataset.region;
      regionNames.set(id, node.getAttribute('aria-label'));
      node.addEventListener('pointerenter', () => showTooltip(id));
      node.addEventListener('focus', () => showTooltip(id));
      node.addEventListener('click', () => select(id));
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(id); } });
    });
    svgReady = true; graphicDivision = division;
    $('.map-graphic').inert = false;
  }
  async function loadCartography() {
    const division = state.division, current = ++cartographyVersion;
    $('.map-graphic').inert = graphicDivision !== division;
    if (!svgReady || graphicDivision !== division) $('.map-cartography-status').textContent = 'Cargando cartografía…';
    $('[data-map-retry]').hidden = true;
    try {
      await ensureSvg(division);
      if (current !== cartographyVersion || division !== state.division) return;
      $('.map-cartography-status').textContent = '';
      if (data) paintMap(); else paintUnavailable();
    } catch (error) {
      if (current !== cartographyVersion || division !== state.division) return;
      $('.map-cartography-status').textContent = error.message;
      $('[data-map-retry]').hidden = false;
    }
  }
  function syncDivision() {
    const provinces = state.division === 'provinces';
    $('.map-cartography > h2').textContent = provinces ? 'España por provincias' : 'España por comunidades autónomas';
    $('.map-layout aside h2').textContent = 'Explora una ' + territoryLabel();
    $('.map-layout aside .map-note').textContent = 'Pasa el cursor, enfoca con el teclado o toca un territorio. Pulsa para ver sus pedidos. También puedes seleccionarlo en la tabla.';
    $('.map-regions-table').closest('.map-table-panel').querySelector('h2').textContent = provinces ? 'Provincias y ciudades autónomas' : 'Comunidades y ciudades autónomas';
    $('[data-sort="name"]').textContent = provinces ? 'Provincia · Comunidad' : 'Comunidad';
    $('.map-projection-note').textContent = 'Porcentajes sobre el total de España con ubicación identificada en la métrica activa. Canarias, Ceuta y Melilla se muestran en recuadros; Ceuta y Melilla están ampliadas.' + (provinces ? ' Las islas de cada provincia comparten color, datos y selección.' : ' En Melilla, la ciudad ocupa la parte superior y los islotes de la fuente se muestran debajo, a otra escala.');
  }
  function paintUnavailable() {
    root.querySelectorAll('.map-graphic [data-region]').forEach(node => {
      node.style.fill = 'url(#map-unknown)';
      node.setAttribute('aria-pressed', String(node.dataset.region === state.region));
      node.setAttribute('aria-label', `${regionNames.get(node.dataset.region)}. ${salesState === 'loading' ? 'Cargando ventas.' : 'Ventas no disponibles.'}`);
    });
    $('.map-legend').innerHTML = `<span><i class="map-unknown-swatch"></i>${salesState === 'loading' ? 'Cargando ventas…' : 'Ventas no disponibles'}</span>`;
    if (exploredRegion || state.region) showTooltip(exploredRegion || state.region);
    else $('.map-tooltip').textContent = salesState === 'loading' ? 'Cargando ventas. Puedes explorar las comunidades.' : 'Ventas no disponibles. Puedes explorar las comunidades y reintentar la consulta.';
  }
  function showTooltip(id) {
    exploredRegion = id;
    const r = data && territories().find(r => r.id === id);
    if (!r) {
      const name = regionNames.get(id);
      if (name) $('.map-tooltip').innerHTML = `<strong>${esc(name)}</strong><p>${salesState === 'loading' ? 'Cargando ventas…' : 'Ventas no disponibles. Reintenta la consulta para ver los pedidos, unidades e importes.'}</p>`;
      return;
    }
    $('.map-tooltip').innerHTML = `<strong>${esc(r.name)}</strong>${r.regionName ? `<p>${esc(r.regionName)}</p>` : ''}<dl><dt>Pedidos</dt><dd>${number(r.orders)}</dd><dt>Unidades netas</dt><dd>${number(r.units)}</dd><dt>Facturación</dt><dd>${money(r.revenueCents)}</dd><dt>${esc(metricNames[state.metric])}</dt><dd>${percent(r)}</dd></dl>`;
  }
  function select(id) {
    state.region = id; state.page = 1; showTooltip(id); saveHash(); request();
  }
  function renderTable() {
    const key = sort === 'percent' ? state.metric : sort;
    const rows = [...territories()].sort((a,b) => {
      if (a[key] === null || b[key] === null) return a[key] === b[key] ? a.id.localeCompare(b.id) : a[key] === null ? 1 : -1;
      return direction * (key === 'name' ? a.name.localeCompare(b.name, 'es') : a[key] - b[key]) || a.name.localeCompare(b.name,'es');
    });
    root.querySelectorAll('[data-column]').forEach(th => th.setAttribute('aria-sort', th.dataset.column === sort ? direction === 1 ? 'ascending' : 'descending' : 'none'));
    $('.map-regions-table tbody').innerHTML = rows.map(r => `<tr><td><button type="button" data-select="${r.id}" aria-pressed="${state.region === r.id}">${esc(r.name)}</button>${r.regionName ? `<small class="map-region-name">${esc(r.regionName)}</small>` : ''}</td><td>${number(r.orders)}</td><td>${number(r.units)}</td><td>${money(r.revenueCents)}</td><td>${percent(r)}</td></tr>`).join('');
  }
  function renderDetail() {
    const r = [...territories(),...data.groups,...(data.communityOnly || [])].find(r => r.id === state.region), panel = $('.map-detail');
    panel.hidden = !r;
    if (!r) { panel.replaceChildren(); return; }
    panel.innerHTML = `<h2>${esc(r.name)}</h2>${r.regionName ? `<p>${esc(r.regionName)}</p>` : ''}${r.unassignedProvince?.orders ? `<p>Provincia sin identificar: ${number(r.unassignedProvince.orders)} pedidos · ${number(r.unassignedProvince.units)} unidades · ${money(r.unassignedProvince.revenueCents)}</p>` : ''}${r.provinces ? `<div class="map-scroll"><table><caption>Desglose por provincias</caption><thead><tr><th scope="col">Provincia</th><th scope="col">Pedidos</th><th scope="col">Unidades netas</th><th scope="col">Facturación</th></tr></thead><tbody>${r.provinces.map(p => `<tr><td>${esc(p.name)}</td><td>${number(p.orders)}</td><td>${number(p.units)}</td><td>${money(p.revenueCents)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="map-scroll"><table><caption>Pedidos de este destino · ordenados por número</caption><thead><tr><th scope="col">Pedido</th><th scope="col">Fecha de pago</th><th scope="col">Provincia</th><th scope="col">Unidades netas</th><th scope="col">Facturación</th></tr></thead><tbody>${data.orders.map(o => `<tr><td>${o.available ? `<button type="button" data-order="${o.id}" aria-label="Abrir detalle del pedido ${o.id}">#${o.id} ↗</button>` : `#${o.id} (archivado)`}</td><td>${esc(new Date(o.paidAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid', dateStyle:'short', timeStyle:'short'}))}</td><td>${esc(o.province || 'Sin identificar')}</td><td>${number(o.units)}</td><td>${money(o.revenueCents)}</td></tr>`).join('') || '<tr><td colspan="5">No hay pedidos pagados en este destino y período.</td></tr>'}</tbody></table></div>
      <div class="map-pagination"><button type="button" data-page="-1" ${state.page <= 1 ? 'disabled' : ''}>Anterior</button><span>Página ${data.pagination.page} de ${data.pagination.pages} · ${number(data.pagination.total)} pedidos</span><button type="button" data-page="1" ${state.page >= data.pagination.pages ? 'disabled' : ''}>Siguiente</button></div>`;
  }
  function paintMap() {
    const values = territories().map(r => r[state.metric]);
    const max = Math.max(0, ...values.filter(v => v !== null));
    const unknown = values.some(v => v === null);
    root.querySelectorAll('.map-graphic [data-region]').forEach(node => {
      if (graphicDivision !== state.division) return;
      const r = territories().find(r => r.id === node.dataset.region);
      if (!r) return;
      node.style.fill = color(r[state.metric],max);
      node.setAttribute('aria-pressed', String(r.id === state.region));
      node.setAttribute('aria-label', `${r.name}${r.regionName ? ` · ${r.regionName}` : ''}: ${number(r.orders)} pedidos, ${number(r.units)} unidades netas, ${money(r.revenueCents)}, ${percent(r)} de ${metricNames[state.metric]}. Ver pedidos.`);
    });
    const positive = values.filter(v => v > 0), min = Math.min(...positive);
    $('.map-legend').innerHTML = `<span><i style="background:#44444d"></i>0</span>` + (max ? (min === max ? [max] : [...new Set([min,Math.round((min + max) / 2),max])]).map(v => `<span><i style="background:${color(v,max)}"></i>${esc(valueLabel(v))}</span>`).join('') : '') + (unknown ? '<span><i style="background:repeating-linear-gradient(45deg,#35353d 0 3px,#babac5 3px 5px)"></i>No disponible</span>' : '') + `<span>${esc(metricNames[state.metric])}</span>`;
    if (exploredRegion || state.region) showTooltip(exploredRegion || state.region);
    else $('.map-tooltip').textContent = 'Selecciona una ' + territoryLabel() + '.';
  }
  function render() {
    paintMap();
    const values = territories().map(r => r[state.metric]);
    const max = Math.max(0, ...values.filter(v => v !== null));
    const unknown = values.some(v => v === null);
    const leaders = max > 0 ? territories().filter(r => r[state.metric] === max) : [];
    const top = unknown ? 'No disponible: importes incompletos' : leaders.length > 3 ? `Empate entre ${leaders.length} ${state.division === 'provinces' ? 'provincias' : 'comunidades'}` : leaders.length ? leaders.map(r => r.name).join(' · ') + (leaders.length > 1 ? ' (empate)' : '') : 'Sin ventas en esta métrica';
    $('.map-cards').innerHTML = [['Pedidos · España identificada',number(data.identified.orders)],['Unidades netas · España identificada',number(data.identified.units)],['Facturación · España identificada',money(data.identified.revenueCents)],[`${state.division === 'provinces' ? 'Provincia' : 'Comunidad'} con mayor ${metricNames[state.metric].toLowerCase()}`,esc(top)]].map(([label,v]) => `<div class="map-card"><span>${label}</span><strong>${v}</strong></div>`).join('');
    renderTable(); renderDetail();
    $('.map-exceptions-list').innerHTML = [...data.groups,...(state.division === 'provinces' ? (data.communityOnly || []).filter(r => r.orders > 0) : [])].map(r => `<button type="button" data-select="${r.id}"><strong>${esc(r.name)}</strong><span>${number(r.orders)} pedidos · ${number(r.units)} unidades netas</span><span>${money(r.revenueCents)}</span><span>Ver pedidos →</span></button>`).join('');
    $('.map-basis').textContent = data.basis;
    $('.map-reconciliation').textContent = `Total de todos los destinos: ${number(data.total.orders)} pedidos · ${number(data.total.units)} unidades netas · ${money(data.total.revenueCents)}. Unidades brutas: ${number(data.reconciliation.grossUnits)}; devueltas con evidencia: ${number(data.reconciliation.returnedUnits)}. Finanzas del mismo período (incluye ajustes de otros pedidos y ventas antiguas sin fecha de cobro): ${money(data.reconciliation.financePeriod.revenueCents)}; diferencia de alcance: ${money(data.reconciliation.revenueDifferenceCents)}. Fechas en Europe/Madrid.`;
    $('.map-exclusions').textContent = `Excluidos del conjunto: ${number(data.exclusions.refunded)} pedidos totalmente reembolsados y ${number(data.exclusions.undated)} sin fecha de cobro acreditada. Los pedidos antiguos sin fecha no se atribuyen a su fecha de creación.`;
    $('.map-warnings').innerHTML = data.warnings.map(w => `<li>${esc(w)}</li>`).join('');
  }
  async function request() {
    abort?.abort(); abort = new AbortController(); const current = ++version;
    const previousFocus = document.activeElement;
    const focusKey = previousFocus?.dataset?.select ? ['select',previousFocus.dataset.select] : previousFocus?.dataset?.page ? ['page',previousFocus.dataset.page] : null;
    $('.map-status').textContent = 'Cargando ventas…'; $('[data-retry]').hidden = true;
    data = null; salesState = 'loading'; syncDivision(); $('.map-detail').replaceChildren(); $('.map-detail').hidden = true;
    $('.map-results').setAttribute('aria-busy','true');
    // Sales and geographic resources have independent lifecycles. Never hide the
    // map, or present an unavailable response as zero sales or stale figures.
    $('.map-results').hidden = true;
    paintUnavailable(); loadCartography();
    try {
      const query = new URLSearchParams({ from:state.from, to:state.to, page:String(state.page), division:state.division });
      if (state.region) query.set('region',state.region);
      const response = await fetch((window.CRONOX_API?.API_BASE || '') + '/api/admin/map?' + query, {credentials:'include', headers:{Accept:'application/json'}, cache:'no-store', signal:abort.signal});
      if (!response.ok) throw Error(response.status === 403 || response.status === 401 ? 'No tienes permisos para consultar Finanzas y Mapa.' : 'No se pudieron cargar las ventas. Revisa las fechas y vuelve a intentarlo.');
      const next = await response.json();
      if (current !== version) return;
      data = next; salesState = 'ready'; render(); $('.map-results').hidden = false;
      if (focusKey && (!document.activeElement || document.activeElement === document.body || document.activeElement === previousFocus)) $(`[data-${focusKey[0]}="${focusKey[1]}"]`)?.focus({preventScroll:true});
      $('.map-status').textContent = data.total.orders ? '' : 'No hay pedidos pagados en este período';
    } catch (error) {
      if (current !== version || error.name === 'AbortError') return;
      data = null; salesState = 'error'; paintUnavailable(); $('.map-results').hidden = true; $('.map-status').textContent = error.message; $('[data-retry]').hidden = false;
    } finally { if (current === version) $('.map-results').setAttribute('aria-busy','false'); }
  }
  function applyDates() {
    const from = $('[name="from"]').value, to = $('[name="to"]').value;
    if (!from || !to || from > to || from < '2000-01-01' || to > '2100-12-31') { $('.map-status').textContent = 'Selecciona un intervalo válido (2000–2100).'; return; }
    state = { ...state, from, to, page:1 }; saveHash(); request();
  }
  $('.map-filters').addEventListener('submit', e => { e.preventDefault(); applyDates(); });
  $('[name="preset"]').addEventListener('change', e => {
    state.preset = e.target.value;
    if (state.preset === 'custom') { $('[name="from"]').focus(); return; }
    state.to = today(); state.from = { today:state.to, month:state.to.slice(0,7) + '-01', year:state.to.slice(0,4) + '-01-01', all:'2000-01-01' }[state.preset];
    state.page = 1; syncInputs(); saveHash(); request();
  });
  for (const key of ['from','to']) $(`[name="${key}"]`).addEventListener('change', () => { state.preset = 'custom'; $('[name="preset"]').value = 'custom'; });
  $('[name="division"]').addEventListener('change', e => { state.division = e.target.value; state.region = ''; state.page = 1; exploredRegion = ''; saveHash(); request(); });
  $('[name="metric"]').addEventListener('change', e => { state.metric = e.target.value; saveHash(); if (data) render(); });
  $('[data-retry]').addEventListener('click', request);
  $('[data-map-retry]').addEventListener('click', loadCartography);
  root.addEventListener('click', e => {
    const target = e.target.closest('button'); if (!target) return;
    if (target.dataset.select) select(target.dataset.select);
    if (target.dataset.zoom !== undefined) {
      zoom = Number(target.dataset.zoom) === 0 ? 1 : Math.max(1, Math.min(4, zoom + Number(target.dataset.zoom) * .5));
      $('.map-graphic').style.width = zoom * 100 + '%';
      $('[data-zoom="1"]').disabled = zoom === 4;
      $('[data-zoom="-1"]').disabled = zoom === 1;
      if (zoom === 1) $('.map-viewport').scrollTo?.(0,0);
    }
    if (target.dataset.sort) { direction = sort === target.dataset.sort ? -direction : -1; sort = target.dataset.sort; renderTable(); }
    if (target.dataset.page) { state.page += Number(target.dataset.page); saveHash(); request(); }
    if (target.dataset.order) window.CRONOX_ADMIN_ORDERS?.open(Number(target.dataset.order));
  });
  window.CRONOX_MAP = { load() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    for (const key of ['from','to']) if (/^\d{4}-\d{2}-\d{2}$/.test(params.get(key) || '')) state[key] = params.get(key);
    if (metricNames[params.get('metric')]) state.metric = params.get('metric');
    if (['today','month','year','all','custom'].includes(params.get('preset'))) state.preset = params.get('preset');
    const division = params.get('division') === 'provinces' ? 'provinces' : 'communities';
    if (state.division !== division) exploredRegion = '';
    state.division = division;
    const id = params.get('region') || '';
    state.region = /^(unknownSpain|foreign|unresolved|communityOnly:(0[1-9]|1[0-9]))$/.test(id) || /^\d{2}$/.test(id) && Number(id) >= 1 && Number(id) <= (division === 'provinces' ? 52 : 19) ? id : '';
    state.page = Math.max(1, Math.min(1000000, Math.floor(Number(params.get('page')) || 1)));
    syncInputs(); request();
  }};
  syncInputs();
})();
