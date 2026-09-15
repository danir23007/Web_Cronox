/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { PayloadTooLargeException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import { AdminExportsService } from './admin-exports.service';

describe('AdminExportsService', () => {
  const user = {
    id: 7,
    name: 'Ana',
    firstName: null,
    lastName: null,
    email: 'ana@example.test',
    phone: '+34 600 111 222',
    role: Role.USER,
    accountState: UserAccountState.ACTIVE,
    circleLevel: 1,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
  };

  const setup = () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([user]) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const excel = {
      build: jest.fn().mockResolvedValue(Buffer.from('PK')),
      timestampedFilename: jest.fn().mockReturnValue('users.xlsx'),
    };
    return {
      prisma,
      excel,
      service: new AdminExportsService(prisma as never, excel as never),
    };
  };

  it('exports the authoritative User.phone, uses an allowlisted query and audits metadata only', async () => {
    const { prisma, excel, service } = setup();
    const result = await service.export(
      'usuarios',
      { scope: 'filtered', q: 'ana' },
      99,
      { ip: '127.0.0.1', requestId: 'req-1' },
    );

    expect(result.filename).toBe('users.xlsx');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5001,
        select: expect.objectContaining({ phone: true }),
      }),
    );
    expect(prisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'addresses',
    );
    const sheets = excel.build.mock.calls[0][1];
    expect(sheets[0].rows[0].phone).toBe('+34 600 111 222');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 99,
        action: 'admin.users.export',
        metadata: expect.objectContaining({
          scope: 'filtered',
          filterNames: ['q'],
          rowCount: 1,
        }),
      }),
    });
  });

  it('never reports success when audit persistence fails', async () => {
    const { prisma, service } = setup();
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(
      service.export('usuarios', { scope: 'all' }, 99, {}),
    ).rejects.toThrow('audit unavailable');
  });

  it('ignores supplied filters for an explicit all-records export and does not paginate', async () => {
    const { prisma, service } = setup();
    await service.export(
      'usuarios',
      { scope: 'all', q: 'ignored', role: Role.FRIEND },
      99,
      {},
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 5001 }),
    );
    expect(prisma.user.findMany.mock.calls[0][0]).not.toHaveProperty('skip');
  });

  it('rejects an export beyond the hard row limit before building the workbook', async () => {
    const { prisma, excel, service } = setup();
    prisma.user.findMany.mockResolvedValue(
      Array.from({ length: 5001 }, () => user),
    );
    await expect(
      service.export('usuarios', { scope: 'all' }, 99, {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(excel.build).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('exports current inventory and its movements from one repeatable-read snapshot', async () => {
    const variant = {
      id: 3,
      productId: 2,
      size: 'M',
      sku: 'SKU-M',
      stockQty: 4,
      isActive: true,
      updatedAt: new Date('2026-09-15T10:00:00Z'),
      product: { id: 2, name: 'Camiseta' },
    };
    const movement = {
      id: 'mov-1',
      variantId: 3,
      delta: -1,
      reason: 'Pedido',
      orderId: 10,
      createdAt: new Date('2026-09-15T11:00:00Z'),
      variant,
    };
    const prisma = {
      productVariant: { findMany: jest.fn().mockResolvedValue([variant]) },
      stockMovement: { findMany: jest.fn().mockResolvedValue([movement]) },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const excel = {
      build: jest.fn().mockResolvedValue(Buffer.from('PK')),
      timestampedFilename: jest.fn().mockReturnValue('inventory.xlsx'),
    };
    const service = new AdminExportsService(prisma as never, excel as never);

    await service.export('inventario', { scope: 'all' }, 99, {});

    const sheets = excel.build.mock.calls[0][1];
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      'Inventario actual',
      'Movimientos',
    ]);
    expect(sheets[0].rows[0]).toMatchObject({ stock: 4, sku: 'SKU-M' });
    expect(sheets[1].rows[0]).toMatchObject({ delta: -1, orderId: 10 });
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ isolationLevel: 'RepeatableRead' }),
    );
  });

  it('exports order business fields without payment credentials or provider references', async () => {
    const order = {
      id: 10,
      userId: 7,
      customerEmail: 'buyer@example.test',
      status: 'PAID',
      subtotal: 100,
      taxAmount: 17.36,
      taxRate: 0.21,
      shippingCost: 500,
      discountCents: 0,
      total: 105,
      currency: 'EUR',
      shippingCarrier: null,
      trackingNumber: null,
      createdAt: new Date('2026-09-15T10:00:00Z'),
      updatedAt: new Date('2026-09-15T10:00:00Z'),
      paymentIntentId: 'must-not-export',
    };
    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue([order]) },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const excel = {
      build: jest.fn().mockResolvedValue(Buffer.from('PK')),
      timestampedFilename: jest.fn().mockReturnValue('orders.xlsx'),
    };
    const service = new AdminExportsService(prisma as never, excel as never);

    await service.export('pedidos', { scope: 'all' }, 99, {});

    const serializedSheets = JSON.stringify(excel.build.mock.calls[0][1]);
    expect(serializedSheets).not.toContain('paymentIntentId');
    expect(serializedSheets).not.toContain('must-not-export');
    expect(serializedSheets).not.toContain('secret');
    expect(excel.build.mock.calls[0][1][0].rows[0]).toMatchObject({
      total: 105,
      taxRate: 0.21,
    });
  });
});
