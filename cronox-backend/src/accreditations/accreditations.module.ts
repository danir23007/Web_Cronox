import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AccreditationsService } from './accreditations.service';
import { AccreditationsController, AdminAccreditationsController } from './accreditations.controller';

@Module({ imports: [PrismaModule], controllers: [AccreditationsController, AdminAccreditationsController],
  providers: [AccreditationsService, AdminGuard, RolesGuard] })
export class AccreditationsModule {}
