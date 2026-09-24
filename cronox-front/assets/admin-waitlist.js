(function () {
  'use strict';
  const root = document.getElementById('section-waitlist');
  if (!root) return;
  const $ = id => root.querySelector(`#${id}`);
  let page = 1, generation = 0;
  const statusLabels = { WAITING: 'En espera', QUEUED: 'En cola', PROCESSING: 'En proceso', ACCEPTED: 'Aceptado por SMTP', FAILED: 'Fallido', UNCERTAIN: 'Entrega incierta', CANCELLED: 'Cancelado' };
  Object.entries(statusLabels).forEach(([value, text]) => $('waitlistStatus').add(new Option(text, value)));
  ['XS','S','M','L','XL','XXL','US_6','US_7','US_8','US_9','US_10','US_11','US_12'].forEach(size => $('waitlistSize').add(new Option(size.replace('US_', 'US '), size)));
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
  async function load() {
    const current = ++generation;
    $('waitlistMessage').textContent = 'Cargando Waitlist…';
    $('waitlistList').setAttribute('aria-busy', 'true');
    $('waitlistPrev').disabled = true; $('waitlistNext').disabled = true;
    const query = new URLSearchParams({ page: String(page) });
    for (const [id, key] of [['waitlistSearch','search'],['waitlistSize','size'],['waitlistStatus','status']]) {
      if ($(id).value.trim()) query.set(key, $(id).value.trim());
    }
    try {
      const response = await fetch(`${window.CRONOX_API?.API_BASE || ''}/api/admin/waitlist?${query}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 401 ? 'No tienes acceso a Waitlist.' : 'No se pudo cargar Waitlist. Pulsa Actualizar para reintentar.');
      const data = await response.json();
      if (current !== generation) return;
      if (page > 1 && !data.rows.length) { page = 1; return load(); }
      $('waitlistList').replaceChildren();
      for (const row of data.rows) {
        const article = document.createElement('article'); article.className = 'waitlist-row';
        const image = document.createElement('img'); image.alt = row.name; image.loading = 'lazy'; image.width = 72; image.height = 90;
        if (row.image && window.CRONOX_IMAGES?.apply) window.CRONOX_IMAGES.apply(image, row.image, 'small');
        else image.src = '/assets/logo_browser.png';
        image.addEventListener('error', () => { image.removeAttribute('srcset'); image.src = '/assets/logo_browser.png'; }, { once: true });
        const content = document.createElement('div');
        content.append(text('h3', `${row.name} · ${row.size.replace('US_', 'US ')}`),
          text('p', `${row.available ? 'Disponible' : 'No disponible'} · Stock libre: ${row.stock}`),
          text('p', `${row.demand} personas con solicitud activa para esta talla. ${row.productPeople} personas distintas en todo el producto (no sumar entre tallas).`),
          text('p', `En espera: ${row.waiting} · En cola: ${row.queued} · En proceso: ${row.processing} · Aceptados por SMTP: ${row.accepted} · Fallidos: ${row.failed} · Inciertos: ${row.uncertain} · Cancelados: ${row.cancelled}`),
          text('p', `Última solicitud: ${new Date(row.latestRequest).toLocaleString('es-ES')}`));
        article.append(image, content); $('waitlistList').append(article);
      }
      $('waitlistMessage').textContent = `${data.rows.length ? 'Ordenado por demanda de mayor a menor.' : 'No hay solicitudes con estos filtros.'} Envíos: ${data.workerEnabled && data.senderReady && data.storeOpen ? 'habilitados' : 'pausados'}. Los aceptados por SMTP no garantizan entrega en la bandeja de entrada.`;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      $('waitlistPage').textContent = `Página ${page} de ${pages} · ${data.total} tallas`;
      $('waitlistPrev').disabled = page <= 1; $('waitlistNext').disabled = page >= pages;
    } catch (error) {
      if (current !== generation) return;
      $('waitlistList').replaceChildren(); $('waitlistPage').textContent = '';
      $('waitlistMessage').textContent = error.message;
    } finally { if (current === generation) $('waitlistList').setAttribute('aria-busy', 'false'); }
  }
  $('waitlistRefresh').addEventListener('click', () => void load());
  $('waitlistFilters').addEventListener('submit', event => { event.preventDefault(); page = 1; void load(); });
  $('waitlistPrev').addEventListener('click', () => { page--; void load(); });
  $('waitlistNext').addEventListener('click', () => { page++; void load(); });
  window.CRONOX_WAITLIST_ADMIN = { load };
  // Counts refresh only while the authorised section is visible.
  setInterval(() => { if (!root.hidden && document.visibilityState === 'visible') void load(); }, 30000);
})();
