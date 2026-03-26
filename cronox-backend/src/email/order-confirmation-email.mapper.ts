import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { OrderConfirmationEmailTemplateData } from './email.types';

export const orderForConfirmationEmailInclude = {
  include: {
    user: {
      select: {
        email: true,
        firstName: true,
        lastName: true,
        name: true,
      },
    },
    shippingMethod: {
      select: {
        name: true,
      },
    },
    items: {
      include: {
        product: {
          select: {
            name: true,
            slug: true,
            imageUrl: true,
            images: {
              select: {
                url: true,
                isPrimary: true,
                sortOrder: true,
              },
              orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
            },
            variants: {
              select: {
                size: true,
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderDefaultArgs;

export type OrderForConfirmationEmail = Prisma.OrderGetPayload<
  typeof orderForConfirmationEmailInclude
>;

@Injectable()
export class OrderConfirmationEmailMapper {
  private readonly fallbackStoreUrl = 'https://cronoxwear.com';
  private readonly fallbackImageUrl =
    'https://via.placeholder.com/96x96.png?text=CRONOX';

  map(order: OrderForConfirmationEmail): OrderConfirmationEmailTemplateData {
    const storefrontUrl = this.resolveStorefrontUrl();
    const shippingAddress = this.parseShippingAddress(order.shippingAddr);
    const customerFullName = this.resolveCustomerFullName(order, shippingAddress);
    const customerPhone = this.normalizeString(shippingAddress.phone);
    const subtotalCents = this.decimalToCents(order.subtotal);
    const taxesCents = this.decimalToCents(order.taxAmount);
    const totalCents = this.decimalToCents(order.total);
    const shippingCents = Math.max(0, order.shippingCost ?? 0);
    const discountCents = Math.max(0, order.discountCents ?? 0);
    const savingsCents = discountCents;

    return {
      orderId: String(order.id),
      customerEmail: order.user?.email ?? '',
      customerFullName,
      customerPhone,
      message:
        'Tu pedido se ha confirmado correctamente. Te avisaremos cuando esté en camino.',
      orderUrl: `${storefrontUrl.replace(/\/$/, '')}/profile.html?tab=orders&orderId=${order.id}`,
      storeUrl: storefrontUrl,
      subtotalFormatted: this.formatCurrencyFromCents(subtotalCents),
      discountFormatted: this.formatDiscountFromCents(discountCents),
      shippingFormatted: this.formatCurrencyFromCents(shippingCents),
      taxesFormatted: this.formatCurrencyFromCents(taxesCents),
      totalFormatted: this.formatCurrencyFromCents(totalCents),
      savingsFormatted:
        savingsCents > 0 ? this.formatCurrencyFromCents(savingsCents) : null,
      shippingMethod: this.resolveShippingMethod(order),
      shippingAddress,
      items: order.items.map((item) => {
        const variantName = this.resolveVariantName(item);
        const imageUrl = this.resolveProductImageUrl(item.product);

        return {
          name: item.product?.name ?? item.title,
          variantName,
          quantity: Math.max(1, item.quantity),
          imageUrl,
          unitPriceFormatted: this.formatCurrencyFromDecimal(item.unitPrice),
          lineTotalFormatted: this.formatCurrencyFromDecimal(item.lineTotal),
        };
      }),
    };
  }

  private resolveShippingMethod(order: OrderForConfirmationEmail): string | null {
    const methodName = order.shippingMethod?.name?.trim();
    if (methodName) {
      return methodName;
    }

    const methodCode = order.shippingMethodCode?.trim();
    if (methodCode) {
      return methodCode;
    }

    return order.shippingCost > 0 ? 'Envío a domicilio' : 'Sin gastos de envío';
  }

  private resolveStorefrontUrl(): string {
    const candidates = [
      process.env.FRONTEND_URL,
      process.env.FRONT_URL,
      process.env.STORE_URL,
      process.env.WEB_URL,
      process.env.APP_URL,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    return this.fallbackStoreUrl;
  }

  private parseShippingAddress(
    input: unknown,
  ): OrderConfirmationEmailTemplateData['shippingAddress'] {
    if (!input || typeof input !== 'object') {
      return {};
    }

    const record = input as Record<string, unknown>;
    const firstName = this.pickString(record, ['firstName', 'first_name']);
    const lastName = this.pickString(record, ['lastName', 'last_name']);
    const fullName =
      this.pickString(record, ['name', 'fullName', 'full_name']) ??
      [firstName, lastName].filter(Boolean).join(' ').trim();

    const line1 = this.pickString(record, ['line1', 'address1']);
    const line2 = this.pickString(record, ['line2', 'address2']);
    const city = this.pickString(record, ['city', 'town']);
    const state = this.pickString(record, ['state', 'province', 'region']);
    const postalCode = this.pickString(record, [
      'postalCode',
      'zip',
      'zipCode',
      'postal_code',
    ]);
    const country = this.pickString(record, ['country']);
    const phone = this.pickString(record, ['phone', 'phoneNumber']);

    return {
      fullName: fullName ?? null,
      line1: line1 ?? null,
      line2: line2 ?? null,
      city: city ?? null,
      state: state ?? null,
      postalCode: postalCode ?? null,
      country: country ?? null,
      phone: phone ?? null,
    };
  }

  private pickString(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }

      if (value && typeof value === 'object') {
        const nested = value as Record<string, unknown>;

        for (const nestedValue of Object.values(nested)) {
          if (typeof nestedValue === 'string' && nestedValue.trim()) {
            return nestedValue.trim();
          }
        }
      }
    }

    if (source.address && typeof source.address === 'object') {
      const nestedAddress = source.address as Record<string, unknown>;

      for (const key of keys) {
        const nested = nestedAddress[key];

        if (typeof nested === 'string' && nested.trim()) {
          return nested.trim();
        }
      }
    }

    return undefined;
  }

  private resolveCustomerFullName(
    order: OrderForConfirmationEmail,
    shippingAddress: OrderConfirmationEmailTemplateData['shippingAddress'],
  ): string | null {
    const fromUser = [order.user?.firstName, order.user?.lastName]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
      .join(' ')
      .trim();

    if (fromUser) {
      return fromUser;
    }

    const userName = this.normalizeString(order.user?.name);
    if (userName) {
      return userName;
    }

    const shippingName = this.normalizeString(shippingAddress.fullName);
    if (shippingName) {
      return shippingName;
    }

    return null;
  }

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private resolveVariantName(
    item: OrderForConfirmationEmail['items'][number],
  ): string | null {
    const sizeInTitle = item.title.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
    if (sizeInTitle) {
      return sizeInTitle;
    }

    const sizes = item.product?.variants ?? [];
    if (sizes.length === 1 && sizes[0].size) {
      return sizes[0].size;
    }

    return null;
  }

  private resolveProductImageUrl(
    product: OrderForConfirmationEmail['items'][number]['product'] | null | undefined,
  ): string {
    if (!product) {
      return this.fallbackImageUrl;
    }

    const primary = product.images?.find((image) => image.isPrimary && image.url?.trim());
    if (primary?.url) {
      return primary.url;
    }

    const first = product.images?.find((image) => image.url?.trim());
    if (first?.url) {
      return first.url;
    }

    if (product.imageUrl?.trim()) {
      return product.imageUrl;
    }

    return this.fallbackImageUrl;
  }

  private formatCurrencyFromDecimal(value: Prisma.Decimal | Decimal): string {
    return this.formatCurrencyFromCents(this.decimalToCents(value));
  }

  private formatCurrencyFromCents(cents: number): string {
    const amount = (Number.isFinite(cents) ? cents : 0) / 100;
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  private formatDiscountFromCents(cents: number): string {
    const safeCents = Math.max(0, Number.isFinite(cents) ? cents : 0);
    const formatted = this.formatCurrencyFromCents(safeCents);

    return safeCents > 0 ? `-${formatted}` : formatted;
  }

  private decimalToCents(value: Prisma.Decimal | Decimal): number {
    return Number(new Decimal(value).mul(100).toFixed(0));
  }
}
