import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { MembershipController, MembershipPublicController } from './membership.controller';
import { MembershipService } from './membership.service';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [MembershipController, MembershipPublicController],
  providers: [MembershipService],
})
export class MembershipModule {}
