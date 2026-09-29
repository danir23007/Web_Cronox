(() => {
  const root = document.documentElement;
  const key = 'cronox.admin.theme';
  let theme = 'light';
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch {}
  root.dataset.adminTheme = theme;
  const sync = () => document.querySelectorAll('.admin-theme-toggle').forEach(button => {
    button.setAttribute('aria-checked', String(root.dataset.adminTheme === 'dark'));
    button.title = root.dataset.adminTheme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  });
  const install = () => {
    const header = document.querySelector('.admin-header') || document.querySelector('.admin-login');
    if (!header || header.querySelector('.admin-theme-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'admin-theme-toggle'; button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', 'Modo oscuro');
    button.innerHTML = '<span aria-hidden="true">☀</span><span aria-hidden="true">☾</span><i aria-hidden="true"></i>';
    const mark = header.querySelector('.admin-header-mark');
    if (mark) header.insertBefore(button, mark); else header.append(button);
    button.addEventListener('click', () => {
      root.dataset.adminTheme = root.dataset.adminTheme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, root.dataset.adminTheme); } catch {}
      sync();
    });
    sync();
  };
  window.addEventListener('storage', event => { if(event.key === key) {root.dataset.adminTheme = event.newValue === 'dark' ? 'dark' : 'light';sync();} });
  document.addEventListener('DOMContentLoaded', () => {
    install();
    const observed = new Set();
    const updateScroll = wrapper => {
      const scrollable = wrapper.clientWidth > 0 && wrapper.scrollWidth > wrapper.clientWidth + 1;
      wrapper.classList.toggle('is-scrollable', scrollable);
      if (scrollable) { wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', 'Tabla desplazable horizontalmente. Usa las flechas para ver todas las columnas.'); }
      else { wrapper.removeAttribute('tabindex'); wrapper.removeAttribute('role'); wrapper.removeAttribute('aria-label'); }
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => entries.forEach(({target}) => {
      const wrapper = target.closest('.admin-table-scroll'); if (wrapper) updateScroll(wrapper);
    })) : null;
    const wrapTables = () => {
      for (const node of observed) if (!node.isConnected) { resize?.unobserve(node); observed.delete(node); }
      document.querySelectorAll('.cronox-admin table').forEach(table => {
        if (table.closest('.mail-stage,.key-composition')) return;
        let wrapper = table.closest('.admin-table-scroll');
        if (!wrapper) {
          if (/auto|scroll/.test(getComputedStyle(table.parentElement).overflowX)) wrapper = table.parentElement;
          else { wrapper = document.createElement('div'); table.before(wrapper); wrapper.append(table); }
          wrapper.classList.add('admin-table-scroll');
        }
        for (const node of [wrapper, table]) if (!observed.has(node)) { observed.add(node); resize?.observe(node); }
        updateScroll(wrapper);
      });
    };
    wrapTables(); new MutationObserver(wrapTables).observe(document.body,{childList:true,subtree:true});
  },{once:true});
})();
