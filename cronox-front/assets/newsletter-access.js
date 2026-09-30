(() => {
  let token = '';
  const message = document.getElementById('message');
  const enter = document.getElementById('enter');
  const replacement = document.getElementById('replacement');
  const showReplacement = text => {
    message.textContent = text;
    enter.hidden = true;
    replacement.hidden = false;
  };
  const csrf = async () => {
    const response = await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('CSRF_UNAVAILABLE');
    return (await response.json()).csrfToken;
  };
  const readLink = () => {
    token = location.hash.slice(1);
    history.replaceState(null, '', location.pathname + location.search);
    if (!/^[a-f0-9]{64}$/.test(token)) {
      showReplacement('El enlace ha caducado o no es válido. Puedes solicitar otro.');
      return;
    }
    message.textContent = 'Pulsa el botón para acceder. El enlace solo funciona una vez.';
    replacement.hidden = true;
    enter.hidden = false;
    enter.disabled = false;
  };
  readLink();
  addEventListener('hashchange', readLink);
  enter.addEventListener('click', async () => {
    enter.disabled = true;
    try {
      const response = await fetch('/api/auth/newsletter-login', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        showReplacement(response.status === 401
          ? 'El enlace ha caducado o ya se ha utilizado. Solicita otro enlace o entra con contraseña.'
          : 'No hemos podido completar el acceso. Inténtalo de nuevo.');
        return;
      }
      location.replace('/');
    } catch {
      message.textContent = 'No hemos podido conectar. Inténtalo de nuevo.';
      enter.disabled = false;
    }
  });
  replacement.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    const submit = replacement.querySelector('button');
    submit.disabled = true;
    try {
      const response = await fetch('/api/newsletter/request-access', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error('REQUEST_FAILED');
      message.textContent = 'Si corresponde, recibirás un enlace por correo. Si lo has solicitado hace poco, espera unos minutos.';
    } catch {
      message.textContent = 'No hemos podido solicitar el enlace. Comprueba tu conexión y vuelve a intentarlo.';
    } finally { submit.disabled = false; }
  });
})();
