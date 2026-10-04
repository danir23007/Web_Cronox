import { Module } from '@nestjs/common';
import { AdminEventPushService } from './admin-event-push.service';
import { EmailModule } from '../email/email.module';
import { MailboxCampaignService } from './mailbox-campaign.service';
import { MailboxUnsubscribeController } from './mailbox-unsubscribe.controller';
import { AccessAuthModule } from '../auth/access-auth.module';
import {
  MailboxController,
  MailboxDraftUploadGuard,
  MailboxUploadInterceptor,
} from './mailbox.controller';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { MailboxSyncService } from './mailbox-sync.service';
import { MailboxSenderService } from './mailbox-sender.service';
import { MailboxPushService } from './mailbox-push.service';
import { MailboxService } from './mailbox.service';
import { MailboxWorkerService } from './mailbox-worker.service';
import { MailboxRetentionService } from './mailbox-retention.service';
import { MailboxTrackingService } from './mailbox-tracking.service';
import { MailboxTrackingController } from './mailbox-tracking.controller';
@Module({
  imports: [AccessAuthModule, EmailModule],
  controllers: [MailboxController, MailboxUnsubscribeController, MailboxTrackingController],
  providers: [
    MailboxTrackingService,
    MailboxRetentionService,
    AdminEventPushService,
    MailboxCampaignService,
    MailboxDraftUploadGuard,
    MailboxUploadInterceptor,
    MailboxAccessService,
    MailboxFilesService,
    MailboxLeasesService,
    MailboxProviderService,
    MailboxReaderService,
    MailboxSyncService,
    MailboxSenderService,
    MailboxPushService,
    MailboxService,
    MailboxWorkerService,
  ],
})
export class MailboxModule {}
