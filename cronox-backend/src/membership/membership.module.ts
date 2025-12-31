import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { HistorialModule } from '../historial/historial.module';
import { MembershipController, MembershipPublicController } from './membership.controller';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule, UsersModule, HistorialModule],
  controllers: [MembershipController, MembershipPublicController],
  providers: [MembershipService],
})
export class MembershipModule {}
