import { ProductService } from '../products/product.service';
import { ADMIN_PAGE_SIZES } from './admin-pagination.constants';
import { AdminInventoryService } from './inventory/admin-inventory.service';
import { AdminPromoCodesService } from './promo-codes/admin-promo-codes.service';
import { AdminUsersService } from './users/admin-users.service';

describe('fixed Admin backend pagination defaults', () => {
  const transaction = (operations: Array<Promise<unknown>>) =>
    Promise.all(operations);

  it('keeps the canonical page-size contract', () => {
    expect(ADMIN_PAGE_SIZES).toEqual({
      INVENTORY: 50,
      PRODUCTS: 50,
      PROMO_CODES: 50,
      AUDIT_LOGS: 100,
      USERS: 100,
    });
  });

  it('uses 50 products for Inventory and Products', async () => {
    const inventoryPrisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(transaction),
    };
    await new AdminInventoryService(inventoryPrisma as never).list({});
    expect(inventoryPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );

    const productPrisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(transaction),
    };
    await new ProductService(productPrisma as never).listAdminProducts({});
    expect(productPrisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('uses 50 promo codes and 100 users', async () => {
    const promoPrisma = {
      promoCode: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(transaction),
    };
    await new AdminPromoCodesService(promoPrisma as never).list({});
    expect(promoPrisma.promoCode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );

    const usersPrisma = {
      user: {
        findMany: jest.fn(({ skip, take }) => Promise.resolve(
          Array.from({ length: 101 }, (_, i) => ({ id: 101 - i })).slice(skip, skip + take),
        )),
        count: jest.fn().mockResolvedValue(101),
      },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue(Array.from({length:101},(_,i)=>({id:101-i,ordinal:BigInt(101-i)}))),
      $transaction: jest.fn((work) => work(usersPrisma)),
    };
    const users = await new AdminUsersService(usersPrisma as never).listUsers({});
    expect(usersPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: 'desc' }, skip: 0, take: 100 }),
    );
    expect(users.data).toHaveLength(100);
    expect(users.meta).toMatchObject({ pageSize: 100, total: 101, totalPages: 2 });
    expect(users.data[0].registrationNumber).toBe(101);
  });
});
