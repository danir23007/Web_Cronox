import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CartService } from '../cart/cart.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentFactory } from './payment-intent.factory';

@ApiTags('Payments / Stripe')
@Controller('checkout')
export class PaymentsController {
  constructor(
    private readonly paymentIntentFactory: PaymentIntentFactory,
    private readonly cartService: CartService,
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
          code: 'EXPRESS',
          label: 'Envío express',
          amountCents: 495,
          amount: '4.95',
          isFree: false,
        },
        metadata: {
          userId: '1',
          cartId: '10',
          itemsTotalCents: '10000',
          shippingMethod: 'EXPRESS',
          shippingCostCents: '495',
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

    const cart = await this.cartService.getCheckoutCartForRequest(req);

    return this.paymentIntentFactory.createPaymentIntentForUser(userId, dto, cart); // Usa solo el carrito activo
  }
}
