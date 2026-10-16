import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { MembershipModule } from '../../membership/membership.module';
import { AdminGuard } from '../../common/guards/admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { QrEventsController } from './qr-events.controller';
import { QrEventsService } from './qr-events.service';

@Module({
  imports: [PrismaModule, MembershipModule],
  controllers: [QrEventsController],
  providers: [QrEventsService, AdminGuard, RolesGuard],
})
export class QrEventsModule {}
