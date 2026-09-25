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
import { AdminCirclePromotionsController } from './circle-upgrades/admin-circle-promotions.controller';
import { AdminPromoCodesController } from './promo-codes/admin-promo-codes.controller';
import { AdminPromoCodesService } from './promo-codes/admin-promo-codes.service';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminAuditLogsController } from './audit-logs/admin-audit-logs.controller';
import { AdminAuditLogsService } from './audit-logs/admin-audit-logs.service';
import { AuditLogMaintenanceService } from './audit-logs/audit-log-maintenance.service';
import { AdminNotesController } from './notes/admin-notes.controller';
import { AdminNotesService } from './notes/admin-notes.service';
import { EmailModule } from '../email/email.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminInventoryController } from './inventory/admin-inventory.controller';
import { AdminInventoryService } from './inventory/admin-inventory.service';
import { ProductImageUploadSizeExceptionFilter } from './products/product-image-upload-size-exception.filter';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { AdminExportsController } from './exports/admin-exports.controller';
import { AdminExportsService } from './exports/admin-exports.service';
import { ExcelWorkbookService } from './exports/excel-workbook.service';
import { AdminManualPurchasesService } from './manual-purchases/admin-manual-purchases.service';
import { AdminManualPurchaseCorrectionsController, AdminManualPurchasesController } from './manual-purchases/admin-manual-purchases.controller';

@Module({
  imports: [
    ProductModule,
    CategoriesModule,
    HistorialModule,
    MembershipModule,
    EmailModule,
    PaymentsModule,
    OrdersModule,
  ],
  controllers: [
    AdminOrdersController,
    AdminUsersController,
    AdminProductsController,
    AdminStockController,
    AdminCategoriesController,
    AdminCircleUpgradesController,
    AdminCirclePromotionsController,
    AdminPromoCodesController,
    AdminDashboardController,
    AdminAuditLogsController,
    AdminNotesController,
    AdminInventoryController,
    AdminExportsController,
    AdminManualPurchasesController,
    AdminManualPurchaseCorrectionsController,
  ],
  providers: [
    AdminOrdersService,
    AdminUsersService,
    AdminStockService,
    AdminCircleUpgradesService,
    AdminPromoCodesService,
    AdminDashboardService,
    AdminAuditLogsService,
    AuditLogMaintenanceService,
    AdminNotesService,
    AdminInventoryService,
    ProductImageUploadSizeExceptionFilter,
    AdminGuard,
    SuperAdminGuard,
    AdminExportsService,
    ExcelWorkbookService,
    AdminManualPurchasesService,
  ],
})
export class AdminModule {}
