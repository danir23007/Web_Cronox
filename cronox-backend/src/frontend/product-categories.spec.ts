import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('product category frontend contracts', () => {
  const storefrontPages = [
    'index.html',
    'producto.html',
    'checkout.html',
    'favorites.html',
    'profile.html',
  ];

  it.each(storefrontPages)('%s uses the shared category navigation', (file) => {
    const html = readFrontend(file);
    expect(html).toContain('id="btnMenu"');
    expect(html).not.toContain('<aside id="filtersPanel"');
    const shared = readFrontend('assets/app.js');
    for (const slug of [
      'novedades',
      'camisetas',
      'chaquetas',
      'pantalones',
      'complementos',
    ]) {
      expect(shared).toContain(`/tienda?categorySlug=${slug}#store`);
    }
  });

  it('keeps category navigation out of the cart page while preserving the shared checkout opener', () => {
    const cart = readFrontend('cart.html');
    expect(cart).not.toContain('id="btnMenu"');
    expect(cart).not.toContain('id="filtersPanel"');
    const html = readFrontend('checkout.html');
    expect(html).not.toContain('categorySlug=');
    expect(html).toContain('id="btnMenu"');
    expect(html).toContain('class="checkout-brand"');
    expect(html).toContain('id="cart-icon-btn"');
  });

  it('uses the public category endpoint and preserves the unfiltered catalogue path', () => {
    const products = readFrontend('assets/products.js');
    const apiSource = readFrontend('src/admin/api.ts');

    expect(products).toContain(
      'currentApi.getCategoryProducts(requestedCategorySlug',
    );
    expect(products).toContain('currentApi.getProducts(query)');
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
    expect(products).toContain('/producto/${encodeURIComponent(key)}');
  });

  it('keeps category management in the Product sidebar and removes the old header action', () => {
    const dom = new JSDOM(readFrontend('admin.html'), { runScripts: 'outside-only' });
    dom.window.eval(readFrontend('assets/admin-navigation.js'));
    const document = dom.window.document;
    expect(document.querySelector('#navProducto [data-nav-target="section-products"]')?.textContent).toBe('Productos');
    expect(document.querySelector('#navProducto [data-nav-target="section-product-categories"]')?.textContent).toBe('Categorías');
    expect(document.querySelector('#section-products [data-nav-target="section-product-categories"]')).toBeNull();
    expect(document.querySelector('#section-product-categories')).not.toBeNull();
    expect(document.querySelector('#section-product-categories [data-back-target]')?.getAttribute('data-back-target')).toBe('section-dashboard');
    dom.window.close();
  });

  it('renders assignments, sends selected IDs, restores failures and implements all filters', () => {
    const admin = readFrontend('assets/admin.js');
    expect(admin).toContain('assignedCategoryIds(product)');
    expect(admin).toContain('updateAssignments(productId, selectedIds)');
    expect(admin).toContain('Las selecciones siguen disponibles para reintentar.');
    expect(admin).toContain('variant?.sku');
    expect(admin).toContain("assignmentState === 'unassigned'");
    expect(admin).toContain("activeState === 'inactive'");
  });

  it('places the compact live status in the section header with a mobile layout', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');

    expect(html).toContain('class="category-section-header"');
    expect(html).toContain(
      'id="categoryAssignmentsMessage" class="message" role="status" aria-live="polite"',
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
      'categoryAssignmentsState.drafts.get(productId)',
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
