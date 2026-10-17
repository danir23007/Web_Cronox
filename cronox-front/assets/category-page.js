(function () {
  try {
    var url = new URL(window.location.href);
    var categorySlug = (url.searchParams.get('categorySlug') || '')
      .trim()
      .toLowerCase();
    // /tienda is the catalogue view, including Todos without a category slug.
    if (/^\/tienda\/?$/.test(url.pathname) ||
        (categorySlug && categorySlug.length <= 140 && /^[a-z0-9#-]+$/.test(categorySlug))) {
      document.documentElement.classList.add('category-page');
    }
  } catch {}
})();
