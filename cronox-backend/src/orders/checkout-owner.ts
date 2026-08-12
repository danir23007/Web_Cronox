import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { CartWithItems } from '../cart/cart.service';
import type { CheckoutOwner } from './orders.service';

export function resolveCheckoutOwner(
  req: Request,
  cart: CartWithItems | null,
  guestEmail?: string,
): CheckoutOwner {
  if (typeof req.user?.id === 'number') {
    return { userId: req.user.id, customerEmail: req.user.email };
  }

  if (!cart?.anonymousId || cart.userId !== null) {
    throw new UnauthorizedException('GUEST_CHECKOUT_CONTEXT_REQUIRED');
  }

  const customerEmail = String(guestEmail ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new BadRequestException('GUEST_EMAIL_REQUIRED');
  }

  return { anonymousId: cart.anonymousId, customerEmail };
}

export function resolveCheckoutOwnerIdentity(
  req: Request,
  cart: CartWithItems | null,
): CheckoutOwner {
  if (typeof req.user?.id === 'number') {
    return { userId: req.user.id, customerEmail: req.user.email };
  }
  if (!cart?.anonymousId || cart.userId !== null) {
    throw new UnauthorizedException('GUEST_CHECKOUT_CONTEXT_REQUIRED');
  }
  // Read-only owner checks do not persist this placeholder. Guest email is
  // accepted only by the PaymentIntent endpoint and stored server-side there.
  return {
    anonymousId: cart.anonymousId,
    customerEmail: 'guest@owner.invalid',
  };
}
