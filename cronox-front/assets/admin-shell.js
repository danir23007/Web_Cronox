(() => {
  'use strict';
  const sidebar = document.getElementById('adminSidebar');
  if (!sidebar) return;
  const toggle = document.getElementById('sidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');
  const mobile = window.matchMedia('(max-width: 800px)');
  const syncInert = () => { sidebar.inert = mobile.matches && !document.body.classList.contains('sidebar-open'); };
  let current = 'section-dashboard';
  const dirty = new Map();
  const snapshots = new Map();
  const closeDrawer = () => { document.body.classList.remove('sidebar-open'); toggle.setAttribute('aria-expanded', 'false'); backdrop.hidden = true; syncInert(); };
  mobile.addEventListener('change', syncInert); syncInert();
  toggle.addEventListener('click', () => {
    const open = !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open); toggle.setAttribute('aria-expanded', String(open)); backdrop.hidden = !open;
    syncInert();
    if (open) sidebar.querySelector('a,button')?.focus();
  });
  backdrop.addEventListener('click', () => { closeDrawer(); toggle.focus(); });
  sidebar.querySelectorAll('.sidebar-group').forEach(button => button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { closeDrawer(); toggle.focus(); }
    if (event.key === 'Tab' && document.body.classList.contains('sidebar-open')) {
      const nodes = [...sidebar.querySelectorAll('a,button')].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  const valueOf = el => el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.isContentEditable ? el.innerHTML : el.value;
  const editContainer = el => {
    if (el.closest('.finance-root,.filters-panel,.filter-bar,.pagination')) return null;
    return el.closest('form,.modal,#section-inventory,#section-product-categories,#section-key-screen,#section-newsletter,#section-footer');
  };
  document.addEventListener('focusin', event => {
    const el = event.target;
    if (el.matches('input,textarea,select,[contenteditable="true"]') && editContainer(el) && !el.dataset.adminInitialSet) { el.dataset.adminInitialSet = 'true'; el._adminInitial = valueOf(el); }
  });
  const track = event => {
    const el = event.target, container = editContainer(el);
    if (!container || !el.matches('input,textarea,select,[contenteditable="true"]')) return;
    if (!dirty.has(container)) dirty.set(container, new Set());
    if (!el.dataset.adminInitialSet || valueOf(el) !== el._adminInitial) dirty.get(container).add(el);
    else dirty.get(container).delete(el);
  };
  document.addEventListener('input', track);
  document.addEventListener('change', track);
  const clear = (container) => {
    for (const [root, snapshot] of snapshots) if (!container || container === root || container.contains(root)) snapshot.initial = snapshot.read();
    for (const [root, fields] of dirty) {
      fields.forEach(el => { if (!container || container === root || container.contains(el)) { el._adminInitial = valueOf(el); el.dataset.adminInitialSet = 'true'; fields.delete(el); } });
      if (!fields.size) dirty.delete(root);
    }
  };
  const capture = (container, read) => {
    if (!container) return;
    clear(container);
    container.querySelectorAll('input,textarea,select,[contenteditable="true"]').forEach(el => { el._adminInitial = valueOf(el); el.dataset.adminInitialSet = 'true'; });
    if (read) snapshots.set(container, { read, initial: read() });
  };
  // Modules emit this only after a successful save (never on submit or upload).
  document.addEventListener('cronox:admin-saved', event => clear(event.detail?.container || null));
  document.addEventListener('reset', event => clear(event.target));
  const hasDirty = () => hasSnapshotChanges() || [...dirty].some(([container, fields]) => container.getClientRects().length && [...fields].some(el => el.isConnected && (!el.dataset.adminInitialSet || valueOf(el) !== el._adminInitial)) && (container.closest('.modal') ? container.closest('.modal').classList.contains('show') : !container.closest('.admin-section')?.hidden)) || !!window.CRONOX_ADMIN_MEDIA?.hasUnsavedChanges?.() || !!window.CRONOX_ADMIN_GALLERY?.hasUnsavedChanges?.() || !!window.CRONOX_NEWSLETTER_ADMIN?.hasUnsavedChanges?.() || !!window.CRONOX_INVENTORY?.hasUnsavedChanges?.();
  const canLeave = (destination) => {
    if (destination === 'section-gallery') destination = 'section-gallery-mosaic';
    if (destination === current) return true;
    if (hasDirty() && !window.confirm('Tienes cambios sin guardar. ¿Quieres salir y descartarlos?')) return false;
    clear();
    window.CRONOX_ADMIN_MEDIA?.discard?.();
    window.CRONOX_ADMIN_GALLERY?.discard?.();
    window.CRONOX_NEWSLETTER_ADMIN?.discard?.();
    window.CRONOX_INVENTORY?.discard?.();
    document.querySelectorAll('.modal.show').forEach(modal => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); });
    document.body.style.overflow = '';
    return true;
  };
  window.addEventListener('beforeunload', event => { if (hasDirty()) { event.preventDefault(); event.returnValue = ''; } });
  [document.getElementById('backBtn'), document.getElementById('logoutBtn')].forEach(button => button?.addEventListener('click', event => {
    if (!canLeave('outside')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true));
  const select = destination => {
    current = destination;
    const alias = { 'section-product-categories':'section-products', 'section-products-menu':'section-products', 'section-23':'section-circles-menu', 'section-34':'section-circles-menu', 'section-user':'section-users' };
    sidebar.querySelectorAll('[data-nav-target]').forEach(button => {
      if (button.dataset.navTarget === (alias[destination] || destination)) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const active = sidebar.querySelector('[aria-current="page"]');
    document.getElementById('adminBreadcrumb').textContent = active?.textContent.trim() || 'Administración';
    closeDrawer();
  };
  const hasSnapshotChanges = () => [...snapshots].some(([container, snapshot]) => container.isConnected && container.getClientRects().length && snapshot.read() !== snapshot.initial);
  window.CRONOX_ADMIN_SHELL = { canLeave, select, clear, capture, hasDirty };
})();
