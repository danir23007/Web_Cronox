import { ManualStockHandling, OrderPaymentMethod, OrderSource, OrderStatus, Prisma } from '@prisma/client';
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
  it.each([0, 1, 2550, 4000])('persists paid cents %i, not catalog prices, with exact inclusive VAT', async (price) => {
    await service.create(7, 99, 'manual-price-123456', { ...dto, items: [{ variantId: 5, quantity: 2, unitPriceCents: price }] });
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.items.create[0].unitPrice.mul(100).toNumber()).toBe(price);
    expect(data.items.create[0].lineTotal.mul(100).toNumber()).toBe(price * 2);
    expect(data.subtotal.mul(100).toNumber()).toBe(price * 2);
    expect(data.total.equals(data.subtotal)).toBe(true);
    expect(data.taxAmount.toString()).toBe(({ 0: '0', 1: '0', 2550: '8.85', 4000: '13.88' } as any)[price]);
    expect(data.items.create[0].financialSnapshot.create.unitCostCents).toBeNull();
    expect(historial.syncFromOrders).toHaveBeenCalledWith(7, tx);
  });

  it('preserves different prices for the same variant and checks combined stock', async () => {
    await service.create(7, 99, 'manual-lines-123456', { ...dto, items: [
      { variantId: 5, quantity: 2, unitPriceCents: 2550 }, { variantId: 5, quantity: 1, unitPriceCents: 0 },
    ] });
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.items.create.map((line: any) => line.unitPrice.toString())).toEqual(['25.5', '0']);
    expect(data.total.toString()).toBe('51');
    expect(tx.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({ where: { id: 5, stockQty: { gte: 3 } }, data: { stockQty: { decrement: 3 } } });
  });

  it.each([null, -1, 1.5, NaN, Infinity, 1000000000000, '0', ''])('rejects invalid present price %s before writes', async (price) => {
    await expect(service.create(7, 99, 'manual-invalid-123456', { ...dto, items: [{ variantId: 5, quantity: 2, unitPriceCents: price as any }] })).rejects.toThrow('INVALID_MANUAL_PURCHASE_ITEM');
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('rejects overflow before deducting stock', async () => {
    await expect(service.create(7, 99, 'manual-overflow-123456', { ...dto, items: [{ variantId: 5, quantity: 2, unitPriceCents: 999999999999 }] })).rejects.toThrow('MANUAL_PURCHASE_TOTAL_OVERFLOW');
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('includes the price in replay identity, even when the catalog changes', async () => {
    const paid = { ...dto, items: [{ variantId: 5, quantity: 2, unitPriceCents: 2550 }] };
    await service.create(7, 99, 'manual-priced-replay1', paid);
    const data = tx.order.create.mock.calls[0][0].data;
    prisma.order.findUnique.mockResolvedValue({ id: 41, manualRequestHash: data.manualRequestHash });
    tx.productVariant.findMany.mockResolvedValue([]);
    await expect(service.create(7, 99, 'manual-priced-replay1', paid)).resolves.toMatchObject({ created: false });
    await expect(service.create(7, 99, 'manual-priced-replay1', { ...paid, items: [{ ...paid.items[0], unitPriceCents: 0 }] })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    expect(tx.order.create).toHaveBeenCalledTimes(1);
  });

  it('voids already adjusted purchases without restoring stock', async () => {
    tx.order.findUnique.mockResolvedValue({ id: 41, userId: 7, source: OrderSource.IN_PERSON_ADMIN, status: OrderStatus.PAID, manualStockHandling: ManualStockHandling.ALREADY_ADJUSTED, items: [{ variantId: 5, quantity: 2 }] });
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    await service.void(41, 99, 'Correccion');
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.stockMovement.createMany).not.toHaveBeenCalled();
  });

  it('resolves a concurrent unique-key collision as an identical replay', async () => {
    const paid = { ...dto, items: [{ variantId: 5, quantity: 2, unitPriceCents: 2550 }] };
    await service.create(7, 99, 'manual-concurrent-123456', paid);
    const hash = tx.order.create.mock.calls[0][0].data.manualRequestHash;
    tx.order.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Concurrent duplicate', { code: 'P2002', clientVersion: '6' }));
    prisma.order.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 41, manualRequestHash: hash });
    await expect(service.create(7, 99, 'manual-concurrent-123456', paid)).resolves.toMatchObject({ created: false, order: { id: 41 } });
  });

  it('restores all quantities of separately priced repeated variants only once', async () => {
    const saved = { id: 41, userId: 7, source: OrderSource.IN_PERSON_ADMIN, status: OrderStatus.PAID,
      manualStockHandling: ManualStockHandling.DEDUCT_NOW, items: [{ variantId: 5, quantity: 2 }, { variantId: 5, quantity: 1 }] };
    const cancelled = { ...saved, status: OrderStatus.CANCELLED };
    tx.order.findUnique.mockResolvedValueOnce(saved).mockResolvedValueOnce(cancelled).mockResolvedValueOnce(cancelled);
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    await service.void(41, 99, 'Correccion');
    await expect(service.void(41, 99, 'Correccion')).resolves.toMatchObject({ changed: false });
    expect(tx.productVariant.update.mock.calls.map((call: any) => call[0].data.stockQty.increment)).toEqual([2, 1]);
    expect(tx.stockMovement.createMany).toHaveBeenCalledTimes(1);
  });

});
