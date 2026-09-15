(() => {
  const ADMIN_ROLES = new Set(['SUPERADMIN', 'ADMIN']);
  const isAdmin = (user) => ADMIN_ROLES.has(user?.role);

  const safeReturnTo = (candidate) => {
    if (!candidate) return '/admin.html';
    try {
      const url = new URL(candidate, window.location.origin);
      if (url.origin !== window.location.origin) return '/admin.html';
      if (url.pathname === '/admin' || url.pathname === '/admin/') {
        return `/admin.html${url.hash}`;
      }
      if (!['/admin.html', '/admin-user.html'].includes(url.pathname)) {
        return '/admin.html';
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return '/admin.html';
    }
  };

  const currentReturnTo = () =>
    safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);

  const loginUrl = (returnTo = currentReturnTo()) =>
    `/admin-login.html?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;

  const redirectToLogin = (returnTo) => {
    window.location.replace(loginUrl(returnTo));
  };

  window.CRONOX_ADMIN_AUTH = Object.freeze({
    currentReturnTo, isAdmin, loginUrl, redirectToLogin, safeReturnTo,
  });
})();
