import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminPointsService } from './admin-points.service';
import { ExpenseDto, PointDto, ReturnDto, SaleDto } from './point.dto';

@Controller('admin/sale-points')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPointsController {
  constructor(private readonly service: AdminPointsService) {}
  @Get('options') options() {
    return this.service.options();
  }
  @Get() list(@Query('search') search = '') {
    return this.service.list(search.slice(0, 160));
  }
  @Get(':id') detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('search') search = '',
    @Query('productId', new ParseIntPipe({ optional: true })) productId?: number,
  ) {
    return this.service.detail(id, from, to, search.slice(0, 160), productId);
  }
  @Post() create(
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: PointDto,
  ) {
    return this.service.savePoint(actor, key, dto);
  }
  @Post(':id') edit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: PointDto,
  ) {
    return this.service.savePoint(actor, key, dto, id);
  }
  @Post(':id/sales') sale(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: SaleDto,
  ) {
    return this.service.sale(id, actor, key, dto);
  }
  @Post(':id/sales/:saleId/correct') correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: SaleDto,
  ) {
    return this.service.sale(id, actor, key, dto, saleId);
  }
  @Post(':id/sales/:saleId/returns') refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: ReturnDto,
  ) {
    return this.service.refund(id, saleId, actor, key, dto);
  }
  @Post(':id/expenses') expense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actor: number,
    @Headers('idempotency-key') key: string,
    @Body() dto: ExpenseDto,
  ) {
    return this.service.expense(id, actor, key, dto);
  }
}
