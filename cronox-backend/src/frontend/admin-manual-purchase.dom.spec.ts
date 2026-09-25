import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const frontendRoot = path.resolve(__dirname, '../../../cronox-front');

describe('admin in-person purchase workflow', () => {
  const html = readFileSync(path.join(frontendRoot, 'admin-user.html'), 'utf8');
  const source = readFileSync(path.join(frontendRoot, 'src/admin/admin-user.ts'), 'utf8');

  it('requires an explicit stock decision and a review before confirmation', () => {
    const document = new JSDOM(html).window.document;
    const stock = document.querySelector<HTMLSelectElement>('#manualStockHandling');

    expect(stock?.required).toBe(true);
    expect([...stock!.options].map((option) => option.value)).toEqual([
      'DEDUCT_NOW',
      'ALREADY_ADJUSTED',
    ]);
    expect(document.querySelector('#manualPurchaseReview')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#manualPurchaseConfirmActions')?.hasAttribute('hidden')).toBe(true);
    expect(source).toContain('manualPurchaseIdempotencyKey = crypto.randomUUID()');
    expect(source).toContain("currentUser.role === 'SUPERADMIN'");
  });

  it('offers correction by voiding instead of editing counters or order lines', () => {
    expect(source).toContain("order.source === 'IN_PERSON_ADMIN' && order.status === 'PAID'");
    expect(source).toContain('voidInPersonPurchase(orderId, reason.trim())');
    expect(source).not.toContain('articulosAdquiridos:');
    expect(source).not.toContain('productosDiferentes:');
  });
});
