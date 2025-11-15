import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShippingMethodsController } from './shipping-methods.controller';
import { ShippingMethodsService } from './shipping-methods.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShippingMethodsController],
  providers: [ShippingMethodsService],
  exports: [ShippingMethodsService],
})
export class ShippingMethodsModule {}
