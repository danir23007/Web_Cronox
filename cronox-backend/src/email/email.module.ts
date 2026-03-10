import { Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { MailTransportFactory } from './mail-transport.factory';
import { EmailService } from './email.service';
import { OrderConfirmationEmailMapper } from './order-confirmation-email.mapper';

@Module({
  controllers: [EmailController],
  providers: [MailTransportFactory, EmailService, OrderConfirmationEmailMapper],
  exports: [EmailService, OrderConfirmationEmailMapper],
})
export class EmailModule {}
