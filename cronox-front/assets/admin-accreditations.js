(() => {
  'use strict';
  const section = document.getElementById('section-accreditations');
  if (!section) return;
  const cards = section.querySelector('[data-design-cards]');
  const status = section.querySelector('[role="status"]');
  const editor = section.querySelector('form');
  const save = editor.querySelector('[type="submit"]');
  const preview = section.querySelector('iframe');
  const panel = section.querySelector('[data-design-panel]');
  const panelStatus = section.querySelector('[data-design-panel-status]');
  const retry = section.querySelector('[data-design-retry]');
  let opening, previewTimer, previewToken = '', sequence = 0;
  // Add a design-specific form adapter here when its renderer is implemented.
  // The cards, selection and activation workflow do not depend on its fields.
  const configEditors = Object.freeze({
    'original-v1': {
      fill: config => { editor.elements.artworkUrl.value = config.artworkUrl; },
      read: config => ({ ...config, artworkUrl: editor.elements.artworkUrl.value.trim() }),
    },
    'metacrilatos-v1': { fill: () => {}, read: config => ({ ...config }) },
  });
  let state, selectedId, busy = false;
  const base = () => String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
  async function request(path = '', method = 'GET', body, signal) {
    const headers = { Accept: 'application/json' };
    if (body) Object.assign(headers, { 'Content-Type': 'application/json' }, await window.CRONOX_API.getCsrfHeaders());
    const response = await fetch(`${base()}/api/admin/accreditations${path}`, {
      method, headers, signal: signal || AbortSignal.timeout(10000), credentials: 'include', cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(Array.isArray(data.message) ? data.message.join(' ') : data.message || 'No se pudo completar la operación');
    return data;
  }
  const selected = () => state?.designs.find(design => design.id === selectedId);
  const editedValues = () => {
    const design = selected();
    return { name: editor.elements.name.value.trim(), config: configEditors[design.renderer].read(design.config) };
  };
  const hasEdits = () => {
    const design = selected();
    if (!design || editor.hidden || panel.hidden) return false;
    const values = editedValues();
    return values.name !== design.name || JSON.stringify(values.config) !== JSON.stringify(design.config);
  };
  const updateSave = () => { save.disabled = busy || !hasEdits(); };
  function panelMessage(text, error = false) {
    panelStatus.textContent = text;
    panelStatus.dataset.state = error ? 'error' : 'info';
    retry.hidden = !error;
  }
  function stopPreview() {
    clearTimeout(previewTimer); previewToken = '';
    preview.hidden = true; preview.removeAttribute('src');
  }
  function closePanel(focus = true) {
    sequence++; opening?.abort(); stopPreview(); panel.hidden = true;
    window.CRONOX_ADMIN_SHELL?.clear(panel);
    const button = [...cards.querySelectorAll('[data-design-select]')].find(el => el.dataset.designSelect === selectedId);
    cards.querySelectorAll('[data-design-select]').forEach(el => el.setAttribute('aria-expanded', 'false'));
    if (focus) button?.focus();
  }
  function startPreview() {
    stopPreview();
    previewToken = `${Date.now()}-${++sequence}`;
    panelMessage('Cargando vista previa…');
    section.querySelector('[data-preview-controls]').hidden = false;
    preview.src = `${base()}/api/admin/accreditations/${encodeURIComponent(selectedId)}/preview?previewRequest=${previewToken}`;
    previewTimer = setTimeout(() => {
      previewToken = ''; preview.hidden = true;
      panelMessage('No se pudo cargar la vista previa. Puedes reintentar la carga.', true);
    }, 15000);
  }
  window.addEventListener('message', event => {
    if (panel.hidden || event.source !== preview.contentWindow || event.origin !== new URL(base() || location.origin, location.href).origin ||
        !previewToken || event.data?.type !== 'cronox:accreditation-preview' || event.data.token !== previewToken) return;
    clearTimeout(previewTimer);
    const ok = event.data.status === 'ready';
    preview.hidden = !ok;
    panelMessage(ok ? 'Vista previa cargada. Datos ficticios; el diseño público no ha cambiado.' : 'No se pudo cargar la vista previa o sus imágenes. Reintenta la carga.', !ok);
  });
  async function openDesign(id) {
    opening?.abort(); stopPreview();
    const attempt = ++sequence;
    opening = new AbortController();
    const timeout = setTimeout(() => opening?.abort(), 10000);
    selectedId = id; panel.hidden = false; editor.hidden = true;
    section.querySelector('[data-preview-controls]').hidden = true;
    section.querySelector('[data-design-selected]').textContent = 'Configuración y vista previa';
    panelMessage('Cargando configuración…');
    panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    section.querySelector('[data-design-selected]').focus();
    try {
      const response = await request('', 'GET', undefined, opening.signal);
      if (attempt !== sequence || panel.hidden) return;
      state = response;
      select(id);
      startPreview();
    } catch (error) {
      if (attempt === sequence && !panel.hidden) panelMessage('No se pudo cargar la configuración. Reintenta la carga.', true);
    } finally { clearTimeout(timeout); }
  }
  function select(id) {
    selectedId = id;
    const design = selected();
    editor.hidden = !design?.ready || !configEditors[design.renderer];
    preview.hidden = true;
    section.querySelector('[data-preview-controls]').hidden = true;
    preview.removeAttribute('src');
    if (editor.hidden) throw new Error('Configuración del diseño no disponible');
    editor.elements.name.value = design.name;
    editor.elements.name.readOnly = design.renderer === 'metacrilatos-v1';
    editor.querySelectorAll('[data-config-renderer]').forEach(panel => {
      panel.hidden = panel.dataset.configRenderer !== design.renderer;
      panel.querySelectorAll('input, select, textarea').forEach(field => { field.disabled = panel.hidden; });
    });
    configEditors[design.renderer].fill(design.config);
    section.querySelector('[data-design-selected]').textContent = `${design.name} · ${design.active ? 'Activa' : 'Inactiva'}`;
    section.querySelector('[data-active-warning]').hidden = !design.active;
    cards.querySelectorAll('[data-design-select]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.designSelect === id)));
    cards.querySelectorAll('[data-design-select]').forEach(button => button.setAttribute('aria-expanded', String(button.dataset.designSelect === id && !panel.hidden)));
    window.CRONOX_ADMIN_SHELL?.capture(panel);
    updateSave();
  }
  function render() {
    cards.replaceChildren();
    state.designs.forEach(design => {
      const card = document.createElement('article');
      card.className = 'card';
      const name = document.createElement('h3'); name.textContent = design.name;
      const label = document.createElement('p'); label.textContent = `${design.active ? 'Activa' : 'Inactiva'}${design.ready ? '' : ' · Incompleta'}`;
      const review = document.createElement('button');
      review.type = 'button'; review.className = 'btn'; review.textContent = 'Configuración y vista previa';
      review.dataset.designSelect = design.id; review.disabled = !design.ready;
      review.setAttribute('aria-controls', 'accreditationDesignPanel');
      review.setAttribute('aria-expanded', String(!panel.hidden && selectedId === design.id));
      review.onclick = () => openDesign(design.id);
      card.append(name, label, review);
      if (!design.active) {
        const activate = document.createElement('button');
        activate.type = 'button'; activate.className = 'btn primary'; activate.textContent = 'Activar'; activate.disabled = !design.ready;
        activate.onclick = () => run(async () => {
          state = await request(`/${encodeURIComponent(design.id)}/activate`, 'POST', { expectedRevision: state.revision });
          render(); status.textContent = 'Acreditación activada para todos los visitantes.';
        });
        card.append(activate);
      }
      cards.append(card);
    });
    if (!panel.hidden && selected()) select(selectedId);
    window.CRONOX_ADMIN_SHELL?.clear(section);
  }
  async function run(operation) {
    if (busy) return;
    busy = true; section.setAttribute('aria-busy', 'true');
    section.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { await operation(); }
    catch (error) { status.textContent = `${error.message}. Pulsa Recargar para obtener el estado actual.`; }
    finally {
      busy = false; section.removeAttribute('aria-busy');
      section.querySelectorAll('button').forEach(button => { button.disabled = false; });
      cards.querySelectorAll('article').forEach((card, index) => {
        if (!state?.designs?.[index]?.ready) card.querySelectorAll('button').forEach(button => { button.disabled = true; });
      });
      updateSave();
    }
  }
  const load = () => run(async () => {
    closePanel(false);
    status.textContent = 'Cargando acreditaciones…';
    const response = await request();
    if (!Array.isArray(response?.designs) || !response.designs.length) {
      throw new Error('El servidor no devuelve ningún diseño de acreditación. Revisa el registro inicial');
    }
    state = response; render(); status.textContent = 'Seleccionar o previsualizar no cambia el diseño público.';
  });
  section.querySelector('[data-design-reload]').onclick = load;
  editor.onsubmit = event => {
    event.preventDefault();
    if (!hasEdits()) return;
    run(async () => {
      const design = selected();
      state = await request(`/${encodeURIComponent(design.id)}`, 'PATCH', {
        ...editedValues(), expectedRevision: design.revision,
      });
      render(); startPreview(); status.textContent = 'Configuración guardada.';
    });
  };
  editor.addEventListener('input', updateSave);
  editor.addEventListener('change', updateSave);
  section.querySelector('[data-design-preview]').onclick = startPreview;
  section.querySelector('[data-design-close]').onclick = () => closePanel();
  retry.onclick = () => openDesign(selectedId);
  section.querySelector('[data-preview-size]').onchange = event => { preview.style.width = event.target.value; };
  window.CRONOX_ADMIN_ACCREDITATIONS = Object.freeze({ load });
  // The menu can reveal the section before this module loads, or an older
  // cached admin.js may not know its load hook. Visibility owns initialization;
  // the busy guard coalesces this with the current navigation hook.
  const loadWhenVisible = () => { if (!section.hidden) void load(); else closePanel(false); };
  new MutationObserver(loadWhenVisible).observe(section, { attributes: true, attributeFilter: ['hidden'] });
  loadWhenVisible();
})();
