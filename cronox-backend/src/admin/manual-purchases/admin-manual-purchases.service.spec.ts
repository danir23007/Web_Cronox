import { ManualStockHandling, OrderPaymentMethod, OrderSource, OrderStatus } from '@prisma/client';
import { AdminManualPurchasesService } from './admin-manual-purchases.service';

describe('AdminManualPurchasesService', () => {
  const tx: any = {
    user: { findUnique: jest.fn() },
    productVariant: { findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    order: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    stockMovement: { createMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma: any = {
    order: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)),
  };
  const historial = { syncFromOrders: jest.fn() };
  const taxConfig = { getDefaultVat: jest.fn().mockReturnValue(0.21) };
  const service = new AdminManualPurchasesService(prisma, historial as any, taxConfig as any);
  const dto = {
    items: [{ variantId: 5, quantity: 3 }],
    paymentMethod: OrderPaymentMethod.CASH,
    stockHandling: ManualStockHandling.DEDUCT_NOW,
    purchasedAt: '2026-09-25T10:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order.findUnique.mockResolvedValue(null);
    tx.user.findUnique.mockResolvedValue({ id: 7, email: 'buyer@example.test' });
    tx.productVariant.findMany.mockResolvedValue([{ id: 5, size: 'M', sku: 'TEE-M', price: null, stockQty: 10, product: { id: 2, name: 'Camiseta', price: 2500, currency: 'EUR' } }]);
    tx.productVariant.updateMany.mockResolvedValue({ count: 1 });
    tx.order.create.mockResolvedValue({ id: 41, userId: 7, purchasedAt: new Date(dto.purchasedAt), items: [{ variantId: 5, quantity: 3 }] });
    tx.stockMovement.createMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockResolvedValue({});
    historial.syncFromOrders.mockResolvedValue({});
  });

  it('creates a paid non-Stripe order and deducts stock exactly once', async () => {
    await expect(service.create(7, 99, 'manual-purchase-123456', dto)).resolves.toMatchObject({ created: true, order: { id: 41 } });
    expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      source: OrderSource.IN_PERSON_ADMIN,
      paymentMethod: OrderPaymentMethod.CASH,
      provider: 'manual',
      status: OrderStatus.PAID,
      recordedById: 99,
    }) }));
    expect(tx.order.create.mock.calls[0][0].data).not.toHaveProperty('providerRef');
    expect(tx.order.create.mock.calls[0][0].data.taxRate.toString()).toBe('0.21');
    expect(tx.order.create.mock.calls[0][0].data.taxAmount.toString()).toBe('13.02');
    expect(tx.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ variantId: 5, delta: -3, reason: 'manual_sale' })] });
  });

  it('does not touch stock when the administrator says it was already adjusted', async () => {
    await service.create(7, 99, 'manual-purchase-654321', { ...dto, stockHandling: ManualStockHandling.ALREADY_ADJUSTED });
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('replays an identical submission without creating a second order', async () => {
    await service.create(7, 99, 'manual-purchase-replay1', dto);
    const createdData = tx.order.create.mock.calls[0][0].data;
    prisma.order.findUnique.mockResolvedValue({ id: 41, manualRequestHash: createdData.manualRequestHash });
    await expect(service.create(7, 99, 'manual-purchase-replay1', dto)).resolves.toEqual({ created: false, order: expect.objectContaining({ id: 41 }) });
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });

  it('rejects reuse of an idempotency key with a different purchase', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 41, manualRequestHash: 'different' });
    await expect(service.create(7, 99, 'manual-purchase-reused1', dto)).rejects.toThrow('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rolls back instead of overselling when stock is insufficient', async () => {
    tx.productVariant.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.create(7, 99, 'manual-purchase-nostock1', dto)).rejects.toThrow('INSUFFICIENT_STOCK:TEE-M');
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('voids a manual sale, restores deducted stock once and synchronizes statistics', async () => {
    tx.order.findUnique
      .mockResolvedValueOnce({ id: 41, userId: 7, source: OrderSource.IN_PERSON_ADMIN, status: OrderStatus.PAID, manualStockHandling: ManualStockHandling.DEDUCT_NOW, items: [{ variantId: 5, quantity: 3 }] })
      .mockResolvedValueOnce({ id: 41, status: OrderStatus.CANCELLED, items: [] });
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.productVariant.update.mockResolvedValue({});

    await service.void(41, 99, 'Cantidad equivocada');

    expect(tx.productVariant.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { stockQty: { increment: 3 } } });
    expect(tx.stockMovement.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ delta: 3, reason: 'manual_sale_void' })] });
    expect(historial.syncFromOrders).toHaveBeenCalledWith(7, tx);
  });
});
