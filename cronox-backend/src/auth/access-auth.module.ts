import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { AuthSessionsService } from './auth-sessions.service';

/**
 * Access-token authentication shared by required and optional JWT routes.
 * This module deliberately has no dependency on AuthModule or CartModule, so
 * CartModule can opt into authentication without a circular module import.
 */
@Module({
  imports: [PassportModule, UsersModule],
  providers: [JwtAccessStrategy, OptionalJwtAuthGuard, AuthSessionsService],
  exports: [PassportModule, OptionalJwtAuthGuard, AuthSessionsService],
})
export class AccessAuthModule {}
