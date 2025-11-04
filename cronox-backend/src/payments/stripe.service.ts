import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export type CreateOrReusePaymentIntentArgs = {
  userId: number;
  cartId: number;
  amount: number;
  currency: string;
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
    const { userId, cartId, amount, currency } = args;
    const metadata = {
      userId: String(userId),
      cartId: String(cartId),
    };

    const idempotencyKey = `payment:${userId}:${cartId}:${amount}`; // [STRIPE]

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

  constructEventFromPayload(signature: string | string[] | undefined, rawBody: Buffer) {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    if (!signature || Array.isArray(signature)) {
      throw new BadRequestException('STRIPE_SIGNATURE_MISSING');
    }

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret); // [WEBHOOK]
    } catch (error) {
      this.logger.error('Stripe webhook signature verification failed', error as Error);
      throw new BadRequestException('STRIPE_SIGNATURE_VERIFICATION_FAILED');
    }
  }
}
