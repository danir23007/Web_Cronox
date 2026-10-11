import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { calculateFinance, FinanceOrder } from '../admin/finance/financial-calculations';

const script = readFileSync(resolve(__dirname, '../../../cronox-front/assets/admin-finance.js'), 'utf8');
function fixture(cost: number | null) {
  const order: FinanceOrder = {
    id: 19, status: 'PAID', currency: 'EUR', source: 'IN_PERSON_ADMIN', providerRef: null,
    purchasedAt: new Date('2026-09-23T12:00:00Z'), paidAt: null, createdAt: new Date('2026-09-23T12:00:00Z'), voidedAt: null,
    total: '56.00', shippingCost: 500, discountCents: 0, disputeLostCents: 0, stockMovements: [],
    items: [{ id: 24, productId: 2, variantId: 1, title: 'Camiseta', quantity: 2, lineTotal: '51.00',
      financialSnapshot: { unitCostCents: cost, productName: 'Camiseta histórica', imageUrl: null } }],
  };
  const report = calculateFinance([order], [], '2026-09-23', '2026-09-23', 'days');
  return { ...report, currency: 'EUR', currencies: ['EUR'], topProducts: report.products,
    pagination: { total: 1, page: 1, pages: 1 }, basis: 'Precios pagados y costes históricos; envío excluido.' };
}

describe('Finance UI with saved manual purchase amounts', () => {
  it.each([1500, 0, null])('reconciles KPI, chart tooltip and product breakdown after reload, cost %s', async cost => {
    const dom = new JSDOM('<section class="admin-section"><div data-finance-page="dashboard"></div><div data-finance-page="money"></div></section>', {
      url: 'http://localhost/admin.html#section-dashboard?from=2026-09-23&to=2026-09-23', runScripts: 'outside-only',
    });
    try {
      const report = fixture(cost);
      const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => structuredClone(report) });
      (dom.window as any).fetch = fetch;
      dom.window.eval(script);
      const api = (dom.window as any).CRONOX_FINANCE;
      const expected = cost === null ? 'No disponible' : cost === 0 ? '51,00' : '21,00';
      for (let reload = 0; reload < 2; reload++) {
        await api.load('dashboard');
        expect(dom.window.document.querySelector('.profit strong')!.textContent).toContain(expected);
        const chart = dom.window.document.querySelector<HTMLElement>('.finance-chart')!;
        chart.focus();
        expect(chart.querySelector('.finance-tooltip')!.textContent).toContain(expected);
        const profitPath = chart.querySelector('path[stroke="#3e72ed"]')!.getAttribute('d')!;
        expect(profitPath.trim().length > 0).toBe(cost !== null);
        if (cost === null) expect(dom.window.document.querySelector('.finance-warning')!.textContent).toContain('línea #24');
        await api.load('money');
        const row = dom.window.document.querySelector('.finance-table tbody tr')!;
        expect(row.children[3].textContent).toContain('51,00');
        expect(row.children[5].textContent).toContain(expected);
        expect(dom.window.document.querySelector('[data-finance-page="money"] .profit strong')!.textContent).toContain(expected);
      }
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(fetch.mock.calls.every(call => call[0].includes('from=2026-09-23&to=2026-09-23'))).toBe(true);
    } finally { dom.window.close(); }
  });
});
