(function () {
  'use strict';
  const form = document.getElementById('bfAdminForm');
  if (!form) return;
  const status = document.getElementById('bfAdminStatus'), message = document.getElementById('bfAdminMessage');
  const frame = document.getElementById('bfPreview'), viewport = document.getElementById('bfPreviewViewport');
  const time = window.CRONOX_MADRID_TIME;
  let settings, loaded = false, busy = false, previewOpen = false, serverEpoch = 0, monotonicEpoch = 0;
  const fields = ['enabled', 'title', 'bannerText', 'startsAt', 'endsAt', 'eventText', 'textColor', 'backgroundColor'];
  const input = name => form.elements.namedItem(name);
  const inform = (text, error = false) => { message.textContent = text; message.style.color = error ? '#b42318' : ''; };
  const now = () => serverEpoch + performance.now() - monotonicEpoch;
  async function request(method = 'GET', body) {
    const headers = { Accept: 'application/json' };
    if (body) Object.assign(headers, { 'Content-Type': 'application/json' }, await window.CRONOX_API.getCsrfHeaders());
    const base = String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
    const response = await fetch(`${base}/api/admin/black-friday`, { method, headers, credentials: 'include', cache: 'no-store', body: body ? JSON.stringify(body) : undefined });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message || `No se pudo ${body ? 'guardar' : 'cargar'} la campaña (${response.status}).`);
    return data;
  }
  function renderStatus() {
    if (!settings) return;
    status.textContent = !settings.enabled ? 'Desactivada' : now() >= Date.parse(settings.endsAt) ? 'Finalizada · ajustes conservados' : now() >= Date.parse(settings.startsAt) ? 'Black Friday en curso' : 'Activada · cuenta atrás hasta el inicio';
  }
  function apply(data) {
    settings = data; serverEpoch = Date.parse(data.serverTime); monotonicEpoch = performance.now();
    fields.forEach(name => {
      if (name === 'enabled') input(name).checked = data[name];
      else input(name).value = name.endsWith('At') ? time.utcToMadridLocal(data[name]) : data[name];
    });
    renderStatus();
    window.CRONOX_ADMIN_SHELL?.capture(form);
  }
  function values() {
    if (!settings) throw new Error('Carga primero la configuración.');
    const data = { revision: settings.revision };
    fields.forEach(name => { data[name] = name === 'enabled' ? input(name).checked : input(name).value.trim(); });
    try { data.startsAt = time.madridLocalToUtc(data.startsAt); data.endsAt = time.madridLocalToUtc(data.endsAt); }
    catch { throw new Error('Revisa las fechas de Madrid: falta una fecha o la hora es inexistente o ambigua por el cambio de horario.'); }
    if (Date.parse(data.endsAt) <= Date.parse(data.startsAt)) throw new Error('La fecha de finalización debe ser posterior a la de inicio.');
    return data;
  }
  async function load(force = false) {
    if (busy || (loaded && !force)) return;
    busy = true;
    try { apply(await request()); loaded = true; form.querySelector('fieldset').disabled = false; inform(''); }
    catch (error) { inform(error.message, true); }
    finally { busy = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    try {
      const data = values(); busy = true; form.querySelector('button[type="submit"]').disabled = true;
      apply(await request('PATCH', data));
      try { localStorage.setItem('cronox:bf:revision', `${settings.revision}:${Date.now()}`); } catch { /* Storage is optional. */ }
      inform('Campaña guardada. La activación visual es independiente de Pantalla Clave.');
    } catch (error) { inform(error.message, true); }
    finally { busy = false; form.querySelector('button[type="submit"]').disabled = false; }
  });
  document.getElementById('bfReload').addEventListener('click', () => load(true));
  function preview() {
    const state = document.getElementById('bfPreviewState').value;
    if (state === 'event') document.getElementById('bfPreviewFormat').value = 'compact';
    document.getElementById('bfPreviewFormat').disabled = state === 'event';
    if (!previewOpen || !frame.contentWindow) return;
    try {
      const data = values();
      if (!form.reportValidity()) return;
      const start = Date.parse(data.startsAt), end = Date.parse(data.endsAt);
      const previewNow = state === 'event' ? start + Math.min(3600000, (end - start) / 2) : start - 90061000;
      frame.contentWindow.postMessage({ type: 'cronox:bf-preview', settings: data, now: previewNow, compact: state === 'event' || document.getElementById('bfPreviewFormat').value === 'compact' }, location.origin);
      inform('Vista previa de ajustes sin guardar. No activa la campaña pública.');
    } catch (error) { inform(error.message, true); }
  }
  document.getElementById('bfPreviewOpen').addEventListener('click', () => {
    try { values(); if (!form.reportValidity()) return; } catch (error) { inform(error.message, true); return; }
    viewport.hidden = false; previewOpen = true;
    if (!frame.getAttribute('src')) frame.src = `/?mediaPreview=1&bf-preview=1&previewToken=${crypto.randomUUID()}`;
    else preview();
  });
  document.getElementById('bfPreviewClose').addEventListener('click', () => {
    previewOpen = false; viewport.hidden = true; frame.removeAttribute('src');
  });
  document.getElementById('bfPreviewDevice').addEventListener('change', event => {
    const width = event.target.value === 'mobile' ? 390 : 1440;
    const height = event.target.value === 'mobile' ? 844 : 900;
    frame.style.width = `${width}px`; frame.style.height = `${height}px`;
    fitPreview();
  });
  function fitPreview() {
    if (!previewOpen) return;
    const width = parseFloat(frame.style.width) || 1440, height = parseFloat(frame.style.height) || 900;
    const scale = Math.min(1, (viewport.clientWidth - 2) / width);
    frame.style.transform = `scale(${scale})`;
    viewport.style.height = `${height * scale + 2}px`;
  }
  new ResizeObserver(fitPreview).observe(viewport);
  ['bfPreviewState', 'bfPreviewFormat'].forEach(id => document.getElementById(id).addEventListener('change', preview));
  preview();
  form.addEventListener('input', preview);
  window.addEventListener('message', event => { if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'cronox:bf-ready') { preview(); fitPreview(); } });
  // Follow the same section lifecycle as the existing Pantalla Clave editor.
  const section = document.getElementById('section-key-screen');
  new MutationObserver(() => { if (!section.hidden) load(); else if (previewOpen) document.getElementById('bfPreviewClose').click(); }).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  if (!section.hidden) load();
  const statusTimer = setInterval(() => { if (!section.hidden) renderStatus(); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(statusTimer), { once: true });
})();
