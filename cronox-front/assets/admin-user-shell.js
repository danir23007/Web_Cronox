(() => {
  'use strict';
  document.querySelectorAll('#adminSidebar [data-nav-target]').forEach(button => button.addEventListener('click', () => {
    if (window.CRONOX_ADMIN_SHELL.canLeave('outside')) location.href = 'admin.html#' + button.dataset.navTarget;
  }));
  document.getElementById('backBtn')?.addEventListener('click', () => { location.href = '/'; });
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try { await window.CRONOX_API?.logout?.(); location.href = 'admin-login.html'; }
    catch { window.alert('No se pudo cerrar la sesión. Inténtalo de nuevo.'); }
  });
  window.CRONOX_ADMIN_SHELL?.select('section-users');
})();
