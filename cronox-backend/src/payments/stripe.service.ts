import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { createHash } from 'crypto';

export type CreateOrReusePaymentIntentArgs = {
  userId: number;
  cartId: number;
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  paymentIntentId?: string;
};

export type CreateOrReusePaymentIntentResult = {
  id: string;
  clientSecret: string;
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

    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.paymentDescription =
      this.configService.get<string>('STRIPE_PAYMENT_DESCRIPTION') ?? 'CRONOX Order';

    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
    });
  }

  async createOrReusePaymentIntent(
    args: CreateOrReusePaymentIntentArgs,
  ): Promise<CreateOrReusePaymentIntentResult> {
    const {
      userId,
      cartId,
      amount,
      currency,
      metadata: extraMetadata,
      paymentIntentId,
    } = args;
    const metadata = {
      userId: String(userId),
      cartId: String(cartId),
      ...(extraMetadata ?? {}),
    };

    if (paymentIntentId) {
      const refreshedIntent = await this.refreshPaymentIntent(paymentIntentId, {
        userId,
        cartId,
        amount,
        currency,
        metadata,
      });

      if (!refreshedIntent.client_secret) {
        this.logger.error(
          `Stripe PaymentIntent ${refreshedIntent.id} has no client_secret after refresh`,
        );
        throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
      }

      return {
        id: refreshedIntent.id,
        clientSecret: refreshedIntent.client_secret,
      };
    }

    const metadataFingerprintRaw = Object.entries(metadata)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
    const metadataFingerprint = createHash('sha256')
      .update(metadataFingerprintRaw)
      .digest('hex')
      .slice(0, 24);

    const idempotencyKey = `payment:${userId}:${cartId}:${amount}:${metadataFingerprint}`; // [STRIPE]

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount,
        currency,
        metadata,
        description: this.paymentDescription,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey },
    );

    if (!paymentIntent.client_secret) {
      this.logger.error(`Stripe PaymentIntent ${paymentIntent.id} has no client_secret`);
      throw new BadRequestException('STRIPE_PAYMENT_INTENT_NO_CLIENT_SECRET');
    }

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    };
  }

  private async refreshPaymentIntent(
    paymentIntentId: string,
    args: {
      userId: number;
      cartId: number;
      amount: number;
      currency: string;
      metadata: Record<string, string>;
    },
  ): Promise<Stripe.PaymentIntent> {
    try {
      const existing = await this.stripe.paymentIntents.retrieve(paymentIntentId);

      if (existing.status !== 'requires_payment_method') {
        this.logger.warn(
          `PaymentIntent ${paymentIntentId} no editable (status=${existing.status}), creando uno nuevo`,
        );
        return this.stripe.paymentIntents.create({
          amount: args.amount,
          currency: args.currency,
          metadata: args.metadata,
          description: this.paymentDescription,
          automatic_payment_methods: { enabled: true },
        });
      }

      const ownerMatches =
        existing.metadata?.userId === String(args.userId) &&
        existing.metadata?.cartId === String(args.cartId);

      if (!ownerMatches) {
        this.logger.warn(
          `PaymentIntent ${paymentIntentId} no coincide con user/cart actuales, creando uno nuevo`,
        );
        return this.stripe.paymentIntents.create({
          amount: args.amount,
          currency: args.currency,
          metadata: args.metadata,
          description: this.paymentDescription,
          automatic_payment_methods: { enabled: true },
        });
      }

      return this.stripe.paymentIntents.update(paymentIntentId, {
        amount: args.amount,
        currency: args.currency,
        metadata: args.metadata,
        description: this.paymentDescription,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo refrescar PaymentIntent ${paymentIntentId}: ${
          error instanceof Error ? error.message : String(error)
        }. Creando uno nuevo.`,
      );
      return this.stripe.paymentIntents.create({
        amount: args.amount,
        currency: args.currency,
        metadata: args.metadata,
        description: this.paymentDescription,
        automatic_payment_methods: { enabled: true },
      });
    }
  }

  constructEventFromPayload(signature: string | string[] | undefined, rawBody: Buffer) {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    if (!signature || Array.isArray(signature)) {
      throw new BadRequestException('STRIPE_SIGNATURE_MISSING');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret); // [WEBHOOK]
      this.logger.debug(`Stripe signature validada para event=${event.id} type=${event.type}`);
      return event;
    } catch (error) {
      this.logger.error('Stripe webhook signature verification failed', error as Error);
      throw new BadRequestException('STRIPE_SIGNATURE_VERIFICATION_FAILED');
    }
  }

  async getChargeBillingEmailForPaymentIntent(
    paymentIntent: Stripe.PaymentIntent,
  ): Promise<string | undefined> {
    const latestCharge = paymentIntent.latest_charge;

    if (latestCharge && typeof latestCharge !== 'string') {
      const email = latestCharge.billing_details?.email?.trim();
      if (email) return email;
    }

    const latestChargeId =
      typeof latestCharge === 'string' ? latestCharge : latestCharge?.id;

    if (latestChargeId) {
      const charge = await this.stripe.charges.retrieve(latestChargeId);
      const email = charge.billing_details?.email?.trim();
      if (email) return email;
    }

    const expandedIntent = await this.stripe.paymentIntents.retrieve(paymentIntent.id, {
      expand: ['latest_charge'],
    });
    const expandedLatestCharge = expandedIntent.latest_charge;

    if (expandedLatestCharge && typeof expandedLatestCharge !== 'string') {
      const email = expandedLatestCharge.billing_details?.email?.trim();
      if (email) return email;
    }

    return undefined;
  }
}
