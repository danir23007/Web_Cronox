// src/common/enums/shipping-method-code.enum.ts
export enum ShippingMethodCode {
  STANDARD = 'STANDARD',
  EXPRESS = 'EXPRESS',
}

export const SHIPPING_METHOD_LABELS: Record<ShippingMethodCode, string> = {
  [ShippingMethodCode.STANDARD]: 'Envío estándar',
  [ShippingMethodCode.EXPRESS]: 'Envío express',
};
