import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard } from '../../common/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AdminFinanceController,
  FinanceQuery,
} from '../finance/admin-finance.controller';
import { AdminFinanceService } from '../finance/admin-finance.service';
import {
  calculateFinance,
  FinanceEvent,
  FinanceOrder,
  madridMidnight,
} from '../finance/financial-calculations';
import { AdminMapController, MapQuery } from './admin-map.controller';
import { AdminMapService, mapOrderAmounts } from './admin-map.service';
import { classifyShipping, PROVINCES, REGIONS } from './spain-geography';

const order = (patch: Partial<FinanceOrder> = {}): FinanceOrder => ({
  id: 1,
  status: 'PAID',
  currency: 'EUR',
  providerRef: 'pi_1',
  source: 'ONLINE',
  paidAt: new Date('2026-03-29T12:00:00Z'),
  purchasedAt: null,
  createdAt: new Date('2026-03-01T12:00:00Z'),
  voidedAt: null,
  total: '20.00',
  shippingCost: 0,
  discountCents: 0,
  disputeLostCents: 0,
  items: [
    {
      id: 1,
      productId: 1,
      variantId: 1,
      title: 'Prueba',
      quantity: 2,
      lineTotal: '20.00',
      financialSnapshot: {
        unitCostCents: 300,
        productName: 'Prueba',
        imageUrl: null,
      },
    },
  ],
  stockMovements: [],
  ...patch,
});
const event = (
  id: string,
  amount = 500,
  patch: Partial<FinanceEvent> = {},
): FinanceEvent => ({
  id,
  type: 'charge.refunded',
  paymentIntentId: 'pi_1',
  occurredAt: new Date('2026-03-30T12:00:00Z'),
  lifecycleStatus: null,
  refundCumulativeCents: amount,
  amountCents: null,
  ...patch,
});
const query = (patch: Partial<MapQuery> = {}) =>
  Object.assign(new MapQuery(), {
    from: '2026-03-01',
    to: '2026-03-31',
    ...patch,
  });
const amounts = (o = order(), events: FinanceEvent[] = []) =>
  mapOrderAmounts(o, events, '2026-03-01', '2026-03-31');

describe('Map geography', () => {
  it('keeps a reliable community without inventing a province and rejects conflicting community evidence', () => {
    expect(
      classifyShipping({ country: 'ES', state: 'Andalucía' }),
    ).toMatchObject({ group: 'identified', regionId: '01' });
    expect(
      classifyShipping({ country: 'ES', region: 'Canarias' }).provinceId,
    ).toBeUndefined();
    expect(
      classifyShipping({ country: 'ES', state: 'Canarias', zip: '35001' }),
    ).toMatchObject({ provinceId: '35', regionId: '05' });
    expect(
      classifyShipping({ country: 'ES', community: 'Andalucía', zip: '28001' })
        .group,
    ).toBe('unknownSpain');
    expect(classifyShipping({ state: 'Andalucía' }).group).toBe('unresolved');
  });
  it('covers all 52 prefixes and 19 regions with a unique province assignment', () => {
    expect(PROVINCES).toHaveLength(52);
    expect(REGIONS).toHaveLength(19);
    for (const p of PROVINCES)
      expect(classifyShipping({ country: 'ES', zip: `${p.id}001` })).toEqual({
        group: 'identified',
        provinceId: p.id,
        regionId: p.regionId,
      });
  });
  it.each([
    ['01001', 'Araba', '01', '16'],
    ['07001', 'Islas Baleares', '07', '04'],
    ['35001', 'Las Palmas', '35', '05'],
    ['38001', 'Santa Cruz de Tenerife', '38', '05'],
    ['51001', 'Ceuta', '51', '18'],
    ['52001', 'Melilla', '52', '19'],
    ['15001', 'La Coruña', '15', '12'],
    ['20001', 'Guipúzcoa', '20', '16'],
    ['48001', 'Vizcaya', '48', '16'],
  ])(
    'keeps postal code %s and province variants',
    (zip, state, provinceId, regionId) => {
      expect(classifyShipping({ country: 'España', zip, state })).toEqual({
        group: 'identified',
        provinceId,
        regionId,
      });
    },
  );
  it('falls back only to an unambiguous province; does not pad numeric codes', () => {
    expect(
      classifyShipping({ country: 'ES', zip: 'bad', province: 'Lérida' }),
    ).toMatchObject({ provinceId: '25' });
    expect(classifyShipping({ country: 'ES', zip: 1001 })).toMatchObject({
      group: 'unknownSpain',
    });
  });
  it.each([
    [{ country: 'ES', zip: '28001', state: 'Barcelona' }, 'unknownSpain'],
    [{ country: 'ES', zip: '28001', postalCode: '08001' }, 'unknownSpain'],
    [{ country: 'ES', zip: '28001', state: 'Atlantis' }, 'unknownSpain'],
    [{ country: 'France', zip: '28001' }, 'foreign'],
    [{ country: 'FR', zip: '28001', state: 'Madrid' }, 'foreign'],
    [{ zip: '28001' }, 'unresolved'],
    [{ state: 'Madrid' }, 'unresolved'],
    [null, 'unresolved'],
    [{ country: 'ES', countryCode: 'FR', zip: '28001' }, 'unresolved'],
    [{ country: 'N/A', zip: '28001', state: 'Madrid' }, 'unresolved'],
    [{ country: 'France', countryCode: 'DE' }, 'unresolved'],
    [{ country: 'ES' }, 'unknownSpain'],
  ])(
    'does not silently classify ambiguous or foreign addresses %j',
    (address, group) => expect(classifyShipping(address).group).toBe(group),
  );
  it('requires matching province and postal code for a legacy address without country', () =>
    expect(
      classifyShipping({ zip: '08001', province: 'Barcelona' }),
    ).toMatchObject({ provinceId: '08', group: 'identified' }));
});

