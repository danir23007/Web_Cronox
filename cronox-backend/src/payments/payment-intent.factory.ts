import { Injectable } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { StripeService } from './stripe.service';

@Injectable()
export class PaymentIntentFactory {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  async createPaymentIntentForUser(userId: number, dto: CreatePaymentIntentDto) {
    const preview = await this.ordersService.getCheckoutPreview(userId, {
      shippingMethod: dto.shippingMethod,
    }); // [STRIPE]
    const amountInCents = preview.totals.totalCents;

    const paymentIntent = await this.stripeService.createOrReusePaymentIntent({
      userId,
      cartId: preview.metadata.cartId,
      amount: amountInCents,
      currency: preview.computation.currency,
      metadata: {
        shippingMethod: String(preview.metadata.shippingMethod),
        shippingCostCents: String(preview.metadata.shippingCostCents),
        itemsTotalCents: String(preview.metadata.itemsTotalCents),
      },
    });

    const metadata = {
      userId: String(preview.metadata.userId),
      cartId: String(preview.metadata.cartId),
      shippingMethod: String(preview.metadata.shippingMethod),
      shippingCostCents: String(preview.metadata.shippingCostCents),
      itemsTotalCents: String(preview.metadata.itemsTotalCents),
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
      totals: preview.totals,
      metadata,
    };
  }
}
