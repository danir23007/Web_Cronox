import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrdersService } from '../orders/orders.service';
import { StripeService } from './stripe.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

@ApiTags('Payments / Stripe')
@Controller('checkout')
export class PaymentsController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  @Post('payment-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea (o reutiliza) un PaymentIntent de Stripe para el carrito actual' })
  @ApiOkResponse({
    description: 'Client secret listo para confirmar el pago con Stripe',
    schema: {
      example: {
        clientSecret: 'pi_123_secret_abc',
        paymentIntentId: 'pi_123',
        summary: {
          currency: 'EUR',
          subtotal: '100.00',
          taxRate: '0.2100',
          taxAmount: '21.00',
          shippingCost: '0.00',
          total: '121.00',
        },
        lineItems: [
          {
            productId: 1,
            title: 'Camiseta (M)',
            quantity: 1,
            unitPrice: '100.00',
            lineTotal: '100.00',
          },
        ],
        shippingMethod: {
          id: 2,
          name: 'Express',
          priceCents: 250,
          price: '2.50',
          countries: ['ES'],
          isActive: true,
          createdAt: '2025-02-04T00:00:00.000Z',
          updatedAt: '2025-02-04T00:00:00.000Z',
        },
        metadata: {
          userId: '1',
          cartId: '10',
          shippingMethodId: '2',
          shippingCostCents: '250',
        },
      },
    },
  })
  async createPaymentIntent(
    @Req() req: Request,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    const userId = req.user?.id;

    if (typeof userId !== 'number') {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    const preview = await this.ordersService.getCheckoutPreview(userId, {
      shippingMethodId: dto.shippingMethodId,
    }); // [STRIPE]
    const amountInCents = Number(preview.computation.total.mul(100).toFixed(0));

    const paymentIntent = await this.stripeService.createOrReusePaymentIntent({
      userId,
      cartId: preview.metadata.cartId,
      amount: amountInCents,
      currency: preview.computation.currency,
      metadata: {
        shippingMethodId: String(preview.metadata.shippingMethodId),
        shippingCostCents: String(preview.metadata.shippingCostCents),
      },
    });

    const metadata = {
      userId: String(preview.metadata.userId),
      cartId: String(preview.metadata.cartId),
      shippingMethodId: String(preview.metadata.shippingMethodId),
      shippingCostCents: String(preview.metadata.shippingCostCents),
    } as Record<string, string>;

    if (dto.addressId) {
      metadata.addressId = String(dto.addressId); // [STRIPE]
    }

    return {
      clientSecret: paymentIntent.clientSecret,
      paymentIntentId: paymentIntent.id,
      summary: preview.summary,
      lineItems: preview.lineItems,
      shippingMethod: preview.shippingMethod,
      metadata,
    };
  }
}
