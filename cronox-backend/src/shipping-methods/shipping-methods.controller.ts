import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ShippingMethodsService } from './shipping-methods.service';

@ApiTags('Shipping Methods')
@Controller('shipping-methods')
export class ShippingMethodsController {
  constructor(private readonly shippingMethods: ShippingMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los métodos de envío activos disponibles para el checkout' })
  @ApiOkResponse({ description: 'Listado de métodos de envío disponibles' })
  @ApiQuery({
    name: 'country',
    required: false,
    description: 'Filtra los métodos válidos para un país (ISO 3166-1 alpha-2)',
  })
  list(@Query('country') country?: string) {
    return this.shippingMethods.listAvailable(country);
  }
}
