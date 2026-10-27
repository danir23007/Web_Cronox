import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { StripeService } from './stripe.service';
import type { CreatePaymentIntentForCheckoutArgs } from './stripe.service';
import { CHECKOUT_CLEANUP_INTERVAL_MS } from '../orders/checkout-reservation-policy';
import { localCheckoutTestEnabled } from './local-checkout-test';
import { writeCheckoutReservationOperationalStatus } from './recovery-operational-status';

const CLEANUP_INTERVAL_MS = CHECKOUT_CLEANUP_INTERVAL_MS;
const CLEANUP_BATCH_SIZE = 100;

/**
 * Releases inventory only after an expired PaymentIntent has been cancelled by
 * Stripe. This bounds abandoned checkout reservations without allowing an old
 * client secret to charge against inventory that has already been released.
 */
@Injectable()
export class CheckoutReservationCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CheckoutReservationCleanupService.name);
  private interval?: ReturnType<typeof setInterval>;
  private running = false;
  private lastPresencePrune = 0;
  private lastScanCompletedAt: Date | null = null;
  private lastScanError: string | null = null;

  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  onModuleInit(): void {
    if (process.env.CHECKOUT_RESERVATION_WORKER_ENABLED === 'false' ||
        (process.env.BACKGROUND_JOBS_ENABLED === 'false' && !localCheckoutTestEnabled()) ||
        process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') {
      writeCheckoutReservationOperationalStatus(this.operationalStatus());return;
    }
    this.interval = setInterval(() => {
      void this.releaseExpiredReservations();
    }, CLEANUP_INTERVAL_MS);
    this.interval.unref?.();
    writeCheckoutReservationOperationalStatus(this.operationalStatus());
    this.logger.log('Checkout reservation worker started; poll=1000ms retry=5000ms');
    void this.releaseExpiredReservations();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    writeCheckoutReservationOperationalStatus(this.operationalStatus());
  }

  operationalStatus() {
    return { enabled: Boolean(this.interval), running: this.running, pollIntervalMs: CLEANUP_INTERVAL_MS,
      retryDelayMs: 5000, lastScanCompletedAt: this.lastScanCompletedAt, lastScanError: this.lastScanError };
  }

  private async releaseExpiredReservations(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      if (Date.now() - this.lastPresencePrune >= 3600000) {
        await this.ordersService.pruneCheckoutPresence();
        this.lastPresencePrune = Date.now();
      }
      const snapshots =
        await this.ordersService.listExpiredCheckoutSnapshots(
          CLEANUP_BATCH_SIZE,
        );
      let released = 0;

      // A slow provider request must not serially block the whole batch.
      for (let offset = 0; offset < snapshots.length; offset += 8) {
        const results = await Promise.all(snapshots.slice(offset, offset + 8).map(snapshot => this.reconcile(snapshot.id)));
        released += results.filter(Boolean).length;
      }

      if (released > 0) {
        this.logger.log(`Reconciled ${released} expired checkout reservation(s)`);
      }
      this.lastScanCompletedAt = new Date();
      this.lastScanError = null;
    } catch {
      this.lastScanError = 'CHECKOUT_RESERVATION_SCAN_FAILED';
      this.logger.error('Expired checkout reservation cleanup failed');
    } finally {
      this.running = false;
      writeCheckoutReservationOperationalStatus(this.operationalStatus());
    }
  }

  async reconcile(id: string): Promise<boolean> {
    try {
      const snapshot = await this.ordersService.claimCheckoutExpiry(id);
      if (!snapshot) return false;
      let paymentIntentId = snapshot.stripePaymentIntentId;
      let account = snapshot.stripeAccountId;
      if (!paymentIntentId && snapshot.status === 'PAYMENT_INTENT_CREATING') {
        // Durable recovery of a crash/timeout after Stripe created the intent
        // but before binding. Never create with a possibly pruned (>24h) key.
        const requestedAt = snapshot.stripeCreateRequest && typeof snapshot.stripeCreateRequest === 'object' && 'requestedAt' in snapshot.stripeCreateRequest
          ? Date.parse(String(snapshot.stripeCreateRequest.requestedAt)) : snapshot.createdAt.getTime();
        if (!snapshot.stripeCreateRequest || !Number.isFinite(requestedAt) || Date.now() - requestedAt >= 23 * 60 * 60 * 1000) {
          throw new Error('CHECKOUT_CREATION_REQUIRES_RECONCILIATION');
        }
        const intent = await this.stripeService.createPaymentIntentForCheckout(snapshot.stripeCreateRequest as unknown as CreatePaymentIntentForCheckoutArgs);
        await this.ordersService.bindReconciledCheckoutIntent(snapshot.id, intent.id, intent.stripeAccountId);
        paymentIntentId = intent.id; account = intent.stripeAccountId;
      }
      if (paymentIntentId) {
        const intent = await this.stripeService.reconcileExpiredCheckoutPayment({ paymentIntentId, checkoutSnapshotId: snapshot.id, amount: snapshot.totalCents, currency: snapshot.currency, stripeAccountId: account });
        if (intent.status === 'succeeded') {
          await this.ordersService.createOrderFromVerifiedStripePayment({ checkoutSnapshotId: snapshot.id, paymentIntentId, amountCents: intent.amount_received, currency: intent.currency, occurredAt: new Date() });
          await this.ordersService.reconcileStripePaymentLifecycle(paymentIntentId);
          return true;
        }
        if (intent.status !== 'canceled') {
          await this.ordersService.deferCheckoutReconciliation(id);
          return false;
        }
      }
      await this.ordersService.releaseCheckoutSnapshot(id, 'EXPIRED', paymentIntentId ?? undefined);
      return true;
    } catch {
      await this.ordersService.deferCheckoutReconciliation(id).catch(() => undefined);
      this.logger.warn(`Checkout ${id}: provider reconciliation pending; inventory retained`);
      return false;
    }
  }
}
