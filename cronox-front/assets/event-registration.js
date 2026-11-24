(() => {
  'use strict';
  if (document.body?.dataset.registrationSource !== 'event') return;
  // Every submission/retry/reload on this durable route carries the source.
  // The server persists attribution atomically with creation, not in this UI.
  const api = window.CRONOX_API;
  if (api?.register) {
    const register = api.register.bind(api);
    api.register = data => register({ ...data, registrationSource: 'event' });
  }
  const host = document.getElementById('eventRegistrationFormHost');
  const complete = document.getElementById('eventRegistrationComplete');
  window.addEventListener('cronox:authResolved', event => {
    const identified = Boolean(event.detail?.user?.id);
    host.hidden = identified;
    complete.hidden = !identified;
  });
})();
