import { ConflictException, Injectable } from '@nestjs/common';
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
    const normalizedShippingAddress = this.normalizeShippingAddress(
      dto.shippingAddress,
    );
    const checkoutParams = {
      shippingMethod: dto.shippingMethod,
      promoCode: dto.promoCode,
      shippingAddress: normalizedShippingAddress ?? undefined,
    };
    let snapshot = await this.ordersService.createCheckoutSnapshot(
      userId,
      checkoutParams,
      { cart },
    );

    // A stale, unconfirmed intent is explicitly cancelled before its stock
    // reservation is released. A succeeded/disputed intent fails closed and
    // remains for its signed webhook lifecycle instead of permitting a retry.
    if (snapshot.expired) {
      if (snapshot.paymentIntentId) {
        await this.stripeService.cancelCheckoutPaymentIntent(
          snapshot.paymentIntentId,
          snapshot.checkoutSnapshotId,
        );
        await this.ordersService.releaseCheckoutSnapshot(
          snapshot.checkoutSnapshotId,
          'EXPIRED',
          snapshot.paymentIntentId,
        );
      } else {
        await this.ordersService.releaseCheckoutSnapshot(
          snapshot.checkoutSnapshotId,
          'EXPIRED',
        );
      }
      snapshot = await this.ordersService.createCheckoutSnapshot(
        userId,
        checkoutParams,
        { cart },
      );
    }

    if (snapshot.paymentIntentId) {
      const paymentIntent =
        await this.stripeService.getReusableCheckoutPaymentIntent({
          paymentIntentId: snapshot.paymentIntentId,
          checkoutSnapshotId: snapshot.checkoutSnapshotId,
          amount: snapshot.amountCents,
          currency: snapshot.currency,
        });
      return this.buildPaymentIntentResponse(snapshot, paymentIntent);
    }

    const claimed = await this.ordersService.claimCheckoutPaymentIntentCreation(
      snapshot.checkoutSnapshotId,
    );
    if (!claimed) {
      const concurrent = await this.ordersService.createCheckoutSnapshot(
        userId,
        checkoutParams,
        { cart },
      );
      if (concurrent.paymentIntentId) {
        const paymentIntent =
          await this.stripeService.getReusableCheckoutPaymentIntent({
            paymentIntentId: concurrent.paymentIntentId,
            checkoutSnapshotId: concurrent.checkoutSnapshotId,
            amount: concurrent.amountCents,
            currency: concurrent.currency,
          });
        return this.buildPaymentIntentResponse(concurrent, paymentIntent);
      }
      throw new ConflictException('CHECKOUT_PAYMENT_INTENT_IN_PROGRESS');
    }

    let paymentIntent: { id: string; clientSecret: string } | undefined;
    try {
      paymentIntent = await this.stripeService.createPaymentIntentForCheckout({
        checkoutSnapshotId: snapshot.checkoutSnapshotId,
        amount: snapshot.amountCents,
        currency: snapshot.currency,
      });
      await this.ordersService.bindStripePaymentIntent(
        snapshot.checkoutSnapshotId,
        paymentIntent.id,
      );
    } catch (error) {
      if (!paymentIntent) {
        await this.ordersService.resetCheckoutPaymentIntentCreation(
          snapshot.checkoutSnapshotId,
        );
      } else {
        try {
          await this.stripeService.cancelCheckoutPaymentIntent(
            paymentIntent.id,
            snapshot.checkoutSnapshotId,
          );
          await this.ordersService.releaseCheckoutSnapshot(
            snapshot.checkoutSnapshotId,
            'PAYMENT_CREATION_FAILED',
          );
        } catch {
          // Keep the reservation claimed if Stripe cannot confirm cancellation;
          // this prevents a second intent from being created for this checkout.
        }
      }
      throw error;
    }

    return this.buildPaymentIntentResponse(snapshot, paymentIntent);
  }

  private buildPaymentIntentResponse(
    snapshot: {
      checkoutSnapshotId: string;
      summary: unknown;
      lineItems: unknown;
      shippingMethod: unknown;
      totals: unknown;
    },
    paymentIntent: { id: string; clientSecret: string },
  ) {
    return {
      clientSecret: paymentIntent.clientSecret,
      paymentIntentId: paymentIntent.id,
      summary: snapshot.summary,
      lineItems: snapshot.lineItems,
      shippingMethod: snapshot.shippingMethod,
      totals: snapshot.totals,
      metadata: { checkoutSnapshotId: snapshot.checkoutSnapshotId },
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
