import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export type CheckoutPaymentIntentResult = {
  id: string;
  clientSecret: string;
};

export type CreatePaymentIntentForCheckoutArgs = {
  checkoutSnapshotId: string;
  amount: number;
  currency: string;
};

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);
  private readonly webhookSecret: string;
  private readonly paymentDescription: string;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    this.webhookSecret =
      this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.paymentDescription =
      this.configService.get<string>('STRIPE_PAYMENT_DESCRIPTION') ??
      'CRONOX Order';

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
    });
  }

  async createPaymentIntentForCheckout(
    args: CreatePaymentIntentForCheckoutArgs,
  ): Promise<CheckoutPaymentIntentResult> {
    if (!Number.isSafeInteger(args.amount) || args.amount < 0) {
      throw new BadRequestException('STRIPE_INVALID_PAYMENT_AMOUNT');
    }

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount: args.amount,
        currency: args.currency,
        metadata: { checkoutSnapshotId: args.checkoutSnapshotId },
        description: this.paymentDescription,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: `checkout:${args.checkoutSnapshotId}` },
    );

    if (!paymentIntent.client_secret) {
      this.logger.error(
        `Stripe PaymentIntent ${paymentIntent.id} has no client_secret`,
      );
      throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
    }

    return { id: paymentIntent.id, clientSecret: paymentIntent.client_secret };
  }

  async getReusableCheckoutPaymentIntent(args: {
    paymentIntentId: string;
    checkoutSnapshotId: string;
    amount: number;
    currency: string;
  }): Promise<CheckoutPaymentIntentResult> {
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
      throw new ConflictException('STRIPE_PAYMENT_INTENT_NOT_REUSABLE');
    }
    if (!paymentIntent.client_secret) {
      throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
    }
    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
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
