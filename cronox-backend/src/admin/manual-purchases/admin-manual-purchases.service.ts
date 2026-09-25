import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ManualStockHandling,
  OrderPaymentMethod,
  OrderSource,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { HistorialService } from '../../historial/historial.service';
import { TaxConfigService } from '../../common/tax/tax-config.service';
import { CreateManualPurchaseDto } from './dto/create-manual-purchase.dto';

@Injectable()
export class AdminManualPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historialService: HistorialService,
    private readonly taxConfig: TaxConfigService,
  ) {}

  async getOptions(userId: number) {
    const [user, products] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, firstName: true, lastName: true },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          price: true,
          currency: true,
          variants: {
            where: { isActive: true },
            orderBy: { id: 'asc' },
            select: { id: true, size: true, sku: true, price: true, stockQty: true },
          },
        },
      }),
    ]);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return { user, products };
  }

  async create(
    userId: number,
    adminId: number,
    idempotencyKey: string | undefined,
    dto: CreateManualPurchaseDto,
  ) {
    const key = String(idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9._:-]{16,100}$/.test(key)) {
      throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    }
    if (dto.paymentMethod === OrderPaymentMethod.STRIPE) {
      throw new BadRequestException('MANUAL_PURCHASE_CANNOT_USE_STRIPE');
    }
    const quantities = new Map<number, number>();
    for (const item of dto.items) {
      if (quantities.has(item.variantId)) {
        throw new BadRequestException('DUPLICATE_VARIANT');
      }
      quantities.set(item.variantId, item.quantity);
    }
    const normalized = {
      userId,
      items: [...quantities.entries()].sort(([a], [b]) => a - b),
      paymentMethod: dto.paymentMethod,
      stockHandling: dto.stockHandling,
      purchasedAt: dto.purchasedAt || null,
      note: dto.note?.trim() || null,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const existing = await this.prisma.order.findUnique({ where: { manualIdempotencyKey: key } });
    if (existing) return this.resolveReplay(existing, requestHash);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
          if (!user) throw new NotFoundException('Usuario no encontrado');
          const variants = await tx.productVariant.findMany({
            where: { id: { in: [...quantities.keys()] }, isActive: true, product: { isActive: true } },
            include: { product: { select: { id: true, name: true, price: true, currency: true } } },
          });
          if (variants.length !== quantities.size) throw new BadRequestException('VARIANT_NOT_AVAILABLE');
          const currencies = new Set(variants.map((variant) => variant.product.currency));
          if (currencies.size !== 1) throw new BadRequestException('MIXED_CURRENCIES');
          let totalCents = 0;
          const lines = variants.map((variant) => {
            const quantity = quantities.get(variant.id)!;
            const unitPriceCents = variant.price ?? variant.product.price;
            totalCents += unitPriceCents * quantity;
            return { variant, quantity, unitPriceCents };
          });
          if (dto.stockHandling === ManualStockHandling.DEDUCT_NOW) {
            for (const line of lines) {
              const result = await tx.productVariant.updateMany({
                where: { id: line.variant.id, stockQty: { gte: line.quantity } },
                data: { stockQty: { decrement: line.quantity } },
              });
              if (result.count !== 1) throw new ConflictException(`INSUFFICIENT_STOCK:${line.variant.sku}`);
            }
          }
          const toDecimal = (cents: number) => new Decimal(cents).div(100);
          const subtotal = toDecimal(totalCents);
          const taxRate = new Decimal(this.taxConfig.getDefaultVat());
          const taxAmount = totalCents > 0
            ? subtotal.minus(subtotal.div(taxRate.add(1)).toDecimalPlaces(2)).toDecimalPlaces(2)
            : new Decimal(0);
          const order = await tx.order.create({
            data: {
              userId,
              customerEmail: user.email,
              status: OrderStatus.PAID,
              source: OrderSource.IN_PERSON_ADMIN,
              paymentMethod: dto.paymentMethod,
              purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : new Date(),
              recordedById: adminId,
              manualStockHandling: dto.stockHandling,
              manualIdempotencyKey: key,
              manualRequestHash: requestHash,
              internalNote: dto.note?.trim() || null,
              subtotal,
              taxRate,
              taxAmount,
              shippingCost: 0,
              total: toDecimal(totalCents),
              currency: [...currencies][0],
              provider: 'manual',
              items: {
                create: lines.map(({ variant, quantity, unitPriceCents }) => ({
                  productId: variant.product.id,
                  variantId: variant.id,
                  title: `${variant.product.name} (${variant.size})`,
                  unitPrice: toDecimal(unitPriceCents),
                  quantity,
                  lineTotal: toDecimal(unitPriceCents * quantity),
                })),
              },
            },
            include: { items: true },
          });
          if (dto.stockHandling === ManualStockHandling.DEDUCT_NOW) {
            await tx.stockMovement.createMany({
              data: lines.map((line) => ({
                variantId: line.variant.id,
                delta: -line.quantity,
                reason: 'manual_sale',
                orderId: order.id,
                userId,
              })),
            });
          }
          await this.historialService.syncFromOrders(userId, tx);
          await tx.auditLog.create({
            data: {
              actorId: adminId,
              action: 'admin.manual_purchase.create',
              actionType: 'admin.manual_purchase.create',
              targetType: 'order',
              targetId: String(order.id),
              metadata: { userId, paymentMethod: dto.paymentMethod, stockHandling: dto.stockHandling, purchasedAt: order.purchasedAt, items: lines.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })) },
            },
          });
          return { created: true, order };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const replay = await this.prisma.order.findUnique({ where: { manualIdempotencyKey: key } });
      if (!replay) throw error;
      return this.resolveReplay(replay, requestHash);
    }
  }

  async void(orderId: number, adminId: number, reason: string) {
    const trimmedReason = reason.trim();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (order.source !== OrderSource.IN_PERSON_ADMIN) throw new BadRequestException('NOT_MANUAL_PURCHASE');
      if (order.status === OrderStatus.CANCELLED) return { changed: false, order };
      if (order.status !== OrderStatus.PAID) throw new ConflictException('MANUAL_PURCHASE_NOT_CORRECTABLE');
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PAID },
        data: { status: OrderStatus.CANCELLED, voidedAt: new Date(), voidedById: adminId, voidReason: trimmedReason },
      });
      if (changed.count !== 1) throw new ConflictException('MANUAL_PURCHASE_CHANGED');
      if (order.manualStockHandling === ManualStockHandling.DEDUCT_NOW) {
        for (const item of order.items) {
          if (!item.variantId) throw new ConflictException('MANUAL_PURCHASE_VARIANT_MISSING');
          await tx.productVariant.update({ where: { id: item.variantId }, data: { stockQty: { increment: item.quantity } } });
        }
        await tx.stockMovement.createMany({
          data: order.items.map((item) => ({ variantId: item.variantId!, delta: item.quantity, reason: 'manual_sale_void', orderId, userId: order.userId })),
        });
      }
      if (order.userId) await this.historialService.syncFromOrders(order.userId, tx);
      await tx.auditLog.create({
        data: { actorId: adminId, action: 'admin.manual_purchase.void', actionType: 'admin.manual_purchase.void', targetType: 'order', targetId: String(orderId), reason: trimmedReason, metadata: { userId: order.userId, stockRestored: order.manualStockHandling === ManualStockHandling.DEDUCT_NOW } },
      });
      return { changed: true, order: await tx.order.findUnique({ where: { id: orderId }, include: { items: true } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private resolveReplay(order: { id: number; manualRequestHash: string | null }, requestHash: string) {
    if (order.manualRequestHash !== requestHash) throw new ConflictException('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
    return { created: false, order };
  }
}
