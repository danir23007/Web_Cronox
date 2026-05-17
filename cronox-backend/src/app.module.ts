// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; // [STRIPE]
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { EmailModule } from './email/email.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ProductModule } from './products/product.module';
import { UsersModule } from './users/users.module';
import { AddressesModule } from './addresses/addresses.module';
import { OrdersModule } from './orders/orders.module'; // [ORDERS]
import { PaymentsModule } from './payments/payments.module'; // [STRIPE]
import { AdminModule } from './admin/admin.module';
import { ShippingMethodsModule } from './shipping-methods/shipping-methods.module';
import { CategoriesModule } from './categories/categories.module';
import { FavoritesModule } from './favorites/favorites.module';
import { MeModule } from './me/me.module';
import { MembershipModule } from './membership/membership.module';
import { NewsletterModule } from './newsletter/newsletter.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }), // [STRIPE]
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // ventana de 60s
        limit: 100, // máximo 100 peticiones por IP/minuto
      },
    ]),
    ServeStaticModule.forRoot(
      {
        // Archivos estáticos globales (favicon, etc.) en cronox-front/public
        rootPath: join(__dirname, '..', '..', 'cronox-front', 'public'),
        serveRoot: '/',
        exclude: ['/api', '/docs', '/webhooks'],
      },
      {
        // cronox-backend/../.. = carpeta padre donde está cronox-front
        rootPath: join(__dirname, '..', '..', 'cronox-front'),
        serveRoot: '/',
        renderPath: '/',
        // solo cadenas simples; /api y compañía se reservan para la API
        exclude: ['/api', '/docs', '/webhooks'],
        serveStaticOptions: { index: 'index.html' },
      },
      {
        rootPath: join(__dirname, '..', '..', 'cronox-front'),
        serveRoot: '/reset-password',
        renderPath: '/reset-password',
        serveStaticOptions: { index: 'reset-password.html' },
      },
      {
        rootPath: join(__dirname, '..', '..', 'cronox-front'),
        serveRoot: '/forgot-password',
        renderPath: '/forgot-password',
        serveStaticOptions: { index: 'forgot-password.html' },
      },
    ),
    PrismaModule,
    EmailModule,
    AuthModule,
    CartModule,
    ProductModule,
    UsersModule,
    AddressesModule,
    ShippingMethodsModule,
    CategoriesModule,
    FavoritesModule,
    MeModule,
    MembershipModule,
    NewsletterModule,
    OrdersModule, // [ORDERS] Registro del módulo de pedidos
    PaymentsModule, // [STRIPE]
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
