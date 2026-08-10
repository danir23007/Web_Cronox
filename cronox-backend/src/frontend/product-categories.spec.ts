import { readFileSync } from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('product category frontend contracts', () => {
  const storefrontPages = [
    'index.html',
    'producto.html',
    'cart.html',
    'checkout.html',
    'favorites.html',
    'profile.html',
  ];

  it.each(storefrontPages)('%s has all five real category links', (file) => {
    const html = readFrontend(file);
    for (const slug of [
      'novedades',
      'camisetas',
      'chaquetas',
      'pantalones',
      'complementos',
    ]) {
      expect(html).toContain(`index.html?categorySlug=${slug}#store`);
    }
  });

  it('uses the public category endpoint and preserves the unfiltered catalogue path', () => {
    const products = readFrontend('assets/products.js');
    const apiSource = readFrontend('src/admin/api.ts');

    expect(products).toContain('API.getCategoryProducts(initialCategorySlug');
    expect(products).toContain('API.getProducts(query)');
    expect(products).toContain(
      'No hay productos disponibles en esta categoría.',
    );
    expect(products).toContain('catalogLoadError');
    expect(apiSource).toContain(
      '/api/categories/${encodeURIComponent(slug)}/products',
    );
  });

  it('keeps the product cards and their quick-add, favorites and detail navigation', () => {
    const products = readFrontend('assets/products.js');
    expect(products).toContain('openQuickAdd(p)');
    expect(products).toContain('CRONOX_FAVORITES.toggleFromButton');
    expect(products).toContain('/producto.html?slug=');
  });

  it('defines the Products submenu, both child screens and their parent back target', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain('data-nav-target="section-products-menu"');
    expect(html).toContain(
      'data-nav-target="section-products">Edición de productos',
    );
    expect(html).toContain(
      'data-nav-target="section-product-categories">Categorías de productos',
    );
    expect(admin).toContain(
      "btn.setAttribute('data-back-target', 'section-products-menu')",
    );
  });

  it('renders assignments, sends selected IDs, restores failures and implements all filters', () => {
    const admin = readFrontend('assets/admin.js');
    expect(admin).toContain('assignedCategoryIds(product)');
    expect(admin).toContain('updateAssignments(productId, selectedIds)');
    expect(admin).toContain('Se ha restaurado la asignación anterior.');
    expect(admin).toContain('variant?.sku');
    expect(admin).toContain("assignmentState === 'unassigned'");
    expect(admin).toContain("activeState === 'inactive'");
  });

  it('places the compact live status in the section header with a mobile layout', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain('class="category-section-header"');
    expect(html).toContain(
      'id="categoryAssignmentsMessage" class="message category-screen-status" role="status" aria-live="polite"',
    );
    expect(html).toContain('.category-screen-status {');
    expect(html).toContain('margin: 0 0 0 auto');
    expect(html).toContain(
      '.category-section-header { display: grid; grid-template-columns: 1fr; }',
    );
    expect(admin).toContain(
      "setCategoryAssignmentsMessage('Clasificación cargada.', 'success', true)",
    );
    expect(admin).toContain("type === 'success' && autoHide");
  });

  it('uses an accessible multi-category checkbox dropdown with intersection matching', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).not.toContain('<select id="categoryFilter"');
    expect(html).toContain('id="categoryFilterToggle"');
    expect(html).toContain(
      'aria-expanded="false" aria-controls="categoryFilterPanel"',
    );
    expect(html).toContain('id="categoryFilterClear"');
    expect(admin).toContain('selectedFilterCategoryIds: new Set()');
    expect(admin).toContain('Array.from(selectedCategoryIds).every');
    expect(admin).toContain('ids.includes(categoryId)');
    expect(admin).toContain('selectedFilterCategoryIds.clear()');
    expect(admin).toContain("event.key === 'Escape'");
    expect(admin).toContain('!categoryFilterDropdown.contains(event.target)');
    expect(admin).toContain("categoryFilterOptions?.addEventListener('change'");
    expect(admin).toContain(
      "card.querySelectorAll('.category-checkbox input:checked')",
    );
  });

  it('uses a section-specific white contain thumbnail with a load-error fallback', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain('.category-product__image-frame {');
    expect(html).toContain('background: #ffffff');
    expect(html).toContain('object-fit: contain');
    expect(html).toContain('object-position: center');
    expect(admin).toContain('category-product__image-fallback');
    expect(admin).toContain("categoryAssignmentList?.addEventListener('error'");
  });
});
