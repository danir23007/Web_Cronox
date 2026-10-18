import { UserIdentityGuard } from '../../users/user-identity.guard';
import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { OrderStatus, Role } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersQueryDto } from './dto/admin-order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderFulfillmentDto } from './dto/update-order-fulfillment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShippingLabelsService } from '../../shipping-tracking/labels.service';
import { ShippingLabelUploadInterceptor } from '../../shipping-tracking/labels-upload.interceptor';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { TrackingBulkAssignDto } from './dto/tracking-bulk.dto';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard, UserIdentityGuard, SuperAdminGuard)
@Roles(Role.SUPERADMIN)
export class AdminOrdersController {
  constructor(
    private readonly ordersService: AdminOrdersService,
    private readonly shippingLabels: ShippingLabelsService,
  ) {}

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

  @Post('tracking-bulk/assign')
  assignTrackingBulk(@Body() dto: TrackingBulkAssignDto, @CurrentUser('id') actorId: number) {
    return this.ordersService.assignTrackingBulk(dto.rows, dto.preview, actorId);
  }

  @Patch(':id/status')
  updateOrderStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser('id') actorId: number,
  ) {
    return this.ordersService.updateOrderStatus(id, dto.status, actorId);
  }

  @Patch(':id/fulfillment')
  updateOrderFulfillment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderFulfillmentDto,
    @CurrentUser('id') actorId: number,
  ) {
    return this.ordersService.updateOrderFulfillment(id, dto, actorId);
  }

  @Post(':id/label')
  @UseGuards(SuperAdminGuard)
  @UseInterceptors(ShippingLabelUploadInterceptor)
  uploadShippingLabel(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('revision') revision: string,
    @CurrentUser('id') actorId: number,
  ) {
    if (typeof revision !== 'string' || !/^\d{1,10}$/.test(revision)) {
      throw new BadRequestException('La revision del seguimiento es obligatoria');
    }
    return this.shippingLabels.upload(id, Number(revision), actorId, file);
  }

  @Get(':id/label')
  @UseGuards(SuperAdminGuard)
  async downloadShippingLabel(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const label = await this.shippingLabels.download(id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="pedido-${id}-etiqueta.pdf"`);
    return res.send(label.buffer);
  }

  @Post(':id/mark-shipped')
  markShipped(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') actorId: number) {
    return this.ordersService.updateOrderFulfillment(id, { status: OrderStatus.SHIPPED }, actorId);
  }

  @Post(':id/mark-delivered')
  markDelivered(@Param('id', ParseIntPipe) id: number, @CurrentUser('id') actorId: number) {
    return this.ordersService.updateOrderFulfillment(id, { status: OrderStatus.DELIVERED }, actorId);
  }

  @Post(':id/refund')
  refundOrder(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.refundOrder(id);
  }
}
