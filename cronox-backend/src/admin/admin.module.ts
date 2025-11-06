import { Module } from '@nestjs/common';
import { ProductModule } from '../products/product.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminStockController } from './stock/admin-stock.controller';
import { AdminStockService } from './stock/admin-stock.service';

@Module({
  imports: [ProductModule],
  controllers: [
    AdminOrdersController,
    AdminUsersController,
    AdminProductsController,
    AdminStockController,
  ],
  providers: [AdminOrdersService, AdminUsersService, AdminStockService, RolesGuard],
})
export class AdminModule {}
