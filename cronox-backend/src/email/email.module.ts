import { Module } from '@nestjs/common';
import { EmailController } from './email.controller';
import { MailTransportFactory } from './mail-transport.factory';
import { EmailService } from './email.service';

@Module({
  controllers: [EmailController],
  providers: [MailTransportFactory, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
