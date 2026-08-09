import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { StripeService } from './stripe.service';

const CLEANUP_INTERVAL_MS = 60_000;
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

  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(() => {
      void this.releaseExpiredReservations();
    }, CLEANUP_INTERVAL_MS);
    this.interval.unref?.();
    void this.releaseExpiredReservations();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private async releaseExpiredReservations(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const snapshots = await this.ordersService.listExpiredCheckoutSnapshots(
        CLEANUP_BATCH_SIZE,
      );
      let released = 0;

      for (const snapshot of snapshots) {
        try {
          if (snapshot.stripePaymentIntentId) {
            await this.stripeService.cancelCheckoutPaymentIntent(
              snapshot.stripePaymentIntentId,
              snapshot.id,
            );
          }
          await this.ordersService.releaseCheckoutSnapshot(
            snapshot.id,
            'EXPIRED',
            snapshot.stripePaymentIntentId ?? undefined,
          );
          released += 1;
        } catch {
          // Do not release stock unless Stripe cancellation is confirmed. The
          // next bounded run retries transient provider/database failures.
        }
      }

      if (released > 0) {
        this.logger.log(`Released ${released} expired checkout reservation(s)`);
      }
    } catch {
      this.logger.error('Expired checkout reservation cleanup failed');
    } finally {
      this.running = false;
    }
  }
}
