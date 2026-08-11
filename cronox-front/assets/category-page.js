(function () {
  try {
    var categorySlug = (new URL(window.location.href).searchParams.get('categorySlug') || '')
      .trim()
      .toLowerCase();
    var recognizedCategories = ['novedades', 'camisetas', 'chaquetas', 'pantalones', 'complementos'];

    if (recognizedCategories.indexOf(categorySlug) !== -1) {
      document.documentElement.classList.add('category-page');
    }
  } catch {}
})();
