import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { HistorialModule } from '../historial/historial.module';
import { MembershipController, MembershipPublicController } from './membership.controller';
import { CircleController } from './circle.controller';
import { CircleService } from './circle.service';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule, UsersModule, HistorialModule],
  controllers: [MembershipController, MembershipPublicController, CircleController],
  providers: [MembershipService, CircleService],
})
export class MembershipModule {}
