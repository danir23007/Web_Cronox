// assets/version.js
(function () {
  // 👉 Cambiar este número cuando quiera actualizar estilos o scripts
  const VERSION = '81';

  window.CRONOX_VERSION = VERSION;

  window.CRONOX_ASSET = function (path) {
    if (!path) return '';
    const hasQuery = path.includes('?');
    return path + (hasQuery ? '&' : '?') + 'v=' + encodeURIComponent(VERSION);
  };
})();
