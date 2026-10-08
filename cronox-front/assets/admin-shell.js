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
  // Inline panels move headers. Only real pointer movement changes hover intent.
  // There is no stored menu state; only route selection initializes the pinned group.
  const hover = window.matchMedia('(hover: hover) and (pointer: fine)');
  let pinned = null, temporary = null;
  let pointer = null, intentRect = null, suppressed = null;
  const groups = [...sidebar.querySelectorAll('.sidebar-group')].map(button => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const zone = document.createElement('div');
    zone.className = 'sidebar-group-zone';
    button.before(zone); zone.append(button, panel);
    button.type = 'button';
    return { button, panel, zone };
  });
  // Nested disclosures belong to their principal zone and never compete with it.
  const subgroups = [...sidebar.querySelectorAll('.sidebar-subgroup')].map(button => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const zone = document.createElement('div');
    zone.className = 'sidebar-subgroup-zone';
    button.before(zone); zone.append(button, panel);
    const state = { pinned: false, temporary: false, suppressed: false, intentRect: null };
    const setOpen = open => {
      state.pinned = open; state.temporary = false; state.suppressed = !open;
      render();
    };
    const render = () => {
      const open = state.pinned || state.temporary;
      if (button.getAttribute('aria-expanded') !== String(open)) button.setAttribute('aria-expanded', String(open));
      if (panel.hidden === open) panel.hidden = !open;
    };
    button.addEventListener('click', () => {
      state.intentRect = zone.getBoundingClientRect();
      setOpen(!state.pinned); renderGroups();
    });
    zone.addEventListener('focusin', event => {
      if (panel.contains(event.target)) { state.temporary = true; render(); }
    });
    zone.addEventListener('focusout', () => queueMicrotask(() => {
      if (!zone.contains(document.activeElement) && !zone.matches(':hover')) { state.temporary = false; render(); }
    }));
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      button.focus(); setOpen(false);
    });
    return { button, panel, zone, state, render, setOpen };
  });
  const renderGroups = () => {
    const visible = temporary || pinned;
    const setOpen = (group, open) => {
      if (group.button.getAttribute('aria-expanded') !== String(open)) group.button.setAttribute('aria-expanded', String(open));
      if (group.panel.hidden === open) group.panel.hidden = !open;
    };
    groups.filter(group => group !== visible).forEach(group => setOpen(group, false));
    if (visible) setOpen(visible, true);
  };
  const containsPoint = (rect, point) => rect && point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
  document.addEventListener('pointermove', event => {
    if (!hover.matches || event.pointerType !== 'mouse') return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointer && next.x === pointer.x && next.y === pointer.y) return;
    pointer = next;
    // Process nested intent even while the pointer remains in its parent zone.
    subgroups.forEach(subgroup => {
      const { zone, state, render } = subgroup;
      const live = zone.getBoundingClientRect();
      const inside = zone.getClientRects().length && containsPoint(live, next);
      const transit = state.intentRect && {
        left: Math.min(state.intentRect.left, live.left), right: Math.max(state.intentRect.right, live.right),
        top: Math.min(state.intentRect.top, live.top), bottom: Math.max(state.intentRect.bottom, live.bottom),
      };
      if (inside) {
        if (!state.suppressed) { state.temporary = true; state.intentRect = null; }
      } else if (!containsPoint(transit, next)) {
        state.temporary = false; state.suppressed = false; state.intentRect = null;
      }
      render();
    });
    // The pre-layout hit region and the live zone belong to the same intent.
    // A header moving under a stationary pointer cannot start a hover cascade.
    const owner = suppressed || temporary;
    if (owner) {
      const live = owner.zone.getBoundingClientRect();
      if (containsPoint(live, next)) { if (!suppressed) intentRect = null; return; }
      // Keep the transit corridor until the pointer reaches the displaced zone.
      const transit = !suppressed && intentRect ? {
        left: Math.min(intentRect.left, live.left), right: Math.max(intentRect.right, live.right),
        top: Math.min(intentRect.top, live.top), bottom: Math.max(intentRect.bottom, live.bottom),
      } : intentRect;
      if (containsPoint(transit, next)) return;
    }
    suppressed = null; intentRect = null;
    const target = document.elementFromPoint(next.x, next.y);
    const group = groups.find(item => item.zone.contains(target)) || null;
    if (temporary === group) return;
    intentRect = group?.zone.getBoundingClientRect() || null;
    temporary = group;
    renderGroups();
  });
  const leavePointer = () => {
    pointer = null; intentRect = null; suppressed = null; temporary = null;
    subgroups.forEach(({ state, render }) => { state.temporary = false; state.suppressed = false; state.intentRect = null; render(); });
    renderGroups();
  };
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) leavePointer(); });
  window.addEventListener('blur', leavePointer);
  groups.forEach(group => {
    group.button.addEventListener('click', () => {
      intentRect = group.button.getBoundingClientRect();
      pinned = pinned === group ? null : group;
      temporary = null;
      // A click closing the pinned group wins over hover until the pointer leaves.
      suppressed = pinned ? null : group;
      renderGroups();
    });
    group.zone.addEventListener('focusin', event => {
      if (group.panel.contains(event.target)) { temporary = group; renderGroups(); }
    });
    group.zone.addEventListener('focusout', () => queueMicrotask(() => {
      if (!group.zone.contains(document.activeElement) && !group.zone.matches(':hover') && temporary === group) { temporary = null; renderGroups(); }
    }));
    group.panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      temporary = null; if (pinned === group) pinned = null;
      suppressed = group; intentRect = group.button.getBoundingClientRect(); group.button.focus(); renderGroups();
    });
    group.panel.addEventListener('click', event => {
      if (!event.target.closest('[data-nav-target],a[href]')) return;
      pinned = group; temporary = null; suppressed = null; intentRect = null;
      renderGroups();
    }, true);
  });
  hover.addEventListener('change', leavePointer);
  renderGroups();
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
    if (el.closest('.finance-root,.map-filters,.filters-panel,.filter-bar,.pagination,.mail-filters,.mail-folder-filter')) return null;
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
  const release = container => {
    for (const root of snapshots.keys()) if (root === container || container?.contains(root)) snapshots.delete(root);
    for (const root of dirty.keys()) if (root === container || container?.contains(root)) dirty.delete(root);
  };
  document.addEventListener('cronox:admin-saved', event => clear(event.detail?.container || null));
  document.addEventListener('reset', event => clear(event.target));
  const hasDirty = () => hasSnapshotChanges() || [...dirty].some(([container, fields]) => container.getClientRects().length && [...fields].some(el => el.isConnected && (!el.dataset.adminInitialSet || valueOf(el) !== el._adminInitial)) && (container.closest('.modal') ? container.closest('.modal').classList.contains('show') : !container.closest('.admin-section')?.hidden)) || !!window.CRONOX_ADMIN_MEDIA?.hasUnsavedChanges?.() || !!window.CRONOX_ADMIN_GALLERY?.hasUnsavedChanges?.() || !!window.CRONOX_NEWSLETTER_ADMIN?.hasUnsavedChanges?.() || !!window.CRONOX_INVENTORY?.hasUnsavedChanges?.() || !!window.CRONOX_INBOX?.hasUnsavedChanges?.() || !!window.CRONOX_CATEGORY_ASSIGNMENTS?.hasUnsavedChanges?.();
  const canLeave = (destination) => {
    if (destination === 'section-gallery') destination = 'section-gallery-mosaic';
    if (destination === current) return true;
    if (hasDirty() && !window.confirm('Tienes cambios sin guardar. ¿Quieres salir y descartarlos?')) return false;
    clear();
    window.CRONOX_ADMIN_MEDIA?.discard?.();
    window.CRONOX_ADMIN_GALLERY?.discard?.();
    window.CRONOX_NEWSLETTER_ADMIN?.discard?.();
    window.CRONOX_INBOX?.discard?.();
    window.CRONOX_CATEGORY_ASSIGNMENTS?.discard?.();
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
    const alias = { 'section-products-menu':'section-products', 'section-23':'section-circles-menu', 'section-34':'section-circles-menu', 'section-user':'section-users' };
    sidebar.querySelectorAll('[data-nav-target]').forEach(button => {
      if (button.dataset.navTarget === (alias[destination] || destination)) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    const active = sidebar.querySelector('[aria-current="page"]');
    const group = groups.find(item => item.panel.contains(active));
    if (group) pinned = group;
    subgroups.forEach(item => { if (item.panel.contains(active)) item.setOpen(true); });
    temporary = null;
    intentRect = null; suppressed = null;
    renderGroups();
    document.getElementById('adminBreadcrumb').textContent = active?.textContent.trim() || 'Administración';
    closeDrawer();
  };
  const hasSnapshotChanges = () => [...snapshots].some(([container, snapshot]) => container.isConnected && container.getClientRects().length && snapshot.read() !== snapshot.initial);
  window.CRONOX_ADMIN_SHELL = { canLeave, select, clear, capture, release, hasDirty };
})();
