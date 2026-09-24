(async () => {
  const base = window.CRONOX_API?.API_BASE || window.CRONOX_API_BASE || '';
  const status = document.getElementById('status');
  try {
    const response = await fetch(`${base}/api/admin/launch`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error('Inicia sesión como SUPERADMIN para consultar la apertura.');
    const data = await response.json();
    document.getElementById('subject').textContent = data.subject;
    document.getElementById('preview').textContent = data.message;
    status.textContent = `${data.status} · ${data.sent} aceptados por SMTP · ${data.pending} pendientes · ${data.uncertain} por revisar`;
  } catch (error) { status.textContent = error.message; }
})();
