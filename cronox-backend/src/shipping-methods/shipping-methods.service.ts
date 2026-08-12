import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
import {
  normalizeCountry,
  SPAIN_COUNTRY_NAME,
  UNSUPPORTED_COUNTRY_MESSAGE,
} from '../common/country';

export type ShippingMethodOption = {
  id: number;
  code: ShippingMethodCode;
  label: string;
  priceCents: number; // precio base en céntimos
  amountCents: number; // precio final en céntimos después de aplicar la regla de envío gratis
  description?: string | null;
};

export const FREE_SHIPPING_THRESHOLD_CENTS = 6500; // 65 €

// Internamente sólo guardamos lo que viene de la BD
type ShippingRow = {
  id: number;
  name: string;
  price: number;
  isActive: boolean;
  description?: string | null;
};

@Injectable()
export class ShippingMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  // Caché opcional en memoria (puedes borrarlo si no lo quieres)
  private cache: Map<ShippingMethodCode, ShippingRow> | null = null;

  /**
   * Cargamos los métodos de envío desde la BD y los mapeamos
   * a STANDARD / EXPRESS usando el ID de la fila:
   *   id = 1  -> STANDARD
   *   id = 2  -> EXPRESS
   *
   * IMPORTANTE: no borres estas filas y las recrees cambiando el orden,
   * crea siempre primero el estándar (id 1) y luego el express (id 2).
   */
  private async loadMethodsFromDb(): Promise<
    Map<ShippingMethodCode, ShippingRow>
  > {
    if (this.cache) return this.cache;

    const rows = await this.prisma.shippingMethod.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    const map = new Map<ShippingMethodCode, ShippingRow>();

    for (const row of rows) {
      let code: ShippingMethodCode | null = null;

      if (row.id === 1) {
        code = ShippingMethodCode.STANDARD;
      } else if (row.id === 2) {
        code = ShippingMethodCode.EXPRESS;
      } else {
        // De momento ignoramos otros métodos desconocidos
        continue;
      }

      map.set(code, {
        id: row.id,
        name: row.name,
        price: row.price,
        isActive: row.isActive,
        description: (row as any).description ?? null,
      });
    }

    this.cache = map;
    return map;
  }

  async getMethod(
    code: ShippingMethodCode,
    itemsTotalCents: number,
    discountCents = 0,
    country: string = SPAIN_COUNTRY_NAME,
  ): Promise<ShippingMethodOption> {
    this.assertSupportedCountry(country);
    const methods = await this.loadMethodsFromDb();
    const row = methods.get(code);

    if (!row) {
      throw new NotFoundException(`Shipping method not found: ${code}`);
    }

    const netItemsCents = Math.max(0, itemsTotalCents - Math.max(0, discountCents));
    const amountCents =
      code === ShippingMethodCode.STANDARD &&
      netItemsCents >= FREE_SHIPPING_THRESHOLD_CENTS
        ? 0
        : row.price;

    return {
      id: row.id,
      code,
      label: row.name, // el texto visible sale de la BD
      priceCents: row.price,
      amountCents,
      description: row.description ?? null,
    };
  }

  async listAvailableMethods(
    itemsTotalCents: number,
    discountCents = 0,
    country: string = SPAIN_COUNTRY_NAME,
  ): Promise<ShippingMethodOption[]> {
    this.assertSupportedCountry(country);
    const methods = await this.loadMethodsFromDb();

    const result: ShippingMethodOption[] = [];
    const netItemsCents = Math.max(0, itemsTotalCents - Math.max(0, discountCents));

    for (const [code, row] of methods.entries()) {
      if (!row.isActive) continue;

      const amountCents =
        code === ShippingMethodCode.STANDARD &&
        netItemsCents >= FREE_SHIPPING_THRESHOLD_CENTS
          ? 0
          : row.price;

      result.push({
        id: row.id,
        code,
        label: row.name,
        priceCents: row.price,
        amountCents,
        description: row.description ?? null,
      });
    }

    return result;
  }

  clearCache() {
    this.cache = null;
  }

  private assertSupportedCountry(country: string): void {
    if (!normalizeCountry(country)) {
      throw new BadRequestException(UNSUPPORTED_COUNTRY_MESSAGE);
    }
  }
}
