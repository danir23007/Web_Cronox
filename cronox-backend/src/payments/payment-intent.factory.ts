import { Injectable } from '@nestjs/common';
import { CartWithItems } from '../cart/cart.service';
import { OrdersService } from '../orders/orders.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { StripeService } from './stripe.service';

@Injectable()
export class PaymentIntentFactory {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  async createPaymentIntentForUser(
    userId: number,
    dto: CreatePaymentIntentDto,
    cart?: CartWithItems | null,
  ) {
    const preview = await this.ordersService.getCheckoutPreview(
      userId,
      {
        shippingMethod: dto.shippingMethod,
        promoCode: dto.promoCode,
      },
      { cart },
    ); // [STRIPE]
    const amountInCents = preview.totals.totalCents;

    const normalizedShippingAddress = this.normalizeShippingAddress(
      dto.shippingAddress,
    );
    const serializedShippingAddress = normalizedShippingAddress
      ? JSON.stringify(normalizedShippingAddress)
      : null;

    const paymentIntent = await this.stripeService.createOrReusePaymentIntent({
      userId,
      cartId: preview.metadata.cartId,
      amount: amountInCents,
      currency: preview.computation.currency,
      paymentIntentId: dto.paymentIntentId,
      metadata: {
        shippingMethod: String(preview.metadata.shippingMethod),
        shippingCostCents: String(preview.metadata.shippingCostCents),
        itemsTotalCents: String(preview.metadata.itemsTotalCents),
        discountCents: String(
          preview.metadata.discountCents ??
            preview.totals.discountCents ??
            0,
        ),
        ...(preview.metadata.promoCode
          ? {
              promoCode: preview.metadata.promoCode,
            }
          : {}),
        ...(serializedShippingAddress
          ? {
              shippingAddress: serializedShippingAddress,
            }
          : {}),
      },
    });

    const metadata = {
      userId: String(preview.metadata.userId),
      cartId: String(preview.metadata.cartId),
      shippingMethod: String(preview.metadata.shippingMethod),
      shippingCostCents: String(preview.metadata.shippingCostCents),
      itemsTotalCents: String(preview.metadata.itemsTotalCents),
    } as Record<string, string>;

    const discountCents =
      preview.metadata.discountCents ?? preview.totals.discountCents ?? 0;
    if (preview.metadata.promoCode) {
      metadata.promoCode = preview.metadata.promoCode;
    }
    metadata.discountCents = String(discountCents);

    if (dto.addressId) {
      metadata.addressId = String(dto.addressId); // [STRIPE]
    }
    if (serializedShippingAddress) {
      metadata.shippingAddress = serializedShippingAddress;
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

  private normalizeShippingAddress(
    input: Record<string, unknown> | undefined,
  ): Record<string, string> | null {
    if (!input || typeof input !== 'object') {
      return null;
    }

    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const value = input[key];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
      return '';
    };

    const firstName = pick('firstName', 'first_name');
    const lastName = pick('lastName', 'last_name');
    const name = pick('name', 'fullName', 'full_name') || [firstName, lastName].filter(Boolean).join(' ').trim();
    const line1 = pick('line1', 'address', 'address1');
    const line2 = pick('line2', 'address2');
    const city = pick('city');
    const state = pick('state', 'province', 'region');
    const postalCode = pick('postalCode', 'zip', 'zipCode', 'postal_code');
    const country = pick('country');
    const phone = pick('phone', 'phoneNumber');
    const email = pick('email');

    const normalized: Record<string, string> = {};
    const assign = (key: string, value: string, maxLength = 120) => {
      if (!value) return;
      normalized[key] = value.slice(0, maxLength);
    };

    assign('firstName', firstName, 80);
    assign('lastName', lastName, 120);
    assign('name', name, 180);
    assign('line1', line1, 180);
    assign('line2', line2, 180);
    assign('city', city, 120);
    assign('state', state, 120);
    assign('postalCode', postalCode, 40);
    assign('country', country, 80);
    assign('phone', phone, 40);
    assign('email', email, 160);

    return Object.keys(normalized).length ? normalized : null;
  }
}
