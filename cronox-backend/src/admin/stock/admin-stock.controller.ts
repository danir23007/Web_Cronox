import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminStockService } from './admin-stock.service';
import { AdminStockMovementsQueryDto } from './dto/admin-stock-movements-query.dto';

@Controller('admin/stock/movements')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminStockController {
  constructor(private readonly stockService: AdminStockService) {}

  @Get()
  listMovements(@Query() query: AdminStockMovementsQueryDto) {
    return this.stockService.listMovements(query);
  }
}
