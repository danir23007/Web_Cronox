import { Injectable, NotFoundException } from '@nestjs/common';

export type ShippingQuoteRow = {
  ware: string;
  h: string;
  D: string;
  price: number;
  distance: number;
  country: string;
};

export type ShippingQuote = ShippingQuoteRow & { quote: number };

@Injectable()
export class ShippingQuoteService {
  // Tabla base con las tarifas. Si en el futuro llega desde DB o API
  // solo hay que actualizar este origen de datos.
  private readonly baseQuotes: ShippingQuoteRow[] = [
    {
      ware: 'DEFAULT',
      h: 'standard',
      D: 'standard',
      price: 5.5,
      distance: 0,
      country: 'ES',
    },
  ];

  /**
   * Devuelve la cotización más barata para el país indicado.
   * Se normaliza al formato con propiedad `quote` (alias de `price`).
   */
  findBestQuote(country: string): ShippingQuote {
    const matches = this.baseQuotes.filter((row) =>
      row.country.localeCompare(country, undefined, { sensitivity: 'base' }) === 0,
    );

    if (!matches.length) {
      throw new NotFoundException(`No shipping quote available for country: ${country}`);
    }

    const cheapest = matches.reduce((best, current) =>
      current.price < best.price ? current : best,
    );

    return { ...cheapest, quote: cheapest.price };
  }
}
