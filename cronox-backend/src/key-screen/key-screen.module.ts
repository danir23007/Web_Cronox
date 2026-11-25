import { Module } from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';
import { EmailModule } from '../email/email.module';
import {
  AdminKeyScreenController,
  PublicKeyScreenController,
} from './key-screen.controller';
import { KeyScreenService } from './key-screen.service';
import { BlackFridayService, PublicBlackFridayController, AdminBlackFridayController } from './black-friday';

@Module({
  imports: [EmailModule],
  controllers: [PublicKeyScreenController, AdminKeyScreenController, PublicBlackFridayController, AdminBlackFridayController],
  providers: [KeyScreenService, BlackFridayService, SupabaseStorageService, AdminGuard, RolesGuard],
  exports: [KeyScreenService],
})
export class KeyScreenModule {}
