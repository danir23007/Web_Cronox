import { readFileSync } from 'node:fs';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');
const readFrontend = (file: string) =>
  readFileSync(path.join(frontendRoot, file), 'utf8');

describe('storefront search contracts', () => {
  it('debounces live suggestions and rejects stale responses', () => {
    const app = readFrontend('assets/app.js');

    expect(app).toContain('window.setTimeout(loadSearchSuggestions, 250)');
    expect(app).toContain("typeof API.getProductSuggestions !== 'function'");
    expect(app).toContain('requestId !== searchRequestSequence');
    expect(app).toContain('if (!query) {');
    expect(app).toContain('searchSuggestionItems = []');
  });

  it('implements an accessible keyboard-operated combobox', () => {
    const app = readFrontend('assets/app.js');

    for (const attribute of [
      "setAttribute('role', 'combobox')",
      "setAttribute('aria-expanded', 'false')",
      "setAttribute('aria-controls', listId)",
      "setAttribute('aria-activedescendant', option.id)",
      "setAttribute('role', 'listbox')",
      "setAttribute('role', 'option')",
    ]) {
      expect(app).toContain(attribute);
    }
    expect(app).toContain("e.key === 'ArrowDown'");
    expect(app).toContain("e.key === 'ArrowUp'");
    expect(app).toContain("e.key === 'Enter'");
    expect(app).toContain("e.key === 'Escape'");
    expect(app).toContain('!searchForm.contains(e.target)');
  });

  it('uses white contained thumbnails and the existing product detail route', () => {
    const app = readFrontend('assets/app.js');
    const css = readFrontend('assets/store.css');
    const suggestionRenderer = app.slice(
      app.indexOf('const renderSearchSuggestions ='),
      app.indexOf('const loadSearchSuggestions ='),
    );

    expect(css).toContain('.search-suggestions__thumbnail{');
    expect(css).toContain('background:#fff');
    expect(css).toContain('object-fit:contain');
    expect(app).toContain('/producto.html?slug=');
    expect(app).toContain("fallback.textContent = 'Sin imagen'");
    expect(suggestionRenderer).toContain('details.append(name, price)');
    expect(suggestionRenderer).toContain(
      "price.textContent = product.priceLabel || ''",
    );
    expect(suggestionRenderer).not.toContain('categoryName');
    expect(css).toContain('.search-suggestions__price{');
  });

  it('loads URL-backed full results through the existing grid', () => {
    const products = readFrontend('assets/products.js');

    expect(products).toContain('url.searchParams.get("search")');
    expect(products).toContain("nextUrl.searchParams.set('search', query)");
    expect(products).toContain(
      'API.getProductsPage({ search, page, limit: 100 })',
    );
    expect(products).toContain('API.getCategoryProducts(categorySlug, {');
    expect(products).toContain('setProducts(result.products)');
    expect(products).toContain('applyAll()');
    expect(products).toContain(
      'No se han encontrado productos para esta búsqueda.',
    );
    expect(products).toContain("scrollIntoView({ behavior: 'smooth'");
  });

  it('exposes editable search keywords only in the admin product flow', () => {
    const html = readFrontend('admin.html');
    const admin = readFrontend('assets/admin.js');
    const api = readFrontend('src/admin/api.ts');

    expect(html).toContain('Palabras de búsqueda');
    expect(html).toContain(
      'Añade colores, tipos de prenda o términos relacionados separados por comas.',
    );
    expect(admin).toContain(
      'searchKeywordsInput.value = Array.isArray(product.searchKeywords)',
    );
    expect(admin).toContain('searchKeywords: [...new Set(searchKeywords)]');
    expect(api).toContain('/api/products/suggestions');
  });
});
