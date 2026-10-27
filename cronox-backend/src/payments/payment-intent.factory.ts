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
    if (dto.checkoutSnapshotId) {
      if (!cart || !dto.tabId) throw new ConflictException('CHECKOUT_PRESENCE_REQUIRED');
      await this.ordersService.assertCheckoutPreparationPresence(owner, cart.id, dto.checkoutSnapshotId, dto.tabId);
    }
    const normalizedShippingAddress = this.normalizeShippingAddress(
      dto.shippingAddress,
    );
    if (
      !normalizedShippingAddress?.firstName ||
      !normalizedShippingAddress.lastName ||
      !normalizedShippingAddress.line1 ||
      !normalizedShippingAddress.city ||
      !normalizedShippingAddress.country ||
      !/^[0-9]{5}$/.test(normalizedShippingAddress.postalCode || '')
    ) {
      throw new BadRequestException('CHECKOUT_SHIPPING_ADDRESS_REQUIRED');
    }
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
            { cart, tabId: dto.tabId },
          )
        : this.ordersService.createCheckoutSnapshotForOwner(
            owner,
            checkoutParams,
            { cart, tabId: dto.tabId },
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
    if (snapshot.expired || snapshot.reservationPhase === 'RECONCILING') throw new ConflictException('CHECKOUT_RESERVATION_EXPIRED');
    if (snapshot.status === 'BANK_TRANSFER_PENDING') {
      throw new ConflictException({ code: 'CHECKOUT_BANK_TRANSFER_PENDING', paymentIntentId: snapshot.paymentIntentId });
    }

    // Changed mutable checkout data and expiry use the same server-owned
    // replacement lifecycle. The ownership claim remains under the active-cart
    // unique index while Stripe cancellation is verified.
    if (snapshot.replacementRequired) {
      let replacementReady = false;
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
                dto.tabId ? { owner, tabId: dto.tabId, params: checkoutParams } : undefined,
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
                dto.tabId ? { owner, tabId: dto.tabId, params: checkoutParams } : undefined,
              );
            if (!unavailablePaymentIntentReleased) throw error;
          }
        }
        if (!unavailablePaymentIntentReleased) {
          const replaced = await this.ordersService.replaceCheckoutReservation(owner, snapshot.checkoutSnapshotId, dto.tabId, checkoutParams);
          if (!replaced) throw new ConflictException('EMPTY_CART');
          snapshot = replaced; replacementReady = true;
        }
      }
      if (cart) cart = await this.ordersService.reloadCheckoutCart(owner, snapshot.cartId);
      if (!replacementReady) snapshot = await createSnapshot();
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
            ...(dto.expressCheckout ? { collectShippingInWallet: true } : {}),
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
          dto.tabId ? { owner, tabId: dto.tabId, params: checkoutParams } : undefined,
        );
        if (!released) throw error;

        if (cart) cart = await this.ordersService.reloadCheckoutCart(owner, snapshot.cartId);
        snapshot = await createSnapshot();
        if (snapshot.replacementRequired || snapshot.paymentIntentId) {
          throw new ConflictException('CHECKOUT_REPLACEMENT_IN_PROGRESS');
        }
      }
    }

    const creationRequest = (await this.ordersService.getCheckoutCreationRequest(snapshot.checkoutSnapshotId)) as {
      checkoutSnapshotId: string; amount: number; currency: string; shippingAddress?: Record<string, string>; requestedAt?: string;
    } || {
      requestedAt: new Date().toISOString(),
      checkoutSnapshotId: snapshot.checkoutSnapshotId,
      amount: snapshot.amountCents,
      currency: snapshot.currency,
      ...(normalizedShippingAddress && !dto.expressCheckout ? { shippingAddress: normalizedShippingAddress } : {}),
    };
    const claimed = await this.ordersService.claimCheckoutPaymentIntentCreation(
      snapshot.checkoutSnapshotId,
      creationRequest,
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
            ...(dto.expressCheckout ? { collectShippingInWallet: true } : {}),
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
      paymentIntent = await this.stripeService.createPaymentIntentForCheckout(creationRequest);
      await this.ordersService.bindStripePaymentIntent(
        snapshot.checkoutSnapshotId,
        paymentIntent.id,
        paymentIntent.stripeAccountId,
      );
    } catch (error) {
      if (!paymentIntent) {
        // A network failure may follow successful creation at Stripe. Retain
        // the durable request/claim; retry or cleanup uses the SAME key/body.
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
    replacement?: Parameters<OrdersService['finalizeUnavailableCheckoutPaymentRecovery']>[2],
  ): Promise<boolean> {
    if (!snapshot.paymentIntentId) return false;
    const current = await this.ordersService.getActiveReservation(owner, snapshot.cartId);
    if (current?.paymentStartedAt) throw new ConflictException('CHECKOUT_RESERVATION_EXPIRED');

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
        ...(replacement ? [replacement] as const : []),
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
      expiresAt?: Date;
      reservationPhase?: string;
      paymentStartedAt?: Date | null;
    },
    paymentIntent: { id: string; clientSecret: string },
  ) {
    return {
      serverNow: new Date(),
      clientSecret: paymentIntent.clientSecret,
      paymentIntentId: paymentIntent.id,
      summary: snapshot.summary,
      lineItems: snapshot.lineItems,
      shippingMethod: snapshot.shippingMethod,
      totals: snapshot.totals,
      reservation: { expiresAt: snapshot.expiresAt, phase: snapshot.reservationPhase, paymentStartedAt: snapshot.paymentStartedAt },
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
