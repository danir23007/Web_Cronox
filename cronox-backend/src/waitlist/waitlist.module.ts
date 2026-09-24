import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  WaitlistController,
  AdminWaitlistController,
} from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [WaitlistController, AdminWaitlistController],
  providers: [WaitlistService, AdminGuard, RolesGuard],
})
export class WaitlistModule {}
