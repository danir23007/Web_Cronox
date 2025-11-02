// cronox-backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';

@Module({
  imports: [
    // Sirve el frontend estático desde /cronox-front,
    // pero NO tapes las rutas de API ni Swagger.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'cronox-front'),
      exclude: [
        '/api(.*)',        // todo lo que empiece por /api
        '/api/docs(.*)',   // swagger ui + assets
        '/products(.*)',   // endpoints REST de productos
      ],
      serveStaticOptions: { index: 'index.html' },
    }),

    PrismaModule,
    ProductModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
