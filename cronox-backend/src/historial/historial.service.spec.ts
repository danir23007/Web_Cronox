import { OrderStatus } from '@prisma/client';
import { HistorialService } from './historial.service';

describe('HistorialService authoritative purchase statistics', () => {
  const prisma = {
    order: { findMany: jest.fn() },
    historial: { upsert: jest.fn() },
  };
  const service = new HistorialService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('separates orders, retained units and products across repeats and sizes', async () => {
    prisma.order.findMany.mockResolvedValue([
      { status: OrderStatus.PAID, items: [{ productId: 10, variantId: 101, quantity: 3 }] },
      { status: OrderStatus.DELIVERED, items: [{ productId: 10, variantId: 102, quantity: 1 }] },
      { status: OrderStatus.PAID, items: [{ productId: 20, quantity: 2 }] },
      { status: OrderStatus.REFUNDED, items: [{ productId: 30, quantity: 4 }] },
    ]);

    await expect(service.calculatePurchaseStats(7)).resolves.toEqual({
      pedidosRealizados: 4,
      articulosAdquiridos: 6,
      productosDiferentes: 2,
      devoluciones: 4,
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 7,
        status: { in: expect.not.arrayContaining([OrderStatus.CANCELLED, OrderStatus.PENDING]) },
      }),
    }));
  });

  it('keeps a product distinct when one purchase is refunded but another is retained', async () => {
    prisma.order.findMany.mockResolvedValue([
      { status: OrderStatus.REFUNDED, items: [{ productId: 10, quantity: 2 }] },
      { status: OrderStatus.PAID, items: [{ productId: 10, quantity: 1 }] },
    ]);

    await expect(service.calculatePurchaseStats(7)).resolves.toMatchObject({
      pedidosRealizados: 2,
      articulosAdquiridos: 1,
      productosDiferentes: 1,
      devoluciones: 2,
    });
  });

  it('rebuilds the legacy cache instead of incrementing a drifting counter', async () => {
    prisma.order.findMany.mockResolvedValue([
      { status: OrderStatus.PAID, items: [{ productId: 10, quantity: 2 }] },
    ]);
    prisma.historial.upsert.mockResolvedValue({});

    await service.incrementOrderProgress(7, 999);

    expect(prisma.historial.upsert).toHaveBeenCalledWith({
      where: { userId: 7 },
      update: { pedidosRealizados: 1, articulosAdquiridos: 2, devoluciones: 0 },
      create: { userId: 7, pedidosRealizados: 1, articulosAdquiridos: 2, devoluciones: 0 },
    });
  });
});
