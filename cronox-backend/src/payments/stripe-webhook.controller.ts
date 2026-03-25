import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import {
  orderForConfirmationEmailInclude,
  OrderConfirmationEmailMapper,
} from '../email/order-confirmation-email.mapper';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

@ApiTags('Payments / Stripe')
@Controller()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly ordersService: OrdersService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly orderConfirmationEmailMapper: OrderConfirmationEmailMapper,
  ) {}

  @Post('webhooks/stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Webhook de Stripe (firma requerida)',
    description: 'Endpoint para eventos de Stripe — no usar desde Swagger.',
  })
  async handleStripeWebhook(
    @Req() req: Request,
    @Body() _body: unknown,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.processEvent(req, signature, '/webhooks/stripe');
  }

  @Post('payments/webhook')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Alias del webhook de Stripe',
    description: 'Alias retrocompatible para Stripe CLI y configuraciones antiguas.',
  })
  async handleStripeWebhookAlias(
    @Req() req: Request,
    @Body() _body: unknown,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.processEvent(req, signature, '/payments/webhook');
  }

  private async processEvent(
    req: Request,
    signature: string | undefined,
    endpointPath: string,
  ): Promise<Record<string, unknown>> {
    const rawBody = req.body;

    this.logger.log(`Webhook Stripe recibido en ${endpointPath}`);

    if (!Buffer.isBuffer(rawBody)) {
      this.logger.error(
        `Stripe webhook body is not a raw Buffer en ${endpointPath}`,
      );
      throw new BadRequestException('STRIPE_RAW_BODY_REQUIRED');
    }

    const event = this.stripeService.constructEventFromPayload(signature, rawBody);

    this.logger.log(`Evento Stripe verificado: ${event.type} (${event.id})`);

    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutSessionCompleted(event);
      case 'payment_intent.succeeded':
        return this.handlePaymentIntentSucceeded(event);
      case 'payment_intent.payment_failed':
        return this.handlePaymentIntentFailed(event);
      case 'charge.succeeded':
        return this.handleChargeSucceeded(event);
      case 'charge.refunded':
        return this.handleChargeRefunded(event);
      default:
        this.logger.debug(`Evento de Stripe ignorado: ${event.type}`);
        return { received: true, ignored: true };
    }
  }

  private async handleCheckoutSessionCompleted(event: Stripe.Event) {
    const session = event.data.object as Stripe.Checkout.Session;
    const paymentIntentRef =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    this.logger.log(
      `checkout.session.completed recibido para session=${session.id} paymentIntent=${paymentIntentRef ?? 'N/A'}`,
    );

    return {
      received: true,
      sessionId: session.id,
      paymentIntent: paymentIntentRef ?? null,
    };
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const metadata = paymentIntent.metadata ?? {};
    const userId = Number(metadata.userId);

    this.logger.log(`Procesando payment_intent.succeeded para ${paymentIntent.id}`);

    if (!userId || Number.isNaN(userId)) {
      this.logger.error(
        `payment_intent.succeeded sin userId en metadata para ${paymentIntent.id}`,
      );
      throw new BadRequestException('STRIPE_METADATA_USER_REQUIRED');
    }

    const cartId = metadata.cartId ? Number(metadata.cartId) : undefined;
    const shippingMethod = metadata.shippingMethod;
    if (!shippingMethod || typeof shippingMethod !== 'string') {
      throw new BadRequestException('STRIPE_METADATA_SHIPPING_METHOD_REQUIRED');
    }

    const shippingCostCents = metadata.shippingCostCents;
    if (typeof shippingCostCents !== 'string') {
      throw new BadRequestException('STRIPE_METADATA_SHIPPING_COST_REQUIRED');
    }
    const itemsTotalCents = metadata.itemsTotalCents;
    if (typeof itemsTotalCents !== 'string') {
      throw new BadRequestException('STRIPE_METADATA_ITEMS_TOTAL_REQUIRED');
    }
    const promoCode =
      typeof metadata.promoCode === 'string' && metadata.promoCode.trim()
        ? metadata.promoCode
        : undefined;
    const discountCents =
      typeof metadata.discountCents === 'string' && metadata.discountCents.trim()
        ? metadata.discountCents
        : undefined;
    const amountCents =
      paymentIntent.amount_received ?? paymentIntent.amount ?? 0;
    const amount = (amountCents / 100).toFixed(2);
    const currency = (paymentIntent.currency ?? 'eur').toUpperCase();

    const metadataShippingAddress = this.parseShippingAddressFromMetadata(
      metadata.shippingAddress,
    );

    const shippingAddress = paymentIntent.shipping
      ? {
          name: paymentIntent.shipping.name,
          phone: paymentIntent.shipping.phone,
          address: paymentIntent.shipping.address,
        }
      : metadataShippingAddress ?? undefined;

    const order = await this.ordersService.createOrderFromWebhook(
      {
        provider: 'stripe',
        providerRef: paymentIntent.id,
        amount,
        currency,
        metadata: {
          userId,
          cartId,
          shippingMethod,
          shippingCostCents,
          itemsTotalCents,
          ...(metadataShippingAddress
            ? { shippingAddress: metadataShippingAddress }
            : {}),
          ...(promoCode ? { promoCode } : {}),
          ...(discountCents ? { discountCents } : {}),
        } as any,
        shippingAddress: shippingAddress as any,
        rawPayload: paymentIntent as unknown as Record<string, unknown>,
      },
      { updateStock: true },
    );

    const customerEmail = await this.resolveCustomerEmail(paymentIntent, userId);
    const orderId =
      typeof order.id === 'number' || typeof order.id === 'string'
        ? Number(order.id)
        : undefined;

    this.logger.log(
      `Pedido resuelto para paymentIntent=${paymentIntent.id}: orderId=${orderId ?? 'N/A'}`,
    );

    if (customerEmail && orderId) {
      try {
        const orderForEmail = await this.prisma.order.findUnique({
          where: { id: orderId },
          ...orderForConfirmationEmailInclude,
        });

        if (!orderForEmail) {
          this.logger.warn(`No se encontró pedido ${orderId} para email de confirmación`);
        } else {
          const templateData = this.orderConfirmationEmailMapper.map(orderForEmail);
          templateData.customerEmail = customerEmail;

          await this.emailService.send({
            type: EmailType.ORDER_CONFIRMATION,
            to: customerEmail,
            subject: 'CRONOX · Confirmación de pedido',
            templateData,
          });
        }
      } catch (error) {
        this.logger.error(
          `Error enviando email de confirmación para PaymentIntent ${paymentIntent.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    } else {
      this.logger.warn(
        `No se pudo enviar email de confirmación para PaymentIntent ${paymentIntent.id}: customerEmail=${customerEmail ?? 'N/A'} orderId=${orderId ?? 'N/A'}`,
      );
    }

    this.logger.log(`Pedido confirmado para PaymentIntent ${paymentIntent.id}`);

    return { received: true, order };
  }

  private parseShippingAddressFromMetadata(
    raw: unknown,
  ): Record<string, unknown> | null {
    if (typeof raw !== 'string' || !raw.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.warn(
        `No se pudo parsear metadata.shippingAddress: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async resolveCustomerEmail(
    paymentIntent: Stripe.PaymentIntent,
    userId: number,
  ): Promise<string | undefined> {
    const metadata = paymentIntent.metadata ?? {};
    const receiptEmail = paymentIntent.receipt_email?.trim();

    if (receiptEmail) {
      this.logger.debug(
        `Email resuelto desde paymentIntent.receipt_email para ${paymentIntent.id}`,
      );
      return receiptEmail;
    }

    const chargeBillingEmail = await this.stripeService.getChargeBillingEmailForPaymentIntent(
      paymentIntent,
    );
    if (chargeBillingEmail) {
      this.logger.debug(
        `Email resuelto desde charge.billing_details.email para ${paymentIntent.id}`,
      );
      return chargeBillingEmail;
    }

    const metadataEmail =
      typeof metadata.email === 'string' ? metadata.email.trim() : undefined;
    if (metadataEmail) {
      this.logger.debug(`Email resuelto desde metadata.email para ${paymentIntent.id}`);
      return metadataEmail;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    const userEmail = user?.email?.trim();

    if (userEmail) {
      this.logger.debug(
        `Email resuelto desde usuario en base de datos para ${paymentIntent.id}`,
      );
      return userEmail;
    }

    return undefined;
  }

  private async handlePaymentIntentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    this.logger.warn(
      `PaymentIntent ${paymentIntent.id} ha fallado con estado ${paymentIntent.status}`,
    );
    return { received: true };
  }

  private async handleChargeSucceeded(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    this.logger.debug(
      `charge.succeeded recibido para charge=${charge.id} paymentIntent=${typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? 'N/A'}`,
    );
    return { received: true };
  }

  private async handleChargeRefunded(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentRef =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentRef) {
      this.logger.warn('Evento charge.refunded sin payment_intent asociado');
      return { received: true };
    }

    await this.ordersService.markOrderAsRefunded(paymentIntentRef);
    this.logger.log(
      `Pedido con PaymentIntent ${paymentIntentRef} marcado como REFUNDED`,
    );

    return { received: true };
  }
}
