// [ORDERS] Módulo principal de pedidos
import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { ShippingMethodsModule } from '../shipping-methods/shipping-methods.module';
import { HistorialModule } from '../historial/historial.module';
import { CheckoutSummaryController } from './checkout-summary.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, CartModule, ShippingMethodsModule, HistorialModule],
  controllers: [OrdersController, CheckoutSummaryController],
  providers: [OrdersService, TaxConfigService],
  exports: [OrdersService],
})
export class OrdersModule {}
