import { EmailModule } from '../email/email.module';
import { EmailChangeService } from './email-change.service';
import { EmailChangeController, MyEmailChangeController } from './email-change.controller';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [PrismaModule, UsersModule, EmailModule],
  controllers: [MeController, EmailChangeController, MyEmailChangeController],
  providers: [MeService, EmailChangeService],
})
export class MeModule {}
