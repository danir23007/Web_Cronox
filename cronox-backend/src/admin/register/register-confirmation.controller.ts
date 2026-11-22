import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, Matches } from 'class-validator';
import { Prisma, OrderPaymentMethod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { serializableTransaction } from '../../prisma/serializable-transaction';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TaxConfigService } from '../../common/tax/tax-config.service';
import { HistorialService } from '../../historial/historial.service';
import { reconcileCircle2 } from '../../membership/circle-policy';
import {
  allocateLots,
  sourceCosts,
  takeCosts,
} from '../../inventory-lots/lot-ledger';
import { frozenCost, FrozenLotCost } from '../../inventory-lots/lot-costs';
import { pricePointParts } from '../points/point-lot-costs';
import { configuredManualCost } from '../finance/historical-cost';
import { commission, lineDelta, PointLine } from '../points/point-calculations';
import { Quote, quoteRegister } from './register.controller';

export class ConfirmRegisterDto extends Quote {
  @Matches(/^[a-zA-Z0-9_-]{16,80}$/) key!: string;
  @Matches(/^[a-f0-9]{64}$/) revision!: string;
  @IsIn(['EXTERNAL_STRIPE', 'BIZUM', 'CASH']) paymentMethod!:
    | 'EXTERNAL_STRIPE'
    | 'BIZUM'
    | 'CASH';
}
const channels = {
  EXTERNAL_STRIPE: 'STRIPE_CONTACTLESS_EXTERNAL',
  BIZUM: 'BIZUM_EXTERNAL',
  CASH: 'CASH_RECEIVED',
};
const methods: Record<ConfirmRegisterDto['paymentMethod'], OrderPaymentMethod> =
  { EXTERNAL_STRIPE: 'EXTERNAL_CARD', BIZUM: 'OTHER', CASH: 'CASH' };
