import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminStockService } from './admin-stock.service';
import { AdminStockMovementsQueryDto } from './dto/admin-stock-movements-query.dto';

@Controller('admin/stock/movements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminStockController {
  constructor(private readonly stockService: AdminStockService) {}

  @Get()
  listMovements(@Query() query: AdminStockMovementsQueryDto) {
    return this.stockService.listMovements(query);
  }
}
