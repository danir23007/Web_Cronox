// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './common/email/email.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // API v5: array de configuraciones
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // 60s
        limit: 100, // 100 req/min por IP (ajusta si quieres)
      },
    ]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'cronox-front'),
      exclude: [
        '/api(.*)',
        '/api/docs(.*)',
        '/products(.*)',
        '/auth(.*)',
      ],
      serveStaticOptions: { index: 'index.html' },
    }),
    PrismaModule,
    EmailModule,
    AuthModule,
    ProductModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Registramos nuestro guard extendido como guard global ÚNICO
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
