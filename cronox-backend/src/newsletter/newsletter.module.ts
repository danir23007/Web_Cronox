import { Module } from '@nestjs/common';
import { EmailModule } from '../common/email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [NewsletterController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
