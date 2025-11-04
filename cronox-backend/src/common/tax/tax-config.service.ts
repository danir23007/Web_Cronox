// [ORDERS] Servicio de configuración fiscal y de checkout
import { Injectable } from '@nestjs/common';

@Injectable()
export class TaxConfigService {
  private readonly defaultVat: number;
  private readonly flatShipping: number;
  private readonly paymentProvider: string;

  constructor() {
    this.defaultVat = this.parseNumber(process.env.VAT_DEFAULT, 0.21);
    this.flatShipping = this.parseNumber(process.env.SHIPPING_FLAT, 0);
    this.paymentProvider = process.env.PAYMENT_PROVIDER?.toLowerCase() ?? 'none';
  }

  getDefaultVat(): number {
    return this.defaultVat;
  }

  getFlatShipping(): number {
    return this.flatShipping;
  }

  getPaymentProvider(): string {
    return this.paymentProvider;
  }

  private parseNumber(value: string | undefined, fallback: number): number {
    if (!value) {
      return fallback;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return fallback;
  }
}
