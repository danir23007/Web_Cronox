(() => {
  const form = document.getElementById('adminLoginForm');
  const email = document.getElementById('adminLoginEmail');
  const password = document.getElementById('adminLoginPassword');
  const submit = document.getElementById('adminLoginSubmit');
  const status = document.getElementById('adminLoginStatus');
  const checking = document.getElementById('adminLoginChecking');
  const auth = window.CRONOX_ADMIN_AUTH;
  const requestedReturnTo = auth?.safeReturnTo(
    new URLSearchParams(window.location.search).get('returnTo'),
  ) || '/admin.html';

  const showForm = () => {
    checking.hidden = true;
    form.hidden = false;
    email.focus();
  };
  const showError = () => {
    status.textContent = 'No se pudo iniciar sesión. Revisa tus credenciales.';
  };
  const redirectToAdmin = () => window.location.replace(requestedReturnTo);

  const checkExistingSession = async () => {
    if (!window.CRONOX_API?.getMe || !auth) {
      showForm();
      return;
    }
    try {
      const user = await window.CRONOX_API.getMe();
      if (auth.isAdmin(user)) {
        redirectToAdmin();
        return;
      }
    } catch {
      // Keep session/account details private on connectivity failures.
    }
    showForm();
  };

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    submit.disabled = true;
    submit.textContent = 'VERIFICANDO…';
    try {
      const user = await window.CRONOX_API?.login?.({
        email: email.value.trim(),
        password: password.value,
      });
      if (!auth?.isAdmin(user)) {
        status.textContent = 'Esta cuenta no tiene acceso al panel.';
        return;
      }
      redirectToAdmin();
    } catch {
      showError();
    } finally {
      submit.disabled = false;
      submit.textContent = 'INICIAR SESIÓN';
    }
  });

  void checkExistingSession();
})();
