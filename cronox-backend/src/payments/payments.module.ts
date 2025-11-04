import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [StripeService],
})
export class PaymentsModule {}