describe('Map finance criteria', () => {
  it.each(['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'])(
    'includes confirmed payment after fulfillment status %s',
    (status) =>
      expect(amounts(order({ status }))).toMatchObject({
        amount: { orders: 1, units: 2, revenueCents: 2000 },
      }),
  );
  it.each(['PENDING', 'FAILED', 'CANCELLED', 'PAID'])(
    'does not invent a confirmation date for %s',
    (status) =>
      expect(amounts(order({ status, paidAt: null }))).toEqual({
        excluded: 'undated',
      }),
  );
  it('counts once across duplicate successful events and payment retries', () => {
    const success = event('success', 0, {
      type: 'payment_intent.succeeded',
      occurredAt: new Date('2026-03-29T12:00:00Z'),
    });
    expect(
      amounts(order({ paidAt: null }), [
        success,
        { ...success, id: 'duplicate' },
        event('failed', 0, { type: 'payment_intent.payment_failed' }),
      ]),
    ).toMatchObject({ amount: { orders: 1, revenueCents: 2000 } });
  });
  it('reuses net finance amounts, recorded returns and cumulative deduplication', () => {
    const o = order({
      stockMovements: [
        {
          variantId: 1,
          delta: 1,
          reason: 'refund',
          createdAt: new Date('2026-03-30T12:00:00Z'),
        },
      ],
    });
    const events = [event('a', 500), event('b', 500), event('c', 300)];
    const financial = calculateFinance(
      [o],
      events,
      '2026-03-01',
      '2026-03-31',
      'days',
    ).totals;
    expect(amounts(o, events)).toMatchObject({
      amount: {
        orders: 1,
        revenueCents: financial.revenueCents,
        units: financial.unitsSold - financial.unitsReturned,
      },
    });
    expect(financial.revenueCents).toBe(1500);
  });
  it('does not infer refunded units from money or guess allocation with shipping', () => {
    expect(amounts(order(), [event('a')])).toMatchObject({
      amount: { units: 2 },
    });
    expect(
      amounts(order({ shippingCost: 500, total: '25.00' }), [event('a')]),
    ).toMatchObject({ amount: { revenueCents: null, units: 2 } });
  });
  it('excludes full refunds, unknown dated full refunds and voided sales', () => {
    expect(amounts(order(), [event('a', 2000)])).toEqual({
      excluded: 'refunded',
    });
    expect(amounts(order({ status: 'REFUNDED' }))).toEqual({
      excluded: 'refunded',
    });
    expect(
      amounts(order({ voidedAt: new Date('2026-03-30T12:00:00Z') })),
    ).toEqual({ excluded: 'refunded' });
  });
  it('does not apply future refunds to a historical period', () => {
    expect(
      amounts(order({ status: 'REFUNDED' }), [
        event('a', 2000, { occurredAt: new Date('2026-04-01T12:00:00Z') }),
      ]),
    ).toMatchObject({ amount: { orders: 1, revenueCents: 2000 } });
  });
  it.each(['2026-03-29', '2026-10-25'])(
    'respects both Madrid DST midnights for %s',
    (day) => {
      const start = madridMidnight(day);
      const next = madridMidnight(
        day === '2026-03-29' ? '2026-03-30' : '2026-10-26',
      );
      expect((+next - +start) / 3600000).toBe(day === '2026-03-29' ? 23 : 25);
      for (const [date, included] of [
        [new Date(+start - 1), false],
        [start, true],
        [new Date(+next - 1), true],
        [next, false],
      ] as const) {
        expect(
          !!mapOrderAmounts(order({ paidAt: date }), [], day, day).amount,
        ).toBe(included);
      }
    },
  );
  it('supports finance calculation without buckets without changing totals or unknowns', () => {
    const orders = [
      order(),
      order({ id: 2, status: 'REFUNDED', providerRef: 'pi_2' }),
    ];
    expect(
      calculateFinance(orders, [], '2026-03-01', '2026-03-31', 'months', false)
        .totals,
    ).toEqual(
      calculateFinance(orders, [], '2026-03-01', '2026-03-31', 'days').totals,
    );
  });
});

