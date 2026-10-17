import { Module } from '@nestjs/common';
import { BankTransferService } from './bank-transfer.service';
import { BankTransferController } from './bank-transfer.controller';
import { CartModule } from '../cart/cart.module';
import { EmailModule } from '../email/email.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentIntentFactory } from './payment-intent.factory';
import { CheckoutReservationCleanupService } from './checkout-reservation-cleanup.service';
import { PaymentsApiController } from './payments-api.controller';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AccessAuthModule } from '../auth/access-auth.module';
import { AuthModule } from '../auth/auth.module';
import { LiveStatsModule } from '../live-stats/live-stats.module';
import { StripeWebhookRecoveryService } from './stripe-webhook-recovery.service';

@Module({
  imports: [OrdersModule, CartModule, EmailModule, AnalyticsModule, AccessAuthModule, AuthModule, LiveStatsModule],
  controllers: [PaymentsController, PaymentsApiController, StripeWebhookController, BankTransferController],
  providers: [
    StripeService,
    BankTransferService,
    PaymentIntentFactory,
    CheckoutReservationCleanupService,
    StripeWebhookRecoveryService,
  ],
  exports: [StripeService],
})
export class PaymentsModule {}
