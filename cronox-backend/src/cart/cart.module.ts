import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { AccessAuthModule } from '../auth/access-auth.module';

@Module({
  imports: [PrismaModule, AccessAuthModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
