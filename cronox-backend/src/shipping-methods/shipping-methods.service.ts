import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';

export type ShippingMethodOption = {
  id: number;
  code: ShippingMethodCode;
  label: string;
  amountCents: number; // precio final en céntimos después de aplicar la regla de envío gratis
};

const FREE_SHIPPING_THRESHOLD_CENTS = 6500; // 65 €

// Internamente sólo guardamos lo que viene de la BD
type ShippingRow = {
  id: number;
  name: string;
  price: number;
  isActive: boolean;
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
      });
    }

    this.cache = map;
    return map;
  }

  async getMethod(
    code: ShippingMethodCode,
    itemsTotalCents: number,
  ): Promise<ShippingMethodOption> {
    const methods = await this.loadMethodsFromDb();
    const row = methods.get(code);

    if (!row) {
      throw new NotFoundException(`Shipping method not found: ${code}`);
    }

    let amountCents = row.price;

    // *** ÚNICA LÓGICA EN CÓDIGO ***
    // Si el pedido >= 65 € y el método es STANDARD -> envío gratis
    if (
      code === ShippingMethodCode.STANDARD &&
      itemsTotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
    ) {
      amountCents = 0;
    }

    return {
      id: row.id,
      code,
      label: row.name, // el texto visible sale de la BD
      amountCents,
    };
  }

  async listAvailableMethods(
    itemsTotalCents: number,
  ): Promise<ShippingMethodOption[]> {
    const methods = await this.loadMethodsFromDb();

    const result: ShippingMethodOption[] = [];

    for (const [code, row] of methods.entries()) {
      if (!row.isActive) continue;

      let amountCents = row.price;

      if (
        code === ShippingMethodCode.STANDARD &&
        itemsTotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ) {
        amountCents = 0;
      }

      result.push({
        id: row.id,
        code,
        label: row.name,
        amountCents,
      });
    }

    return result;
  }

  clearCache() {
    this.cache = null;
  }
}
