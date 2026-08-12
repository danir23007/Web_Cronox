import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  toIsoCountryCode,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';

export type CheckoutPaymentIntentResult = {
  id: string;
  clientSecret: string;
  stripeAccountId: string;
};

export type CreatePaymentIntentForCheckoutArgs = {
  checkoutSnapshotId: string;
  amount: number;
  currency: string;
  shippingAddress?: Record<string, string>;
};

export type MissingPaymentIntentRecoveryProof = {
  safe: boolean;
  stripeAccountId?: string;
  reason:
    | 'PROVEN_MISSING_WITHOUT_CHARGES'
    | 'STRIPE_ACCOUNT_MISMATCH'
    | 'STRIPE_ACCOUNT_UNKNOWN'
    | 'STRIPE_CHARGE_EXISTS'
    | 'STRIPE_PROOF_UNAVAILABLE';
};

export const CHECKOUT_PAYMENT_METHOD_TYPES = [
  'card',
  'klarna',
  'amazon_pay',
  'paypal',
] as const;
const CHECKOUT_PAYMENT_CONFIGURATION = 'cronox_checkout_v3';

export class CheckoutPaymentIntentCancelledException extends ConflictException {
  constructor(readonly stripeAccountId: string) {
    super('STRIPE_PAYMENT_INTENT_NOT_REUSABLE');
  }
}

