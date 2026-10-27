import { AdminUsersService } from './admin-users.service';
import * as purchaseMetrics from './user-purchase-metrics';

describe('admin user pagination before purchase metrics', () => {
  const users = [1, 5, 7, 9, 11].map(id => ({ id, email: `fixture-${id}@example.test` }));
  let tx: any;
  let service: AdminUsersService;
  let metrics: jest.SpyInstance;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue(users.map((user, index) => ({ id: user.id, ordinal: BigInt(index + 1) }))),
      user: {
        findMany: jest.fn(({ orderBy, skip = 0, take = users.length }) => Promise.resolve(
          [...users].sort((a, b) => orderBy.id === 'asc' ? a.id - b.id : b.id - a.id).slice(skip, skip + take),
        )),
        count: jest.fn().mockResolvedValue(users.length),
      },
      $transaction: jest.fn((callback: (transaction: any) => unknown) => callback(tx)),
    };
    metrics = jest.spyOn(purchaseMetrics, 'loadUserPurchaseMetrics').mockImplementation(async (_tx, ids) => new Map(ids.map(id => [id, {
      revenueCents: id === 1 ? null : id === 11 ? 100 : id * 100,
      ordersCount: id,
      distinctProducts: 1,
    }])));
    service = new AdminUsersService(tx);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['desc', [7, 5]],
    ['asc', [7, 9]],
  ] as const)('preserves the second ID page in %s order and only calculates its spending', async (order, ids) => {
    const result = await service.listUsers({ page: 2, pageSize: 2, order });
    expect(result.data.map(user => user.id)).toEqual(ids);
    expect(result.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3, sort: 'id', order });
    expect(result.data.map(user => user.revenueCents)).toEqual(ids.map(id => id * 100));
    expect(result.data.map(user => user.registrationNumber)).toEqual(ids.map(id => users.findIndex(user => user.id === id) + 1));
    expect(metrics).toHaveBeenCalledWith(tx, ids);
    expect(tx.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 60000 });
  });

  it('uses identical search/account filters for the page and its total', async () => {
    await service.listUsers({ q: 'fixture', email: '@example.test', role: 'USER', accountState: 'ACTIVE', circle: 2, pageSize: 2 });
    const pageWhere = tx.user.findMany.mock.calls[0][0].where;
    expect(pageWhere).toMatchObject({ role: 'USER', accountState: 'ACTIVE', circleLevel: 2,
      email: { contains: '@example.test', mode: 'insensitive' },
      OR: expect.arrayContaining([{ email: { contains: 'fixture', mode: 'insensitive' } }]),
    });
    expect(tx.user.count).toHaveBeenCalledWith({ where: pageWhere });
  });

  it('retains the total on an empty page without reading another customer history', async () => {
    const result = await service.listUsers({ page: 4, pageSize: 2 });
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(5);
    expect(result.meta.totalPages).toBe(3);
    expect(metrics).toHaveBeenCalledWith(tx, []);
  });

  it('gets the exact total from an incomplete first page without an extra count', async () => {
    const result = await service.listUsers({ pageSize: 100 });
    expect(result.data.map(user => user.id)).toEqual([11, 9, 7, 5, 1]);
    expect(result.meta).toMatchObject({ total: 5, totalPages: 1 });
    expect(tx.user.count).not.toHaveBeenCalled();
  });

  it('returns the established empty metadata without counting an empty first page', async () => {
    tx.user.findMany.mockResolvedValueOnce([]);
    const result = await service.listUsers({ pageSize: 100 });
    expect(result.data).toEqual([]);
    expect(result.meta).toMatchObject({ total: 0, totalPages: 1 });
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(metrics).toHaveBeenCalledWith(tx, []);
  });

  it('still ranks revenue globally before paginating, leaving unknown spending last', async () => {
    const result = await service.listUsers({ sort: 'revenue', order: 'desc', page: 2, pageSize: 2 });
    expect(result.data.map(user => user.id)).toEqual([5, 11]);
    expect(result.meta.total).toBe(5);
    expect(metrics).toHaveBeenCalledWith(tx, [11, 9, 7, 5, 1]);
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.user.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  });
});
