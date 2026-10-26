(function () {
  const section = document.getElementById('bank-transfer-option');
  if (!section) return;
  const start = document.getElementById('bank-transfer-start');
  const refresh = document.getElementById('bank-transfer-refresh');
  const cancel = document.getElementById('bank-transfer-cancel');
  const instructions = document.getElementById('bank-transfer-instructions');
  const error = document.getElementById('bank-transfer-error');
  const base = window.CRONOX_API?.API_BASE || '';
  let ready = null;
  let ref = null;
  let available = false;
  let busy = false;
  let pending = false;
  const frozen = new Map();
  const referenceStorageKey = 'cronox_pending_bank_transfer';
  const rememberReference = value => {
    try {
      if (value) sessionStorage.setItem(referenceStorageKey, value);
      else sessionStorage.removeItem(referenceStorageKey);
    } catch { /* Owner checks remain server-side if storage is unavailable. */ }
  };
  const money = cents => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const lock = locked => {
    const accepted = window.dispatchEvent(new CustomEvent('cronox:bank-transfer-lock', { cancelable: true, detail: { locked } }));
    if (!accepted) return false;
    if (locked) {
      document.querySelectorAll('#shipping-form input, #shipping-form select, #shipping-options input, #checkout-guest-email, .checkout-promo input, .checkout-promo button').forEach(control => {
        if (!frozen.has(control)) frozen.set(control, control.disabled);
        control.disabled = true;
      });
    } else {
      frozen.forEach((disabled, control) => { control.disabled = disabled; });
      frozen.clear();
    }
    return true;
  };
  const request = async (path, method = 'GET', body) => {
    const csrf = method === 'POST' ? await window.CRONOX_API?.getCsrfHeaders?.() || {} : {};
    const response = await fetch(`${base}/api/payments/bank-transfer${path}`, { method, credentials: 'include',
      headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json', ...csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = new Error('No se pudo actualizar la transferencia. Inténtalo de nuevo.');
      failure.code = payload?.message;
      if (failure.code === 'BANK_TRANSFER_RESERVATION_LIMIT') failure.message = 'Por ahora no podemos reservar este pedido mediante transferencia. Puedes usar otro método de pago o intentarlo más tarde.';
      if (failure.code === 'BANK_TRANSFER_STOCK_RESERVATION_LIMIT') failure.message = 'La transferencia no está disponible para esta cantidad de artículos en este momento. Puedes usar otro método de pago.';
      throw failure;
    }
    return payload;
  };
  const controls = () => {
    start.disabled = busy || (!pending && !ready);
    refresh.disabled = cancel.disabled = busy;
  };
  const line = (label, value) => {
    if (!value) return;
    const row = document.createElement('p');
    const heading = document.createElement('strong');
    heading.textContent = `${label}: `;
    row.append(heading, document.createTextNode(String(value)));
    instructions.append(row);
  };
  const render = data => {
    ref = data.paymentIntentId;
    window.dispatchEvent(new CustomEvent('cronox:bank-transfer-reference', { detail: { paymentIntentId: ref } }));
    pending = data.orderStatus === 'PENDING';
    rememberReference(pending ? ref : null);
    section.hidden = false;
    section.open = true;
    instructions.hidden = false;
    instructions.replaceChildren();
    line('Pedido', data.orderId);
    line('Estado', pending ? (data.paymentStatus === 'canceled' ? 'Cancelación pendiente de confirmación' : ['succeeded', 'processing'].includes(data.paymentStatus) ? 'Validando el pago con nuestro sistema' : 'Pendiente de recibir la transferencia') : data.orderStatus === 'CANCELLED' ? 'Transferencia cancelada' : 'Confirmación de pago');
    if (pending && data.paymentStatus !== 'canceled') {
      lock(true);
      line('Importe del pedido', money(data.totalCents));
      line('Importe pendiente', data.amountRemainingCents == null ? 'Consultando instrucciones' : money(data.amountRemainingCents));
      for (const account of data.accounts || []) {
        line('Beneficiario', account.beneficiary);
        line('IBAN', account.iban);
        line('BIC', account.bic);
      }
      line('Referencia obligatoria', data.reference);
      line('Reserva hasta', new Date(data.expiresAt).toLocaleString('es-ES'));
      line('Información', 'Transfiere solo el importe pendiente, con la referencia indicada. No envíes dinero después del plazo o tras cancelar. El stock sigue reservado; las instrucciones no confirman el pago.');
      refresh.hidden = cancel.hidden = false;
      start.hidden = Boolean(data.accounts?.length) || ['succeeded', 'processing'].includes(data.paymentStatus);
      start.textContent = 'Reintentar obtención de instrucciones';
    } else {
      start.hidden = true;
      refresh.hidden = data.orderStatus !== 'PENDING';
      cancel.hidden = true;
      if (data.orderStatus === 'CANCELLED') lock(false);
      else {
        const link = document.createElement('a');
        link.href = `/checkout/exito?ref=${encodeURIComponent(ref)}`;
        link.textContent = 'Consultar confirmación del pedido';
        instructions.append(link);
      }
    }
    controls();
  };
  const load = async () => render(await request(`?ref=${encodeURIComponent(ref)}`));
  window.addEventListener('cronox:checkout-payment-ready', event => { ready = event.detail; section.hidden = !available && !pending; controls(); });
  window.addEventListener('cronox:checkout-payment-unready', () => { ready = null; controls(); });
  window.addEventListener('cronox:bank-transfer-pending', event => {
    ref = event.detail.paymentIntentId;
    rememberReference(ref);
    pending = true;
    section.hidden = false;
    section.open = true;
    lock(true);
    void load().catch(() => { error.textContent = 'Hay una transferencia pendiente. Actualiza su estado antes de volver a pagar.'; refresh.hidden = false; });
  });
  start.addEventListener('click', async () => {
    if (busy || (!pending && !ready)) return;
    const payload = ready?.payload;
    const preparedRef = ready?.paymentIntentId;
    if (!lock(true)) { error.textContent = 'Termina o cancela el pago abierto antes de iniciar una transferencia.'; return; }
    busy = true;
    controls();
    error.textContent = '';
    try {
      render(pending ? await request(`/resume?ref=${encodeURIComponent(ref)}`, 'POST') : await request('', 'POST', payload));
    } catch (failure) {
      error.textContent = failure.message;
      ref = ref || preparedRef;
      rememberReference(ref);
      try { await load(); } catch (lookup) {
        // Only an authoritative not-started response proves it is safe to
        // return to card payment after a failed/ambiguous POST.
        if (lookup.code === 'BANK_TRANSFER_NOT_STARTED') { ref = null; rememberReference(null); lock(false); }
        else { pending = true; refresh.hidden = false; error.textContent = 'No pudimos comprobar la transferencia. Actualiza el estado antes de volver a pagar.'; }
      }
    } finally { busy = false; controls(); }
  });
  refresh.addEventListener('click', async () => { if (busy || !ref) return; busy = true; controls(); error.textContent = ''; try { await load(); } catch (failure) { error.textContent = failure.message; } finally { busy = false; controls(); } });
  cancel.addEventListener('click', async () => {
    if (busy || !ref) return;
    busy = true;
    controls();
    error.textContent = '';
    try {
      await request(`/cancel?ref=${encodeURIComponent(ref)}`, 'POST');
      pending = false;
      ref = null;
      rememberReference(null);
      instructions.hidden = refresh.hidden = cancel.hidden = true;
      start.hidden = false;
      start.textContent = 'Obtener instrucciones de transferencia';
      lock(false);
    } catch (failure) { error.textContent = 'La cancelación no está confirmada. Actualiza el estado; no vuelvas a pagar todavía.'; }
    finally { busy = false; controls(); }
  });
  void request('/availability').then(data => { available = data?.available === true; section.hidden = !available && !pending; controls(); }).catch(() => { section.hidden = !pending; });
  try {
    const storedRef = sessionStorage.getItem(referenceStorageKey);
    if (storedRef && /^pi_[A-Za-z0-9_]+$/.test(storedRef)) {
      ref = storedRef;
      pending = true;
      section.hidden = false;
      section.open = true;
      lock(true);
      void load().catch(failure => {
        if (['BANK_TRANSFER_NOT_FOUND', 'BANK_TRANSFER_NOT_STARTED'].includes(failure.code)) {
          ref = null; pending = false; rememberReference(null); lock(false); section.hidden = !available;
        } else { error.textContent = 'Hay una transferencia guardada pendiente de comprobar. Actualiza su estado antes de volver a pagar.'; refresh.hidden = false; }
      });
    }
  } catch { /* This tab can also recover through the server's active snapshot. */ }
})();
