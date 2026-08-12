import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { normalizeCountry } from '../common/country';
import { normalizeEmail } from '../common/email';

type CompletedCheckoutIdentity = {
  userId: number | null;
  customerEmail: string;
  shippingAddr: unknown;
  billingAddr: unknown;
};

export type ResolvedCompletedOrderUser = {
  userId: number;
  accountCreated: boolean;
};

/**
 * Resolves account ownership only from the authoritative paid-order
 * transaction. It never authenticates the checkout browser or mutates an
 * existing account profile.
 */
@Injectable()
export class GuestOrderAccountService {
  async resolveUserForCompletedOrder(
    tx: Prisma.TransactionClient,
    checkout: CompletedCheckoutIdentity,
  ): Promise<ResolvedCompletedOrderUser> {
    if (checkout.userId != null) {
      return { userId: checkout.userId, accountCreated: false };
    }

    const email = normalizeEmail(checkout.customerEmail);
    if (!email) {
      throw new BadRequestException('CHECKOUT_CUSTOMER_EMAIL_REQUIRED');
    }

    const existing = await tx.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      return { userId: existing.id, accountCreated: false };
    }

    const shipping = this.asRecord(checkout.shippingAddr);
    const billing = this.asRecord(checkout.billingAddr);
    const names = this.extractNames(shipping) ?? this.extractNames(billing);
    const fullName = [names?.firstName, names?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    // User.email is unique. If another paid checkout creates the same account
    // concurrently, Prisma raises P2002 and OrdersService retries the complete
    // order transaction, which then resolves this row as existing.
    const user = await tx.user.create({
      data: {
        email,
        password: null,
        role: Role.USER,
        name: fullName || null,
        firstName: names?.firstName ?? null,
        lastName: names?.lastName ?? null,
      },
      select: { id: true },
    });

    const address = this.toSavedAddress(shipping ?? billing);
    if (address) {
      await tx.address.create({
        data: {
          userId: user.id,
          ...address,
          isDefault: true,
        },
      });
    }

    return { userId: user.id, accountCreated: true };
  }

  private toSavedAddress(input: Record<string, unknown> | null): {
    name: string;
    phone: string | null;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    zip: string;
    country: string;
  } | null {
    if (!input) return null;

    const names = this.extractNames(input);
    const name =
      this.clean(input.name, 160) ||
      this.clean(input.fullName, 160) ||
      [names?.firstName, names?.lastName].filter(Boolean).join(' ').trim();
    const line1 =
      this.clean(input.line1, 240) || this.clean(input.address, 240);
    const line2 =
      this.clean(input.line2, 240) ||
      this.clean(input.addressLine2, 240) ||
      null;
    const city = this.clean(input.city, 120);
    const state = this.clean(input.state, 120) || null;
    const zip =
      this.clean(input.zip, 30) || this.clean(input.postalCode, 30);
    const country = normalizeCountry(input.country);
    const phone = this.clean(input.phone, 40)?.replace(/[^\d+]/g, '') || null;

    if (!name || !line1 || !city || !zip || !country) return null;
    return { name, phone, line1, line2, city, state, zip, country };
  }

  private extractNames(
    input: Record<string, unknown> | null,
  ): { firstName?: string; lastName?: string } | null {
    if (!input) return null;
    let firstName =
      this.clean(input.firstName, 80) ||
      this.clean(input.firstname, 80) ||
      this.clean(input.first_name, 80);
    let lastName =
      this.clean(input.lastName, 120) ||
      this.clean(input.lastname, 120) ||
      this.clean(input.last_name, 120);

    if (!firstName && !lastName) {
      const parts = (
        this.clean(input.name, 200) || this.clean(input.fullName, 200)
      )?.split(/\s+/);
      if (parts?.length) {
        firstName = parts.shift();
        lastName = parts.join(' ') || undefined;
      }
    }

    return firstName || lastName ? { firstName, lastName } : null;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private clean(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
  }
}
