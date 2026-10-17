import { ConflictException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CheckoutEffect, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { stripeWebhookLease } from './stripe-webhook-fence';

const LEASE_MS = 60_000;
const RETRY_MS = 15_000;
type Handler = (event: Stripe.Event) => Promise<Record<string, unknown>>;
export type EffectOutcome = 'accepted' | 'queued' | 'not_needed' | 'busy' | 'retry_required' | 'uncertain';

@Injectable()
export class StripeWebhookRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StripeWebhookRecoveryService.name);
  private handler?: Handler;
  private effectHandler?: (effect: CheckoutEffect) => Promise<EffectOutcome>;
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private disabledReason: string | null = 'NOT_STARTED';
  private startedAt: Date | null = null;
  private lastScanStartedAt: Date | null = null;
  private lastScanCompletedAt: Date | null = null;
  private lastScanErrorAt: Date | null = null;
  private lastScanError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  register(handler: Handler, effectHandler: (effect: CheckoutEffect) => Promise<EffectOutcome>) {
    this.handler = handler;
    this.effectHandler = effectHandler;
  }

  onModuleInit() {
    // This is recovery of accepted financial obligations, independent of
    // optional marketing jobs. Smoke/tests may explicitly disable the worker.
    this.disabledReason = process.env.CRONOX_LOCAL_DEV === 'true' ? 'LOCAL_REVIEW'
      : process.env.CRONOX_ROUTE_SMOKE_MODE === 'true' ? 'ROUTE_SMOKE'
      : process.env.STRIPE_WEBHOOK_WORKER_ENABLED === 'false' ? 'EXPLICITLY_DISABLED' : null;
    if (this.disabledReason) {
      this.logger.log(`Stripe recovery worker disabled: ${this.disabledReason}`);
      return;
    }
    this.startedAt = new Date();
    this.logger.log('Stripe recovery worker started; poll=5000ms lease=60000ms');
    this.timer = setInterval(() => void this.tick().catch(error => this.logger.error('Stripe recovery worker failed', error)), 5_000);
    this.timer.unref();
    void this.tick().catch(error => this.logger.error('Stripe recovery startup failed', error));
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.disabledReason = 'STOPPED';
  }

  async accept(event: Stripe.Event, metadata: { paymentIntentId?: string; lifecycleStatus?: string; amountCents?: number; refundCumulativeCents?: number }) {
    if (metadata.paymentIntentId && await this.prisma.archivedCheckoutPayment.findUnique({ where: { paymentIntentId: metadata.paymentIntentId }, select: { paymentIntentId: true } })) {
      return { received: true, duplicate: true, archived: true };
    }
    // The caller has already verified the raw signature and production mode.
    // Immutable first payload prevents a duplicate from replacing queued work.
    const payload = JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
    await this.prisma.stripeWebhookEvent.createMany({
      data: [{ id: event.id, type: event.type, occurredAt: new Date(event.created * 1000), ...metadata, status: 'PENDING', payload, nextAttemptAt: new Date() }],
      skipDuplicates: true,
    });
    await this.prisma.stripeWebhookEvent.updateMany({
      where: { id: event.id, payload: { equals: Prisma.DbNull }, status: { not: 'PROCESSED' }, error: 'LEGACY_VERIFIED_PAYLOAD_REQUIRED' },
      data: { payload, status: 'PENDING', error: null, nextAttemptAt: new Date() },
    });
    return this.process(event.id);
  }

  async process(id: string): Promise<Record<string, unknown>> {
    if (!this.handler) throw new Error('STRIPE_RECOVERY_HANDLER_NOT_READY');
    const token = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.stripeWebhookEvent.updateMany({
      where: { id, payload: { not: Prisma.DbNull }, OR: [
        { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
        { status: 'PROCESSING', leaseUntil: { lte: now } },
      ] },
      data: { status: 'PROCESSING', leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 }, error: null },
    });
    if (!claimed.count) {
      const existing = await this.prisma.stripeWebhookEvent.findUnique({ where: { id }, select: { status: true } });
      return { received: true, duplicate: existing?.status === 'PROCESSED', queued: existing?.status !== 'PROCESSED', reviewRequired: existing?.status === 'REVIEW' };
    }
    const heartbeat = setInterval(() => {
      void this.prisma.stripeWebhookEvent.updateMany({ where: { id, leaseToken: token, status: 'PROCESSING' }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
        .catch(error => this.logger.error(`Stripe lease renewal failed: ${id}`, error));
    }, LEASE_MS / 3);
    heartbeat.unref();
    try {
      const row = await this.prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { id } });
      const response = await stripeWebhookLease.run({ id, token }, () => this.handler!(row.payload as unknown as Stripe.Event));
      const finished = await this.prisma.stripeWebhookEvent.updateMany({
        where: { id, leaseToken: token, status: 'PROCESSING', leaseUntil: { gt: new Date() } },
        data: { status: 'PROCESSED', processedAt: new Date(), result: response as Prisma.InputJsonValue, error: null, leaseUntil: null, leaseToken: null },
      });
      if (!finished.count) throw new Error('STRIPE_WEBHOOK_LEASE_LOST');
      return response;
    } catch (error) {
      // An invariant failure needs an operator; a DB/connection/unknown failure
      // is retryable, including an uncertain commit. Neither authorizes refund.
      const review = error instanceof HttpException && [400, 404, 409].includes(error.getStatus());
      await this.prisma.stripeWebhookEvent.updateMany({
        where: { id, leaseToken: token, status: 'PROCESSING' },
        data: { status: review ? 'REVIEW' : 'FAILED', error: this.errorCode(error), leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + RETRY_MS) },
      });
      if (review) {
        this.logger.error(`Stripe payment requires review: ${id}; ${this.errorCode(error)}`);
        return { received: true, reviewRequired: true };
      }
      throw error;
    } finally { clearInterval(heartbeat); }
  }

  async tick() {
    if (this.running || !this.handler) return;
    this.running = true;
    this.lastScanStartedAt = new Date();
    try {
      const now = new Date();
      const events = await this.prisma.stripeWebhookEvent.findMany({
        where: { payload: { not: Prisma.DbNull }, OR: [
          { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
          { status: 'PROCESSING', leaseUntil: { lte: now } },
        ] }, orderBy: { nextAttemptAt: 'asc' }, take: 20, select: { id: true },
      });
      for (const event of events) {
        try { await this.process(event.id); }
        catch (error) { this.logger.error(`Stripe event retry failed: ${event.id}`, error); }
      }
      await this.processEffects();
      this.lastScanCompletedAt = new Date();
      this.lastScanError = null;
    } catch (error) {
      this.lastScanErrorAt = new Date();
      this.lastScanError = 'RECOVERY_SCAN_FAILED';
      throw error;
    } finally { this.running = false; }
  }

  async processEffects() {
    if (!this.effectHandler) return;
    const now = new Date();
    // A process may have died after SMTP acceptance and before recording it.
    // Never turn that uncertainty into an automatic duplicate email.
    await this.prisma.checkoutEffect.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lte: now }, kind: { not: 'ANALYTICS' } }, data: { status: 'REVIEW', error: 'DELIVERY_OUTCOME_UNKNOWN', leaseToken: null, leaseUntil: null } });
    await this.prisma.checkoutEffect.updateMany({ where: { status: 'PROCESSING', leaseUntil: { lte: now }, kind: 'ANALYTICS' }, data: { status: 'PENDING', leaseToken: null, leaseUntil: null } });
    const effects = await this.prisma.checkoutEffect.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: 20 });
    for (const effect of effects) {
      const token = randomUUID();
      const claimed = await this.prisma.checkoutEffect.updateMany({ where: { id: effect.id, status: 'PENDING' }, data: { status: 'PROCESSING', leaseToken: token, leaseUntil: new Date(Date.now() + LEASE_MS), attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try {
        const outcome = await this.effectHandler(effect);
        const status = ['accepted', 'queued', 'not_needed'].includes(outcome) ? 'COMPLETED' : outcome === 'uncertain' ? 'REVIEW' : 'PENDING';
        await this.prisma.checkoutEffect.updateMany({ where: { id: effect.id, status: 'PROCESSING', leaseToken: token }, data: { status, result: outcome, error: outcome === 'uncertain' ? 'DELIVERY_OUTCOME_UNKNOWN' : null, leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + RETRY_MS) } });
      } catch (error) {
        await this.prisma.checkoutEffect.updateMany({ where: { id: effect.id, status: 'PROCESSING', leaseToken: token }, data: { status: effect.kind === 'ANALYTICS' ? 'PENDING' : 'REVIEW', error: this.errorCode(error), leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(Date.now() + RETRY_MS) } });
        this.logger.error(`Checkout auxiliary task failed: ${effect.id}`, error);
      }
    }
  }

  async incidents() {
    const [events, effects] = await Promise.all([
      this.prisma.stripeWebhookEvent.findMany({ where: { status: { in: ['REVIEW', 'FAILED', 'PROCESSING', 'PENDING'] } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, type: true, paymentIntentId: true, status: true, error: true, attempts: true, createdAt: true, nextAttemptAt: true, leaseUntil: true } }),
      this.prisma.checkoutEffect.findMany({ where: { status: { not: 'COMPLETED' } }, orderBy: { createdAt: 'asc' }, take: 100, select: { id: true, orderId: true, kind: true, status: true, error: true, result: true, attempts: true, createdAt: true, nextAttemptAt: true } }),
    ]);
    return { events, effects, worker: {
      enabled: Boolean(this.timer), disabledReason: this.disabledReason,
      running: this.running, startedAt: this.startedAt,
      pollIntervalMs: 5000, leaseMs: LEASE_MS, retryDelayMs: RETRY_MS,
      lastScanStartedAt: this.lastScanStartedAt, lastScanCompletedAt: this.lastScanCompletedAt,
      lastScanErrorAt: this.lastScanErrorAt, lastScanError: this.lastScanError,
    } };
  }

  async retry(kind: 'event' | 'effect', id: string, actorId: number, acknowledgeUncertainDelivery = false) {
    return this.prisma.$transaction(async tx => {
      const count = kind === 'event'
        ? await tx.stripeWebhookEvent.updateMany({ where: { id, status: { in: ['REVIEW', 'FAILED'] }, payload: { not: Prisma.DbNull } }, data: { status: 'PENDING', nextAttemptAt: new Date(), error: null } })
        : await tx.checkoutEffect.updateMany({ where: { id, status: 'REVIEW', ...(acknowledgeUncertainDelivery ? {} : { kind: 'ANALYTICS' }) }, data: { status: 'PENDING', nextAttemptAt: new Date(), error: null } });
      if (!count.count) throw new ConflictException('RECOVERY_NOT_RETRYABLE_OR_ACKNOWLEDGEMENT_REQUIRED');
      await tx.auditLog.create({ data: { actorId, actionType: 'CHECKOUT_RECOVERY_RETRY', targetType: kind, targetId: id, metadata: { acknowledgeUncertainDelivery } } });
      return { queued: true };
    });
  }

  async resolveRefunded(id: string, actorId: number) {
    return this.prisma.$transaction(async tx => {
      const event = await tx.stripeWebhookEvent.findUnique({ where: { id } });
      if (!event?.paymentIntentId || !['REVIEW', 'FAILED'].includes(event.status)) throw new ConflictException('RECOVERY_NOT_REVIEWABLE');
      const snapshot = await tx.checkoutSnapshot.findUnique({ where: { stripePaymentIntentId: event.paymentIntentId }, select: { id: true } });
      if (!snapshot) throw new ConflictException('VERIFIED_REFUND_REQUIRED');
      await tx.checkoutSnapshot.update({ where: { id: snapshot.id }, data: { updatedAt: new Date() } });
      const current = await tx.checkoutSnapshot.findUniqueOrThrow({ where: { id: snapshot.id }, include: { order: true } });
      const refund = await tx.stripeWebhookEvent.findFirst({ where: { paymentIntentId: event.paymentIntentId, type: 'charge.refunded', lifecycleStatus: 'REFUNDED', status: 'PROCESSED' }, select: { id: true } });
      const held = await tx.checkoutStockReservation.count({ where: { checkoutSnapshotId: snapshot.id, status: { in: ['RESERVED', 'CONSUMED'] } } });
      if (!refund || current.status !== 'REFUNDED' || (current.order && current.order.status !== 'REFUNDED') || held) throw new ConflictException('VERIFIED_REFUND_REQUIRED');
      const changed = await tx.stripeWebhookEvent.updateMany({ where: { id, status: { in: ['REVIEW', 'FAILED'] } }, data: { status: 'PROCESSED', processedAt: new Date(), error: null, leaseToken: null, leaseUntil: null, result: { resolvedByVerifiedRefund: refund.id } } });
      if (!changed.count) throw new ConflictException('RECOVERY_NOT_REVIEWABLE');
      await tx.auditLog.create({ data: { actorId, actionType: 'CHECKOUT_RECOVERY_REFUND_RESOLVED', targetType: 'event', targetId: id, metadata: { verifiedRefundEventId: refund.id } } });
      return { resolved: true };
    });
  }

  private errorCode(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 500); }
}
