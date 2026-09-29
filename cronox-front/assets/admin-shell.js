(() => {
  'use strict';
  const sidebar = document.getElementById('adminSidebar');
  if (!sidebar) return;
  const toggle = document.getElementById('sidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');
  const mobile = window.matchMedia('(max-width: 800px)');
  const syncInert = () => { sidebar.inert = mobile.matches && !document.body.classList.contains('sidebar-open'); };
  const main = document.querySelector('.admin-main');
  let drawerOverflow = null;
  let current = 'section-dashboard';
  const dirty = new Map();
  const snapshots = new Map();
  const closeDrawer = () => {
    const wasOpen = document.body.classList.contains('sidebar-open');
    document.body.classList.remove('sidebar-open'); toggle.setAttribute('aria-expanded', 'false'); backdrop.hidden = true;
    if (main) main.inert = false;
    if (drawerOverflow !== null) { document.body.style.overflow = drawerOverflow; drawerOverflow = null; }
    syncInert();
    if (wasOpen && mobile.matches && sidebar.contains(document.activeElement)) toggle.focus();
  };
  const closeButton = document.createElement('button');
  closeButton.type = 'button'; closeButton.className = 'sidebar-close'; closeButton.textContent = 'Cerrar menú';
  sidebar.prepend(closeButton);
  closeButton.addEventListener('click', closeDrawer);
  mobile.addEventListener('change', closeDrawer); syncInert();
  toggle.addEventListener('click', () => {
    const open = !document.body.classList.contains('sidebar-open');
    if (!open) { closeDrawer(); return; }
    drawerOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (main) main.inert = true;
    document.body.classList.add('sidebar-open'); toggle.setAttribute('aria-expanded', 'true'); backdrop.hidden = false;
    syncInert();
    if (open) sidebar.querySelector('a,button')?.focus();
  });
  backdrop.addEventListener('click', () => { closeDrawer(); toggle.focus(); });
  // Keep keyboard focus in the existing dialogs, using each module's own cancel action.
  const modalTriggers = new Map();
  const focusable = root => [...root.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')]
    .filter(node => node.getClientRects().length && !node.disabled && node.tabIndex >= 0);
  const syncModal = modal => {
    if (modal.classList.contains('show')) {
      if (modalTriggers.has(modal)) return;
      modalTriggers.set(modal, document.activeElement);
      modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
      const heading = modal.querySelector('h2[id],h3[id]');
      if (heading && !modal.hasAttribute('aria-labelledby')) modal.setAttribute('aria-labelledby', heading.id);
      if (!modal.contains(document.activeElement)) focusable(modal)[0]?.focus();
    } else if (modalTriggers.has(modal)) {
      const trigger = modalTriggers.get(modal); modalTriggers.delete(modal);
      if (trigger?.isConnected && (modal.contains(document.activeElement) || document.activeElement === document.body)) trigger.focus();
    }
  };
  const modalObserver = new MutationObserver(records => records.forEach(({target}) => syncModal(target)));
  document.querySelectorAll('.modal').forEach(modal => modalObserver.observe(modal, { attributes:true, attributeFilter:['class'] }));
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    const modal = [...document.querySelectorAll('.modal.show')].at(-1);
    if (!modal) return;
    const nodes = focusable(modal), first = nodes[0], last = nodes.at(-1);
    if (event.key === 'Tab' && first) {
      if (!modal.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    }
    if (event.key === 'Escape' && !modal.querySelector('details[open]')) {
      const cancel = modal.querySelector('#productCancelBtn,#codeCancelBtn,#orderDetailClose,#notesModalClose');
      if (cancel && !cancel.disabled) { event.preventDefault(); cancel.click(); }
    }
  });
  sidebar.querySelectorAll('.sidebar-group').forEach(button => button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { closeDrawer(); toggle.focus(); }
    if (event.key === 'Tab' && document.body.classList.contains('sidebar-open')) {
      const nodes = [...sidebar.querySelectorAll('a,button')].filter(node => node.getClientRects().length && !node.disabled);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!sidebar.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
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
