(function () {
  const api = window.CRONOX_API || {};
  const $ = (id) => document.getElementById(id);

  const messageEl = $('profileMessage');
  const ordersBody = $('ordersBody');
  const ordersEmpty = $('ordersEmpty');

  const showMessage = (text, type = 'info') => {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.classList.remove('is-error', 'is-success');
    if (type === 'error') messageEl.classList.add('is-error');
    if (type === 'success') messageEl.classList.add('is-success');
    messageEl.style.display = text ? 'block' : 'none';
  };

  const safeTrim = (value) => (typeof value === 'string' ? value.trim() : '');
  const optionalValue = (id) => {
    const v = safeTrim($(id)?.value || '');
    return v || undefined;
  };
  const requiredValue = (id) => safeTrim($(id)?.value || '');

  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  };

  const renderOrders = (orders) => {
    if (!ordersBody || !ordersEmpty) return;
    ordersBody.innerHTML = '';

    if (!Array.isArray(orders) || !orders.length) {
      ordersEmpty.hidden = false;
      return;
    }

    ordersEmpty.hidden = true;
    orders.forEach((order) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${order.id}</td>
        <td>${formatDate(order.createdAt)}</td>
        <td>${order.status}</td>
        <td>${order.total ?? ''} ${order.currency || ''}</td>
      `;
      ordersBody.appendChild(tr);
    });
  };

  const fillAccount = (user) => {
    if (!user) return;
    const { firstName, lastName, email } = user;
    if ($('firstName')) $('firstName').value = firstName || '';
    if ($('lastName')) $('lastName').value = lastName || '';
    if ($('email')) $('email').value = email || '';
  };

  const fillAddress = (address) => {
    if (!address) return;
    if ($('addrName')) $('addrName').value = address.name || '';
    if ($('addrPhone')) $('addrPhone').value = address.phone || '';
    if ($('addrLine1')) $('addrLine1').value = address.line1 || '';
    if ($('addrLine2')) $('addrLine2').value = address.line2 || '';
    if ($('addrCity')) $('addrCity').value = address.city || '';
    if ($('addrState')) $('addrState').value = address.state || '';
    if ($('addrZip')) $('addrZip').value = address.zip || '';
    if ($('addrCountry')) $('addrCountry').value = address.country || '';
  };

  const handleAuthRedirect = (err) => {
    if (err?.status === 401 || err?.status === 403) {
      try { localStorage.setItem('cronox_open_auth_on_load', 'login'); } catch (_) {}
      window.location.href = 'index.html';
      return true;
    }
    return false;
  };

  const loadOrders = async () => {
    if (!api.getMyOrders) return;
    try {
      const orders = await api.getMyOrders();
      renderOrders(orders);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudieron cargar los pedidos', err);
      renderOrders([]);
    }
  };

  const loadAddress = async () => {
    if (!api.getDefaultAddress) return;
    try {
      const address = await api.getDefaultAddress();
      if (address) fillAddress(address);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar la dirección', err);
    }
  };

  const loadProfile = async () => {
    if (!api.getMe) return;
    try {
      const user = await api.getMe();
      if (!user) throw new Error('Usuario no autenticado');
      window.CRONOX_USER = user;
      fillAccount(user);
      await Promise.all([loadAddress(), loadOrders()]);
    } catch (err) {
      if (handleAuthRedirect(err)) return;
      console.warn('[PROFILE] No se pudo cargar el perfil', err);
      showMessage('No se pudo cargar tu perfil. Inténtalo de nuevo más tarde.', 'error');
    }
  };

  const bindAccountForm = () => {
    const form = $('accountForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!api.updateMe) return;
      const payload = {
        firstName: optionalValue('firstName'),
        lastName: optionalValue('lastName'),
        email: optionalValue('email'),
      };
      try {
        const updated = await api.updateMe(payload);
        window.CRONOX_USER = updated;
        fillAccount(updated);
        showMessage('Datos actualizados correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar cuenta', err);
        const msg = err?.payload?.message || err?.message || 'No se pudieron guardar los cambios.';
        showMessage(msg, 'error');
      }
    });
  };

  const bindAddressForm = () => {
    const form = $('addressForm');
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!api.upsertAddress) return;
      const payload = {
        name: requiredValue('addrName'),
        phone: optionalValue('addrPhone'),
        line1: requiredValue('addrLine1'),
        line2: optionalValue('addrLine2'),
        city: requiredValue('addrCity'),
        state: optionalValue('addrState'),
        zip: requiredValue('addrZip'),
        country: requiredValue('addrCountry'),
      };

      if (!payload.name || !payload.line1 || !payload.city || !payload.zip || !payload.country) {
        showMessage('Completa los campos obligatorios de la dirección.', 'error');
        return;
      }

      try {
        const address = await api.upsertAddress(payload);
        fillAddress(address);
        showMessage('Dirección guardada correctamente.', 'success');
      } catch (err) {
        if (handleAuthRedirect(err)) return;
        console.error('[PROFILE] Error al guardar dirección', err);
        const msg = err?.payload?.message || err?.message || 'No se pudo guardar la dirección.';
        showMessage(msg, 'error');
      }
    });
  };

  const bindActions = () => {
    $('btnFavorites')?.addEventListener('click', () => { window.location.href = 'favorites.html'; });
    $('btnBackToStore')?.addEventListener('click', () => { window.location.href = 'index.html'; });
    $('btnLogoutProfile')?.addEventListener('click', async () => {
      try {
        if (api.logout) await api.logout();
      } catch (err) {
        console.warn('[PROFILE] logout error', err);
      }
      window.CRONOX_USER = null;
      window.location.href = 'index.html';
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindAccountForm();
    bindAddressForm();
    bindActions();
    loadProfile();
  });
})();
