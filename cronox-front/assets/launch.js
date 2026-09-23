(async () => {
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const message = document.getElementById('message');
  const button = document.getElementById('enter');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    message.textContent = 'Abre el enlace de tu correo o inicia sesión en la tienda.';
    return;
  }
  const base = window.CRONOX_API?.API_BASE || window.CRONOX_API_BASE || '';
  // An explicit gesture prevents email scanners from consuming the login link.
  message.textContent = 'Pulsa para acceder a tu cuenta y descubrir la colección.';
  button.hidden = false;
  button.onclick = async () => {
    button.disabled = true;
    try {
      const csrfResponse = await fetch(`${base}/api/auth/csrf`, { credentials: 'include', cache: 'no-store' });
      if (!csrfResponse.ok) throw new Error();
      const { csrfToken } = await csrfResponse.json();
      const response = await fetch(`${base}/api/auth/launch-login`, { method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ token }) });
      if (!response.ok) {
        const error = await response.json();
        message.textContent = typeof error.message === 'string' ? error.message : 'No se pudo iniciar sesión.';
        return;
      }
      location.replace('/');
    } catch {
      message.textContent = 'No se pudo conectar. Inténtalo de nuevo.';
      button.disabled = false;
    }
  };
})();
