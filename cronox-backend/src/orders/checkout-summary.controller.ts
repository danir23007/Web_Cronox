import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
import { CartService } from '../cart/cart.service';
import { OrdersService } from './orders.service';
import { ApplyPromoDto } from './dto/apply-promo.dto';

@ApiTags('Checkout')
@Controller('checkout')
@UseGuards(OptionalJwtAuthGuard)
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
    @Query('promoCode') promoCode?: string,
  ) {
    const userId = req.user?.id;

    const normalized =
      typeof shippingMethod === 'string'
        ? (shippingMethod.toUpperCase() as ShippingMethodCode)
        : undefined;

    // 🔥 IMPORTANTE:
    // El checkout usa el carrito ACTUAL (incluido el anónimo con cookie) para evitar productos antiguos.
    const cart = await this.cartService.getCheckoutCartForRequest(req);

    return this.ordersService.getCheckoutSummary(cart, {
      userId,
      shippingMethod: normalized,
      promoCode,
    });
  }

  @Post('apply-promo')
  @ApiOperation({
    summary:
      'Valida un código de descuento y devuelve los totales actualizados',
  })
  @ApiOkResponse({
    description: 'Resultado de la validación del código promocional',
  })
  async applyPromo(@Req() req: Request, @Body() dto: ApplyPromoDto) {
    const userId = req.user?.id;

    const cart = await this.cartService.getCheckoutCartForRequest(req);
    const summary = await this.ordersService.getCheckoutSummary(cart, {
      userId,
      shippingMethod: dto.shippingMethod,
      promoCode: dto.code,
    });

    const appliedPromo = summary.appliedPromo;
    const promoMessage = appliedPromo?.message ?? 'Código inválido o expirado';

    if (!appliedPromo?.valid) {
      const isNotFound = promoMessage === 'Este código de descuento no existe';
      throw new BadRequestException({
        code: isNotFound ? 'PROMO_NOT_FOUND' : 'PROMO_INVALID',
        message: promoMessage,
      });
    }

    const discountAmount = appliedPromo?.discountCents ?? 0;
    const totalAfter = summary.totals.totalCents;
    const totalBefore =
      appliedPromo?.totalBeforeCents ??
      totalAfter + (appliedPromo?.discountCents ?? 0);

    return {
      valid: Boolean(appliedPromo?.valid),
      code: appliedPromo?.code ?? dto.code,
      discountAmount,
      totalBefore,
      totalAfter,
      message: promoMessage,
      discountLineLabel: appliedPromo?.discountLineLabel,
      appliedPromo: appliedPromo ?? null,
      totals: summary.totals,
      shippingMethod: summary.selectedShippingMethod,
    };
  }
}
