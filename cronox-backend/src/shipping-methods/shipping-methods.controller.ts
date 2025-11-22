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
  list(@Query('itemsTotal') itemsTotal?: string) {
    const itemsTotalCents = Number(itemsTotal);
    const parsed = Number.isFinite(itemsTotalCents) ? itemsTotalCents : undefined;
    return this.shippingMethods.listAvailable(parsed);
  }
}
