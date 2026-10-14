(function () {
  'use strict';
  const labels = Object.freeze({ ACTIVE: 'Activo', INACTIVE: 'Inactivo' });
  window.CRONOX_ACCOUNT_STATE = Object.freeze({
    labels,
    label: (value) => labels[value] || 'Estado desconocido',
  });
})();