export class CheckoutPaymentIntentConfigurationException extends ConflictException {
  constructor(readonly stripeAccountId: string) {
    super('STRIPE_PAYMENT_INTENT_CONFIGURATION_MISMATCH');
  }
}

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);
  private readonly webhookSecret: string;
  private readonly paymentDescription: string;
  private readonly testMode: boolean;
  private stripeAccountIdPromise?: Promise<string>;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    this.testMode = secretKey.startsWith('sk_test_');

    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.paymentDescription =
      this.configService.get<string>('STRIPE_PAYMENT_DESCRIPTION') ??
      'CRONOX Order';

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
    });
  }

  /**
   * Local test data can outlive the Stripe test account/key that created its
   * PaymentIntent. Live-mode missing resources remain fail-closed because the
   * previous payment state cannot be proven from the newly configured account.
   */
  isRecoverableTestModeMissingPaymentIntent(error: unknown): boolean {
    return this.testMode && this.isMissingPaymentIntentError(error);
  }

  isMissingPaymentIntentError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const stripeError = error as { statusCode?: unknown; code?: unknown };
    return (
      stripeError.statusCode === 404 && stripeError.code === 'resource_missing'
    );
  }

  async getCurrentStripeAccountId(): Promise<string> {
    if (!this.stripeAccountIdPromise) {
      this.stripeAccountIdPromise = this.stripe.accounts
        .retrieve()
        .then((account) => account.id)
        .catch((error) => {
          this.stripeAccountIdPromise = undefined;
          throw error;
        });
    }
    return this.stripeAccountIdPromise;
  }

  async proveMissingPaymentIntentCanBeRecovered(args: {
    paymentIntentId: string;
    expectedStripeAccountId: string | null;
  }): Promise<MissingPaymentIntentRecoveryProof> {
    try {
      const stripeAccountId = await this.getCurrentStripeAccountId();
      if (
        args.expectedStripeAccountId &&
        args.expectedStripeAccountId !== stripeAccountId
      ) {
        return { safe: false, reason: 'STRIPE_ACCOUNT_MISMATCH' };
      }
      if (!args.expectedStripeAccountId && !this.testMode) {
        return { safe: false, reason: 'STRIPE_ACCOUNT_UNKNOWN' };
      }

      const charges = await this.stripe.charges.list({
        payment_intent: args.paymentIntentId,
        limit: 1,
      });
      if (charges.data.length > 0) {
        return { safe: false, reason: 'STRIPE_CHARGE_EXISTS' };
      }
      return {
        safe: true,
        stripeAccountId,
        reason: 'PROVEN_MISSING_WITHOUT_CHARGES',
      };
    } catch {
      return { safe: false, reason: 'STRIPE_PROOF_UNAVAILABLE' };
    }
  }

  async createPaymentIntentForCheckout(
    args: CreatePaymentIntentForCheckoutArgs,
  ): Promise<CheckoutPaymentIntentResult> {
    if (!Number.isSafeInteger(args.amount) || args.amount < 0) {
      throw new BadRequestException('STRIPE_INVALID_PAYMENT_AMOUNT');
    }

    const stripeAccountId = await this.getCurrentStripeAccountId();
    const shipping = args.shippingAddress
      ? this.toStripeShippingAddress(args.shippingAddress)
      : undefined;
    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: args.amount,
        currency: args.currency,
        metadata: {
          checkoutSnapshotId: args.checkoutSnapshotId,
          checkoutPaymentConfiguration: CHECKOUT_PAYMENT_CONFIGURATION,
        },
        description: this.paymentDescription,
        payment_method_types: [...CHECKOUT_PAYMENT_METHOD_TYPES],
        ...(shipping ? { shipping } : {}),
      },
      { idempotencyKey: `checkout:${args.checkoutSnapshotId}` },
    );

    if (!paymentIntent.client_secret) {
      this.logger.error(
        `Stripe PaymentIntent ${paymentIntent.id} has no client_secret`,
      );
      throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
    }

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      stripeAccountId,
    };
  }

  private toStripeShippingAddress(
    address: Record<string, string>,
  ): Stripe.PaymentIntentCreateParams.Shipping {
    const country = toIsoCountryCode(address.country);
    if (!country) {
      throw new BadRequestException(UNSUPPORTED_COUNTRY_MESSAGE);
    }

    const name = String(address.name || address.fullName || '').trim();
    if (!name) {
      throw new BadRequestException('La dirección de envío necesita un nombre.');
    }

    return {
      name,
      ...(address.phone ? { phone: address.phone } : {}),
      address: {
        line1: address.line1 || address.address || undefined,
        line2: address.line2 || undefined,
        city: address.city || undefined,
        state: address.state || undefined,
        postal_code: address.postalCode || address.zip || undefined,
        country,
      },
    };
  }

  async getReusableCheckoutPaymentIntent(args: {
    paymentIntentId: string;
    checkoutSnapshotId: string;
    amount: number;
    currency: string;
  }): Promise<CheckoutPaymentIntentResult> {
    const stripeAccountId = await this.getCurrentStripeAccountId();
    const paymentIntent = await this.stripe.paymentIntents.retrieve(
      args.paymentIntentId,
    );
    this.assertCheckoutPaymentIntentBinding(paymentIntent, args);

    if (
      paymentIntent.status === 'succeeded' ||
      paymentIntent.status === 'processing'
    ) {
      throw new ConflictException('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
    }
    if (paymentIntent.status === 'canceled') {
      throw new CheckoutPaymentIntentCancelledException(stripeAccountId);
    }
    if (!this.hasCurrentCheckoutPaymentConfiguration(paymentIntent)) {
      throw new CheckoutPaymentIntentConfigurationException(stripeAccountId);
    }
    if (!paymentIntent.client_secret) {
      throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
    }
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      stripeAccountId,
    };
  }

  async cancelCheckoutPaymentIntent(
    paymentIntentId: string,
    checkoutSnapshotId: string,
  ): Promise<void> {
    const paymentIntent =
      await this.stripe.paymentIntents.retrieve(paymentIntentId);
    this.assertCheckoutPaymentIntentBinding(paymentIntent, {
      checkoutSnapshotId,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });

    if (paymentIntent.status === 'canceled') return;
    if (
      paymentIntent.status === 'succeeded' ||
      paymentIntent.status === 'processing'
    ) {
      throw new ConflictException('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
    }

    const cancelled = await this.stripe.paymentIntents.cancel(paymentIntentId);
    if (cancelled.status !== 'canceled') {
      throw new BadRequestException(
        'STRIPE_PAYMENT_INTENT_CANCEL_NOT_CONFIRMED',
      );
    }
  }

  async assertCheckoutPaymentIsNotConfirming(
    paymentIntentId: string,
    checkoutSnapshotId: string,
  ): Promise<void> {
    const paymentIntent =
      await this.stripe.paymentIntents.retrieve(paymentIntentId);
    this.assertCheckoutPaymentIntentBinding(paymentIntent, {
      checkoutSnapshotId,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
    if (
      paymentIntent.status === 'succeeded' ||
      paymentIntent.status === 'processing'
    ) {
      throw new ConflictException('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
    }
  }

  async refundPaymentIntent(
    paymentIntentId: string,
    idempotencyKey: string,
  ): Promise<{ id: string; status: string | null }> {
    const paymentIntent =
      await this.stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      throw new BadRequestException('STRIPE_PAYMENT_NOT_REFUNDABLE');
    }

    const refund = await this.stripe.refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey },
    );

    if (refund.status !== 'succeeded') {
      throw new BadRequestException('STRIPE_REFUND_NOT_CONFIRMED');
    }

    return { id: refund.id, status: refund.status };
  }

  private assertCheckoutPaymentIntentBinding(
    paymentIntent: Stripe.PaymentIntent,
    expected: {
      checkoutSnapshotId: string;
      amount: number;
      currency: string;
    },
  ): void {
    if (
      paymentIntent.metadata?.checkoutSnapshotId !==
        expected.checkoutSnapshotId ||
      paymentIntent.amount !== expected.amount ||
      paymentIntent.currency.toUpperCase() !== expected.currency.toUpperCase()
    ) {
      throw new ConflictException('STRIPE_PAYMENT_INTENT_SNAPSHOT_MISMATCH');
    }
  }

  private hasCurrentCheckoutPaymentConfiguration(
    paymentIntent: Stripe.PaymentIntent,
  ): boolean {
    if (
      paymentIntent.metadata?.checkoutPaymentConfiguration !==
      CHECKOUT_PAYMENT_CONFIGURATION
    ) {
      return false;
    }

    const actual = new Set(paymentIntent.payment_method_types);
    return (
      actual.size === CHECKOUT_PAYMENT_METHOD_TYPES.length &&
      CHECKOUT_PAYMENT_METHOD_TYPES.every((type) => actual.has(type))
    );
  }

  constructEventFromPayload(
    signature: string | string[] | undefined,
    rawBody: Buffer,
  ) {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    if (!signature || Array.isArray(signature)) {
      throw new BadRequestException('STRIPE_SIGNATURE_MISSING');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      ); // [WEBHOOK]
      this.logger.debug(
        `Stripe signature validada para event=${event.id} type=${event.type}`,
      );
      return event;
    } catch (error) {
      this.logger.error(
        'Stripe webhook signature verification failed',
        error as Error,
      );
      throw new BadRequestException('STRIPE_SIGNATURE_VERIFICATION_FAILED');
    }
  }
}