const json = (v: unknown) => v as Prisma.InputJsonValue;
@Injectable()
export class RegisterConfirmationService {
  constructor(
    private readonly db: PrismaService,
    private readonly tax: TaxConfigService,
    private readonly history: HistorialService,
  ) {}
  async recover(key: string, actor: number) {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(key))
      throw new BadRequestException('Clave de operación inválida.');
    const sale = await this.db.registerSale.findFirst({
      where: { key, confirmedById: actor },
    });
    if (!sale)
      throw new NotFoundException(
        'La operación aún no consta registrada. Puedes reintentar con la misma clave.',
      );
    return sale.receipt;
  }
  confirm(data: ConfirmRegisterDto, actor: number) {
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          actor,
          pointId: data.pointId ?? null,
          userId: data.userId ?? null,
          items: data.items,
          method: data.paymentMethod,
          revision: data.revision,
        }),
      )
      .digest('hex');
    return serializableTransaction(
      this.db,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'register:' + data.key},0))`;
        const previous = await tx.registerSale.findUnique({
          where: { key: data.key },
        });
        if (previous) {
          if (previous.requestHash !== hash)
            throw new ConflictException(
              'Clave reutilizada con datos distintos.',
            );
          return previous.receipt;
        }
        if (!data.items.length)
          throw new BadRequestException('El ticket está vacío.');
        if (data.userId)
          await tx.$queryRaw`SELECT id FROM "User" WHERE id=${data.userId} FOR UPDATE`;
        if (data.pointId)
          await tx.$queryRaw`SELECT id FROM "SalePoint" WHERE id=${data.pointId} FOR UPDATE`;
        const ids = [...new Set(data.items.map((l) => l.variantId))].sort(
          (a, b) => a - b,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "ProductVariant" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
        );
        const quote = await quoteRegister(tx, data);
        if (quote.revision !== data.revision)
          throw new ConflictException({
            code: 'REGISTER_QUOTE_CHANGED',
            message:
              'La oferta o el precio del ticket ha cambiado. Revisa el importe antes de confirmar.',
          });
        if (quote.totalCents > 99999999999)
          throw new BadRequestException('Importe fuera de rango.');
        const now = new Date(),
          amount = new Decimal(quote.totalCents).div(100),
          rate = new Decimal(this.tax.getDefaultVat());
        const taxAmount = amount
          .minus(amount.div(rate.add(1)).toDecimalPlaces(2))
          .toDecimalPlaces(2);
        const order = await tx.order.create({
          data: {
            source: 'IN_PERSON_ADMIN',
            status: 'DELIVERED',
            provider: 'manual',
            paymentMethod: methods[data.paymentMethod],
            userId: data.userId ?? null,
            customerEmail: quote.customer?.email ?? '',
            recordedById: actor,
            purchasedAt: now,
            paidAt: now,
            deliveredAt: now,
            manualStockHandling: 'DEDUCT_NOW',
            manualIdempotencyKey: 'register:' + data.key,
            manualRequestHash: hash,
            subtotal: amount,
            total: amount,
            taxRate: rate,
            taxAmount,
            currency: 'EUR',
            shippingCost: 0,
            internalNote:
              'CAJA · Confirmación manual de pago recibido externamente',
          },
        });
        const point = data.pointId
          ? await tx.salePoint.findUniqueOrThrow({
              where: { id: data.pointId },
            })
          : null;
        const pointLines: PointLine[] = [];
        const receiptLines: ((typeof quote.items)[number] & {
          originalUnitPriceCents: number;
          discountCents: number;
          costCents: number | null;
          lotCosts: FrozenLotCost[] | null;
        })[] = [];
        for (const line of quote.items) {
          const variant = await tx.productVariant.findUniqueOrThrow({
            where: { id: line.variantId },
            include: { product: { include: { privateCost: true } } },
          });
          if (variant.product.lotManaged) {
            await allocateLots(
              tx,
              line.variantId,
              line.quantity,
              'order:' + order.id,
              'SOLD',
              line.lotId!,
            );
          } else {
            const changed = await tx.productVariant.updateMany({
              where: { id: line.variantId, stockQty: { gte: line.quantity } },
              data: { stockQty: { decrement: line.quantity } },
            });
            if (changed.count !== 1)
              throw new ConflictException('Existencias insuficientes.');
          }
          let parts: FrozenLotCost[] | undefined;
          let unitCost: number | null = null;
          if (line.lotId) {
            const lot = await tx.inventoryLot.findUniqueOrThrow({
              where: { id: line.lotId },
            });
            const sourced = (
              await sourceCosts(tx, 'order:' + order.id, line.variantId)
            ).filter((p) => p.lotId === line.lotId);
            parts = pricePointParts(
              takeCosts(sourced, line.quantity),
              lot.id === variant.product.activeLotId
                ? {
                    ...lot,
                    profile: {
                      ...(lot.profile as object),
                      unitCostCents:
                        variant.product.privateCost?.unitCostCents ?? null,
                    },
                  }
                : lot,
            );
          } else unitCost = configuredManualCost(variant.product.privateCost);
          const item = await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: line.productId,
              variantId: line.variantId,
              title: line.name + ' (' + line.size + ')',
              quantity: line.quantity,
              unitPrice: new Decimal(line.unitPriceCents).div(100),
              lineTotal: new Decimal(line.subtotalCents).div(100),
              financialSnapshot: {
                create: {
                  unitCostCents: unitCost,
                  productName: line.name,
                  imageUrl: line.image,
                  ...(parts ? { lotCosts: json(parts) } : {}),
                },
              },
            },
          });
          await tx.stockMovement.create({
            data: {
              variantId: line.variantId,
              delta: -line.quantity,
              reason: 'manual_sale',
              orderId: order.id,
              userId: data.userId ?? null,
              note: 'CAJA · ' + (line.lotId ?? 'sin lote'),
            },
          });
          pointLines.push({
            id: String(item.id),
            variantId: line.variantId,
            productId: line.productId,
            name: line.name,
            size: line.size,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            unitCostCents: unitCost,
            lotId: line.lotId ?? undefined,
            ...(parts ? { lotCosts: parts } : {}),
            commissionBp: point?.commissionBp ?? 0,
            commissionCents: commission(
              line.subtotalCents,
              point?.commissionBp ?? 0,
            ),
            returned: 0,
          });
          receiptLines.push({
            ...line,
            originalUnitPriceCents:
              line.previousPriceCents ?? line.unitPriceCents,
            discountCents:
              ((line.previousPriceCents ?? line.unitPriceCents) -
                line.unitPriceCents) *
              line.quantity,
            costCents: parts
              ? frozenCost(parts)
              : unitCost === null
                ? null
                : unitCost * line.quantity,
            lotCosts: parts ?? null,
          });
        }
        if (point) {
          const state = {
            stockHandling: 'DEDUCT_NOW',
            lines: pointLines,
            note: 'CAJA · Pago recibido confirmado manualmente',
            paymentMethod: data.paymentMethod,
          };
          const sale = await tx.pointSale.create({
            data: {
              pointId: point.id,
              orderId: order.id,
              soldAt: now,
              state: json(state),
            },
          });
          await tx.pointEntry.create({
            data: {
              pointId: point.id,
              saleId: sale.id,
              requestKey: 'register:' + data.key,
              requestHash: hash,
              actorId: actor,
              kind: 'SALE',
              occurredAt: now,
              description: 'Venta CAJA #' + order.id,
              after: json(state),
              lines: json(pointLines.map((l) => lineDelta(l))),
            },
          });
        }
        const receipt = {
          ...quote,
          items: receiptLines,
          orderId: order.id,
          paymentMethod: data.paymentMethod,
          paymentChannel: channels[data.paymentMethod],
          confirmationMode: 'MANUAL_RECEIVED',
          confirmedById: actor,
          confirmedAt: now.toISOString(),
          taxCents: taxAmount.mul(100).toNumber(),
          taxRate: rate.toString(),
        };
        await tx.registerSale.create({
          data: {
            key: data.key,
            requestHash: hash,
            orderId: order.id,
            paymentMethod: data.paymentMethod,
            paymentChannel: channels[data.paymentMethod],
            confirmedById: actor,
            confirmedAt: now,
            pointId: data.pointId ?? null,
            receipt: json(receipt),
          },
        });
        await tx.$executeRaw`SELECT cronox_capture_finance_order(${order.id}::int)`;
        if (data.userId) {
          await this.history.syncFromOrders(data.userId, tx);
          await reconcileCircle2(tx, data.userId, now);
        }
        await tx.auditLog.create({
          data: {
            actorId: actor,
            action: 'admin.register.confirm',
            actionType: 'admin.register.confirm',
            targetType: 'order',
            targetId: String(order.id),
            metadata: json({
              key: data.key,
              paymentMethod: data.paymentMethod,
              manualConfirmation: true,
            }),
          },
        });
        return receipt;
      },
      true,
    );
  }
}
@Controller('admin/register/sales')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RegisterConfirmationController {
  constructor(private readonly sales: RegisterConfirmationService) {}
  @Post() @Header('Cache-Control', 'no-store') confirm(
    @Body() dto: ConfirmRegisterDto,
    @CurrentUser('id') actor: number,
  ) {
    return this.sales.confirm(dto, actor);
  }
  @Get(':key') @Header('Cache-Control', 'no-store') recover(
    @Param('key') key: string,
    @CurrentUser('id') actor: number,
  ) {
    return this.sales.recover(key, actor);
  }
}
