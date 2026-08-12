import { Body, Controller, Optional, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CartService } from '../cart/cart.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentFactory } from './payment-intent.factory';
import { AnalyticsService } from '../analytics/analytics.service';
import { CustomerActivityEventType } from '@prisma/client';
import { resolveCheckoutOwner } from '../orders/checkout-owner';

@ApiTags('Payments / Stripe')
@Controller('payments')
export class PaymentsApiController {
  constructor(
    private readonly paymentIntentFactory: PaymentIntentFactory,
    private readonly cartService: CartService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  @Post('create-payment-intent')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Crea un PaymentIntent de Stripe desde el checkout integrado' })
  @ApiOkResponse({ description: 'Client secret listo para confirmar el pago con Stripe' })
  async createPaymentIntent(@Req() req: Request, @Body() dto: CreatePaymentIntentDto) {
    const cart = await this.cartService.getCheckoutCartForRequest(req);
    const owner = resolveCheckoutOwner(req, cart, dto.guestEmail);
    const result = typeof owner.userId === 'number'
      ? await this.paymentIntentFactory.createPaymentIntentForUser(owner.userId, dto, cart)
      : await this.paymentIntentFactory.createPaymentIntentForOwner(owner, dto, cart);
    const checkoutSnapshotId = result.metadata?.checkoutSnapshotId;
    if (checkoutSnapshotId && typeof owner.userId === 'number') {
      await this.analytics?.recordServerEvent(req, owner.userId, CustomerActivityEventType.CHECKOUT_STARTED, { checkoutSnapshotId }).catch(() => undefined);
    }
    return result;
  }
}
