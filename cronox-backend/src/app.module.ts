// src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

// importa aquí el resto de tus módulos reales
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';
import { EmailModule } from './common/email/email.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
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
    Reflector,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
