import { Module } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminFooterController } from './admin-footer.controller';
import { FooterController } from './footer.controller';
import { FooterSettingsService } from './footer-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [FooterController, AdminFooterController],
  providers: [FooterSettingsService, AdminGuard, RolesGuard],
})
export class FooterModule {}
