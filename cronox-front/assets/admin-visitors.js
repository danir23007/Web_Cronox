(() => {
  'use strict';
  const root = document.getElementById('dashboardVisitors');
  if (!root) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Madrid', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const shift = (value, days) => new Date(Date.parse(value + 'T12:00:00Z') + days * 86400000).toISOString().slice(0,10);
  const label = value => new Date(value + 'T12:00:00Z').toLocaleDateString('es-ES', { timeZone:'UTC', day:'2-digit', month:'short' });
  const timestamp = value => new Date(value).toLocaleString('es-ES', { timeZone:'Europe/Madrid' });
  let state = { from:shift(today(),-29), to:today(), day:null, category:'all', search:'', page:1 }, abort, detailAbort, sequence = 0, searchTimer;
  async function get(path, signal) {
    const response = await fetch((window.CRONOX_API?.API_BASE || '') + '/api/admin/visitors' + path, { credentials:'include', cache:'no-store', headers:{ Accept:'application/json' }, signal });
    if (!response.ok) throw new Error([401,403].includes(response.status) ? 'No tienes autorización para consultar visitantes.' : 'No se pudieron cargar las visitas. Comprueba las fechas y reintenta.');
    return response.json();
  }
  function update(patch) { Object.assign(state,patch); void load(); }
  async function load() {
    abort?.abort(); detailAbort?.abort(); abort = new AbortController(); const version = ++sequence;
    root.innerHTML = `<div class="finance-card"><h2>Visitantes diarios</h2><p>Visitantes únicos por categoría · Europe/Madrid</p><form class="visitor-controls"><label>Desde<input name="from" type="date" value="${esc(state.from)}" min="2000-01-01" max="${today()}" required></label><label>Hasta<input name="to" type="date" value="${esc(state.to)}" min="2000-01-01" max="${today()}" required></label><button class="btn" type="submit">Aplicar</button><button class="btn" type="button" data-previous>Periodo anterior</button><button class="btn" type="button" data-today>Últimos 30 días</button></form><p class="finance-notice">Si una visita anónima se vincula a una cuenta durante el mismo día, se cuenta únicamente con sesión. Las visitas identificadas de administradores se excluyen.</p><p class="finance-notice">Solo visitas con consentimiento analítico. Cada cuenta cuenta una vez al día entre dispositivos. Dos cuentas legítimas en un navegador compartido cuentan como dos cuentas. Un navegador anónimo diferente, borrar la identificación o retirar el consentimiento impide relacionar visitas. Consulta intervalos de hasta 366 días.</p><div class="visitor-content" aria-live="polite" aria-busy="true">Cargando visitas…</div><div class="visitor-detail" hidden></div></div>`;
    root.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget;
      update({ from:form.elements.from.value, to:form.elements.to.value, day:null, page:1 });
    });
    root.querySelector('[data-previous]').onclick = () => { const days = Math.round((Date.parse(state.to)-Date.parse(state.from))/86400000)+1; update({ from:shift(state.from,-days), to:shift(state.to,-days), day:null }); };
    root.querySelector('[data-today]').onclick = () => update({ from:shift(today(),-29), to:today(), day:null });
    const content = root.querySelector('.visitor-content');
    try {
      const data = await get('?' + new URLSearchParams({ from:state.from, to:state.to }), abort.signal);
      if (version !== sequence) return;
      const maximum = Math.max(1,...data.buckets.flatMap(bucket => [bucket.authenticated || 0, bucket.anonymous || 0]));
      content.innerHTML = `<p class="finance-notice">Registro iniciado: ${esc(timestamp(data.startedAt))}. ${data.deduplicationStartedAt ? `Nueva regla preparada: ${esc(timestamp(data.deduplicationStartedAt))}. El historial anterior y el día de transición pueden incluir duplicados y roles desconocidos. ` : ''}El primer día puede estar incompleto. Días anteriores: Sin datos.</p><div class="visitor-legend"><span>Con sesión iniciada</span><span>Sin sesión iniciada</span></div><p>Selecciona un día para ver su detalle.</p><div class="visitor-chart-scroll"><div class="visitor-chart" role="group" aria-label="Gráfica de visitantes diarios">${data.buckets.map(bucket => {
        const available = bucket.authenticated !== null;
        const description = available ? `${bucket.day}: ${bucket.authenticated} con sesión, ${bucket.anonymous} sin sesión` : `${bucket.day}: Sin datos`;
        return `<button type="button" class="visitor-day" data-day="${bucket.day}" aria-label="${esc(description)}" title="${esc(description)}">${available ? `<span class="visitor-bars"><span class="visitor-bar" style="height:${Math.max(2,160*bucket.authenticated/maximum)}px"></span><span class="visitor-bar anonymous" style="height:${Math.max(2,160*bucket.anonymous/maximum)}px"></span></span>` : '<span class="visitor-no-data">Sin datos</span>'}<small>${esc(label(bucket.day))}</small></button>`;
      }).join('')}</div></div><div class="visitor-chart-caption" role="status">Pasa el cursor, enfoca o pulsa una barra para consultar las cifras.</div>`;
      root.querySelectorAll('[data-day]').forEach(button => {
        const show = () => { root.querySelector('.visitor-chart-caption').textContent = button.getAttribute('aria-label'); };
        button.addEventListener('mouseenter',show); button.addEventListener('focus',show);
        button.onclick = () => { show(); Object.assign(state,{ day:button.dataset.day, page:1 }); void detail(); };
      });
      const scroll = root.querySelector('.visitor-chart-scroll');
      scroll.scrollLeft = scroll.scrollWidth; // Recent days stay visible on narrow screens.
      if (state.day) void detail();
    } catch (error) {
      if (error.name === 'AbortError' || version !== sequence) return;
      content.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="btn">Reintentar</button>`;
      content.querySelector('button').onclick = () => void load();
    } finally { if (version === sequence) content.setAttribute('aria-busy','false'); }
  }
  async function detail() {
    const focusedSearch = document.activeElement?.matches('#dashboardVisitors [data-search]');
    const selection = focusedSearch ? document.activeElement.selectionStart : null;
    detailAbort?.abort(); detailAbort = new AbortController(); const signal = detailAbort.signal;
    const host = root.querySelector('.visitor-detail'); if (!host) return;
    host.hidden = false; host.setAttribute('aria-busy','true');
    host.innerHTML = `<h3 tabindex="-1">Visitas del ${esc(state.day)}</h3><div class="visitor-controls"><label>Categoría<select data-category><option value="all">Todas</option><option value="authenticated">Con sesión</option><option value="anonymous">Sin sesión</option></select></label><label>Buscar ID, nombre o correo<input type="search" data-search value="${esc(state.search)}" maxlength="120"></label><button class="btn" type="button" data-close>Cerrar detalle</button></div><div class="visitor-results" aria-live="polite">Cargando detalle…</div>`;
    host.querySelector('select').value = state.category;
    host.querySelector('select').onchange = event => { state.category = event.target.value; state.page = 1; void detail(); };
    host.querySelector('[data-search]').oninput = event => { clearTimeout(searchTimer); state.search = event.target.value; searchTimer = setTimeout(() => { state.page = 1; void detail(); },400); };
    if (focusedSearch) { const input = host.querySelector('[data-search]'); input.focus(); input.setSelectionRange(selection,selection); }
    host.querySelector('[data-close]').onclick = () => { detailAbort.abort(); const day = state.day; state.day = null; host.hidden = true; root.querySelector(`[data-day="${day}"]`)?.focus(); };
    const results = host.querySelector('.visitor-results');
    try {
      const data = await get('/day?' + new URLSearchParams({ day:state.day, category:state.category, search:state.search, page:state.page }),signal);
      if (signal.aborted) return;
      state.page = data.pagination.page;
      results.innerHTML = `<p>${data.available ? `${data.totals.authenticated} con sesión · ${data.totals.anonymous} sin sesión` : 'Sin datos: el registro todavía no estaba activo.'}</p><div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>Visitante</th><th>Categoría</th><th>Primera visita</th><th>Última visita</th></tr></thead><tbody>${data.visitors.length ? data.visitors.map(visitor => `<tr><td>${visitor.userId ? `<strong>#${visitor.userId} ${esc(visitor.name || '')}</strong><br>${esc(visitor.email || '')}` : `<span class="visitor-id">${esc(visitor.id)}</span>${visitor.category === 'authenticated' ? '<br>Cuenta eliminada · referencia anonimizada' : ''}`}</td><td>${visitor.category === 'authenticated' ? 'Con sesión' : 'Sin sesión'}</td><td>${esc(timestamp(visitor.firstAt))}</td><td>${esc(timestamp(visitor.lastAt))}</td></tr>`).join('') : '<tr><td colspan="4">No hay visitas para estos filtros.</td></tr>'}</tbody></table></div><div class="pagination"><span>${data.pagination.total} registros · Página ${data.pagination.page} de ${data.pagination.pages}</span><div class="page-controls"><button class="btn" data-page="${data.pagination.page-1}" ${data.pagination.page === 1 ? 'disabled' : ''}>Anterior</button><button class="btn" data-page="${data.pagination.page+1}" ${data.pagination.page === data.pagination.pages ? 'disabled' : ''}>Siguiente</button></div></div>`;
      results.querySelectorAll('[data-page]').forEach(button => { button.onclick = () => { state.page = Number(button.dataset.page); void detail(); }; });
    } catch (error) {
      if (error.name === 'AbortError') return;
      results.innerHTML = `<p role="alert">${esc(error.message)}</p><button class="btn" type="button">Reintentar</button>`;
      results.querySelector('button').onclick = () => void detail();
    } finally { if (!signal.aborted) host.setAttribute('aria-busy','false'); }
  }
  window.CRONOX_VISITORS = { load };
})();
