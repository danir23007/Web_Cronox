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
import { OrderStatus } from '@prisma/client';
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
import { isProductionEnvironment } from '../common/config/environment';
import { AuthService } from '../auth/auth.service';

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
    private readonly authService: AuthService,
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

    this.assertLiveModeInProduction(event);

    this.logger.log(`Evento Stripe verificado: ${event.type} (${event.id})`);

    const paymentIntentId = this.extractPaymentIntentId(event);
    const lifecycleStatus = this.getLifecycleStatus(event);
    const closedLostDisputeAmountCents =
      this.getClosedLostDisputeAmountCents(event);
    const claimed = await this.ordersService.claimStripeWebhookEvent({
      id: event.id,
      type: event.type,
      paymentIntentId,
      occurredAt: new Date(event.created * 1000),
      lifecycleStatus,
      amountCents: closedLostDisputeAmountCents,
    });

    if (!claimed) {
      return { received: true, duplicate: true };
    }

    try {
      let response: Record<string, unknown>;
      switch (event.type) {
        case 'checkout.session.completed':
          response = await this.handleCheckoutSessionCompleted(event);
          break;
        case 'payment_intent.succeeded':
          response = await this.handlePaymentIntentSucceeded(event);
          break;
        case 'payment_intent.payment_failed':
          response = await this.handlePaymentIntentFailed(event);
          break;
        case 'payment_intent.canceled':
          response = await this.handlePaymentIntentCanceled(event);
          break;
        case 'charge.succeeded':
          response = await this.handleChargeSucceeded(event);
          break;
        case 'charge.refunded':
          response = await this.handleChargeRefunded(event);
          break;
        case 'charge.dispute.created':
        case 'charge.dispute.funds_withdrawn':
        case 'charge.dispute.funds_reinstated':
        case 'charge.dispute.closed':
          response = await this.handleChargeDispute(
            event,
            lifecycleStatus,
            closedLostDisputeAmountCents,
          );
          break;
        default:
          this.logger.debug(`Evento de Stripe ignorado: ${event.type}`);
          response = { received: true, ignored: true };
      }

      await this.ordersService.completeStripeWebhookEvent(event.id);
      return response;
    } catch (error) {
      await this.ordersService.failStripeWebhookEvent(event.id, error);
      throw error;
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
    return this.handleVerifiedPaymentIntentSucceeded(
      event.data.object as Stripe.PaymentIntent,
      new Date(event.created * 1000),
    );
  }
  private async handleVerifiedPaymentIntentSucceeded(
    paymentIntent: Stripe.PaymentIntent,
    occurredAt: Date,
  ): Promise<Record<string, unknown>> {
    if (paymentIntent.status !== 'succeeded') {
      throw new BadRequestException('STRIPE_PAYMENT_NOT_SUCCEEDED');
    }

    const checkoutSnapshotId = paymentIntent.metadata?.checkoutSnapshotId?.trim();
    if (!checkoutSnapshotId) {
      throw new BadRequestException('STRIPE_CHECKOUT_SNAPSHOT_REQUIRED');
    }

    const amountCents = paymentIntent.amount_received ?? paymentIntent.amount;
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new BadRequestException('STRIPE_PAYMENT_AMOUNT_REQUIRED');
    }

    let result;
    try {
      result = await this.ordersService.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId,
        paymentIntentId: paymentIntent.id,
        amountCents,
        currency: (paymentIntent.currency ?? '').toUpperCase(),
        occurredAt,
      });
    } catch (error) {
      // A signed successful charge must not be left unfulfilled if persistence
      // or a reservation invariant fails. The deterministic refund key makes
      // webhook retries safe until Stripe confirms the compensating refund.
      await this.stripeService.refundPaymentIntent(
        paymentIntent.id,
        `checkout-compensation:${paymentIntent.id}`,
      );
      await this.ordersService.applyStripePaymentLifecycle(
        paymentIntent.id,
        OrderStatus.REFUNDED,
      );
      this.logger.error(
        `Compensated checkout fulfillment failure for PaymentIntent ${paymentIntent.id}`,
      );
      return { received: true, refunded: true };
    }

    if (result.status === OrderStatus.PAID) {
      await this.sendInitialPasswordSetupSafely(result.userId);
      await this.sendConfirmationEmailOnce(result);
    }

    return {
      received: true,
      created: result.created,
      orderId: result.orderId,
    };
  }

  private async sendInitialPasswordSetupSafely(
    userId: number | null,
  ): Promise<void> {
    if (userId == null) return;
    try {
      await this.authService.sendInitialPasswordSetupIfNeeded(userId);
    } catch (error) {
      // A paid order remains authoritative even if token persistence or email
      // delivery is temporarily unavailable. Normal forgot-password remains a
      // recovery path for passwordless automatically-created accounts.
      this.logger.error(
        `No se pudo solicitar el email de configuración inicial para userId=${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async sendConfirmationEmailOnce(result: {
    orderId: number;
    checkoutSnapshotId: string;
    status: OrderStatus;
  }): Promise<void> {
    if (result.status !== OrderStatus.PAID) return;
    if (!(await this.ordersService.claimOrderConfirmationEmail(result.checkoutSnapshotId))) {
      return;
    }

    try {
      const orderForEmail = await this.prisma.order.findUnique({
        where: { id: result.orderId },
        ...orderForConfirmationEmailInclude,
      });
      if (!orderForEmail) {
        await this.ordersService.releaseOrderConfirmationEmailClaim(
          result.checkoutSnapshotId,
        );
        this.logger.warn(
          `No se pudo resolver el pedido o email de confirmación para checkout ${result.checkoutSnapshotId}`,
        );
        return;
      }

      const customerEmail =
        orderForEmail.customerEmail?.trim() || orderForEmail.user?.email?.trim();
      if (!customerEmail) {
        await this.ordersService.releaseOrderConfirmationEmailClaim(
          result.checkoutSnapshotId,
        );
        this.logger.warn(
          `No se pudo resolver el email de confirmaciÃ³n para checkout ${result.checkoutSnapshotId}`,
        );
        return;
      }

      const templateData = this.orderConfirmationEmailMapper.map(orderForEmail);
      templateData.customerEmail = customerEmail;
      await this.emailService.send({
        type: EmailType.ORDER_CONFIRMATION,
        to: customerEmail,
        subject: 'CRONOX · Confirmación de pedido',
        templateData,
      });
      await this.ordersService.markOrderConfirmationEmailSent(
        result.checkoutSnapshotId,
      );
    } catch (error) {
      await this.ordersService.releaseOrderConfirmationEmailClaim(
        result.checkoutSnapshotId,
      );
      this.logger.error(
        `Error enviando email de confirmación para checkout ${result.checkoutSnapshotId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private extractPaymentIntentId(event: Stripe.Event): string | undefined {
    const payload = event.data.object as {
      id?: string;
      payment_intent?: string | { id?: string } | null;
    };
    if (event.type.startsWith('payment_intent.')) {
      return payload.id;
    }

    const ref = payload.payment_intent;
    return typeof ref === 'string' ? ref : ref?.id;
  }

  private getLifecycleStatus(
    event: Stripe.Event,
  ):
    | typeof OrderStatus.REFUNDED
    | typeof OrderStatus.DISPUTED
    | typeof OrderStatus.PAID
    | undefined {
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      if (this.isFullyRefundedCharge(charge)) {
        return OrderStatus.REFUNDED;
      }
      return undefined;
    }
    if (
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.funds_withdrawn'
    ) {
      return OrderStatus.DISPUTED;
    }
    if (event.type === 'charge.dispute.funds_reinstated') {
      return OrderStatus.PAID;
    }
    if (event.type === 'charge.dispute.closed') {
      const dispute = event.data.object as Stripe.Dispute;
      const disputeStatus = String(dispute.status);
      if (
        disputeStatus === 'won' ||
        disputeStatus === 'warning_closed' ||
        disputeStatus === 'prevented'
      ) {
        return OrderStatus.PAID;
      }
      // Closed losses are resolved against the immutable checkout total by
      // handleChargeDispute. It will record PAID-with-partial-loss or a full
      // REFUNDED lifecycle without treating every lost dispute as full.
      if (disputeStatus === 'lost') return undefined;
      return OrderStatus.DISPUTED;
    }
    return undefined;
  }

  private async handleChargeDispute(
    event: Stripe.Event,
    lifecycleStatus:
      | typeof OrderStatus.REFUNDED
      | typeof OrderStatus.DISPUTED
      | typeof OrderStatus.PAID
      | undefined,
    closedLostDisputeAmountCents?: number,
  ): Promise<Record<string, unknown>> {
    const paymentIntentId = this.extractPaymentIntentId(event);
    if (!paymentIntentId) {
      this.logger.warn(`Evento de disputa sin payment_intent: ${event.id}`);
      return { received: true };
    }

    if (closedLostDisputeAmountCents !== undefined) {
      await this.ordersService.recordStripeClosedLostDispute({
        eventId: event.id,
        paymentIntentId,
        amountCents: closedLostDisputeAmountCents,
      });
      await this.ordersService.reconcileStripePaymentLifecycle(paymentIntentId);
      return { received: true };
    }

    if (!lifecycleStatus) {
      this.logger.warn(`Evento de disputa sin estado conciliable: ${event.id}`);
      return { received: true };
    }

    await this.ordersService.reconcileStripePaymentLifecycle(paymentIntentId);
    return { received: true };
  }

  private async handlePaymentIntentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    // Stripe can retry the same PaymentIntent after payment_failed. Its stock
    // reservation remains held until Stripe sends a terminal cancellation.
    this.logger.warn(
      `PaymentIntent ${paymentIntent.id} ha fallado con estado ${paymentIntent.status}`,
    );
    return { received: true };
  }

  private async handlePaymentIntentCanceled(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    await this.ordersService.releaseCheckoutSnapshotForCanceledPaymentIntent(
      paymentIntent.id,
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
    if (!this.isFullyRefundedCharge(charge)) {
      // A partial refund must not transition the complete order, return all
      // stock, or grant a full purchase-history return.
      return { received: true, partial: true };
    }
    const paymentIntentRef =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentRef) {
      this.logger.warn('Evento charge.refunded sin payment_intent asociado');
      return { received: true };
    }

    await this.ordersService.reconcileStripePaymentLifecycle(paymentIntentRef);
    this.logger.log('Pedido Stripe conciliado tras un reembolso completo');

    return { received: true };
  }

  private isFullyRefundedCharge(charge: Stripe.Charge): boolean {
    if (charge.refunded === true) return true;
    return (
      Number.isSafeInteger(charge.amount) &&
      Number.isSafeInteger(charge.amount_refunded) &&
      charge.amount_refunded >= charge.amount
    );
  }

  private getClosedLostDisputeAmountCents(
    event: Stripe.Event,
  ): number | undefined {
    if (event.type !== 'charge.dispute.closed') return undefined;
    const dispute = event.data.object as Stripe.Dispute;
    if (String(dispute.status) !== 'lost') return undefined;
    return Number.isSafeInteger(dispute.amount) && dispute.amount > 0
      ? dispute.amount
      : undefined;
  }

  private assertLiveModeInProduction(event: Stripe.Event): void {
    if (isProductionEnvironment() && event.livemode !== true) {
      throw new BadRequestException('STRIPE_TEST_EVENT_REJECTED_IN_PRODUCTION');
    }
  }
}
