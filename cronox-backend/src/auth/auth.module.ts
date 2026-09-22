import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { CartModule } from '../cart/cart.module';
import { EmailModule } from '../email/email.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { AccessAuthModule } from './access-auth.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    AccessAuthModule,
    UsersModule,
    CartModule,
    EmailModule,
    NewsletterModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
