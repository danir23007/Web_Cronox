// cronox-backend/src/app.module.ts
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';

@Module({
  imports: [
    // Sirve estáticos desde la carpeta del front
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'cronox-front'),
      // IMPORTANT: usar comodines con nombre para path-to-regexp v6
      // Excluye /api y /products (y sus subrutas) del fallback estático
      exclude: ['/api', '/api/:rest(.*)', '/products', '/products/:rest(.*)'],
      serveStaticOptions: { index: 'index.html' },
    }),
    PrismaModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
