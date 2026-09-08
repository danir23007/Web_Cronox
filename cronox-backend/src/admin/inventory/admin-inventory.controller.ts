import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/roles.decorator';
import { AdminInventoryService } from './admin-inventory.service';
import {
  AdminInventoryHistoryQueryDto,
  AdminInventoryQueryDto,
} from './dto/admin-inventory-query.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

@Controller('admin/inventory')
@UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.LOGISTICS)
export class AdminInventoryController {
  constructor(private readonly inventoryService: AdminInventoryService) {}

  @Get()
  list(@Query() query: AdminInventoryQueryDto) {
    return this.inventoryService.list(query);
  }

  @Get('summary')
  summary() {
    return this.inventoryService.summary();
  }

  @Get(':productId/history')
  history(
    @Param('productId', ParseIntPipe) productId: number,
    @Query() query: AdminInventoryHistoryQueryDto,
  ) {
    return this.inventoryService.history(productId, query);
  }

  @Get(':productId')
  getProduct(@Param('productId', ParseIntPipe) productId: number) {
    return this.inventoryService.getProduct(productId);
  }

  @Patch(':productId')
  update(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateInventoryDto,
    @CurrentUser('id') adminId?: number,
  ) {
    return this.inventoryService.update(productId, dto, adminId);
  }
}
