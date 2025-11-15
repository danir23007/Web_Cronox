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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrdersService } from './orders.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { PaginationDto } from './dto/pagination.dto';

@ApiTags('Orders')
@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout/session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Prepara una sesión de checkout con totales calculados' })
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
          id: 2,
          name: 'Express',
          priceCents: 250,
          price: '2.50',
          countries: ['ES'],
          isActive: true,
          createdAt: '2025-02-04T00:00:00.000Z',
          updatedAt: '2025-02-04T00:00:00.000Z',
        },
        metadata: {
          cartId: 10,
          userId: 3,
          shippingMethodId: 2,
          shippingCostCents: 250,
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

    return this.ordersService.createCheckoutSession(userId, dto);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Confirma un pedido a partir del webhook del proveedor de pagos' })
  @ApiCreatedResponse({
    description: 'Pedido creado (idempotente por providerRef)',
    schema: {
      example: {
        id: 42,
        status: 'PAID',
        subtotal: '100.00',
        taxRate: '0.2100',
        taxAmount: '21.00',
        shippingCost: '0.00',
        total: '121.00',
        currency: 'EUR',
        provider: 'stripe',
        providerRef: 'pi_12345',
        shippingMethodId: 2,
        items: [
          {
            id: 1,
            orderId: 42,
            productId: 1,
            title: 'Camiseta (M)',
            unitPrice: '100.00',
            quantity: 1,
            lineTotal: '100.00',
          },
        ],
      },
    },
  })
  async createOrderFromWebhook(
    @Body() dto: CreateOrderWebhookDto,
  ): Promise<Record<string, unknown>> {
    return this.ordersService.createOrderFromWebhook(dto);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista los pedidos del usuario autenticado (o todos si es admin)' })
  @ApiOkResponse({ description: 'Listado paginado de pedidos' })
  async listOrders(
    @Req() req: Request,
    @Query() pagination: PaginationDto,
  ): Promise<{ data: Record<string, unknown>[]; meta: Record<string, number> }> {
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
