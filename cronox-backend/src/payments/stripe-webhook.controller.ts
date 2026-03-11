import {
  BadRequestException,
  Body,
  Controller,
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
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripeService: StripeService,
    private readonly ordersService: OrdersService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
    private readonly orderConfirmationEmailMapper: OrderConfirmationEmailMapper,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Webhook de Stripe (firma requerida)',
    description: 'Endpoint para eventos de Stripe — no usar desde Swagger.',
  })
  async handleStripeWebhook(@Req() req: Request, @Body() _body: unknown) {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.body;

    if (!Buffer.isBuffer(rawBody)) {
      this.logger.error('Stripe webhook body is not a raw Buffer');
      throw new BadRequestException('STRIPE_RAW_BODY_REQUIRED');
    }

    const event = this.stripeService.constructEventFromPayload(signature, rawBody);

    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.handlePaymentIntentSucceeded(event as Stripe.Event);
      case 'payment_intent.payment_failed':
        return this.handlePaymentIntentFailed(event as Stripe.Event);
      case 'charge.refunded':
        return this.handleChargeRefunded(event as Stripe.Event);
      default:
        this.logger.debug(`Evento de Stripe ignorado: ${event.type}`);
        return { received: true };
    }
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const metadata = paymentIntent.metadata ?? {};
    const userId = Number(metadata.userId);

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
      typeof metadata.discountCents === 'string' &&
      metadata.discountCents.trim()
        ? metadata.discountCents
        : undefined;
    const amountCents =
      paymentIntent.amount_received ?? paymentIntent.amount ?? 0;
    const amount = (amountCents / 100).toFixed(2);
    const currency = (paymentIntent.currency ?? 'eur').toUpperCase();

    const shippingAddress = paymentIntent.shipping
      ? {
          name: paymentIntent.shipping.name,
          phone: paymentIntent.shipping.phone,
          address: paymentIntent.shipping.address,
        }
      : undefined;

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
          ...(promoCode ? { promoCode } : {}),
          ...(discountCents ? { discountCents } : {}),
        } as any,
        shippingAddress: shippingAddress as any,
        rawPayload: paymentIntent as unknown as Record<string, unknown>,
      },
      { updateStock: true },
    );

    const customerEmail =
      paymentIntent.receipt_email ??
      (typeof metadata.customerEmail === 'string'
        ? metadata.customerEmail
        : undefined);
    const orderId =
      typeof order.id === 'number' || typeof order.id === 'string'
        ? Number(order.id)
        : undefined;

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

    this.logger.log(`Pedido confirmado para PaymentIntent ${paymentIntent.id}`); // [WEBHOOK]

    return order;
  }

  private async handlePaymentIntentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    this.logger.warn(
      `PaymentIntent ${paymentIntent.id} ha fallado con estado ${paymentIntent.status}`,
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

    await this.ordersService.markOrderAsRefunded(paymentIntentRef); // [STRIPE]
    this.logger.log(
      `Pedido con PaymentIntent ${paymentIntentRef} marcado como REFUNDED`,
    );

    return { received: true };
  }
}
