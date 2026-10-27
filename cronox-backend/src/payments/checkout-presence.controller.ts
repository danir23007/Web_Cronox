import { Body, ConflictException, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CartService } from '../cart/cart.service';
import { OrdersService } from '../orders/orders.service';
import { resolveCheckoutOwnerIdentity } from '../orders/checkout-owner';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
import { CheckoutReservationCleanupService } from './checkout-reservation-cleanup.service';
import { StripeService } from './stripe.service';

export class CheckoutPresenceDto {
  @IsUUID() tabId!: string;
  @IsIn(['enter', 'restart', 'heartbeat', 'leave', 'depart']) action!: 'enter' | 'restart' | 'heartbeat' | 'leave' | 'depart';
}
export class StartCheckoutPaymentDto {
  @IsUUID() tabId!: string;
  @IsString() @MaxLength(64) checkoutSnapshotId!: string;
  @IsString() @MaxLength(255) paymentIntentId!: string;
}

@Controller('checkout')
@UseGuards(OptionalJwtAuthGuard)
export class CheckoutPresenceController {
  constructor(private readonly orders: OrdersService, private readonly cart: CartService, private readonly cleanup: CheckoutReservationCleanupService, private readonly stripe: StripeService) {}

  @Post('reservation')
  async presence(@Req() req: Request, @Body() dto: CheckoutPresenceDto) {
    let cart = await this.cart.getCheckoutCartForRequest(req);
    const owner = resolveCheckoutOwnerIdentity(req, cart);
    if (!cart) throw new ConflictException('EMPTY_CART');
    // Cart changes are explicit customer actions. Reconcile the old mutable
    // preparation before reserving the new variant/quantity set. A heartbeat
    // never replaces a protected/expired attempt.
    const previous = await this.orders.getActiveReservation(owner, cart.id);
    if (previous && !previous.paymentStartedAt && previous.reservationPhase === 'PRESENCE' && previous.expiresAt > new Date()
      && previous.cartUpdatedAt.getTime() !== cart.updatedAt.getTime() && !['leave', 'depart'].includes(dto.action)) {
      const claimed = await this.orders.claimCheckoutSnapshotReplacementForOwner(owner, cart.id, previous.id);
      if (!claimed) throw new ConflictException('CHECKOUT_REPLACEMENT_IN_PROGRESS');
      if (previous.stripePaymentIntentId) await this.stripe.cancelCheckoutPaymentIntent(previous.stripePaymentIntentId, previous.id);
      await this.orders.replaceCheckoutReservation(owner, previous.id, dto.action === 'heartbeat' ? dto.tabId : undefined);
      cart = await this.orders.reloadCheckoutCart(owner, cart.id);
    }
    if (dto.action === 'enter' || dto.action === 'restart') {
      let active = await this.orders.getActiveReservation(owner, cart.id);
      if (active && active.expiresAt <= new Date()) {
        await this.cleanup.reconcile(active.id);
        active = await this.orders.getActiveReservation(owner, cart.id);
        if (active) throw new ConflictException('CHECKOUT_RESERVATION_RECONCILING');
      }
      if (!active) {
        if (dto.action !== 'restart' && await this.orders.requiresExplicitReservationRestart(owner, cart.id)) throw new ConflictException('CHECKOUT_RESERVATION_EXPIRED');
        await this.orders.createCheckoutSnapshotForOwner(owner, { shippingMethod: ShippingMethodCode.STANDARD }, { cart, presenceOnly: true, enterTabId: dto.tabId });
      }
    }
    const result = await this.orders.updateCheckoutPresence(owner, cart.id, dto.tabId, dto.action === 'restart' ? 'enter' : dto.action);
    if (dto.action === 'leave' && result.checkoutSnapshotId && !result.paymentStartedAt && result.expired) await this.cleanup.reconcile(result.checkoutSnapshotId);
    return result;
  }

  @Post('payment-start')
  async start(@Req() req: Request, @Body() dto: StartCheckoutPaymentDto) {
    const cart = await this.cart.getCheckoutCartForRequest(req);
    const owner = resolveCheckoutOwnerIdentity(req, cart);
    if (!cart) throw new ConflictException('EMPTY_CART');
    return this.orders.startCheckoutPayment(owner, cart.id, dto.checkoutSnapshotId, dto.paymentIntentId, dto.tabId);
  }
}
