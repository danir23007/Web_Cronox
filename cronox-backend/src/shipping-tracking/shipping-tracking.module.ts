import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { UserNumberingGateModule } from '../users/user-numbering-gate.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { TrackpubClient } from './trackpub.client';
import { TrackpubContract } from './trackpub.contract';
import { TrackingRequestGate } from './tracking-request-gate';
import { TrackingService } from './tracking.service';
import { TrackingNotificationsService } from './tracking-notifications.service';
import { TrackingWorkerService } from './tracking-worker.service';
import { TrackingAdminController } from './tracking-admin.controller';
import { ShippingLabelsService } from './labels.service';
import { ShippingLabelUploadInterceptor } from './labels-upload.interceptor';

@Module({
  imports: [PrismaModule, EmailModule, UserNumberingGateModule],
  controllers: [TrackingAdminController],
  providers: [TrackpubClient, TrackpubContract, TrackingRequestGate, TrackingService,
    TrackingNotificationsService, TrackingWorkerService, ShippingLabelsService, ShippingLabelUploadInterceptor, AdminGuard, SuperAdminGuard],
  exports: [TrackingService, ShippingLabelsService, ShippingLabelUploadInterceptor],
})
export class ShippingTrackingModule {}
