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
    const wrapTables = () => document.querySelectorAll('.admin-main table').forEach(table => {
      if (table.closest('.admin-table-scroll,.mail-stage,.key-composition') || /auto|scroll/.test(getComputedStyle(table.parentElement).overflowX)) return;
      const wrapper = document.createElement('div'); wrapper.className = 'admin-table-scroll';
      table.before(wrapper); wrapper.append(table);
    });
    wrapTables(); new MutationObserver(wrapTables).observe(document.body,{childList:true,subtree:true});
  },{once:true});
})();
