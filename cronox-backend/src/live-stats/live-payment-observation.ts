import { Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
/** Projection on the existing checkout, written only after webhook signature verification. */
@Injectable()
export class LivePaymentObservation {
  constructor(private readonly prisma: PrismaService) {}
  async record(event: Stripe.Event) {
    if (!event.type.startsWith('payment_intent.')) return;
    const intent = event.data.object as Stripe.PaymentIntent;
    if (!['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded'].includes(intent.status)) return;
    const at = new Date(event.created * 1000);
    await this.prisma.checkoutSnapshot.updateMany({
      where: {
        stripePaymentIntentId: intent.id,
        AND: [
          { OR: [{ paymentStatusAt: null }, { paymentStatusAt: { lte: at } }] },
          { OR: [{ paymentStatus: null }, { paymentStatus: { notIn: ['succeeded', 'canceled'] } }, { paymentStatus: intent.status }] },
        ],
      },
      data: { paymentStatus: intent.status, paymentStatusAt: at, paymentLiveMode: event.livemode },
    });
  }
}
