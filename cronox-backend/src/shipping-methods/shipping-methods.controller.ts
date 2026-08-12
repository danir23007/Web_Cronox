import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ShippingMethodsService } from './shipping-methods.service';

@ApiTags('Shipping Methods')
@Controller('shipping-methods')
export class ShippingMethodsController {
  constructor(private readonly shippingMethods: ShippingMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los métodos de envío disponibles para el checkout' })
  @ApiOkResponse({ description: 'Listado de métodos de envío disponibles' })
  @ApiQuery({
    name: 'itemsTotal',
    required: false,
    description: 'Subtotal de productos en céntimos para calcular el coste de envío',
  })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'País o región de entrega (actualmente solo España)',
  })
  async list(
    @Query('itemsTotal') itemsTotal?: string,
    @Query('country') country?: string,
  ) {
    const itemsTotalCents = Number(itemsTotal);
    const parsed = Number.isFinite(itemsTotalCents) ? itemsTotalCents : 0;
    return this.shippingMethods.listAvailableMethods(
      parsed,
      0,
      country || undefined,
    );
  }
}
