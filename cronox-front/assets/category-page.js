(function () {
  try {
    var categorySlug = (new URL(window.location.href).searchParams.get('categorySlug') || '')
      .trim()
      .toLowerCase();
    if (categorySlug && categorySlug.length <= 140 && /^[a-z0-9#-]+$/.test(categorySlug)) {
      document.documentElement.classList.add('category-page');
    }
  } catch {}
})();
