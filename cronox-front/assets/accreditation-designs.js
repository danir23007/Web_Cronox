(() => {
  'use strict';
  const states = new WeakMap();
  const stateFor = root => {
    if (!states.has(root)) states.set(root, { sequence: 0 });
    return states.get(root);
  };
  const clear = root => {
    if (!root) return;
    const state = stateFor(root);
    state.sequence++;
    state.instance?.destroy();
    state.instance = null;
    state.host?.remove();
    state.host = null;
    if (state.promotionMarker) {
      state.promotionMarker.replaceWith(state.promotion);
      state.promotionMarker = null;
    }
    state.promotionHost?.remove();
    state.promotionHost = null;
  };
  // Renderers keep membership data hooks; identity, QR, statistics and actions
  // continue to be owned by profile.js, never by a visual design.
  const renderers = Object.freeze({
    'original-v1': (root, config) => {
      if (config?.version !== 1 || typeof config.artworkUrl !== 'string') throw new Error('Configuración incompleta');
      const image = root.querySelector('.accreditation-book-art');
      if (!image) throw new Error('Plantilla incompleta');
      if (image.getAttribute('src') !== config.artworkUrl) image.src = config.artworkUrl;
    },
  });
  const apply = (root, design, data) => {
    clear(root);
    const state = stateFor(root);
    const original = root.querySelector('.accreditation-stage');
    if (design?.renderer === 'metacrilatos-v1') {
      if (design.config?.version !== 1 || !window.CRONOX_METACRILATOS) throw new Error('Diseño no disponible. Recarga la página.');
      if (!data || !Number.isInteger(data.circleLevel) || data.circleLevel < 1 || data.circleLevel > 5) {
        throw new Error('Acreditación no disponible: círculo ausente o no válido.');
      }
      if (original) original.hidden = true;
      const host = document.createElement('div');
      host.className = 'metacrilatos-host';
      state.host = host;
      (original?.parentElement || root).prepend(host);
      root.dataset.accreditationDesign = design.id;
      root.dataset.accreditationRenderer = design.renderer;
      // Keep the existing promotion controls and their listeners available.
      const promotion = original?.querySelector('.accreditation-upgrade');
      if (promotion) {
        state.promotion = promotion;
        state.promotionMarker = document.createComment('accreditation promotion');
        promotion.replaceWith(state.promotionMarker);
        state.promotionHost = document.createElement('div');
        state.promotionHost.className = 'metacrilatos-promotion';
        state.promotionHost.append(promotion);
        host.after(state.promotionHost);
      }
      const sequence = state.sequence;
      return Promise.resolve(window.CRONOX_METACRILATOS.mount(host, data)).then(async instance => {
        if (sequence !== state.sequence) { instance.destroy(); return; }
        state.instance = instance;
        await instance.ready;
      }).catch(error => {
        if (sequence === state.sequence) clear(root);
        throw error;
      });
    }
    const renderer = renderers[design?.renderer];
    if (!renderer) throw new Error('Diseño no disponible. Recarga la página.');
    renderer(root, design.config);
    if (original) original.hidden = false;
    root.dataset.accreditationDesign = design.id;
    root.dataset.accreditationRenderer = design.renderer;
  };
  const loadActive = async root => {
    clear(root);
    const state = stateFor(root);
    const sequence = state.sequence;
    const current = () => sequence === state.sequence;
    const base = String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
    const response = await fetch(`${base}/api/accreditations/active`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('No se pudo cargar el diseño de acreditación. Inténtalo de nuevo.');
    const design = await response.json();
    if (!current()) return null;
    let data;
    if (design.renderer === 'metacrilatos-v1') {
      const personal = await fetch(`${base}/api/membership/me/accreditation`, {
        credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (!current()) return null;
      if (!personal.ok) throw new Error('No se pudo cargar tu acreditación. Comprueba tu sesión y vuelve a intentarlo.');
      data = await personal.json();
      if (!current()) return null;
    }
    await apply(root, design, data);
    return design;
  };
  window.CRONOX_ACCREDITATION_DESIGNS = Object.freeze({ apply, loadActive, destroy: clear });
})();
