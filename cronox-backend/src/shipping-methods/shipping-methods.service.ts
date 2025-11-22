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

@Injectable()
export class ShippingMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  // Opcional: pequeño caché en memoria (mejora rendimiento pero no es obligatorio)
  private cache:
    | Map<string, { id: number; price: number; name: string; isActive: boolean }>
    | null = null;

  private async loadMethodsFromDb() {
    if (this.cache) return this.cache;

    const rows = await this.prisma.shippingMethod.findMany({
      where: { isActive: true },
    });

    const map = new Map<
      string,
      { id: number; price: number; name: string; isActive: boolean }
    >();

    for (const row of rows) {
      map.set(row.code, {
        id: row.id,
        price: row.price,
        name: row.name,
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

    // **ÚNICA LÓGICA QUE QUIERO EN CÓDIGO**:
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
      label: row.name,
      amountCents,
    };
  }

  async listAvailableMethods(
    itemsTotalCents: number,
  ): Promise<ShippingMethodOption[]> {
    const methods = await this.loadMethodsFromDb();

    const result: ShippingMethodOption[] = [];

    for (const [codeStr, row] of methods.entries()) {
      const code = codeStr as ShippingMethodCode;
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
