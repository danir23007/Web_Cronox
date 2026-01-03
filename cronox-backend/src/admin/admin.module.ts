import { Module } from '@nestjs/common';
import { ProductModule } from '../products/product.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { CategoriesModule } from '../categories/categories.module';
import { MembershipModule } from '../membership/membership.module';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminStockController } from './stock/admin-stock.controller';
import { AdminStockService } from './stock/admin-stock.service';
import { AdminCategoriesController } from './categories/admin-categories.controller';
import { HistorialModule } from '../historial/historial.module';
import { AdminCircleUpgradesController } from './circle-upgrades/admin-circle-upgrades.controller';
import { AdminCircleUpgradesService } from './circle-upgrades/admin-circle-upgrades.service';

@Module({
  imports: [ProductModule, CategoriesModule, HistorialModule, MembershipModule],
  controllers: [
    AdminOrdersController,
    AdminUsersController,
    AdminProductsController,
    AdminStockController,
    AdminCategoriesController,
    AdminCircleUpgradesController,
  ],
  providers: [
    AdminOrdersService,
    AdminUsersService,
    AdminStockService,
    AdminCircleUpgradesService,
    AdminGuard,
  ],
})
export class AdminModule {}
