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

@Module({
  imports: [EmailModule],
  controllers: [PublicKeyScreenController, AdminKeyScreenController],
  providers: [KeyScreenService, SupabaseStorageService, AdminGuard, RolesGuard],
  exports: [KeyScreenService],
})
export class KeyScreenModule {}
