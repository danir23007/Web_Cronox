(() => {
  'use strict';
  if (document.body?.dataset.registrationSource !== 'event') return;
  const fitViewport = () => {
    document.documentElement.style.setProperty('--event-viewport-height', (window.visualViewport?.height || innerHeight) + 'px');
    document.documentElement.style.setProperty('--event-viewport-top', (window.visualViewport?.offsetTop || 0) + 'px');
  };
  fitViewport();
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
  const api = window.CRONOX_API;
  if (api?.register) {
    const register = api.register.bind(api);
    api.register = data => register({ ...data, registrationSource: 'event' });
  }
  window.addEventListener('cronox:authResolved', event => {
    if (event.detail?.user?.id) window.location.replace('/');
    else if (event.detail?.state === 'anonymous') delete document.body.dataset.eventAuth;
  });
  document.addEventListener('focusin', event => {
    const overlay = document.getElementById('authOverlay');
    if (overlay && !overlay.contains(event.target)) document.getElementById('authCloseBtn')?.focus({ preventScroll: true });
  });
})();
