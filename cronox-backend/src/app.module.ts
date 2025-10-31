import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProductsModule } from './products/products.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
<<<<<<< HEAD
      rootPath: join(__dirname, '..', '..'),
      exclude: ['/api(.*)', '/products(.*)', '/products', '/api'],
      serveStaticOptions: { index: 'index.html' },
    }),
=======
  rootPath: join(__dirname, '..', '..'),
  exclude: ['/api(.*)', '/products(.*)', '/products', '/api'],
  serveStaticOptions: { index: 'index.html' },
}),

>>>>>>> 9c88e9b (prisma changes)
    ProductsModule,
    PrismaModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
