(function (globalScope) {
  'use strict';

  const PAGE_SIZES = Object.freeze({
    inventory: 50,
    products: 50,
    promoCodes: 50,
    activity: 100,
    users: 100,
  });

  const pageCount = (totalItems, pageSize) => {
    const size = Math.max(1, Number(pageSize) || 1);
    return Math.max(1, Math.ceil(Math.max(0, Number(totalItems) || 0) / size));
  };

  const apply = ({ info, prev, next, page, pageSize, totalItems }) => {
    const totalPages = pageCount(totalItems, pageSize);
    const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    if (info) {
      info.textContent = `Página ${currentPage} de ${totalPages} · ${Math.max(0, Number(totalItems) || 0)} resultados`;
    }
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= totalPages;
    const controls = prev?.closest('.page-controls') || next?.closest('.page-controls');
    if (controls) controls.hidden = totalPages <= 1;
    return { page: currentPage, totalPages };
  };

  globalScope.CRONOX_ADMIN_PAGINATION = Object.freeze({ PAGE_SIZES, pageCount, apply });
})(window);
