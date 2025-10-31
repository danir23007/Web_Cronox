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
      // Evitar colisiones con API y /products
      exclude: ['/api(.*)', '/products(.*)', '/products', '/api'],
      serveStaticOptions: { index: 'index.html' },
    }),
    PrismaModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
