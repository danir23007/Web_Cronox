import { Module } from '@nestjs/common';
import { ProductModule } from '../products/product.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { CategoriesModule } from '../categories/categories.module';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminStockController } from './stock/admin-stock.controller';
import { AdminStockService } from './stock/admin-stock.service';
import { AdminCategoriesController } from './categories/admin-categories.controller';
import { HistorialModule } from '../historial/historial.module';

@Module({
  imports: [ProductModule, CategoriesModule, HistorialModule],
  controllers: [
    AdminOrdersController,
    AdminUsersController,
    AdminProductsController,
    AdminStockController,
    AdminCategoriesController,
  ],
  providers: [AdminOrdersService, AdminUsersService, AdminStockService, RolesGuard],
})
export class AdminModule {}
