(() => {
  'use strict';
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
  const apply = (root, design) => {
    const renderer = renderers[design?.renderer];
    if (!renderer) throw new Error('Diseño no disponible. Recarga la página.');
    renderer(root, design.config);
    root.dataset.accreditationDesign = design.id;
  };
  const loadActive = async root => {
    const base = String(window.CRONOX_API?.API_BASE || '').replace(/\/$/, '');
    const response = await fetch(`${base}/api/accreditations/active`, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo cargar el diseño de acreditación. Inténtalo de nuevo.');
    apply(root, await response.json());
  };
  window.CRONOX_ACCREDITATION_DESIGNS = Object.freeze({ apply, loadActive });
})();
