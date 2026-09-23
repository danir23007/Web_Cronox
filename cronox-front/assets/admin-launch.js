(async () => {
  const base = window.CRONOX_API?.API_BASE || window.CRONOX_API_BASE || '';
  const status = document.getElementById('status');
  const button = document.getElementById('send');
  async function preview() {
    const response = await fetch(`${base}/api/admin/launch`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Inicia sesión como SUPERADMIN para preparar la apertura.');
    const data = await response.json();
    document.getElementById('subject').textContent = data.subject;
    document.getElementById('preview').textContent = data.message;
    status.textContent = `${data.recipients} destinatarios · ${data.sent} enviados · ${data.pending} pendientes · ${data.uncertain} por revisar`;
    button.hidden = !data.pending;
    return data;
  }
  try { await preview(); } catch (error) { status.textContent = error.message; return; }
  button.onclick = async () => {
    if (!confirm('¿Enviar este correo de apertura con el 15% personal a todos los prerregistrados pendientes?')) return;
    button.disabled = true;
    try {
      const csrf = await fetch(`${base}/api/auth/csrf`, { credentials: 'include' });
      if (!csrf.ok) throw new Error('No se pudo verificar la sesión.');
      const { csrfToken } = await csrf.json();
      let remaining;
      do {
        const response = await fetch(`${base}/api/admin/launch/send`, { method: 'POST', credentials: 'include',
          headers: { 'x-csrf-token': csrfToken } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Error durante el envío');
        remaining = result.remaining;
        await preview();
        if (result.uncertain) throw new Error('Hay envíos cuyo resultado debe revisarse antes de continuar. No se reenviarán automáticamente.');
      } while (remaining > 0);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
})();
