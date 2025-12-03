import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { CartModule } from '../cart/cart.module';
import { NewsletterModule } from '../newsletter/newsletter.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

const refreshJwtProvider = {
  provide: 'JWT_REFRESH_SERVICE',
  useFactory: () =>
    new JwtService({
      secret: process.env.JWT_REFRESH_SECRET ?? 'change_me_refresh',
      signOptions: { expiresIn: '7d' },
    }),
};

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET ?? 'change_me_access',
      signOptions: { expiresIn: '15m' },
    }),
    PassportModule,
    UsersModule,
    CartModule,
    NewsletterModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAccessStrategy,
    JwtRefreshStrategy,
    refreshJwtProvider,
  ],
  exports: [AuthService],
})
export class AuthModule {}
