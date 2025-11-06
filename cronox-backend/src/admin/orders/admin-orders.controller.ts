import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersQueryDto } from './dto/admin-order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminOrdersController {
  constructor(private readonly ordersService: AdminOrdersService) {}

  @Get()
  listOrders(@Query() query: AdminOrdersQueryDto) {
    return this.ordersService.listOrders(query);
  }

  @Get('export.csv')
  async exportOrders(
    @Query() query: AdminOrdersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const exportResult = await this.ordersService.exportOrders(query);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.fileName}"`,
    );

    return exportResult.csv;
  }

  @Get(':id')
  getOrderById(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.getOrderById(id);
  }

  @Patch(':id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(id, dto.status);
  }

  @Post(':id/refund')
  refundOrder(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.refundOrder(id);
  }
}
