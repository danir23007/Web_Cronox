// [ORDERS] Controlador HTTP para checkout y pedidos
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
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
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CartService } from '../cart/cart.service';
import { OrdersService } from './orders.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { PaginationDto } from './dto/pagination.dto';
import { resolveCheckoutOwnerIdentity } from './checkout-owner';

@ApiTags('Orders')
@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly cartService: CartService,
  ) {}

  @Post('checkout/session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Prepara una sesión de checkout con totales calculados',
  })
  @ApiOkResponse({
    description: 'Resumen del checkout con totales, impuestos y artículos',
    schema: {
      example: {
        provider: 'none',
        summary: {
          currency: 'EUR',
          subtotal: '100.00',
          taxRate: '0.2100',
          taxAmount: '21.00',
          shippingCost: '0.00',
          total: '121.00',
        },
        lineItems: [
          {
            productId: 1,
            title: 'Camiseta (M)',
            quantity: 1,
            unitPrice: '100.00',
            lineTotal: '100.00',
          },
        ],
        shippingMethod: {
          code: 'EXPRESS',
          label: 'Envío express',
          description: 'Entrega rápida',
          priceCents: 495,
          price: '4.95',
        },
        metadata: {
          cartId: 10,
          userId: 3,
          itemsTotalCents: 10000,
          shippingMethod: 'EXPRESS',
          shippingCostCents: 495,
        },
      },
    },
  })
  async createCheckoutSession(
    @Req() req: Request,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<Record<string, unknown>> {
    const userId = req.user?.id;
    if (typeof userId !== 'number') {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    const cart = await this.cartService.getCheckoutCartForRequest(req);

    return this.ordersService.createCheckoutSession(userId, dto, { cart }); // Usa solo los ítems del carrito activo
  }

  @Get('orders/payment-status')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Consulta el estado de procesamiento de un pago confirmado en Stripe',
  })
  @ApiOkResponse({
    description: 'Estado del pedido asociado al pago',
    schema: {
      example: {
        providerRef: 'pi_12345',
        found: true,
        orderId: 42,
        orderStatus: 'PAID',
        isProcessed: true,
      },
    },
  })
  async getPaymentStatus(
    @Req() req: Request,
    @Query('providerRef') providerRef?: string,
  ): Promise<Record<string, unknown>> {
    const cart = await this.cartService.getCheckoutCartForRequest(req);
    const owner = resolveCheckoutOwnerIdentity(req, cart);
    return this.ordersService.getPaymentProcessingStatusForOwner(owner, providerRef);
  }

  @Get('orders/current-checkout-payment-status')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Consulta de forma segura si el checkout actual ya produjo un pedido',
  })
  async getCurrentCheckoutPaymentStatus(
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const cart = await this.cartService.getCheckoutCartForRequest(req);
    const owner = resolveCheckoutOwnerIdentity(req, cart);
    return this.ordersService.getCurrentCheckoutPaymentProcessingStatusForOwner(owner);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lista los pedidos del usuario autenticado (o todos si es admin)',
  })
  @ApiOkResponse({ description: 'Listado paginado de pedidos' })
  async listOrders(
    @Req() req: Request,
    @Query() pagination: PaginationDto,
  ): Promise<{
    data: Record<string, unknown>[];
    meta: Record<string, number>;
  }> {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (typeof userId !== 'number' || !role) {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    return this.ordersService.listOrders({ id: userId, role }, pagination);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtiene el detalle de un pedido del usuario' })
  @ApiOkResponse({ description: 'Pedido con líneas de productos' })
  async getOrderById(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Record<string, unknown>> {
    const userId = req.user?.id;
    const role = req.user?.role;

    if (typeof userId !== 'number' || !role) {
      throw new UnauthorizedException('USER_NOT_AUTHENTICATED');
    }

    return this.ordersService.getOrderById({ id: userId, role }, id);
  }
}
