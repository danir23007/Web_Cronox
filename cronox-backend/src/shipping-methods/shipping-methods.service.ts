import { Injectable, NotFoundException } from '@nestjs/common';
import { ShippingMethod } from '@prisma/client';

export const FREE_SHIPPING_THRESHOLD = 6500; // 65,00 €
export const STANDARD_SHIPPING = 295; // 2,95 €
export const EXPRESS_SHIPPING = 495; // 4,95 €

export type ShippingMethodOption = {
  code: ShippingMethod;
  label: string;
  description?: string;
  baseCostCents: number;
  freeShippingThresholdCents?: number;
};

export type ShippingMethodResponse = {
  code: ShippingMethod;
  label: string;
  description?: string;
  priceCents: number;
  price: string;
  freeShippingThresholdCents?: number;
};

const SHIPPING_METHODS: Record<ShippingMethod, ShippingMethodOption> = {
  STANDARD: {
    code: ShippingMethod.STANDARD,
    label: 'Envío estándar',
    description: 'Gratis a partir de 65 €',
    baseCostCents: STANDARD_SHIPPING,
    freeShippingThresholdCents: FREE_SHIPPING_THRESHOLD,
  },
  EXPRESS: {
    code: ShippingMethod.EXPRESS,
    label: 'Envío express',
    description: 'Entrega rápida',
    baseCostCents: EXPRESS_SHIPPING,
  },
};

@Injectable()
export class ShippingMethodsService {
  listAvailable(itemsTotalCents?: number): ShippingMethodResponse[] {
    return Object.values(SHIPPING_METHODS).map((method) =>
      this.toResponse(method, itemsTotalCents),
    );
  }

  getMethodOrThrow(code: ShippingMethod): ShippingMethodOption {
    const method = SHIPPING_METHODS[code];
    if (!method) {
      throw new NotFoundException('SHIPPING_METHOD_NOT_FOUND');
    }
    return method;
  }

  calculateShipping(itemsTotal: number, method: ShippingMethod): number {
    if (method === ShippingMethod.EXPRESS) return EXPRESS_SHIPPING;
    if (itemsTotal >= FREE_SHIPPING_THRESHOLD) return 0;
    return STANDARD_SHIPPING;
  }

  toResponse(option: ShippingMethodOption, itemsTotalCents?: number): ShippingMethodResponse {
    const priceCents =
      itemsTotalCents !== undefined
        ? this.calculateShipping(itemsTotalCents, option.code)
        : option.baseCostCents;

    return {
      code: option.code,
      label: option.label,
      description: option.description,
      freeShippingThresholdCents: option.freeShippingThresholdCents,
      priceCents,
      price: this.formatPrice(priceCents),
    };
  }

  private formatPrice(cents: number): string {
    return (cents / 100).toFixed(2);
  }
}
