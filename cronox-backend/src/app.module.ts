// cronox-backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';

import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // Sirve el frontend estático desde /cronox-front,
    // pero NO tapes las rutas de API ni Swagger.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'cronox-front'),
      exclude: [
        '/api(.*)', // todo lo que empiece por /api
        '/api/docs(.*)', // swagger ui + assets
        '/products(.*)', // endpoints REST de productos
        '/auth(.*)', // endpoints de autenticación
      ],
      serveStaticOptions: { index: 'index.html' },
    }),

    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 20,
      },
    ]),
    PrismaModule,
    ProductModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