describe('Map aggregation, validation and permissions', () => {
  function fixture() {
    const rows = Array.from({ length: 405 }, (_, index) => ({
      orderId: index + 1,
      currency: 'EUR',
      paidDate: new Date('2026-03-29'),
      lastDate: new Date('2026-03-29'),
      providerRef: `pi_${index + 1}`,
      snapshot: order({ id: index + 1, providerRef: `pi_${index + 1}` }),
    }));
    const tx = {
      financeArchive: {
        findMany: jest.fn(async ({ where, select }: any) =>
          select
            ? [{ currency: 'EUR' }]
            : rows.filter((r) => r.orderId > where.orderId.gt).slice(0, 200),
        ),
      },
      order: {
        findMany: jest.fn(async ({ where }: any) =>
          rows
            .filter((r) => where.id.in.includes(r.orderId))
            .map((r) => ({
              id: r.orderId,
              shippingAddr: {
                country: r.orderId > 402 ? 'FR' : 'ES',
                zip: '01001',
                state: 'Álava',
                line1: 'PRIVATE',
              },
            })),
        ),
      },
      financeEventArchive: { findMany: jest.fn(async () => []) },
      financeStockArchive: { findMany: jest.fn(async () => []) },
    };
    return {
      rows,
      tx,
      db: { $transaction: (work: (t: typeof tx) => unknown) => work(tx) },
    };
  }
  it('preserves totals across divisions, reconciles every community and separately paginates community-only sales', async () => {
    const { rows, tx, db } = fixture();
    tx.order.findMany.mockImplementation(
      async ({ where }: any) =>
        rows
          .filter((r) => where.id.in.includes(r.orderId))
          .map((r) => ({
            id: r.orderId,
            shippingAddr:
              r.orderId === 405
                ? { country: 'ES', state: 'Canarias' }
                : {
                    country: 'ES',
                    zip: PROVINCES[(r.orderId - 1) % 52].id + '001',
                  },
          })) as any,
    );
    const service = new AdminMapService(db as never);
    const communities = await service.getReport(query());
    const provinces = await service.getReport(
      query({ division: 'provinces', region: '35' }),
    );
    expect(provinces.total).toEqual(communities.total);
    expect(provinces.identified).toEqual(communities.identified);
    expect(provinces.provinces).toHaveLength(52);
    for (const r of provinces.regions)
      for (const metric of ['orders', 'units', 'revenueCents'] as const)
        expect(
          r.provinces.reduce((n, p) => n + p[metric]!, 0) +
            r.unassignedProvince[metric]!,
        ).toBe(r[metric]);
    expect(provinces.orders.every((o) => o.province === 'Las Palmas')).toBe(
      true,
    );
    for (const id of ['07', '35', '38', '51', '52'])
      expect(
        provinces.provinces.find((p) => p.id === id)!.orders,
      ).toBeGreaterThan(0);
    const only = await service.getReport(
      query({ division: 'provinces', region: 'communityOnly:05' }),
    );
    expect(only.pagination.total).toBe(1);
    expect(only.orders[0]).toMatchObject({ id: 405, province: null });
    expect(
      only.communityOnly.find((r) => r.id === 'communityOnly:05')!.orders,
    ).toBe(1);
    await expect(service.getReport(query({ region: '35' }))).rejects.toThrow(
      'división',
    );
  });
  it('reconciles 3 batches, all destinations, page boundaries and the Finance endpoint', async () => {
    const { tx, db } = fixture();
    const service = new AdminMapService(db as never);
    const result = await service.getReport(query({ region: '16', page: 17 }));
    expect(result.total).toEqual({
      orders: 405,
      units: 810,
      revenueCents: 810000,
    });
    expect(result.identified.orders).toBe(402);
    expect(result.groups.find((g) => g.id === 'foreign')?.orders).toBe(3);
    expect(result.regions.reduce((n, r) => n + r.orders, 0)).toBe(402);
    expect(
      result.regions
        .find((r) => r.id === '16')
        ?.provinces.find((p) => p.id === '01')?.orders,
    ).toBe(402);
    expect(result.orders.map((o) => o.id)).toEqual([401, 402]);
    expect(result.pagination.total).toBe(402);
    expect(tx.order.findMany).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|shippingAddr|customerEmail|providerRef/,
    );
    const finance = await new AdminFinanceService(db as never).getReport(
      Object.assign(new FinanceQuery(), query()),
    );
    expect(result.reconciliation.financePeriod).toEqual({
      revenueCents: finance.totals.revenueCents,
      unitsSold: finance.totals.unitsSold,
      unitsReturned: finance.totals.unitsReturned,
    });
    expect(result.total.revenueCents).toBe(finance.totals.revenueCents);
    await expect(
      service.getReport(query({ region: '16', page: 100 })),
    ).rejects.toThrow('La página solicitada no existe');
  });
  it('validates query parameters and calendar intervals before reading data', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    for (const bad of [
      { region: '99' },
      { page: 0 },
      { page: '2.5' },
      { from: 'bad' },
      { currency: 'USD' },
    ]) {
      await expect(
        pipe.transform(
          { ...query(), ...bad },
          { type: 'query', metatype: MapQuery },
        ),
      ).rejects.toThrow();
    }
    for (const bad of [
      { from: '2026-02-30' },
      { from: '2026-04-01' },
      { from: '1999-01-01' },
    ])
      await expect(
        new AdminMapService({} as never).getReport(query(bad)),
      ).rejects.toThrow();
  });
  it('explains the Finance difference from an earlier paid cohort and preserves deleted destinations', async () => {
    const { rows, tx, db } = fixture();
    rows[0].paidDate = new Date('2026-02-01');
    rows[0].snapshot.paidAt = new Date('2026-02-01T12:00:00Z');
    (tx.financeEventArchive.findMany as jest.Mock).mockResolvedValue([
      {
        snapshot: event('earlier-sale-refund'),
        occurredAt: new Date('2026-03-30T12:00:00Z'),
        paymentIntentId: 'pi_1',
      },
    ]);
    (tx.order.findMany as jest.Mock).mockResolvedValue([]);
    const report = await new AdminMapService(db as never).getReport(
      query({ region: 'unresolved' }),
    );
    expect(report.total.orders).toBe(404);
    expect(report.identified.orders).toBe(0);
    expect(report.groups.find((g) => g.id === 'unresolved')?.orders).toBe(404);
    expect(report.orders.every((o) => !o.available)).toBe(true);
    expect(report.reconciliation.revenueDifferenceCents).toBe(500);
    const finance = await new AdminFinanceService(db as never).getReport(
      Object.assign(new FinanceQuery(), query()),
    );
    expect(report.reconciliation.financePeriod.revenueCents).toBe(
      finance.totals.revenueCents,
    );
  });
  it('uses exactly Finance guards and denies guests, USER and FRIEND', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminMapController);
    expect(guards).toEqual([JwtAuthGuard, AdminGuard]);
    expect(guards).toEqual(
      Reflect.getMetadata(GUARDS_METADATA, AdminFinanceController),
    );
    const guard = new AdminGuard(new Reflector());
    const context = (role: string | undefined) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { role } : undefined }),
        }),
        getHandler: () => AdminMapController.prototype.get,
        getClass: () => AdminMapController,
      }) as ExecutionContext;
    for (const role of [undefined, 'USER', 'FRIEND'])
      expect(() => guard.canActivate(context(role))).toThrow();
    for (const role of ['ADMIN', 'SUPERADMIN'])
      expect(guard.canActivate(context(role))).toBe(true);
  });
});
