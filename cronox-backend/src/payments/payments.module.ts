import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentIntentFactory } from './payment-intent.factory';
import { PaymentsApiController } from './payments-api.controller';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, PaymentsApiController, StripeWebhookController],
  providers: [StripeService, PaymentIntentFactory],
})
export class PaymentsModule {}
