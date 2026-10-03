import { Module } from '@nestjs/common';
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
@Module({
  imports: [AccessAuthModule],
  controllers: [MailboxController],
  providers: [
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
