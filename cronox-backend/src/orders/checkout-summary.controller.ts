import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
import { CartService } from '../cart/cart.service';
import { OrdersService } from './orders.service';

@ApiTags('Checkout')
@Controller('checkout')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CheckoutSummaryController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly cartService: CartService,
  ) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Obtiene el resumen del checkout con carrito, métodos de envío y totales',
  })
  @ApiOkResponse({
    description: 'Resumen del checkout con totales expresados en céntimos',
  })
  async getSummary(
    @Req() req: Request,
    @Query('shippingMethod') shippingMethod?: string,
  ) {
    const userId = req.user?.id;

    if (typeof userId !== 'number') {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    const normalized =
      typeof shippingMethod === 'string'
        ? (shippingMethod.toUpperCase() as ShippingMethodCode)
        : undefined;

    // 🔥 IMPORTANTE:
    // El checkout usa el carrito ACTUAL (incluido el anónimo con cookie) para evitar productos antiguos.
    const cart = await this.cartService.getCheckoutCartForRequest(req);

    return this.ordersService.getCheckoutSummary(cart, {
      shippingMethod: normalized,
    });
  }
}
