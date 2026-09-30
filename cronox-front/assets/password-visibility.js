(() => {
  if (window.CRONOX_PASSWORD_VISIBILITY) return;
  window.CRONOX_PASSWORD_VISIBILITY = true;

  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const hiddenEye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M9 5.5A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-4 4M6 6a19 19 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/></svg>';
  const fields = new Set();

  const install = input => {
    if (input.dataset.passwordEye || input.disabled || input.readOnly || input.hasAttribute('data-secret-placeholder')) return;
    input.dataset.passwordEye = 'true';
    const wrapper = document.createElement('span');
    wrapper.className = 'password-entry';
    input.before(wrapper);
    wrapper.append(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'password-eye';
    button.setAttribute('aria-label', 'Mostrar contraseña');
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = eye;
    wrapper.append(button);

    const concealed = () => {
      input.type = 'password';
      button.setAttribute('aria-label', 'Mostrar contraseña');
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = eye;
    };
    const sync = () => {
      const available = input.value.length > 0 && !input.disabled && !input.readOnly;
      if (!available && input.type !== 'password') concealed();
      if (!available && document.activeElement === button) input.focus({ preventScroll: true });
      button.hidden = !available;
    };

    let selection;
    button.addEventListener('pointerdown', event => {
      selection = { start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input };
      event.preventDefault();
    });
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      if (!input.value) { sync(); return; }
      const focused = selection?.focused ?? document.activeElement === input;
      const start = selection?.start ?? input.selectionStart;
      const end = selection?.end ?? input.selectionEnd;
      selection = null;
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
      button.setAttribute('aria-pressed', String(visible));
      button.innerHTML = visible ? hiddenEye : eye;
      if (focused) {
        input.focus({ preventScroll: true });
        try { input.setSelectionRange(start, end); } catch {}
        requestAnimationFrame(() => {
          if (document.activeElement === input) try { input.setSelectionRange(start, end); } catch {}
        });
      }
    });
    for (const event of ['input', 'change', 'focus', 'animationstart']) input.addEventListener(event, sync);
    input.form?.addEventListener('reset', () => {
      concealed();
      requestAnimationFrame(sync); // A form reset updates values after dispatching its event.
    });
    fields.add({ input, sync });
    sync();
  };

  const refresh = () => {
    document.querySelectorAll('input[type="password"]').forEach(install);
    for (const field of fields) {
      if (!field.input.isConnected) fields.delete(field);
      else field.sync();
    }
  };
  const start = () => {
    refresh();
    new MutationObserver(refresh).observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'readonly'],
    });
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    // Some password managers and browsers fill input.value without dispatching an event.
    // One shared, visibility-gated check covers those cases and dynamically added fields.
    window.setInterval(() => { if (!document.hidden) refresh(); }, 300);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
