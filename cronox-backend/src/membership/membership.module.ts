import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { HistorialModule } from '../historial/historial.module';
import { MembershipController, MembershipPublicController } from './membership.controller';
import { CircleController } from './circle.controller';
import { CircleUpgradeController, AdminCircleUpgradeController } from './circle-upgrade.controller';
import { CircleUpgradeService } from './circle-upgrade.service';
import { CircleService } from './circle.service';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule, UsersModule, HistorialModule],
  controllers: [
    MembershipController,
    MembershipPublicController,
    CircleController,
    CircleUpgradeController,
    AdminCircleUpgradeController,
  ],
  providers: [MembershipService, CircleService, CircleUpgradeService],
})
export class MembershipModule {}
