(() => {
  'use strict';
  const root = document.getElementById('section-live-stats');
  const navigation = document.querySelector('.sidebar-live');
  if ((!root && !navigation) || window.CRONOX_ADMIN_LIVE_STATS) return;
  window.CRONOX_ADMIN_LIVE_STATS = true;
  const activity = (total = null) => {
    if (!navigation) return;
    navigation.dataset.activity = total === null ? 'unavailable' : total > 0 ? 'active' : 'empty';
    const description = total === null ? 'Estado de actividad no disponible.' : total > 0 ? 'Hay visitantes activos en los últimos 2 minutos.' : 'No hay visitantes activos en los últimos 2 minutos.';
    navigation.querySelector('.live-activity-description').textContent = description;
    navigation.querySelector('button').title = description;
  };
  activity();
  const status = root?.querySelector('[data-live-status]');
  const updated = root?.querySelector('[data-live-updated]');
  const refresh = root?.querySelector('[data-live-refresh]');
  const cards = root?.querySelector('[data-live-cards]');
  const definitions = [
    ['visitors.total', 'Visitantes activos'], ['visitors.signedIn', 'Con sesión'], ['visitors.guests', 'Sin sesión'],
    ['carts.visitors', 'Visitantes activos con cesta'], ['carts.units', 'Unidades en cestas activas'], ['carts.products', 'Productos distintos en cestas activas'],
    ['checkouts', 'Checkouts activos'], ['payments', 'Pagos en proceso'], ['purchases', 'Compras en los últimos 30 minutos'],
  ];
  const numbers = new Map();
  if (cards) definitions.forEach(([key, label]) => {
    const card = document.createElement('article'); card.className = 'card live-stat';
    const heading = document.createElement('h2'); heading.textContent = label;
    const value = document.createElement('strong'); value.textContent = '—';
    card.append(heading, value); cards.append(card); numbers.set(key, value);
  });
  const labels = { home:'Inicio', store:'Tienda', product:'Producto', cart:'Cesta', checkout:'Checkout', other:'Otras páginas públicas' };
  let timer, request = null, last = null, active = false;
  const visible = () => !document.hidden;
  const renderList = (target, entries) => {
    target.replaceChildren();
    entries.forEach(([label, count]) => {
      const row = document.createElement('li'), title = document.createElement('span'), value = document.createElement('strong');
      title.textContent = label; value.textContent = String(count); row.append(title, value); target.append(row);
    });
  };
  async function load() {
    clearTimeout(timer);
    if (!visible() || request) return;
    const controller = new AbortController(); request = controller; if (refresh) refresh.disabled = true;
    if (status) status.textContent = last ? 'Actualizando…' : 'Cargando estadísticas…';
    if (root) root.dataset.state = last ? 'refreshing' : 'loading';
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${window.CRONOX_API?.API_BASE || ''}/api/admin/live-stats`, { credentials:'include', cache:'no-store', signal:controller.signal });
      if (!response.ok) throw new Error('Live stats unavailable');
      const data = await response.json();
      // Validate before replacing any last-known values.
      const values = definitions.map(([key]) => key.split('.').reduce((v,k) => v?.[k], data));
      if (values.some(v => !Number.isSafeInteger(v) || v < 0) || !Array.isArray(data.locations) || !Array.isArray(data.products) || !Number.isFinite(Date.parse(data.at)) ||
        data.locations.some(x=>!labels[x.section] || !Number.isSafeInteger(x.visitors) || x.visitors<0) ||
        data.products.some(x=>typeof x.name!=='string' || !Number.isSafeInteger(x.visitors) || x.visitors<0)) throw new Error('Invalid snapshot');
      if (!visible() || request !== controller) return;
      last = data;
      activity(data.visitors.total);
      if (root) {
      definitions.forEach(([key], i) => { numbers.get(key).textContent = values[i].toLocaleString('es-ES'); });
      renderList(root?.querySelector('[data-live-locations]'), Object.entries(labels).map(([key,label]) => [label,data.locations.find(x=>x.section===key)?.visitors || 0]));
      renderList(root?.querySelector('[data-live-products]'), data.products.length ? data.products.map(p=>[p.name,p.visitors]) : [['Sin visitas activas a productos',0]]);
      updated.textContent = `Última actualización correcta: ${new Date(data.at).toLocaleTimeString('es-ES')}`;
      root.dataset.state = values.every(v=>v===0) ? 'empty' : 'ready';
      status.textContent = root.dataset.state === 'empty' ? 'Conectado · Sin actividad' : 'Conectado';
      }
    } catch {
      if (visible() && request === controller) {
        activity();
        if (root) root.dataset.state = 'error'; if (status) status.textContent = last ? 'Sin conexión · Datos desactualizados. Puedes reintentar.' : 'No se pudieron cargar las estadísticas. Puedes reintentar.';
      }
    } finally {
      clearTimeout(timeout);
      if (request === controller) {
        request = null; if (refresh) refresh.disabled = false;
        if (visible()) timer = setTimeout(load,15000);
      }
    }
  }
  const sync = () => {
    const next = visible();
    if (next === active) return;
    active = next; clearTimeout(timer);
    if (next) void load(); else { request?.abort(); request = null; }
  };
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('pagehide',()=>{ clearTimeout(timer); request?.abort(); request=null; active=false; });
  window.addEventListener('pageshow',sync);
  refresh?.addEventListener('click',()=>void load());
  sync();
})();
