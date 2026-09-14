import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontend = join(__dirname, '../../../cronox-front');
const script = readFileSync(join(frontend, 'assets/admin.js'), 'utf8');
const html = readFileSync(join(frontend, 'admin.html'), 'utf8');

describe('administrative product management UI', () => {
  it('renders the correct action for active and inactive products', () => {
    expect(script).toContain("product.isActive ? 'Desactivar' : 'Activar'");
    expect(script).not.toContain(
      "product.isActive ? 'Desactivar' : 'Inactivar'",
    );
  });

  it('locks product creation synchronously and sends an idempotency key', () => {
    expect(script).toContain(
      'if (!productForm || productSubmitInFlight) return;',
    );
    expect(script).toContain('productSubmitInFlight = true;');
    expect(script).toContain(
      "productSubmitBtn.textContent = editingProductId ? 'Guardando…' : 'Creando…'",
    );
    expect(script).toContain(
      'createAdminProduct(payload, productCreateIdempotencyKey)',
    );
  });

  it('uses an accessible explicit-confirmation deletion modal', () => {
    expect(html).toContain(
      'id="deleteProductModal" role="dialog" aria-modal="true"',
    );
    expect(html).toContain('id="deleteProductConfirmation"');
    expect(script).toContain(
      "event.key === 'Escape' && !pendingProductDeletion?.deleting",
    );
    expect(script).not.toContain(
      "window.confirm('¿Desactivar este producto?')",
    );
  });
});
