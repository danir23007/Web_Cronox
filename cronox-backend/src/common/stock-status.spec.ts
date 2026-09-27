import { availableStock, classifyStock, classifyVariantStock } from './stock-status';

describe('administrative individual-size thresholds', () => {
  it.each([[0,'out_of_stock'],[1,'low'],[4,'low'],[5,'in_stock'],[8,'in_stock'],[10,'in_stock']])('classifies saved size stock %s', (stock, status) => {
    expect(classifyVariantStock(Number(stock))).toBe(status);
  });
  it('keeps product aggregate semantics distinct',()=>{expect(classifyStock(8)).toBe('low');expect(classifyVariantStock(8)).toBe('in_stock');});
});

describe('shared sellable stock classification', () => {
  it.each([
    [0, 'out_of_stock'],
    [1, 'low'],
    [14, 'low'],
    [15, 'in_stock'],
    [40, 'in_stock'],
  ] as const)('%i units => %s', (total, status) => {
    expect(
      classifyStock(availableStock([{ stockQty: total, isActive: true }])),
    ).toBe(status);
  });
  it('excludes inactive, unavailable, missing and malformed quantities', () => {
    expect(
      availableStock([
        { stockQty: 100, isActive: false },
        { stockQty: 100, isAvailable: false },
        {},
        null,
        { stockQty: '15' },
        { stockQty: -1 },
        { stockQty: NaN },
        { stockQty: Infinity },
        { stockQty: 1.5 },
      ]),
    ).toBe(0);
    expect(classifyStock(NaN)).toBe('out_of_stock');
  });
});
