import { Injectable } from '@nestjs/common';
import {
  ShippingMethodCode,
  SHIPPING_METHOD_LABELS,
} from '../common/enums/shipping-method-code.enum';

const FREE_SHIPPING_THRESHOLD = 6500; // 65,00 €
const STANDARD_SHIPPING = 295; // 2,95 €
const EXPRESS_SHIPPING = 495; // 4,95 €

export interface ShippingMethodOption {
  code: ShippingMethodCode;
  label: string;
  amountCents: number;
  isFree: boolean;
}

@Injectable()
export class ShippingMethodsService {
  getMethod(
    code: ShippingMethodCode,
    itemsTotalCents: number,
  ): ShippingMethodOption {
    if (code === ShippingMethodCode.EXPRESS) {
      return {
        code,
        label: SHIPPING_METHOD_LABELS[code],
        amountCents: EXPRESS_SHIPPING,
        isFree: false,
      };
    }

    const isFree = itemsTotalCents >= FREE_SHIPPING_THRESHOLD;
    return {
      code,
      label: SHIPPING_METHOD_LABELS[code],
      amountCents: isFree ? 0 : STANDARD_SHIPPING,
      isFree,
    };
  }

  listAvailable(itemsTotalCents?: number): ShippingMethodOption[] {
    const total = itemsTotalCents ?? 0;
    return [
      this.getMethod(ShippingMethodCode.STANDARD, total),
      this.getMethod(ShippingMethodCode.EXPRESS, total),
    ];
  }
}
