import { Module } from '@nestjs/common';
import { AccessAuthModule } from '../auth/access-auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { LiveStatsController } from './live-stats.controller';
import { LiveStatsService } from './live-stats.service';
import { LivePaymentObservation } from './live-payment-observation';
@Module({
  imports: [PrismaModule, AccessAuthModule],
  controllers: [LiveStatsController],
  providers: [LiveStatsService, LivePaymentObservation, AdminGuard],
  exports: [LivePaymentObservation],
})
export class LiveStatsModule {}
