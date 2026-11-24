import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { AccessAuthModule } from '../auth/access-auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { EmailModule } from '../email/email.module';
import { CartAbandonmentService } from './cart-abandonment.service';
import { KeyScreenModule } from '../key-screen/key-screen.module';

@Module({
  imports: [PrismaModule, AccessAuthModule, AnalyticsModule, EmailModule, KeyScreenModule],
  controllers: [CartController],
  providers: [CartService, CartAbandonmentService],
  exports: [CartService],
})
export class CartModule {}
