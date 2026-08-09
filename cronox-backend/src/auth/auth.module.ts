import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRequiredJwtSecret } from '../common/config/environment';
import { UsersModule } from '../users/users.module';
import { CartModule } from '../cart/cart.module';
import { EmailModule } from '../email/email.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { AccessAuthModule } from './access-auth.module';

const refreshJwtProvider = {
  provide: 'JWT_REFRESH_SERVICE',
  inject: [ConfigService],
  useFactory: (_config: ConfigService) =>
    new JwtService({
      secret: getRequiredJwtSecret('JWT_REFRESH_SECRET'),
      signOptions: { expiresIn: '7d' },
    }),
};

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => ({
        secret: getRequiredJwtSecret('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
    PassportModule,
    AccessAuthModule,
    UsersModule,
    CartModule,
    EmailModule,
    NewsletterModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtRefreshStrategy, refreshJwtProvider],
  exports: [AuthService],
})
export class AuthModule {}
