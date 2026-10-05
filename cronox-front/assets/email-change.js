(() => {
  'use strict';
  const message = document.getElementById('emailChangeMessage');
  const button = document.getElementById('emailChangeConfirm');
  const api = window.api || window.CRONOX_API;
  const labels = { authorize: 'Autorizar cambio', verify: 'Verificar nuevo email', cancel: 'Cancelar solicitud' };
  let payload, revision = 0, inspected = false;
  const failure = (error) => {
    message.textContent = error?.payload?.message || error?.message || 'No se pudo comprobar el enlace. Vuelve a intentarlo.';
  };
  const inspect = async () => {
    const version = revision;
    const data = await api.inspectEmailChange(payload);
    if (version !== revision) return;
    inspected = true;
    button.textContent = labels[data.action];
    message.textContent = `Nueva dirección solicitada: ${data.newEmail}. ${data.action === 'authorize'
      ? 'Al autorizar, enviaremos la verificación al nuevo buzón. Tu email aún no cambiará.'
      : data.action === 'verify' ? 'Al verificar, cambiará tu email y tendrás que iniciar sesión de nuevo.'
      : 'Se cancelará esta solicitud y tu email actual se conservará.'}`;
    button.disabled = false;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    if (!inspected) { await inspect().catch(failure); return; }
    const version = revision;
    try {
      const data = await api.confirmEmailChange(payload);
      if (version !== revision) return;
      message.textContent = data.stage === 'PENDING_NEW'
        ? 'Cambio autorizado. Revisa el nuevo buzón y verifica su dirección para terminar.'
        : data.stage === 'COMPLETE' ? 'Email cambiado. Inicia sesión de nuevo con tu nuevo email.' : 'Solicitud cancelada. Tu email actual se conserva.';
      button.hidden = true;
      payload.token = null;
    } catch (error) {
      if (version !== revision) return;
      failure(error);
      // A mail failure may have advanced the stage. Never automatically repeat a confirmation.
      try { await inspect(); } catch { button.disabled = true; }
    }
  });
  const loadLink = () => {
    const params = new URLSearchParams(location.hash.slice(1));
    payload = { token: params.get('token'), action: params.get('action') };
    history.replaceState(null, '', location.pathname);
    revision++;
    inspected = false;
    button.hidden = false;
    button.disabled = true;
    if (!payload.token || !labels[payload.action] || !api?.inspectEmailChange) {
      message.textContent = 'El enlace no es válido. Abre el enlace completo recibido por correo.';
    } else inspect().catch(error => {
      failure(error);
      button.textContent = 'Volver a comprobar enlace';
      button.disabled = ![0, 500, 502, 503, 504].includes(Number(error?.status || 0));
    });
  };
  window.addEventListener('hashchange', loadLink);
  loadLink();
})();
