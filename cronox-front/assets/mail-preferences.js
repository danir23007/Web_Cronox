(() => {
  const login = document.getElementById('mailPreferencesLogin'), unsubscribe = document.getElementById('mailPreferencesUnsubscribe'), status = document.getElementById('mailPreferencesStatus');
  const api = path => (window.CRONOX_API?.API_BASE || '') + '/api/mail-preferences' + path;
  const resolve = async () => {
    const identified = Boolean(window.CRONOX_USER?.id);
    login.hidden = identified; unsubscribe.hidden = !identified;
    if (!identified) { status.textContent = 'Inicia sesión para gestionar las preferencias de tu cuenta.'; return; }
    try {
      const response = await fetch(api(''), { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw Error();
      const state = await response.json(); unsubscribe.hidden = state.commercialSuppressed;
      status.textContent = state.commercialSuppressed ? 'Tu baja comercial está registrada.' : 'Puedes confirmar la baja comercial de tu cuenta, incluidos los avisos comerciales solicitados anteriormente.';
    } catch { status.textContent = 'No se pudieron comprobar tus preferencias. Vuelve a intentarlo.'; }
  };
  login.addEventListener('click', () => window.CRONOX_openAuthModal?.('login'));
  unsubscribe.addEventListener('click', async () => {
    unsubscribe.disabled = true;
    try {
      const response = await fetch(api('/unsubscribe'), { method: 'POST', credentials: 'include', headers: await window.CRONOX_API.getCsrfHeaders() });
      if (!response.ok) throw Error();
      status.textContent = (await response.json()).message; unsubscribe.hidden = true;
    } catch { status.textContent = 'No se pudo registrar la baja. Vuelve a intentarlo.'; }
    finally { unsubscribe.disabled = false; }
  });
  window.addEventListener('cronox:authResolved', () => void resolve());
  if (window.CRONOX_AUTH_STATE) void resolve();
})();
