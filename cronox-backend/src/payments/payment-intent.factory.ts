import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { CartWithItems } from '../cart/cart.service';
import {
  normalizeCountry,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';
import { CheckoutOwner, OrdersService } from '../orders/orders.service';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import {
  CheckoutPaymentIntentCancelledException,
  CheckoutPaymentIntentConfigurationException,
  StripeService,
} from './stripe.service';

@Injectable()
export class PaymentIntentFactory {
  private readonly logger = new Logger(PaymentIntentFactory.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  async createPaymentIntentForUser(
    userId: number,
    dto: CreatePaymentIntentDto,
    cart?: CartWithItems | null,
  ) {
    return this.createPaymentIntentForOwner({ userId }, dto, cart);
  }

  async createPaymentIntentForOwner(
    owner: CheckoutOwner,
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
    const legacyUserId = owner.userId != null && !owner.customerEmail
      ? owner.userId
      : null;
    const createSnapshot = () =>
      legacyUserId != null
        ? this.ordersService.createCheckoutSnapshot(
            legacyUserId,
            checkoutParams,
            { cart },
          )
        : this.ordersService.createCheckoutSnapshotForOwner(
            owner,
            checkoutParams,
            { cart },
          );
    const claimReplacement = (snapshot: {
      cartId: number;
      checkoutSnapshotId: string;
    }) =>
      legacyUserId != null
        ? this.ordersService.claimCheckoutSnapshotReplacement(
            legacyUserId,
            snapshot.cartId,
            snapshot.checkoutSnapshotId,
          )
        : this.ordersService.claimCheckoutSnapshotReplacementForOwner(
            owner,
            snapshot.cartId,
            snapshot.checkoutSnapshotId,
          );
    let snapshot = await createSnapshot();

    // Changed mutable checkout data and expiry use the same server-owned
    // replacement lifecycle. The ownership claim remains under the active-cart
    // unique index while Stripe cancellation is verified.
    if (snapshot.replacementRequired) {
      const replacementClaimed = await claimReplacement(snapshot);
      if (!replacementClaimed) {
        let unavailablePaymentIntentReleased = false;
        if (snapshot.paymentIntentId) {
          try {
            await this.stripeService.assertCheckoutPaymentIsNotConfirming(
              snapshot.paymentIntentId,
              snapshot.checkoutSnapshotId,
            );
          } catch (error) {
            unavailablePaymentIntentReleased =
              await this.recoverUnavailablePaymentIntent(
                owner,
                snapshot,
                cart,
                error,
              );
            if (!unavailablePaymentIntentReleased) throw error;
          }
        }
        if (!unavailablePaymentIntentReleased) {
          this.logRecoveryEvent(
            'warn',
            'checkout_payment_intent_concurrency_conflict',
            snapshot,
            'REPLACEMENT_CLAIM_CONFLICT',
          );
          throw new ConflictException('CHECKOUT_REPLACEMENT_IN_PROGRESS');
        }
      }

      if (replacementClaimed) {
        let unavailablePaymentIntentReleased = false;
        if (snapshot.paymentIntentId) {
          try {
            await this.stripeService.cancelCheckoutPaymentIntent(
              snapshot.paymentIntentId,
              snapshot.checkoutSnapshotId,
            );
          } catch (error) {
            unavailablePaymentIntentReleased =
              await this.recoverUnavailablePaymentIntent(
                owner,
                snapshot,
                cart,
                error,
              );
            if (!unavailablePaymentIntentReleased) throw error;
          }
        }
        if (!unavailablePaymentIntentReleased) {
          await this.ordersService.releaseCheckoutSnapshot(
            snapshot.checkoutSnapshotId,
            snapshot.expired ? 'EXPIRED' : 'REPLACED',
            snapshot.paymentIntentId ?? undefined,
          );
        }
      }
      snapshot = await createSnapshot();
      if (snapshot.replacementRequired) {
        throw new ConflictException('CHECKOUT_REPLACEMENT_IN_PROGRESS');
      }
    }

    if (snapshot.paymentIntentId) {
      try {
        const paymentIntent =
          await this.stripeService.getReusableCheckoutPaymentIntent({
            paymentIntentId: snapshot.paymentIntentId,
            checkoutSnapshotId: snapshot.checkoutSnapshotId,
            amount: snapshot.amountCents,
            currency: snapshot.currency,
          });
        await this.ordersService.recordCheckoutStripeAccount(
          snapshot.checkoutSnapshotId,
          paymentIntent.id,
          paymentIntent.stripeAccountId,
        );
        return this.buildPaymentIntentResponse(snapshot, paymentIntent);
      } catch (error) {
        const released = await this.recoverUnavailablePaymentIntent(
          owner,
          snapshot,
          cart,
          error,
        );
        if (!released) throw error;

        snapshot = await createSnapshot();
        if (snapshot.replacementRequired || snapshot.paymentIntentId) {
          throw new ConflictException('CHECKOUT_REPLACEMENT_IN_PROGRESS');
        }
      }
    }

    const claimed = await this.ordersService.claimCheckoutPaymentIntentCreation(
      snapshot.checkoutSnapshotId,
    );
    if (!claimed) {
      const concurrent = await createSnapshot();
      if (concurrent.paymentIntentId) {
        const paymentIntent =
          await this.stripeService.getReusableCheckoutPaymentIntent({
            paymentIntentId: concurrent.paymentIntentId,
            checkoutSnapshotId: concurrent.checkoutSnapshotId,
            amount: concurrent.amountCents,
            currency: concurrent.currency,
          });
        await this.ordersService.recordCheckoutStripeAccount(
          concurrent.checkoutSnapshotId,
          paymentIntent.id,
          paymentIntent.stripeAccountId,
        );
        return this.buildPaymentIntentResponse(concurrent, paymentIntent);
      }
      this.logRecoveryEvent(
        'warn',
        'checkout_payment_intent_concurrency_conflict',
        snapshot,
        'PAYMENT_INTENT_CREATION_CLAIM_CONFLICT',
      );
      throw new ConflictException('CHECKOUT_PAYMENT_INTENT_IN_PROGRESS');
    }

    let paymentIntent:
      | { id: string; clientSecret: string; stripeAccountId: string }
      | undefined;
    try {
      paymentIntent = await this.stripeService.createPaymentIntentForCheckout({
        checkoutSnapshotId: snapshot.checkoutSnapshotId,
        amount: snapshot.amountCents,
        currency: snapshot.currency,
        ...(normalizedShippingAddress
          ? { shippingAddress: normalizedShippingAddress }
          : {}),
      });
      await this.ordersService.bindStripePaymentIntent(
        snapshot.checkoutSnapshotId,
        paymentIntent.id,
        paymentIntent.stripeAccountId,
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
            paymentIntent.id,
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

  private async recoverUnavailablePaymentIntent(
    owner: CheckoutOwner,
    snapshot: {
      checkoutSnapshotId: string;
      cartId: number;
      amountCents: number;
      currency: string;
      paymentIntentId: string | null;
      stripeAccountId: string | null;
    },
    cart: CartWithItems | null | undefined,
    error: unknown,
  ): Promise<boolean> {
    if (!snapshot.paymentIntentId) return false;

    let stripeAccountId: string;
    let allowStripeAccountBackfill = false;
    if (error instanceof CheckoutPaymentIntentCancelledException) {
      stripeAccountId = error.stripeAccountId;
      allowStripeAccountBackfill = !snapshot.stripeAccountId;
      if (
        snapshot.stripeAccountId &&
        snapshot.stripeAccountId !== stripeAccountId
      ) {
        this.blockRecovery(snapshot, 'STRIPE_ACCOUNT_MISMATCH');
      }
    } else if (error instanceof CheckoutPaymentIntentConfigurationException) {
      stripeAccountId = error.stripeAccountId;
      allowStripeAccountBackfill = !snapshot.stripeAccountId;
      if (
        snapshot.stripeAccountId &&
        snapshot.stripeAccountId !== stripeAccountId
      ) {
        this.blockRecovery(snapshot, 'STRIPE_ACCOUNT_MISMATCH');
      }
      await this.stripeService.cancelCheckoutPaymentIntent(
        snapshot.paymentIntentId,
        snapshot.checkoutSnapshotId,
      );
    } else if (this.stripeService.isMissingPaymentIntentError?.(error)) {
      this.logRecoveryEvent(
        'warn',
        'checkout_payment_intent_missing',
        snapshot,
      );
      const proof =
        await this.stripeService.proveMissingPaymentIntentCanBeRecovered({
          paymentIntentId: snapshot.paymentIntentId,
          expectedStripeAccountId: snapshot.stripeAccountId,
        });
      if (!proof.safe || !proof.stripeAccountId) {
        this.blockRecovery(snapshot, proof.reason);
      }
      stripeAccountId = proof.stripeAccountId;
      allowStripeAccountBackfill = !snapshot.stripeAccountId;
    } else {
      return false;
    }

    if (
      !cart ||
      cart.id !== snapshot.cartId ||
      !(cart.updatedAt instanceof Date)
    ) {
      this.blockRecovery(snapshot, 'CART_CONTEXT_UNAVAILABLE');
    }
    const recoveryInput = {
      checkoutSnapshotId: snapshot.checkoutSnapshotId,
      paymentIntentId: snapshot.paymentIntentId,
      stripeAccountId,
      allowStripeAccountBackfill,
      userId: owner.userId ?? null,
      anonymousId: owner.anonymousId ?? null,
      cartId: snapshot.cartId,
      cartUpdatedAt: cart.updatedAt,
      amountCents: snapshot.amountCents,
      currency: snapshot.currency,
    };
    const claim =
      await this.ordersService.claimUnavailableCheckoutPaymentRecovery(
        recoveryInput,
      );
    if (!claim.claimed) {
      this.logRecoveryEvent(
        'warn',
        claim.reason === 'RECOVERY_CLAIM_CONFLICT'
          ? 'checkout_payment_intent_concurrency_conflict'
          : 'checkout_payment_intent_recovery_blocked',
        snapshot,
        claim.reason,
      );
      throw new ConflictException('CHECKOUT_PAYMENT_INTENT_RECOVERY_BLOCKED');
    }
    const finalized =
      await this.ordersService.finalizeUnavailableCheckoutPaymentRecovery(
        recoveryInput,
        claim.token,
      );
    if (!finalized.released) {
      this.blockRecovery(
        snapshot,
        finalized.reason ?? 'RECOVERY_FINALIZE_FAILED',
      );
    }
    this.logRecoveryEvent('log', 'checkout_payment_intent_recovered', snapshot);
    return true;
  }

  private blockRecovery(
    snapshot: { checkoutSnapshotId: string; paymentIntentId: string | null },
    reason: string,
  ): never {
    this.logRecoveryEvent(
      'warn',
      'checkout_payment_intent_recovery_blocked',
      snapshot,
      reason,
    );
    throw new ConflictException('CHECKOUT_PAYMENT_INTENT_RECOVERY_BLOCKED');
  }

  private logRecoveryEvent(
    level: 'log' | 'warn',
    event: string,
    snapshot: { checkoutSnapshotId: string; paymentIntentId: string | null },
    reason?: string,
  ): void {
    const paymentIntentRef = snapshot.paymentIntentId
      ? `pi_***${snapshot.paymentIntentId.slice(-6)}`
      : null;
    this.logger[level](
      JSON.stringify({
        event,
        checkoutSnapshotId: snapshot.checkoutSnapshotId,
        paymentIntentRef,
        ...(reason ? { reason } : {}),
      }),
    );
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
    const name =
      pick('name', 'fullName', 'full_name') ||
      [firstName, lastName].filter(Boolean).join(' ').trim();
    const line1 = pick('line1', 'address', 'address1');
    const line2 = pick('line2', 'address2');
    const city = pick('city');
    const state = pick('state', 'province', 'region');
    const postalCode = pick('postalCode', 'zip', 'zipCode', 'postal_code');
    const countryValue = pick('country');
    const country = countryValue ? normalizeCountry(countryValue) : null;
    if (countryValue && !country) {
      throw new BadRequestException(UNSUPPORTED_COUNTRY_MESSAGE);
    }
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
    assign('country', country ?? '', 80);
    assign('phone', phone, 40);
    assign('email', email, 160);

    return Object.keys(normalized).length ? normalized : null;
  }
}
