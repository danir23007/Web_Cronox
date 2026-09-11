import { Module } from '@nestjs/common';
import { ManagedMailService } from './managed/managed-mail.service';
import { ManagedMailController } from './managed/managed-mail.controller';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { EmailController } from './email.controller';
import { MailTransportFactory } from './mail-transport.factory';
import { EmailService } from './email.service';
import { OrderConfirmationEmailMapper } from './order-confirmation-email.mapper';

@Module({
  controllers: [EmailController, ManagedMailController],
  providers: [
    MailTransportFactory,
    EmailService,
    OrderConfirmationEmailMapper,
    ManagedMailService,
    SupabaseStorageService,
    AdminGuard,
  ],
  exports: [EmailService, OrderConfirmationEmailMapper],
})
export class EmailModule {}
