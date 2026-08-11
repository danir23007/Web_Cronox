import { Body, Controller, Optional, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CartService } from '../cart/cart.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentFactory } from './payment-intent.factory';
import { AnalyticsService } from '../analytics/analytics.service';
import { CustomerActivityEventType } from '@prisma/client';

@ApiTags('Payments / Stripe')
@Controller('payments')
export class PaymentsApiController {
  constructor(
    private readonly paymentIntentFactory: PaymentIntentFactory,
    private readonly cartService: CartService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  @Post('create-payment-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea un PaymentIntent de Stripe desde el checkout integrado' })
  @ApiOkResponse({ description: 'Client secret listo para confirmar el pago con Stripe' })
  async createPaymentIntent(@Req() req: Request, @Body() dto: CreatePaymentIntentDto) {
    const userId = req.user?.id;

    if (typeof userId !== 'number') {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    const cart = await this.cartService.getCheckoutCartForRequest(req);

    const result = await this.paymentIntentFactory.createPaymentIntentForUser(userId, dto, cart);
    const checkoutSnapshotId = result.metadata?.checkoutSnapshotId;
    if (checkoutSnapshotId) {
      await this.analytics?.recordServerEvent(req, userId, CustomerActivityEventType.CHECKOUT_STARTED, { checkoutSnapshotId }).catch(() => undefined);
    }
    return result;
  }
}
